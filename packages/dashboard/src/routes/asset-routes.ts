/**
 * Asset serving routes for stored screenshots.
 *
 * Single route serves all screenshots from the central folder:
 *   {agentDir}/screenshots/{filename}
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
  // GET /api/assets/screenshots/:filename
  fastify.get<{
    Params: { filename: string };
  }>(
    "/api/assets/screenshots/:filename",
    async (request, reply) => {
      const { filename } = request.params;

      if (!isSafe(filename)) {
        return reply.code(400).send({ error: "Invalid path segment" });
      }

      const filePath = join(
        fastify.agentDir,
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
