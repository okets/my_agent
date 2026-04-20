/**
 * recovery-orchestrator.ts — Drives the CFR recovery loop for failed capabilities.
 *
 * When the CfrEmitter fires a CapabilityFailure, the RecoveryOrchestrator:
 *   1. Checks surrender cooldown / in-flight deduplication.
 *   2. Uses orchestrator-state-machine.ts to drive a fix loop (up to 3 attempts).
 *   3. Spawns a fix-phase automation (Opus, MODE:FIX) per attempt via capability-brainstorming skill.
 *   4. Reflect-phase automation removed (S16 fix-engine swap); dead code cleaned in S17.
 *   5. Reverifies the fix against the user's actual triggering artifact.
 *   6. On success: injects a mediator-framed system message to re-process the turn.
 *   7. On exhaustion: records a SurrenderScope with 10-min cooldown.
 *
 * Created in M9.6-S4.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CapabilityFailure,
  SurrenderScope,
  FixAttempt,
  TriggeringOrigin,
  TriggeringInput,
} from "./cfr-types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityWatcher } from "./watcher.js";
import type { CapabilityInvoker } from "./invoker.js";
import { nextAction, type FixSession } from "./orchestrator-state-machine.js";
import { dispatchReverify } from "./reverify.js";
import { parseFrontmatterContent } from "../metadata/frontmatter.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type AckKind = "attempt" | "status" | "surrender" | "surrender-budget" | "surrender-cooldown" | "terminal-fixed" | "surrender-redesign-needed" | "surrender-insufficient-context";

export interface AutomationSpec {
  name: string;
  model: "opus" | "sonnet";
  autonomy: "cautious" | "standard";
  prompt: string;
  jobType: "capability_modify";
  parent?: { jobId: string; iteration: number };
  targetPath?: string;
  smokeOutput?: string;
}

export interface AutomationResult {
  status: "done" | "failed" | "needs_review" | "interrupted" | "cancelled";
  deliverablePath?: string;
}

export interface OrchestratorDeps {
  spawnAutomation: (spec: AutomationSpec) => Promise<{ jobId: string; automationId: string }>;
  awaitAutomation: (jobId: string, timeoutMs: number) => Promise<AutomationResult>;
  getJobRunDir: (jobId: string) => string | null;
  capabilityRegistry: CapabilityRegistry;
  watcher: CapabilityWatcher;
  invoker?: CapabilityInvoker;
  emitAck: (failure: CapabilityFailure, kind: AckKind) => Promise<void>;
  reprocessTurn: (failure: CapabilityFailure, recoveredContent: string) => Promise<void>;
  /**
   * Write `CFR_RECOVERY.md` for an automation-origin attached to this fix
   * session. Called once per attached automation origin during the Task 6b
   * terminal drain — independent of `emitAck` so `outcome: "fixed"` can land
   * a durable record even when the user-facing ack path is a no-op for
   * automations. Optional: when absent, the orchestrator logs a warning and
   * continues with the remaining drain steps (per-origin failure isolation).
   */
  writeAutomationRecovery?: (args: {
    failure: CapabilityFailure;
    runDir: string;
    outcome: "fixed" | "terminal-fixed" | "surrendered";
    session: { attempts: FixAttempt[]; surrenderReason?: "budget" | "iteration-3" | "redesign-needed" | "insufficient-context" };
  }) => void;
  now: () => string;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/** Max time to wait for a single automation job (15 minutes — cold Opus on unfamiliar plug: 5–12 min) */
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

/** Surrender cooldown: 10 minutes in ms */
const SURRENDER_COOLDOWN_MS = 10 * 60 * 1000;

/** Emit a status ack if a fix attempt is still running after this many ms (M9.6-S6) */
const STATUS_ACK_DELAY_MS = 20_000;

interface DeliverableFrontmatter {
  change_type?: string;
  test_result?: "pass" | "fail";
  hypothesis_confirmed?: boolean;
  summary?: string;
  surface_required_for_hotreload?: boolean;
}

interface ParsedDeliverable {
  frontmatter: DeliverableFrontmatter;
  body: string;
}

// ─── RecoveryOrchestrator ─────────────────────────────────────────────────────

export class RecoveryOrchestrator {
  /** Per-capability fix sessions: one at a time per capability type */
  private inFlight: Map<string, FixSession> = new Map();

