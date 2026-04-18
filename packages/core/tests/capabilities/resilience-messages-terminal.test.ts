/**
 * S14 acceptance test: per-type terminal ack copy.
 *
 * Every registered type must return a non-empty terminal ack string.
 * Per-type overrides must fire for the known types; the default template
 * is verified for unknown types and MCP plug types.
 */

import { describe, it, expect } from "vitest";
import { createResilienceCopy, FRIENDLY_NAMES } from "../../src/capabilities/resilience-messages.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

function makeRegistry(multiInstanceTypes: string[] = []): CapabilityRegistry {
  return {
    isMultiInstance: (type: string) => multiInstanceTypes.includes(type),
    getFallbackAction: () => "try again in a moment",
  } as unknown as CapabilityRegistry;
}

function failure(capabilityType: string, capabilityName?: string): CapabilityFailure {
  return {
    id: "f-1",
    capabilityType,
    capabilityName,
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
    detectedAt: "2026-04-15T00:00:00.000Z",
  };
}

const copy = createResilienceCopy(makeRegistry(["browser-control"]));

describe("createResilienceCopy — terminalAck per-type strings", () => {
  it("audio-to-text → 'voice transcription is back — what's next?'", () => {
    expect(copy.terminalAck(failure("audio-to-text"))).toBe(
      "voice transcription is back — what's next?",
    );
  });

  it("text-to-audio → voice reply back message", () => {
    expect(copy.terminalAck(failure("text-to-audio"))).toBe(
      "voice reply is back — this message went out as text, but it'll be working next time.",
    );
  });

  it("text-to-image → image generation back message", () => {
    expect(copy.terminalAck(failure("text-to-image"))).toBe(
      "image generation is back — I'll include images next time.",
    );
  });

  it("browser-control → default template with friendly name 'browser'", () => {
    const text = copy.terminalAck(failure("browser-control"));
    expect(text).toContain("browser");
    expect(text).toContain("is back");
  });

  it("desktop-control → default template with friendly name 'desktop control'", () => {
    const text = copy.terminalAck(failure("desktop-control"));
    expect(text).toContain("desktop control");
    expect(text).toContain("is back");
  });

  it("image-to-text → default template with friendly name 'image understanding'", () => {
    const text = copy.terminalAck(failure("image-to-text"));
    expect(text).toContain("image understanding");
    expect(text).toContain("is back");
  });

  it("unknown type → default template using raw type string", () => {
    const text = copy.terminalAck(failure("custom-thing"));
    expect(text).toContain("custom-thing");
    expect(text).toContain("is back");
  });

  it("every type in FRIENDLY_NAMES returns a non-empty terminal ack", () => {
    for (const type of Object.keys(FRIENDLY_NAMES)) {
      const text = copy.terminalAck(failure(type));
      expect(text.length, `terminalAck for '${type}' must be non-empty`).toBeGreaterThan(0);
    }
  });
});
