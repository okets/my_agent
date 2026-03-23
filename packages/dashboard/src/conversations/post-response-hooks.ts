/**
 * Post-Response Hooks
 *
 * Shared processing that runs after every assistant response,
 * regardless of whether the message came from WebSocket or a channel.
 *
 * Missed task detector: scans for task-worthy requests that conversation
 * Nina didn't delegate via create_task. Detection only — no auto-creation.
 */

import { extractTaskFromMessage, type AutomationHint } from "../automations/automation-extractor.js";

export interface PostResponseHooksDeps {
  log: (msg: string) => void;
  logError: (err: unknown, msg: string) => void;
  /** Active automation hints for channel trigger matching */
  getAutomationHints?: () => AutomationHint[];
  /** Fire an automation job with context */
  fireAutomation?: (automationId: string, context: Record<string, unknown>) => Promise<void>;
  /** Count recent jobs for dedup */
  getRecentJobsForAutomation?: (automationId: string, withinMs: number) => number;
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
      const automationHints = this.deps.getAutomationHints?.() ?? [];
      const extraction = await extractTaskFromMessage(
        userContent,
        assistantContent,
        automationHints.length > 0 ? automationHints : undefined,
      );

      // Check for automation match first
      if (extraction.matchedAutomation && this.deps.fireAutomation) {
        const { automationId, confidence, extractedContext } = extraction.matchedAutomation;

        // 5-minute dedup: skip if automation fired recently
        const recentJobs = this.deps.getRecentJobsForAutomation?.(automationId, 300_000) ?? 0;
        if (recentJobs > 0) {
          this.deps.log(`[PostResponseHooks] Automation ${automationId} already fired recently, skipping`);
          return;
        }

        this.deps.log(
          `[PostResponseHooks] Channel trigger: firing automation "${automationId}" (confidence: ${confidence.toFixed(2)})`,
        );
        await this.deps.fireAutomation(automationId, {
          trigger: "channel",
          conversationId,
          ...extractedContext,
        });
        return;
      }

      // Legacy task detection removed — automations handle this now
    } catch {
      // Non-fatal — detection is best-effort
    }
  }
}