  /**
   * Surrender scopes keyed by `${capabilityType}:${conversationId}:${turnNumber}`.
   * Cross-conversation cooldown: if any scope for a type hasn't expired, skip to surrender.
   */
  private surrendered: Map<string, SurrenderScope> = new Map();

  constructor(private deps: OrchestratorDeps) {}

  /**
   * Handle a capability failure. Called by app.cfr.on("failure", ...).
   *
   * Non-throwing: errors are logged, not re-thrown.
   */
  async handle(failure: CapabilityFailure): Promise<void> {
    const { capabilityType, triggeringInput } = failure;
    const { origin } = triggeringInput;

    // 1. Check cross-conversation surrender cooldown.
    //    Only conversation origins participate in SurrenderScope (M9.6-S12 D6,
    //    Option A). Automation/system origins bypass the cooldown — their
    //    recovery record lives in CFR_RECOVERY.md / log, not a scope keyed by
    //    conversationId.
    if (this.isSurrendered(capabilityType)) {
      if (origin.kind === "conversation") {
        console.log(
          `[RecoveryOrchestrator] ${capabilityType} in surrender cooldown — skipping recovery for conv ${origin.conversationId}`,
        );
        await this.deps.emitAck(failure, "surrender-cooldown");
        return;
      }
      // Non-conversation origin during a conversation-scoped cooldown — proceed
      // with recovery; the cooldown only protects conversation-origin turns.
    }

    // 2. Dedup: if a fix is already in-flight for this capability type, attach
    //    the new origin to the existing FixSession's attachedOrigins (M9.6-S12
    //    Task 6a, D7). No second automation is spawned; no duplicate "hold on"
    //    ack is sent. The terminal drain processes every attached origin.
    const existing = this.inFlight.get(capabilityType);
    if (existing) {
      existing.attachedOrigins.push(origin);
      console.log(
        `[RecoveryOrchestrator] ${capabilityType} fix already in-flight — ` +
          `attaching origin kind="${origin.kind}" ` +
          `(attachedOrigins=${existing.attachedOrigins.length})`,
      );
      return;
    }

    // 3. Start a new fix session
    const session: FixSession = {
      failureId: failure.id,
      capabilityType,
      attemptNumber: 1,
      state: "IDLE",
      attempts: [],
      totalJobsSpawned: 0,
      attachedOrigins: [origin],
    };
    this.inFlight.set(capabilityType, session);

    try {
      await this.runFixLoop(session, failure);
    } finally {
      this.inFlight.delete(capabilityType);
    }
  }

  /** List all currently recorded surrender scopes */
  listSurrendered(): SurrenderScope[] {
    return Array.from(this.surrendered.values());
  }

