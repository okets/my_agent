/**
 * Task System — Task Executor
 *
 * Executes tasks with Agent SDK session continuity.
 * Produces structured output: work log + deliverable.
 */

import {
  createBrainQuery,
  loadConfig,
  assembleSystemPrompt,
  assembleCalendarContext,
  createCalDAVClient,
  loadCalendarConfig,
  loadCalendarCredentials,
} from "@my-agent/core";
import type {
  Task,
  ScheduledTaskContext,
  DeliveryAction,
} from "@my-agent/core";
import type { TranscriptTurn } from "../conversations/types.js";
import type { ConversationDatabase } from "../conversations/db.js";
import { TaskManager } from "./task-manager.js";
import { TaskLogStorage } from "./log-storage.js";

/**
 * Configuration for TaskExecutor
 */
export interface TaskExecutorConfig {
  taskManager: TaskManager;
  logStorage: TaskLogStorage;
  agentDir: string;
  /** Database for reading/writing SDK session IDs (M6.5-S2 session resumption) */
  db: ConversationDatabase;
}

/**
 * Result of task execution
 */
export interface ExecutionResult {
  success: boolean;
  /** Full work log (reasoning, research, analysis) */
  work: string;
  /** Clean deliverable content extracted from <deliverable> tags (null if none) */
  deliverable: string | null;
  error?: string;
}

/**
 * Extract deliverable content from brain response
 */
export function extractDeliverable(response: string): {
  work: string;
  deliverable: string | null;
} {
  const match = response.match(/<deliverable>([\s\S]*?)<\/deliverable>/);
  if (match) {
    const deliverable = match[1].trim();
    const work = response.replace(match[0], "").trim();
    return { work, deliverable: deliverable || null };
  }
  return { work: response, deliverable: null };
}

/**
 * Validate that the deliverable is suitable for delivery
 */
export function validateDeliverable(
  deliverable: string | null,
  hasDeliveryActions: boolean,
): { valid: boolean; reason?: string } {
  if (!hasDeliveryActions) return { valid: true };
  if (deliverable === null)
    return { valid: false, reason: "Deliverable tags missing from response" };
  if (deliverable.trim() === "")
    return { valid: false, reason: "Deliverable is empty" };
  if (deliverable.trim().toUpperCase() === "NONE")
    return {
      valid: false,
      reason: "Brain declined to produce deliverable",
    };
  return { valid: true };
}

/**
 * Get channel constraints text for the brain prompt
 */
function getChannelConstraints(delivery: DeliveryAction[]): string {
  if (delivery.length === 0) return "";

  const channels = [...new Set(delivery.map((d) => d.channel))];
  const constraints: string[] = [];

  for (const channel of channels) {
    switch (channel) {
      case "whatsapp":
        constraints.push(
          "Your deliverable will be sent via WhatsApp. Plain text only. Use *bold* sparingly. Keep under 2000 chars. No markdown headers, code blocks, or bullet dashes.",
        );
        break;
      case "email":
        constraints.push(
          "Your deliverable will be sent via email. Rich formatting OK. Headers, lists, longer content all fine.",
        );
        break;
      case "dashboard":
        constraints.push(
          "Your deliverable will be shown on the dashboard. Full markdown supported.",
        );
        break;
    }
  }

  return constraints.join("\n");
}

/**
 * TaskExecutor — runs tasks with session continuity
 */
export class TaskExecutor {
  private taskManager: TaskManager;
  private logStorage: TaskLogStorage;
  private agentDir: string;
  private db: ConversationDatabase;

  constructor(config: TaskExecutorConfig) {
    this.taskManager = config.taskManager;
    this.logStorage = config.logStorage;
    this.agentDir = config.agentDir;
    this.db = config.db;
  }

