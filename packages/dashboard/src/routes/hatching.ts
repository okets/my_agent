import type { FastifyInstance } from "fastify";
import { loadAgentFullName, loadAgentNickname } from "@my-agent/core";

// ── Route handlers ──

export async function registerHatchingRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/hatching/status — Check if agent is hatched + agent name
  fastify.get("/api/hatching/status", async (_request, reply) => {
    reply.send({
      hatched: fastify.isHatched,
      agentName: fastify.isHatched ? loadAgentFullName(fastify.agentDir) : null,
      agentNickname: fastify.isHatched
        ? loadAgentNickname(fastify.agentDir)
        : null,
    });
  });
}
