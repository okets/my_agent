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
  McpCapabilityCfrDetector,
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
  CfrEmitter,
  AutomationSessionContext,
  AckDelivery,
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
import { createChartServer } from "../mcp/chart-server.js";
import { createImageFetchServer } from "../mcp/image-fetch-server.js";
import { createTodoServer, type TodoProgress } from "../mcp/todo-server.js";
import { createEmptyTodoFile, readTodoFile, writeTodoFile } from "./todo-file.js";
import { assembleJobTodos } from "./todo-templates.js";
import { runValidation } from "./todo-validators.js";
import { resolveJobSummary } from "./summary-resolver.js";

/**
 * M9.4-S4.2-fu3: read and validate the worker's `deliverable.md` at job-end.
 *
 * Replaces the f4f5d83 (Apr 1) auto-write fallback and the 697ab41 (Apr 6)
 * `startsWith("---")` frontmatter guard. Both were correct for contracts that
 * no longer exist in production:
 *   - The XML-tag contract (`<deliverable>...</deliverable>`) was abandoned
 *     when modern templates moved to Write tool.
 *   - The frontmatter requirement was capability_*-specific and never
 *     extended when generic/research workers became first-class.
 *
 * Today's contract: workers write `deliverable.md` directly via the Write
 * tool. Plain markdown. The on-disk file IS the deliverable. The framework
 * reads it, validates it once more (defense in depth against any worker that
 * bypassed the todo-runtime validator), and returns it for downstream
 * consumers (notification queue, chart augmentation, etc.).
 *
 * @throws if `deliverable.md` is missing — fails loud rather than fabricating
 *         from the response stream.
 * @throws if the final-gate validator detects narration contamination —
 *         catches workers that bypassed the todo-update MCP path.
 */
