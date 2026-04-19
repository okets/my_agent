import { describe, it, expect } from "vitest";
import { createResilienceCopy } from "../../src/capabilities/resilience-messages.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

function makeStubRegistry(): CapabilityRegistry {
  return {
    isMultiInstance: () => false,
    getFallbackAction: () => "could you resend as text",
  } as unknown as CapabilityRegistry;
}

function failure(capabilityType: string): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType,
    symptom: "execution-error",
    triggeringInput: {
      origin: conversationOrigin(
        { transportId: "whatsapp", channelId: "ch-1", sender: "+100" },
        "conv-A",
        1,
      ),
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: "2026-04-19T00:00:00.000Z",
  };
}

describe("createResilienceCopy — redesign-needed", () => {
  const copy = createResilienceCopy(makeStubRegistry());

  it("audio-to-text renders redesign-needed copy with fallback action", () => {
    expect(copy.surrender(failure("audio-to-text"), "redesign-needed")).toBe(
      "I tried to fix voice transcription but the design needs a bigger rework — I've flagged it, could you resend as text for now.",
    );
  });

  it("unknown type uses raw type name in redesign-needed copy", () => {
    expect(copy.surrender(failure("custom-plug"), "redesign-needed")).toBe(
      "I tried to fix custom-plug but the design needs a bigger rework — I've flagged it, could you resend as text for now.",
    );
  });
});

describe("createResilienceCopy — insufficient-context", () => {
  const copy = createResilienceCopy(makeStubRegistry());

  it("audio-to-text renders insufficient-context copy with fallback action", () => {
    expect(copy.surrender(failure("audio-to-text"), "insufficient-context")).toBe(
      "I couldn't fix voice transcription — I didn't have enough to go on. could you resend as text.",
    );
  });

  it("unknown type uses raw type name in insufficient-context copy", () => {
    expect(copy.surrender(failure("custom-plug"), "insufficient-context")).toBe(
      "I couldn't fix custom-plug — I didn't have enough to go on. could you resend as text.",
    );
  });
});
