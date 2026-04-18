/**
 * Tests for AckDelivery origin branches (M9.6-S12 Task 5).
 *
 * Covers the three origin kinds in TriggeringOrigin:
 *   - conversation → smoke-test that Phase 1 behavior is unchanged.
 *   - automation   → CFR_RECOVERY.md is written with the D5 schema on
 *                    terminal kinds; notifyMode controls notification only.
 *   - system       → log-only branch, no file written.
 *
 * D5 schema (s12-DECISIONS.md §D5) is load-bearing: debrief-prep parses this
 * file in Task 7. Any field drift here is a breaking change.
 */

import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AckDelivery,
  CFR_RECOVERY_FILENAME,
  type AutomationNotifierLike,
  type ConnectionRegistryLike,
  type TransportManagerLike,
} from "../../src/capabilities/ack-delivery.js";
import { readFrontmatter } from "../../src/metadata/frontmatter.js";
import type {
  CapabilityFailure,
  ChannelContext,
  FixAttempt,
  TriggeringOrigin,
} from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";

// ─── test helpers ────────────────────────────────────────────────────────────

function makeFailure(origin: TriggeringOrigin, overrides: Partial<CapabilityFailure> = {}): CapabilityFailure {
  return {
    id: "failure-origin-test",
    capabilityType: "browser-control",
    capabilityName: "browser-chrome",
    symptom: "execution-error",
    detail: "MCP server crashed: exit code 1",
    triggeringInput: { origin },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: "2026-04-18T10:00:00.000Z",
    ...overrides,
  };
}

function automationOrigin(args: {
  runDir: string;
  notifyMode?: "immediate" | "debrief" | "none";
}): TriggeringOrigin {
  return {
    kind: "automation",
    automationId: "automation-1",
    jobId: "job-1",
    runDir: args.runDir,
    notifyMode: args.notifyMode ?? "debrief",
  };
}

function systemOrigin(component: string): TriggeringOrigin {
  return { kind: "system", component };
}

function makeAttempt(partial: Partial<FixAttempt> & { attempt: 1 | 2 | 3 }): FixAttempt {
  return {
    attempt: partial.attempt,
    startedAt: "2026-04-18T10:00:10.000Z",
    endedAt: "2026-04-18T10:01:30.000Z",
    hypothesis: partial.hypothesis ?? "Missing chromium binary on PATH.",
    change: partial.change ?? "Added apt-get install chromium-browser to install script.",
    verificationInputPath: "",
    verificationResult: partial.verificationResult ?? "fail",
    failureMode: partial.failureMode,
    jobId: `fix-job-${partial.attempt}`,
    modelUsed: "sonnet",
    phase: "execute",
    nextHypothesis: partial.nextHypothesis,
  };
}

function makeDeps(notifier?: AutomationNotifierLike) {
  const send = vi.fn().mockResolvedValue(undefined);
  const broadcast = vi.fn();
  const transportManager: TransportManagerLike = { send };
  const connectionRegistry: ConnectionRegistryLike = { broadcastToConversation: broadcast };
  const ack = new AckDelivery(transportManager, connectionRegistry, notifier);
  return { ack, send, broadcast };
}

// ─── fixture lifecycle ───────────────────────────────────────────────────────

let runDir: string;

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "ack-delivery-origin-"));
});

afterEach(() => {
  rmSync(runDir, { recursive: true, force: true });
});

// ─── automation branch ──────────────────────────────────────────────────────

