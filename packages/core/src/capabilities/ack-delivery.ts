/**
 * ack-delivery.ts — Channel-aware delivery of framework-originated ack messages.
 *
 * The recovery orchestrator calls AckDelivery.deliver() to tell the user that
 * a capability failed and a fix is in progress. The ack must go back on the
 * same channel the user's original turn arrived on: WhatsApp voice note → WhatsApp
 * text reply; dashboard user turn → dashboard WS broadcast.
 *
 * This module lives in `packages/core` and therefore cannot import from
 * `packages/dashboard` (circular). The deps it needs are expressed as
 * structural `*Like` interfaces the dashboard layer satisfies — same pattern
 * used by orphan-watchdog.ts in S5.
 *
 * Created in M9.6-S6.
 *
 * M9.6-S12 (Task 5): origin-aware routing. The S9 placeholder throw (which
 * existed for the non-conversation origins) has been replaced with three
 * branches:
 *
 *   - conversation → existing transport-routing logic (unchanged).
 *   - automation   → write `CFR_RECOVERY.md` to `origin.runDir` on terminal
 *                    transition (surrender kinds today; `"fixed"` outcome
 *                    lands in Task 6's terminal drain). `notifyMode` controls
 *                    whether a notification fires; it never controls whether
 *                    the durable record is written.
 *   - system       → log only. Dashboard health-page surfacing is deferred to
 *                    S19 (Phase 3, see `s12-FOLLOW-UPS.md`).
 *
 * `CFR_RECOVERY.md` schema is load-bearing — `debrief-prep` reads it in Task 7.
 * See `s12-DECISIONS.md §D5` for the canonical shape.
 */

import { join } from "node:path";
import type { CapabilityFailure, FixAttempt } from "./cfr-types.js";
import type { AckKind } from "./recovery-orchestrator.js";
import { writeFrontmatter } from "../metadata/frontmatter.js";

// ─── Structural types (no cross-package imports) ─────────────────────────────

/**
 * Minimal TransportManager shape — matches
 * `packages/dashboard/src/channels/manager.ts:70`.
 */
export interface TransportManagerLike {
  /**
   * Send a message to the recipient identified by `to` via the named transport.
   * Throws if the transport is unknown or disconnected.
   */
  send(
    transportId: string,
    to: string,
    message: { content: string; replyTo?: string },
  ): Promise<void>;
}

/**
 * Minimal ConnectionRegistry shape — matches
 * `packages/dashboard/src/ws/connection-registry.ts:19`.
 *
 * We use `broadcastToConversation` with a loose `ServerMessage`-compatible
 * payload so the dashboard surfaces the ack as a normal assistant turn.
 */
export interface ConnectionRegistryLike {
  broadcastToConversation(
    conversationId: string,
    message: unknown,
  ): void;
}

/**
 * Notifier for automation-origin terminal transitions.
 *
 * Only called when `notifyMode === "immediate"`. Structural shape so the
 * dashboard layer can satisfy it without pulling core types into its notifier
 * implementation. Missing notifier → the automation branch still writes the
 * CFR_RECOVERY.md file and logs a warning; notification is best-effort.
 *
 * The dashboard's full notification surface (alert/initiate fan-out) is not
 * modeled here — a concrete notifier just needs to "nudge the user on a
 * channel that makes sense for the currently active preferred route".
 */
export interface AutomationNotifierLike {
  /** Fire a one-shot notification for an automation-origin terminal CFR transition. */
  notify(args: {
    automationId: string;
    jobId: string;
    runDir: string;
    capabilityType: string;
    capabilityName?: string;
    outcome: "fixed" | "surrendered";
    message: string;
  }): Promise<void>;
}

// ─── AckDelivery ─────────────────────────────────────────────────────────────

/** Transport ID used by the dashboard (WS) channel. */
const DASHBOARD_TRANSPORT_ID = "dashboard";

/** File name for the per-job CFR recovery record. Parsed by `debrief-prep.ts`. */
export const CFR_RECOVERY_FILENAME = "CFR_RECOVERY.md";

/**
 * Session context required to populate `CFR_RECOVERY.md` on a terminal
 * transition. Sourced from the orchestrator's `FixSession`. Passed via the
 * optional `context.session` parameter on `deliver()`; Task 6's terminal-drain
 * will wire this through from `RecoveryOrchestrator.surrender()`. When
 * `session` is undefined (current Task 5 pre-wiring path), the writer still
 * emits the schema but with `attempts: 0` and an empty attempts table — better
 * than losing the CFR entirely.
 */
