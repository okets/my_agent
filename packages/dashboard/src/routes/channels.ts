import type { FastifyInstance } from "fastify";

export async function registerChannelRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  // GET /api/channels — list all channels with status
  fastify.get("/api/channels", async (_request, reply) => {
    const channelManager = fastify.channelManager;
    if (!channelManager) {
      return reply.send([]);
    }
    return reply.send(channelManager.getChannelInfos());
  });

  // GET /api/channels/:id/status — single channel status
  fastify.get<{ Params: { id: string } }>(
    "/api/channels/:id/status",
    async (request, reply) => {
      const channelManager = fastify.channelManager;
      if (!channelManager) {
        return reply.code(404).send({ error: "No channels configured" });
      }
      const info = channelManager.getChannelInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Channel not found" });
      }
      return reply.send(info);
    },
  );

  // GET /api/channels/:id/icon — SVG icon for channel plugin
  fastify.get<{ Params: { id: string } }>(
    "/api/channels/:id/icon",
    async (request, reply) => {
      const channelManager = fastify.channelManager;
      if (!channelManager) {
        return reply.code(404).send({ error: "No channels configured" });
      }
      const info = channelManager.getChannelInfo(request.params.id);
      if (!info) {
        return reply.code(404).send({ error: "Channel not found" });
      }
      return reply.type("image/svg+xml").send(info.icon);
    },
  );
}
