import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecoveryOrchestrator } from "../../src/capabilities/recovery-orchestrator.js";
import type { OrchestratorDeps } from "../../src/capabilities/recovery-orchestrator.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../src/capabilities/watcher.js";
import type { TriggeringOrigin } from "../../src/capabilities/cfr-types.js";

function makeFailure(): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType: "audio-to-text",
    capabilityName: "stt-deepgram",
    symptom: "execution-error",
    detail: "exit code 1",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
        "conv-A",
        1,
      ),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

function makeRunDir(deliverableBody: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cfr-escalate-"));
  const frontmatter = `---\nchange_type: script\ntest_result: fail\nhypothesis_confirmed: false\nsummary: escalating\n---\n`;
  writeFileSync(join(dir, "deliverable.md"), frontmatter + deliverableBody);
  return dir;
}

function makeDeps(runDir: string, overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const mockRegistry = {
    get: vi.fn().mockReturnValue(undefined),
    isMultiInstance: vi.fn().mockReturnValue(false),
    getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
  } as unknown as CapabilityRegistry;
  const mockWatcher = { rescanNow: vi.fn().mockResolvedValue([]) } as unknown as CapabilityWatcher;
  return {
    spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
    awaitAutomation: vi.fn().mockResolvedValue({ status: "done" }),
    getJobRunDir: vi.fn().mockReturnValue(runDir),
    capabilityRegistry: mockRegistry,
    watcher: mockWatcher,
    emitAck: vi.fn().mockResolvedValue(undefined),
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

describe("ESCALATE: redesign-needed", () => {
  it("stops after one spawn — no second or third attempt", async () => {
    const runDir = makeRunDir("ESCALATE: redesign-needed\n\nNeeds bigger rework.");
    const spawnAutomation = vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" });
    const deps = makeDeps(runDir, { spawnAutomation });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(spawnAutomation.mock.calls.length).toBe(1);
  });

  it("emits surrender-redesign-needed ack", async () => {
    const runDir = makeRunDir("ESCALATE: redesign-needed");
    const emitAck = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(runDir, { emitAck });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    const surrenderKinds = emitAck.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .filter((k) => k.startsWith("surrender"));
    expect(surrenderKinds).toContain("surrender-redesign-needed");
  });

  it("skips reverify — watcher.rescanNow not called", async () => {
    const runDir = makeRunDir("ESCALATE: redesign-needed");
    const mockWatcher = { rescanNow: vi.fn().mockResolvedValue([]) } as unknown as CapabilityWatcher;
    const mockRegistry = {
      get: vi.fn().mockReturnValue(undefined),
      isMultiInstance: vi.fn().mockReturnValue(false),
      getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
    } as unknown as CapabilityRegistry;
    const deps = makeDeps(runDir, { watcher: mockWatcher, capabilityRegistry: mockRegistry });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(mockWatcher.rescanNow).not.toHaveBeenCalled();
  });
});

describe("ESCALATE: insufficient-context", () => {
  it("stops after one spawn", async () => {
    const runDir = makeRunDir("ESCALATE: insufficient-context\n\nNot enough info.");
    const spawnAutomation = vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" });
    const deps = makeDeps(runDir, { spawnAutomation });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(spawnAutomation.mock.calls.length).toBe(1);
  });

  it("emits surrender-insufficient-context ack", async () => {
    const runDir = makeRunDir("ESCALATE: insufficient-context");
    const emitAck = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(runDir, { emitAck });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    const surrenderKinds = emitAck.mock.calls
      .map((c: unknown[]) => c[1] as string)
      .filter((k) => k.startsWith("surrender"));
    expect(surrenderKinds).toContain("surrender-insufficient-context");
  });
});

describe("non-ESCALATE deliverable — no early bail", () => {
  it("proceeds to second attempt when deliverable has no ESCALATE marker", async () => {
    const runDir = makeRunDir("Tried patching config. Still failing.");
    const spawnAutomation = vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" });
    const deps = makeDeps(runDir, {
      spawnAutomation,
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    // 3 attempts → 3 spawns (fix-mode has no reflect spawn)
    expect(spawnAutomation.mock.calls.length).toBe(3);
  });
});

describe("FU-1: ESCALATE pushes synthetic FixAttempt", () => {
  it("session.attempts has 1 entry with failureMode containing 'escalate' after ESCALATE", async () => {
    const runDir = makeRunDir("ESCALATE: redesign-needed\n\nFull rethink needed.");
    const writeAutomationRecovery = vi.fn();

    // Use an automation origin so writeAutomationRecovery is called by terminalDrain.
    const automationOrigin: TriggeringOrigin = {
      kind: "automation",
      automationId: "auto-s17-fu1",
      jobId: "job-s17-fu1",
      runDir,
      notifyMode: "debrief",
    };
    const failure: CapabilityFailure = {
      ...makeFailure(),
      triggeringInput: { ...makeFailure().triggeringInput, origin: automationOrigin },
    };

    const deps = makeDeps(runDir, { writeAutomationRecovery });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(failure);

    // writeAutomationRecovery receives the session — inspect its attempts.
    expect(writeAutomationRecovery).toHaveBeenCalled();
    const { session } = writeAutomationRecovery.mock.calls[0][0] as {
      session: { attempts: Array<{ failureMode?: string; phase: string }> };
    };
    expect(session.attempts).toHaveLength(1);
    expect(session.attempts[0].failureMode).toMatch(/escalate/i);
    expect(session.attempts[0].phase).toBe("execute");
  });
});

describe("FU-2: unrecognised ESCALATE reason logs console.warn", () => {
  it("logs a warning when the ESCALATE line has no known reason token", async () => {
    const runDir = makeRunDir("ESCALATE: unknown-future-reason\n\nSomething new.");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps(runDir);
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    const warned = warnSpy.mock.calls.some((c) =>
      String(c[0]).includes("unrecognised reason"),
    );
    expect(warned).toBe(true);
    warnSpy.mockRestore();
  });
});
