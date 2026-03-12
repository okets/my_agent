import { describe, it, expect } from "vitest";
import { detectStaleProperties } from "../src/conversations/properties.js";
import type { PropertiesMap } from "../src/conversations/properties.js";

describe("detectStaleProperties", () => {
  const baseProperties: PropertiesMap = {
    location: { value: "Chiang Mai", confidence: "high", updated: "2026-03-01", source: "conv" },
    timezone: { value: "Asia/Bangkok", confidence: "high", updated: "2026-02-15", source: "conv" },
    availability: { value: "vacation", confidence: "medium", updated: "2026-03-10", source: "conv" },
  };

  it("should detect stale location (>7 days)", () => {
    const stale = detectStaleProperties(baseProperties, "2026-03-12");
    const locationStale = stale.find((s) => s.key === "location");
    expect(locationStale).toBeDefined();
    expect(locationStale!.daysSinceUpdate).toBe(11);
    expect(locationStale!.threshold).toBe(7);
  });

  it("should detect stale timezone (>30 days)", () => {
    const stale = detectStaleProperties(baseProperties, "2026-03-20");
    const tzStale = stale.find((s) => s.key === "timezone");
    expect(tzStale).toBeDefined();
    expect(tzStale!.daysSinceUpdate).toBe(33);
  });

  it("should detect stale availability (>3 days)", () => {
    const stale = detectStaleProperties(baseProperties, "2026-03-14");
    const availStale = stale.find((s) => s.key === "availability");
    expect(availStale).toBeDefined();
    expect(availStale!.daysSinceUpdate).toBe(4);
    expect(availStale!.threshold).toBe(3);
  });

  it("should not flag fresh properties", () => {
    const stale = detectStaleProperties(baseProperties, "2026-03-02");
    expect(stale).toHaveLength(0);
  });

  it("should use 30-day default threshold for unknown properties", () => {
    const props: PropertiesMap = {
      custom: { value: "something", confidence: "high", updated: "2026-02-01", source: "conv" },
    };
    const stale = detectStaleProperties(props, "2026-03-12");
    expect(stale[0].threshold).toBe(30);
  });

  it("should return empty array for empty properties", () => {
    expect(detectStaleProperties({}, "2026-03-12")).toEqual([]);
  });
});
