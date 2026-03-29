import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { registerAssetRoutes } from "../../../src/routes/asset-routes.js";

describe("asset-routes", () => {
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

  it("serves a job screenshot with 200 and correct content", async () => {
    // Arrange: create the screenshot file
    const screenshotsDir = join(
      tempDir,
      "automations",
      ".runs",
      "my-automation",
      "job-123",
      "screenshots",
    );
    mkdirSync(screenshotsDir, { recursive: true });
    const pngData = Buffer.from("fake-png-data");
    writeFileSync(join(screenshotsDir, "step-1.png"), pngData);

    // Act
    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/job/my-automation/job-123/screenshots/step-1.png",
    });

    // Assert
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/image\/png/);
    expect(response.rawPayload).toEqual(pngData);
  });

  it("serves a conversation screenshot with 200 and correct content", async () => {
    // Arrange: create the screenshot file
    const screenshotsDir = join(
      tempDir,
      "conversations",
      "ctx-abc",
      "screenshots",
    );
    mkdirSync(screenshotsDir, { recursive: true });
    const pngData = Buffer.from("conv-png-data");
    writeFileSync(join(screenshotsDir, "capture.png"), pngData);

    // Act
    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/conversation/ctx-abc/screenshots/capture.png",
    });

    // Assert
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/image\/png/);
    expect(response.rawPayload).toEqual(pngData);
  });

  it("returns 404 for a missing file", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/job/no-such-automation/no-such-job/screenshots/missing.png",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "File not found" });
  });

  it("returns 400 for path traversal attempt", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/api/assets/job/my-automation/job-123/screenshots/..%2F..%2Fsecret.txt",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "Invalid path segment" });
  });
});
