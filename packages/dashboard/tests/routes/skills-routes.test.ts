import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import { SkillService } from "../../src/services/skill-service.js";
import { ConnectionRegistry } from "../../src/ws/connection-registry.js";

const TEST_DIR = join(import.meta.dirname, "tmp-skills-routes-test");
const SKILLS_DIR = join(TEST_DIR, ".claude", "skills");

function createTestSkill(name: string, origin = "user", disabled = false) {
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  const dm = disabled ? "\ndisable-model-invocation: true" : "";
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test ${name}\norigin: ${origin}${dm}\n---\n\nBody of ${name}`,
  );
}

async function buildApp() {
  const fastify = Fastify();
  const service = new SkillService(TEST_DIR);
  fastify.decorate("agentDir", TEST_DIR);
  fastify.decorate("skillService", service);
  fastify.decorate("connectionRegistry", new ConnectionRegistry());

  const { registerSkillRoutes } = await import("../../src/routes/skills.js");
  await fastify.register(
    async (instance) => {
      await registerSkillRoutes(instance);
    },
    { prefix: "/api/skills" },
  );
  return fastify;
}

describe("Skills REST routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    mkdirSync(SKILLS_DIR, { recursive: true });
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe("GET /api/skills", () => {
    it("returns empty array when no skills", async () => {
      const res = await app.inject({ method: "GET", url: "/api/skills" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ skills: [] });
    });

    it("returns all skills with metadata", async () => {
      createTestSkill("alpha", "user");
      createTestSkill("beta", "system");
      const res = await app.inject({ method: "GET", url: "/api/skills" });
      const body = res.json();
      expect(body.skills).toHaveLength(2);
      expect(body.skills[0].name).toBe("alpha");
      expect(body.skills[1].name).toBe("beta");
    });
  });

  describe("GET /api/skills/:name", () => {
    it("returns full skill content", async () => {
      createTestSkill("my-skill");
      const res = await app.inject({
        method: "GET",
        url: "/api/skills/my-skill",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe("my-skill");
      expect(body.body).toContain("Body of my-skill");
    });

    it("returns 404 for missing skill", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/skills/nope",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/skills/:name/toggle", () => {
    it("toggles a user skill", async () => {
      createTestSkill("my-skill", "user", false);
      const res = await app.inject({
        method: "POST",
        url: "/api/skills/my-skill/toggle",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().disabled).toBe(true);
    });

    it("rejects toggling system skill", async () => {
      createTestSkill("sys", "system");
      const res = await app.inject({
        method: "POST",
        url: "/api/skills/sys/toggle",
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("PUT /api/skills/:name", () => {
    it("updates a user skill", async () => {
      createTestSkill("my-skill", "user");
      const res = await app.inject({
        method: "PUT",
        url: "/api/skills/my-skill",
        payload: { description: "Updated desc", content: "Updated body" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().description).toBe("Updated desc");
    });

    it("rejects updating system skill", async () => {
      createTestSkill("sys", "system");
      const res = await app.inject({
        method: "PUT",
        url: "/api/skills/sys",
        payload: { description: "x", content: "y" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects missing fields", async () => {
      createTestSkill("my-skill", "user");
      const res = await app.inject({
        method: "PUT",
        url: "/api/skills/my-skill",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /api/skills/:name", () => {
    it("deletes a user skill", async () => {
      createTestSkill("my-skill", "user");
      const res = await app.inject({
        method: "DELETE",
        url: "/api/skills/my-skill",
      });
      expect(res.statusCode).toBe(200);
      // Verify it's gone
      const getRes = await app.inject({
        method: "GET",
        url: "/api/skills/my-skill",
      });
      expect(getRes.statusCode).toBe(404);
    });

    it("rejects deleting system skill", async () => {
      createTestSkill("sys", "system");
      const res = await app.inject({
        method: "DELETE",
        url: "/api/skills/sys",
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
