/**
 * CFR STT Error Classification — acceptance tests (M9.6-S1)
 *
 * Verifies that each error string produced by chat-service.ts:transcribeAudio
 * maps to the expected CapabilityFailureSymptom.
 */

import { describe, it, expect } from "vitest";
import { classifySttError } from "@my-agent/core";

describe("classifySttError", () => {
  // ── "No audio-to-text capability available" ──────────────────────

  it("not-installed when cap does not exist", () => {
    const { symptom } = classifySttError(
      "No audio-to-text capability available",
      false,
      false,
    );
    expect(symptom).toBe("not-installed");
  });

  it("not-enabled when cap exists but is not enabled", () => {
    const { symptom } = classifySttError(
      "No audio-to-text capability available",
      true,
      false,
    );
    expect(symptom).toBe("not-enabled");
  });

  it("execution-error when cap exists and is enabled but status not available", () => {
    const { symptom } = classifySttError(
      "No audio-to-text capability available",
      true,
      true,
    );
    expect(symptom).toBe("execution-error");
  });

  // ── "Transcription failed: ..." ───────────────────────────────────

  it("execution-error for generic transcription failure", () => {
    const { symptom } = classifySttError(
      "Transcription failed: Command failed: /path/to/transcribe.sh",
      true,
      true,
    );
    expect(symptom).toBe("execution-error");
  });

  it("timeout for 'timeout' in error message", () => {
    const { symptom } = classifySttError(
      "Transcription failed: Command timed out after 30000ms (timeout)",
      true,
      true,
    );
    expect(symptom).toBe("timeout");
  });

  it("timeout for ETIMEDOUT in error message", () => {
    const { symptom } = classifySttError(
      "Transcription failed: connect ETIMEDOUT 1.2.3.4:443",
      true,
      true,
    );
    expect(symptom).toBe("timeout");
  });

  it("timeout is case-insensitive (TIMEOUT uppercase)", () => {
    const { symptom } = classifySttError(
      "Transcription failed: TIMEOUT exceeded",
      true,
      true,
    );
    expect(symptom).toBe("timeout");
  });

  it("execution-error for JSON parse failure", () => {
    const { symptom } = classifySttError(
      "Transcription failed: SyntaxError: Unexpected token < in JSON",
      true,
      true,
    );
    expect(symptom).toBe("execution-error");
  });

  it("execution-error for non-zero exit code", () => {
    const { symptom } = classifySttError(
      "Transcription failed: Command failed with exit code 1",
      true,
      true,
    );
    expect(symptom).toBe("execution-error");
  });

  // ── Fallback ─────────────────────────────────────────────────────

  it("execution-error fallback for unknown error shape", () => {
    const { symptom } = classifySttError("Something went wrong", true, true);
    expect(symptom).toBe("execution-error");
  });

  // ── detail field ─────────────────────────────────────────────────

  it("detail contains the human-readable error tail for not-installed", () => {
    const { detail } = classifySttError(
      "No audio-to-text capability available",
      false,
      false,
    );
    expect(detail).toBe("No audio-to-text capability available");
  });

  it("detail strips 'Transcription failed:' prefix", () => {
    const { detail } = classifySttError(
      "Transcription failed: Command failed with exit code 1",
      true,
      true,
    );
    expect(detail).toBe("Command failed with exit code 1");
  });
});
