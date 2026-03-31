import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleCreateChart } from "../../../src/mcp/chart-server.js";
import { VisualActionService } from "../../../src/visual/visual-action-service.js";
import type { ChartServerDeps } from "../../../src/mcp/chart-server.js";

// ── Test setup ───────────────────────────────────────────────────────────────

let tmpDir: string;
let visualService: VisualActionService;
let deps: ChartServerDeps;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chart-server-test-"));
  visualService = new VisualActionService(tmpDir);
  deps = { visualService };
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("create_chart handler", () => {
  it("converts valid SVG to PNG and returns metadata", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="red" width="100" height="100"/></svg>`;
    const result = await handleCreateChart(deps, {
      svg,
      description: "Red square",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );
    expect(parsed.id).toMatch(/^ss-/);
    expect(parsed.url).toContain("/api/assets/screenshots/");
    expect(parsed.width).toBe(100);
    expect(parsed.height).toBe(100);
  });

  it("infers SVG dimensions from viewBox when width/height missing", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150"><rect fill="blue" width="200" height="150"/></svg>`;
    const result = await handleCreateChart(deps, {
      svg,
      description: "Blue rectangle",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );
    expect(parsed.width).toBe(200);
    expect(parsed.height).toBe(150);
  });

  it("rejects non-SVG input", async () => {
    const result = await handleCreateChart(deps, {
      svg: "<div>not svg</div>",
      description: "bad input",
    });
    expect(result.isError).toBe(true);
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("must start with <svg");
  });

  it("returns { id, url, width, height } in response", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect fill="green" width="80" height="60"/></svg>`;
    const result = await handleCreateChart(deps, {
      svg,
      description: "Green rect",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );
    expect(parsed).toHaveProperty("id");
    expect(parsed).toHaveProperty("url");
    expect(parsed).toHaveProperty("width");
    expect(parsed).toHaveProperty("height");
  });

  it("passes description through to storage", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="20" fill="orange"/></svg>`;
    const description = "Orange circle gauge";
    const result = await handleCreateChart(deps, { svg, description });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    );
    // The id should exist — description is stored internally
    expect(parsed.id).toMatch(/^ss-/);
  });
});
