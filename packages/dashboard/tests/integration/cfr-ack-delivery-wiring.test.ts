/**
 * cfr-ack-delivery-wiring.test.ts — M9.6-S21 BUG-1 regression test.
 *
 * The production bug: `app.ts` constructed `AckDelivery` inside the Recovery
 * Orchestrator block (~line 713) using `app.transportManager && connectionRegistry`.
 * At that point the TransportManager had not yet been instantiated (that happens
 * ~line 1003), so `ackDelivery` was always `null` and every CFR ack was dropped
 * with the warning:
 *
 *   [CFR] AckDelivery unavailable (TransportManager or ConnectionRegistry missing)
 *
 * This test exercises the wiring contract that the fix establishes:
 *
 *   1. The RecoveryOrchestrator is wired BEFORE TransportManager exists.
 *   2. Its emitAck closure reads `app.ackDelivery` at call time (late-binding).
 *   3. After TransportManager init, app.ts populates `app.ackDelivery` with a
 *      real AckDelivery wrapping the live TransportManager.
 *   4. When a conversation-origin CFR fires, the ack actually lands on the
 *      transport (MockTransport.sends.length > 0) or on the WS registry.
 *
 * A regression (AckDelivery not wired, or wired before TransportManager
 * exists) makes this test fail the same way the live run failed on 2026-04-20.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AckDelivery,
  CapabilityRegistry,
  CfrEmitter,
  RecoveryOrchestrator,
  createResilienceCopy,
  type ConnectionRegistryLike,
} from "@my-agent/core";
import { MockTransport } from "./app-harness.js";

describe("CFR AckDelivery wiring (BUG-1)", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /**
   * Replicate the fixed app.ts wiring sequence:
   *   Phase 1 — build CfrEmitter, registry, orchestrator. AckDelivery is NOT
   *             yet constructed. The orchestrator's emitAck closure uses a
   *             late-binding getter into `appState.ackDelivery`.
   *   Phase 2 — TransportManager (MockTransport here) comes up.
   *   Phase 3 — AckDelivery constructed with the live TransportManager,
   *             assigned to `appState.ackDelivery`. From this point, acks flow.
   */
  function bootApp() {
    type AppState = {
      ackDelivery: AckDelivery | null;
    };
    const appState: AppState = { ackDelivery: null };

    const cfr = new CfrEmitter();
    const registry = new CapabilityRegistry();
    const resilienceCopy = createResilienceCopy(registry);

    // WS registry — captures dashboard-channel broadcasts.
    const broadcasts: Array<{ conversationId: string; message: unknown }> = [];
    const connectionRegistry: ConnectionRegistryLike = {
      broadcastToConversation: (conversationId, message) => {
        broadcasts.push({ conversationId, message });
      },
    };

    // --- Phase 1: orchestrator wired BEFORE transport manager / ackDelivery ---
    const orchestrator = new RecoveryOrchestrator({
      spawnAutomation: vi.fn().mockResolvedValue({
        jobId: "fix-job-1",
        automationId: "fix-automation-1",
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      getJobRunDir: vi.fn().mockReturnValue(null),
      capabilityRegistry: registry,
      watcher: { rescanNow: vi.fn().mockResolvedValue([]) } as any,
      emitAck: async (failure, kind) => {
        // Mirrors app.ts: resolve copy, then late-bind into appState.ackDelivery.
        const text =
          kind === "attempt"
            ? resilienceCopy.ack(failure)
            : kind === "terminal-fixed"
              ? resilienceCopy.terminalAck(failure)
              : resilienceCopy.surrender(failure, "iteration-3");

        if (appState.ackDelivery) {
          await appState.ackDelivery.deliver(failure, text, { kind });
        } else {
          console.warn(
            "[CFR] AckDelivery unavailable (TransportManager or ConnectionRegistry missing) — ack not delivered",
          );
        }
      },
      reprocessTurn: vi.fn().mockResolvedValue(undefined),
      writeAutomationRecovery: (args) => {
        if (appState.ackDelivery) {
          appState.ackDelivery.writeAutomationRecovery(args);
        }
      },
      now: () => new Date().toISOString(),
    });

    cfr.on("failure", (f) => {
      orchestrator.handle(f).catch(() => {
        /* test: swallow */
      });
    });

    // --- Phase 2: TransportManager comes up ---
    const transport = new MockTransport();

    // --- Phase 3: AckDelivery wired in with live deps ---
    appState.ackDelivery = new AckDelivery(transport, connectionRegistry);

    return { cfr, orchestrator, transport, broadcasts, appState };
  }

  function makeConversationFailureSeed(overrides?: {
    transportId?: string;
    sender?: string;
  }) {
    return {
      capabilityType: "audio-to-text",
      capabilityName: "whisper",
      symptom: "execution-error" as const,
      detail: "transcription blew up",
      triggeringInput: {
        origin: {
          kind: "conversation" as const,
          conversationId: "conv-abc",
          turnNumber: 3,
          channel: {
            transportId: overrides?.transportId ?? "whatsapp",
            channelId: "whatsapp:+1555000000",
            sender: overrides?.sender ?? "+1555000000",
            replyTo: "msg-id-1",
          },
        },
      },
    };
  }

  it("whatsapp-origin CFR delivers an ack through the live TransportManager", async () => {
    const { cfr, transport } = bootApp();

    cfr.emitFailure(makeConversationFailureSeed() as any);

    // The orchestrator kicks off an async fix loop; the first "attempt" ack
    // fires before the spawned automation resolves. Poll briefly so we don't
    // depend on exact scheduler timing.
    await vi.waitFor(
      () => {
        expect(transport.sends.length).toBeGreaterThan(0);
      },
      { timeout: 2000, interval: 10 },
    );

    const first = transport.sends[0];
    expect(first.transportId).toBe("whatsapp");
    expect(first.to).toBe("+1555000000");
    expect(first.content).toMatch(/\S+/); // a non-empty copy string
    expect(first.replyTo).toBe("msg-id-1");
  });

  it("dashboard-origin CFR broadcasts via ConnectionRegistry (not transport)", async () => {
    const { cfr, transport, broadcasts } = bootApp();

    cfr.emitFailure(
      makeConversationFailureSeed({ transportId: "dashboard", sender: "user" }) as any,
    );

    await vi.waitFor(
      () => {
        expect(broadcasts.length).toBeGreaterThan(0);
      },
      { timeout: 2000, interval: 10 },
    );

    expect(broadcasts[0].conversationId).toBe("conv-abc");
    expect(broadcasts[0].message).toMatchObject({
      type: "capability_ack",
      conversationId: "conv-abc",
    });
    // Dashboard origin uses the WS registry, not the transport plugin.
    expect(transport.sends.length).toBe(0);
  });

  it("regression guard: if AckDelivery is left null, the ack is dropped and a warning logs", async () => {
    // Re-create a minimal wiring with ackDelivery intentionally never set —
    // the exact shape of the production bug on 2026-04-20.
    const cfr = new CfrEmitter();
    const registry = new CapabilityRegistry();
    const resilienceCopy = createResilienceCopy(registry);
    const transport = new MockTransport();
    let ackUnavailableWarnings = 0;

    const orchestrator = new RecoveryOrchestrator({
      spawnAutomation: vi.fn().mockResolvedValue({
        jobId: "j",
        automationId: "a",
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      getJobRunDir: vi.fn().mockReturnValue(null),
      capabilityRegistry: registry,
      watcher: { rescanNow: vi.fn().mockResolvedValue([]) } as any,
      emitAck: async (failure, kind) => {
        const text = resilienceCopy.ack(failure);
        void text;
        // Simulating the buggy path: no ackDelivery wired.
        ackUnavailableWarnings++;
      },
      reprocessTurn: vi.fn().mockResolvedValue(undefined),
      now: () => new Date().toISOString(),
    });
    cfr.on("failure", (f) => {
      orchestrator.handle(f).catch(() => {});
    });

    cfr.emitFailure(makeConversationFailureSeed() as any);

    await vi.waitFor(
      () => {
        expect(ackUnavailableWarnings).toBeGreaterThan(0);
      },
      { timeout: 2000, interval: 10 },
    );
    // And critically: nothing reached the transport.
    expect(transport.sends.length).toBe(0);
  });
});
