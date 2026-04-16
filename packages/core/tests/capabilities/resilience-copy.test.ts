/**
 * Tests for the user-facing copy strings in resilience-messages.ts (M9.6-S6).
 *
 * Copy is verbatim from the plan §8.1 — these tests lock down the exact
 * strings so accidental rewording breaks loudly.
 */

import { describe, it, expect } from "vitest";
import { defaultCopy } from "../../src/capabilities/resilience-messages.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";

function failure(
  capabilityType: string,
  symptom: CapabilityFailure["symptom"],
): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType,
    symptom,
    triggeringInput: {
      channel: { transportId: "whatsapp", channelId: "ch-1", sender: "+100" },
      conversationId: "conv-A",
      turnNumber: 1,
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: "2026-04-15T00:00:00.000Z",
  };
}

describe("defaultCopy — ack", () => {
  it("audio-to-text + deps-missing → voice-transcription copy", () => {
    expect(defaultCopy.ack(failure("audio-to-text", "deps-missing"))).toBe(
      "hold on — voice transcription isn't working right, fixing now.",
    );
  });

  it("audio-to-text + not-enabled → voice-transcription copy", () => {
    expect(defaultCopy.ack(failure("audio-to-text", "not-enabled"))).toBe(
      "hold on — voice transcription isn't working right, fixing now.",
    );
  });

  it("audio-to-text + not-installed → voice-transcription copy", () => {
    expect(defaultCopy.ack(failure("audio-to-text", "not-installed"))).toBe(
      "hold on — voice transcription isn't working right, fixing now.",
    );
  });

  it("audio-to-text + execution-error → execution-error copy", () => {
    expect(defaultCopy.ack(failure("audio-to-text", "execution-error"))).toBe(
      "voice transcription just hit an error — let me fix that.",
    );
  });

  it("image-to-text → substituted friendly-name copy", () => {
    expect(defaultCopy.ack(failure("image-to-text", "deps-missing"))).toBe(
      "hold on — image understanding isn't working right, fixing now.",
    );
  });

  it("unknown capability type → raw type in fallback template", () => {
    expect(defaultCopy.ack(failure("weird-thing", "execution-error"))).toBe(
      "hold on — weird-thing isn't working right, fixing now.",
    );
  });
});

describe("defaultCopy — status", () => {
  it("returns the status copy", () => {
    expect(defaultCopy.status(failure("audio-to-text", "execution-error"))).toBe(
      "still fixing — second attempt.",
    );
    expect(defaultCopy.status(failure("image-to-text", "execution-error"))).toBe(
      "still fixing — second attempt.",
    );
  });
});

describe("defaultCopy — surrender", () => {
  it("iteration-3 reason → three-fixes copy", () => {
    expect(defaultCopy.surrender(failure("audio-to-text", "execution-error"), "iteration-3")).toBe(
      "I tried three fixes and voice transcription isn't working today. could you resend as text? I've logged the issue.",
    );
  });

  it("budget reason → budget copy", () => {
    expect(defaultCopy.surrender(failure("audio-to-text", "execution-error"), "budget")).toBe(
      "I've hit the fix budget for this turn. could you resend as text while I look into it? I've logged the issue.",
    );
  });
});