  /**
   * Run a task
   *
   * Handles the full execution lifecycle:
   * 1. Update status to 'running'
   * 2. Load prior context (for recurring tasks)
   * 3. Spawn brain query
   * 4. Extract deliverable from response
   * 5. Append response to execution log
   * 6. Update status to 'completed' or 'failed'
   */
  async run(task: Task): Promise<ExecutionResult> {
    const now = new Date();

    console.log(`[TaskExecutor] Running task: "${task.title}" (${task.id})`);

    // 1. Update status to running
    this.taskManager.update(task.id, {
      status: "running",
      startedAt: now,
    });

    // 2. Ensure log file exists
    if (!this.logStorage.exists(task.id)) {
      this.logStorage.createLog(task.id, task.sessionId, task.title);
    }

    try {
      // 3. Load prior context for recurring tasks
      const priorContext = await this.loadPriorContext(task);

      // 4. Assemble prompt and execute
      const response = await this.executeQuery(task, priorContext);

      // 5. Extract deliverable from response
      const hasDeliveryActions = (task.delivery ?? []).some(
        (d) => d.status === "pending" && !d.content,
      );
      const { work, deliverable } = extractDeliverable(response);

      // 6. Append to log
      const turnNumber = this.logStorage.getTurnCount(task.id) + 1;
      const timestamp = new Date().toISOString();

      const userTurn: TranscriptTurn = {
        type: "turn",
        role: "user",
        content: this.buildUserMessage(task),
        timestamp,
        turnNumber,
      };
      this.logStorage.appendTurn(task.id, userTurn);

      const assistantTurn: TranscriptTurn = {
        type: "turn",
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
        turnNumber,
      };
      this.logStorage.appendTurn(task.id, assistantTurn);

      // 7. Validate deliverable
      const validation = validateDeliverable(deliverable, hasDeliveryActions);
      if (!validation.valid) {
        console.warn(
          `[TaskExecutor] Deliverable validation failed for "${task.title}": ${validation.reason}`,
        );
        this.taskManager.update(task.id, {
          status: "needs_review",
        });
        return {
          success: false,
          work,
          deliverable: null,
          error: validation.reason,
        };
      }

      // 8. Update status to completed
      this.taskManager.update(task.id, {
        status: "completed",
        completedAt: new Date(),
      });

      console.log(`[TaskExecutor] Task completed: "${task.title}"`);

      return {
        success: true,
        work,
        deliverable,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(`[TaskExecutor] Task failed: "${task.title}"`, error);

      // Log the error
      this.logStorage.appendEvent(task.id, {
        type: "event",
        event: "meta_update",
        timestamp: new Date().toISOString(),
        topics: ["error", errorMessage],
      });

      // Update status to failed
      this.taskManager.update(task.id, {
        status: "failed",
        completedAt: new Date(),
      });

      return {
        success: false,
        work: "",
        deliverable: null,
        error: errorMessage,
      };
    }
  }

  /**
   * Load prior context from execution log for recurring tasks.
   * Returns recent turns to inject as conversation history.
   */
  private async loadPriorContext(task: Task): Promise<TranscriptTurn[]> {
    if (!task.recurrenceId) {
      return [];
    }

    const recentTurns = this.logStorage.getRecentTurns(task.id, 10);

    if (recentTurns.length > 0) {
      console.log(
        `[TaskExecutor] Loaded ${recentTurns.length} prior turns for recurring task`,
      );
    }

    return recentTurns;
  }

  /**
   * Build the user message for the task
   *
   * Uses the Work + Deliverable template:
   * - Work items as bullet list
   * - Deliverable instructions with <deliverable> XML tags
   * - Channel-specific constraints auto-injected
   */
  private buildUserMessage(task: Task): string {
    const deliveryActions = (task.delivery ?? []).filter(
      (d) => d.status === "pending" && !d.content,
    );
    const workItems = task.work ?? [];

    let message = `Task: "${task.title}"`;

    if (task.instructions) {
      message += `\n\n${task.instructions}`;
    }

    // Work items
    if (workItems.length > 0) {
      message += "\n\n## Work Items\n";
      for (const item of workItems) {
        message += `\n- ${item.description}`;
      }
    }

    // Deliverable instructions (only if there are delivery actions needing content)
    if (deliveryActions.length > 0) {
      message += `\n\n## Output Format

Complete the work items above. Structure your response as follows:

First, write your reasoning, research, and analysis. This working section is logged internally and shown on the dashboard, but is NOT sent to anyone.

Then produce your final deliverable wrapped in XML tags:

<deliverable>
[Your standalone message for the recipient goes here]
</deliverable>

Rules for the deliverable:
- The recipient sees ONLY the content inside the tags. Nothing else.
- Write a complete, standalone message. The recipient has no other context.
- Do not include preamble ("Here are the results:", "I found:", etc.)
- Do not include task metadata, step numbers, or internal reasoning.
- Do not reference these instructions or the task itself.`;

      // Channel constraints
      const channelConstraints = getChannelConstraints(deliveryActions);
      if (channelConstraints) {
        message += `\n\n${channelConstraints}`;
      }

      message += `\n\nIf you cannot produce a deliverable (safety concern, insufficient information, or ethical issue), output exactly:
<deliverable>NONE</deliverable>
Explain your reason in the working section above.`;
    }

    return message;
  }

  /**
   * Execute the brain query
   *
   * Uses SDK session resumption for recurring tasks that have a stored session ID.
   * Falls back to text-injected prior context for first executions.
   */
  private async executeQuery(
    task: Task,
    priorContext: TranscriptTurn[],
  ): Promise<string> {
    // Load brain configuration
    const brainConfig = loadConfig();

    // Check for stored SDK session ID (M6.5-S2: native session resumption)
    const storedSessionId = this.db.getTaskSdkSessionId(task.id);

    // Try resume path first, fall back to fresh if stale
    if (storedSessionId) {
      try {
        return await this.iterateBrainQuery(
          task,
          this.buildResumeQuery(task, brainConfig, storedSessionId),
        );
      } catch (resumeError) {
        console.warn(
          `[TaskExecutor] SDK session resume failed (${storedSessionId}) for task "${task.title}", falling back to fresh session: ${resumeError instanceof Error ? resumeError.message : String(resumeError)}`,
        );
        // Clear stale session ID so next execution starts fresh
        this.db.updateTaskSdkSessionId(task.id, null);
      }
    }

    // Fresh execution — build full system prompt with context
    const freshQuery = await this.buildFreshQuery(
      task,
      brainConfig,
      priorContext,
    );
    return this.iterateBrainQuery(task, freshQuery);
  }

  /**
   * Build a resume query for an existing SDK session.
   */
  private buildResumeQuery(
    task: Task,
    brainConfig: { model: string; compaction?: boolean },
    sessionId: string,
  ) {
    console.log(
      `[TaskExecutor] Resuming SDK session ${sessionId} for task "${task.title}"`,
    );

    return createBrainQuery(this.buildUserMessage(task), {
      model: brainConfig.model,
      resume: sessionId,
      includePartialMessages: false,
      compaction: brainConfig.compaction ?? true,
    });
  }

  /**
   * Build a fresh query with full system prompt and prior context.
   */
  private async buildFreshQuery(
    task: Task,
    brainConfig: { model: string; brainDir: string },
    priorContext: TranscriptTurn[],
  ) {
    // Extract calendarId from sourceRef (format: "calendarId:uid")
    let calendarId = "system";
    if (task.sourceType === "caldav" && task.sourceRef) {
      const colonIndex = task.sourceRef.indexOf(":");
      if (colonIndex > 0) {
        calendarId = task.sourceRef.substring(0, colonIndex);
      }
    }

    // Build scheduled task context for prompt
    const scheduledTaskContext: ScheduledTaskContext = {
      title: task.title,
      start: task.scheduledFor?.toISOString() ?? new Date().toISOString(),
      calendarId,
      action: undefined,
    };

    // Try to assemble calendar context
    let calendarContext: string | undefined;
    try {
      const calConfig = loadCalendarConfig(this.agentDir);
      const credentials = loadCalendarCredentials(this.agentDir);

      if (calConfig && credentials) {
        const calendarRepo = createCalDAVClient(calConfig, credentials);
        calendarContext = await assembleCalendarContext(calendarRepo);
      }
    } catch (err) {
      console.warn(
        `[TaskExecutor] Calendar context unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Assemble system prompt
    const systemPrompt = await assembleSystemPrompt(brainConfig.brainDir, {
      calendarContext,
      scheduledTaskContext,
    });

    // Build the full prompt including prior context (text injection fallback)
    let fullPrompt = "";

    if (priorContext.length > 0) {
      fullPrompt += "Prior context from this recurring task:\n\n";
      for (const turn of priorContext) {
        const role = turn.role === "user" ? "User" : "Assistant";
        fullPrompt += `${role}: ${turn.content}\n\n`;
      }
      fullPrompt += "---\n\nCurrent execution:\n\n";
    }

    fullPrompt += this.buildUserMessage(task);

    // Spawn brain query — fresh session
    return createBrainQuery(fullPrompt, {
      model: brainConfig.model,
      systemPrompt,
      includePartialMessages: false,
    });
  }

  /**
   * Iterate a brain query, collecting response text and capturing the SDK session ID.
   */
  private async iterateBrainQuery(
    task: Task,
    brainQuery: ReturnType<typeof createBrainQuery>,
  ): Promise<string> {
    let response = "";
    let sdkSessionId: string | null = null;

    for await (const msg of brainQuery) {
      // Capture session ID from SDK init message
      if (
        msg.type === "system" &&
        (msg as any).subtype === "init" &&
        (msg as any).session_id
      ) {
        sdkSessionId = (msg as any).session_id;
      }

      if (msg.type === "assistant") {
        const textBlocks = msg.message.content.filter(
          (block: { type: string }) => block.type === "text",
        );
        for (const block of textBlocks) {
          if ("text" in block) {
            response += block.text;
          }
        }
      }
    }

    // Persist SDK session ID for future resumption
    if (sdkSessionId) {
      this.db.updateTaskSdkSessionId(task.id, sdkSessionId);
      console.log(
        `[TaskExecutor] Stored SDK session ${sdkSessionId} for task "${task.title}"`,
      );
    }

    return response;
  }
}
