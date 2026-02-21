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
import { StepExecutor } from "./step-executor.js";

export interface TaskProcessorConfig {
  taskManager: TaskManager;
  executor: TaskExecutor;
  conversationManager: ConversationManager;
  connectionRegistry: ConnectionRegistry;
  channelManager?: ChannelManager | null;
  notificationService?: NotificationService | null;
}

/**
 * TaskProcessor — executes tasks and delivers results
 */
export class TaskProcessor {
  private taskManager: TaskManager;
  private executor: TaskExecutor;
  private conversationManager: ConversationManager;
  private connectionRegistry: ConnectionRegistry;
  private stepExecutor: StepExecutor;
  private notificationService: NotificationService | null;

  constructor(config: TaskProcessorConfig) {
    this.taskManager = config.taskManager;
    this.executor = config.executor;
    this.conversationManager = config.conversationManager;
    this.connectionRegistry = config.connectionRegistry;
    this.stepExecutor = new StepExecutor(config.channelManager ?? null);
    this.notificationService = config.notificationService ?? null;
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

    // Parse step completion markers from the response
    if (task.steps && result.success) {
      this.updateStepsFromResponse(task, result.response);
    }

    // Execute delivery steps deterministically (WhatsApp, email, etc.)
    // The brain handles research; StepExecutor handles delivery actions
    if (task.steps && result.success) {
      const deliveryResult = await this.stepExecutor.executeDeliverySteps(
        task,
        result.response,
      );

      // Mark delivered steps as complete
      for (const stepResult of deliveryResult.results) {
        if (stepResult.success) {
          this.taskManager.markStepComplete(task.id, stepResult.stepNumber);
        }
      }

      // Log delivery results
      if (deliveryResult.results.length > 0) {
        const successCount = deliveryResult.results.filter(
          (r) => r.success,
        ).length;
        console.log(
          `[TaskProcessor] Delivery steps: ${successCount}/${deliveryResult.results.length} succeeded`,
        );

        // Broadcast step updates
        this.broadcastStepUpdate(task.id);
      }
    }

    await this.deliverResult(task, result);
  }

  /**
   * Parse the response for step completion markers and update the task
   *
   * Looks for lines like: ✓ STEP 1: [description]
   */
  private updateStepsFromResponse(task: Task, response: string): void {
    const stepPattern = /✓ STEP (\d+):/g;
    const completedSteps = new Set<number>();

    let match;
    while ((match = stepPattern.exec(response)) !== null) {
      const stepNumber = parseInt(match[1], 10);
      completedSteps.add(stepNumber);
    }

    if (completedSteps.size === 0) {
      return;
    }

    // Mark all completed steps
    const maxStep = Math.max(...completedSteps);
    for (let i = 1; i <= maxStep; i++) {
      if (completedSteps.has(i)) {
        this.taskManager.markStepComplete(task.id, i);
      }
    }

    console.log(
      `[TaskProcessor] Marked ${completedSteps.size} steps complete for task ${task.id}`,
    );

    // Broadcast step updates via WebSocket
    this.broadcastStepUpdate(task.id);
  }

  /**
   * Broadcast step update via WebSocket
   */
  private broadcastStepUpdate(taskId: string): void {
    const task = this.taskManager.findById(taskId);
    if (!task) return;

    const links = this.taskManager.getConversationsForTask(taskId);
    for (const link of links) {
      this.connectionRegistry.broadcastToConversation(link.conversationId, {
        type: "task:step_complete",
        taskId: task.id,
        steps: task.steps,
        currentStep: task.currentStep,
      } as any);
    }
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
