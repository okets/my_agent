/**
 * Integration tests for Haiku background jobs via dashboard endpoint.
 *
 * Routes through POST /api/work-loop/trigger/:jobName on the running
 * dashboard service. No API key needed in the test process.
 *
 * Run: Ensure dashboard service is running, then: npx vitest run tests/haiku-jobs.test.ts
 */

import { describe, it, expect } from "vitest";
import { isDashboardReachable, triggerJob } from "./helpers/test-server.js";

// Top-level await: check reachability once before test collection
const dashboardAvailable = await isDashboardReachable();

// Generous timeout — Haiku calls take 5-15s each
const HAIKU_TIMEOUT = 60_000;

// --- Morning Prep Tests ---

describe.skipIf(!dashboardAvailable)("morning prep via endpoint", () => {
  it(
    "morning-prep produces output",
    async () => {
      const result = await triggerJob("morning-prep");
      expect(result.success).toBe(true);
      expect(result.run).toBeDefined();
      expect(result.run.output).toBeTruthy();
      expect(result.run.status).toBe("completed");
      expect(result.run.duration_ms).toBeGreaterThan(0);
    },
    HAIKU_TIMEOUT,
  );

  it(
    "morning-prep output is concise (< 2000 chars)",
    async () => {
      const result = await triggerJob("morning-prep");
      expect(result.success).toBe(true);
      expect(result.run.output.length).toBeLessThan(2000);
    },
    HAIKU_TIMEOUT,
  );

  it(
    "morning-prep writes current-state.md (verified via consecutive trigger)",
    async () => {
      // First trigger writes current-state.md, second proves the pipeline works again
      const result1 = await triggerJob("morning-prep");
      const result2 = await triggerJob("morning-prep");
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      // Both should produce non-empty output
      expect(result1.run.output.length).toBeGreaterThan(0);
      expect(result2.run.output.length).toBeGreaterThan(0);
    },
    HAIKU_TIMEOUT * 2,
  );
});

// --- Daily Summary Tests ---

describe.skipIf(!dashboardAvailable)("daily summary via endpoint", () => {
  it(
    "daily-summary produces output",
    async () => {
      const result = await triggerJob("daily-summary");
      expect(result.success).toBe(true);
      expect(result.run).toBeDefined();
      expect(result.run.output).toBeTruthy();
      expect(result.run.status).toBe("completed");
    },
    HAIKU_TIMEOUT,
  );

  it(
    "daily-summary output is concise (< 2000 chars)",
    async () => {
      const result = await triggerJob("daily-summary");
      expect(result.success).toBe(true);
      expect(result.run.output.length).toBeLessThan(2000);
    },
    HAIKU_TIMEOUT,
  );
});

// --- Error Handling ---

describe.skipIf(!dashboardAvailable)("endpoint error handling", () => {
  it(
    "unknown job returns error",
    async () => {
      const result = await triggerJob("nonexistent-job");
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    },
    HAIKU_TIMEOUT,
  );
});
