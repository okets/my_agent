/**
 * Post-Response Hooks
 *
 * Shared processing that runs after every assistant response,
 * regardless of whether the message came from WebSocket or a channel.
 *
 * Currently: task extraction.
 * Future: sentiment analysis, auto-tagging, etc.
 */

import {
  extractTaskFromMessage,
  type ExtractedTask,
} from "../tasks/task-extractor.js";
import type { TaskManager } from "../tasks/task-manager.js";
import type { TaskProcessor } from "../tasks/task-processor.js";

export interface PostResponseHooksDeps {
  taskManager: TaskManager;
  taskProcessor: TaskProcessor;
  /** Broadcast a message to WS clients viewing a conversation */
  broadcastToConversation: (conversationId: string, message: unknown) => void;
  /** Broadcast updated task list to all clients */
  publishTasks: () => void;
  log: (msg: string) => void;
  logError: (err: unknown, msg: string) => void;
}

export class PostResponseHooks {
  private deps: PostResponseHooksDeps;

  constructor(deps: PostResponseHooksDeps) {
    this.deps = deps;
  }

  /**
   * Run all post-response hooks. Fire-and-forget — caller should not await.
   */
  async run(
    conversationId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    await this.extractTasks(conversationId, userContent, assistantContent);
  }

  private async extractTasks(
    conversationId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    try {
      const extraction = await extractTaskFromMessage(
        userContent,
        assistantContent,
      );

      if (extraction.shouldCreateTask && extraction.task) {
        const extractedTasks: ExtractedTask[] =
          extraction.tasks && extraction.tasks.length > 1
            ? extraction.tasks
            : [extraction.task];

        for (const extracted of extractedTasks) {
          const task = this.deps.taskManager.create({
            type: extracted.type,
            sourceType: "conversation",
            title: extracted.title,
            instructions: extracted.instructions,
            work: extracted.work,
            delivery: extracted.delivery,
            scheduledFor: extracted.scheduledFor
              ? new Date(extracted.scheduledFor)
              : undefined,
            createdBy: "agent",
          });

          this.deps.taskManager.linkTaskToConversation(task.id, conversationId);

          this.deps.log(
            `[TaskExtractor] Created task "${task.title}" (${task.id}) for conversation ${conversationId}`,
          );

          this.deps.taskProcessor.onTaskCreated(task);

          this.deps.broadcastToConversation(conversationId, {
            type: "task:created",
            task: {
              id: task.id,
              title: task.title,
              type: task.type,
              status: task.status,
              work: task.work,
              delivery: task.delivery,
            },
          });
        }

        this.deps.publishTasks();
      }
    } catch (err) {
      this.deps.logError(
        err,
        `[TaskExtractor] Failed to extract task for conversation ${conversationId}`,
      );
    }
  }
}
