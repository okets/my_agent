/**
 * Unit tests for work-patterns parser and scheduling logic.
 *
 * Pure functions — no API key, no DB, no I/O needed.
 */

import { describe, it, expect } from "vitest";
import {
  parseWorkPatterns,
  isDue,
  getNextScheduledTime,
  isValidTimezone,
} from "../src/scheduler/work-patterns.js";

// --- parseWorkPatterns ---

describe("parseWorkPatterns", () => {
  it("parses a standard work-patterns.md with two jobs", () => {
    const content = `# Work Patterns

## Morning Prep
- cadence: daily:08:00
- model: haiku

## Daily Summary
- cadence: daily:23:00
- model: haiku
`;

    const patterns = parseWorkPatterns(content);

    expect(patterns).toHaveLength(2);

    expect(patterns[0].name).toBe("morning-prep");
    expect(patterns[0].displayName).toBe("Morning Prep");
    expect(patterns[0].cadence).toBe("daily:08:00");
    expect(patterns[0].model).toBe("haiku");

    expect(patterns[1].name).toBe("daily-summary");
    expect(patterns[1].displayName).toBe("Daily Summary");
    expect(patterns[1].cadence).toBe("daily:23:00");
    expect(patterns[1].model).toBe("haiku");
  });

  it("parses weekly cadence", () => {
    const content = `## Weekly Review
- cadence: weekly:sunday:09:00
- model: haiku
`;

    const patterns = parseWorkPatterns(content);

    expect(patterns).toHaveLength(1);
    expect(patterns[0].name).toBe("weekly-review");
    expect(patterns[0].cadence).toBe("weekly:sunday:09:00");
  });

  it("defaults model to haiku when not specified", () => {
    const content = `## Simple Job
- cadence: daily:12:00
`;

    const patterns = parseWorkPatterns(content);

    expect(patterns).toHaveLength(1);
    expect(patterns[0].model).toBe("haiku");
  });

  it("skips jobs without cadence", () => {
    const content = `## No Cadence
- model: haiku

## Has Cadence
- cadence: daily:10:00
`;

    const patterns = parseWorkPatterns(content);

    expect(patterns).toHaveLength(1);
    expect(patterns[0].name).toBe("has-cadence");
  });

  it("returns empty array for empty content", () => {
    expect(parseWorkPatterns("")).toHaveLength(0);
  });

  it("returns empty array for content with no H2 headings", () => {
    const content = `# Just a title
Some text here
- cadence: daily:08:00
`;

    expect(parseWorkPatterns(content)).toHaveLength(0);
  });

  it("handles names with special characters", () => {
    const content = `## My Special Job (v2)
- cadence: daily:06:00
`;

    const patterns = parseWorkPatterns(content);

    expect(patterns[0].name).toBe("my-special-job-v2");
    expect(patterns[0].displayName).toBe("My Special Job (v2)");
  });

  it("ignores non-config lines under a heading", () => {
    const content = `## Morning Prep
This is a description paragraph.
- cadence: daily:08:00
- model: haiku
Some other text.
`;

    const patterns = parseWorkPatterns(content);

    expect(patterns).toHaveLength(1);
    expect(patterns[0].cadence).toBe("daily:08:00");
  });
});

// --- isDue ---

