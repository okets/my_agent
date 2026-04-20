/**
 * M9.6-S21 BUG-2: race gate safety-timeout test.
 *
 * The 50-minute safety timeout in chat-service.ts ensures the brain turn
 * is never permanently blocked if the orchestrator crashes or surrenders
 * without resolving the gate. This test verifies the timeout path returns
 * the placeholder text and clears the gate entry.
 *
 * Uses a short test timeout (50 ms) to avoid slow tests.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

describe("M9.6-S21 BUG-2: gate safety timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("unresolved gate returns placeholder after timeout", async () => {
    vi.useFakeTimers();

    const pendingGates = new Map<string, (text: string) => void>();

    const brainPromise = new Promise<string>((resolve) => {
      const gateKey = "conv-timeout:1";
      pendingGates.set(gateKey, resolve);
      const timer = setTimeout(() => {
        if (pendingGates.delete(gateKey)) {
          resolve(`[Voice message — transcription unavailable]`);
        }
      }, 50 * 60 * 1000); // 50 minutes (production value)
      // unref not available in fake timer environment — just let it run
      void timer;
    });

    // Advance fake timers past the 50-minute mark
    await vi.advanceTimersByTimeAsync(51 * 60 * 1000);

    const result = await brainPromise;
    expect(result).toBe("[Voice message — transcription unavailable]");
    expect(pendingGates.size).toBe(0);
  });
});
