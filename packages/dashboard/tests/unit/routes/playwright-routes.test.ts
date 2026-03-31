import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { registerPlaywrightRoutes } from "../../../src/routes/playwright-routes.js";

describe("playwright-routes", () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "pw-routes-"));

    fastify = Fastify({ logger: false });
    fastify.decorate("agentDir", tempDir);
    await registerPlaywrightRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("GET /api/debug/playwright-status", () => {
    it("returns a PlaywrightStatus object", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/api/debug/playwright-status",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("installed");
      expect(body).toHaveProperty("ready");
      expect(body).toHaveProperty("browsers");
      expect(body).toHaveProperty("setupNeeded");
      expect(body).toHaveProperty("enabled");
    });

    it("reports enabled=true by default (no flag file)", async () => {
      const response = await fastify.inject({
        method: "GET",
        url: "/api/debug/playwright-status",
      });

      expect(response.json().enabled).toBe(true);
    });

    it("reports enabled=false when .playwright-disabled exists", async () => {
      writeFileSync(join(tempDir, ".playwright-disabled"), "disabled", "utf-8");

      const response = await fastify.inject({
        method: "GET",
        url: "/api/debug/playwright-status",
      });

      expect(response.json().enabled).toBe(false);
    });
  });

  describe("POST /api/debug/playwright-toggle", () => {
    it("disables when currently enabled (creates flag file)", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/api/debug/playwright-toggle",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().enabled).toBe(false);
      expect(existsSync(join(tempDir, ".playwright-disabled"))).toBe(true);
    });

    it("enables when currently disabled (removes flag file)", async () => {
      writeFileSync(join(tempDir, ".playwright-disabled"), "disabled", "utf-8");

      const response = await fastify.inject({
        method: "POST",
        url: "/api/debug/playwright-toggle",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().enabled).toBe(true);
      expect(existsSync(join(tempDir, ".playwright-disabled"))).toBe(false);
    });

    it("toggles back and forth", async () => {
      // Enable → Disable
      let response = await fastify.inject({
        method: "POST",
        url: "/api/debug/playwright-toggle",
      });
      expect(response.json().enabled).toBe(false);

      // Disable → Enable
      response = await fastify.inject({
        method: "POST",
        url: "/api/debug/playwright-toggle",
      });
      expect(response.json().enabled).toBe(true);
    });
  });

  describe("POST /api/debug/playwright-install", () => {
    it("returns success and output fields", async () => {
      const response = await fastify.inject({
        method: "POST",
        url: "/api/debug/playwright-install",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("success");
      expect(body).toHaveProperty("output");
      expect(typeof body.success).toBe("boolean");
      expect(typeof body.output).toBe("string");
    }, 60_000); // Install spawns npx playwright install — needs longer timeout
  });
});