describe("isDue", () => {
  describe("daily cadence", () => {
    it("is due when past scheduled time and never ran", () => {
      const now = new Date("2026-03-11T09:00:00");
      expect(isDue("daily:08:00", null, now)).toBe(true);
    });

    it("is not due when before scheduled time", () => {
      const now = new Date("2026-03-11T07:59:00");
      expect(isDue("daily:08:00", null, now)).toBe(false);
    });

    it("is not due when already ran today after scheduled time", () => {
      const now = new Date("2026-03-11T10:00:00");
      const lastRun = new Date("2026-03-11T08:01:00");
      expect(isDue("daily:08:00", lastRun, now)).toBe(false);
    });

    it("is due when last ran yesterday", () => {
      const now = new Date("2026-03-11T08:30:00");
      const lastRun = new Date("2026-03-10T08:01:00");
      expect(isDue("daily:08:00", lastRun, now)).toBe(true);
    });

    it("is due exactly at scheduled time", () => {
      const now = new Date("2026-03-11T08:00:00");
      expect(isDue("daily:08:00", null, now)).toBe(true);
    });
  });

  describe("weekly cadence", () => {
    it("is due on the right day at the right time, never ran", () => {
      // 2026-03-15 is a Sunday
      const now = new Date("2026-03-15T09:30:00");
      expect(isDue("weekly:sunday:09:00", null, now)).toBe(true);
    });

    it("is not due on the wrong day", () => {
      // 2026-03-11 is a Wednesday
      const now = new Date("2026-03-11T09:30:00");
      expect(isDue("weekly:sunday:09:00", null, now)).toBe(false);
    });

    it("is not due on the right day but before scheduled time", () => {
      const now = new Date("2026-03-15T08:30:00");
      expect(isDue("weekly:sunday:09:00", null, now)).toBe(false);
    });

    it("is not due if already ran this week", () => {
      const now = new Date("2026-03-15T10:00:00");
      const lastRun = new Date("2026-03-15T09:05:00");
      expect(isDue("weekly:sunday:09:00", lastRun, now)).toBe(false);
    });
  });

  describe("invalid cadence", () => {
    it("returns false for unknown format", () => {
      expect(isDue("monthly:01:08:00", null, new Date())).toBe(false);
    });

    it("returns false for malformed daily cadence", () => {
      expect(isDue("daily:abc", null, new Date())).toBe(false);
    });

    it("returns false for malformed weekly cadence", () => {
      expect(isDue("weekly:funday:09:00", null, new Date())).toBe(false);
    });
  });

  describe("timezone-aware scheduling", () => {
    it("uses timezone when provided (Asia/Bangkok = UTC+7)", () => {
      // 02:00 UTC = 09:00 Bangkok → past 08:00 target
      const now = new Date("2026-03-12T02:00:00Z");
      expect(isDue("daily:08:00", null, now, "Asia/Bangkok")).toBe(true);
    });

    it("before target time in timezone returns false", () => {
      // 00:00 UTC = 07:00 Bangkok → before 08:00 target
      const now = new Date("2026-03-12T00:00:00Z");
      expect(isDue("daily:08:00", null, now, "Asia/Bangkok")).toBe(false);
    });

    it("invalid timezone falls back to UTC (not server local time)", () => {
      // 07:00 UTC -> not yet 08:00 in UTC, so should be false
      const now = new Date("2026-03-12T07:00:00Z");
      expect(isDue("daily:08:00", null, now, "Invalid/Timezone")).toBe(false);
      // 09:00 UTC -> past 08:00 in UTC, so should be true
      const later = new Date("2026-03-12T09:00:00Z");
      expect(isDue("daily:08:00", null, later, "Invalid/Timezone")).toBe(true);
    });

    it("no timezone uses server local time (backward compatible)", () => {
      const now = new Date("2026-03-11T09:00:00");
      expect(isDue("daily:08:00", null, now)).toBe(true);
    });

    it("already ran today in timezone prevents duplicate", () => {
      // 08:05 Bangkok (01:05 UTC) → ran. Now 09:00 Bangkok (02:00 UTC)
      const lastRun = new Date("2026-03-12T01:05:00Z");
      const now = new Date("2026-03-12T02:00:00Z");
      expect(isDue("daily:08:00", lastRun, now, "Asia/Bangkok")).toBe(false);
    });

    it("westward travel delays scheduling (America/New_York)", () => {
      // 12:00 UTC = 08:00 EST → at target
      const noon = new Date("2026-03-12T12:00:00Z");
      expect(isDue("daily:08:00", null, noon, "America/New_York")).toBe(true);
      // 11:00 UTC = 07:00 EST → before target
      const eleven = new Date("2026-03-12T11:00:00Z");
      expect(isDue("daily:08:00", null, eleven, "America/New_York")).toBe(false);
    });

    it("weekly cadence with timezone", () => {
      // 2026-03-15 is Sunday. 02:00 UTC = 09:00 Bangkok (Sunday)
      const now = new Date("2026-03-15T02:00:00Z");
      expect(isDue("weekly:sunday:09:00", null, now, "Asia/Bangkok")).toBe(true);
    });
  });
});

// --- getNextScheduledTime ---

describe("getNextScheduledTime", () => {
  it("returns today's time if not yet reached", () => {
    const now = new Date("2026-03-11T07:00:00");
    const next = getNextScheduledTime("daily:08:00", now);

    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(8);
    expect(next!.getMinutes()).toBe(0);
    expect(next!.getDate()).toBe(11);
  });

  it("returns tomorrow's time if already past", () => {
    const now = new Date("2026-03-11T09:00:00");
    const next = getNextScheduledTime("daily:08:00", now);

    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(8);
    expect(next!.getDate()).toBe(12);
  });

  it("returns next occurrence of weekly day", () => {
    // 2026-03-11 is a Wednesday, next Sunday is 2026-03-15
    const now = new Date("2026-03-11T10:00:00");
    const next = getNextScheduledTime("weekly:sunday:09:00", now);

    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(15);
    expect(next!.getDay()).toBe(0); // Sunday
    expect(next!.getHours()).toBe(9);
  });

  it("returns next week if same day but past time", () => {
    // 2026-03-15 is a Sunday, already past 09:00
    const now = new Date("2026-03-15T10:00:00");
    const next = getNextScheduledTime("weekly:sunday:09:00", now);

    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(22); // Next Sunday
  });

  it("returns null for invalid cadence", () => {
    expect(getNextScheduledTime("invalid:format")).toBeNull();
  });
});

describe("isValidTimezone", () => {
  it("returns true for valid IANA timezone", () => {
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Asia/Bangkok")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  it("returns false for invalid timezone", () => {
    expect(isValidTimezone("Invalid/Timezone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
    expect(isValidTimezone("Not_A_Zone")).toBe(false);
  });
});
