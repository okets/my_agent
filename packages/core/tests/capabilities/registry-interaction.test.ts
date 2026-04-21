import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { Capability } from "../../src/capabilities/types.js";

function makeCap(overrides: Partial<Capability>): Capability {
  return {
    name: "test-cap",
    provides: "browser-control",
    interface: "mcp",
    path: "/tmp/test-cap",
    status: "available",
    health: "healthy",
    enabled: true,
    canDelete: false,
    ...overrides,
  };
}

describe("CapabilityRegistry.getInteraction (M9.6-S22)", () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it("returns explicit frontmatter interaction when set", () => {
    registry.register(makeCap({ provides: "browser-control", interaction: "tool" }));
    expect(registry.getInteraction("browser-control")).toBe("tool");
  });

  it("frontmatter interaction overrides DEFAULT_INTERACTION table", () => {
    // audio-to-text defaults to "input" in the table, but explicit "tool" overrides
    registry.register(makeCap({ provides: "audio-to-text", interaction: "tool" }));
    expect(registry.getInteraction("audio-to-text")).toBe("tool");
  });

  it("falls back to DEFAULT_INTERACTION when frontmatter absent — audio-to-text → input", () => {
    registry.register(makeCap({ provides: "audio-to-text", interaction: undefined }));
    expect(registry.getInteraction("audio-to-text")).toBe("input");
  });

  it("falls back to DEFAULT_INTERACTION when frontmatter absent — text-to-audio → output", () => {
    registry.register(makeCap({ provides: "text-to-audio", interaction: undefined }));
    expect(registry.getInteraction("text-to-audio")).toBe("output");
  });

  it("falls back to DEFAULT_INTERACTION when frontmatter absent — text-to-image → output", () => {
    registry.register(makeCap({ provides: "text-to-image", interaction: undefined }));
    expect(registry.getInteraction("text-to-image")).toBe("output");
  });

  it("falls back to DEFAULT_INTERACTION when frontmatter absent — browser-control → tool", () => {
    registry.register(makeCap({ provides: "browser-control", interaction: undefined }));
    expect(registry.getInteraction("browser-control")).toBe("tool");
  });

  it("falls back to DEFAULT_INTERACTION when frontmatter absent — desktop-control → tool", () => {
    registry.register(makeCap({ provides: "desktop-control", interaction: undefined }));
    expect(registry.getInteraction("desktop-control")).toBe("tool");
  });

  it("unknown type not in DEFAULT_INTERACTION falls back to 'tool'", () => {
    registry.register(makeCap({ provides: "custom-capability", interaction: undefined }));
    expect(registry.getInteraction("custom-capability")).toBe("tool");
  });

  it("empty registry falls back to DEFAULT_INTERACTION table", () => {
    expect(registry.getInteraction("audio-to-text")).toBe("input");
    expect(registry.getInteraction("text-to-audio")).toBe("output");
    expect(registry.getInteraction("browser-control")).toBe("tool");
  });

  it("empty registry with unknown type falls back to 'tool'", () => {
    expect(registry.getInteraction("unknown-type")).toBe("tool");
  });
});
