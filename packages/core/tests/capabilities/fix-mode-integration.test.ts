import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecoveryOrchestrator } from "../../src/capabilities/recovery-orchestrator.js";
import type { OrchestratorDeps, AutomationSpec } from "../../src/capabilities/recovery-orchestrator.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../src/capabilities/watcher.js";

const createdDirs: string[] = [];

function makeCapDir(): string {
  const capDir = mkdtempSync(join(tmpdir(), "stt-deepgram-"));
  createdDirs.push(capDir);
  mkdirSync(join(capDir, "scripts"));
  writeFileSync(join(capDir, "CAPABILITY.md"), "---\nname: Test STT\nprovides: audio-to-text\n---\n");
  writeFileSync(join(capDir, "config.yaml"), "model: nova-2\n");
  writeFileSync(join(capDir, "DECISIONS.md"), "# Decisions\n\n");
  return capDir;
}

afterEach(() => {
  for (const d of createdDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeFailure(): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType: "audio-to-text",
    capabilityName: "stt-deepgram",
    symptom: "execution-error",
    detail: "DEEPGRAM_API_KEY not set",
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

function makeDeps(capPath: string, overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const mockRegistry = {
    get: vi.fn().mockReturnValue({ name: "stt-deepgram", path: capPath, status: "unavailable" }),
    isMultiInstance: vi.fn().mockReturnValue(false),
    getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
  } as unknown as CapabilityRegistry;
  const mockWatcher = { rescanNow: vi.fn().mockResolvedValue([]) } as unknown as CapabilityWatcher;
  return {
    spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
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

describe("fix-mode integration", () => {
  it("spawnAutomation receives targetPath equal to cap.path", async () => {
    const capDir = makeCapDir();
    const captured: AutomationSpec[] = [];
    const deps = makeDeps(capDir, {
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].targetPath).toBe(capDir);
  });

  it("no nested create_automation — spawnAutomation called 1-3 times across all attempts", async () => {
    const capDir = makeCapDir();
    const spawnAutomation = vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" });
    const deps = makeDeps(capDir, {
      spawnAutomation,
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    // Fix-mode: 1 spawn per attempt, max 3 attempts.
    // Old path: execute + reflect × 3 = 6 spawns. Exceeding 3 means the reflect path is still live.
    expect(spawnAutomation.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(spawnAutomation.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("prompt contains cap folder path for stub plug", async () => {
    const capDir = makeCapDir();
    const captured: AutomationSpec[] = [];
    const deps = makeDeps(capDir, {
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].prompt).toContain(capDir);
  });

  it("M9.4-S4.3: hypothesis comes from result.json summary, not deliverable.md frontmatter", async () => {
    const capDir = makeCapDir();
    const runDir = mkdtempSync(join(tmpdir(), "cfr-readdeliv-"));
    createdDirs.push(runDir);
    // New contract: deliverable.md is plain markdown body; result.json carries metadata.
    writeFileSync(join(runDir, "deliverable.md"), "Attempt 1: tweaked — config.yaml\n");
    writeFileSync(
      join(runDir, "result.json"),
      JSON.stringify({
        change_type: "configure",
        test_result: "fail",
        hypothesis_confirmed: false,
        summary: "RESULT_JSON_SUMMARY_MARKER reconfigured threshold to 0.4.",
        surface_required_for_hotreload: false,
      }),
    );

    const captured: AutomationSpec[] = [];
    const deps = makeDeps(capDir, {
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: `j-${captured.length}`, automationId: `a-${captured.length}` };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      getJobRunDir: vi.fn().mockReturnValue(runDir),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    // The orchestrator should run multiple attempts (failed + retry up to 3),
    // and each subsequent spawn's prompt should include the prior attempt's
    // hypothesis (summary from result.json).
    expect(captured.length).toBeGreaterThan(1);
    const subsequent = captured.slice(1).map((c) => c.prompt).join("\n");
    expect(subsequent).toContain("RESULT_JSON_SUMMARY_MARKER");
  });
});
