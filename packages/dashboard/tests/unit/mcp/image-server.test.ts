import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleStoreImage } from "../../../src/mcp/image-server.js";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { ImageServerDeps } from "../../../src/mcp/image-server.js";

// ── Test setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let visualService: VisualActionService;
let deps: ImageServerDeps;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-server-test-"));
  visualService = new VisualActionService(tmpDir);
  deps = { visualService };
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("store_image handler", () => {
  it("rejects when no input mode provided", async () => {
    const result = await handleStoreImage(deps, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Exactly one"),
    });
  });

  it("rejects when multiple input modes provided", async () => {
    const result = await handleStoreImage(deps, {
      svg: "<svg></svg>",
      data: "abc",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("multiple"),
    });
  });

  it("stores SVG as PNG via sharp", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="red" width="100" height="100"/></svg>`;
    const result = await handleStoreImage(deps, { svg });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.id).toMatch(/^ss-/);
    expect(parsed.url).toContain("/api/assets/screenshots/");
    expect(parsed.width).toBe(100);
    expect(parsed.height).toBe(100);
  });

  it("infers SVG dimensions from viewBox when width/height missing", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect fill="blue" width="200" height="150"/></svg>`;
    const result = await handleStoreImage(deps, { svg });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.width).toBe(200);
    expect(parsed.height).toBe(150);
  });

  it("rejects SVG without <svg prefix", async () => {
    const result = await handleStoreImage(deps, { svg: "<div>not svg</div>" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "must start with <svg",
    );
  });

  it("stores valid base64 PNG", async () => {
    // Minimal 1x1 red PNG
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const result = await handleStoreImage(deps, { data: pngBase64 });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse((result.content[0] as { type: "text"; text: string }).text);
    expect(parsed.id).toMatch(/^ss-/);
    expect(parsed.width).toBe(1);
    expect(parsed.height).toBe(1);
  });

  it("rejects invalid base64 data (bad magic bytes)", async () => {
    // Random non-image data
    const badData = Buffer.from("this is not an image at all").toString(
      "base64",
    );
    const result = await handleStoreImage(deps, { data: badData });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "magic bytes",
    );
  });

  it("rejects invalid URL scheme (ftp://)", async () => {
    const result = await handleStoreImage(deps, {
      url: "ftp://example.com/image.png",
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { type: "text"; text: string }).text).toContain(
      "Invalid URL scheme",
    );
  });

  it("returns base64 content block when returnImage is true", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect fill="green" width="50" height="50"/></svg>`;
    const result = await handleStoreImage(deps, { svg, returnImage: true });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("text");

    const imageBlock = result.content[1] as { type: "image"; data: string; mimeType: string };
    expect(imageBlock.type).toBe("image");
    expect(imageBlock.mimeType).toBe("image/png");
    expect(imageBlock.data).toBeTruthy();

    // Validate the base64 decodes to a valid PNG
    const decoded = Buffer.from(imageBlock.data, "base64");
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50);
    expect(decoded[2]).toBe(0x4e);
    expect(decoded[3]).toBe(0x47);
  });
});
