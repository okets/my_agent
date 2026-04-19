/**
 * S14 acceptance test: multi-instance instance-name suffix in CFR ack copy.
 *
 * When a failure carries `capabilityName` AND the registry reports the type
 * as multi-instance, every copy method that surfaces an instance identifier
 * must append " (<name>)".  Singleton types must NOT have parentheses.
 */

import { describe, it, expect } from "vitest";
import { createResilienceCopy } from "../../src/capabilities/resilience-messages.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

function makeRegistry(multiInstanceTypes: string[], fallback = "try again in a moment"): CapabilityRegistry {
  return {
    isMultiInstance: (type: string) => multiInstanceTypes.includes(type),
    getFallbackAction: () => fallback,
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

function failure(
  capabilityType: string,
  capabilityName?: string,
): CapabilityFailure {
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

const multiRegistry = makeRegistry(["browser-control"], "try again in a moment");
const copy = createResilienceCopy(multiRegistry);

describe("createResilienceCopy — multi-instance suffix in ack()", () => {
  it("appends instance name for browser-control failure with capabilityName set", () => {
    const text = copy.ack(failure("browser-control", "browser-chrome"));
    expect(text).toContain("(browser-chrome)");
  });

  it("does NOT append parentheses for audio-to-text (singleton)", () => {
    const text = copy.ack(failure("audio-to-text", "stt-deepgram"));
    expect(text).not.toContain("(");
    expect(text).not.toContain(")");
  });

  it("does NOT append parentheses when capabilityName is absent", () => {
    const text = copy.ack(failure("browser-control"));
    expect(text).not.toContain("(");
  });
});

describe("createResilienceCopy — multi-instance suffix in terminalAck()", () => {
  it("appends instance name for browser-control terminal ack", () => {
    const text = copy.terminalAck(failure("browser-control", "browser-chrome"));
    expect(text).toContain("(browser-chrome)");
    expect(text).toContain("is back");
  });

  it("does NOT append parentheses for audio-to-text terminal ack", () => {
    const text = copy.terminalAck(failure("audio-to-text"));
    expect(text).not.toContain("(");
    expect(text).toContain("voice transcription is back");
  });
});

describe("createResilienceCopy — multi-instance suffix in surrender()", () => {
  it("appends instance name for browser-control surrender", () => {
    const text = copy.surrender(failure("browser-control", "browser-chrome"), "iteration-3");
    expect(text).toContain("(browser-chrome)");
  });

  it("does NOT append parentheses for audio-to-text surrender", () => {
    const text = copy.surrender(failure("audio-to-text", "stt-deepgram"), "iteration-3");
    expect(text).not.toContain("(");
  });
});
