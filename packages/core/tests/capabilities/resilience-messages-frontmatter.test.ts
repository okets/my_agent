import { describe, it, expect } from "vitest";
import { createResilienceCopy } from "../../src/capabilities/resilience-messages.js";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";

function makeRegistry(friendlyName?: string): CapabilityRegistry {
  const r = new CapabilityRegistry();
  const cap: Capability = {
    name: "stt-deepgram",
    provides: "audio-to-text",
    interface: "script",
    path: "/tmp/stt-deepgram",
    status: "available",
    health: "healthy",
    enabled: true,
    canDelete: false,
    friendlyName,
  };
  r.register(cap);
  return r;
}

function makeFailure(capabilityType: string): any {
  return {
    id: "test-failure-1",
    capabilityType,
    symptom: "execution-error",
    detail: "test error",
    detectedAt: new Date().toISOString(),
    triggeringInput: {
      origin: {
        kind: "conversation",
        channel: { transportId: "dashboard", sender: "user", replyTo: undefined },
        conversationId: "conv-1",
      },
    },
  };
}

describe("createResilienceCopy with frontmatter-backed registry", () => {
  it("uses frontmatter friendly_name in ack copy", () => {
    const registry = makeRegistry("speech recognition");
    const copy = createResilienceCopy(registry);
    const ack = copy.ack(makeFailure("audio-to-text"));
    expect(ack).toContain("speech recognition");
    expect(ack).not.toContain("voice transcription");
  });

  it("falls back to hardcoded name when no frontmatter", () => {
    const registry = makeRegistry(undefined);
    const copy = createResilienceCopy(registry);
    const ack = copy.ack(makeFailure("audio-to-text"));
    expect(ack).toContain("voice transcription");
  });

  it("regression: surrender copy still renders for all known types", () => {
    const registry = makeRegistry(undefined);
    const copy = createResilienceCopy(registry);
    const failure = makeFailure("audio-to-text");
    for (const reason of ["budget", "iteration-3", "redesign-needed", "insufficient-context"] as const) {
      const msg = copy.surrender(failure, reason);
      expect(msg.length).toBeGreaterThan(10);
    }
  });
});
