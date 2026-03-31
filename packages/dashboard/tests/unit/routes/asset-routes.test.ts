import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { registerAssetRoutes } from "../../../src/routes/asset-routes.js";

describe("asset-routes (centralized)", () => {
  let fastify: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "asset-routes-"));

    fastify = Fastify({ logger: false });
    fastify.decorate("agentDir", tempDir);
    await registerAssetRoutes(fastify);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves a screenshot from the central screenshots folder", async () => {
    const screenshotsDir = join(tempDir, "screenshots");
    mkdirSync(screenshotsDir, { recursive: true });
    const pngData = Buffer.from("fake-png-data");
    writeFileSync(join(screenshotsDir, "ss-abc123.png"), pngData);

    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/screenshots/ss-abc123.png",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/image\/png/);
    expect(response.rawPayload).toEqual(pngData);
  });

  it("returns 404 for a missing file", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/screenshots/missing.png",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "File not found" });
  });

  it("returns 400 for path traversal attempt", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/screenshots/..%2F..%2Fsecret.txt",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Invalid path segment" });
  });
});
