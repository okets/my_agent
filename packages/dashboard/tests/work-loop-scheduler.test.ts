/**
 * Integration tests for WorkLoopScheduler.
 *
 * Uses a real SQLite database in a temp directory.
 * Jobs call real Haiku API (skip if no API key).
 * Scheduler lifecycle, DB operations, and job handling tested.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { WorkLoopScheduler } from "../src/scheduler/work-loop-scheduler.js";
import { isDue } from "../src/scheduler/work-patterns.js";
import { isDashboardReachable, triggerJob } from "./helpers/test-server.js";

// Create a fresh temp agent dir for each test
function createTempAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "workloop-test-"));

  // Create notebook structure
  mkdirSync(join(dir, "notebook", "config"), { recursive: true });
  mkdirSync(join(dir, "notebook", "operations"), { recursive: true });
  mkdirSync(join(dir, "notebook", "daily"), { recursive: true });
  mkdirSync(join(dir, "notebook", "reference"), { recursive: true });
  mkdirSync(join(dir, "conversations"), { recursive: true });

  return dir;
}

function writeWorkPatterns(agentDir: string, content: string): void {
  writeFileSync(
    join(agentDir, "notebook", "config", "work-patterns.md"),
    content,
    "utf-8",
  );
}

// Patterns with cadence that will NEVER be due (for lifecycle tests that don't need Haiku)
const LIFECYCLE_PATTERNS = `# Work Patterns

## Morning Prep
- cadence: weekly:saturday:03:33
- model: haiku

## Daily Summary
- cadence: weekly:saturday:03:34
- model: haiku
`;

describe("WorkLoopScheduler", () => {
  let agentDir: string;
  let db: Database.Database;

  beforeEach(() => {
    agentDir = createTempAgentDir();
    db = new Database(join(agentDir, "conversations", "agent.db"));
    db.pragma("journal_mode = WAL");

    // Create conversations table (needed for daily summary abbreviations query)
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        abbreviation TEXT,
        updated TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    db.close();
    rmSync(agentDir, { recursive: true, force: true });
  });

  // --- DB + Table Creation ---

  it("creates work_loop_runs table on construction", () => {
    writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);
    new WorkLoopScheduler({ db, agentDir });

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='work_loop_runs'",
      )
      .all();

    expect(tables).toHaveLength(1);
  });

  it("creates indexes on work_loop_runs", () => {
    new WorkLoopScheduler({ db, agentDir });

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_work_loop%'",
      )
      .all() as Array<{ name: string }>;

    expect(indexes.length).toBeGreaterThanOrEqual(2);
  });

  // --- Pattern Loading ---

  it("loads patterns on start", async () => {
    writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);

    const scheduler = new WorkLoopScheduler({
      db,
      agentDir,
      pollIntervalMs: 999_999, // Don't actually poll
    });

    await scheduler.start();
    const patterns = scheduler.getPatterns();

    expect(patterns).toHaveLength(2);
    expect(patterns[0].name).toBe("morning-prep");
    expect(patterns[1].name).toBe("daily-summary");

    await scheduler.stop();
  });

  it("creates default work-patterns.md if none exists", async () => {
    // Don't write any patterns — let it auto-create
    const patternsPath = join(
      agentDir,
      "notebook",
      "config",
      "work-patterns.md",
    );

    // Verify it doesn't exist yet
    expect(existsSync(patternsPath)).toBe(false);

    const scheduler = new WorkLoopScheduler({
      db,
      agentDir,
      pollIntervalMs: 999_999,
    });

    await scheduler.start();

    // Should have auto-created the file
    expect(existsSync(patternsPath)).toBe(true);

    // Should have loaded the default patterns
    const patterns = scheduler.getPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(2);

    await scheduler.stop();
  }, 30_000); // Default patterns may trigger a Haiku call if time is past 08:00

  it("reloads patterns when reloadPatterns is called", async () => {
    writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);

    const scheduler = new WorkLoopScheduler({
      db,
      agentDir,
      pollIntervalMs: 999_999,
    });

    await scheduler.start();
    expect(scheduler.getPatterns()).toHaveLength(2);

    // Update the file with an extra job
    writeWorkPatterns(
      agentDir,
      LIFECYCLE_PATTERNS +
        `\n## Weekly Review\n- cadence: weekly:sunday:09:00\n- model: haiku\n`,
    );

    await scheduler.reloadPatterns();
    expect(scheduler.getPatterns()).toHaveLength(3);

    await scheduler.stop();
  });

  // --- Job Lifecycle ---

  it("getLastRun returns null for never-run job", () => {
    writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);
    const scheduler = new WorkLoopScheduler({ db, agentDir });

    expect(scheduler.getLastRun("morning-prep")).toBeNull();
  });

  it("getRuns returns empty array when no runs exist", () => {
    writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);
    const scheduler = new WorkLoopScheduler({ db, agentDir });

    expect(scheduler.getRuns()).toHaveLength(0);
  });

  it("triggerJob throws for unknown job", async () => {
    writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);

    const scheduler = new WorkLoopScheduler({
      db,
      agentDir,
      pollIntervalMs: 999_999,
    });

    await scheduler.start();

    await expect(scheduler.triggerJob("nonexistent")).rejects.toThrow(
      "Unknown job: nonexistent",
    );

    await scheduler.stop();
  });

  // --- Graceful Shutdown ---

  it("stop is idempotent", async () => {
    writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);

    const scheduler = new WorkLoopScheduler({
      db,
      agentDir,
      pollIntervalMs: 999_999,
    });

    await scheduler.start();
    await scheduler.stop();
    await scheduler.stop(); // Should not throw
  });

  it("start is idempotent", async () => {
    writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);

    const scheduler = new WorkLoopScheduler({
      db,
      agentDir,
      pollIntervalMs: 999_999,
    });

    await scheduler.start();
    await scheduler.start(); // Should warn but not throw
    await scheduler.stop();
  });

  // --- Heartbeat Retry ---

  it("failed job leaves getLastRun null (heartbeat retry)", async () => {
    // Write patterns with a job that has an unknown handler name
    writeWorkPatterns(
      agentDir,
      `## Unknown Job Type\n- cadence: daily:08:00\n- model: haiku\n`,
    );

    const scheduler = new WorkLoopScheduler({
      db,
      agentDir,
      pollIntervalMs: 999_999,
    });

    await scheduler.start();

    // Trigger the unknown job — it will fail with "No handler for job"
    const run = await scheduler.triggerJob("unknown-job-type");
    expect(run.status).toBe("failed");
    expect(run.error).toContain("No handler for job");

    // getLastRun only considers completed runs — failed run means null
    expect(scheduler.getLastRun("unknown-job-type")).toBeNull();

    // isDue sees null lastRun → job stays due (would retry on next poll)
    // Use a time that is past the 08:00 cadence
    const afternoon = new Date();
    afternoon.setHours(14, 0, 0, 0);
    expect(isDue("daily:08:00", null, afternoon)).toBe(true);

    await scheduler.stop();
  });

  // --- Restart Persistence ---

  it("persists run history across scheduler restart", () => {
    writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);

    // Insert a completed run directly into the DB
    // Truncate to seconds to match SQLite ISO string round-trip
    const completedAt = new Date();
    completedAt.setMilliseconds(0);
    const startedAt = new Date(completedAt.getTime() - 1000);

    // Need to ensure the table exists first
    new WorkLoopScheduler({ db, agentDir, pollIntervalMs: 999_999 });

    db.prepare(
      `INSERT INTO work_loop_runs (id, job_name, started_at, completed_at, status, duration_ms, output)
       VALUES (?, ?, ?, ?, 'completed', 1000, 'test output')`,
    ).run(
      "persist-test",
      "morning-prep",
      startedAt.toISOString(),
      completedAt.toISOString(),
    );

    // Create a NEW scheduler instance (simulating restart) with same DB
    const scheduler2 = new WorkLoopScheduler({
      db,
      agentDir,
      pollIntervalMs: 999_999,
    });

    // Verify it can see the previous run
    const lastRun = scheduler2.getLastRun("morning-prep");
    expect(lastRun).not.toBeNull();
    expect(lastRun!.getTime()).toBe(completedAt.getTime());

    // Verify getRuns returns it too
    const runs = scheduler2.getRuns({ jobName: "morning-prep" });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
  });
});

// --- Real Haiku Job Tests (via dashboard endpoint) ---

// Top-level await: check reachability once before test collection
const dashboardAvailable = await isDashboardReachable();

const HAIKU_TIMEOUT = 60_000;

describe.skipIf(!dashboardAvailable)(
  "WorkLoopScheduler — real Haiku jobs via endpoint",
  () => {
    it(
      "morning-prep: produces output via endpoint",
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
      "daily-summary: produces output via endpoint",
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
      "unknown job returns error via endpoint",
      async () => {
        const result = await triggerJob("nonexistent-job");
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
      },
      HAIKU_TIMEOUT,
    );

    it(
      "sequential: two morning-prep triggers produce output",
      async () => {
        const run1 = await triggerJob("morning-prep");
        const run2 = await triggerJob("morning-prep");

        expect(run1.success).toBe(true);
        expect(run2.success).toBe(true);
        expect(run1.run.output).toBeTruthy();
        expect(run2.run.output).toBeTruthy();
      },
      HAIKU_TIMEOUT * 2,
    );
  },
);
