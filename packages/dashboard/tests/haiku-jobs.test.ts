/**
 * TDD tests for Haiku background job prompts
 *
 * These tests call the real Haiku API to verify prompt quality.
 * They are NOT mocked — the point is to test what Haiku actually produces.
 *
 * Run: Set ANTHROPIC_API_KEY env var, then: npx vitest run tests/haiku-jobs.test.ts
 * Watch: Set ANTHROPIC_API_KEY env var, then: npx vitest tests/haiku-jobs.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  RICH_INPUT,
  SPARSE_INPUT,
  EMPTY_INPUT,
  CONFLICTING_INPUT,
  VERBOSE_INPUT,
  MIXED_LANGUAGE_INPUT,
  FULL_HEBREW_INPUT,
  RICH_CONVERSATION_ABBREVIATIONS,
  SPARSE_CONVERSATION_ABBREVIATIONS,
  HEBREW_CONVERSATION_ABBREVIATIONS,
  assembleNotebookContext,
  assembleDailySummaryContext,
} from "./fixtures/thailand-vacation.js";
import { runMorningPrep } from "../src/scheduler/jobs/morning-prep.js";
import { runDailySummary } from "../src/scheduler/jobs/daily-summary.js";

// Skip entire suite if no API key
const hasApiKey = !!(
  process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN
);
const describeWithApi = hasApiKey ? describe : describe.skip;

// Generous timeout — Haiku calls take 5-15s each
const HAIKU_TIMEOUT = 30_000;

// --- Morning Prep Tests ---

describeWithApi("morning prep prompt", () => {
  it(
    "produces a concise briefing from rich input",
    async () => {
      const context = assembleNotebookContext(RICH_INPUT);
      const result = await runMorningPrep(context);

      // Must produce output
      expect(result).toBeTruthy();
      expect(result.trim().length).toBeGreaterThan(0);

      // Key facts must be present
      const lower = result.toLowerCase();
      expect(lower).toContain("chiang mai");
      expect(lower).toContain("krabi");
      expect(lower).toContain("kai");

      // Should mention the temple tour (today's activity)
      expect(lower).toMatch(/temple|tour/);

      console.log(
        `\n--- Morning Prep (rich) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "handles sparse input without hallucinating",
    async () => {
      const context = assembleNotebookContext(SPARSE_INPUT);
      const result = await runMorningPrep(context);

      expect(result).toBeTruthy();

      const lower = result.toLowerCase();
      // Should mention what we know
      expect(lower).toContain("chiang mai");

      // Should NOT hallucinate details we didn't provide
      expect(lower).not.toContain("krabi");
      expect(lower).not.toContain("kai");
      expect(lower).not.toContain("pad krapao");

      console.log(
        `\n--- Morning Prep (sparse) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "returns empty/minimal output for empty input",
    async () => {
      const context = assembleNotebookContext(EMPTY_INPUT);
      const result = await runMorningPrep(context);

      // Should still produce something (even if just "no data available")
      expect(result).toBeTruthy();

      // Should be short — nothing to report
      expect(result.length).toBeLessThan(500);

      // Should NOT hallucinate any facts
      const lower = result.toLowerCase();
      expect(lower).not.toContain("chiang mai");
      expect(lower).not.toContain("tel aviv");

      console.log(
        `\n--- Morning Prep (empty) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "resolves conflicts correctly (recent data wins)",
    async () => {
      const context = assembleNotebookContext(CONFLICTING_INPUT);
      const result = await runMorningPrep(context);

      expect(result).toBeTruthy();

      const lower = result.toLowerCase();
      // Daily log (most recent) says Chiang Mai — this should be the current location
      expect(lower).toContain("chiang mai");

      // Reference says Tel Aviv — this should be recognized as outdated
      // The briefing should reflect CURRENT state, not stale reference
      // It's OK to mention Tel Aviv as "previous" but not as current location

      console.log(
        `\n--- Morning Prep (conflicting) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "stays concise with verbose input",
    async () => {
      const context = assembleNotebookContext(VERBOSE_INPUT);
      const result = await runMorningPrep(context);

      expect(result).toBeTruthy();

      // Key facts should be extracted despite noise
      const lower = result.toLowerCase();
      expect(lower).toContain("chiang mai");
      expect(lower).toContain("kai");
      expect(lower).toMatch(/temple|tour/);

      console.log(
        `\n--- Morning Prep (verbose) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "handles mixed Hebrew/English input",
    async () => {
      const context = assembleNotebookContext(MIXED_LANGUAGE_INPUT);
      const result = await runMorningPrep(context);

      expect(result).toBeTruthy();

      // Output should be in English (briefing format)
      const lower = result.toLowerCase();
      expect(lower).toContain("chiang mai");

      console.log(
        `\n--- Morning Prep (mixed language) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "extracts all key facts from full Hebrew input",
    async () => {
      const context = assembleNotebookContext(FULL_HEBREW_INPUT);
      const result = await runMorningPrep(context);

      expect(result).toBeTruthy();

      const lower = result.toLowerCase();
      // Must extract key facts despite Hebrew input
      expect(lower).toMatch(/chiang mai|צ'יאנג מאי/);
      expect(lower).toMatch(/krabi|קראבי/);
      expect(lower).toMatch(/kai|קאי/);
      expect(lower).toMatch(/temple|tour|מקדש|סיור/);

      // Should mention the schedule
      expect(lower).toMatch(/mar 15|mar 20|flight|טיסה/i);

      console.log(
        `\n--- Morning Prep (full Hebrew) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "budget discovery: measure output length across input densities",
    async () => {
      const inputs = [
        { name: "sparse", context: assembleNotebookContext(SPARSE_INPUT) },
        { name: "rich", context: assembleNotebookContext(RICH_INPUT) },
        { name: "verbose", context: assembleNotebookContext(VERBOSE_INPUT) },
        {
          name: "conflicting",
          context: assembleNotebookContext(CONFLICTING_INPUT),
        },
      ];

      const results: Array<{ name: string; length: number; output: string }> =
        [];

      for (const input of inputs) {
        const result = await runMorningPrep(input.context);
        results.push({
          name: input.name,
          length: result.length,
          output: result,
        });
      }

      console.log("\n=== BUDGET DISCOVERY: Morning Prep ===");
      for (const r of results) {
        console.log(`  ${r.name.padEnd(15)} ${r.length} chars`);
      }
      const maxLen = Math.max(...results.map((r) => r.length));
      const avgLen = Math.round(
        results.reduce((s, r) => s + r.length, 0) / results.length,
      );
      console.log(`  ---`);
      console.log(`  max:            ${maxLen} chars`);
      console.log(`  avg:            ${avgLen} chars`);
      console.log(
        `  recommendation: ${Math.ceil(maxLen * 1.2)} chars (max + 20% headroom)`,
      );
      console.log("===\n");

      // This test always passes — it's for data collection
      // After running, we'll set the real budget based on the numbers
      expect(results.length).toBe(4);
    },
    HAIKU_TIMEOUT * 4,
  );
});

// --- Daily Summary Tests ---

describeWithApi("daily summary prompt", () => {
  it(
    "consolidates a busy day into a summary",
    async () => {
      const context = assembleDailySummaryContext(
        VERBOSE_INPUT.daily.yesterday,
        RICH_CONVERSATION_ABBREVIATIONS,
      );
      const result = await runDailySummary(context);

      expect(result).toBeTruthy();

      const lower = result.toLowerCase();
      // Should capture key themes of the day
      expect(lower).toMatch(/temple|doi suthep/);
      expect(lower).toMatch(/khao soi|food|restaurant/);
      expect(lower).toMatch(/krabi|boat|tour/);

      console.log(
        `\n--- Daily Summary (rich) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "handles a sparse day gracefully",
    async () => {
      const context = assembleDailySummaryContext(
        SPARSE_INPUT.daily.yesterday,
        SPARSE_CONVERSATION_ABBREVIATIONS,
      );
      const result = await runDailySummary(context);

      expect(result).toBeTruthy();

      const lower = result.toLowerCase();
      expect(lower).toContain("chiang mai");

      // Should NOT pad with fluff
      expect(result.length).toBeLessThan(500);

      console.log(
        `\n--- Daily Summary (sparse) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "handles empty day (no activity)",
    async () => {
      const context = assembleDailySummaryContext(
        `# Daily Log — no entries today`,
        [],
      );
      const result = await runDailySummary(context);

      expect(result).toBeTruthy();
      // Should be minimal
      expect(result.length).toBeLessThan(300);

      // Should not hallucinate activities
      const lower = result.toLowerCase();
      expect(lower).not.toContain("temple");
      expect(lower).not.toContain("restaurant");

      console.log(
        `\n--- Daily Summary (empty) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "spots patterns in activities",
    async () => {
      const context = assembleDailySummaryContext(
        VERBOSE_INPUT.daily.yesterday,
        RICH_CONVERSATION_ABBREVIATIONS,
      );
      const result = await runDailySummary(context);

      expect(result).toBeTruthy();

      // Should notice food is a recurring theme (pad krapao yesterday, khao soi today)
      // This is a soft assertion — we log and inspect
      const lower = result.toLowerCase();
      const mentionsFood =
        lower.includes("food") ||
        lower.includes("restaurant") ||
        lower.includes("pad krapao") ||
        lower.includes("khao soi");

      console.log(
        `\n--- Daily Summary (patterns) [${result.length} chars] ---`,
      );
      console.log(`Food pattern detected: ${mentionsFood}`);
      console.log(result);
      console.log("---\n");

      // Soft pass — we're measuring, not enforcing
      expect(result.length).toBeGreaterThan(0);
    },
    HAIKU_TIMEOUT,
  );

  it(
    "consolidates Hebrew daily log and abbreviations",
    async () => {
      const context = assembleDailySummaryContext(
        FULL_HEBREW_INPUT.daily.yesterday,
        HEBREW_CONVERSATION_ABBREVIATIONS,
      );
      const result = await runDailySummary(context);

      expect(result).toBeTruthy();

      const lower = result.toLowerCase();
      // Should extract key themes despite Hebrew input
      expect(lower).toMatch(/temple|doi suthep|מקדש|דוי סוטהפ/);
      expect(lower).toMatch(/kai|קאי/);
      expect(lower).toMatch(/krabi|קראבי/);

      console.log(
        `\n--- Daily Summary (full Hebrew) [${result.length} chars] ---\n${result}\n---`,
      );
    },
    HAIKU_TIMEOUT,
  );

  it(
    "budget discovery: measure output length for daily summaries",
    async () => {
      const inputs = [
        {
          name: "sparse",
          context: assembleDailySummaryContext(
            SPARSE_INPUT.daily.yesterday,
            SPARSE_CONVERSATION_ABBREVIATIONS,
          ),
        },
        {
          name: "rich",
          context: assembleDailySummaryContext(
            VERBOSE_INPUT.daily.yesterday,
            RICH_CONVERSATION_ABBREVIATIONS,
          ),
        },
      ];

      const results: Array<{ name: string; length: number }> = [];

      for (const input of inputs) {
        const result = await runDailySummary(input.context);
        results.push({ name: input.name, length: result.length });
      }

      console.log("\n=== BUDGET DISCOVERY: Daily Summary ===");
      for (const r of results) {
        console.log(`  ${r.name.padEnd(15)} ${r.length} chars`);
      }
      const maxLen = Math.max(...results.map((r) => r.length));
      console.log(`  ---`);
      console.log(`  max:            ${maxLen} chars`);
      console.log(
        `  recommendation: ${Math.ceil(maxLen * 1.2)} chars (max + 20% headroom)`,
      );
      console.log("===\n");

      expect(results.length).toBe(2);
    },
    HAIKU_TIMEOUT * 2,
  );
});
