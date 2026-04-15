/**
 * Integration-style tests for classifyEmptyStt against realistic
 * Deepgram-shaped outputs (M9.6-S6).
 *
 * Locks in the "silent vs broken STT" judgment that lets the framework
 * distinguish a user who didn't say anything from a capability that's
 * actually failing.
 */

import { describe, it, expect } from "vitest";
import { classifyEmptyStt } from "../../src/capabilities/failure-symptoms.js";

/** Shape emitted by the M9.6-S6 audio-to-text template. */
interface DeepgramLike {
  text: string;
  language?: string;
  confidence?: number;
  duration_ms?: number;
}

describe("classifyEmptyStt — Deepgram-shaped outputs", () => {
  it("long audio with high confidence but empty text → empty-result (capability failure)", () => {
    const out: DeepgramLike = {
      text: "",
      language: "en",
      confidence: 0.9,
      duration_ms: 1500,
    };
    expect(classifyEmptyStt(out.text, out.duration_ms, out.confidence)).toBe(
      "empty-result",
    );
  });

  it("short audio (<= 500ms) with empty text → null (user just tapped mic)", () => {
    const out: DeepgramLike = {
      text: "",
      confidence: 0.5,
      duration_ms: 120,
    };
    expect(classifyEmptyStt(out.text, out.duration_ms, out.confidence)).toBeNull();
  });

  it("long audio with low confidence → null (silent/noisy audio, not a bug)", () => {
    const out: DeepgramLike = {
      text: "",
      confidence: 0.05,
      duration_ms: 2000,
    };
    expect(classifyEmptyStt(out.text, out.duration_ms, out.confidence)).toBeNull();
  });

  it("legacy script output (no confidence/duration_ms) → null (conservative)", () => {
    // Deepgram script pre-M9.6-S6 only emits text + language.
    const out: DeepgramLike = { text: "", language: "en" };
    expect(
      classifyEmptyStt(out.text, out.duration_ms, out.confidence),
    ).toBeNull();
  });

  it("non-empty text never triggers empty-result regardless of fields", () => {
    expect(classifyEmptyStt("hello", 100, 0.1)).toBeNull();
    expect(classifyEmptyStt("hi there", 3000, 0.99)).toBeNull();
    expect(classifyEmptyStt("ok", undefined, undefined)).toBeNull();
  });

  it("boundary: durationMs exactly 500 does not trigger (must be > 500)", () => {
    expect(classifyEmptyStt("", 500, 0.9)).toBeNull();
    expect(classifyEmptyStt("", 501, 0.9)).toBe("empty-result");
  });

  it("boundary: confidence exactly 0.2 does not trigger (must be > 0.2)", () => {
    expect(classifyEmptyStt("", 1000, 0.2)).toBeNull();
    expect(classifyEmptyStt("", 1000, 0.21)).toBe("empty-result");
  });
});
