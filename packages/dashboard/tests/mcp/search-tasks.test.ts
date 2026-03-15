import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTaskToolsServer } from "../../src/mcp/task-tools-server.js";

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

vi.mock("../../src/conversations/properties.js", () => ({
  updateProperty: vi.fn(),
}));

function createMockDeps(searchResults: any[] = []) {
  return {
    taskManager: {
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      linkTaskToConversation: vi.fn(),
    },
    taskProcessor: {
      onTaskCreated: vi.fn(),
    },
    agentDir: "/tmp/test-agent",
    taskSearchService: {
      search: vi.fn().mockResolvedValue(searchResults),
    },
  };
}

function getToolHandler(server: any, toolName: string) {
  const tool = server.tools.find((t: any) => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.handler;
}

describe("search_tasks MCP tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns matching tasks formatted", async () => {
    const deps = createMockDeps([
      {
        id: "task-001",
        title: "Find cheapest flight CNX→Bangkok",
        status: "completed",
        created: "2026-03-14T10:00:00Z",
        completedAt: "2026-03-14T11:00:00Z",
        score: 0.05,
      },
    ]);

    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "search_tasks");

    const result = await handler({ query: "flights research" });

    expect(deps.taskSearchService.search).toHaveBeenCalledWith(
      "flights research",
      { status: "completed", limit: 5 },
    );
    expect(result.content[0].text).toContain("Found 1 task(s)");
    expect(result.content[0].text).toContain("Find cheapest flight");
    expect(result.content[0].text).toContain("task-001");
  });

  it("returns 'no matching tasks' when empty results", async () => {
    const deps = createMockDeps([]);
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "search_tasks");

    const result = await handler({ query: "nonexistent thing" });

    expect(result.content[0].text).toBe("No matching tasks found.");
  });

  it("passes status and limit options", async () => {
    const deps = createMockDeps([]);
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "search_tasks");

    await handler({ query: "research", status: "failed", limit: 3 });

    expect(deps.taskSearchService.search).toHaveBeenCalledWith("research", {
      status: "failed",
      limit: 3,
    });
  });

  it("returns error when search service unavailable", async () => {
    const deps = createMockDeps();
    deps.taskSearchService = undefined as any;

    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "search_tasks");

    const result = await handler({ query: "anything" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not available");
  });

  it("returns error on search failure", async () => {
    const deps = createMockDeps();
    deps.taskSearchService.search.mockRejectedValueOnce(
      new Error("DB locked"),
    );

    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "search_tasks");

    const result = await handler({ query: "anything" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("DB locked");
  });
});
