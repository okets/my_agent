/**
 * AutomationExecutor — Core execution engine for automations
 *
 * Extends the TaskExecutor pattern: builds system prompt with automation context,
 * runs a brain query, extracts deliverables, and updates job status.
 */

import {
  createBrainQuery,
  loadConfig,
  filterSkillsByTools,
  cleanupSkillFilters,
  parseFrontmatterContent,
  createStopReminder,
  createCapabilityAuditLogger,
  storeAndInject,
  parseMcpToolName,
} from "@my-agent/core";
import type {
  Automation,
  Job,
  HookEvent,
  HookCallbackMatcher,
  Space,
  AuditEntry,
  StoreCallback,
  TodoItem,
  CapabilityRegistry,
} from "@my-agent/core";
import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import path from "node:path";
import { getHandler } from "../scheduler/jobs/handler-registry.js";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ConversationDatabase } from "../conversations/db.js";
import type { AutomationManager } from "./automation-manager.js";
import type { AutomationJobService } from "./automation-job-service.js";
import { buildWorkingNinaPrompt } from "./working-nina-prompt.js";
import { extractDeliverable } from "./deliverable-utils.js";
import { createChartServer } from "../mcp/chart-server.js";
import { createImageFetchServer } from "../mcp/image-fetch-server.js";
import { createTodoServer, type TodoProgress } from "../mcp/todo-server.js";
import { createEmptyTodoFile, readTodoFile, writeTodoFile } from "./todo-file.js";
import { assembleJobTodos } from "./todo-templates.js";
import { runValidation } from "./todo-validators.js";
import { handleCreateChart } from "../mcp/chart-server.js";
import { queryModel } from "../scheduler/query-model.js";
import { resolveJobSummary } from "./summary-resolver.js";

/** Working Nina's allowed tools — full access including web for research workers */
const WORKER_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Skill",
  "WebSearch",
  "WebFetch",
];

export interface AutomationExecutorConfig {
  automationManager: AutomationManager;
  jobService: AutomationJobService;
  agentDir: string;
  db: ConversationDatabase;
  mcpServers?: Options["mcpServers"];
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  visualService?: import("../visual/visual-action-service.js").VisualActionService;
  onJobProgress?: (jobId: string, progress: TodoProgress) => void;
  capabilityRegistry?: CapabilityRegistry;
}

export interface ExecutionResult {
  success: boolean;
  work: string;
  deliverable: string | null;
  error?: string;
}

export class AutomationExecutor {
  private config: AutomationExecutorConfig;
  private abortControllers = new Map<string, AbortController>();

  constructor(config: AutomationExecutorConfig) {
    this.config = config;
  }

  /**
   * Abort a running job. The for-await loop checks the signal each iteration
   * and breaks early, marking the job as failed.
   */
  abortJob(jobId: string): boolean {
    const controller = this.abortControllers.get(jobId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }

  /** Merge per-job Stop + PostToolUse hooks into static config hooks */
  private buildJobHooks(
    todoPath: string | null,
    vasStore?: StoreCallback,
  ): typeof this.config.hooks {
    const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
      ...(this.config.hooks ?? {}),
    };

    if (todoPath) {
      hooks.Stop = [
        ...(this.config.hooks?.Stop ?? []),
        { hooks: [createStopReminder(todoPath)] },
      ];
    }

    if (vasStore) {
      const auditLogPath = path.join(this.config.agentDir, 'logs', 'capability-audit.jsonl');
      const capAuditLogger = createCapabilityAuditLogger(async (entry: AuditEntry) => {
        try {
          await fs.promises.mkdir(path.dirname(auditLogPath), { recursive: true });
          await fs.promises.appendFile(auditLogPath, JSON.stringify(entry) + '\n', 'utf-8');
        } catch {
          // Audit logging is best-effort
        }
      });

      hooks.PostToolUse = [
        ...(this.config.hooks?.PostToolUse ?? []),
        {
          hooks: [
            async (input) => {
              const postInput = input as PostToolUseHookInput;
              const toolName = postInput.tool_name ?? 'unknown';

              // Audit logging — framework is capability-agnostic, derive server name from tool prefix
              const parsed = parseMcpToolName(toolName);
              if (parsed) {
                await capAuditLogger.log({
                  capabilityName: parsed.server,
                  toolName: parsed.tool,
                  sessionId: postInput.session_id,
                });
              }

              // Screenshot pipeline — store and inject URL for any image-producing tool
              return storeAndInject(postInput.tool_response, toolName, vasStore);
            },
          ],
        },
      ];
    }

    return hooks;
  }

