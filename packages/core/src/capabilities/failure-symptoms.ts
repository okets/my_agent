/**
 * STT failure symptom classifiers for Capability Failure Recovery (CFR).
 * Created in M9.6-S1.
 * M9.6-S10: classifySttError removed — CapabilityInvoker handles those branches.
 * M9.6-S12: classifyMcpToolError added for MCP CFR detector.
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

/**
 * Map an MCP tool error string to a CapabilityFailureSymptom.
 *
 * Pattern rationale:
 *   - timeout/etimedout  → "timeout"
 *   - schema/validation  → "validation-failed"
 *   - disabled/not enabled → "not-enabled"
 *   - connection closed / transport closed → "execution-error"
 *     (Mode 2 child-crash produces "MCP error -32000: Connection closed";
 *     the explicit pattern is self-documenting even though the default catches it too)
 *   - everything else    → "execution-error"
 */
export function classifyMcpToolError(error: string): CapabilityFailureSymptom {
  if (/timeout|timed out|etimedout/i.test(error)) return "timeout";
  if (/schema|validation/i.test(error)) return "validation-failed";
  if (/disabled|not enabled/i.test(error)) return "not-enabled";
  if (/connection closed|transport closed/i.test(error)) return "execution-error";
  return "execution-error";
}
