/**
 * STT failure symptom classifiers for Capability Failure Recovery (CFR).
 * Created in M9.6-S1.
 * M9.6-S10: classifySttError removed — CapabilityInvoker handles those branches.
 */

import type { CapabilityFailureSymptom } from "./cfr-types.js";

/**
 * Distinguish empty transcription from broken capability using capability-reported
 * confidence and duration.
 *
 * Rule: raise `empty-result` only when durationMs > 500 && confidence > 0.2 && text is empty.
 * Silent/short audio returns null (no CFR).
 *
 * When durationMs or confidence are undefined (script contract not yet upgraded), returns null.
 */
export function classifyEmptyStt(
  text: string,
  durationMs: number | undefined,
  confidence: number | undefined,
): CapabilityFailureSymptom | null {
  if (text !== "") return null;
  if (durationMs === undefined || confidence === undefined) return null;
  if (durationMs > 500 && confidence > 0.2) {
    return "empty-result";
  }
  return null;
}
