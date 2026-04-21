/**
 * cfr-tool-retry.test.ts — M9.6-S22 dispatch test: tool capability shape.
 *
 * Verifies that after a conversation-origin tool capability (browser-control)
 * is fixed, the orchestrator's terminalDrain:
 *   1. Emits a "terminal-fixed" ack to the user.
 *   2. Calls retryTurn (not reprocessTurn).
 *
 * Uses fully-stubbed automation (instant "done") so no real Claude Code
 * session is needed. The smoke-fixture falls back to availability check
 * when no scripts/smoke.sh is present — that's enough to pass reverify.
 *
 * This test catches the BUG-7 class for any tool capability.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  CapabilityRegistry,
  RecoveryOrchestrator,
  conversationOrigin,
  type Capability,
  type CapabilityWatcher,
  type AckKind,
  type CapabilityFailure,
} from "@my-agent/core";

const CONV_ID = "cfr-s22-tool-retry";
const CHANNEL = { transportId: "whatsapp", channelId: "+15550010", sender: "+15550010" };

describe("M9.6-S22: tool capability — terminal-fixed ack + retryTurn", () => {
  let emittedAcks: AckKind[];
  let reprocessCalledWith: string | null;
  let retryCalledWith: CapabilityFailure | null;

  beforeAll(async () => {
    emittedAcks = [];
    reprocessCalledWith = null;
    retryCalledWith = null;

    const registry = new CapabilityRegistry();
    const cap: Capability = {
      name: "browser-chrome",
      provides: "browser-control",
      interface: "mcp",
      // Non-existent path — smoke fixture falls back to availability check
      path: "/tmp/cfr-s22-test-tool-cap",
      status: "available",
      health: "healthy",
      enabled: true,
      canDelete: true,
      interaction: "tool",
    };
    registry.register(cap);

    const stubWatcher: CapabilityWatcher = {
      rescanNow: async () => {},
      testAll: async () => {},
      on: () => {},
      off: () => {},
    } as unknown as CapabilityWatcher;

    const orchestrator = new RecoveryOrchestrator({
      spawnAutomation: async () => ({ jobId: "j-tool-1", automationId: "a-tool-1" }),
      awaitAutomation: async () => ({ status: "done" }),
      getJobRunDir: () => null,
      capabilityRegistry: registry,
      watcher: stubWatcher,
      emitAck: async (_failure, kind) => {
        emittedAcks.push(kind);
      },
      reprocessTurn: async (_failure, content) => {
        reprocessCalledWith = content;
      },
      retryTurn: async (failure) => {
        retryCalledWith = failure;
      },
      now: () => new Date().toISOString(),
    });

    await orchestrator.handle({
      id: "fail-tool-1",
      capabilityType: "browser-control",
      capabilityName: "browser-chrome",
      symptom: "not-enabled",
      detail: "browser-chrome .enabled absent",
      triggeringInput: {
        origin: conversationOrigin(CHANNEL, CONV_ID, 1),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    });
  }, 30_000);

  it("emits attempt ack", () => {
    expect(emittedAcks).toContain("attempt");
  });

  it("emits terminal-fixed ack", () => {
    expect(emittedAcks).toContain("terminal-fixed");
  });

  it("calls retryTurn (not reprocessTurn)", () => {
    expect(retryCalledWith).not.toBeNull();
    expect(reprocessCalledWith).toBeNull();
  });

  it("retryTurn receives the original failure with conversation origin", () => {
    expect(retryCalledWith?.triggeringInput.origin.kind).toBe("conversation");
  });
});