describe("AckDelivery — automation branch (Task 5)", () => {
  it("writes CFR_RECOVERY.md to origin.runDir on terminal 'surrender' kind with D5 schema", async () => {
    const { ack } = makeDeps();
    const failure = makeFailure(automationOrigin({ runDir }));
    const attempts: FixAttempt[] = [
      makeAttempt({ attempt: 1, verificationResult: "fail", failureMode: "smoke-timeout" }),
      makeAttempt({
        attempt: 2,
        verificationResult: "fail",
        failureMode: "schema-validation",
        hypothesis: "Binary was present but MCP config path was wrong.",
        change: "Updated CAPABILITY.md entrypoint to absolute path.",
      }),
      makeAttempt({
        attempt: 3,
        verificationResult: "fail",
        failureMode: "smoke-timeout",
        hypothesis: "Timeouts caused by cold-start; bumped startup_timeout.",
        change: "Raised startup_timeout to 30s in CAPABILITY.md.",
      }),
    ];

    await ack.deliver(failure, "Gave up after 3 attempts — browser-chrome still failing.", {
      kind: "surrender",
      session: { attempts, surrenderReason: "iteration-3" },
    });

    const path = join(runDir, CFR_RECOVERY_FILENAME);
    expect(existsSync(path)).toBe(true);
    const { data, body } = readFrontmatter<{
      plug_name: string;
      plug_type: string;
      detected_at: string;
      resolved_at: string;
      attempts: number;
      outcome: "fixed" | "surrendered";
      surrender_reason?: string;
    }>(path);

    expect(data.plug_name).toBe("browser-chrome");
    expect(data.plug_type).toBe("browser-control");
    expect(data.detected_at).toBe("2026-04-18T10:00:00.000Z");
    expect(typeof data.resolved_at).toBe("string");
    expect(new Date(data.resolved_at).toISOString()).toBe(data.resolved_at);
    expect(data.attempts).toBe(3);
    expect(data.outcome).toBe("surrendered");
    expect(data.surrender_reason).toBe("iteration-3");

    // Body must include the per-attempt markdown table.
    expect(body).toContain("# browser-chrome recovery summary");
    expect(body).toContain("## Attempts");
    expect(body).toContain("| # | Hypothesis | Change | Result |");
    expect(body).toContain("smoke-timeout");
    expect(body).toContain("schema-validation");
  });

  it("writes CFR_RECOVERY.md on 'surrender-budget' with surrender_reason=budget", async () => {
    const { ack } = makeDeps();
    const failure = makeFailure(automationOrigin({ runDir }));
    const attempts: FixAttempt[] = [makeAttempt({ attempt: 1 })];

    await ack.deliver(failure, "Gave up early — job budget exhausted.", {
      kind: "surrender-budget",
      session: { attempts, surrenderReason: "budget" },
    });

    const { data } = readFrontmatter<{ outcome: string; surrender_reason: string; attempts: number }>(
      join(runDir, CFR_RECOVERY_FILENAME),
    );
    expect(data.outcome).toBe("surrendered");
    expect(data.surrender_reason).toBe("budget");
    expect(data.attempts).toBe(1);
  });

  it("writes file but does NOT fire notification when notifyMode='debrief' (default)", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const notifier: AutomationNotifierLike = { notify };
    const { ack } = makeDeps(notifier);
    const failure = makeFailure(automationOrigin({ runDir, notifyMode: "debrief" }));

    await ack.deliver(failure, "surrender msg", {
      kind: "surrender",
      session: { attempts: [makeAttempt({ attempt: 1 })], surrenderReason: "iteration-3" },
    });

    expect(existsSync(join(runDir, CFR_RECOVERY_FILENAME))).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("writes file AND fires notification when notifyMode='immediate'", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const notifier: AutomationNotifierLike = { notify };
    const { ack } = makeDeps(notifier);
    const failure = makeFailure(automationOrigin({ runDir, notifyMode: "immediate" }));

    await ack.deliver(failure, "urgent: browser-chrome surrendered", {
      kind: "surrender",
      session: { attempts: [makeAttempt({ attempt: 1 })], surrenderReason: "iteration-3" },
    });

    expect(existsSync(join(runDir, CFR_RECOVERY_FILENAME))).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    const args = notify.mock.calls[0][0];
    expect(args).toMatchObject({
      automationId: "automation-1",
      jobId: "job-1",
      runDir,
      capabilityType: "browser-control",
      capabilityName: "browser-chrome",
      outcome: "surrendered",
      message: "urgent: browser-chrome surrendered",
    });
  });

  it("writes file and skips notification when notifyMode='none'", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const notifier: AutomationNotifierLike = { notify };
    const { ack } = makeDeps(notifier);
    const failure = makeFailure(automationOrigin({ runDir, notifyMode: "none" }));

    await ack.deliver(failure, "silent surrender", {
      kind: "surrender",
      session: { attempts: [makeAttempt({ attempt: 1 })], surrenderReason: "iteration-3" },
    });

    expect(existsSync(join(runDir, CFR_RECOVERY_FILENAME))).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("does NOT write file on non-terminal kinds (attempt/status/surrender-cooldown)", async () => {
    const { ack } = makeDeps();
    const failure = makeFailure(automationOrigin({ runDir }));

    for (const kind of ["attempt", "status", "surrender-cooldown"] as const) {
      await ack.deliver(failure, `k=${kind}`, { kind });
    }
    expect(existsSync(join(runDir, CFR_RECOVERY_FILENAME))).toBe(false);
  });

  it("omits surrender_reason when outcome is 'fixed' via writeAutomationRecovery", () => {
    const { ack } = makeDeps();
    const failure = makeFailure(automationOrigin({ runDir }));
    const path = ack.writeAutomationRecovery({
      failure,
      runDir,
      outcome: "fixed",
      session: {
        attempts: [
          makeAttempt({
            attempt: 1,
            verificationResult: "pass",
            hypothesis: "Chromium binary added; reverify passed.",
          }),
        ],
      },
    });

    const { data, body } = readFrontmatter<{
      outcome: "fixed" | "surrendered";
      surrender_reason?: string;
      attempts: number;
    }>(path);
    expect(data.outcome).toBe("fixed");
    expect(data.surrender_reason).toBeUndefined();
    expect(data.attempts).toBe(1);
    expect(body).toContain("Chromium binary added; reverify passed.");
  });

  it("does not throw when write fails (e.g. runDir does not exist)", async () => {
    const { ack } = makeDeps();
    const missingDir = join(runDir, "nonexistent-subdir");
    const failure = makeFailure(automationOrigin({ runDir: missingDir }));

    await expect(
      ack.deliver(failure, "surrender", {
        kind: "surrender",
        session: { attempts: [makeAttempt({ attempt: 1 })], surrenderReason: "iteration-3" },
      }),
    ).resolves.toBeUndefined();
  });
});

// ─── system branch ───────────────────────────────────────────────────────────

describe("AckDelivery — system branch (Task 5)", () => {
  it("logs to console and does NOT write any file", async () => {
    const { ack } = makeDeps();
    const failure = makeFailure(systemOrigin("orphan-watchdog"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await ack.deliver(failure, "system msg", { kind: "surrender" });

    expect(logSpy).toHaveBeenCalled();
    const joined = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(joined).toMatch(/browser-chrome/);
    expect(joined).toMatch(/browser-control/);
    expect(joined).toMatch(/execution-error/);
    expect(joined).toMatch(/orphan-watchdog/);
    expect(existsSync(join(runDir, CFR_RECOVERY_FILENAME))).toBe(false);

    logSpy.mockRestore();
  });

  it("logs even for non-terminal kinds (in-progress label)", async () => {
    const { ack } = makeDeps();
    const failure = makeFailure(systemOrigin("scheduler"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await ack.deliver(failure, "system attempt", { kind: "attempt" });

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("does not call the transport manager or connection registry", async () => {
    const { ack, send, broadcast } = makeDeps();
    const failure = makeFailure(systemOrigin("some-component"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await ack.deliver(failure, "x", { kind: "surrender" });

    expect(send).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});

// ─── conversation branch (regression) ────────────────────────────────────────

describe("AckDelivery — conversation branch (unchanged from Phase 1)", () => {
  it("dashboard channel still broadcasts via connection registry", async () => {
    const { ack, send, broadcast } = makeDeps();
    const channel: ChannelContext = {
      transportId: "dashboard",
      channelId: "dashboard",
      sender: "user",
    };
    const failure = makeFailure(conversationOrigin(channel, "conv-X", 1));

    await ack.deliver(failure, "hold on, fixing now");

    expect(send).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [convId, payload] = broadcast.mock.calls[0];
    expect(convId).toBe("conv-X");
    expect(payload).toMatchObject({ type: "capability_ack", content: "hold on, fixing now" });
  });

  it("external channel (whatsapp) still routes via transport manager", async () => {
    const { ack, send, broadcast } = makeDeps();
    const channel: ChannelContext = {
      transportId: "whatsapp",
      channelId: "whatsapp",
      sender: "+1555000000",
      replyTo: "msg-1",
    };
    const failure = makeFailure(conversationOrigin(channel, "conv-Y", 1));

    await ack.deliver(failure, "still fixing");

    expect(broadcast).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("whatsapp", "+1555000000", {
      content: "still fixing",
      replyTo: "msg-1",
    });
  });
});