export interface AckDeliverySessionInfo {
  attempts: FixAttempt[];
  surrenderReason?: "budget" | "iteration-3";
}

/** Optional delivery context — surfaces the ack kind and session info. */
export interface DeliveryContext {
  /** Kind of ack being delivered. Determines terminal branching for automation origins. */
  kind?: AckKind;
  /** Session info for CFR_RECOVERY.md when origin is automation and kind is terminal. */
  session?: AckDeliverySessionInfo;
}

/** Kinds that mark a terminal transition (end of the fix loop). */
function isTerminalKind(kind: AckKind | undefined): boolean {
  return kind === "surrender" || kind === "surrender-budget";
}

/**
 * Deliver a framework-originated ack to the same channel the user's triggering
 * turn arrived on. Exceptions are caught and logged — a failed ack must not
 * crash the orchestrator.
 */
export class AckDelivery {
  constructor(
    private transportManager: TransportManagerLike,
    private connectionRegistry: ConnectionRegistryLike,
    /**
     * Optional notifier for automation-origin terminal transitions with
     * `notifyMode === "immediate"`. Absent notifier is non-fatal — the file
     * still gets written and a warning is logged.
     */
    private automationNotifier?: AutomationNotifierLike,
  ) {}

  async deliver(
    failure: CapabilityFailure,
    text: string,
    context?: DeliveryContext,
  ): Promise<void> {
    const { origin } = failure.triggeringInput;

    // ── conversation ─────────────────────────────────────────────────────────
    if (origin.kind === "conversation") {
      const { channel, conversationId } = origin;

      // Dashboard channel: broadcast as an assistant-style system message over WS.
      if (channel.transportId === DASHBOARD_TRANSPORT_ID) {
        try {
          this.connectionRegistry.broadcastToConversation(conversationId, {
            type: "capability_ack",
            conversationId,
            content: text,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          console.error(
            "[AckDelivery] Failed to broadcast dashboard ack:",
            err,
          );
        }
        return;
      }

      // External transport (WhatsApp, etc.): route through TransportManager.
      try {
        await this.transportManager.send(channel.transportId, channel.sender, {
          content: text,
          replyTo: channel.replyTo,
        });
      } catch (err) {
        console.error(
          `[AckDelivery] Failed to send ack via ${channel.transportId} to ${channel.sender}:`,
          err,
        );
      }
      return;
    }

    // ── automation ───────────────────────────────────────────────────────────
    if (origin.kind === "automation") {
      // Only terminal kinds produce a CFR_RECOVERY.md record. Non-terminal
      // kinds (attempt / status / surrender-cooldown) for automation origins
      // are no-ops at the ack layer — the debrief surface carries the narrative
      // for automations, not a live channel reply mid-job (see D2).
      if (!isTerminalKind(context?.kind)) {
        return;
      }

      const outcome: "fixed" | "surrendered" = "surrendered";
      try {
        this.writeAutomationRecovery({
          failure,
          runDir: origin.runDir,
          outcome,
          session: context?.session,
        });
      } catch (err) {
        console.error(
          `[AckDelivery] Failed to write ${CFR_RECOVERY_FILENAME} to ${origin.runDir}:`,
          err,
        );
        return; // skip notification if write failed — nothing durable to point to.
      }

      // Fire notification only when explicitly requested. `debrief` and `none`
      // both skip notification — `debrief` is the system default (D2); the
      // debrief-prep reader (Task 7) pulls the CFR_RECOVERY.md content into
      // the next debrief cycle instead.
      if (origin.notifyMode === "immediate") {
        if (this.automationNotifier) {
          try {
            await this.automationNotifier.notify({
              automationId: origin.automationId,
              jobId: origin.jobId,
              runDir: origin.runDir,
              capabilityType: failure.capabilityType,
              capabilityName: failure.capabilityName,
              outcome,
              message: text,
            });
          } catch (err) {
            console.error(
              "[AckDelivery] Automation notifier threw — file already written, continuing:",
              err,
            );
          }
        } else {
          // TODO (s12-FOLLOW-UPS): wire a concrete AutomationNotifier impl
          // through app.ts when automation-origin notification UX is scoped.
          console.warn(
            `[AckDelivery] notifyMode=immediate but no AutomationNotifier configured — ` +
              `CFR_RECOVERY.md was written to ${origin.runDir} but no notification fired.`,
          );
        }
      }
      return;
    }

    // ── system ───────────────────────────────────────────────────────────────
    if (origin.kind === "system") {
      const outcome = isTerminalKind(context?.kind) ? "surrendered" : "in-progress";
      console.log(
        `[CFR] capability ${failure.capabilityName ?? "(unknown)"} ` +
          `(${failure.capabilityType}): ${failure.symptom} → ${outcome} ` +
          `[component=${origin.component}]`,
      );
      return;
    }

    // Exhaustiveness guard — unreachable under the current TriggeringOrigin union.
    const _exhaust: never = origin;
    void _exhaust;
  }

  /**
   * Write `CFR_RECOVERY.md` to the automation job's run dir.
   *
   * Exposed as a public method so Task 6's six-step terminal drain in
   * `recovery-orchestrator.ts` can call it directly for the `"fixed"` outcome
   * (which doesn't flow through `emitAck`). Task 5 only invokes it from the
   * automation branch of `deliver()`.
   *
   * Schema: see `s12-DECISIONS.md §D5`.
   */
  writeAutomationRecovery(args: {
    failure: CapabilityFailure;
    runDir: string;
    outcome: "fixed" | "terminal-fixed" | "surrendered";
    session?: AckDeliverySessionInfo;
  }): string {
    const { failure, runDir, outcome, session } = args;
    const attempts = session?.attempts ?? [];
    const surrenderReason = session?.surrenderReason;
    const resolvedAt = new Date().toISOString();

    const frontmatter: Record<string, unknown> = {
      plug_name: failure.capabilityName ?? failure.capabilityType,
      plug_type: failure.capabilityType,
      detected_at: failure.detectedAt,
      resolved_at: resolvedAt,
      attempts: attempts.length,
      outcome,
    };
    if (outcome === "surrendered" && surrenderReason) {
      frontmatter.surrender_reason = surrenderReason;
    }

    const plugName = failure.capabilityName ?? failure.capabilityType;
    const body = buildRecoveryBody({
      plugName,
      outcome,
      attempts,
      surrenderReason,
      symptomDetail: failure.detail,
    });

    const filePath = join(runDir, CFR_RECOVERY_FILENAME);
    writeFrontmatter(filePath, frontmatter, body);
    return filePath;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Escape a cell value for a GitHub-flavored markdown table. Line breaks and
 * pipes in the hypothesis/change strings would otherwise break the table shape.
 */
function escapeTableCell(raw: string): string {
  return raw
    .replace(/\r?\n+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function buildRecoveryBody(args: {
  plugName: string;
  outcome: "fixed" | "terminal-fixed" | "surrendered";
  attempts: FixAttempt[];
  surrenderReason?: "budget" | "iteration-3";
  symptomDetail?: string;
}): string {
  const { plugName, outcome, attempts, surrenderReason, symptomDetail } = args;

  // Opening paragraph: pull from the final attempt's hypothesis (populated
  // from its deliverable.md summary), or fall back to a surrender explanation.
  let summaryParagraph: string;
  if (outcome === "fixed") {
    const last = attempts[attempts.length - 1];
    summaryParagraph =
      last?.hypothesis ??
      `The ${plugName} capability was recovered.`;
  } else {
    const reasonText = surrenderReason
      ? surrenderReasonToSentence(surrenderReason)
      : "The fix loop exhausted without recovering the capability.";
    const tail = symptomDetail ? ` Last symptom detail: ${symptomDetail}.` : "";
    summaryParagraph = `${reasonText}${tail}`;
  }

  const tableHeader = `| # | Hypothesis | Change | Result |\n|---|---|---|---|`;
  const tableRows = attempts.length
    ? attempts
        .map((a) => {
          const resultCell = a.verificationResult === "pass"
            ? "pass"
            : `fail${a.failureMode ? `: ${a.failureMode}` : ""}`;
          return `| ${a.attempt} | ${escapeTableCell(a.hypothesis)} | ${escapeTableCell(a.change)} | ${escapeTableCell(resultCell)} |`;
        })
        .join("\n")
    : "| — | _No attempts recorded._ | — | — |";

  return `# ${plugName} recovery summary\n\n${summaryParagraph}\n\n## Attempts\n\n${tableHeader}\n${tableRows}\n`;
}

function surrenderReasonToSentence(reason: "budget" | "iteration-3"): string {
  switch (reason) {
    case "budget":
      return "Surrendered: the fix loop hit the 5-job automation budget before the capability could be recovered.";
    case "iteration-3":
      return "Surrendered: three consecutive fix attempts failed to recover the capability.";
  }
}
