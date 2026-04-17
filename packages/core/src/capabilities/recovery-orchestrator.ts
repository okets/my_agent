/**
 * recovery-orchestrator.ts — Drives the CFR recovery loop for failed capabilities.
 *
 * When the CfrEmitter fires a CapabilityFailure, the RecoveryOrchestrator:
 *   1. Checks surrender cooldown / in-flight deduplication.
 *   2. Uses orchestrator-state-machine.ts to drive a fix loop (up to 3 attempts).
 *   3. Spawns an execute-phase automation (Sonnet) per attempt.
 *   4. Spawns a reflect-phase automation (Opus) after each successful execute.
 *   5. Reverifies the fix against the user's actual triggering artifact.
 *   6. On success: injects a mediator-framed system message to re-process the turn.
 *   7. On exhaustion: records a SurrenderScope with 10-min cooldown.
 *
 * Created in M9.6-S4.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CapabilityFailure, SurrenderScope, FixAttempt } from "./cfr-types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityWatcher } from "./watcher.js";
import type { CapabilityInvoker } from "./invoker.js";
import { nextAction, type FixSession } from "./orchestrator-state-machine.js";
import { reverify } from "./reverify.js";
import { parseFrontmatterContent } from "../metadata/frontmatter.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type AckKind = "attempt" | "status" | "surrender" | "surrender-budget" | "surrender-cooldown";

export interface AutomationSpec {
  name: string;
  model: "opus" | "sonnet";
  autonomy: "cautious" | "standard";
  prompt: string;
  jobType: "capability_modify";
  parent?: { jobId: string; iteration: number };
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
  now: () => string;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/** Max time to wait for a single automation job (10 minutes) */
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

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
    if (origin.kind !== "conversation") {
      // S12 wires automation and system origins. S9: unreachable.
      throw new Error(`unreachable in S9 — wired in S12: origin.kind === "${origin.kind}"`);
    }
    const { conversationId, turnNumber } = origin;

    // 1. Check cross-conversation surrender cooldown
    if (this.isSurrendered(capabilityType)) {
      console.log(
        `[RecoveryOrchestrator] ${capabilityType} in surrender cooldown — skipping recovery for conv ${conversationId}`,
      );
      await this.deps.emitAck(failure, "surrender-cooldown");
      return;
    }

    // 2. Dedup: if a fix is already in-flight for this capability type, attach silently
    if (this.inFlight.has(capabilityType)) {
      console.log(
        `[RecoveryOrchestrator] ${capabilityType} fix already in-flight — attaching conv ${conversationId} turn ${turnNumber}`,
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

  /** Record a surrender scope for a given failure */
  private recordSurrender(failure: CapabilityFailure): void {
    const { origin } = failure.triggeringInput;
    if (origin.kind !== "conversation") {
      // S12 wires automation and system surrender routing. S9: unreachable.
      throw new Error(`unreachable in S9 — wired in S12: origin.kind === "${origin.kind}"`);
    }
    const { conversationId, turnNumber } = origin;
    const key = `${failure.capabilityType}:${conversationId}:${turnNumber}`;
    const expiresAt = new Date(Date.now() + SURRENDER_COOLDOWN_MS).toISOString();
    this.surrendered.set(key, {
      capabilityType: failure.capabilityType,
      conversationId,
      turnNumber,
      expiresAt,
    });
    console.warn(
      `[RecoveryOrchestrator] SURRENDER ${failure.capabilityType} — conv ${conversationId} turn ${turnNumber} — cooldown until ${expiresAt}`,
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
      if (session.state !== "DONE" && session.state !== "SURRENDER") {
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

        if (attemptResult.recovered) {
          // Reverify passed — re-process the original turn
          const reprocessAction = nextAction(session, {
            type: "REVERIFY_PASS",
            recoveredContent: attemptResult.recoveredContent!,
          });
          if (reprocessAction.action === "REPROCESS_TURN") {
            session.state = "DONE";
            await this.deps.reprocessTurn(failure, reprocessAction.recoveredContent);
            nextAction(session, { type: "REPROCESS_SENT" });
            return;
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
  ): Promise<{ recovered: boolean; recoveredContent?: string }> {
    const attemptStartedAt = this.deps.now();

    // Build execute prompt from template
    const executePrompt = this.renderPrompt(failure, session);

    // Budget check before spawning execute job (M9.6-S6 D3: tag the session so
    // surrender() knows this was a budget-exhaustion bail, not a 3-attempts bail).
    if (session.totalJobsSpawned >= 5) {
      session.surrenderReason = "budget";
      return { recovered: false };
    }

    // Spawn execute-phase automation (Sonnet)
    let executeJobId: string;
    let executeAutomationId: string;
    try {
      const spawned = await this.deps.spawnAutomation({
        name: `cfr-fix-${failure.capabilityType}-a${session.attemptNumber}-exec-${randomUUID().slice(0, 8)}`,
        model: "sonnet",
        autonomy: "standard",
        prompt: executePrompt,
        jobType: "capability_modify",
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
        modelUsed: "sonnet",
        phase: "execute",
      };
      session.attempts.push(attempt);

      nextAction(session, { type: "EXECUTE_JOB_DONE", success: false });
      return { recovered: false };
    }

    // Execute succeeded — record and move to REFLECTING
    const executeAttempt: FixAttempt = {
      attempt: session.attemptNumber,
      startedAt: attemptStartedAt,
      endedAt: this.deps.now(),
      hypothesis,
      change,
      verificationInputPath: failure.triggeringInput.artifact?.rawMediaPath ?? "",
      verificationResult: "pass",
      jobId: executeJobId,
      modelUsed: "sonnet",
      phase: "execute",
    };
    session.attempts.push(executeAttempt);

    session.state = "REFLECTING";
    nextAction(session, { type: "EXECUTE_JOB_DONE", success: true });

    // Budget check before spawning reflect job
    if (session.totalJobsSpawned >= 5) {
      // Budget exhausted — still attempt reverify without reflect. If the
      // reverify passes, we recover normally; if it fails, runFixLoop will
      // drop through to surrender — tag the reason here so surrender picks
      // the "budget" copy rather than "iteration-3".
      const result = await this.doReverify(failure, session, executeAttempt);
      if (!result.recovered) {
        session.surrenderReason = "budget";
      }
      return result;
    }

    // Spawn reflect-phase automation (Opus)
    let reflectJobId: string;
    try {
      const reflectPrompt = this.renderReflectPrompt(failure, session, deliverable);
      const spawned = await this.deps.spawnAutomation({
        name: `cfr-fix-${failure.capabilityType}-a${session.attemptNumber}-reflect-${randomUUID().slice(0, 8)}`,
        model: "opus",
        autonomy: "cautious",
        prompt: reflectPrompt,
        jobType: "capability_modify",
        parent: { jobId: executeJobId, iteration: session.attemptNumber },
      });
      reflectJobId = spawned.jobId;
      session.reflectJobId = reflectJobId;
      session.totalJobsSpawned += 1;
    } catch (err) {
      console.error("[RecoveryOrchestrator] Failed to spawn reflect job:", err);
      // Still attempt reverify — execute may have been sufficient
      return await this.doReverify(failure, session, executeAttempt);
    }

    // Await reflect job
    await this.deps.awaitAutomation(reflectJobId, JOB_TIMEOUT_MS);
    const reflectDeliverable = this.readDeliverable(reflectJobId);
    const nextHypothesis =
      reflectDeliverable?.frontmatter.summary ??
      reflectDeliverable?.body.slice(0, 200) ??
      "no hypothesis from reflect phase";

    session.state = "REVERIFYING";
    nextAction(session, { type: "REFLECT_JOB_DONE", nextHypothesis });

    // Update the execute attempt with the next hypothesis from reflect
    executeAttempt.nextHypothesis = nextHypothesis;

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
    try {
      const result = await reverify(failure, this.deps.capabilityRegistry, this.deps.watcher, this.deps.invoker);

      if (result.pass && result.recoveredContent) {
        executeAttempt.verificationResult = "pass";
        return { recovered: true, recoveredContent: result.recoveredContent };
      } else {
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
   * Emit surrender ack and record the scope.
   * Uses `session.surrenderReason` to pick `"surrender-budget"` vs `"surrender"`
   * so the user-facing copy matches the actual cause of surrender (M9.6-S6).
   */
  private async surrender(session: FixSession, failure: CapabilityFailure): Promise<void> {
    session.state = "SURRENDER";
    this.recordSurrender(failure);
    const kind: AckKind =
      session.surrenderReason === "budget" ? "surrender-budget" : "surrender";
    await this.deps.emitAck(failure, kind);
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
   * Render the execute-phase prompt from the template.
   * Uses simple string replacement for {{placeholders}}.
   */
  private renderPrompt(failure: CapabilityFailure, session: FixSession): string {
    const { capabilityType, capabilityName, symptom, detail, previousAttempts } = failure;

    const previousAttemptsMarkdown =
      previousAttempts.length === 0 && session.attempts.length === 0
        ? "_No previous attempts._"
        : [...previousAttempts, ...session.attempts]
            .map(
              (a) =>
                `### Attempt ${a.attempt}\n` +
                `- **Hypothesis:** ${a.hypothesis}\n` +
                `- **Change made:** ${a.change}\n` +
                `- **Verification result:** ${a.verificationResult}\n` +
                `- **Failure mode:** ${a.failureMode ?? "—"}\n` +
                `- **Next hypothesis:** ${a.nextHypothesis ?? "—"}`,
            )
            .join("\n\n");

    const allAttempts = [...previousAttempts, ...session.attempts];

    return `# Fix Automation — ${capabilityType} (Attempt ${session.attemptNumber}/3)

## Failure Context

- **Capability:** ${capabilityName ?? capabilityType} (type: ${capabilityType})
- **Symptom:** ${symptom}
- **Detail:** ${detail ?? "—"}

## Previous Attempts

${previousAttemptsMarkdown}

## Your Task

Diagnose and fix the ${capabilityType} capability. The fix has failed ${allAttempts.length} time(s). Use the previous attempt history above to form a better hypothesis.

## Constraints — READ CAREFULLY

1. **Do NOT run \`systemctl\`, \`service\`, \`pkill\`, or any process-management command.** The framework hot-reloads capabilities when their files change. A restart is never the right fix.
2. **Do NOT read from \`<agentDir>/conversations/\`**. The orchestrator handles re-verification against the user's actual data. Your job is to fix the capability so it works.
3. **Your smoke test uses a synthetic fixture** in \`packages/core/tests/fixtures/capabilities/\`. The orchestrator will run the real re-verification after you finish.
4. **Do NOT declare success based on configuration checks alone.** Run the actual script against the fixture and confirm it produces valid output.

## Required Deliverables

Write \`deliverable.md\` in your run directory with YAML frontmatter:

---
change_type: config | script | deps | env
test_result: pass | fail
surface_required_for_hotreload: false
hypothesis_confirmed: true | false
summary: one-line description of what you changed
---

Then the body: what you changed, what the test showed, what the next hypothesis should be if it failed.`;
  }

  /**
   * Render the reflect-phase prompt — Opus summarises what happened and proposes a better hypothesis.
   */
  private renderReflectPrompt(
    failure: CapabilityFailure,
    session: FixSession,
    executeDeliverable: ParsedDeliverable | null,
  ): string {
    const { capabilityType } = failure;
    const deliverableSummary = executeDeliverable
      ? `**Summary:** ${executeDeliverable.frontmatter.summary ?? "—"}\n**Result:** ${executeDeliverable.frontmatter.test_result ?? "—"}\n\n${executeDeliverable.body.slice(0, 800)}`
      : "_No deliverable found from execute phase._";

    return `# Reflect — ${capabilityType} Fix Attempt ${session.attemptNumber}

You are reviewing the execute-phase result for a capability fix. Your job is to:
1. Assess whether the fix is likely to be correct.
2. Propose the best next hypothesis if it is not.

## Execute Phase Deliverable

${deliverableSummary}

## Your Deliverable

Write \`deliverable.md\` with YAML frontmatter:

---
change_type: config | script | deps | env
test_result: pass | fail
hypothesis_confirmed: true | false
summary: your assessment and next hypothesis in one line
---

Body: reasoning about what the execute agent did and what should be tried next.`;
  }
}
