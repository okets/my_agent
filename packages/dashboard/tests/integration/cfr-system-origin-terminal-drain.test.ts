/**
 * cfr-system-origin-terminal-drain.test.ts — M9.6-S24 Task 4.
 *
 * Regression test for the ring-buffer transition bug: the system-origin branch
 * of RecoveryOrchestrator.terminalDrain previously only logged the outcome,
 * so the ring-buffer entry seeded by the initial "attempt" ack stayed pinned
 * at "in-progress" forever — Debug/Admin surfaces showed capabilities stuck
 * in "fixing" even after recovery completed or surrendered.
 *
 * Contract under test:
 *
 *   - A system-origin CFR seeds exactly one in-progress ring-buffer entry at
 *     the attempt ack.
 *   - When the fix loop reaches terminal-fixed, that entry transitions IN
 *     PLACE to outcome="fixed" (not a second entry).
 *   - When the fix loop surrenders, that entry transitions IN PLACE to
 *     outcome="surrendered".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  AckDelivery,
  CapabilityRegistry,
  CfrEmitter,
  RecoveryOrchestrator,
  createResilienceCopy,
  type Capability,
  type CapabilityFailure,
  type ConnectionRegistryLike,
} from "@my-agent/core";
import { MockTransport } from "./app-harness.js";

describe("System-origin CFR terminal drain — ring buffer outcome transitions", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let tmpCapDir: string;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Fake capability dir without smoke.sh so runSmokeFixture falls back to
    // the "cap is available" path and returns pass:true (mocks fix-mode success).
    tmpCapDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfr-sys-drain-"));
    fs.mkdirSync(path.join(tmpCapDir, "scripts"), { recursive: true });
  });
  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
    fs.rmSync(tmpCapDir, { recursive: true, force: true });
  });

  /**
   * Minimal App-style wiring: CfrEmitter → RecoveryOrchestrator → AckDelivery,
   * matching the late-binding pattern from app.ts. Exposes helpers so each test
   * can plug in its own spawn/await behaviour for the fix loop.
   */
  function bootApp(args: {
    capType: string;
    capAvailable: boolean;
    awaitResult: "done" | "failed";
  }) {
    type AppState = { ackDelivery: AckDelivery | null };
    const appState: AppState = { ackDelivery: null };

    const cfr = new CfrEmitter();
    const registry = new CapabilityRegistry();
    const resilienceCopy = createResilienceCopy(registry);

    const cap: Capability = {
      name: `fake-${args.capType}`,
      provides: args.capType,
      interface: "script",
      path: tmpCapDir,
      status: args.capAvailable ? "available" : "unavailable",
      health: "healthy",
      enabled: true,
      canDelete: false,
    };
    registry.register(cap);

    const broadcasts: Array<{ conversationId: string; message: unknown }> = [];
    const connectionRegistry: ConnectionRegistryLike = {
      broadcastToConversation: (conversationId, message) => {
        broadcasts.push({ conversationId, message });
      },
    };

    const orchestrator = new RecoveryOrchestrator({
      spawnAutomation: vi.fn().mockResolvedValue({
        jobId: "fix-job-1",
        automationId: "fix-automation-1",
      }),
      awaitAutomation: vi
        .fn()
        .mockResolvedValue({ status: args.awaitResult }),
      getJobRunDir: vi.fn().mockReturnValue(null),
      capabilityRegistry: registry,
      watcher: { rescanNow: vi.fn().mockResolvedValue([]) } as never,
      emitAck: async (failure, kind) => {
        const text =
          kind === "attempt"
            ? resilienceCopy.ack(failure)
            : kind === "terminal-fixed"
              ? resilienceCopy.terminalAck(failure)
              : resilienceCopy.surrender(failure, "iteration-3");

        if (appState.ackDelivery) {
          await appState.ackDelivery.deliver(failure, text, { kind });
        }
      },
      reprocessTurn: vi.fn().mockResolvedValue(undefined),
      writeAutomationRecovery: (wargs) => {
        appState.ackDelivery?.writeAutomationRecovery(wargs);
      },
      recordSystemOutcome: (rargs) => {
        appState.ackDelivery?.recordSystemOutcome(rargs);
      },
      now: () => new Date().toISOString(),
    });

    cfr.on("failure", (f) => {
      orchestrator.handle(f).catch(() => {
        /* test: swallow */
      });
    });

    const transport = new MockTransport();
    appState.ackDelivery = new AckDelivery(transport, connectionRegistry);

    return { cfr, orchestrator, appState };
  }

  function makeSystemFailureSeed(
    capType: string,
    component: string,
  ): Omit<CapabilityFailure, "id" | "attemptNumber" | "previousAttempts" | "detectedAt"> {
    return {
      capabilityType: capType,
      capabilityName: `fake-${capType}`,
      symptom: "execution-error",
      detail: "probe failed",
      triggeringInput: {
        origin: {
          kind: "system",
          component,
        },
      },
    };
  }

  it("transitions the ring-buffer entry from in-progress to fixed", async () => {
    // Fix loop success: capability available at reverify time + smoke.sh
    // absent → runSmokeFixture falls back to availability and returns pass:true.
    const { cfr, appState } = bootApp({
      capType: "mcp-fix-cap",
      capAvailable: true,
      awaitResult: "done",
    });

    cfr.emitFailure(
      makeSystemFailureSeed("mcp-fix-cap", "capability-health-probe") as CapabilityFailure,
    );

    // Poll until the ring buffer has a terminal entry.
    await vi.waitFor(
      () => {
        const events = appState.ackDelivery!.getSystemEvents();
        expect(events).toHaveLength(1);
        expect(events[0].outcome).toBe("fixed");
      },
      { timeout: 3000, interval: 25 },
    );

    const events = appState.ackDelivery!.getSystemEvents();
    // Exactly one entry — transitioned in place, not appended.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      component: "capability-health-probe",
      capabilityType: "mcp-fix-cap",
      outcome: "fixed",
    });
  });

  it("transitions the ring-buffer entry from in-progress to surrendered", async () => {
    // Fix loop surrenders: cap stays unavailable so reverify never passes; after
    // 3 failed attempts the orchestrator hits the iteration-3 surrender branch.
    const { cfr, appState } = bootApp({
      capType: "mcp-surrender-cap",
      capAvailable: false,
      awaitResult: "failed",
    });

    cfr.emitFailure(
      makeSystemFailureSeed("mcp-surrender-cap", "capability-health-probe") as CapabilityFailure,
    );

    await vi.waitFor(
      () => {
        const events = appState.ackDelivery!.getSystemEvents();
        expect(events).toHaveLength(1);
        expect(events[0].outcome).toBe("surrendered");
      },
      { timeout: 5000, interval: 25 },
    );

    const events = appState.ackDelivery!.getSystemEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      component: "capability-health-probe",
      capabilityType: "mcp-surrender-cap",
      outcome: "surrendered",
    });
  });
});
