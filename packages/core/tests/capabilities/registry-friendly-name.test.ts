import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";

function makeCapability(overrides: Partial<Capability>): Capability {
  return {
    name: "test-cap",
    provides: "audio-to-text",
    interface: "script",
    path: "/tmp/test-cap",
    status: "available",
    health: "healthy",
    enabled: true,
    canDelete: false,
    ...overrides,
  };
}

describe("CapabilityRegistry.getFriendlyName", () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it("returns frontmatter friendly_name when set", () => {
    registry.register(makeCapability({
      provides: "audio-to-text",
      friendlyName: "custom transcription",
    }));
    expect(registry.getFriendlyName("audio-to-text")).toBe("custom transcription");
  });

  it("falls back to hardcoded FRIENDLY_NAMES when frontmatter absent", () => {
    registry.register(makeCapability({
      provides: "audio-to-text",
      friendlyName: undefined,
    }));
    expect(registry.getFriendlyName("audio-to-text")).toBe("voice transcription");
  });

  it("falls back to raw type string when type not in hardcoded table", () => {
    registry.register(makeCapability({
      provides: "custom-capability",
      friendlyName: undefined,
    }));
    expect(registry.getFriendlyName("custom-capability")).toBe("custom-capability");
  });

  it("returns hardcoded fallback when registry is empty", () => {
    expect(registry.getFriendlyName("audio-to-text")).toBe("voice transcription");
  });

  it("plug-level friendly_name overrides template-level (first-wins per type)", () => {
    registry.register(makeCapability({
      name: "cap-a",
      provides: "audio-to-text",
      friendlyName: "plug-level name",
    }));
    registry.register(makeCapability({
      name: "cap-b",
      provides: "audio-to-text",
      friendlyName: "second plug name",
    }));
    expect(registry.getFriendlyName("audio-to-text")).toBe("plug-level name");
  });
});
