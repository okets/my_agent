/**
 * Work Patterns Settings API (spec §3.2)
 *
 * Dedicated endpoint for managing job cadence via work-patterns.md frontmatter.
 * Separate from /api/settings/preferences which handles config.yaml.
 *
 * - GET  /api/settings/work-patterns  — read job cadences/models
 * - PUT  /api/settings/work-patterns  — update job cadences/models
 */

import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { readFrontmatter, writeFrontmatter } from "../metadata/frontmatter.js";
import type { WorkPatternsFrontmatter } from "../scheduler/work-patterns.js";

export async function registerWorkPatternsSettingsRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const workPatternsPath = () =>
    join(fastify.agentDir, "notebook", "config", "work-patterns.md");

  /**
   * GET /api/settings/work-patterns
   *
   * Returns job cadence/model from work-patterns.md frontmatter.
   */
  fastify.get("/api/settings/work-patterns", async (request, reply) => {
    try {
      const { data } = readFrontmatter<WorkPatternsFrontmatter>(workPatternsPath());
      return { jobs: data.jobs ?? {} };
    } catch (err) {
      fastify.log.error(
        "[WorkPatternsSettings] Failed to read: %s",
        err instanceof Error ? err.message : String(err),
      );
      return reply.code(500).send({ error: "Failed to read work patterns" });
    }
  });

  /**
   * PUT /api/settings/work-patterns
   *
   * Accepts partial job updates. Merges into existing frontmatter.
   * Calls scheduler.reloadPatterns() to pick up changes immediately.
   */
  fastify.put<{
    Body: { jobs: Record<string, Partial<{ cadence: string; model: string }>> };
  }>("/api/settings/work-patterns", async (request, reply) => {
    const body = request.body as {
      jobs?: Record<string, Partial<{ cadence: string; model: string }>>;
    };

    if (!body.jobs || typeof body.jobs !== "object") {
      return reply.code(400).send({ error: "Request body must contain a 'jobs' object" });
    }

    try {
      const filePath = workPatternsPath();
      const { data, body: mdBody } = readFrontmatter<WorkPatternsFrontmatter>(filePath);

      // Deep merge: update existing jobs, add new ones
      const existingJobs = data.jobs ?? {};
      for (const [jobName, updates] of Object.entries(body.jobs)) {
        const existing = existingJobs[jobName] ?? { cadence: "", model: "haiku" };
        existingJobs[jobName] = {
          ...existing,
          ...updates,
        };
      }

      writeFrontmatter(filePath, { ...data, jobs: existingJobs }, mdBody);

      // Reload scheduler patterns
      const scheduler = fastify.workLoopScheduler;
      if (scheduler) {
        await scheduler.reloadPatterns();
      }

      fastify.log.info("[WorkPatternsSettings] Updated work patterns");
      return { jobs: existingJobs };
    } catch (err) {
      fastify.log.error(
        "[WorkPatternsSettings] Failed to update: %s",
        err instanceof Error ? err.message : String(err),
      );
      return reply.code(500).send({ error: "Failed to update work patterns" });
    }
  });
}
