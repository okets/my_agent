import type { FastifyInstance } from "fastify";

export async function registerSkillRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const service = fastify.skillService;

  function broadcastSkillsChanged(): void {
    fastify.connectionRegistry.broadcastToAll({
      type: "state:skills" as any,
      timestamp: Date.now(),
    });
  }

  /** GET /api/skills — list all skills */
  fastify.get("/", async () => {
    return { skills: service.list() };
  });

  /** GET /api/skills/:name — get full skill */
  fastify.get<{ Params: { name: string } }>(
    "/:name",
    async (request, reply) => {
      const skill = service.get(request.params.name);
      if (!skill) return reply.code(404).send({ error: "Skill not found" });
      return skill;
    },
  );

  /** POST /api/skills/:name/toggle — toggle disable-model-invocation */
  fastify.post<{ Params: { name: string } }>(
    "/:name/toggle",
    async (request, reply) => {
      try {
        const result = service.toggle(request.params.name);
        broadcastSkillsChanged();
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Toggle failed";
        if (msg.includes("not found"))
          return reply.code(404).send({ error: msg });
        return reply.code(403).send({ error: msg });
      }
    },
  );

  /** PUT /api/skills/:name — update a user skill's description and content */
  fastify.put<{
    Params: { name: string };
    Body: { description: string; content: string };
  }>("/:name", async (request, reply) => {
    const { description, content } = (request.body as any) || {};
    if (!description || !content) {
      return reply
        .code(400)
        .send({ error: "description and content are required" });
    }
    try {
      const result = service.update(request.params.name, description, content);
      broadcastSkillsChanged();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed";
      if (msg.includes("not found"))
        return reply.code(404).send({ error: msg });
      if (msg.includes("Cannot update") || msg.includes("Cannot delete"))
        return reply.code(403).send({ error: msg });
      if (msg.includes("override") || msg.includes("identity"))
        return reply.code(400).send({ error: msg });
      return reply.code(403).send({ error: msg });
    }
  });

  /** DELETE /api/skills/:name — delete a user skill */
  fastify.delete<{ Params: { name: string } }>(
    "/:name",
    async (request, reply) => {
      try {
        service.delete(request.params.name);
        broadcastSkillsChanged();
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed";
        if (msg.includes("not found"))
          return reply.code(404).send({ error: msg });
        return reply.code(403).send({ error: msg });
      }
    },
  );
}
