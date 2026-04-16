/**
 * resilience-messages.ts — User-facing copy for CFR ack/status/surrender turns.
 *
 * Keeps the exact strings in one place so the orchestrator, ack-delivery, and
 * tests all agree on the wording. Copy is verbatim from the M9.6 plan §8.1.
 *
 * Created in M9.6-S6.
 */

import type { CapabilityFailure } from "./cfr-types.js";

export type SurrenderReason = "budget" | "iteration-3";

export interface ResilienceCopy {
  ack(failure: CapabilityFailure): string;
  status(failure: CapabilityFailure, elapsedSec: number): string;
  surrender(failure: CapabilityFailure, reason: SurrenderReason): string;
}

/**
 * Friendly names for capability types. Used to substitute into fallback copy
 * when the capability is not audio-to-text.
 */
const FRIENDLY_NAMES: Record<string, string> = {
  "audio-to-text": "voice transcription",
  "image-to-text": "image understanding",
  "text-to-audio": "voice reply",
  "text-to-image": "image generation",
};

function friendlyName(capabilityType: string): string {
  return FRIENDLY_NAMES[capabilityType] ?? capabilityType;
}

/**
 * Default copy table. All strings are verbatim from the plan.
 *
 * Ack:
 *   - audio-to-text + (deps-missing | not-enabled | not-installed): "hold on — voice transcription isn't working right, fixing now."
 *   - audio-to-text + execution-error: "voice transcription just hit an error — let me fix that."
 *   - other capability types: "hold on — {friendlyName} isn't working right, fixing now."
 *
 * Status (>20s elapsed): "still fixing — second attempt."
 *
 * Surrender (iteration-3): "I tried three fixes and voice transcription isn't working today. could you resend as text? I've logged the issue."
 * Surrender (budget): "I've hit the fix budget for this turn. could you resend as text while I look into it? I've logged the issue."
 */
export const defaultCopy: ResilienceCopy = {
  ack(failure: CapabilityFailure): string {
    const { capabilityType, symptom } = failure;

    if (capabilityType === "audio-to-text") {
      if (symptom === "execution-error") {
        return "voice transcription just hit an error — let me fix that.";
      }
      // deps-missing, not-enabled, not-installed, empty-result, timeout, validation-failed
      return "hold on — voice transcription isn't working right, fixing now.";
    }

    return `hold on — ${friendlyName(capabilityType)} isn't working right, fixing now.`;
  },

  status(_failure: CapabilityFailure, _elapsedSec: number): string {
    return "still fixing — second attempt.";
  },

  surrender(_failure: CapabilityFailure, reason: SurrenderReason): string {
    if (reason === "budget") {
      return "I've hit the fix budget for this turn. could you resend as text while I look into it? I've logged the issue.";
    }
    // iteration-3
    return "I tried three fixes and voice transcription isn't working today. could you resend as text? I've logged the issue.";
  },
};