  /** Auto-detect job type from manifest or target_path */
  private detectJobType(automation: Automation): string | undefined {
    if (automation.manifest.job_type) return automation.manifest.job_type;
    // Auto-detect from target_path for existing automations
    const tp = automation.manifest.target_path;
    if (tp && tp.includes("capabilities/")) {
      const capPath = path.resolve(this.config.agentDir, "..", tp);
      return fs.existsSync(path.join(capPath, "CAPABILITY.md"))
        ? "capability_modify"
        : "capability_build";
    }
    return undefined;
  }

  async run(
    automation: Automation,
    job: Job,
    triggerContext?: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    console.log(
      `[AutomationExecutor] Running automation "${automation.manifest.name}" (job ${job.id})`,
    );

    // INVARIANT: Handler-dispatched jobs (system automations like debrief-prep)
    // bypass the SDK session flow entirely, including todo assembly and gating.
    // The handler returns before assembleJobTodos is called.
    // If this path changes, generic mandatory items would gate handler jobs.
    const handlerKey = automation.manifest.handler;
    if (handlerKey) {
      const handler = getHandler(handlerKey);
      if (!handler) {
        throw new Error(`Unknown built-in handler: ${handlerKey}`);
      }

      this.config.jobService.updateJob(job.id, { status: "running" });

      try {
        const result = await handler({
          agentDir: this.config.agentDir,
          db: this.config.db,
          jobId: job.id,
        });

        let handlerDeliverablePath: string | undefined;
        if (result.deliverable && job.run_dir) {
          handlerDeliverablePath = path.join(job.run_dir, "deliverable.md");
          fs.writeFileSync(handlerDeliverablePath, result.deliverable, "utf-8");
        }

        this.config.jobService.updateJob(job.id, {
          status: result.success ? "completed" : "failed",
          completed: new Date().toISOString(),
          summary: resolveJobSummary(job.run_dir, result.deliverable ?? result.work),
          deliverablePath: handlerDeliverablePath,
        });

        console.log(
          `[AutomationExecutor] Handler "${handlerKey}" ${result.success ? "completed" : "failed"} (job ${job.id})`,
        );

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.config.jobService.updateJob(job.id, {
          status: "failed",
          completed: new Date().toISOString(),
          summary: `Error: ${errorMessage}`,
        });
        return {
          success: false,
          work: "",
          deliverable: null,
          error: errorMessage,
        };
      }
    }

    // 1. Update job status to running
    this.config.jobService.updateJob(job.id, { status: "running" });

    const disabledSkills = await filterSkillsByTools(
      this.config.agentDir,
      WORKER_TOOLS,
    );

    try {
      // 2. Build system prompt
      const brainConfig = loadConfig();
      const model = automation.manifest.model ?? brainConfig.model;

      const basePrompt = await buildWorkingNinaPrompt(this.config.agentDir, {
        taskTitle: automation.manifest.name,
        taskId: automation.id,
        taskDir: job.run_dir,
      });

      // Resolve referenced spaces for context
      const spaces: Space[] = [];
      for (const spaceName of automation.manifest.spaces ?? []) {
        const spaceRow = this.config.db.getSpace(spaceName);
        if (spaceRow) {
          spaces.push({
            name: spaceRow.name,
            manifestDir: spaceRow.path,
            tags: spaceRow.tags ?? [],
            path: spaceRow.path,
            runtime: spaceRow.runtime ?? undefined,
            entry: spaceRow.entry ?? undefined,
            io: spaceRow.io as Space["io"],
            maintenance: spaceRow.maintenance as Space["maintenance"],
            description: spaceRow.description ?? "",
            created: "",
            indexedAt: spaceRow.indexedAt,
          });
        }
      }

      // Assemble todos *before* building the system prompt so the Progress
      // Cadence section can inline them. Todo-list assembly is a pure function
      // of the manifest + job type; we reuse `todoItems` below when wiring the
      // todo MCP server so there is a single source of truth per job.
      const todoPath = job.run_dir
        ? path.join(job.run_dir, "todos.json")
        : null;
      const jobType = this.detectJobType(automation);
      const todoItems = assembleJobTodos(
        automation.manifest.todos,
        jobType,
      );
      if (todoPath) {
        if (todoItems.length > 0) {
          writeTodoFile(todoPath, {
            items: todoItems,
            last_activity: new Date().toISOString(),
          });
        } else {
          createEmptyTodoFile(todoPath);
        }
      }

      const automationContext = this.buildAutomationContext(
        automation,
        spaces,
        triggerContext,
        todoItems,
      );

      const systemPrompt = `${basePrompt}\n\n${automationContext}`;

      // 3. Build user message
      const userMessage = this.buildUserMessage(automation);

      // 4. Initialize screenshot collector
      const screenshotIds: string[] = [];
      const unsubscribe = this.config.visualService?.onScreenshot((ss) => {
        screenshotIds.push(ss.id);
      });

      // 5. Build MCP servers for worker — fresh instances only, never shared singletons.
      // Shared MCP servers (space-tools, automation-tools, skills, etc.) are bound to the
      // brain's transport and cannot be reused by worker sessions. Workers only get fresh
      // chart/image servers when visual capabilities are needed.
      const workerMcpServers: NonNullable<Options["mcpServers"]> = {};

      // Todo MCP server — reuses `todoItems` / `todoPath` assembled above for
      // the Progress Cadence prompt section (single source of truth per job).
      if (todoPath) {
        // Resolve target_path for validators (capability_frontmatter checks this dir)
        const resolvedTargetDir = automation.manifest.target_path
          ? path.resolve(this.config.agentDir, "..", automation.manifest.target_path)
          : undefined;
        const onProgress = (progress: TodoProgress) => {
          this.config.onJobProgress?.(job.id, progress)
        }
        workerMcpServers["todo"] = createTodoServer(
          todoPath,
          runValidation,
          resolvedTargetDir,
          onProgress,
        );
      }

      if (this.config.visualService) {
        const vs = this.config.visualService;
        workerMcpServers["chart-tools"] = createChartServer({
          visualService: vs,
        });
        workerMcpServers["image-fetch-tools"] = createImageFetchServer({
          visualService: vs,
        });
      }

      // Browser-control capabilities (M9.5-S7: registry-only)
      const browserCaps =
        this.config.capabilityRegistry
          ?.listByProvides("browser-control")
          .filter((c) => c.status === "available" && c.enabled) ?? [];

      for (const cap of browserCaps) {
        const parts = (cap.entrypoint ?? "").trim().split(/\s+/);
        const command = parts[0] ?? "";
        const args = parts.slice(1).map((arg) =>
          arg.startsWith(".") || (!arg.startsWith("/") && arg.includes("/"))
            ? path.join(cap.path, arg)
            : arg,
        );
        workerMcpServers[cap.name] = {
          type: "stdio" as const,
          command,
          args,
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              (e): e is [string, string] => e[1] !== undefined,
            ),
          ),
        };
      }
      if (browserCaps.length > 0) {
        console.log(
          `[AutomationExecutor] browser-control: ${browserCaps.length} registry capability(ies) — ${browserCaps.map((c) => c.name).join(", ")}`,
        );
      } else {
        console.log(
          `[AutomationExecutor] browser-control: no capabilities registered — browser tools unavailable`,
        );
      }

