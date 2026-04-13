import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  handleFetchImage,
  handleStoreLocalImage,
} from "../../../src/mcp/image-fetch-server.js";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { ImageFetchServerDeps } from "../../../src/mcp/image-fetch-server.js";

// ── Test setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let agentDir: string;
let visualService: VisualActionService;
let deps: ImageFetchServerDeps;

beforeAll(() => {
  // Structure: tmpDir/my_agent/.my_agent  (agentDir = tmpDir/my_agent/.my_agent)
  // Allowed root = tmpDir/my_agent
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "image-fetch-server-test-"));
  const projectRoot = path.join(base, "my_agent");
  agentDir = path.join(projectRoot, ".my_agent");
  fs.mkdirSync(agentDir, { recursive: true });
  tmpDir = base;
  visualService = new VisualActionService(agentDir);
  deps = { visualService, agentDir };
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

  it("rejects when url is empty", async () => {
    const result = await handleFetchImage(deps, { url: "" });
    expect(result.isError).toBe(true);
  });
});

describe("store_local_image handler", () => {
  it("rejects path outside allowed root", async () => {
    const result = await handleStoreLocalImage(deps, {
      file_path: "/etc/passwd",
    });
    expect(result.isError).toBe(true);
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("Access denied");
  });

  it("rejects non-existent file", async () => {
    const projectRoot = path.dirname(agentDir);
    const result = await handleStoreLocalImage(deps, {
      file_path: path.join(projectRoot, "nonexistent.png"),
    });
    expect(result.isError).toBe(true);
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("File read failed");
  });

  it("rejects non-image file", async () => {
    const projectRoot = path.dirname(agentDir);
    const txtFile = path.join(projectRoot, "test.txt");
    fs.writeFileSync(txtFile, "hello world");
    const result = await handleStoreLocalImage(deps, { file_path: txtFile });
    expect(result.isError).toBe(true);
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("not a recognized image format");
  });

  it("stores a valid PNG and returns a url", async () => {
    // Minimal 1x1 red PNG (generated via sharp)
    const pngBytes = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de" +
      "0000000970485973000003e8000003e801b57b526b0000000c49444154789c63f8cfc0" +
      "000003010100c9fe92ef0000000049454e44ae426082",
      "hex",
    );
    const projectRoot = path.dirname(agentDir);
    const imgFile = path.join(projectRoot, "test.png");
    fs.writeFileSync(imgFile, pngBytes);

    const result = await handleStoreLocalImage(deps, {
      file_path: imgFile,
      description: "test image",
    });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );
    expect(parsed.url).toMatch(/\/api\/assets\/screenshots\/ss-/);
    expect(parsed.width).toBeGreaterThan(0);
    expect(parsed.height).toBeGreaterThan(0);
  });
});
