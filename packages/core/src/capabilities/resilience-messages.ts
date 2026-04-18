/**
 * resilience-messages.ts — User-facing copy for CFR ack/status/surrender/terminal turns.
 *
 * Factory pattern (S14): createResilienceCopy(registry) returns a ResilienceCopy
 * object with registry-aware copy. Follows the same DI pattern as CapabilityInvoker
 * (S10) and createMcpCapabilityCfrDetector (S12).
 *
 * FRIENDLY_NAMES is still a hardcoded table (S14 decision D3 — see s14-DECISIONS.md).
 * Migration to frontmatter is tracked in s14-FOLLOW-UPS.md FU-1 for Phase 3.
 *
 * Created in M9.6-S6. Refactored to factory pattern in M9.6-S14.
 */

import type { CapabilityFailure } from "./cfr-types.js";
import type { CapabilityRegistry } from "./registry.js";

export type SurrenderReason = "budget" | "iteration-3" | "surrender-cooldown";

export interface ResilienceCopy {
  ack(failure: CapabilityFailure): string;
  status(failure: CapabilityFailure): string;
  surrender(failure: CapabilityFailure, reason: SurrenderReason): string;
  terminalAck(failure: CapabilityFailure): string;
}

// Exported for the universal-coverage test (S14). Do not use outside tests.
export const FRIENDLY_NAMES: Record<string, string> = {
  "audio-to-text": "voice transcription",
  "image-to-text": "image understanding",
  "text-to-audio": "voice reply",
  "text-to-image": "image generation",
  "browser-control": "browser",
  "desktop-control": "desktop control",
};

function friendlyName(capabilityType: string): string {
  return FRIENDLY_NAMES[capabilityType] ?? capabilityType;
}

function instanceSuffix(failure: CapabilityFailure, registry: CapabilityRegistry): string {
  if (failure.capabilityName && registry.isMultiInstance(failure.capabilityType)) {
    return ` (${failure.capabilityName})`;
  }
  return "";
}

/**
 * Create a ResilienceCopy implementation backed by the given registry.
 * Wire at boot: app.resilienceCopy = createResilienceCopy(registry).
 */
export function createResilienceCopy(registry: CapabilityRegistry): ResilienceCopy {
  return {
    ack(failure: CapabilityFailure): string {
      const { capabilityType, symptom } = failure;
      const name = friendlyName(capabilityType);
      const suffix = instanceSuffix(failure, registry);

      if (capabilityType === "audio-to-text" && symptom === "execution-error") {
        return `${name}${suffix} just hit an error — let me fix that.`;
      }
      return `hold on — ${name}${suffix} isn't working right, fixing now.`;
    },

    status(_failure: CapabilityFailure): string {
      return "still fixing — second attempt.";
    },

    surrender(failure: CapabilityFailure, reason: SurrenderReason): string {
      const name = friendlyName(failure.capabilityType);
      const suffix = instanceSuffix(failure, registry);
      const fallback = registry.getFallbackAction(failure.capabilityType);

      if (reason === "budget") {
        return `I've hit the fix budget for this turn. ${fallback} while I look into it? I've logged the issue.`;
      }
      if (reason === "surrender-cooldown") {
        return `I already tried fixing ${name}${suffix} recently — ${fallback} for now. I've logged it.`;
      }
      // iteration-3
      return `I tried three fixes and ${name}${suffix} isn't working today. ${fallback}? I've logged the issue.`;
    },

    terminalAck(failure: CapabilityFailure): string {
      const { capabilityType } = failure;
      const name = friendlyName(capabilityType);
      const suffix = instanceSuffix(failure, registry);

      switch (capabilityType) {
        case "audio-to-text":
          return "voice transcription is back — what's next?";
        case "text-to-audio":
          return "voice reply is back — this message went out as text, but it'll be working next time.";
        case "text-to-image":
          return "image generation is back — I'll include images next time.";
        default:
          return `${name}${suffix} is back — try again whenever you'd like.`;
      }
    },
  };
}
