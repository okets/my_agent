/**
 * M7-S9 Task 8: Built-in handlers produce real output (live)
 *
 * Real LLM calls through built-in handlers. No mocks.
 * Tests: debrief-context, daily-summary, weekly-summary, monthly-summary.
 *
 * Gate: ANTHROPIC_API_KEY env var
 * Model: Haiku (cost efficient)
 * Timeout: 120s per test
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getHandler } from "../../src/scheduler/jobs/handler-registry.js";
import {
  requireApiKey,
  allowNestedSessions,
  createSeededAgentDir,
  seedDailySummaries,
  seedWeeklySummary,
} from "./helpers.js";

const API_KEY_AVAILABLE = requireApiKey();
if (API_KEY_AVAILABLE) allowNestedSessions();

describe.skipIf(!API_KEY_AVAILABLE)(
  "Built-in Handlers — Live LLM Execution",
  () => {
    let agentDir: string;

    afterEach(() => {
      if (agentDir) {
        rmSync(agentDir, { recursive: true, force: true });
      }
    });

    it("debrief-context writes current-state.md with notebook data", { timeout: 120_000 }, async () => {
      agentDir = createSeededAgentDir();

      const handler = getHandler("debrief-context");
      expect(handler).toBeDefined();

      const result = await handler!({
        agentDir,
        jobId: "live-test-debrief",
      });

      expect(result.success).toBe(true);
      expect(result.work).toBeTruthy();
      expect(result.work.length).toBeGreaterThan(10);

      // Verify current-state.md was written
      const statePath = join(
        agentDir,
        "notebook",
        "operations",
        "current-state.md",
      );
      expect(existsSync(statePath)).toBe(true);

      const content = readFileSync(statePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
    });

    it("daily-summary writes coherent markdown summary", { timeout: 120_000 }, async () => {
      agentDir = createSeededAgentDir();

      const handler = getHandler("daily-summary");
      expect(handler).toBeDefined();

      const result = await handler!({
        agentDir,
        jobId: "live-test-daily",
      });

      expect(result.success).toBe(true);
      expect(result.work).toBeTruthy();
      // Output should be markdown, not error text
      expect(result.work).not.toContain("Error");
    });

    it("weekly-summary aggregates daily summaries", { timeout: 120_000 }, async () => {
      agentDir = createSeededAgentDir();
      seedDailySummaries(agentDir, 3);

      const handler = getHandler("weekly-summary");
      expect(handler).toBeDefined();

      const result = await handler!({
        agentDir,
        jobId: "live-test-weekly",
      });

      expect(result.success).toBe(true);
      expect(result.work).toBeTruthy();
      expect(result.work.length).toBeGreaterThan(20);
    });

    it("monthly-summary aggregates weekly summaries", { timeout: 120_000 }, async () => {
      agentDir = createSeededAgentDir();
      seedWeeklySummary(agentDir);

      const handler = getHandler("monthly-summary");
      expect(handler).toBeDefined();

      const result = await handler!({
        agentDir,
        jobId: "live-test-monthly",
      });

      expect(result.success).toBe(true);
      expect(result.work).toBeTruthy();
      expect(result.work.length).toBeGreaterThan(20);
    });
  },
);