      // Compute VAS store callback for screenshot pipeline
      const vasStore: StoreCallback | undefined = this.config.visualService
        ? (image, metadata) => {
            const ss = this.config.visualService!.store(image, metadata);
            return { id: ss.id, filename: ss.filename };
          }
        : undefined;

      // 6. Execute query (try session resumption if resume_from_job is specified)
      let resumeSessionId: string | undefined;
      const resumeMatch = automation.instructions.match(
        /resume_from_job:\s*(\S+)/,
      );
      if (resumeMatch) {
        const priorJobId = resumeMatch[1];
        // Look up the prior job to get its automation ID (may differ from current)
        const priorJob = this.config.jobService.getJob(priorJobId);
        const priorAutomationId = priorJob?.automationId ?? automation.id;
        const priorSession = this.config.jobService.getSessionId(
          priorAutomationId,
          priorJobId,
        );
        if (priorSession) {
          resumeSessionId = priorSession;
          console.log(
            `[AutomationExecutor] Attempting session resume from job ${priorJobId} (automation: ${priorAutomationId})`,
          );
        }
      }

      const query = createBrainQuery(userMessage, {
        model,
        systemPrompt,
        cwd: job.run_dir,
        tools: WORKER_TOOLS,
        settingSources: ["project"],
        additionalDirectories: [this.config.agentDir],
        mcpServers: workerMcpServers,
        hooks: this.buildJobHooks(todoPath, vasStore),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      });

