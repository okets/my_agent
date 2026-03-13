/**
 * Work Loop API Routes
 *
 * REST API for work loop scheduler:
 * - GET  /api/work-loop/events    — FullCalendar-compatible events
 * - GET  /api/work-loop/status    — Current scheduler status
 * - POST /api/work-loop/trigger/:jobName — Manual job trigger
 */

import type { FastifyInstance } from "fastify";
import { getNextScheduledTime } from "../scheduler/work-patterns.js";

// Catppuccin Mocha colors
const COLORS = {
  purple: "#cba6f7",
  red: "#f38ba8",
  surface2: "#585b70",
};

interface WorkLoopEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  textColor: string;
  borderColor?: string;
  display?: string;
  extendedProps: {
    type: "work-loop";
    jobName: string;
    status: string;
    durationMs?: number | null;
    output?: string | null;
    error?: string | null;
  };
}

/**
 * Register work loop API routes
 */
export async function registerWorkLoopRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/work-loop/events
   *
   * Returns FullCalendar-compatible events from work_loop_runs + upcoming scheduled
   */
  fastify.get<{
    Querystring: { start?: string; end?: string };
    Reply: WorkLoopEvent[];
  }>("/api/work-loop/events", async (request) => {
    const scheduler = fastify.workLoopScheduler;
    if (!scheduler) return [];

    const { start, end } = request.query;
    const startDate = start
      ? new Date(start)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const endDate = end
      ? new Date(end)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const events: WorkLoopEvent[] = [];

    // Past/current runs from DB
    const runs = scheduler.getRuns({ since: startDate, limit: 200 });
    for (const run of runs) {
      const runStart = new Date(run.started_at);
      if (runStart > endDate) continue;

      const durationMs = run.duration_ms ?? 30 * 60_000; // Default 30min display width
      const minDisplay = 30 * 60_000; // 30 min so it's visible in week view
      const runEnd = new Date(
        runStart.getTime() + Math.max(durationMs, minDisplay),
      );

      let color: string;
      switch (run.status) {
        case "completed":
          color = COLORS.purple;
          break;
        case "failed":
          color = COLORS.red;
          break;
        default:
          color = COLORS.surface2;
      }

      events.push({
        id: `wl-${run.id}`,
        title: formatJobTitle(run.job_name),
        start: runStart.toISOString(),
        end: runEnd.toISOString(),
        allDay: false,
        color,
        textColor: "#ffffff",
        extendedProps: {
          type: "work-loop",
          jobName: run.job_name,
          status: run.status,
          durationMs: run.duration_ms,
          output: run.output,
          error: run.error,
        },
      });
    }

    // Upcoming scheduled runs (future only — past occurrences show as actual runs from DB)
    const now = new Date();
    const resolvedTimezone = await scheduler.getResolvedTimezone();
    const patterns = scheduler.getPatterns();
    for (const pattern of patterns) {
      let cursor = new Date(Math.max(startDate.getTime(), now.getTime()));
      let safety = 0;
      const maxOccurrences = 50;

      while (safety < maxOccurrences) {
        const nextTime = getNextScheduledTime(
          pattern.cadence,
          cursor,
          resolvedTimezone,
        );
        if (!nextTime || nextTime > endDate) break;

        const displayDuration = 30 * 60_000; // 30 min so it's visible in week view
        events.push({
          id: `wl-sched-${pattern.name}-${nextTime.getTime()}`,
          title: `${pattern.displayName} (scheduled)`,
          start: nextTime.toISOString(),
          end: new Date(nextTime.getTime() + displayDuration).toISOString(),
          allDay: false,
          color: "transparent",
          textColor: COLORS.purple,
          borderColor: COLORS.purple,
          display: "auto",
          extendedProps: {
            type: "work-loop",
            jobName: pattern.name,
            status: "scheduled",
          },
        });

        // Move cursor past this occurrence to find the next one
        cursor = new Date(nextTime.getTime() + displayDuration);
        safety++;
      }
    }

    return events;
  });

  /**
   * GET /api/work-loop/status
   *
   * Returns scheduler status and job configuration
   */
  fastify.get("/api/work-loop/status", async () => {
    const scheduler = fastify.workLoopScheduler;
    if (!scheduler) {
      return {
        running: false,
        patterns: [],
        recentRuns: [],
        resolvedTimezone: "UTC",
      };
    }

    const resolvedTimezone = await scheduler.getResolvedTimezone();

    const patterns = scheduler.getPatterns().map((p) => ({
      name: p.name,
      displayName: p.displayName,
      cadence: p.cadence,
      model: p.model,
      lastRun: scheduler.getLastRun(p.name)?.toISOString() ?? null,
      nextRun:
        getNextScheduledTime(
          p.cadence,
          undefined,
          resolvedTimezone,
        )?.toISOString() ?? null,
    }));

    const recentRuns = scheduler.getRuns({ limit: 10 });

    return {
      running: true,
      patterns,
      recentRuns,
      resolvedTimezone,
    };
  });

  /**
   * GET /api/work-loop/jobs/:jobName
   *
   * Returns job metadata + run history for a single job
   */
  fastify.get<{
    Params: { jobName: string };
    Querystring: { limit?: string };
  }>("/api/work-loop/jobs/:jobName", async (request, reply) => {
    const scheduler = fastify.workLoopScheduler;
    if (!scheduler) {
      return reply.code(503).send({ error: "Scheduler not running" });
    }

    const { jobName } = request.params;
    const limit = parseInt(request.query.limit || "20", 10);

    const pattern = scheduler.getPatterns().find((p) => p.name === jobName);
    if (!pattern) {
      return reply.code(404).send({ error: `Unknown job: ${jobName}` });
    }

    const runs = scheduler.getRuns({ jobName, limit });
    const lastRun = scheduler.getLastRun(jobName);
    const resolvedTimezone = await scheduler.getResolvedTimezone();
    const nextRun = getNextScheduledTime(
      pattern.cadence,
      undefined,
      resolvedTimezone,
    );
    const prompts = scheduler.getJobPrompts(jobName);

    return {
      name: pattern.name,
      displayName: pattern.displayName,
      cadence: pattern.cadence,
      model: pattern.model,
      lastRun: lastRun?.toISOString() ?? null,
      nextRun: nextRun?.toISOString() ?? null,
      prompts: prompts ?? null,
      runs,
    };
  });

  /**
   * POST /api/work-loop/trigger/:jobName
   *
   * Manually trigger a job. Returns the run result.
   */
  fastify.post<{
    Params: { jobName: string };
    Reply: { success: boolean; run?: any; error?: string };
  }>("/api/work-loop/trigger/:jobName", async (request, reply) => {
    const scheduler = fastify.workLoopScheduler;
    if (!scheduler) {
      return reply
        .code(503)
        .send({ success: false, error: "Work loop scheduler not running" });
    }

    const { jobName } = request.params;

    try {
      const run = await scheduler.triggerJob(jobName);
      return {
        success: run.status === "completed",
        run,
        error: run.error ?? undefined,
      };
    } catch (err) {
      return reply.code(400).send({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/**
 * Format job name for display: "debrief-prep" → "Debrief Prep"
 */
function formatJobTitle(jobName: string): string {
  return jobName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
