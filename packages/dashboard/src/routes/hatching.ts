import type { FastifyInstance } from "fastify";
import { loadAgentName } from "@my-agent/core";

// ── Route handlers ──

export async function registerHatchingRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/hatching/status — Check if agent is hatched + agent name
  fastify.get("/api/hatching/status", async (_request, reply) => {
    const agentName = fastify.isHatched
      ? loadAgentName(fastify.agentDir)
      : null;
    reply.send({ hatched: fastify.isHatched, agentName });
  });
}