  /**
   * Called when a capability becomes available (e.g. user manually fixed it).
   * Clears all surrender scopes for that type so the next failure triggers recovery.
   */
  onCapabilityNowAvailable(type: string): void {
    for (const [key, scope] of this.surrendered.entries()) {
      if (scope.capabilityType === type) {
        this.surrendered.delete(key);
      }
    }
    console.log(`[RecoveryOrchestrator] Cleared surrender scope for ${type}`);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Returns true if there is any non-expired surrender scope for this capability type
   * AND the capability is still unavailable in the registry.
   *
   * If the capability has been fixed externally (registry reports status=available),
   * the scope is bypassed — the cooldown should not block recovery when the thing
   * it was protecting against has already been resolved. (C1 fix, M9.6-S4 architect review)
   */
  private isSurrendered(capabilityType: string): boolean {
    // If the capability is now healthy, surrender scopes are stale — don't block.
    if (this.deps.capabilityRegistry.get(capabilityType)?.status === "available") {
      return false;
    }

    const now = Date.now();
    for (const scope of this.surrendered.values()) {
      if (scope.capabilityType === capabilityType) {
        if (new Date(scope.expiresAt).getTime() > now) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Record a surrender scope for a given origin.
   *
   * M9.6-S12 Task 6c (Option A, D6): only conversation origins write a
   * SurrenderScope. Automation/system origins skip this — their surrender
   * info lives in `CFR_RECOVERY.md` (automation) or console log (system),
   * written by the Task 6b terminal drain. `SurrenderScope` is conversation-
   * scoped by shape (`{capabilityType, conversationId, turnNumber, expiresAt}`)
   * and exists to suppress repeat "sorry, I can't fix this" ack messages to
   * the same user — automations don't face users mid-run.
   *
   * Option B (widen `SurrenderScope` to a discriminated union) is deferred;
   * see `s12-FOLLOW-UPS.md`.
   */
  private recordSurrender(origin: TriggeringOrigin, capabilityType: string): void {
    if (origin.kind !== "conversation") {
      return;
    }
    const { conversationId, turnNumber } = origin;
    const key = `${capabilityType}:${conversationId}:${turnNumber}`;
    const expiresAt = new Date(Date.now() + SURRENDER_COOLDOWN_MS).toISOString();
    this.surrendered.set(key, {
      capabilityType,
      conversationId,
      turnNumber,
      expiresAt,
    });
    console.warn(
      `[RecoveryOrchestrator] SURRENDER ${capabilityType} — conv ${conversationId} turn ${turnNumber} — cooldown until ${expiresAt}`,
    );
  }

  /**
   * Main fix loop. Drives the state machine across up to 3 attempts.
   *
   * Status timing (M9.6-S6): after the initial "attempt" ack, start a 20s
   * timer that fires a "status" ack if the session is still grinding away.
   * The timer is cancelled as soon as the session reaches DONE or SURRENDER.
   */
  private async runFixLoop(session: FixSession, failure: CapabilityFailure): Promise<void> {
    // Transition: IDLE → ACKED
    const ackAction = nextAction(session, { type: "CFR_RECEIVED" });
    if (ackAction.action === "SURRENDER") {
      await this.surrender(session, failure);
      return;
    }
    session.state = "ACKED";
    await this.deps.emitAck(failure, "attempt");

    // Arm the 20s status timer (M9.6-S6, D2). Fires once if we're still
    // working after 20 seconds; cancelled on DONE or SURRENDER below.
    const statusTimer: NodeJS.Timeout = setTimeout(() => {
      if (session.state !== "RESTORED_WITH_REPROCESS" && session.state !== "RESTORED_TERMINAL" && session.state !== "SURRENDER") {
        this.deps.emitAck(failure, "status").catch((err) => {
          console.error("[RecoveryOrchestrator] status ack failed:", err);
        });
      }
    }, STATUS_ACK_DELAY_MS);
    // Ensure the timer doesn't keep the process alive past shutdown.
    if (typeof statusTimer.unref === "function") statusTimer.unref();

    try {
      // Transition: ACKED → EXECUTING
      const spawnAction = nextAction(session, { type: "ACK_SENT" });
      if (spawnAction.action === "SURRENDER") {
        await this.surrender(session, failure);
        return;
      }
      session.state = "EXECUTING";

      // Fix loop: up to 3 attempts
      while (session.attemptNumber <= 3) {
        const attemptResult = await this.runOneAttempt(session, failure);

        if (attemptResult.escalate) {
          // ESCALATE: marker — skip remaining attempts and surrender with the pre-set reason.
          await this.surrender(session, failure);
          return;
        }

        if (attemptResult.recovered) {
          if (attemptResult.recoveredContent !== undefined) {
            // Reprocess path (STT): re-run the user's turn with recovered content.
            const reprocessAction = nextAction(session, {
              type: "REVERIFY_PASS_RECOVERED",
              recoveredContent: attemptResult.recoveredContent,
            });
            if (reprocessAction.action === "REPROCESS_TURN") {
              session.state = "RESTORED_WITH_REPROCESS";
              await this.terminalDrain(failure, session, {
                outcome: "fixed",
                recoveredContent: reprocessAction.recoveredContent,
              });
              nextAction(session, { type: "REPROCESS_SENT" });
              return;
            }
          } else {
            // Terminal path (TTS, text-to-image, MCP): capability healthy, no input to replay.
            const terminalAction = nextAction(session, { type: "REVERIFY_PASS_TERMINAL" });
            if (terminalAction.action === "TERMINAL_ACK") {
              session.state = "RESTORED_TERMINAL";
              await this.terminalDrain(failure, session, { outcome: "terminal-fixed" });
              return;
            }
          }
        }

        // Attempt failed — iterate or surrender.
        // Per-attempt status ack has been replaced by the 20s timer above;
        // no inline emitAck(..., "status") fires here.
        if (session.attemptNumber < 3) {
          const nextAttempt = (session.attemptNumber + 1) as 2 | 3;
          session.attemptNumber = nextAttempt;
          session.state = "EXECUTING";
        } else {
          session.surrenderReason = "iteration-3";
          await this.surrender(session, failure);
          return;
        }
      }

      session.surrenderReason = "iteration-3";
      await this.surrender(session, failure);
    } finally {
      clearTimeout(statusTimer);
    }
  }

  /**
   * Run one execute+reflect+reverify cycle.
   * Returns { recovered: true, recoveredContent } on success, or { recovered: false } on failure.
   */
  private async runOneAttempt(
    session: FixSession,
    failure: CapabilityFailure,
  ): Promise<{ recovered: boolean; recoveredContent?: string; escalate?: boolean }> {
    const attemptStartedAt = this.deps.now();

    // Build fix-mode invocation prompt
    const cap = this.deps.capabilityRegistry.get(failure.capabilityType);
    const fixPrompt = this.buildFixModeInvocation(failure, session, cap?.path, failure.detail ?? undefined);

    // Budget check before spawning execute job (M9.6-S6 D3: tag the session so
    // surrender() knows this was a budget-exhaustion bail, not a 3-attempts bail).
    if (session.totalJobsSpawned >= 4) {
      session.surrenderReason = "budget";
      return { recovered: false };
    }

    // Spawn fix-phase automation (Opus — routes to MODE: FIX path in capability-brainstorming)
    let executeJobId: string;
    let executeAutomationId: string;
    try {
      const spawned = await this.deps.spawnAutomation({
        name: `cfr-fix-${failure.capabilityType}-a${session.attemptNumber}-exec-${randomUUID().slice(0, 8)}`,
        model: "opus",
        autonomy: "standard",
        prompt: fixPrompt,
        jobType: "capability_modify",
        targetPath: cap?.path,
        smokeOutput: failure.detail ?? undefined,
        parent: session.executeJobId
          ? { jobId: session.executeJobId, iteration: session.attemptNumber }
          : undefined,
      });
      executeJobId = spawned.jobId;
      executeAutomationId = spawned.automationId;
      session.executeJobId = executeJobId;
      session.totalJobsSpawned += 1;
    } catch (err) {
      console.error("[RecoveryOrchestrator] Failed to spawn execute job:", err);
      return { recovered: false };
    }

    // Await execute job
    const executeResult = await this.deps.awaitAutomation(executeJobId, JOB_TIMEOUT_MS);
    const executeSuccess =
      executeResult.status === "done" || executeResult.status === "needs_review";

    // Read deliverable
    const deliverable = this.readDeliverable(executeJobId);
    const hypothesis = deliverable?.frontmatter.summary ?? "(no deliverable)";
    const change = deliverable?.body.slice(0, 500) ?? "";

    // ESCALATE: marker — fix-mode signals that the problem requires redesign or lacks context.
    // Skip reverify and remaining attempts; surrender immediately with the appropriate reason.
    if (deliverable?.body && deliverable.body.trimStart().startsWith("ESCALATE:")) {
      const firstLine = deliverable.body.trimStart().split("\n")[0] ?? "";
      if (firstLine.includes("redesign-needed")) {
        session.surrenderReason = "redesign-needed";
      } else if (firstLine.includes("insufficient-context")) {
        session.surrenderReason = "insufficient-context";
      } else {
        // FU-2: unrecognised ESCALATE reason — log so it's not silently swallowed.
        console.warn(
          `[RecoveryOrchestrator] ESCALATE with unrecognised reason in firstLine: "${firstLine}"`,
        );
      }
      // FU-1: push synthetic FixAttempt so the paper trail is complete in CFR_RECOVERY.md.
      session.attempts.push({
        attempt: session.attemptNumber,
        startedAt: attemptStartedAt,
        endedAt: this.deps.now(),
        hypothesis,
        change,
        verificationInputPath: failure.triggeringInput.artifact?.rawMediaPath ?? "",
        verificationResult: "fail",
        failureMode: `escalate: ${firstLine.trim() || "no reason given"}`,
        jobId: executeJobId,
        modelUsed: "opus",
        phase: "execute",
      });
      return { recovered: false, escalate: true };
    }

    if (!executeSuccess) {
      // Execute failed — record attempt, skip reflect
      const attempt: FixAttempt = {
        attempt: session.attemptNumber,
        startedAt: attemptStartedAt,
        endedAt: this.deps.now(),
        hypothesis,
        change,
        verificationInputPath: failure.triggeringInput.artifact?.rawMediaPath ?? "",
        verificationResult: "fail",
        failureMode: `execute job ${executeResult.status}`,
        jobId: executeJobId,
        modelUsed: "opus",
        phase: "execute",
      };
      session.attempts.push(attempt);

      nextAction(session, { type: "EXECUTE_JOB_DONE", success: false });
      return { recovered: false };
    }

    console.log(
      `[RecoveryOrchestrator] attempt ${session.attemptNumber} execute done — status=${executeResult.status} success=${executeSuccess}`,
    );

    // Execute succeeded — record and move directly to reverify (reflect phase removed in S17).
    const executeAttempt: FixAttempt = {
      attempt: session.attemptNumber,
      startedAt: attemptStartedAt,
      endedAt: this.deps.now(),
      hypothesis,
      change,
      verificationInputPath: failure.triggeringInput.artifact?.rawMediaPath ?? "",
      verificationResult: "pass",
      jobId: executeJobId,
      modelUsed: "opus",
      phase: "execute",
    };
    session.attempts.push(executeAttempt);

    session.state = "REVERIFYING";
    nextAction(session, { type: "EXECUTE_JOB_DONE", success: true });

    return await this.doReverify(failure, session, executeAttempt);
  }

  /**
   * Run reverify and return whether recovery succeeded.
   */
  private async doReverify(
    failure: CapabilityFailure,
    session: FixSession,
    executeAttempt: FixAttempt,
  ): Promise<{ recovered: boolean; recoveredContent?: string }> {
    console.log(
      `[RecoveryOrchestrator] doReverify start — type=${failure.capabilityType} attempt=${session.attemptNumber} ` +
        `hasRawMediaPath=${!!(failure.triggeringInput.artifact?.rawMediaPath)} ` +
        `hasInvoker=${!!this.deps.invoker}`,
    );
    try {
      const result = await dispatchReverify(failure, this.deps.capabilityRegistry, this.deps.watcher, this.deps.invoker);
      console.log(
        `[RecoveryOrchestrator] doReverify result — pass=${result.pass} ` +
          `recoveredContent=${result.recoveredContent !== undefined ? `"${result.recoveredContent.slice(0, 50)}..."` : "undefined"} ` +
          `failureMode=${result.failureMode ?? "—"}`,
      );

      if (result.pass) {
        if (result.verificationInputPath) {
          executeAttempt.verificationInputPath = result.verificationInputPath;
        }
        executeAttempt.verificationResult = "pass";
        return { recovered: true, recoveredContent: result.recoveredContent };
      } else {
        if (result.verificationInputPath) {
          executeAttempt.verificationInputPath = result.verificationInputPath;
        }
        executeAttempt.verificationResult = "fail";
        executeAttempt.failureMode = result.failureMode;
        nextAction(session, { type: "REVERIFY_FAIL" });
        return { recovered: false };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[RecoveryOrchestrator] Reverify threw:", err);
      executeAttempt.verificationResult = "fail";
      executeAttempt.failureMode = `reverify threw: ${message}`;
      nextAction(session, { type: "REVERIFY_FAIL" });
      return { recovered: false };
    }
  }

  /**
   * Terminal surrender path: run the 6-step terminal drain (Task 6b) with
   * `outcome: "surrendered"`. The drain records SurrenderScope (conversation
   * only, Option A), writes CFR_RECOVERY.md for automation origins, emits the
   * terminal ack for conversation origins, and logs for system origins.
   */
  private async surrender(session: FixSession, failure: CapabilityFailure): Promise<void> {
    session.state = "SURRENDER";
    await this.terminalDrain(failure, session, { outcome: "surrendered" });
  }

  // ─── Terminal drain (M9.6-S12 Task 6b) ─────────────────────────────────────

  /**
   * Six-step terminal drain (design §3.4). Runs once per fix session on the
   * terminal transition — reverify pass (`outcome: "fixed"`) or surrender
   * (`outcome: "surrendered"`).
   *
   * Step order:
   *   1. Fix job's deliverable.md already persisted by the job runner; the
   *      framework's writePaperTrail already appended — no work here.
   *   2. Caller has already determined the outcome (`fixed` vs `surrendered`).
   *      For surrendered outcomes, record the SurrenderScope for any attached
   *      conversation origins (Option A — D6: automation/system skip).
   *   3. For every attached automation origin: write CFR_RECOVERY.md, then
   *      emit the terminal ack (which may fire a notification for
   *      `notifyMode === "immediate"`).
   *   4. For every attached conversation origin: if `recoveredContent` is
   *      defined → `reprocessTurn`; else → terminal `emitAck`.
   *   5. For every attached system origin: console.log.
   *   6. Release per-type mutex (handled by `handle()`'s `finally`).
   *
   * Each per-origin callback is wrapped in its own try/catch so a failure in
   * one origin doesn't block processing for the rest (failure isolation is a
   * spec requirement). Automations (step 3) run before conversations (step 4)
   * so the durable record lands before any user-facing ack.
   */
  private async terminalDrain(
    failure: CapabilityFailure,
    session: FixSession,
    args: { outcome: "fixed" | "terminal-fixed" | "surrendered"; recoveredContent?: string },
  ): Promise<void> {
    const { outcome, recoveredContent } = args;

    // Step 2: record SurrenderScope for conversation origins (surrender only).
    if (outcome === "surrendered") {
      for (const origin of session.attachedOrigins) {
        try {
          this.recordSurrender(origin, session.capabilityType);
        } catch (err) {
          console.error(
            `[RecoveryOrchestrator] recordSurrender threw for origin.kind="${origin.kind}":`,
            err,
          );
        }
      }
    }

    // Bucket origins by kind so we can guarantee the spec's ordering:
    // automations → conversations → system.
    const automationOrigins = session.attachedOrigins.filter(
      (o): o is Extract<TriggeringOrigin, { kind: "automation" }> =>
        o.kind === "automation",
    );
    const conversationOrigins = session.attachedOrigins.filter(
      (o): o is Extract<TriggeringOrigin, { kind: "conversation" }> =>
        o.kind === "conversation",
    );
    const systemOrigins = session.attachedOrigins.filter(
      (o): o is Extract<TriggeringOrigin, { kind: "system" }> =>
        o.kind === "system",
    );

    const terminalAckKind: AckKind =
      session.surrenderReason === "budget" ? "surrender-budget" :
      session.surrenderReason === "redesign-needed" ? "surrender-redesign-needed" :
      session.surrenderReason === "insufficient-context" ? "surrender-insufficient-context" :
      "surrender";

    // Step 3: automation origins — durable record, then terminal ack.
    for (const origin of automationOrigins) {
      const perOriginFailure = withOrigin(failure, origin);
      try {
        if (this.deps.writeAutomationRecovery) {
          this.deps.writeAutomationRecovery({
            failure: perOriginFailure,
            runDir: origin.runDir,
            outcome,
            session: {
              attempts: session.attempts,
              surrenderReason: session.surrenderReason,
            },
          });
        } else {
          console.warn(
            `[RecoveryOrchestrator] No writeAutomationRecovery dep — ` +
              `CFR_RECOVERY.md not written for automation ${origin.automationId}/${origin.jobId}`,
          );
        }
      } catch (err) {
        console.error(
          `[RecoveryOrchestrator] writeAutomationRecovery threw for job ${origin.jobId}:`,
          err,
        );
      }
      // Emit terminal ack so the notifier path fires for immediate-mode
      // automations. AckDelivery.deliver() will no-op for the "fixed" outcome
      // path (kind is still surrender-shaped here only for surrender); for the
      // "fixed" case we skip the ack entirely — debrief-prep (Task 7) reads
      // CFR_RECOVERY.md and the notifyMode === "immediate" notifier for
      // "fixed" outcomes is Phase-3 work (S19 FOLLOW-UP).
      if (outcome === "surrendered") {
        try {
          await this.deps.emitAck(perOriginFailure, terminalAckKind);
        } catch (err) {
          console.error(
            `[RecoveryOrchestrator] emitAck threw for automation ${origin.automationId}:`,
            err,
          );
        }
      }
    }

    // Step 4: conversation origins — reprocess on success, terminal ack on surrender.
    for (const origin of conversationOrigins) {
      const perOriginFailure = withOrigin(failure, origin);
      try {
        if (outcome === "fixed" && recoveredContent !== undefined) {
          await this.deps.reprocessTurn(perOriginFailure, recoveredContent);
        } else if (outcome === "terminal-fixed") {
          await this.deps.emitAck(perOriginFailure, "terminal-fixed");
        } else {
          await this.deps.emitAck(perOriginFailure, terminalAckKind);
        }
      } catch (err) {
        console.error(
          `[RecoveryOrchestrator] conversation drain threw for conv ${origin.conversationId} turn ${origin.turnNumber}:`,
          err,
        );
      }
    }

    // Step 5: system origins — log.
    for (const origin of systemOrigins) {
      try {
        console.log(
          `[RecoveryOrchestrator] terminal drain for system origin ` +
            `component="${origin.component}" capability=${session.capabilityType} ` +
            `outcome=${outcome}` +
            (session.surrenderReason ? ` reason=${session.surrenderReason}` : ""),
        );
      } catch (err) {
        console.error(
          `[RecoveryOrchestrator] system drain threw for component="${origin.component}":`,
          err,
        );
      }
    }

    // Step 6: release per-type mutex — handled by handle()'s finally block.
  }

  /**
   * Read and parse `deliverable.md` from a job's run directory.
   * Returns null if the job has no run dir or the file doesn't exist.
   */
  private readDeliverable(jobId: string): ParsedDeliverable | null {
    const runDir = this.deps.getJobRunDir(jobId);
    if (!runDir) return null;

    const deliverablePath = join(runDir, "deliverable.md");
    if (!existsSync(deliverablePath)) return null;

    try {
      const raw = readFileSync(deliverablePath, "utf-8");
      const { data, body } = parseFrontmatterContent<DeliverableFrontmatter>(raw);
      return { frontmatter: data, body };
    } catch {
      return null;
    }
  }

  /**
   * Build the fix-mode invocation prompt for the capability-brainstorming skill.
   * Prompt begins with "MODE: FIX" so Step 0 of the skill routes to the fix-only path.
   * Cold Opus run on an unfamiliar plug is projected at 5–12 min — JOB_TIMEOUT_MS is 15 min.
   *
   * smokeOutput: the raw output from the failing script invocation (failure.detail for
   * execution-error / timeout failures). Appended as ## Smoke Output so the fix agent
   * doesn't re-run diagnostics when the evidence is already available.
   */
  private buildFixModeInvocation(
    failure: CapabilityFailure,
    session: FixSession,
    capPath: string | undefined,
    smokeOutput?: string,
  ): string {
    const { capabilityType, capabilityName, symptom, detail, previousAttempts } = failure;

    const allAttempts = [...previousAttempts, ...session.attempts];
    const attemptsSection =
      allAttempts.length === 0
        ? "_No previous attempts._"
        : `| Attempt | Hypothesis | Result | Failure mode |\n|---|---|---|---|\n` +
          allAttempts
            .map(
              (a) =>
                `| ${a.attempt} | ${a.hypothesis} | ${a.verificationResult} | ${a.failureMode ?? "—"} |`,
            )
            .join("\n");

    const capDirLine = capPath
      ? `- **Capability folder:** \`${capPath}\``
      : `- **Capability folder:** (not found in registry — try \`.my_agent/capabilities/${capabilityName ?? capabilityType}\` if it exists)`;

    const smokeSection = smokeOutput
      ? `\n\n## Smoke Output\n\n\`\`\`\n${smokeOutput}\n\`\`\``
      : "";

    return `MODE: FIX

You have been invoked by the recovery orchestrator because a capability failed.

## Failure Context

${capDirLine}
- **Capability:** ${capabilityName ?? capabilityType} (type: ${capabilityType})
- **Symptom:** ${symptom}
- **Detail:** ${detail ?? "—"}
- **Attempt:** ${session.attemptNumber}/3

## Previous Attempts

${attemptsSection}${smokeSection}`;
  }

}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Return a shallow copy of `failure` whose `triggeringInput.origin` is
 * overridden with `origin`. Used inside the terminal drain to route each
 * attached origin through consumers (`emitAck`, `reprocessTurn`,
 * `writeAutomationRecovery`) that read `failure.triggeringInput.origin` to
 * pick their behavior.
 */
function withOrigin(
  failure: CapabilityFailure,
  origin: TriggeringOrigin,
): CapabilityFailure {
  const nextInput: TriggeringInput = {
    ...failure.triggeringInput,
    origin,
  };
  return { ...failure, triggeringInput: nextInput };
}