      // 6. Iterate and collect response (follows TaskExecutor.iterateBrainQuery pattern)
      let response = "";
      let sdkSessionId: string | null = null;
      const abortController = new AbortController();
      this.abortControllers.set(job.id, abortController);

      for await (const msg of query) {
        if (abortController.signal.aborted) {
          console.log(`[AutomationExecutor] Job ${job.id} aborted by user`);
          break;
        }
        // Capture session ID from SDK init message
        if (
          msg.type === "system" &&
          (msg as any).subtype === "init" &&
          (msg as any).session_id
        ) {
          sdkSessionId = (msg as any).session_id;
          // Persist immediately so auto-resume works if the server crashes mid-execution
          this.config.jobService.updateJob(job.id, { sdk_session_id: sdkSessionId ?? undefined });
        }

        if (msg.type === "assistant") {
          const textBlocks = (msg as any).message.content.filter(
            (block: { type: string }) => block.type === "text",
          );
          for (const block of textBlocks) {
            if ("text" in block) {
              response += block.text;
            }
          }
        }
      }

      this.abortControllers.delete(job.id);

      // If aborted by user, return early — stop route handles status + notification
      if (abortController.signal.aborted) {
        if (unsubscribe) unsubscribe();
        return { success: false, work: response, deliverable: null, error: "Stopped by user" };
      }

      // 7. Extract deliverable
      const { work, deliverable } = extractDeliverable(response);

      // Write deliverable.md to run_dir — but preserve the worker's version if it has
      // valid frontmatter (workers write structured deliverables with metadata that
      // validators check; the extracted stream text would overwrite that).
      let deliverablePath: string | undefined;
      let finalDeliverable = deliverable ?? work;
      if (job.run_dir) {
        deliverablePath = path.join(job.run_dir, "deliverable.md");
        const workerWroteDeliverable =
          fs.existsSync(deliverablePath) &&
          fs.readFileSync(deliverablePath, "utf-8").startsWith("---");
        if (workerWroteDeliverable) {
          // Worker wrote structured deliverable with frontmatter — keep it
          finalDeliverable = fs.readFileSync(deliverablePath, "utf-8");
        } else if (finalDeliverable) {
          fs.writeFileSync(deliverablePath, finalDeliverable, "utf-8");
        }
      }
      if (unsubscribe) unsubscribe();

      // Post-execution visual augmentation: if deliverable has chartable
      // data but no images, generate a chart and append it
      if (finalDeliverable && deliverablePath && this.config.visualService) {
        const hasImages = finalDeliverable.includes("![");
        const numbers = finalDeliverable.match(/\d+/g) || [];
        const hasBulletedData =
          /[-•*]\s.*\d/.test(finalDeliverable) ||
          /\|.*\d.*\|/.test(finalDeliverable);

        if (!hasImages && numbers.length >= 3 && hasBulletedData) {
          try {
            console.log(
              `[AutomationExecutor] Deliverable has chartable data, generating chart`,
            );
            const CHART_PROMPT = `Generate an SVG chart for the data in this text. Output ONLY the raw SVG — no markdown fences, no explanation. Include a descriptive title in the chart.\n\nRules:\n- <svg xmlns="http://www.w3.org/2000/svg" width="600" height="350">\n- Use inline style="" attributes, NOT <style> blocks\n- Font: sans-serif only\n- Colors: background #1a1b26, panel #292e42, text #c0caf5, muted #565f89, accent #7aa2f7, purple #bb9af7, pink #f7768e, green #9ece6a, yellow #e0af68\n- Include axis labels, data point values, and a title\n- Round corners on background rect (rx="12")`;

            const svgResponse = await queryModel(
              `Generate a chart for this report:\n\n${finalDeliverable}`,
              CHART_PROMPT,
              "haiku",
            );

            const svgMatch = svgResponse.match(/<svg[\s\S]*<\/svg>/);
            if (svgMatch) {
              const chartResult = await handleCreateChart(
                { visualService: this.config.visualService },
                { svg: svgMatch[0], description: "deliverable chart" },
              );

              if (!chartResult.isError) {
                const parsed = JSON.parse(
                  (chartResult.content[0] as { type: "text"; text: string })
                    .text,
                );
                finalDeliverable += `\n\n![${automation.manifest.name} chart](${parsed.url})`;
                fs.writeFileSync(deliverablePath, finalDeliverable, "utf-8");
                screenshotIds.push(parsed.id);
                console.log(
                  `[AutomationExecutor] Chart appended to deliverable: ${parsed.url}`,
                );
              }
            }
          } catch (err) {
            console.warn(
              `[AutomationExecutor] Deliverable chart generation failed:`,
              err,
            );
            // Non-fatal — job completes without chart
          }
        }
      }

