/**
 * Asset serving routes for stored screenshots.
 *
 * Serves screenshots from two locations:
 *   - Job screenshots:          {agentDir}/automations/.runs/{automationId}/{jobId}/screenshots/{filename}
 *   - Conversation screenshots: {agentDir}/conversations/{contextId}/screenshots/{filename}
 */

import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";

/** Reject path segments that could be used for directory traversal. */
function isSafe(segment: string): boolean {
  return !segment.includes("..") && !segment.includes("/") && !segment.includes("\\");
}

export async function registerAssetRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/assets/job/:automationId/:jobId/screenshots/:filename
  fastify.get<{
    Params: { automationId: string; jobId: string; filename: string };
  }>(
    "/api/assets/job/:automationId/:jobId/screenshots/:filename",
    async (request, reply) => {
      const { automationId, jobId, filename } = request.params;

      if (!isSafe(automationId) || !isSafe(jobId) || !isSafe(filename)) {
        return reply.code(400).send({ error: "Invalid path segment" });
      }

      const filePath = join(
        fastify.agentDir,
        "automations",
        ".runs",
        automationId,
        jobId,
        "screenshots",
        filename,
      );

      try {
        await access(filePath);
      } catch {
        return reply.code(404).send({ error: "File not found" });
      }

      return reply
        .type("image/png")
        .send(createReadStream(filePath));
    },
  );

  // GET /api/assets/conversation/:contextId/screenshots/:filename
  fastify.get<{
    Params: { contextId: string; filename: string };
  }>(
    "/api/assets/conversation/:contextId/screenshots/:filename",
    async (request, reply) => {
      const { contextId, filename } = request.params;

      if (!isSafe(contextId) || !isSafe(filename)) {
        return reply.code(400).send({ error: "Invalid path segment" });
      }

      const filePath = join(
        fastify.agentDir,
        "conversations",
        contextId,
        "screenshots",
        filename,
      );

      try {
        await access(filePath);
      } catch {
        return reply.code(404).send({ error: "File not found" });
      }

      return reply
        .type("image/png")
        .send(createReadStream(filePath));
    },
  );
}
