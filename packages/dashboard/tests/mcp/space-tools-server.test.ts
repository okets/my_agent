import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSpaceToolsServer } from "../../src/mcp/space-tools-server.js";
import { ConversationDatabase } from "../../src/conversations/db.js";
import { readFrontmatter } from "../../src/metadata/frontmatter.js";
import { mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: vi.fn((name, description, schema, handler) => ({
    name,
    description,
    schema,
    handler,
    __isTool: true,
  })),
  createSdkMcpServer: vi.fn((config) => ({
    name: config.name,
    tools: config.tools,
    __isMcpServer: true,
  })),
}));

describe("createSpaceToolsServer", () => {
  let agentDir: string;
  let db: ConversationDatabase;
  let server: any;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "space-tools-"));
    db = new ConversationDatabase(agentDir);
    server = createSpaceToolsServer({ agentDir, db });
  });

  afterEach(() => {
    db.close();
  });

  function findTool(name: string) {
    return server.tools.find((t: any) => t.name === name);
  }

  it("creates a server with correct name and tools", () => {
    expect(server.name).toBe("space-tools");
    expect(server.tools).toHaveLength(2);
    expect(findTool("create_space")).toBeDefined();
    expect(findTool("list_spaces")).toBeDefined();
  });

  it("create_space should write SPACE.md and create directory", async () => {
    const result = await findTool("create_space").handler({
      name: "web-scraper",
      tags: ["tool", "scraper"],
      runtime: "uv",
      entry: "main.py",
      description: "Scrapes websites",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("web-scraper");

    const spaceDir = join(agentDir, "spaces", "web-scraper");
    expect(existsSync(spaceDir)).toBe(true);
    expect(existsSync(join(spaceDir, "SPACE.md"))).toBe(true);

    const { data, body } = readFrontmatter(join(spaceDir, "SPACE.md"));
    expect(data.name).toBe("web-scraper");
    expect(data.tags).toEqual(["tool", "scraper"]);
    expect(data.runtime).toBe("uv");
    expect(data.entry).toBe("main.py");
    expect(data.created).toBeTruthy();
    expect(body.trim()).toBe("Scrapes websites");
  });

  it("create_space should reject duplicate names", async () => {
    await findTool("create_space").handler({ name: "my-space" });

    const result = await findTool("create_space").handler({ name: "my-space" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already exists");
  });

  it("create_space should reject invalid names", async () => {
    const result = await findTool("create_space").handler({
      name: "Bad Name!",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid");
  });

  it("list_spaces should return all spaces", async () => {
    db.upsertSpace({
      name: "alpha",
      path: "/a",
      tags: ["tool"],
      indexedAt: "2026-03-23T10:00:00Z",
    });
    db.upsertSpace({
      name: "beta",
      path: "/b",
      tags: ["project"],
      runtime: "node",
      description: "A project",
      indexedAt: "2026-03-23T10:00:00Z",
    });

    const result = await findTool("list_spaces").handler({});
    expect(result.content[0].text).toContain("2 space(s)");
    expect(result.content[0].text).toContain("alpha");
    expect(result.content[0].text).toContain("beta");
  });

  it("list_spaces should filter by tag", async () => {
    db.upsertSpace({
      name: "a",
      path: "/a",
      tags: ["tool"],
      indexedAt: "2026-03-23T10:00:00Z",
    });
    db.upsertSpace({
      name: "b",
      path: "/b",
      tags: ["project"],
      indexedAt: "2026-03-23T10:00:00Z",
    });

    const result = await findTool("list_spaces").handler({ tag: "tool" });
    expect(result.content[0].text).toContain("1 space(s)");
    expect(result.content[0].text).toContain("**a**");
  });

  it("list_spaces should return message when empty", async () => {
    const result = await findTool("list_spaces").handler({});
    expect(result.content[0].text).toBe("No spaces found.");
  });
});
