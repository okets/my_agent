/**
 * REST API routes for automations + jobs.
 *
 * All mutation routes use app.automations.* for event emission.
 */

import type { FastifyInstance } from "fastify";

export async function registerAutomationRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/automations — list automations
  fastify.get<{ Querystring: { status?: string } }>(
    "/api/automations",
    async (request) => {
      const app = fastify.app;
      if (!app?.automationManager) {
        return { automations: [] };
      }

      const filter = request.query.status
        ? { status: request.query.status }
        : undefined;
      const automations = app.automations.list(filter);
      return {
        automations: automations.map((a) => ({
          id: a.id,
          name: a.manifest.name,
          status: a.manifest.status,
          system: a.manifest.system ?? false,
          trigger: a.manifest.trigger,
          spaces: a.manifest.spaces ?? [],
          model: a.manifest.model,
          notify: a.manifest.notify,
          autonomy: a.manifest.autonomy,
          once: a.manifest.once,
          created: a.manifest.created,
        })),
      };
    },
  );

  // GET /api/automations/:id — get automation detail + recent jobs
  fastify.get<{ Params: { id: string } }>(
    "/api/automations/:id",
    async (request, reply) => {
      const app = fastify.app;
      if (!app?.automationManager) {
        return reply.code(404).send({ error: "Automations not initialized" });
      }

      // Try disk read first, fall back to DB index (list widget uses DB,
      // so an automation visible in the widget must be findable here too)
      const automation =
        app.automations.read(request.params.id) ??
        app.automations.findById(request.params.id);
      if (!automation) {
        return reply.code(404).send({ error: "Automation not found" });
      }

      const jobs = app.automations.listJobs({
        automationId: automation.id,
        limit: 20,
      });

      return {
        id: automation.id,
        name: automation.manifest.name,
        status: automation.manifest.status,
        trigger: automation.manifest.trigger,
        spaces: automation.manifest.spaces ?? [],
        model: automation.manifest.model,
        notify: automation.manifest.notify,
        autonomy: automation.manifest.autonomy,
        once: automation.manifest.once,
        created: automation.manifest.created,
        instructions: automation.instructions,
        jobs: jobs.map((j) => ({
          id: j.id,
          status: j.status,
          created: j.created,
          completed: j.completed,
          summary: j.summary,
        })),
      };
    },
  );

  // POST /api/automations/:id/fire — fire an automation
  fastify.post<{ Params: { id: string } }>(
    "/api/automations/:id/fire",
    async (request, reply) => {
      const app = fastify.app;
      if (!app?.automationManager) {
        return reply.code(503).send({ error: "Automations not initialized" });
      }

      try {
        // Fire async — don't await full execution
        app.automations
          .fire(request.params.id)
          .catch((err) =>
            console.error(
              `[automations-api] fire failed for ${request.params.id}:`,
              err,
            ),
          );
        return { ok: true, message: "Automation fired" };
      } catch (err) {
        return reply.code(404).send({
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
  );

  // GET /api/automations/:id/jobs — list jobs for automation
  fastify.get<{
    Params: { id: string };
    Querystring: { status?: string; limit?: string };
  }>("/api/automations/:id/jobs", async (request) => {
    const app = fastify.app;
    if (!app?.automationJobService) {
      return { jobs: [] };
    }

    const jobs = app.automations.listJobs({
      automationId: request.params.id,
      status: request.query.status,
      limit: request.query.limit ? parseInt(request.query.limit, 10) : 50,
    });

    return {
      jobs: jobs.map((j) => ({
        id: j.id,
        automationId: j.automationId,
        status: j.status,
        created: j.created,
        completed: j.completed,
        summary: j.summary,
      })),
    };
  });

  // GET /api/jobs — list all jobs (timeline query)
  fastify.get<{
    Querystring: { since?: string; limit?: string; status?: string };
  }>("/api/jobs", async (request) => {
    const app = fastify.app;
    if (!app?.automationJobService) {
      return { jobs: [] };
    }

    const jobs = app.automations.listJobs({
      since: request.query.since,
      status: request.query.status,
      limit: request.query.limit ? parseInt(request.query.limit, 10) : 50,
    });

    return {
      jobs: jobs.map((j) => {
        const automation = app.automationManager?.findById(j.automationId);
        return {
          id: j.id,
          automationId: j.automationId,
          automationName: automation?.manifest.name ?? j.automationId,
          status: j.status,
          created: j.created,
          completed: j.completed,
          summary: j.summary,
        };
      }),
    };
  });

  // GET /api/jobs/:id — get job detail
  fastify.get<{ Params: { id: string } }>(
    "/api/jobs/:id",
    async (request, reply) => {
      const app = fastify.app;
      if (!app?.automationJobService) {
        return reply.code(503).send({ error: "Jobs not initialized" });
      }

      const job = app.automations.getJob(request.params.id);
      if (!job) {
        return reply.code(404).send({ error: "Job not found" });
      }

      const automation = app.automationManager?.findById(job.automationId);

      return {
        id: job.id,
        automationId: job.automationId,
        automationName: automation?.manifest.name ?? job.automationId,
        status: job.status,
        created: job.created,
        completed: job.completed,
        summary: job.summary,
        context: job.context,
        sdkSessionId: job.sdk_session_id,
        runDir: job.run_dir,
      };
    },
  );

  // POST /api/jobs/:id/resume — resume a needs_review job
  fastify.post<{ Params: { id: string }; Body: { userResponse: string } }>(
    "/api/jobs/:id/resume",
    async (request, reply) => {
      const app = fastify.app;
      if (!app?.automationManager) {
        return reply.code(503).send({ error: "Automations not initialized" });
      }

      const body = request.body as { userResponse?: string };
      if (!body?.userResponse) {
        return reply
          .code(400)
          .send({ error: "Missing userResponse in body" });
      }

      try {
        app.automations
          .resume(request.params.id, body.userResponse)
          .catch((err) =>
            console.error(
              `[automations-api] resume failed for ${request.params.id}:`,
              err,
            ),
          );
        return { ok: true, message: "Job resumed" };
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
  );

  // PATCH /api/automations/:id — update automation manifest fields
  fastify.patch<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>("/api/automations/:id", async (request, reply) => {
    const app = fastify.app;
    if (!app?.automationManager) {
      return reply.code(503).send({ error: "Automations not initialized" });
    }

    const automation = app.automations.findById(request.params.id);
    if (!automation) {
      return reply.code(404).send({ error: "Automation not found" });
    }

    if (automation.manifest.system) {
      return reply
        .code(403)
        .send({ error: "Cannot modify system automation" });
    }

    try {
      const updated = app.automationManager.update(
        request.params.id,
        request.body as Record<string, unknown>,
      );
      app.emit("automation:updated", updated);
      return {
        id: updated.id,
        name: updated.manifest.name,
        status: updated.manifest.status,
      };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  // DELETE /api/automations/:id — delete (disable) an automation
  fastify.delete<{ Params: { id: string } }>(
    "/api/automations/:id",
    async (request, reply) => {
      const app = fastify.app;
      if (!app?.automationManager) {
        return reply.code(503).send({ error: "Automations not initialized" });
      }

      const automation = app.automations.findById(request.params.id);
      if (!automation) {
        return reply.code(404).send({ error: "Automation not found" });
      }

      if (automation.manifest.system) {
        return reply
          .code(403)
          .send({ error: "Cannot delete system automation" });
      }

      try {
        app.automationManager.disable(request.params.id);
        app.emit("automation:deleted", request.params.id);
        return { ok: true, message: "Automation disabled" };
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
  );

  // GET /api/automations/next-runs — projected future runs
  fastify.get("/api/automations/next-runs", async () => {
    const app = fastify.app;
    if (!app?.automationScheduler) {
      return { runs: [] };
    }

    const runs = app.automationScheduler.getNextRuns(10);
    return {
      runs: runs.map((r) => ({
        automationId: r.automationId,
        name: r.name,
        nextRun: r.nextRun.toISOString(),
      })),
    };
  });
}
