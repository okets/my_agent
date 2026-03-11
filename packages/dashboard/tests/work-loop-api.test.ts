/**
 * API route tests for work loop endpoints.
 *
 * Uses a minimal Fastify instance with just the work loop routes —
 * no static files, WebSocket, channels, or other dependencies.
 *
 * No API key needed: tests use an unknown job handler that fails immediately.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { registerWorkLoopRoutes } from "../src/routes/work-loop.js";
import { WorkLoopScheduler } from "../src/scheduler/work-loop-scheduler.js";

// Fastify decorator type (matches src/server.ts declaration)
declare module "fastify" {
  interface FastifyInstance {
    workLoopScheduler: WorkLoopScheduler | null;
  }
}

const WORK_PATTERNS_MD = `# Work Patterns

## Unknown Handler
- cadence: weekly:saturday:03:33
- model: haiku
`;

let tmpDir: string;
let db: Database.Database;
let fastify: FastifyInstance;
let scheduler: WorkLoopScheduler;

describe("work loop API routes", () => {
  beforeEach(async () => {
    // Create temp agent dir with work patterns
    tmpDir = mkdtempSync(join(tmpdir(), "wl-api-test-"));
    const notebookDir = join(tmpDir, "notebook", "config");
    mkdirSync(notebookDir, { recursive: true });
    writeFileSync(join(notebookDir, "work-patterns.md"), WORK_PATTERNS_MD);

    // Create in-memory DB with conversations table (scheduler queries it)
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        channel TEXT,
        title TEXT,
        topics TEXT,
        created TEXT NOT NULL,
        updated TEXT NOT NULL,
        turn_count INTEGER DEFAULT 0,
        participants TEXT,
        abbreviation TEXT,
        needs_abbreviation INTEGER DEFAULT 0
      )
    `);

    // Create scheduler and minimal Fastify server
    scheduler = new WorkLoopScheduler({
      db,
      agentDir: tmpDir,
      pollIntervalMs: 999_999,
    });
    await scheduler.start();

    fastify = Fastify();
    fastify.decorate("workLoopScheduler", scheduler);
    await registerWorkLoopRoutes(fastify);
  });

  afterEach(async () => {
    await scheduler.stop();
    await fastify.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/work-loop/status returns running status and patterns", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/work-loop/status",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.running).toBe(true);
    expect(body.patterns).toBeInstanceOf(Array);
    expect(body.patterns.length).toBeGreaterThan(0);
    expect(body.recentRuns).toBeInstanceOf(Array);
  });

  it("GET /api/work-loop/events returns FullCalendar-compatible events", async () => {
    // Insert a run into the DB manually so there's data
    db.prepare(
      `INSERT INTO work_loop_runs (id, job_name, started_at, completed_at, status, duration_ms, output)
       VALUES (?, ?, ?, ?, 'completed', 5000, 'test output')`,
    ).run(
      "api-test-run",
      "unknown-handler",
      new Date().toISOString(),
      new Date().toISOString(),
    );

    const res = await fastify.inject({
      method: "GET",
      url: "/api/work-loop/events",
    });
    expect(res.statusCode).toBe(200);
    const events = res.json();
    expect(events).toBeInstanceOf(Array);

    // Should have at least the manual run + possibly scheduled events
    const pastRun = events.find(
      (e: { id: string }) => e.id === "wl-api-test-run",
    );
    expect(pastRun).toBeTruthy();
    expect(pastRun.extendedProps.type).toBe("work-loop");
    expect(pastRun.extendedProps.status).toBe("completed");
    expect(pastRun.start).toBeTruthy();
    expect(pastRun.end).toBeTruthy();
    expect(pastRun.color).toBeTruthy();
  });

  it("POST /api/work-loop/trigger/nonexistent returns 400", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/api/work-loop/trigger/nonexistent",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Unknown job");
  });

  it("POST /api/work-loop/trigger triggers job and returns result", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/api/work-loop/trigger/unknown-handler",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(false); // Job fails because no handler exists
    expect(body.run).toBeTruthy();
    expect(body.run.status).toBe("failed");
    expect(body.run.error).toContain("No handler for job");
  });

  it("GET /api/work-loop/jobs/:jobName returns job detail with run history", async () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const started = new Date(now.getTime() - (i + 1) * 3600_000);
      db.prepare(
        `INSERT INTO work_loop_runs (id, job_name, started_at, completed_at, status, duration_ms, output)
         VALUES (?, ?, ?, ?, 'completed', 5000, 'output ${i}')`,
      ).run(
        `history-${i}`,
        "unknown-handler",
        started.toISOString(),
        started.toISOString(),
      );
    }

    const res = await fastify.inject({
      method: "GET",
      url: "/api/work-loop/jobs/unknown-handler",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.name).toBe("unknown-handler");
    expect(body.displayName).toBe("Unknown Handler");
    expect(body.cadence).toBeTruthy();
    expect(body.model).toBeTruthy();
    expect(body.nextRun).toBeTruthy();

    expect(body.runs).toBeInstanceOf(Array);
    expect(body.runs.length).toBe(3);
    expect(body.runs[0].status).toBe("completed");
    expect(new Date(body.runs[0].started_at).getTime()).toBeGreaterThan(
      new Date(body.runs[1].started_at).getTime(),
    );
  });

  it("GET /api/work-loop/jobs/nonexistent returns 404", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/work-loop/jobs/nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/work-loop/jobs/:jobName includes prompts field", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/work-loop/jobs/unknown-handler",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("prompts");
  });

  it("GET /api/work-loop/events shows multiple manual runs as separate events", async () => {
    const now = new Date();
    // Simulate 3 manual triggers 10 minutes apart
    for (let i = 0; i < 3; i++) {
      const started = new Date(now.getTime() - i * 10 * 60_000);
      db.prepare(
        `INSERT INTO work_loop_runs (id, job_name, started_at, completed_at, status, duration_ms, output)
         VALUES (?, ?, ?, ?, 'completed', 5000, 'manual run ${i}')`,
      ).run(
        `manual-${i}`,
        "unknown-handler",
        started.toISOString(),
        started.toISOString(),
      );
    }

    const res = await fastify.inject({
      method: "GET",
      url: "/api/work-loop/events",
    });
    expect(res.statusCode).toBe(200);
    const events = res.json();

    // All 3 manual runs should appear as separate completed events
    const manualRuns = events.filter(
      (e: any) =>
        e.id.startsWith("wl-manual-") && e.extendedProps.status === "completed",
    );
    expect(manualRuns.length).toBe(3);

    // Each should have a distinct start time
    const starts = new Set(manualRuns.map((e: any) => e.start));
    expect(starts.size).toBe(3);
  });

  it("GET /api/work-loop/events does not duplicate scheduled and completed for same time", async () => {
    // Insert a completed run at the pattern's scheduled time (Saturday 03:33)
    // Find the next Saturday 03:33 from now
    const now = new Date();
    const nextSat = new Date(now);
    nextSat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
    nextSat.setHours(3, 33, 0, 0);

    // Insert a run at that exact time (simulating it already ran)
    db.prepare(
      `INSERT INTO work_loop_runs (id, job_name, started_at, completed_at, status, duration_ms, output)
       VALUES (?, ?, ?, ?, 'completed', 5000, 'ran on schedule')`,
    ).run(
      "sched-run",
      "unknown-handler",
      nextSat.toISOString(),
      nextSat.toISOString(),
    );

    // Query a range that includes that Saturday
    const start = new Date(now.getTime() - 24 * 60 * 60_000);
    const end = new Date(nextSat.getTime() + 24 * 60 * 60_000);

    const res = await fastify.inject({
      method: "GET",
      url: `/api/work-loop/events?start=${start.toISOString()}&end=${end.toISOString()}`,
    });
    expect(res.statusCode).toBe(200);
    const events = res.json();

    // The completed run should be there
    const completedRun = events.find((e: any) => e.id === "wl-sched-run");
    expect(completedRun).toBeTruthy();

    // Scheduled occurrences should only be in the future (after now)
    const scheduled = events.filter(
      (e: any) => e.extendedProps.status === "scheduled",
    );
    for (const evt of scheduled) {
      expect(new Date(evt.start).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("GET /api/work-loop/events returns multiple future scheduled occurrences", async () => {
    const now = new Date();
    const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const res = await fastify.inject({
      method: "GET",
      url: `/api/work-loop/events?start=${now.toISOString()}&end=${twoWeeksOut.toISOString()}`,
    });
    expect(res.statusCode).toBe(200);
    const events = res.json();

    // The test pattern is weekly:saturday:03:33
    // Over 14 days there should be 1-2 scheduled occurrences
    const scheduled = events.filter(
      (e: any) => e.extendedProps.status === "scheduled",
    );
    expect(scheduled.length).toBeGreaterThanOrEqual(1);

    // All scheduled events should have the same jobName
    for (const evt of scheduled) {
      expect(evt.extendedProps.jobName).toBe("unknown-handler");
    }
  });
});
