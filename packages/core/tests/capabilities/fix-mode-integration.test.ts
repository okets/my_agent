import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecoveryOrchestrator } from "../../src/capabilities/recovery-orchestrator.js";
import type { OrchestratorDeps, AutomationSpec } from "../../src/capabilities/recovery-orchestrator.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../src/capabilities/watcher.js";

function makeCapDir(): string {
  const capDir = mkdtempSync(join(tmpdir(), "stt-deepgram-"));
  mkdirSync(join(capDir, "scripts"));
  writeFileSync(join(capDir, "CAPABILITY.md"), "---\nname: Test STT\nprovides: audio-to-text\n---\n");
  writeFileSync(join(capDir, "config.yaml"), "model: nova-2\n");
  writeFileSync(join(capDir, "DECISIONS.md"), "# Decisions\n\n");
  return capDir;
}

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

  it("no nested create_automation — spawnAutomation called at most 3 times across all attempts", async () => {
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

    expect(captured[0].prompt).toContain(capDir);
  });
});
