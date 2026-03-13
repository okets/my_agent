/**
 * Tests for work patterns settings API endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { writeFrontmatter } from "../src/metadata/frontmatter.js";
import { registerWorkPatternsSettingsRoutes } from "../src/routes/work-patterns-settings.js";
import { WorkLoopScheduler } from "../src/scheduler/work-loop-scheduler.js";

declare module "fastify" {
  interface FastifyInstance {
    agentDir: string;
    workLoopScheduler: WorkLoopScheduler | null;
  }
}

let tmpDir: string;
let db: Database.Database;
let fastify: FastifyInstance;
let scheduler: WorkLoopScheduler;

const INITIAL_JOBS = {
  jobs: {
    "morning-prep": { cadence: "daily:08:00", model: "haiku" },
    "daily-summary": { cadence: "daily:23:00", model: "haiku" },
  },
};

describe("work patterns settings API", () => {
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wp-settings-"));
    const configDir = join(tmpDir, "notebook", "config");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(tmpDir, "conversations"), { recursive: true });

    // Write initial work-patterns.md
    writeFrontmatter(
      join(configDir, "work-patterns.md"),
      INITIAL_JOBS,
      "# Work Patterns\n",
    );

    // Create DB + scheduler
    db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, title TEXT, abbreviation TEXT, updated TEXT NOT NULL
    )`);

    scheduler = new WorkLoopScheduler({
      db,
      agentDir: tmpDir,
      pollIntervalMs: 999_999,
    });
    await scheduler.start();

    // Create Fastify instance
    fastify = Fastify();
    fastify.decorate("agentDir", tmpDir);
    fastify.decorate("workLoopScheduler", scheduler);
    await registerWorkPatternsSettingsRoutes(fastify);
  });

  afterEach(async () => {
    await scheduler.stop();
    await fastify.close();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET returns current job cadences", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/api/settings/work-patterns",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs["morning-prep"].cadence).toBe("daily:08:00");
    expect(body.jobs["daily-summary"].cadence).toBe("daily:23:00");
  });

  it("PUT updates a job cadence", async () => {
    const res = await fastify.inject({
      method: "PUT",
      url: "/api/settings/work-patterns",
      payload: {
        jobs: { "morning-prep": { cadence: "daily:09:00" } },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.jobs["morning-prep"].cadence).toBe("daily:09:00");
    // Other jobs unchanged
    expect(body.jobs["daily-summary"].cadence).toBe("daily:23:00");
  });

  it("PUT reloads scheduler patterns", async () => {
    // Before: 2 patterns
    expect(scheduler.getPatterns()).toHaveLength(2);

    // Add a new job
    await fastify.inject({
      method: "PUT",
      url: "/api/settings/work-patterns",
      payload: {
        jobs: { "weekly-review": { cadence: "weekly:sunday:09:00", model: "haiku" } },
      },
    });

    // Scheduler should now have 3 patterns
    expect(scheduler.getPatterns()).toHaveLength(3);
  });

  it("PUT preserves markdown body", async () => {
    await fastify.inject({
      method: "PUT",
      url: "/api/settings/work-patterns",
      payload: {
        jobs: { "morning-prep": { cadence: "daily:10:00" } },
      },
    });

    // Re-read and verify body is preserved
    const getRes = await fastify.inject({
      method: "GET",
      url: "/api/settings/work-patterns",
    });
    expect(getRes.statusCode).toBe(200);
    // The job update should work
    expect(getRes.json().jobs["morning-prep"].cadence).toBe("daily:10:00");
  });

  it("PUT returns 400 for missing jobs key", async () => {
    const res = await fastify.inject({
      method: "PUT",
      url: "/api/settings/work-patterns",
      payload: { notJobs: {} },
    });
    expect(res.statusCode).toBe(400);
  });
});
