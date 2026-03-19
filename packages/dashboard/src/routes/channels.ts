/**
 * Channel Binding Routes
 *
 * Manage channel bindings (owner → transport mappings).
 * Separate from transport routes which handle infrastructure.
 */

import type { FastifyInstance } from "fastify";
import { loadChannelBindings, ConfigWriter } from "@my-agent/core";

export async function registerChannelRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/channels — list all channel bindings
  fastify.get("/api/channels", async (_request, reply) => {
    const bindings = loadChannelBindings(fastify.agentDir);
    return reply.send(bindings);
  });

  // DELETE /api/channels/:id — remove a channel binding
  fastify.delete<{ Params: { id: string } }>(
    "/api/channels/:id",
    async (request, reply) => {
      const { id } = request.params;
      const writer = new ConfigWriter(fastify.agentDir);

      try {
        await writer.removeChannelBinding(id);
        return reply.send({ ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: message });
      }
    },
  );
}
