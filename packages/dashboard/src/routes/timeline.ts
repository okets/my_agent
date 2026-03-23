/**
 * REST API routes for timeline — combined past jobs + future projections.
 *
 * GET /api/timeline?before=&after=&limit= — past jobs with automation metadata
 * GET /api/timeline/future?hours=24 — projected future runs from cron schedules
 */

import type { FastifyInstance } from "fastify";

export async function registerTimelineRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/timeline — past jobs with automation name + trigger config
  fastify.get<{
    Querystring: { before?: string; after?: string; limit?: string };
  }>("/api/timeline", async (request) => {
    const app = fastify.app;
    if (!app?.automationJobService) {
      return { pastJobs: [], futureRuns: [] };
    }

    const convManager = fastify.conversationManager;
    if (!convManager) {
      return { pastJobs: [], futureRuns: [] };
    }
    const db = convManager.getConversationDb();

    const { before, after, limit } = request.query;
    const pastJobs = db.getTimelineJobs({
      before,
      after,
      limit: limit ? parseInt(limit, 10) : 20,
    });

    // Also include future projections in the combined response
    const futureRuns = getFutureRuns(app, 24);

    return { pastJobs, futureRuns };
  });

  // GET /api/timeline/future?hours=24 — projected future runs from cron schedules
  fastify.get<{
    Querystring: { hours?: string };
  }>("/api/timeline/future", async (request) => {
    const app = fastify.app;
    if (!app?.automationScheduler) {
      return { futureRuns: [] };
    }

    const hours = request.query.hours
      ? parseInt(request.query.hours, 10)
      : 24;
    const futureRuns = getFutureRuns(app, hours);

    return { futureRuns };
  });
}

/**
 * Get projected future runs from the automation scheduler.
 */
function getFutureRuns(
  app: NonNullable<import("fastify").FastifyInstance["app"]>,
  _hours: number,
): Array<{
  id: string;
  automationId: string;
  automationName: string;
  scheduledFor: string;
  triggerType: string;
  status: string;
}> {
  if (!app.automationScheduler) return [];

  const runs = app.automationScheduler.getNextRuns(20);
  return runs.map((r) => ({
    id: `projected-${r.automationId}-${r.nextRun.toISOString()}`,
    automationId: r.automationId,
    automationName: r.name,
    scheduledFor: r.nextRun.toISOString(),
    triggerType: "schedule",
    status: "scheduled",
  }));
}
