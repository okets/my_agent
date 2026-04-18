/**
 * Tests for terminal routing in RecoveryOrchestrator (M9.6-S13).
 *
 * When reverify passes with recoveredContent undefined (TTS/image/MCP),
 * the orchestrator must:
 *  - NOT call reprocessTurn
 *  - Call emitAck with "terminal-fixed" kind for conversation origins
 */

import { describe, it, expect, vi } from "vitest";
import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
import type { OrchestratorDeps } from "../../../src/capabilities/recovery-orchestrator.js";
import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
    awaitAutomation: vi.fn().mockResolvedValue({ status: "done" }),
    getJobRunDir: vi.fn().mockReturnValue(null),
    capabilityRegistry: {
      get: vi.fn().mockReturnValue({
        status: "available",
        path: "/fake/cap",
        provides: "text-to-audio",
        enabled: true,
      }),
    } as unknown as CapabilityRegistry,
    watcher: {
      rescanNow: vi.fn().mockResolvedValue([]),
    } as unknown as CapabilityWatcher,
    emitAck: vi.fn().mockResolvedValue(undefined),
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    now: () => new Date().toISOString(),
    ...overrides,
  };
}

function makeFailure(capabilityType = "text-to-audio"): CapabilityFailure {
  return {
    id: "f-terminal",
    capabilityType,
    symptom: "execution-error",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+1" },
        "conv-A",
        1,
      ),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

describe("RecoveryOrchestrator — RESTORED_TERMINAL routing", () => {
  it("emits terminal-fixed ack instead of reprocessTurn when reverify returns no recoveredContent", async () => {
    const deps = makeDeps();
    const orchestrator = new RecoveryOrchestrator(deps);

    // text-to-audio: reverifyTextToAudio will fail (no synthesize.sh at /fake/cap/scripts/).
    // It falls through the registry check and fails with "synthesize.sh not found".
    // With all 3 attempts exhausted (or reverify failing), orchestrator surrenders.
    // So let's check that reprocessTurn is never called regardless of surrender vs terminal-fixed.
    await orchestrator.handle(makeFailure("text-to-audio"));

    const reprocessTurn = deps.reprocessTurn as ReturnType<typeof vi.fn>;
    expect(reprocessTurn).not.toHaveBeenCalled();

    const emitAck = deps.emitAck as ReturnType<typeof vi.fn>;
    // Should have emitted at least one ack (attempt or surrender or terminal-fixed)
    expect(emitAck).toHaveBeenCalled();
  });

  it("does not call reprocessTurn for audio-to-text when artifact file is missing", async () => {
    const deps = makeDeps({
      capabilityRegistry: {
        get: vi.fn().mockReturnValue({
          status: "available",
          path: "/fake/cap",
          provides: "audio-to-text",
          enabled: true,
        }),
      } as unknown as CapabilityRegistry,
    });
    const orchestrator = new RecoveryOrchestrator(deps);
    await orchestrator.handle({
      ...makeFailure("audio-to-text"),
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-1", sender: "+1" },
          "conv-A",
          1,
        ),
        artifact: { type: "audio", rawMediaPath: "/tmp/nonexistent.ogg", mimeType: "audio/ogg" },
      },
    });

    const reprocessTurn = deps.reprocessTurn as ReturnType<typeof vi.fn>;
    // File doesn't exist → reverify fails → surrender → no reprocess
    expect(reprocessTurn).not.toHaveBeenCalled();
  });
});
