/**
 * Tests for the user-facing copy strings in resilience-messages.ts (M9.6-S6).
 *
 * Copy is verbatim from the plan §8.1 — these tests lock down the exact
 * strings so accidental rewording breaks loudly.
 *
 * Refactored in M9.6-S14: uses createResilienceCopy(stubRegistry) factory.
 */

import { describe, it, expect } from "vitest";
import { createResilienceCopy } from "../../src/capabilities/resilience-messages.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

function makeStubRegistry(fallbackAction: string): CapabilityRegistry {
  return {
    isMultiInstance: () => false,
    getFallbackAction: () => fallbackAction,
    getFriendlyName: (type: string) => {
      const NAMES: Record<string, string> = {
        "audio-to-text": "voice transcription",
        "image-to-text": "image understanding",
        "text-to-audio": "voice reply",
        "text-to-image": "image generation",
        "browser-control": "browser",
        "desktop-control": "desktop control",
      };
      return NAMES[type] ?? type;
    },
  } as unknown as CapabilityRegistry;
}

const copy = createResilienceCopy(makeStubRegistry("could you resend as text"));

function failure(
  capabilityType: string,
  symptom: CapabilityFailure["symptom"],
): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType,
    symptom,
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+100" },
        "conv-A",
        1,
      ),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: "2026-04-15T00:00:00.000Z",
  };
}

describe("createResilienceCopy — ack", () => {
  it("audio-to-text + deps-missing → voice-transcription copy", () => {
    expect(copy.ack(failure("audio-to-text", "deps-missing"))).toBe(
      "hold on — voice transcription isn't working right, fixing now.",
    );
  });

  it("audio-to-text + not-enabled → voice-transcription copy", () => {
    expect(copy.ack(failure("audio-to-text", "not-enabled"))).toBe(
      "hold on — voice transcription isn't working right, fixing now.",
    );
  });

  it("audio-to-text + not-installed → voice-transcription copy", () => {
    expect(copy.ack(failure("audio-to-text", "not-installed"))).toBe(
      "hold on — voice transcription isn't working right, fixing now.",
    );
  });

  it("audio-to-text + execution-error → execution-error copy", () => {
    expect(copy.ack(failure("audio-to-text", "execution-error"))).toBe(
      "voice transcription just hit an error — let me fix that.",
    );
  });

  it("image-to-text → substituted friendly-name copy", () => {
    expect(copy.ack(failure("image-to-text", "deps-missing"))).toBe(
      "hold on — image understanding isn't working right, fixing now.",
    );
  });

  it("unknown capability type → raw type in fallback template", () => {
    expect(copy.ack(failure("weird-thing", "execution-error"))).toBe(
      "hold on — weird-thing isn't working right, fixing now.",
    );
  });
});

describe("createResilienceCopy — status", () => {
  it("returns the status copy", () => {
    expect(copy.status(failure("audio-to-text", "execution-error"))).toBe(
      "still fixing — second attempt.",
    );
    expect(copy.status(failure("image-to-text", "execution-error"))).toBe(
      "still fixing — second attempt.",
    );
  });
});

describe("createResilienceCopy — surrender", () => {
  it("iteration-3 reason → three-fixes copy", () => {
    expect(copy.surrender(failure("audio-to-text", "execution-error"), "iteration-3")).toBe(
      "I tried three fixes and voice transcription isn't working today. could you resend as text? I've logged the issue.",
    );
  });

  it("budget reason → budget copy", () => {
    expect(copy.surrender(failure("audio-to-text", "execution-error"), "budget")).toBe(
      "I've hit the fix budget for this turn. could you resend as text while I look into it? I've logged the issue.",
    );
  });
});
