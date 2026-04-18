/**
 * terminal-drain-non-conversation.test.ts — M9.6-S12 Tasks 6b, 6c.
 *
 * Covers the non-conversation branches of the terminal drain:
 *
 *   - Automation origin: `writeAutomationRecovery` fires (CFR_RECOVERY.md
 *     would be written), and no `reprocessTurn` runs for that origin.
 *   - System origin: a console log is emitted and no `reprocessTurn` runs.
 *   - Non-conversation surrender: NO `SurrenderScope` is recorded
 *     (Option A — D6). The durable record lives in CFR_RECOVERY.md instead.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
import type {
  OrchestratorDeps,
  AutomationResult,
} from "../../../src/capabilities/recovery-orchestrator.js";
import type {
  CapabilityFailure,
  TriggeringOrigin,
} from "../../../src/capabilities/cfr-types.js";
import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

// ─── test fixtures ───────────────────────────────────────────────────────────

function automationOrigin(
  automationId: string,
  jobId: string,
  runDir = "/tmp/run-dir",
  notifyMode: "immediate" | "debrief" | "none" = "debrief",
): TriggeringOrigin {
  return { kind: "automation", automationId, jobId, runDir, notifyMode };
}

function systemOrigin(component: string): TriggeringOrigin {
  return { kind: "system", component };
}

function makeFailure(origin: TriggeringOrigin, id = "f-1"): CapabilityFailure {
  return {
    id,
    capabilityType: "browser-control",
    capabilityName: "browser-chrome",
    symptom: "execution-error",
    detail: "exit 1",
    triggeringInput: { origin },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    // Default: spawn fails → session exhausts attempts → surrender path.
    spawnAutomation: vi
      .fn()
      .mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
    awaitAutomation: vi
      .fn()
      .mockResolvedValue({ status: "failed" } as AutomationResult),
    getJobRunDir: vi.fn().mockReturnValue(null),
    capabilityRegistry: {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as CapabilityRegistry,
    watcher: {
      rescanNow: vi.fn().mockResolvedValue([]),
    } as unknown as CapabilityWatcher,
    emitAck: vi.fn().mockResolvedValue(undefined),
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    writeAutomationRecovery: vi.fn(),
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  // Silence surrender warning spam during test runs.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("RecoveryOrchestrator — terminal drain for non-conversation origins", () => {
  it("automation origin: writeAutomationRecovery is called with outcome=surrendered", async () => {
    const writeAutomationRecovery = vi.fn();
    const deps = makeDeps({ writeAutomationRecovery });
    const orchestrator = new RecoveryOrchestrator(deps);

    const failure = makeFailure(automationOrigin("aut-1", "job-1", "/tmp/job-1"));
    await orchestrator.handle(failure);

    expect(writeAutomationRecovery).toHaveBeenCalledTimes(1);
    const args = writeAutomationRecovery.mock.calls[0]![0] as {
      outcome: "fixed" | "surrendered";
      runDir: string;
      session: { attempts: unknown[] };
    };
    expect(args.outcome).toBe("surrendered");
    expect(args.runDir).toBe("/tmp/job-1");
    // session.attempts comes from the FixSession — must be an array.
    expect(Array.isArray(args.session.attempts)).toBe(true);

    // reprocessTurn is a conversation-only callback; must not have fired.
    expect(deps.reprocessTurn).not.toHaveBeenCalled();
  });

  it("system origin: console.log fires, no reprocessTurn, no writeAutomationRecovery", async () => {
    const logCalls: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      logCalls.push(args.join(" "));
    });

    const writeAutomationRecovery = vi.fn();
    const deps = makeDeps({ writeAutomationRecovery });
    const orchestrator = new RecoveryOrchestrator(deps);

    const failure = makeFailure(systemOrigin("orphan-watchdog"));
    await orchestrator.handle(failure);

    // System drain writes a structured log line.
    expect(
      logCalls.some(
        (l) =>
          l.includes("terminal drain for system origin") &&
          l.includes('component="orphan-watchdog"'),
      ),
    ).toBe(true);

    expect(deps.reprocessTurn).not.toHaveBeenCalled();
    expect(writeAutomationRecovery).not.toHaveBeenCalled();
  });

  it("non-conversation surrender does NOT record a SurrenderScope", async () => {
    const deps = makeDeps();
    const orchestrator = new RecoveryOrchestrator(deps);

    // Automation origin exhausts attempts → surrender path runs.
    await orchestrator.handle(
      makeFailure(automationOrigin("aut-1", "job-1", "/tmp/job-1")),
    );
    expect(orchestrator.listSurrendered()).toHaveLength(0);

    // System origin — same.
    await orchestrator.handle(makeFailure(systemOrigin("scheduler")));
    expect(orchestrator.listSurrendered()).toHaveLength(0);
  });

  it("non-conversation surrender writes CFR_RECOVERY.md via writeAutomationRecovery", async () => {
    const writeAutomationRecovery = vi.fn();
    const deps = makeDeps({ writeAutomationRecovery });
    const orchestrator = new RecoveryOrchestrator(deps);

    await orchestrator.handle(
      makeFailure(automationOrigin("aut-1", "job-1", "/tmp/job-1")),
    );

    expect(writeAutomationRecovery).toHaveBeenCalledTimes(1);
    const args = writeAutomationRecovery.mock.calls[0]![0] as {
      outcome: "fixed" | "surrendered";
    };
    expect(args.outcome).toBe("surrendered");
  });

  it("missing writeAutomationRecovery dep: drain continues; no throw", async () => {
    const deps = makeDeps({ writeAutomationRecovery: undefined });
    const orchestrator = new RecoveryOrchestrator(deps);

    // Should not throw even though the automation branch has no writer.
    await expect(
      orchestrator.handle(
        makeFailure(automationOrigin("aut-1", "job-1", "/tmp/job-1")),
      ),
    ).resolves.toBeUndefined();
  });
});
