/**
 * cfr-automation-mcp.test.ts — M9.6-S12 Task 9 integration.
 *
 * End-to-end wiring check for the automation-origin MCP failure path.
 *
 * Simulates a `PostToolUseFailure` event from the SDK for an
 * automation-origin session and verifies:
 *
 *   1. McpCapabilityCfrDetector resolves the AutomationSessionContext via its
 *      originFactory (production shape: automation-executor keys by SDK
 *      session_id).
 *   2. The CFR emitted has `kind: "automation"` with `runDir`, `jobId`,
 *      `automationId`, and `notifyMode` preserved.
 *   3. RecoveryOrchestrator handles the CFR, runs the fix loop until it
 *      exhausts attempts, and its terminal drain invokes
 *      `writeAutomationRecovery` which lands `CFR_RECOVERY.md` in
 *      `origin.runDir`.
 *   4. The written frontmatter matches the D5 schema (see
 *      `docs/sprints/m9.6-capability-resilience/s12-DECISIONS.md §D5`).
 *
 * Per the task spec: "subsequent automation fire runs clean against the
 * (assumed-still-failing-without-fix-engine) plug — verifies the wiring, not
 * the fix (fix engine is S16)." This test verifies the wiring — the failure
 * is detected, the orchestrator handles it, and CFR_RECOVERY.md lands.
 */

import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostToolUseFailureHookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  AckDelivery,
  CfrEmitter,
  CapabilityRegistry,
  McpCapabilityCfrDetector,
  RecoveryOrchestrator,
  readFrontmatter,
  type AutomationSessionContext,
  type TriggeringOrigin,
  type Capability,
  type AutomationResult,
  type ConnectionRegistryLike,
  type TransportManagerLike,
} from "@my-agent/core";

