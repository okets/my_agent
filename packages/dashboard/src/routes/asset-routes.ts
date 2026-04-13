/**
 * Asset serving routes for stored screenshots and branding assets.
 */

import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { extname, join } from "node:path";

/** Reject path segments that could be used for directory traversal. */
function isSafe(segment: string): boolean {
  return (
    !segment.includes("..") && !segment.includes("/") && !segment.includes("\\")
  );
}

function resolveCustomLogoPath(agentDir: string): string | null {
  const assetsDir = join(agentDir, "assets");
  const candidates = [
    join(assetsDir, "agent-logo.png"),
    join(assetsDir, "agent-logo.jpg"),
    join(assetsDir, "agent-logo.jpeg"),
    join(assetsDir, "agent-logo.webp"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function contentTypeForImage(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

export async function registerAssetRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.get("/api/assets/branding/logo", async (_request, reply) => {
    const customLogoPath = resolveCustomLogoPath(fastify.agentDir);
    if (customLogoPath) {
      return reply
        .type(contentTypeForImage(customLogoPath))
        .send(createReadStream(customLogoPath));
    }

    const defaultLogoPath = join(import.meta.dirname, "../../public/logo.png");
    return reply.type("image/png").send(createReadStream(defaultLogoPath));
  });

  // GET /api/assets/screenshots/:filename
  fastify.get<{
    Params: { filename: string };
  }>("/api/assets/screenshots/:filename", async (request, reply) => {
    const { filename } = request.params;

    if (!isSafe(filename)) {
      return reply.code(400).send({ error: "Invalid path segment" });
    }

    const filePath = join(fastify.agentDir, "screenshots", filename);

    try {
      await access(filePath);
    } catch {
      return reply.code(404).send({ error: "File not found" });
    }

    return reply.type("image/png").send(createReadStream(filePath));
  });

  // GET /api/assets/audio/:filename
  fastify.get<{
    Params: { filename: string };
  }>("/api/assets/audio/:filename", async (request, reply) => {
    const { filename } = request.params;

    if (!isSafe(filename)) {
      return reply.code(400).send({ error: "Invalid path segment" });
    }

    const filePath = join(fastify.agentDir, "audio", filename);

    try {
      await access(filePath);
    } catch {
      return reply.code(404).send({ error: "File not found" });
    }

    return reply.type("audio/ogg").send(createReadStream(filePath));
  });
}
