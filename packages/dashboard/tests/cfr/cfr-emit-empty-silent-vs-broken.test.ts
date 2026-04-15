/**
 * CFR Empty STT — silent vs broken capability (M9.6-S1)
 *
 * Verifies: classifyEmptyStt raises empty-result only for long/confident audio,
 * and returns null for silent/short clips or when duration/confidence are unknown.
 */

import { describe, it, expect } from "vitest";
import { classifyEmptyStt } from "@my-agent/core";

describe("classifyEmptyStt", () => {
  it("returns null when text is non-empty (not an empty result)", () => {
    expect(classifyEmptyStt("hello world", 2000, 0.9)).toBeNull();
  });

  it("returns null for short silent audio (durationMs <= 500)", () => {
    expect(classifyEmptyStt("", 120, 0)).toBeNull();
  });

  it("returns null for short audio even with non-zero confidence", () => {
    expect(classifyEmptyStt("", 499, 0.5)).toBeNull();
  });

  it("returns null for audio with low confidence (confidence <= 0.2)", () => {
    expect(classifyEmptyStt("", 2000, 0.1)).toBeNull();
  });

  it("returns null for audio at exactly the boundary (durationMs === 500)", () => {
    // Rule requires durationMs > 500, so exactly 500 should be null
    expect(classifyEmptyStt("", 500, 0.9)).toBeNull();
  });

  it("returns null for audio at exactly the confidence boundary (confidence === 0.2)", () => {
    // Rule requires confidence > 0.2, so exactly 0.2 should be null
    expect(classifyEmptyStt("", 2000, 0.2)).toBeNull();
  });

  it("returns empty-result for long audio with high confidence (the broken capability case)", () => {
    const symptom = classifyEmptyStt("", 1500, 0.9);
    expect(symptom).toBe("empty-result");
  });

  it("returns empty-result at the boundary (durationMs = 501, confidence = 0.21)", () => {
    const symptom = classifyEmptyStt("", 501, 0.21);
    expect(symptom).toBe("empty-result");
  });

  // ── S1: script contract not yet upgraded — duration/confidence are undefined ──

  it("returns null when durationMs is undefined (S1: script doesn't emit duration yet)", () => {
    expect(classifyEmptyStt("", undefined, 0.9)).toBeNull();
  });

  it("returns null when confidence is undefined (S1: script doesn't emit confidence yet)", () => {
    expect(classifyEmptyStt("", 2000, undefined)).toBeNull();
  });

  it("returns null when both are undefined (S1 default case)", () => {
    expect(classifyEmptyStt("", undefined, undefined)).toBeNull();
  });
});
