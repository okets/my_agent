/**
 * Task System — Task Executor
 *
 * Executes tasks with Agent SDK session continuity.
 * Handles status transitions, execution logging, and error handling.
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
import type { Task, ScheduledTaskContext } from "@my-agent/core";
import type { TranscriptTurn } from "../conversations/types.js";
import { TaskManager } from "./task-manager.js";
import { TaskLogStorage } from "./log-storage.js";

/**
 * Configuration for TaskExecutor
 */
export interface TaskExecutorConfig {
  taskManager: TaskManager;
  logStorage: TaskLogStorage;
  agentDir: string;
}

/**
 * Result of task execution
 */
export interface ExecutionResult {
  success: boolean;
  response: string;
  error?: string;
}

/**
 * TaskExecutor — runs tasks with session continuity
 */
export class TaskExecutor {
  private taskManager: TaskManager;
  private logStorage: TaskLogStorage;
  private agentDir: string;

  constructor(config: TaskExecutorConfig) {
    this.taskManager = config.taskManager;
    this.logStorage = config.logStorage;
    this.agentDir = config.agentDir;
  }

  /**
   * Run a task
   *
   * Handles the full execution lifecycle:
   * 1. Update status to 'running'
   * 2. Load prior context (for recurring tasks)
   * 3. Spawn brain query
   * 4. Append response to execution log
   * 5. Update status to 'completed' or 'failed'
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

      // 5. Append response to log
      const turnNumber = this.logStorage.getTurnCount(task.id) + 1;
      const timestamp = new Date().toISOString();

      // Log the user message (task instructions)
      const userTurn: TranscriptTurn = {
        type: "turn",
        role: "user",
        content: this.buildUserMessage(task),
        timestamp,
        turnNumber,
      };
      this.logStorage.appendTurn(task.id, userTurn);

      // Log the assistant response
      const assistantTurn: TranscriptTurn = {
        type: "turn",
        role: "assistant",
        content: response,
        timestamp: new Date().toISOString(),
        turnNumber,
      };
      this.logStorage.appendTurn(task.id, assistantTurn);

      // 6. Update status to completed
      this.taskManager.update(task.id, {
        status: "completed",
        completedAt: new Date(),
      });

      console.log(`[TaskExecutor] Task completed: "${task.title}"`);

      return {
        success: true,
        response,
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
        response: "",
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
      // Not a recurring task, no prior context
      return [];
    }

    // Get recent turns from this task's log
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
   */
  private buildUserMessage(task: Task): string {
    let message = `Task: "${task.title}"`;

    if (task.instructions) {
      message += `\n\n${task.instructions}`;
    }

    // If task has steps, include step execution instructions
    if (task.steps) {
      message += `\n\n## Steps to Complete\n\n${task.steps}`;
      message += `\n\n## Execution Rules

1. Work through each step in order
2. When you complete a step, output on its own line:
   ✓ STEP N: [step description]
3. Never skip steps. If blocked on a step, explain why before continuing.
4. After completing all steps, summarize the overall result.`;
    }

    return message;
  }

  /**
   * Execute the brain query
   */
  private async executeQuery(
    task: Task,
    priorContext: TranscriptTurn[],
  ): Promise<string> {
    // Load brain configuration
    const brainConfig = loadConfig();

    // Extract calendarId from sourceRef (format: "calendarId:uid")
    let calendarId = "system"; // Default fallback
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
      action: undefined, // Tasks don't use the action field directly
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

    // Build the full prompt including prior context
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

    // Spawn brain query
    // Note: Using continue: true for recurring tasks to maintain session
    const shouldContinue = !!task.recurrenceId && priorContext.length > 0;

    const query = createBrainQuery(fullPrompt, {
      model: brainConfig.model,
      systemPrompt,
      continue: shouldContinue,
      includePartialMessages: false,
    });

    // Collect response
    let response = "";
    for await (const msg of query) {
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

    return response;
  }
}
