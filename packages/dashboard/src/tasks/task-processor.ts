/**
 * Task System — Task Processor
 *
 * Event-driven processor for immediate task execution.
 * When a task is created, if it's an immediate task, execute it right away
 * and deliver the result to the source conversation.
 */

import type { Task } from "@my-agent/core";
import type { TaskManager } from "./task-manager.js";
import type { TaskExecutor, ExecutionResult } from "./task-executor.js";
import type { ConversationManager } from "../conversations/index.js";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import type { TranscriptTurn } from "../conversations/types.js";

export interface TaskProcessorConfig {
  taskManager: TaskManager;
  executor: TaskExecutor;
  conversationManager: ConversationManager;
  connectionRegistry: ConnectionRegistry;
}

/**
 * TaskProcessor — executes tasks and delivers results
 */
export class TaskProcessor {
  private taskManager: TaskManager;
  private executor: TaskExecutor;
  private conversationManager: ConversationManager;
  private connectionRegistry: ConnectionRegistry;

  constructor(config: TaskProcessorConfig) {
    this.taskManager = config.taskManager;
    this.executor = config.executor;
    this.conversationManager = config.conversationManager;
    this.connectionRegistry = config.connectionRegistry;
  }

  /**
   * Called when a task is created.
   * If immediate and pending, execute now.
   */
  async onTaskCreated(task: Task): Promise<void> {
    if (task.type === "immediate" && task.status === "pending") {
      console.log(
        `[TaskProcessor] Immediate task created, executing: ${task.title}`,
      );
      // Execute asynchronously so we don't block the API response
      this.executeAndDeliver(task).catch((err) => {
        console.error(
          `[TaskProcessor] Failed to execute task ${task.id}:`,
          err,
        );
      });
    }
  }

  /**
   * Execute a task and deliver results.
   * Public so TaskScheduler can also use it.
   */
  async executeAndDeliver(task: Task): Promise<void> {
    const result = await this.executor.run(task);
    await this.deliverResult(task, result);
  }

  /**
   * Deliver task result to the source conversation
   */
  private async deliverResult(
    task: Task,
    result: ExecutionResult,
  ): Promise<void> {
    // Find linked conversation (source)
    const links = this.taskManager.getConversationsForTask(task.id);
    if (links.length === 0) {
      console.log(
        `[TaskProcessor] Task ${task.id} has no linked conversation, skipping result delivery`,
      );
      return;
    }

    const conversationId = links[0].conversationId;

    // Format the result message
    const messageContent = this.formatResult(task, result);

    // Append to conversation transcript
    const conversation = await this.conversationManager.get(conversationId);
    if (!conversation) {
      console.warn(
        `[TaskProcessor] Conversation ${conversationId} not found for result delivery`,
      );
      return;
    }

    const turnNumber = conversation.turnCount + 1;
    const timestamp = new Date().toISOString();

    const turn: TranscriptTurn = {
      type: "turn",
      role: "assistant",
      content: messageContent,
      timestamp,
      turnNumber,
    };

    await this.conversationManager.appendTurn(conversationId, turn);
    console.log(
      `[TaskProcessor] Result delivered to conversation ${conversationId}`,
    );

    // Broadcast via WebSocket
    this.broadcastResult(conversationId, task, result);
  }

  /**
   * Format task result for display
   */
  private formatResult(task: Task, result: ExecutionResult): string {
    if (result.success) {
      return `**Task Completed: ${task.title}**\n\n${result.response}`;
    } else {
      return `**Task Failed: ${task.title}**\n\nError: ${result.error || "Unknown error"}`;
    }
  }

  /**
   * Broadcast task result via WebSocket
   */
  private broadcastResult(
    conversationId: string,
    task: Task,
    result: ExecutionResult,
  ): void {
    // Broadcast to all clients viewing this conversation
    this.connectionRegistry.broadcastToConversation(conversationId, {
      type: "task:result",
      taskId: task.id,
      conversationId,
      success: result.success,
      response: result.response,
      error: result.error,
    } as any);

    // Also broadcast a chat:turn event so the UI updates
    this.connectionRegistry.broadcastToConversation(conversationId, {
      type: "chat:turn",
      turn: {
        role: "assistant",
        content: this.formatResult(task, result),
        timestamp: new Date().toISOString(),
        model: "task-executor",
      },
    } as any);
  }
}
