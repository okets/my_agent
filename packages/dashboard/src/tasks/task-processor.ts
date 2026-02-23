/**
 * Task System — Task Processor
 *
 * Event-driven processor for immediate task execution.
 * When a task is created, if it's an immediate task, execute it right away
 * and deliver the result to the source conversation.
 */

import type { Task, NotificationService } from "@my-agent/core";
import type { TaskManager } from "./task-manager.js";
import type { TaskExecutor, ExecutionResult } from "./task-executor.js";
import type { ConversationManager } from "../conversations/index.js";
import type { ConnectionRegistry } from "../ws/connection-registry.js";
import type { TranscriptTurn } from "../conversations/types.js";
import type { ChannelManager } from "../channels/index.js";
import { DeliveryExecutor } from "./delivery-executor.js";

export interface TaskProcessorConfig {
  taskManager: TaskManager;
  executor: TaskExecutor;
  conversationManager: ConversationManager;
  connectionRegistry: ConnectionRegistry;
  channelManager?: ChannelManager | null;
  notificationService?: NotificationService | null;
  /** Optional callback fired after any task status mutation (for state publishing) */
  onTaskMutated?: () => void;
}

/**
 * TaskProcessor — executes tasks and delivers results
 */
export class TaskProcessor {
  private taskManager: TaskManager;
  private executor: TaskExecutor;
  private conversationManager: ConversationManager;
  private connectionRegistry: ConnectionRegistry;
  private deliveryExecutor: DeliveryExecutor;
  private notificationService: NotificationService | null;
  private onTaskMutated: (() => void) | null;

  constructor(config: TaskProcessorConfig) {
    this.taskManager = config.taskManager;
    this.executor = config.executor;
    this.conversationManager = config.conversationManager;
    this.connectionRegistry = config.connectionRegistry;
    this.deliveryExecutor = new DeliveryExecutor(
      config.channelManager ?? null,
      config.conversationManager,
    );
    this.notificationService = config.notificationService ?? null;
    this.onTaskMutated = config.onTaskMutated ?? null;
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
    const hasDeliveryActions = (task.delivery ?? []).some(
      (d) => d.status === "pending",
    );
    const hasPreComposedOnly =
      hasDeliveryActions &&
      (task.delivery ?? [])
        .filter((d) => d.status === "pending")
        .every((d) => d.content);

    // If all delivery actions have pre-composed content, skip brain entirely
    if (hasPreComposedOnly) {
      console.log(
        `[TaskProcessor] Pre-composed delivery, skipping brain for: ${task.title}`,
      );

      const deliveryResult = await this.deliveryExecutor.executeDeliveryActions(
        task,
        "",
      );

      // Update delivery action statuses
      this.updateDeliveryStatuses(task.id, deliveryResult.results);

      // Mark task as completed
      this.taskManager.update(task.id, {
        status: "completed",
        completedAt: new Date(),
      });
      this.onTaskMutated?.();

      await this.deliverResult(task, {
        success: true,
        work: "Pre-composed message delivered.",
        deliverable: null,
      });
      return;
    }

    // Execute brain query
    const result = await this.executor.run(task);

    // If execution failed or needs review, deliver result to conversation only
    if (!result.success) {
      await this.deliverResult(task, result);
      return;
    }

    // Execute delivery actions with validated deliverable
    if (hasDeliveryActions && result.deliverable) {
      const deliveryResult = await this.deliveryExecutor.executeDeliveryActions(
        task,
        result.deliverable,
      );

      // Update delivery action statuses
      this.updateDeliveryStatuses(task.id, deliveryResult.results);
      this.onTaskMutated?.();

      // Log delivery results
      const successCount = deliveryResult.results.filter(
        (r) => r.success,
      ).length;
      console.log(
        `[TaskProcessor] Delivery: ${successCount}/${deliveryResult.results.length} succeeded`,
      );
    }

    // Deliver work output to source conversation + dashboard
    await this.deliverResult(task, result);
  }

  /**
   * Update delivery action statuses in the task
   */
  private updateDeliveryStatuses(
    taskId: string,
    results: Array<{ channel: string; success: boolean; error?: string }>,
  ): void {
    const task = this.taskManager.findById(taskId);
    if (!task?.delivery) return;

    const updatedDelivery = task.delivery.map((action) => {
      const result = results.find((r) => r.channel === action.channel);
      if (result && action.status === "pending") {
        return {
          ...action,
          status: result.success ? ("completed" as const) : ("failed" as const),
        };
      }
      return action;
    });

    this.taskManager.update(taskId, { delivery: updatedDelivery });
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

    // Format the result message (work output, not deliverable)
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

    // Trigger notification
    if (this.notificationService) {
      this.notificationService.notify({
        message: result.success
          ? `Task completed: ${task.title}`
          : `Task failed: ${task.title}`,
        importance: result.success ? "info" : "warning",
        taskId: task.id,
      });
    }
  }

  /**
   * Format task result for display in conversation
   */
  private formatResult(task: Task, result: ExecutionResult): string {
    if (result.success) {
      return `**Task Completed: ${task.title}**\n\n${result.work}`;
    } else {
      const reason = result.error || "Unknown error";
      return `**Task Failed: ${task.title}**\n\nError: ${reason}`;
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
      response: result.work,
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