      // 8. Determine final status
      const hasNeedsReview =
        response.includes("needs_review") ||
        automation.manifest.autonomy === "review";

      let finalStatus: string = hasNeedsReview ? "needs_review" : "completed";
      let todoGatingSummary: string | undefined;

      // 8.5 Todo completion gating — check mandatory items
      if (todoPath && finalStatus === "completed") {
        const finalTodos = readTodoFile(todoPath);
        const mandatoryItems = finalTodos.items.filter((i) => i.mandatory);
        const blockedItems = mandatoryItems.filter(
          (i) => i.status === "blocked",
        );
        const incompleteItems = mandatoryItems.filter(
          (i) => i.status !== "done",
        );

        if (blockedItems.length > 0) {
          finalStatus = "needs_review";
          todoGatingSummary = `Blocked items: ${blockedItems.map((i) => `${i.id}: ${i.notes || i.text}`).join("; ")}`;
        } else if (incompleteItems.length > 0) {
          finalStatus = "needs_review";
          todoGatingSummary = `Incomplete mandatory items: ${incompleteItems.map((i) => i.text).join(", ")}`;
        }
      }

      // 9. Store session ID in sidecar file
      if (sdkSessionId) {
        this.config.jobService.storeSessionId(
          automation.id,
          job.id,
          sdkSessionId,
        );
      }

      // 10. Update job
      this.config.jobService.updateJob(job.id, {
        status: finalStatus as Job["status"],
        completed: new Date().toISOString(),
        summary: todoGatingSummary ?? resolveJobSummary(job.run_dir, deliverable ?? work),
        sdk_session_id: sdkSessionId ?? undefined,
        deliverablePath,
        screenshotIds,
      });

      // 11. Paper trail: write DECISIONS.md at artifact path
      const targetPath = automation.manifest.target_path;

      if (targetPath) {
        this.writePaperTrail(
          targetPath,
          finalDeliverable ?? "",
          automation,
          job,
        );
      }

      console.log(
        `[AutomationExecutor] Automation "${automation.manifest.name}" ${finalStatus} (job ${job.id})`,
      );

