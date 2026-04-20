/**
 * M9.6-S21 BUG-2: brain-CFR race gate unit tests.
 *
 * Verifies that when STT fails (sttResult === null) and CFR takes over,
 * the brain turn waits behind a gate until reprocessTurn (success) or
 * emitAck surrender (failure) resolves it — not the placeholder text.
 *
 * These tests exercise the gate mechanics directly without a real App or
 * orchestrator. The gate is a Map<string, (text: string) => void> on App.
 */

import { describe, it, expect } from "vitest";

// ─── Minimal gate harness ─────────────────────────────────────────────────────

/** Simulates the gate logic extracted from chat-service.ts + app.ts */
class GateHarness {
  pendingGates: Map<string, (text: string) => void> = new Map();
  private timerIds: ReturnType<typeof setTimeout>[] = [];

  /** chat-service side: await gate or fall back after timeout */
  async awaitGate(gateKey: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve) => {
      this.pendingGates.set(gateKey, resolve);
      const timer = setTimeout(() => {
        if (this.pendingGates.delete(gateKey)) {
          resolve(`[Voice message — transcription unavailable]`);
        }
      }, timeoutMs);
      this.timerIds.push(timer);
    });
  }

  /** app.ts reprocessTurn: resolve gate with recovered text */
  reprocessTurn(gateKey: string, recoveredContent: string): boolean {
    const resolve = this.pendingGates.get(gateKey);
    if (!resolve) return false;
    this.pendingGates.delete(gateKey);
    resolve(`[Voice message] ${recoveredContent}`);
    return true;
  }

  /** app.ts emitAck surrender: resolve gate with surrender text */
  surrenderGate(gateKey: string, surrenderText: string): boolean {
    const resolve = this.pendingGates.get(gateKey);
    if (!resolve) return false;
    this.pendingGates.delete(gateKey);
    resolve(surrenderText);
    return true;
  }

  cleanup() {
    for (const t of this.timerIds) clearTimeout(t);
    this.timerIds = [];
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("M9.6-S21 BUG-2: brain-CFR race gate", () => {
  it("reprocessTurn resolves gate with recovered transcription", async () => {
    const harness = new GateHarness();
    const key = "conv-abc:3";

    const brainPromise = harness.awaitGate(key, 5000);

    // Simulate CFR completing and calling reprocessTurn
    const resolved = harness.reprocessTurn(key, "Hello from recovery");
    expect(resolved).toBe(true);

    const result = await brainPromise;
    expect(result).toBe("[Voice message] Hello from recovery");
    expect(harness.pendingGates.size).toBe(0);
    harness.cleanup();
  });

  it("surrender resolves gate so brain is not left hanging", async () => {
    const harness = new GateHarness();
    const key = "conv-abc:4";

    const brainPromise = harness.awaitGate(key, 5000);

    const surrenderText = "Sorry, I couldn't fix the voice transcription right now.";
    const resolved = harness.surrenderGate(key, surrenderText);
    expect(resolved).toBe(true);

    const result = await brainPromise;
    expect(result).toBe(surrenderText);
    expect(harness.pendingGates.size).toBe(0);
    harness.cleanup();
  });

  it("gate with no resolver times out and returns placeholder", async () => {
    const harness = new GateHarness();
    const key = "conv-xyz:1";

    // Very short timeout for test speed
    const result = await harness.awaitGate(key, 10);

    expect(result).toBe("[Voice message — transcription unavailable]");
    expect(harness.pendingGates.size).toBe(0);
    harness.cleanup();
  });

  it("reprocessTurn on expired gate returns false without throwing", () => {
    const harness = new GateHarness();
    const key = "conv-xyz:2";
    // Gate never registered
    const resolved = harness.reprocessTurn(key, "too late");
    expect(resolved).toBe(false);
    harness.cleanup();
  });
});