export function readAndValidateWorkerDeliverable(runDir: string): string {
  const deliverablePath = path.join(runDir, "deliverable.md");
  if (!fs.existsSync(deliverablePath)) {
    throw new Error(
      `Worker did not write deliverable.md to ${runDir}. ` +
        `Check ${runDir}/todos.json for validation_attempts. ` +
        `The worker likely skipped or short-circuited the deliverable-emit step.`,
    );
  }
  const content = fs.readFileSync(deliverablePath, "utf-8");

  // Defense in depth: re-run the validator at job-end. Catches any worker
  // that bypassed the todo_update MCP path (Hypothesis H2 from the bug
  // record). Cheap regex check on a file already on disk.
  const finalCheck = runValidation("deliverable_written", runDir);
  if (!finalCheck.pass) {
    throw new Error(
      `Final validator gate failed for ${runDir}: ${finalCheck.message}. ` +
        `This indicates the worker bypassed the todo-runtime validator.`,
    );
  }

  return content;
}

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
  /**
   * M9.6-S12 — CFR emitter wired to the recovery orchestrator. When present
   * (with `capabilityRegistry`), the executor attaches a per-job
   * McpCapabilityCfrDetector to the job's SDK hooks and calls
   * `processSystemInit()` on the init frame of the for-await message loop.
   */
  cfr?: CfrEmitter;
  /**
   * M9.6-S24 Task 6 — AckDelivery instance, passed through to built-in
   * handlers (specifically `debrief-reporter`) so they can read the
   * system-origin CFR ring buffer for the System Health brief section.
   * Optional: absent when AckDelivery has not yet been constructed
   * (fresh install pre-TransportManager).
   */
  ackDelivery?: AckDelivery;
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

  /**
   * M9.6-S12 — per-job session context map, keyed by SDK `session_id`.
   * Populated when the SDK's `system.init` event fires inside `run()`; cleared
   * in `run()`'s `finally` block. Consumed by the McpCapabilityCfrDetector's
   * originFactory for automation-origin plug failures.
   */
  private sessionContexts = new Map<string, AutomationSessionContext>();

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

  /**
   * M9.6-S12 — look up the AutomationSessionContext for a given SDK session_id.
   * Returns `undefined` when the session is not currently tracked. Used by the
   * McpCapabilityCfrDetector's originFactory (which throws on `undefined`,
   * per D1).
   */
  getSessionContext(
    sessionId: string,
  ): AutomationSessionContext | undefined {
    return this.sessionContexts.get(sessionId);
  }

  /** Merge per-job Stop + PostToolUse hooks into static config hooks */
  private buildJobHooks(
    todoPath: string | null,
    vasStore?: StoreCallback,
    detector?: McpCapabilityCfrDetector,
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

    // M9.6-S12 — MCP CFR detector hooks: PostToolUseFailure (Modes 1+2) +
    // PostToolUse empty-result check. Merged with any existing hooks on the
    // same events rather than overwriting. The Mode-3 `processSystemInit()`
    // path is invoked from `run()`'s message loop, not from a hook.
    if (detector) {
      for (const [event, matchers] of Object.entries(detector.hooks) as [
        HookEvent,
        HookCallbackMatcher[] | undefined,
      ][]) {
        if (!matchers) continue;
        hooks[event] = [...(hooks[event] ?? []), ...matchers];
      }
    }

    return hooks;
  }

  /**
   * M9.6-S12 — resolve a manifest's notify mode for the AutomationSessionContext.
   * Missing / invalid values default to `"debrief"` per D2.
   *
   * NOTE: the manifest field is `notify` (see AutomationManifest); the
   * SessionContext field is `notifyMode` to disambiguate it from the runtime
   * notification callback on the context object.
   */
  private resolveNotifyMode(
    manifest: Automation["manifest"],
  ): "immediate" | "debrief" | "none" {
    const m = manifest.notify;
    if (m === "immediate" || m === "debrief" || m === "none") return m;
    return "debrief";
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
          runDir: job.run_dir ?? undefined,
          ackDelivery: this.config.ackDelivery,
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

    // M9.6-S12 — track the session_id across the try/catch/finally so the
    // cleanup block can remove the AutomationSessionContext regardless of
    // which exit path fires.
    let trackedSessionId: string | null = null;

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
          agentDir: this.config.agentDir,
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

      // M9.6-S12 — per-job McpCapabilityCfrDetector. Instantiated only when
      // both CFR emitter and capability registry are wired (e.g. not in some
      // unit tests). The originFactory closes over `jobSessionId` captured
      // when the SDK's init frame arrives (below).
      let jobSessionId: string | null = null;
      let detector: McpCapabilityCfrDetector | undefined;
      if (this.config.cfr && this.config.capabilityRegistry) {
        const sessionContexts = this.sessionContexts;
        detector = new McpCapabilityCfrDetector({
          cfr: this.config.cfr,
          registry: this.config.capabilityRegistry,
          originFactory: () => {
            if (!jobSessionId) {
              throw new Error(
                "[McpCfrDetector] originFactory called with no active SDK session (automation)",
              );
            }
            const ctx = sessionContexts.get(jobSessionId);
            if (!ctx) {
              throw new Error(
                `[McpCfrDetector] No AutomationSessionContext for session_id "${jobSessionId}" — ` +
                  "this is a programming error: originFactory called outside an active session",
              );
            }
            return {
              kind: "automation",
              automationId: ctx.automationId,
              jobId: ctx.jobId,
              runDir: ctx.runDir,
              notifyMode: ctx.notifyMode,
            };
          },
        });
      }

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
        hooks: this.buildJobHooks(todoPath, vasStore, detector),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      });

      // 6. Iterate and collect response (follows TaskExecutor.iterateBrainQuery pattern)
      let response = "";
      let sdkSessionId: string | null = null;
      const abortController = new AbortController();
      this.abortControllers.set(job.id, abortController);

      // M9.6-S12 — snapshot the notify mode for this job's AutomationSessionContext.
      const notifyMode = this.resolveNotifyMode(automation.manifest);

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
          jobSessionId = sdkSessionId;
          trackedSessionId = sdkSessionId;
          // M9.6-S12 — populate the session context map so the detector's
          // originFactory resolves to the correct AutomationSessionContext.
          if (sdkSessionId) {
            this.sessionContexts.set(sdkSessionId, {
              kind: "automation",
              automationId: automation.id,
              jobId: job.id,
              runDir: job.run_dir ?? "",
              notifyMode,
            });
          }
          // M9.6-S12 — Mode-3 MCP detection from the init frame.
          detector?.processSystemInit(msg);
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

      // 7. Worker run complete. The worker MUST have written deliverable.md
      //    via the Write tool during its run. We do not extract from the
      //    response stream, do not merge, do not overwrite — the on-disk file
      //    is the source of truth from this point forward.
      //    M9.4-S4.2-fu3: replaces the f4f5d83 (Apr 1) auto-write fallback
      //    and the 697ab41 (Apr 6) startsWith("---") guard. Both were
      //    correct for contracts that no longer exist in production. See
      //    docs/sprints/m9.4-s4.2-action-request-delivery/worker-pipeline-history.md
      //    M9.4-S4.3: post-run chart augmentation deleted. Workers self-serve
      //    via chart_tools.create_chart and embed the URL inline when writing.
      let deliverablePath: string | undefined;
      let finalDeliverable: string | undefined;
      if (job.run_dir) {
        deliverablePath = path.join(job.run_dir, "deliverable.md");
        finalDeliverable = readAndValidateWorkerDeliverable(job.run_dir);
      }
      if (unsubscribe) unsubscribe();

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
        summary: todoGatingSummary ?? resolveJobSummary(job.run_dir, finalDeliverable ?? response),
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
        work: response,
        deliverable: finalDeliverable ?? null,
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
      // M9.6-S12 — clear AutomationSessionContext for this job's SDK session.
      // Guaranteed to run on success, error, and abort.
      if (trackedSessionId) {
        this.sessionContexts.delete(trackedSessionId);
      }
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
              agentDir: this.config.agentDir,
            });
          }

          // M9.6-S12 — per-resume McpCapabilityCfrDetector (same shape as
          // `run()`). Resumes from a needs_review checkpoint also need MCP
          // plug-failure detection for any tool calls the resumed turn makes.
          let resumeJobSessionId: string | null = null;
          let resumeDetector: McpCapabilityCfrDetector | undefined;
          if (this.config.cfr && this.config.capabilityRegistry && automation) {
            const sessionContexts = this.sessionContexts;
            resumeDetector = new McpCapabilityCfrDetector({
              cfr: this.config.cfr,
              registry: this.config.capabilityRegistry,
              originFactory: () => {
                if (!resumeJobSessionId) {
                  throw new Error(
                    "[McpCfrDetector] originFactory called with no active SDK session (automation resume)",
                  );
                }
                const ctx = sessionContexts.get(resumeJobSessionId);
                if (!ctx) {
                  throw new Error(
                    `[McpCfrDetector] No AutomationSessionContext for session_id "${resumeJobSessionId}"`,
                  );
                }
                return {
                  kind: "automation",
                  automationId: ctx.automationId,
                  jobId: ctx.jobId,
                  runDir: ctx.runDir,
                  notifyMode: ctx.notifyMode,
                };
              },
            });
          }
          const resumeNotifyMode = automation
            ? this.resolveNotifyMode(automation.manifest)
            : "debrief";

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
              resumeDetector,
            ),
            includePartialMessages: false,
          });

          // Iterate and collect response
          let response = "";
          let newSessionId: string | null = null;
          let trackedResumeSessionId: string | null = null;
          const resumeAbort = new AbortController();
          this.abortControllers.set(job.id, resumeAbort);

          try {
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
                resumeJobSessionId = newSessionId;
                trackedResumeSessionId = newSessionId;
                if (newSessionId) {
                  this.sessionContexts.set(newSessionId, {
                    kind: "automation",
                    automationId: automation?.id ?? job.automationId,
                    jobId: job.id,
                    runDir: job.run_dir ?? "",
                    notifyMode: resumeNotifyMode,
                  });
                }
                resumeDetector?.processSystemInit(msg);
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
          } finally {
            if (trackedResumeSessionId) {
              this.sessionContexts.delete(trackedResumeSessionId);
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

          // M9.4-S4.2-fu3: resume path. Worker's deliverable.md (if it
          // exists) is read by resolveJobSummary; we pass `response` only
          // as the fallback for when no deliverable.md was written.
          const summary = resolveJobSummary(job.run_dir, response);

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
      "**Write `deliverable.md` first via the Write tool, then call `todo_done` on the deliverable-emit step.** The `deliverable_written` validator runs when you mark the step done — it reads the file you just wrote, so the file MUST exist before you mark the todo done.",
      "",
      "**If your deliverable has numeric data worth visualizing**, call `chart_tools.create_chart` (when available) and embed the returned URL inline as `![chart](url)` in `deliverable.md` when you write it. The framework does not augment your deliverable after the fact — what you write is what the user sees.",
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
