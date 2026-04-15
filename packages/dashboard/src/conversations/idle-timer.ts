/**
 * Idle Timer Manager
 *
 * Manages per-conversation idle timers that trigger abbreviation after inactivity.
 */

import type { AbbreviationQueue } from "./abbreviation.js";

/**
 * Manages idle timers for conversations
 */
export class IdleTimerManager {
  private queue: AbbreviationQueue;
  // Callback approach (M9.6-S2): App boots with a no-op; WS handler upgrades
  // to the real ConnectionRegistry.getViewerCount on first connect.
  private getViewerCount: (conversationId: string) => number;
  private idleMs: number;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    queue: AbbreviationQueue,
    getViewerCount: (conversationId: string) => number = () => 0,
    idleMs: number = 10 * 60 * 1000, // 10 minutes default
  ) {
    this.queue = queue;
    this.getViewerCount = getViewerCount;
    this.idleMs = idleMs;
  }

  /**
   * Upgrade the viewer-count callback after WS connects.
   * Called by the WS handler on first connection so IdleTimerManager gains
   * real viewer awareness without being coupled to ConnectionRegistry at boot.
   */
  setViewerCountFn(fn: (conversationId: string) => number): void {
    this.getViewerCount = fn;
  }

  /**
   * Touch (reset) the idle timer for a conversation
   *
   * Called on:
   * - User message received
   * - Assistant response complete
   */
  touch(conversationId: string): void {
    // Clear existing timer
    this.clear(conversationId);

    // Set new timer
    const timer = setTimeout(() => {
      this.onIdle(conversationId);
    }, this.idleMs);

    this.timers.set(conversationId, timer);
  }

  /**
   * Clear the idle timer for a conversation
   */
  clear(conversationId: string): void {
    const timer = this.timers.get(conversationId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(conversationId);
    }
  }

  /**
   * Handle idle timeout - queue abbreviation if safe
   */
  private onIdle(conversationId: string): void {
    this.timers.delete(conversationId);

    // Safety check: only abbreviate if no viewers
    const viewerCount = this.getViewerCount(conversationId);

    if (viewerCount === 0) {
      // No active viewers - safe to abbreviate
      this.queue.enqueue(conversationId);
    } else {
      // Has viewers - they might still be typing, skip abbreviation
      // Timer will restart when next message arrives
    }
  }

  /**
   * Get active timer count for debugging
   */
  getActiveTimerCount(): number {
    return this.timers.size;
  }

  /**
   * Shutdown - clear all timers
   */
  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
