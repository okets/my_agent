/**
 * Post-Response Hooks
 *
 * Shared processing that runs after every assistant response,
 * regardless of whether the message came from WebSocket or a channel.
 *
 * - Missed task detector: scans for task-worthy requests
 * - Visual augmentation: attaches screenshots to conversations
 * - Response watchdog: detects garbled/incomplete responses and nudges the brain
 */

import {
  extractTaskFromMessage,
  type AutomationHint,
} from "../automations/automation-extractor.js";
import {
  maybeAugmentWithVisual,
  type VisualAugmentationDeps,
} from "../chat/visual-augmentation.js";
import { runWatchdog, type StreamMetadata } from "./response-watchdog.js";

const WATCHDOG_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes per conversation

export interface PostResponseHooksDeps {
  log: (msg: string) => void;
  logError: (err: unknown, msg: string) => void;
  /** Active automation hints for channel trigger matching */
  getAutomationHints?: () => AutomationHint[];
  /** Fire an automation job with context */
  fireAutomation?: (
    automationId: string,
    context: Record<string, unknown>,
  ) => Promise<void>;
  /** Count recent jobs for dedup */
  getRecentJobsForAutomation?: (
    automationId: string,
    withinMs: number,
  ) => number;
  /** Visual augmentation deps (optional — only if VAS + connection registry available) */
  visualAugmentation?: VisualAugmentationDeps;
  /** Inject a recovery turn into a specific conversation. Returns response text, or null if session busy/unavailable */
  injectRecovery?: (
    conversationId: string,
    prompt: string,
  ) => Promise<string | null>;
  /** Shared map tracking recent automation alerts — for collision suppression */
  recentAutomationAlerts?: Map<string, number>;
}

export class PostResponseHooks {
  private deps: PostResponseHooksDeps;
  private watchdogCooldowns = new Map<string, number>();

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
    options?: {
      turnNumber?: number;
      imagesStoredDuringTurn?: number;
      streamMetadata?: StreamMetadata;
    },
  ): Promise<void> {
    await Promise.all([
      this.detectMissedTasks(conversationId, userContent, assistantContent),
      this.augmentWithVisual(conversationId, assistantContent, options),
      this.responseWatchdog(
        conversationId,
        userContent,
        assistantContent,
        options?.streamMetadata,
      ),
    ]);
  }

  private async augmentWithVisual(
    conversationId: string,
    assistantContent: string,
    options?: { turnNumber?: number; imagesStoredDuringTurn?: number },
  ): Promise<void> {
    if (!this.deps.visualAugmentation) return;
    try {
      await maybeAugmentWithVisual(
        conversationId,
        assistantContent,
        options?.imagesStoredDuringTurn ?? 0,
        options?.turnNumber ?? 0,
        this.deps.visualAugmentation,
      );
    } catch (err) {
      this.deps.logError(err, "[PostResponseHooks] Visual augmentation failed");
    }
  }

  /**
   * Response Watchdog — detect garbled/incomplete responses and nudge the brain.
   */
  private async responseWatchdog(
    conversationId: string,
    userContent: string,
    assistantContent: string,
    metadata?: StreamMetadata,
  ): Promise<void> {
    if (!this.deps.injectRecovery) return;

    try {
      const diagnosis = runWatchdog(
        userContent,
        assistantContent,
        metadata ?? {
          toolUseCount: 0,
          cost: undefined,
          textLengthAfterLastTool: assistantContent.length,
        },
      );
      if (!diagnosis) return;

      // Check collision suppression — skip if automation alert just fired for this conversation
      const lastAutomationAlert =
        this.deps.recentAutomationAlerts?.get(conversationId) ?? 0;
      if (Date.now() - lastAutomationAlert < 60_000) {
        this.deps.log(
          `[ResponseWatchdog] ${diagnosis.severity}: ${diagnosis.type} — ${diagnosis.description} (suppressed: automation alert fired <60s ago)`,
        );
        return;
      }

      // Check cooldown — log even when rate-limited
      const lastFired = this.watchdogCooldowns.get(conversationId) ?? 0;
      if (Date.now() - lastFired < WATCHDOG_COOLDOWN_MS) {
        this.deps.log(
          `[ResponseWatchdog] ${diagnosis.severity}: ${diagnosis.type} — ${diagnosis.description} (rate-limited, cooldown active)`,
        );
        return;
      }

      this.deps.log(
        `[ResponseWatchdog] ${diagnosis.severity}: ${diagnosis.type} — ${diagnosis.description}`,
      );

      this.watchdogCooldowns.set(conversationId, Date.now());
      await this.deps.injectRecovery(conversationId, diagnosis.recoveryPrompt);
    } catch (err) {
      this.deps.logError(err, "[ResponseWatchdog] Recovery injection failed");
    }
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
        const { automationId, confidence, extractedContext } =
          extraction.matchedAutomation;

        // 5-minute dedup: skip if automation fired recently
        const recentJobs =
          this.deps.getRecentJobsForAutomation?.(automationId, 300_000) ?? 0;
        if (recentJobs > 0) {
          this.deps.log(
            `[PostResponseHooks] Automation ${automationId} already fired recently, skipping`,
          );
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
