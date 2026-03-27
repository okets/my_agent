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
} from "@my-agent/core";
import type {
  Automation,
  Job,
  HookEvent,
  HookCallbackMatcher,
  Space,
} from "@my-agent/core";
import { getHandler } from "../scheduler/jobs/handler-registry.js";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ConversationDatabase } from "../conversations/db.js";
import type { AutomationManager } from "./automation-manager.js";
import type { AutomationJobService } from "./automation-job-service.js";
import { buildWorkingNinaPrompt } from "./working-nina-prompt.js";
import { extractDeliverable } from "./deliverable-utils.js";

/** Working Nina's allowed tools — full access including web for research workers */
const WORKER_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "WebSearch", "WebFetch"];

export interface AutomationExecutorConfig {
  automationManager: AutomationManager;
  jobService: AutomationJobService;
  agentDir: string;
  db: ConversationDatabase;
  mcpServers?: Options["mcpServers"];
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
}

export interface ExecutionResult {
  success: boolean;
  work: string;
  deliverable: string | null;
  error?: string;
}

export class AutomationExecutor {
  private config: AutomationExecutorConfig;

  constructor(config: AutomationExecutorConfig) {
    this.config = config;
  }

  async run(
    automation: Automation,
    job: Job,
    triggerContext?: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    console.log(
      `[AutomationExecutor] Running automation "${automation.manifest.name}" (job ${job.id})`,
    );

    // Check for built-in handler (system automations)
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

        this.config.jobService.updateJob(job.id, {
          status: result.success ? "completed" : "failed",
          completed: new Date().toISOString(),
          summary: (result.deliverable ?? result.work).slice(0, 500),
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

      const automationContext = this.buildAutomationContext(
        automation,
        spaces,
        triggerContext,
      );

      const systemPrompt = `${basePrompt}\n\n${automationContext}`;

      // 3. Build user message
      const userMessage = this.buildUserMessage(automation);

      // 4. Execute query
      const query = createBrainQuery(userMessage, {
        model,
        systemPrompt,
        cwd: job.run_dir,
        tools: WORKER_TOOLS,
        settingSources: ["project"],
        additionalDirectories: [this.config.agentDir],
        mcpServers: this.config.mcpServers,
        hooks: this.config.hooks,
      });

      // 5. Iterate and collect response (follows TaskExecutor.iterateBrainQuery pattern)
      let response = "";
      let sdkSessionId: string | null = null;

      for await (const msg of query) {
        // Capture session ID from SDK init message
        if (
          msg.type === "system" &&
          (msg as any).subtype === "init" &&
          (msg as any).session_id
        ) {
          sdkSessionId = (msg as any).session_id;
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

      // 6. Extract deliverable
      const { work, deliverable } = extractDeliverable(response);

      // 7. Determine final status
      const hasNeedsReview =
        response.includes("needs_review") ||
        automation.manifest.autonomy === "review";

      const finalStatus = hasNeedsReview ? "needs_review" : "completed";

      // 8. Store session ID in sidecar file
      if (sdkSessionId) {
        this.config.jobService.storeSessionId(
          automation.id,
          job.id,
          sdkSessionId,
        );
      }

      // 9. Update job
      this.config.jobService.updateJob(job.id, {
        status: finalStatus,
        completed: new Date().toISOString(),
        summary: (deliverable ?? work).slice(0, 500),
        sdk_session_id: sdkSessionId ?? undefined,
      });

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

          const query = createBrainQuery(userInput, {
            model,
            resume: effectiveSessionId,
            cwd: job.run_dir,
            tools: WORKER_TOOLS,
            settingSources: ["project"],
            additionalDirectories: [this.config.agentDir],
            mcpServers: this.config.mcpServers,
            hooks: this.config.hooks,
            includePartialMessages: false,
          });

          // Iterate and collect response
          let response = "";
          let newSessionId: string | null = null;

          for await (const msg of query) {
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

          const { work, deliverable } = extractDeliverable(response);
          const summary = (deliverable ?? work).slice(0, 500);

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

    return sections.join("\n\n");
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

  private buildUserMessage(automation: Automation): string {
    let message = `Execute automation: "${automation.manifest.name}"`;
    message += `\n\n${automation.instructions}`;

    return message;
  }
}
