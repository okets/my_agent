import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTaskToolsServer } from "../../src/mcp/task-tools-server.js";
import { updateProperty } from "../../src/conversations/properties.js";

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

const mockedUpdateProperty = vi.mocked(updateProperty);

function createMockDeps() {
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
  };
}

function getToolHandler(server: any, toolName: string) {
  const tool = server.tools.find((t: any) => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.handler;
}

describe("update_property MCP tool", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it("updates location property", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "update_property");

    const result = await handler({
      key: "location",
      value: "New York, USA",
      confidence: "high",
      source: "conversation",
    });

    expect(mockedUpdateProperty).toHaveBeenCalledWith(
      "/tmp/test-agent",
      "location",
      {
        value: "New York, USA",
        confidence: "high",
        source: "conversation",
      },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("location");
    expect(result.content[0].text).toContain("New York, USA");
  });

  it("updates timezone property", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "update_property");

    const result = await handler({
      key: "timezone",
      value: "America/New_York",
      confidence: "high",
      source: "conversation",
    });

    expect(mockedUpdateProperty).toHaveBeenCalledWith(
      "/tmp/test-agent",
      "timezone",
      expect.objectContaining({ value: "America/New_York" }),
    );

    expect(result.content[0].text).toContain("timezone");
  });

  it("updates availability property", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "update_property");

    const result = await handler({
      key: "availability",
      value: "busy until 5pm",
      confidence: "medium",
      source: "conversation",
    });

    expect(mockedUpdateProperty).toHaveBeenCalledWith(
      "/tmp/test-agent",
      "availability",
      expect.objectContaining({
        value: "busy until 5pm",
        confidence: "medium",
      }),
    );

    expect(result.content[0].text).toContain("availability");
  });

  it("returns error when update fails", async () => {
    mockedUpdateProperty.mockRejectedValueOnce(new Error("Write failed"));

    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "update_property");

    const result = await handler({
      key: "location",
      value: "Mars",
      confidence: "low",
      source: "conversation",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Write failed");
  });
});
