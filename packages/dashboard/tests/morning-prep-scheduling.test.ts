import { describe, it, expect } from "vitest";
import { isMorningPrepDue } from "../src/scheduler/work-loop-scheduler.js";
import type { UserPreferences } from "@my-agent/core";
import type { PropertiesMap } from "../src/conversations/properties.js";

describe("isMorningPrepDue", () => {
  const basePrefs: UserPreferences = {
    morningBrief: { time: "08:00", model: "sonnet", channel: "default" },
    timezone: "UTC",
  };

  it("should be due when local time is past target and never ran", () => {
    // 09:00 UTC
    const now = new Date("2026-03-12T09:00:00Z");
    expect(isMorningPrepDue(basePrefs, {}, null, now)).toBe(true);
  });

  it("should not be due when local time is before target", () => {
    // 07:00 UTC
    const now = new Date("2026-03-12T07:00:00Z");
    expect(isMorningPrepDue(basePrefs, {}, null, now)).toBe(false);
  });

  it("should not be due if already ran today", () => {
    const now = new Date("2026-03-12T09:00:00Z");
    const lastRun = new Date("2026-03-12T08:01:00Z");
    expect(isMorningPrepDue(basePrefs, {}, lastRun, now)).toBe(false);
  });

  it("should prefer dynamic timezone from properties over preferences", () => {
    // User preference says UTC, but status.yaml says Asia/Bangkok (UTC+7)
    // At 02:00 UTC = 09:00 Bangkok
    const now = new Date("2026-03-12T02:00:00Z");
    const props: PropertiesMap = {
      timezone: {
        value: "Asia/Bangkok",
        confidence: "high",
        updated: "2026-03-12",
        source: "conv",
      },
    };
    // Should be due: 09:00 Bangkok > 08:00 target
    expect(isMorningPrepDue(basePrefs, props, null, now)).toBe(true);
    // Without properties: 02:00 UTC < 08:00 target — not due
    expect(isMorningPrepDue(basePrefs, {}, null, now)).toBe(false);
  });

  it("should be due next day if last run was yesterday", () => {
    const now = new Date("2026-03-13T08:30:00Z");
    const lastRun = new Date("2026-03-12T08:01:00Z");
    expect(isMorningPrepDue(basePrefs, {}, lastRun, now)).toBe(true);
  });

  it("should handle custom morning brief time", () => {
    const customPrefs: UserPreferences = {
      morningBrief: { time: "10:30", model: "sonnet", channel: "default" },
      timezone: "UTC",
    };
    // 10:00 UTC — before 10:30 target
    const before = new Date("2026-03-12T10:00:00Z");
    expect(isMorningPrepDue(customPrefs, {}, null, before)).toBe(false);
    // 11:00 UTC — after 10:30 target
    const after = new Date("2026-03-12T11:00:00Z");
    expect(isMorningPrepDue(customPrefs, {}, null, after)).toBe(true);
  });
});
