/**
 * Post-Response Hooks
 *
 * Shared processing that runs after every assistant response,
 * regardless of whether the message came from WebSocket or a channel.
 *
 * Missed task detector: scans for task-worthy requests that conversation
 * Nina didn't delegate via create_task. Detection only — no auto-creation.
 */

import { extractTaskFromMessage } from "../tasks/task-extractor.js";
import type { TaskManager } from "../tasks/task-manager.js";

export interface PostResponseHooksDeps {
  taskManager: TaskManager;
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
    await this.detectMissedTasks(conversationId, userContent, assistantContent);
  }

  private async detectMissedTasks(
    conversationId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    try {
      const extraction = await extractTaskFromMessage(
        userContent,
        assistantContent,
      );

      if (!extraction.shouldCreateTask) return;

      // Check if Nina already created tasks for this conversation recently
      const existingTasks =
        this.deps.taskManager.getTasksForConversation(conversationId);
      const recentTasks = existingTasks.filter(
        (t) => Date.now() - new Date(t.linkedAt).getTime() < 300_000, // within last 5 minutes
      );

      if (recentTasks.length > 0) return; // Nina handled it

      // Nina missed it — log warning
      const title =
        extraction.task?.title ??
        extraction.tasks?.[0]?.title ??
        "unknown request";
      this.deps.log(
        `[MissedTaskDetector] Potential missed task: "${title}" in conversation ${conversationId}`,
      );
    } catch {
      // Non-fatal — detection is best-effort
    }
  }
}