describe("cfr-automation-mcp (integration)", () => {
  let runDir: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "cfr-automation-mcp-"));
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(runDir, { recursive: true, force: true });
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /**
   * Assemble the full detector → emitter → orchestrator → AckDelivery wiring
   * for an automation-origin session. originFactory closes over a per-session
   * AutomationSessionContext map — same shape as automation-executor.ts.
   */
  function assemble(opts: {
    notifyMode?: "immediate" | "debrief" | "none";
  } = {}) {
    const notifyMode = opts.notifyMode ?? "debrief";

    // Real capability registry with browser-chrome MCP plug.
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

    const cfr = new CfrEmitter();

    // Per-session map of AutomationSessionContext — the automation-executor
    // populates this when the SDK init frame arrives.
    const sessionContexts = new Map<string, AutomationSessionContext>();
    let activeSdkSessionId: string | null = null;

    const originFactory = (): TriggeringOrigin => {
      if (!activeSdkSessionId) throw new Error("no active SDK session");
      const ctx = sessionContexts.get(activeSdkSessionId);
      if (!ctx) throw new Error(`no AutomationSessionContext for ${activeSdkSessionId}`);
      return {
        kind: "automation",
        automationId: ctx.automationId,
        jobId: ctx.jobId,
        runDir: ctx.runDir,
        notifyMode: ctx.notifyMode,
      };
    };

    const detector = new McpCapabilityCfrDetector({
      cfr,
      registry,
      originFactory,
    });

    // Transport mocks — automation branch doesn't route through these, but
    // AckDelivery still needs them structurally.
    const send = vi.fn().mockResolvedValue(undefined);
    const broadcast = vi.fn();
    const transportManager: TransportManagerLike = { send };
    const connectionRegistry: ConnectionRegistryLike = {
      broadcastToConversation: broadcast,
    };

    const ackDelivery = new AckDelivery(transportManager, connectionRegistry);

    // Orchestrator: succeed spawn, fail-forever awaitAutomation (no fix engine
    // in S12 — we only wire the failure path).
    const spawnAutomation = vi
      .fn()
      .mockResolvedValue({ jobId: "fix-job-1", automationId: "fix-automation-1" });
    const awaitAutomation = vi
      .fn()
      .mockResolvedValue({ status: "failed" } as AutomationResult);

    const emitAckCalls: Array<{ origin: TriggeringOrigin; kind: string }> = [];
    const emitAck = vi
      .fn()
      .mockImplementation(async (failure, kind) => {
        emitAckCalls.push({ origin: failure.triggeringInput.origin, kind });
        // For automation origins, we do NOT route emitAck through AckDelivery
        // in this integration test: the orchestrator's `writeAutomationRecovery`
        // dep (below) is the production Task-6b writer that lands the full
        // schema with `surrender_reason` from session info. Routing emitAck
        // through AckDelivery.deliver() as well would trigger a second,
        // session-less write that overwrites the first — only acceptable when
        // both paths carry the same session shape. Test keeps them separate so
        // the write path is unambiguous.
      });

    // Orchestrator's Task-6b writer: delegates to AckDelivery with full session
    // info. This is the production wiring from app.ts.
    const writeAutomationRecovery = vi
      .fn()
      .mockImplementation((args) => ackDelivery.writeAutomationRecovery(args));

    const orchestrator = new RecoveryOrchestrator({
      spawnAutomation,
      awaitAutomation,
      getJobRunDir: vi.fn().mockReturnValue(null),
      capabilityRegistry: registry,
      watcher: { rescanNow: vi.fn().mockResolvedValue([]) } as any,
      emitAck,
      reprocessTurn: vi.fn().mockResolvedValue(undefined),
      writeAutomationRecovery,
      now: () => new Date().toISOString(),
    });

    cfr.on("failure", (f) => {
      orchestrator.handle(f).catch(() => {
        /* test: swallow */
      });
    });

    const setActiveSession = (
      sessionId: string,
      ctx: AutomationSessionContext,
    ): void => {
      activeSdkSessionId = sessionId;
      sessionContexts.set(sessionId, ctx);
    };

    return {
      detector,
      cfr,
      orchestrator,
      spawnAutomation,
      writeAutomationRecovery,
      emitAckCalls,
      setActiveSession,
      notifyMode,
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

  /**
   * Wait until a predicate is true, or timeout. Used to let the orchestrator's
   * 3-attempt fix loop run to completion without polling a fixed sleep.
   */
  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 2000,
  ): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error("waitFor timeout");
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it("writes CFR_RECOVERY.md to origin.runDir on terminal surrender with D5 schema", async () => {
    const {
      detector,
      spawnAutomation,
      writeAutomationRecovery,
      setActiveSession,
    } = assemble();

    setActiveSession("sess-auto-1", {
      kind: "automation",
      automationId: "weekly-browser-check",
      jobId: "job-abc123",
      runDir,
      notifyMode: "debrief",
    });

    await fireHook(detector, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "mcp__browser-chrome__screenshot",
      tool_input: { url: "https://example.com/target" },
      tool_use_id: "toolu_a",
      error: "MCP error -32000: Connection closed",
      is_interrupt: false,
      session_id: "sess-auto-1",
      transcript_path: "/tmp/transcript",
      cwd: runDir,
    });

    // Wait for the fix loop to exhaust 3 attempts and hit the terminal drain.
    await waitFor(() => writeAutomationRecovery.mock.calls.length > 0);

    // Spawned at least once (3 attempts ideally, but we just need the drain).
    expect(spawnAutomation).toHaveBeenCalled();

    const filePath = join(runDir, "CFR_RECOVERY.md");
    expect(existsSync(filePath)).toBe(true);

    const { data, body } = readFrontmatter<{
      plug_name: string;
      plug_type: string;
      detected_at: string;
      resolved_at: string;
      attempts: number;
      outcome: "fixed" | "surrendered";
      surrender_reason?: string;
    }>(filePath);

    // D5 schema — load-bearing (debrief-prep reads it in Task 7).
    expect(data.plug_name).toBe("browser-chrome");
    expect(data.plug_type).toBe("browser-control");
    expect(typeof data.detected_at).toBe("string");
    expect(typeof data.resolved_at).toBe("string");
    expect(new Date(data.resolved_at).toISOString()).toBe(data.resolved_at);
    expect(typeof data.attempts).toBe("number");
    expect(data.outcome).toBe("surrendered");
    // Surrender reason is present for surrendered outcomes; production path
    // sets it to "iteration-3" after 3 failed attempts.
    expect(data.surrender_reason).toBeDefined();
    expect(["iteration-3", "budget"]).toContain(data.surrender_reason);

    // Body contains per-attempt markdown table structure (even if empty rows).
    expect(body).toContain("# browser-chrome recovery summary");
    expect(body).toContain("## Attempts");
    expect(body).toContain("| # | Hypothesis | Change | Result |");
  });

  it("preserves automation origin fields (automationId, jobId, runDir, notifyMode) through the CFR", async () => {
    const {
      detector,
      writeAutomationRecovery,
      emitAckCalls,
      setActiveSession,
    } = assemble({ notifyMode: "none" });

    setActiveSession("sess-auto-2", {
      kind: "automation",
      automationId: "nightly-scrape",
      jobId: "job-preserve",
      runDir,
      notifyMode: "none",
    });

    await fireHook(detector, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "mcp__browser-chrome__navigate",
      tool_input: { url: "https://example.com" },
      tool_use_id: "toolu_b",
      error: "MCP error -32000: browser crashed",
      is_interrupt: false,
      session_id: "sess-auto-2",
      transcript_path: "/tmp/transcript",
      cwd: runDir,
    });

    await waitFor(() => writeAutomationRecovery.mock.calls.length > 0);

    // The orchestrator emits an attempt ack early; later emits the terminal
    // surrender ack. Both must carry the automation origin (not mutated).
    const attemptAck = emitAckCalls.find((c) => c.kind === "attempt");
    expect(attemptAck).toBeDefined();
    expect(attemptAck!.origin.kind).toBe("automation");
    if (attemptAck!.origin.kind !== "automation") throw new Error("unreachable");
    expect(attemptAck!.origin.automationId).toBe("nightly-scrape");
    expect(attemptAck!.origin.jobId).toBe("job-preserve");
    expect(attemptAck!.origin.runDir).toBe(runDir);
    expect(attemptAck!.origin.notifyMode).toBe("none");

    // writeAutomationRecovery received the same origin.runDir.
    const writeArgs = writeAutomationRecovery.mock.calls[0][0];
    expect(writeArgs.runDir).toBe(runDir);
  });

  it("non-MCP tool errors in automation session do NOT land a CFR_RECOVERY.md", async () => {
    const {
      detector,
      spawnAutomation,
      writeAutomationRecovery,
      setActiveSession,
    } = assemble();

    setActiveSession("sess-auto-3", {
      kind: "automation",
      automationId: "some-job",
      jobId: "job-no-cfr",
      runDir,
      notifyMode: "debrief",
    });

    await fireHook(detector, {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      tool_use_id: "toolu_bash",
      error: "exit code 1",
      is_interrupt: false,
      session_id: "sess-auto-3",
      transcript_path: "/tmp/transcript",
      cwd: runDir,
    });

    // Give the event loop a tick — non-MCP errors should be a no-op.
    await new Promise((r) => setTimeout(r, 30));

    expect(spawnAutomation).not.toHaveBeenCalled();
    expect(writeAutomationRecovery).not.toHaveBeenCalled();
    expect(existsSync(join(runDir, "CFR_RECOVERY.md"))).toBe(false);
  });

  it("Mode-3 detection (processSystemInit) for a failed MCP server writes CFR_RECOVERY.md", async () => {
    const {
      detector,
      writeAutomationRecovery,
      setActiveSession,
    } = assemble();

    setActiveSession("sess-auto-4", {
      kind: "automation",
      automationId: "boot-job",
      jobId: "job-init",
      runDir,
      notifyMode: "debrief",
    });

    // Mode 3: server-never-started shows up in the init frame, not in a hook.
    detector.processSystemInit({
      type: "system",
      subtype: "init",
      session_id: "sess-auto-4",
      mcp_servers: [
        {
          name: "browser-chrome",
          status: "failed",
          error: "MCP server failed to start: DISPLAY not set",
        },
      ],
    });

    await waitFor(() => writeAutomationRecovery.mock.calls.length > 0);

    const filePath = join(runDir, "CFR_RECOVERY.md");
    expect(existsSync(filePath)).toBe(true);
    const { data } = readFrontmatter<{
      plug_type: string;
      outcome: string;
      surrender_reason?: string;
    }>(filePath);
    expect(data.plug_type).toBe("browser-control");
    expect(data.outcome).toBe("surrendered");
  });
});
