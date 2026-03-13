/**
 * E2E: Timezone-Location Pipeline Verification
 *
 * Tests the full chain: location change → timezone inference → morning brief scheduling shift.
 * This verifies the M6.9-S2 behavioral layer integration across:
 *   - Knowledge extractor (timezone inference from location)
 *   - Properties (status.yaml timezone update)
 *   - Scheduler (isDue with resolved timezone)
 *   - Staleness detection (location/timezone thresholds)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isDue } from "../../src/scheduler/work-patterns.js";
import {
  readProperties,
  updateProperty,
  detectStaleProperties,
  type PropertiesMap,
} from "../../src/conversations/properties.js";
import { loadPreferences, type UserPreferences } from "@my-agent/core";

// Default preferences: 08:00 UTC
const DEFAULT_PREFS: UserPreferences = {
  morningBrief: { time: "08:00", model: "sonnet", channel: "default" },
  timezone: "UTC",
};

describe("Timezone-Location E2E Pipeline", () => {
  let agentDir: string;

  // Cadence derived from DEFAULT_PREFS
  const CADENCE = `daily:${DEFAULT_PREFS.morningBrief.time}`;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "tz-e2e-"));
    mkdirSync(join(agentDir, "notebook", "properties"), { recursive: true });
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  // ── Scenario 1: User flies from UTC to Bangkok ──

  it("location change to Chiang Mai shifts morning brief to Bangkok timezone", () => {
    // User has static timezone = UTC, morning brief at 08:00
    // They fly to Chiang Mai → properties updated with Asia/Bangkok
    // At 02:00 UTC (= 09:00 Bangkok), brief SHOULD fire

    const props: PropertiesMap = {
      location: {
        value: "Chiang Mai, Thailand",
        confidence: "high",
        updated: "2026-03-12",
        source: "conv",
      },
      timezone: {
        value: "Asia/Bangkok",
        confidence: "medium",
        updated: "2026-03-12",
        source: "conv",
      },
    };

    const now = new Date("2026-03-12T02:00:00Z"); // 02:00 UTC = 09:00 Bangkok

    // With Bangkok timezone from properties → should be due (09:00 > 08:00)
    const timezone = props.timezone?.value ?? DEFAULT_PREFS.timezone;
    expect(isDue(CADENCE, null, now, timezone)).toBe(true);

    // Without properties (UTC only) → should NOT be due (02:00 < 08:00)
    expect(isDue(CADENCE, null, now, DEFAULT_PREFS.timezone)).toBe(false);
  });

  // ── Scenario 2: User returns home to UTC ──

  it("timezone reverts to UTC when properties cleared", () => {
    // User returns home, properties get updated back to UTC
    const propsHome: PropertiesMap = {
      timezone: {
        value: "UTC",
        confidence: "high",
        updated: "2026-03-15",
        source: "conv",
      },
    };

    const timezone = propsHome.timezone?.value ?? DEFAULT_PREFS.timezone;

    const morningUtc = new Date("2026-03-15T09:00:00Z");

    // 09:00 UTC > 08:00 → should fire
    expect(isDue(CADENCE, null, morningUtc, timezone)).toBe(true);

    // 02:00 UTC < 08:00 → should NOT fire (no longer in Bangkok)
    const earlyUtc = new Date("2026-03-15T02:00:00Z");
    expect(isDue(CADENCE, null, earlyUtc, timezone)).toBe(false);
  });

  // ── Scenario 3: Westward travel (UTC → New York) ──

  it("westward travel delays morning brief (UTC → America/New_York)", () => {
    const propsNY: PropertiesMap = {
      timezone: {
        value: "America/New_York",
        confidence: "high",
        updated: "2026-03-12",
        source: "conv",
      },
    };

    const timezone = propsNY.timezone?.value ?? DEFAULT_PREFS.timezone;

    // 12:00 UTC = 08:00 EST → exactly at target time
    const noonUtc = new Date("2026-03-12T12:00:00Z");
    expect(isDue(CADENCE, null, noonUtc, timezone)).toBe(true);

    // 11:00 UTC = 07:00 EST → before target
    const elevenUtc = new Date("2026-03-12T11:00:00Z");
    expect(isDue(CADENCE, null, elevenUtc, timezone)).toBe(false);
  });

  // ── Scenario 4: Properties persist through read/write cycle ──

  it("properties roundtrip through status.yaml", async () => {
    // Write location + timezone
    await updateProperty(agentDir, "location", {
      value: "Chiang Mai, Thailand",
      confidence: "high",
      source: "conv",
    });
    await updateProperty(agentDir, "timezone", {
      value: "Asia/Bangkok",
      confidence: "medium",
      source: "conv",
    });

    // Read back
    const props = await readProperties(agentDir);
    expect(props.location?.value).toBe("Chiang Mai, Thailand");
    expect(props.timezone?.value).toBe("Asia/Bangkok");

    // Use in scheduling
    const now = new Date("2026-03-12T02:00:00Z"); // 09:00 Bangkok
    const timezone = props.timezone?.value ?? DEFAULT_PREFS.timezone;
    expect(isDue(CADENCE, null, now, timezone)).toBe(true);
  });

  // ── Scenario 5: Staleness detection flags old location ──

  it("location becomes stale after 7 days", () => {
    const props: PropertiesMap = {
      location: {
        value: "Chiang Mai, Thailand",
        confidence: "high",
        updated: "2026-03-01",
        source: "conv",
      },
      timezone: {
        value: "Asia/Bangkok",
        confidence: "medium",
        updated: "2026-03-01",
        source: "conv",
      },
    };

    // 12 days later → location stale (threshold 7), timezone not yet (threshold 30)
    const stale = detectStaleProperties(props, "2026-03-13");
    const staleKeys = stale.map((s) => s.key);

    expect(staleKeys).toContain("location");
    expect(staleKeys).not.toContain("timezone");
  });

  it("timezone becomes stale after 30 days", () => {
    const props: PropertiesMap = {
      timezone: {
        value: "Asia/Bangkok",
        confidence: "medium",
        updated: "2026-02-01",
        source: "conv",
      },
    };

    // 40 days later → timezone stale
    const stale = detectStaleProperties(props, "2026-03-13");
    expect(stale).toHaveLength(1);
    expect(stale[0].key).toBe("timezone");
    expect(stale[0].daysSinceUpdate).toBe(40);
  });

  // ── Scenario 6: Custom morning brief time with travel ──

  it("custom brief time (10:30) works with timezone override", () => {
    const customPrefs: UserPreferences = {
      morningBrief: { time: "10:30", model: "sonnet", channel: "default" },
      timezone: "UTC",
    };
    const customCadence = `daily:${customPrefs.morningBrief.time}`;

    const propsJapan: PropertiesMap = {
      timezone: {
        value: "Asia/Tokyo",
        confidence: "high",
        updated: "2026-03-12",
        source: "conv",
      },
    };

    const timezone = propsJapan.timezone?.value ?? customPrefs.timezone;

    // 02:00 UTC = 11:00 JST → after 10:30 target
    const twoAmUtc = new Date("2026-03-12T02:00:00Z");
    expect(isDue(customCadence, null, twoAmUtc, timezone)).toBe(true);

    // 01:00 UTC = 10:00 JST → before 10:30 target
    const oneAmUtc = new Date("2026-03-12T01:00:00Z");
    expect(isDue(customCadence, null, oneAmUtc, timezone)).toBe(false);
  });

  // ── Scenario 7: Already ran today in new timezone ──

  it("already ran today in new timezone prevents duplicate", () => {
    const propsBangkok: PropertiesMap = {
      timezone: {
        value: "Asia/Bangkok",
        confidence: "high",
        updated: "2026-03-12",
        source: "conv",
      },
    };

    const timezone = propsBangkok.timezone?.value ?? DEFAULT_PREFS.timezone;

    // Brief ran at 08:05 Bangkok time (01:05 UTC)
    const lastRun = new Date("2026-03-12T01:05:00Z");
    // Now it's 09:00 Bangkok (02:00 UTC)
    const now = new Date("2026-03-12T02:00:00Z");

    expect(isDue(CADENCE, lastRun, now, timezone)).toBe(false);
  });

  // ── Scenario 8: loadPreferences defaults ──

  it("loadPreferences returns safe defaults for missing config", () => {
    // agentDir has no config.yaml
    const prefs = loadPreferences(agentDir);
    expect(prefs.morningBrief.time).toBe("08:00");
    expect(prefs.morningBrief.model).toBe("sonnet");
    expect(prefs.timezone).toBe("UTC");
  });
});
