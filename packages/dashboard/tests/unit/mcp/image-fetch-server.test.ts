import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleFetchImage } from "../../../src/mcp/image-fetch-server.js";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { ImageFetchServerDeps } from "../../../src/mcp/image-fetch-server.js";

// ── Test setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let visualService: VisualActionService;
let deps: ImageFetchServerDeps;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "image-fetch-server-test-"));
  visualService = new VisualActionService(tmpDir);
  deps = { visualService };
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("fetch_image handler", () => {
  it("rejects invalid URL scheme (ftp://)", async () => {
    const result = await handleFetchImage(deps, {
      url: "ftp://example.com/image.png",
    });

    expect(result.isError).toBe(true);
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("Invalid URL scheme");
  });

  it("blocks private/internal IPs (SSRF protection)", async () => {
    for (const url of [
      "http://127.0.0.1/image.png",
      "http://10.0.0.1/image.png",
      "http://192.168.1.1/image.png",
      "http://172.16.0.1/image.png",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost/image.png",
    ]) {
      const result = await handleFetchImage(deps, { url });
      expect(result.isError).toBe(true);
      expect(
        (result.content[0] as { type: "text"; text: string }).text,
      ).toContain("private");
    }
  });

  it("rejects base64 data with bad magic bytes", async () => {
    const badData = Buffer.from("this is not an image at all").toString(
      "base64",
    );
    const result = await handleFetchImage(deps, { data: badData });

    expect(result.isError).toBe(true);
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("magic bytes");
  });

  it("stores valid base64 PNG", async () => {
    // Minimal 1x1 red PNG
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const result = await handleFetchImage(deps, { data: pngBase64 });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );
    expect(parsed.id).toMatch(/^ss-/);
    expect(parsed.width).toBe(1);
    expect(parsed.height).toBe(1);
  });

  it("rejects when no input provided", async () => {
    const result = await handleFetchImage(deps, {});
    expect(result.isError).toBe(true);
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("must be provided");
  });
});