      return {
        success: finalStatus === "completed",
        work,
        deliverable,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(
        `[AutomationExecutor] Automation "${automation.manifest.name}" failed (job ${job.id}):`,
        error,
      );

      this.config.jobService.updateJob(job.id, {
        status: "failed",
        completed: new Date().toISOString(),
        summary: `Error: ${errorMessage}`,
      });

      return {
        success: false,
        work: "",
        deliverable: null,
        error: errorMessage,
      };
    } finally {
      if (disabledSkills.length > 0) {
        await cleanupSkillFilters(this.config.agentDir, disabledSkills);
      }
    }
  }

  /**
   * Resume a needs_review job with user input.
   * Uses SDK session resumption when a stored session ID is available.
   * Falls back to failed status if no session can be resumed.
   */
  async resume(
    job: Job,
    userInput: string,
    storedSessionId: string | null,
  ): Promise<{
    success: boolean;
    status: string;
    summary?: string;
    error?: string;
  }> {
    // Fall back to sidecar file if no session ID passed
    const effectiveSessionId =
      storedSessionId ??
      this.config.jobService.getSessionId(job.automationId, job.id);

    console.log(
      `[AutomationExecutor] Resuming job ${job.id} (session: ${effectiveSessionId ?? "none"})`,
    );

    // Update job status to running
    this.config.jobService.updateJob(job.id, { status: "running" });

    try {
      if (effectiveSessionId) {
        try {
          // Resume the SDK session with user input as the prompt
          const brainConfig = loadConfig();
          const automation = this.config.automationManager.findById(
            job.automationId,
          );
          const model = automation?.manifest.model ?? brainConfig.model;

          // Build MCP servers for resume — todo server + optional visual servers
          const resumeMcpServers: NonNullable<Options["mcpServers"]> = {};
          const todoPath = job.run_dir
            ? path.join(job.run_dir, "todos.json")
            : null;
          if (todoPath) {
            const onProgress = (progress: TodoProgress) => {
              this.config.onJobProgress?.(job.id, progress)
            }
            resumeMcpServers["todo"] = createTodoServer(
              todoPath,
              undefined,
              undefined,
              onProgress,
            );
          }
          if (this.config.visualService) {
            resumeMcpServers["chart-tools"] = createChartServer({
              visualService: this.config.visualService,
            });
            resumeMcpServers["image-fetch-tools"] = createImageFetchServer({
              visualService: this.config.visualService,
            });
          }

          const query = createBrainQuery(userInput, {
            model,
            resume: effectiveSessionId,
            cwd: job.run_dir,
            tools: WORKER_TOOLS,
            settingSources: ["project"],
            additionalDirectories: [this.config.agentDir],
            mcpServers:
              Object.keys(resumeMcpServers).length > 0
                ? resumeMcpServers
                : undefined,
            hooks: this.buildJobHooks(
              job.run_dir ? path.join(job.run_dir, "todos.json") : null,
              this.config.visualService
                ? (image, metadata) => {
                    const ss = this.config.visualService!.store(image, metadata);
                    return { id: ss.id, filename: ss.filename };
                  }
                : undefined,
            ),
            includePartialMessages: false,
          });

          // Iterate and collect response
          let response = "";
          let newSessionId: string | null = null;
          const resumeAbort = new AbortController();
          this.abortControllers.set(job.id, resumeAbort);

          for await (const msg of query) {
            if (resumeAbort.signal.aborted) {
              console.log(`[AutomationExecutor] Job ${job.id} aborted by user (resume path)`);
              break;
            }

            if (
              msg.type === "system" &&
              (msg as any).subtype === "init" &&
              (msg as any).session_id
            ) {
              newSessionId = (msg as any).session_id;
            }

            if (msg.type === "assistant") {
              const textBlocks = (msg as any).message.content.filter(
                (block: { type: string }) => block.type === "text",
              );
              for (const block of textBlocks) {
                if ("text" in block) {
                  response += block.text;
                }
              }
            }
          }

          this.abortControllers.delete(job.id);

          if (resumeAbort.signal.aborted) {
            return { success: false, status: "failed", error: "Stopped by user" };
          }

          // Detect silent fresh session — SDK doesn't throw on failed resume
          if (
            effectiveSessionId &&
            newSessionId &&
            newSessionId !== effectiveSessionId
          ) {
            console.log(
              `[AutomationExecutor] Resume detection: fresh session ${newSessionId} created instead of resuming ${effectiveSessionId} for job ${job.id}. Worker will verify completed work from todo list.`,
            );
          } else if (effectiveSessionId && newSessionId === null) {
            console.log(
              `[AutomationExecutor] Resume detection: no session_id in init message for job ${job.id}. Treating as fresh session.`,
            );
          }

          const { work, deliverable } = extractDeliverable(response);
          const summary = resolveJobSummary(job.run_dir, deliverable ?? work);

          // Store updated session ID in sidecar
          const finalSessionId = newSessionId ?? effectiveSessionId;
          if (finalSessionId) {
            this.config.jobService.storeSessionId(
              job.automationId,
              job.id,
              finalSessionId,
            );
          }

          // Check if the resumed session also requests review
          const hasNeedsReview =
            response.includes("needs_review") ||
            automation?.manifest.autonomy === "review";
          const finalStatus = hasNeedsReview ? "needs_review" : "completed";

          this.config.jobService.updateJob(job.id, {
            status: finalStatus,
            completed:
              finalStatus === "completed"
                ? new Date().toISOString()
                : undefined,
            summary,
            sdk_session_id: newSessionId ?? effectiveSessionId,
          });

          console.log(
            `[AutomationExecutor] Job ${job.id} resumed -> ${finalStatus}`,
          );

          return {
            success: finalStatus === "completed",
            status: finalStatus,
            summary,
          };
        } catch (resumeErr) {
          console.warn(
            `[AutomationExecutor] Session resume failed for job ${job.id}, marking as failed`,
            resumeErr,
          );
        }
      }

      // No session to resume — fail gracefully
      this.config.jobService.updateJob(job.id, {
        status: "failed",
        completed: new Date().toISOString(),
        summary: "Session resume failed — no stored session available",
      });

      return {
        success: false,
        status: "failed",
        error: "No session to resume",
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.config.jobService.updateJob(job.id, {
        status: "failed",
        completed: new Date().toISOString(),
        summary: `Resume failed: ${errorMsg}`,
      });
      return { success: false, status: "failed", error: errorMsg };
    }
  }

  private buildAutomationContext(
    automation: Automation,
    spaces: Space[],
    triggerContext?: Record<string, unknown>,
    todoItems: TodoItem[] = [],
  ): string {
    const sections: string[] = [];

    // Automation instructions
    sections.push(
      `## Automation: ${automation.manifest.name}\n\n${automation.instructions}`,
    );

    // Space manifests + I/O contracts
    for (const space of spaces) {
      let spaceSection = `### Space: ${space.name}\n`;
      if (space.description) spaceSection += space.description + "\n";
      if (space.io) {
        spaceSection += `\nI/O Contract:\n\`\`\`json\n${JSON.stringify(space.io, null, 2)}\n\`\`\`\n`;
      }
      if (space.maintenance) {
        spaceSection += `\nMaintenance Rules:\n${JSON.stringify(space.maintenance, null, 2)}\n`;
      }
      sections.push(spaceSection);
    }

    // Trigger context
    if (triggerContext) {
      sections.push(
        `## Trigger Context\n\`\`\`json\n${JSON.stringify(triggerContext, null, 2)}\n\`\`\``,
      );
    }

    // Autonomy instructions
    sections.push(
      this.getAutonomyInstructions(automation.manifest.autonomy ?? "full"),
    );

    // Progress Cadence — MUST be the last section. Recency placement is
    // deliberate (see M9.4-S6 spec). Omitted entirely for todo-less jobs.
    if (todoItems.length > 0) {
      sections.push(this.buildProgressCadenceSection(todoItems));
    }

    return sections.join("\n\n");
  }

  private buildProgressCadenceSection(todoItems: TodoItem[]): string {
    const inlined = todoItems
      .map((item) => `- [id: ${item.id}] ${item.text}`)
      .join("\n");

    return [
      "## Progress Cadence (read last — this matters)",
      "",
      "You have a todo list. The human watching this job sees a progress card that",
      "updates whenever you call the todo MCP tool. If you do work without calling",
      "the tool, the card sits silent — and silence feels like the job crashed.",
      "",
      "Narrating your progress is not a UI obligation. It is how methodical work",
      "looks. Announce each step, do it, close it, move to the next.",
      "",
      "**Your steps for this job:**",
      inlined,
      "",
      "**The rhythm — apply it for every step:**",
      "1. Call `todo_in_progress(<id>)` — BEFORE any other tool call for that step.",
      "2. Do the work for that step.",
      "3. Call `todo_done(<id>)` — IMMEDIATELY when the step is finished.",
      "4. Repeat for the next step.",
      "",
      "**The first tool call of this job MUST be `todo_in_progress` on your first step.**",
      "Not `Read`, not `Bash`, not `browser_*`, not a capability tool. `todo_in_progress`.",
      "",
      "**The last tool call before writing `deliverable.md` MUST be `todo_done` on your final step.**",
      "",
      "**Anti-patterns — do not do these:**",
      "- Do **not** batch todo updates at the end. Calling `todo_done` on three steps",
      "  in a row after all work is finished defeats the purpose.",
      "- Do **not** mark a step done before its work is actually complete.",
      "- Do **not** skip the `todo_in_progress` step because a task seems quick.",
      "  Quick steps still get announced.",
      "- Do **not** mark multiple steps in_progress simultaneously. One step at",
      "  a time.",
      "",
      "If you find yourself about to call a non-todo tool and your most recent",
      "todo call was `todo_done` (or there has been no todo call yet), pause —",
      "you owe a `todo_in_progress` first.",
    ].join("\n");
  }

  private getAutonomyInstructions(
    level: "full" | "cautious" | "review",
  ): string {
    switch (level) {
      case "full":
        return [
          "## Autonomy: Full",
          "Decide everything. Execute without asking.",
          "Log decisions in your status report.",
        ].join("\n");
      case "cautious":
        return [
          "## Autonomy: Cautious",
          "Execute most actions independently.",
          "For irreversible decisions (deleting files, sending external",
          "communications, spending money), stop and mark this job as",
          "needs_review with a clear question.",
        ].join("\n");
      case "review":
        return [
          "## Autonomy: Review",
          "Produce a plan only. Do NOT execute any actions.",
          "Write your proposed plan in the deliverable.",
          "Mark this job as needs_review.",
          "A human will approve before execution proceeds.",
        ].join("\n");
    }
  }

  /**
   * Write paper trail: append structured entry to DECISIONS.md at the target artifact path.
   * target_path comes from the automation manifest.
   * Non-fatal — failures are logged but don't affect job status.
   */
  private writePaperTrail(
    targetPath: string,
    deliverable: string,
    automation: Automation,
    job: Job,
  ): void {
    try {
      // Parse frontmatter for optional enrichment fields
      const { data } = parseFrontmatterContent<{
        change_type?: string;
        provider?: string;
        test_result?: string;
        test_duration_ms?: number;
        files_changed?: string[];
      }>(deliverable);

      const targetDir = path.resolve(this.config.agentDir, "..", targetPath);
      const decisionsPath = path.join(targetDir, "DECISIONS.md");
      const date = new Date().toISOString().slice(0, 10);
      const changeType = data.change_type ?? "unknown";

      // Build structured entry
      const lines: string[] = [];
      lines.push(`## ${date} — ${automation.manifest.name}`);
      lines.push(`- **Change type:** ${changeType}`);
      if (data.provider) lines.push(`- **Provider:** ${data.provider}`);
      if (data.test_result) {
        const latency = data.test_duration_ms
          ? ` (${(data.test_duration_ms / 1000).toFixed(1)}s)`
          : "";
        lines.push(`- **Test:** ${data.test_result}${latency}`);
      }
      if (data.files_changed?.length) {
        lines.push(`- **Files:** ${data.files_changed.join(", ")}`);
      }
      // Relative link from target to .runs/
      const runDirName = job.run_dir
        ? path.basename(path.dirname(job.run_dir)) +
          "/" +
          path.basename(job.run_dir)
        : job.id;
      lines.push(
        `- **Job:** [${runDirName}](../../automations/.runs/${runDirName}/)`,
      );

      const entry = lines.join("\n");

      if (fs.existsSync(decisionsPath)) {
        // Prepend after the "# Decisions" header
        const existing = fs.readFileSync(decisionsPath, "utf-8");
        const headerEnd = existing.indexOf("\n\n");
        if (headerEnd !== -1) {
          const header = existing.slice(0, headerEnd);
          const rest = existing.slice(headerEnd + 2);
          fs.writeFileSync(
            decisionsPath,
            `${header}\n\n${entry}\n\n${rest}`,
            "utf-8",
          );
        } else {
          fs.appendFileSync(decisionsPath, `\n\n${entry}\n`, "utf-8");
        }
      } else {
        // Create new DECISIONS.md
        fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });
        fs.writeFileSync(decisionsPath, `# Decisions\n\n${entry}\n`, "utf-8");
      }

      console.log(
        `[AutomationExecutor] Paper trail written to ${decisionsPath}`,
      );
    } catch (err) {
      console.warn("[AutomationExecutor] Paper trail write failed:", err);
    }
  }

  private buildUserMessage(automation: Automation): string {
    let message = `Execute automation: "${automation.manifest.name}"`;
    message += `\n\n${automation.instructions}`;

    return message;
  }
}
