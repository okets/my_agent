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
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ConversationDatabase } from "../conversations/db.js";
import type { AutomationManager } from "./automation-manager.js";
import type { AutomationJobService } from "./automation-job-service.js";
import { buildWorkingNinaPrompt } from "../tasks/working-nina-prompt.js";
import { extractDeliverable } from "../tasks/task-executor.js";

/** Working Nina's allowed tools */
const WORKER_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Skill",
];

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

      const basePrompt = await buildWorkingNinaPrompt(
        this.config.agentDir,
        {
          taskTitle: automation.manifest.name,
          taskId: automation.id,
          taskDir: job.run_dir,
        },
      );

      const automationContext = this.buildAutomationContext(
        automation,
        [],
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

      // 8. Update job
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

    // Deliverable instructions
    if (automation.manifest.delivery?.length) {
      message += `\n\n## Output Format

Complete the automation. Structure your response as follows:

First, write your reasoning, research, and analysis.

Then produce your final deliverable wrapped in XML tags:

<deliverable>
[Your standalone message goes here]
</deliverable>`;
    }

    return message;
  }
}
