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

// --- Real Haiku Job Tests ---

const hasApiKey = !!(
  process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN
);
const describeWithApi = hasApiKey ? describe : describe.skip;
const HAIKU_TIMEOUT = 30_000;

describeWithApi("WorkLoopScheduler — real Haiku jobs", () => {
  let agentDir: string;
  let db: Database.Database;

  beforeEach(() => {
    agentDir = createTempAgentDir();
    db = new Database(join(agentDir, "conversations", "agent.db"));
    db.pragma("journal_mode = WAL");

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

  it(
    "morning-prep: produces output and writes current-state.md",
    async () => {
      writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);

      // Seed reference data
      writeFileSync(
        join(agentDir, "notebook", "reference", "contacts.md"),
        "# Contacts\n\n- Kai (local guide in Chiang Mai)\n",
        "utf-8",
      );

      // Seed yesterday's daily log
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split("T")[0];
      writeFileSync(
        join(agentDir, "notebook", "daily", `${dateStr}.md`),
        `# Daily Log — ${dateStr}\n\n- Arrived in Chiang Mai\n- Visited Doi Suthep temple\n- Had khao soi for dinner\n`,
        "utf-8",
      );

      const scheduler = new WorkLoopScheduler({
        db,
        agentDir,
        pollIntervalMs: 999_999,
      });

      await scheduler.start();
      const run = await scheduler.triggerJob("morning-prep");

      // Verify run record
      expect(run.status).toBe("completed");
      expect(run.job_name).toBe("morning-prep");
      expect(run.output).toBeTruthy();
      expect(run.duration_ms).toBeGreaterThan(0);
      expect(run.error).toBeNull();

      // Verify current-state.md was written
      const currentStatePath = join(
        agentDir,
        "notebook",
        "operations",
        "current-state.md",
      );
      expect(existsSync(currentStatePath)).toBe(true);

      const content = readFileSync(currentStatePath, "utf-8");
      expect(content.length).toBeGreaterThan(0);
      expect(content.toLowerCase()).toContain("chiang mai");

      // Verify getLastRun is updated
      expect(scheduler.getLastRun("morning-prep")).not.toBeNull();

      // Verify getRuns returns the run
      const runs = scheduler.getRuns({ jobName: "morning-prep" });
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("completed");

      await scheduler.stop();
    },
    HAIKU_TIMEOUT,
  );

  it(
    "daily-summary: produces output and appends to daily log",
    async () => {
      writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);

      // Seed today's daily log
      const dateStr = new Date().toISOString().split("T")[0];
      writeFileSync(
        join(agentDir, "notebook", "daily", `${dateStr}.md`),
        `# Daily Log — ${dateStr}\n\n- Explored Old City in Chiang Mai\n- Booked Krabi hotel\n- Had pad krapao for lunch\n`,
        "utf-8",
      );

      // Seed a conversation abbreviation
      db.prepare(
        `INSERT INTO conversations (id, title, abbreviation, updated) VALUES (?, ?, ?, ?)`,
      ).run(
        "test-conv-1",
        "Travel Planning",
        "Discussed Krabi itinerary. Decided on 4-island tour. Budget: 2000 THB per person.",
        new Date().toISOString(),
      );

      const scheduler = new WorkLoopScheduler({
        db,
        agentDir,
        pollIntervalMs: 999_999,
      });

      await scheduler.start();
      const run = await scheduler.triggerJob("daily-summary");

      expect(run.status).toBe("completed");
      expect(run.output).toBeTruthy();
      expect(run.duration_ms).toBeGreaterThan(0);

      // Verify summary was appended to daily log
      const logContent = readFileSync(
        join(agentDir, "notebook", "daily", `${dateStr}.md`),
        "utf-8",
      );
      expect(logContent).toContain("End of Day Summary");

      await scheduler.stop();
    },
    HAIKU_TIMEOUT,
  );

  it(
    "failed job is recorded with error in DB",
    async () => {
      // Write patterns with an unknown job name
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
      const run = await scheduler.triggerJob("unknown-job-type");

      expect(run.status).toBe("failed");
      expect(run.error).toContain("No handler for job");
      expect(run.duration_ms).toBeGreaterThanOrEqual(0);

      await scheduler.stop();
    },
    HAIKU_TIMEOUT,
  );

  it(
    "sequential: two triggers don't overlap",
    async () => {
      writeWorkPatterns(agentDir, LIFECYCLE_PATTERNS);

      // Seed minimal data
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split("T")[0];
      writeFileSync(
        join(agentDir, "notebook", "daily", `${dateStr}.md`),
        `# Daily Log — ${dateStr}\n\n- Quick day in Chiang Mai\n`,
        "utf-8",
      );

      const scheduler = new WorkLoopScheduler({
        db,
        agentDir,
        pollIntervalMs: 999_999,
      });

      await scheduler.start();

      // Trigger two jobs sequentially
      const run1 = await scheduler.triggerJob("morning-prep");
      const run2 = await scheduler.triggerJob("morning-prep");

      expect(run1.status).toBe("completed");
      expect(run2.status).toBe("completed");

      // Second should start after first completed
      const end1 = new Date(run1.completed_at!).getTime();
      const start2 = new Date(run2.started_at).getTime();
      expect(start2).toBeGreaterThanOrEqual(end1);

      // Should have 2 runs in DB
      const runs = scheduler.getRuns({ jobName: "morning-prep" });
      expect(runs).toHaveLength(2);

      await scheduler.stop();
    },
    HAIKU_TIMEOUT * 2,
  );
});
