/**
 * STT failure symptom classifier for Capability Failure Recovery (CFR).
 * Maps error strings from chat-service.ts into canonical CapabilityFailureSymptom values.
 * Created in M9.6-S1. Immutable after S1.
 */

import type { CapabilityFailureSymptom } from "./cfr-types.js";

/**
 * Parse an STT `transcribeAudio` error string into a symptom.
 * Inputs are the exact `error` strings produced by chat-service.ts:943 and :956.
 *
 * Mapping table:
 * | error string                            | capExists | capEnabled | symptom          |
 * |-----------------------------------------|-----------|------------|------------------|
 * | "No audio-to-text capability available" | false     | any        | not-installed    |
 * | "No audio-to-text capability available" | true      | false      | not-enabled      |
 * | "No audio-to-text capability available" | true      | true       | execution-error  |
 * | "Transcription failed: ...timeout..."   | any       | any        | timeout          |
 * | "Transcription failed: ...ETIMEDOUT..." | any       | any        | timeout          |
 * | "Transcription failed: ..."             | any       | any        | execution-error  |
 */
export function classifySttError(
  error: string,
  capExists: boolean,
  capEnabled: boolean,
): { symptom: CapabilityFailureSymptom; detail: string } {
  const lowerError = error.toLowerCase();

  if (error === "No audio-to-text capability available") {
    if (!capExists) {
      return { symptom: "not-installed", detail: error };
    }
    if (!capEnabled) {
      return { symptom: "not-enabled", detail: error };
    }
    // Capability exists and is enabled but status is not "available" (test failure)
    return { symptom: "execution-error", detail: error };
  }

  if (error.startsWith("Transcription failed:")) {
    const detail = error.slice("Transcription failed:".length).trim();
    if (lowerError.includes("timeout") || lowerError.includes("etimedout")) {
      return { symptom: "timeout", detail };
    }
    return { symptom: "execution-error", detail };
  }

  // Fallback for any other error shape
  return { symptom: "execution-error", detail: error };
}

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
