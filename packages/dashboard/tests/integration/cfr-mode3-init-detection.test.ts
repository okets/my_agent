/**
 * cfr-mode3-init-detection.test.ts — M9.6-S23
 *
 * Verifies the Mode 3 MCP failure detection chain for conversation-origin
 * sessions: processSystemInit → CfrEmitter → RecoveryOrchestrator.
 *
 * Mode 3: MCP server crashes at startup (never registers tools). The SDK
 * surfaces this ONLY in the `system/init` frame's `mcp_servers[].status`
 * field, not through any hook. The session-manager calls
 * `detector.processSystemInit(event.message)` when a `system_init_raw`
 * event arrives from the message loop.
 *
 * This test is the conversation-side complement to the existing automation-
 * side Mode 3 test in `cfr-automation-mcp.test.ts`. It verifies:
 *
 *   1. processSystemInit detects the failed server and emits a CFR with the
 *      correct conversation origin (real channel + conversationId + turnNumber).
 *   2. The CfrEmitter forwards the failure to RecoveryOrchestrator.handle().
 *   3. The orchestrator emits an `attempt` ack and calls spawnAutomation.
 *   4. The ack routes to the conversation's channel via AckDelivery.
 *   5. An originFactory error (e.g. session not yet active) is caught and
 *      logged — it does NOT propagate and kill the for-await message loop.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AckDelivery,
  CfrEmitter,
  CapabilityRegistry,
  McpCapabilityCfrDetector,
  RecoveryOrchestrator,
  type ConnectionRegistryLike,
  type TransportManagerLike,
  type ConversationSessionContext,
  type TriggeringOrigin,
  type Capability,
  type AutomationResult,
} from "@my-agent/core";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeCap(overrides: Partial<Capability> & { name: string }): Capability {
  return {
    provides: "browser-control",
    interface: "mcp",
    path: "/fake/capabilities/browser-chrome",
    status: "available",
    health: "untested",
    enabled: true,
    canDelete: false,
    ...overrides,
  };
}

function makeInitFrame(
  servers: { name: string; status: string; error?: string }[],
): unknown {
  return {
    type: "system",
    subtype: "init",
    session_id: "sess-mode3",
    mcp_servers: servers,
  };
}

// ── assembly ─────────────────────────────────────────────────────────────────

function assemble() {
  const registry = new CapabilityRegistry();
  registry.load([
    makeCap({ name: "browser-chrome", provides: "browser-control" }),
  ]);

  const cfr = new CfrEmitter();

  // Per-session context map — mirrors production session-manager shape.
  const sessionContexts = new Map<string, ConversationSessionContext>();
  let activeSdkSessionId: string | null = null;

  const originFactory = (): TriggeringOrigin => {
    if (!activeSdkSessionId) throw new Error("no active SDK session");
    const ctx = sessionContexts.get(activeSdkSessionId);
    if (!ctx)
      throw new Error(
        `no ConversationSessionContext for "${activeSdkSessionId}"`,
      );
    return {
      kind: "conversation",
      channel: ctx.channel,
      conversationId: ctx.conversationId,
      turnNumber: ctx.turnNumber,
    };
  };

  const detector = new McpCapabilityCfrDetector({ cfr, registry, originFactory });

  const send = vi.fn().mockResolvedValue(undefined);
  const broadcast = vi.fn();
  const transportManager: TransportManagerLike = { send };
  const connectionRegistry: ConnectionRegistryLike = {
    broadcastToConversation: broadcast,
  };
  const ackDelivery = new AckDelivery(transportManager, connectionRegistry);

  let releaseSpawn!: () => void;
  const spawnGate = new Promise<void>((r) => {
    releaseSpawn = r;
  });
  const spawnAutomation = vi.fn().mockImplementation(async () => {
    await spawnGate;
    return { jobId: "fix-job-mode3", automationId: "fix-auto-mode3" };
  });
  const awaitAutomation = vi
    .fn()
    .mockResolvedValue({ status: "failed" } as AutomationResult);

  const emitAckCalls: Array<{ origin: TriggeringOrigin; kind: string }> = [];
  const emitAck = vi.fn().mockImplementation(async (failure, kind) => {
    emitAckCalls.push({ origin: failure.triggeringInput.origin, kind });
    await ackDelivery.deliver(failure, `ack: ${kind}`, { kind });
  });

  const orchestrator = new RecoveryOrchestrator({
    spawnAutomation,
    awaitAutomation,
    getJobRunDir: vi.fn().mockReturnValue(null),
    capabilityRegistry: registry,
    watcher: { rescanNow: vi.fn().mockResolvedValue([]) } as any,
    emitAck,
    reprocessTurn: vi.fn().mockResolvedValue(undefined),
    writeAutomationRecovery: (args) => ackDelivery.writeAutomationRecovery(args),
    now: () => new Date().toISOString(),
  });

  cfr.on("failure", (f) => {
    orchestrator.handle(f).catch(() => {});
  });

  const setActiveSession = (
    sessionId: string,
    ctx: ConversationSessionContext,
  ) => {
    activeSdkSessionId = sessionId;
    sessionContexts.set(sessionId, ctx);
  };

  return {
    detector,
    spawnAutomation,
    releaseSpawn,
    emitAckCalls,
    broadcast,
    send,
    setActiveSession,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("cfr-mode3-init-detection (integration)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    debugSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("processSystemInit fires CFR → orchestrator receives it and emits attempt ack", async () => {
    const {
      detector,
      spawnAutomation,
      releaseSpawn,
      emitAckCalls,
      broadcast,
      send,
      setActiveSession,
    } = assemble();

    setActiveSession("sess-mode3", {
      kind: "conversation",
      channel: {
        transportId: "dashboard",
        channelId: "dashboard-main",
        sender: "user-1",
        senderName: "Test User",
      },
      conversationId: "conv-mode3",
      turnNumber: 3,
    });

    // Mode 3: inject the SDK init frame with browser-chrome failed at startup.
    detector.processSystemInit(
      makeInitFrame([
        {
          name: "browser-chrome",
          status: "failed",
          error: "MCP error -32000: Connection closed",
        },
      ]),
    );

    // Give the async orchestrator pipeline a tick to fire.
    await new Promise((r) => setTimeout(r, 10));

    // 1. spawnAutomation called — the orchestrator got the CFR and kicked off fix.
    expect(spawnAutomation).toHaveBeenCalledTimes(1);

    // 2. `attempt` ack emitted.
    expect(emitAckCalls).toHaveLength(1);
    expect(emitAckCalls[0].kind).toBe("attempt");

    // 3. Origin carries the real conversation context (not empty placeholder).
    const origin = emitAckCalls[0].origin;
    expect(origin.kind).toBe("conversation");
    if (origin.kind !== "conversation") throw new Error("unreachable");
    expect(origin.conversationId).toBe("conv-mode3");
    expect(origin.turnNumber).toBe(3);
    expect(origin.channel.transportId).toBe("dashboard");

    // 4. Ack routed via AckDelivery broadcast to the conversation.
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [broadcastConvId] = broadcast.mock.calls[0];
    expect(broadcastConvId).toBe("conv-mode3");
    expect(send).not.toHaveBeenCalled();

    releaseSpawn();
  });

  it("debug log fires with the actual mcp_servers[] payload", () => {
    const { detector, setActiveSession } = assemble();

    setActiveSession("sess-mode3", {
      kind: "conversation",
      channel: { transportId: "dashboard", channelId: "ch", sender: "u" },
      conversationId: "conv-dbg",
      turnNumber: 1,
    });

    detector.processSystemInit(
      makeInitFrame([{ name: "browser-chrome", status: "failed" }]),
    );

    // The S23 diagnostic log must fire so live retest can capture it.
    expect(debugSpy).toHaveBeenCalledWith(
      "[CfrDetector] processSystemInit:",
      expect.stringContaining("browser-chrome"),
    );
  });

  it("connected servers in the same init frame do NOT trigger CFR", () => {
    const { detector, spawnAutomation, setActiveSession } = assemble();

    setActiveSession("sess-mode3", {
      kind: "conversation",
      channel: { transportId: "dashboard", channelId: "ch", sender: "u" },
      conversationId: "conv-ok",
      turnNumber: 1,
    });

    detector.processSystemInit(
      makeInitFrame([
        { name: "browser-chrome", status: "connected" },
        { name: "memory", status: "connected" },
      ]),
    );

    expect(spawnAutomation).not.toHaveBeenCalled();
  });

  it("originFactory error is caught and logged — does not propagate to the message loop", () => {
    const { detector } = assemble();
    // No active session — originFactory will throw.

    // processSystemInit must NOT throw even when originFactory fails.
    expect(() => {
      detector.processSystemInit(
        makeInitFrame([
          { name: "browser-chrome", status: "failed", error: "crash" },
        ]),
      );
    }).not.toThrow();

    // The error is logged via console.error with the capability name in the message.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("browser-chrome"),
      expect.any(Error),
    );
  });

  it("is idempotent — second processSystemInit for the same server does not double-emit", async () => {
    const { detector, spawnAutomation, setActiveSession } = assemble();

    setActiveSession("sess-mode3", {
      kind: "conversation",
      channel: { transportId: "dashboard", channelId: "ch", sender: "u" },
      conversationId: "conv-idem",
      turnNumber: 2,
    });

    const frame = makeInitFrame([
      { name: "browser-chrome", status: "failed", error: "boot failure" },
    ]);

    detector.processSystemInit(frame);
    detector.processSystemInit(frame);

    await new Promise((r) => setTimeout(r, 10));
    expect(spawnAutomation).toHaveBeenCalledTimes(1);
  });
});
