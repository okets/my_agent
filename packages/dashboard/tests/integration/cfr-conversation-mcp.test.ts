/**
 * cfr-conversation-mcp.test.ts — M9.6-S12 Task 9 integration.
 *
 * End-to-end wiring check for the conversation-origin MCP failure path.
 *
 * Simulates a `PostToolUseFailure` event from the SDK for a
 * conversation-origin session and verifies:
 *
 *   1. McpCapabilityCfrDetector parses the MCP tool name, looks the plug up
 *      in the registry, and emits a CFR with the correct conversation origin
 *      (NOT the S10 empty-placeholder shape).
 *   2. The RecoveryOrchestrator receives the CFR and emits an `attempt` ack
 *      for the conversation via AckDelivery (channel ack fires).
 *   3. The conversation origin carries the full ChannelContext + conversationId
 *      + turnNumber from the originFactory — proving the factory resolved the
 *      real ConversationSessionContext, not a placeholder with empty strings.
 *
 * This is an end-to-end wiring test: the real CfrEmitter, real
 * CapabilityRegistry, real McpCapabilityCfrDetector, real RecoveryOrchestrator,
 * and real AckDelivery are assembled. Only the transport / spawnAutomation /
 * awaitAutomation boundaries are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostToolUseFailureHookInput } from "@anthropic-ai/claude-agent-sdk";
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

describe("cfr-conversation-mcp (integration)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /**
   * Assemble the full detector → emitter → orchestrator → AckDelivery wiring,
   * with the same originFactory shape that SessionManager uses in production
   * (reads a per-session context map keyed by SDK session_id).
   */
  function assemble() {
    // Real capability registry with a browser-chrome MCP plug installed.
    const registry = new CapabilityRegistry();
    const cap: Capability = {
      name: "browser-chrome",
      provides: "browser-control",
      interface: "mcp",
      path: "/fake/capabilities/browser-chrome",
      status: "available",
      health: "untested",
      enabled: true,
      canDelete: false,
    };
    registry.load([cap]);

    // Real CfrEmitter — what production wires in app.ts.
    const cfr = new CfrEmitter();

    // Per-session context map — production shape (see session-manager.ts:356).
    const sessionContexts = new Map<string, ConversationSessionContext>();
    let activeSdkSessionId: string | null = null;

    const originFactory = (): TriggeringOrigin => {
      if (!activeSdkSessionId) {
        throw new Error("no active SDK session");
      }
      const ctx = sessionContexts.get(activeSdkSessionId);
      if (!ctx) {
        throw new Error(
          `no ConversationSessionContext for session_id "${activeSdkSessionId}"`,
        );
      }
      return {
        kind: "conversation",
        channel: ctx.channel,
        conversationId: ctx.conversationId,
        turnNumber: ctx.turnNumber,
      };
    };

    const detector = new McpCapabilityCfrDetector({
      cfr,
      registry,
      originFactory,
    });

    // Transport + connection-registry mocks — we inspect these to confirm the
    // channel ack fired on the right transport.
    const send = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn();
    const transportManager: TransportManagerLike = { send };
    const connectionRegistry: ConnectionRegistryLike = {
      broadcastToConversation: broadcast,
    };

    const ackDelivery = new AckDelivery(transportManager, connectionRegistry);

    // Orchestrator: pin spawnAutomation so we can observe without racing the
    // full fix loop. A gate promise lets the test assert the initial "attempt"
    // ack fires before the execute job is allowed to resolve.
    let releaseSpawn!: () => void;
    const spawnGate = new Promise<void>((r) => {
      releaseSpawn = r;
    });
    const spawnAutomation = vi.fn().mockImplementation(async () => {
      await spawnGate;
      return { jobId: "fix-job-1", automationId: "fix-automation-1" };
    });

    const awaitAutomation = vi
      .fn()
      .mockResolvedValue({ status: "failed" } as AutomationResult);

    const emitAckCalls: Array<{ origin: TriggeringOrigin; kind: string; content: string }> = [];
    const emitAck = vi
      .fn()
      .mockImplementation(async (failure, kind) => {
        // Capture what origin/kind/content the orchestrator tries to deliver.
        emitAckCalls.push({
          origin: failure.triggeringInput.origin,
          kind,
          content: `(kind=${kind})`,
        });
        // Also forward to the real AckDelivery so the channel ack path runs.
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

    // Wire the CfrEmitter → orchestrator.handle path.
    cfr.on("failure", (f) => {
      orchestrator.handle(f).catch(() => {
        /* test: swallow */
      });
    });

    const setActiveSession = (
      sessionId: string,
      ctx: ConversationSessionContext,
    ): void => {
      activeSdkSessionId = sessionId;
      sessionContexts.set(sessionId, ctx);
    };

    return {
      detector,
      cfr,
      orchestrator,
      send,
      broadcast,
      spawnAutomation,
      releaseSpawn,
      emitAckCalls,
      setActiveSession,
    };
  }

  function fireHook(
    detector: McpCapabilityCfrDetector,
    input: PostToolUseFailureHookInput,
  ): Promise<void> {
    const matchers = detector.hooks.PostToolUseFailure!;
    return matchers[0].hooks[0](
      input as never,
      undefined as any,
      { signal: new AbortController().signal },
    ) as Promise<void>;
  }

  it("resolves the real conversation origin (not the S10 empty placeholder) and fires channel ack", async () => {
    const {
      detector,
      broadcast,
      send,
      spawnAutomation,
      releaseSpawn,
      emitAckCalls,
      setActiveSession,
    } = assemble();

    // Seed a real ConversationSessionContext — production SessionManager
    // populates this when the SDK init message arrives.
    setActiveSession("sess-mcp-1", {
      kind: "conversation",
      channel: {
        transportId: "dashboard",
        channelId: "dashboard-main",
        sender: "user-1",
        senderName: "Test User",
      },
      conversationId: "conv-123",
      turnNumber: 7,
    });

    // Simulate an MCP tool failure mid-turn (Mode 1: tool-level exception).
    await fireHook(detector, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "mcp__browser-chrome__screenshot",
      tool_input: { url: "https://example.com/broken" },
      tool_use_id: "toolu_123",
      error: "MCP error -32000: request timed out after 5000ms",
      is_interrupt: false,
      session_id: "sess-mcp-1",
      transcript_path: "/tmp/transcript",
      cwd: "/tmp",
    });

    // Let the orchestrator run to the point where it spawns the fix job.
    // The spawnGate blocks there so the initial "attempt" ack has already fired.
    await new Promise((r) => setTimeout(r, 10));

    // 1. spawnAutomation was called exactly once (not short-circuited).
    expect(spawnAutomation).toHaveBeenCalledTimes(1);

    // 2. The orchestrator emitted an `attempt` ack, routed via AckDelivery to
    //    the dashboard connection registry (not the external transport).
    expect(emitAckCalls).toHaveLength(1);
    expect(emitAckCalls[0].kind).toBe("attempt");
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    // 3. The origin carried through the CFR is the REAL conversation origin,
    //    not the S10 placeholder. This is the load-bearing assertion: if the
    //    originFactory returned a placeholder with empty strings / fallback
    //    defaults, these checks would fail.
    const origin = emitAckCalls[0].origin;
    expect(origin.kind).toBe("conversation");
    if (origin.kind !== "conversation") throw new Error("unreachable");
    expect(origin.conversationId).toBe("conv-123");
    expect(origin.turnNumber).toBe(7);
    expect(origin.channel.transportId).toBe("dashboard");
    expect(origin.channel.channelId).toBe("dashboard-main");
    expect(origin.channel.sender).toBe("user-1");
    expect(origin.channel.senderName).toBe("Test User");

    // 4. The broadcast payload is routed to the right conversation ID.
    const [broadcastConvId, broadcastPayload] = broadcast.mock.calls[0];
    expect(broadcastConvId).toBe("conv-123");
    expect(broadcastPayload).toMatchObject({
      type: "capability_ack",
      conversationId: "conv-123",
    });

    releaseSpawn();
  });

  it("external-transport origin (whatsapp) routes the ack through transportManager.send", async () => {
    const {
      detector,
      broadcast,
      send,
      releaseSpawn,
      emitAckCalls,
      setActiveSession,
    } = assemble();

    setActiveSession("sess-mcp-2", {
      kind: "conversation",
      channel: {
        transportId: "whatsapp",
        channelId: "whatsapp-chat-1",
        sender: "+1555000001",
        replyTo: "msg-abc",
      },
      conversationId: "conv-wa-1",
      turnNumber: 3,
    });

    await fireHook(detector, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "mcp__browser-chrome__screenshot",
      tool_input: { url: "https://example.com" },
      tool_use_id: "toolu_wa",
      error: "MCP error -32000: Connection closed",
      is_interrupt: false,
      session_id: "sess-mcp-2",
      transcript_path: "/tmp/transcript",
      cwd: "/tmp",
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(emitAckCalls).toHaveLength(1);
    expect(emitAckCalls[0].kind).toBe("attempt");
    // External transport path — NOT broadcast.
    expect(broadcast).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("whatsapp", "+1555000001", {
      content: "ack: attempt",
      replyTo: "msg-abc",
    });

    releaseSpawn();
  });

  it("unknown MCP plug (not in registry) does not emit a CFR", async () => {
    const {
      detector,
      spawnAutomation,
      releaseSpawn,
      emitAckCalls,
      setActiveSession,
    } = assemble();

    setActiveSession("sess-mcp-3", {
      kind: "conversation",
      channel: {
        transportId: "dashboard",
        channelId: "dashboard",
        sender: "user-2",
      },
      conversationId: "conv-none",
      turnNumber: 1,
    });

    await fireHook(detector, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "mcp__todo__add_item",
      tool_input: { item: "x" },
      tool_use_id: "toolu_u",
      error: "MCP error -32000: some failure",
      is_interrupt: false,
      session_id: "sess-mcp-3",
      transcript_path: "/tmp/transcript",
      cwd: "/tmp",
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(spawnAutomation).not.toHaveBeenCalled();
    expect(emitAckCalls).toHaveLength(0);

    releaseSpawn();
  });
});
