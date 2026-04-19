import { describe, it, expect, vi } from "vitest";
import { RecoveryOrchestrator } from "../../src/capabilities/recovery-orchestrator.js";
import type { OrchestratorDeps, AutomationSpec } from "../../src/capabilities/recovery-orchestrator.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../src/capabilities/watcher.js";

const CAP_PATH = "/home/agent/capabilities/stt-deepgram";

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
      artifact: { type: "audio", rawMediaPath: "/tmp/test.ogg", mimeType: "audio/ogg" },
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const mockRegistry = {
    get: vi.fn().mockReturnValue({ name: "stt-deepgram", path: CAP_PATH, status: "unavailable" }),
    isMultiInstance: vi.fn().mockReturnValue(false),
    getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
  } as unknown as CapabilityRegistry;
  const mockWatcher = { rescanNow: vi.fn().mockResolvedValue([]) } as unknown as CapabilityWatcher;
  return {
    spawnAutomation: vi.fn().mockRejectedValue(new Error("spawn not expected")),
    awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    getJobRunDir: vi.fn().mockReturnValue(null),
    capabilityRegistry: mockRegistry,
    watcher: mockWatcher,
    emitAck: vi.fn().mockResolvedValue(undefined),
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

describe("fix-mode-invocation — buildFixModeInvocation", () => {
  it("spawned prompt starts with MODE: FIX", async () => {
    const captured: AutomationSpec[] = [];
    const deps = makeDeps({
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].prompt.trimStart()).toMatch(/^MODE: FIX/);
  });

  it("prompt does not contain old fix-automation template text", async () => {
    const captured: AutomationSpec[] = [];
    const deps = makeDeps({
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(captured[0].prompt).not.toContain("Fix Automation —");
  });

  it("prompt carries capability folder path", async () => {
    const captured: AutomationSpec[] = [];
    const deps = makeDeps({
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(captured[0].prompt).toContain(CAP_PATH);
  });

  it("spec.model is opus", async () => {
    const captured: AutomationSpec[] = [];
    const deps = makeDeps({
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(captured[0].model).toBe("opus");
  });

  it("spec.targetPath equals cap.path from registry", async () => {
    const captured: AutomationSpec[] = [];
    const deps = makeDeps({
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(captured[0].targetPath).toBe(CAP_PATH);
  });

  it("spec.targetPath is undefined when registry has no cap for the type", async () => {
    const captured: AutomationSpec[] = [];
    const registryWithNoMatch = {
      get: vi.fn().mockReturnValue(undefined),
      isMultiInstance: vi.fn().mockReturnValue(false),
      getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
    } as unknown as CapabilityRegistry;
    const deps = makeDeps({
      capabilityRegistry: registryWithNoMatch,
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(captured[0].targetPath).toBeUndefined();
  });
});
