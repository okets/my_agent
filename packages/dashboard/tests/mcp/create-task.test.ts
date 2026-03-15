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

function createMockDeps() {
  return {
    taskManager: {
      create: vi.fn((input: any) => ({
        id: "task-NEW01",
        ...input,
        status: "pending",
        created: new Date("2026-03-15T10:00:00Z"),
      })),
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

describe("create_task MCP tool", () => {
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  it("creates an immediate task and triggers execution", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "create_task");

    const result = await handler({
      title: "Find Thai restaurants",
      instructions: "Search for top-rated Thai restaurants near Nimman, Chiang Mai. Include ratings and price range.",
      type: "immediate",
      conversationId: "conv-TEST01",
    });

    expect(deps.taskManager.create).toHaveBeenCalledWith({
      type: "immediate",
      sourceType: "conversation",
      title: "Find Thai restaurants",
      instructions: expect.stringContaining("Thai restaurants"),
      work: undefined,
      notifyOnCompletion: "immediate",
      model: undefined,
      scheduledFor: undefined,
      createdBy: "agent",
    });

    expect(deps.taskManager.linkTaskToConversation).toHaveBeenCalledWith(
      "task-NEW01",
      "conv-TEST01",
    );

    expect(deps.taskProcessor.onTaskCreated).toHaveBeenCalled();

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Find Thai restaurants");
    expect(result.content[0].text).toContain("task-NEW01");
    expect(result.content[0].text).toContain("Executing now");
  });

  it("creates a scheduled task without triggering execution", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "create_task");

    const result = await handler({
      title: "Check traffic",
      instructions: "Check traffic conditions on Route 1 from Bangkok to Pattaya.",
      type: "scheduled",
      conversationId: "conv-TEST01",
      scheduledFor: "2026-03-15T14:00:00Z",
    });

    expect(deps.taskManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "scheduled",
        scheduledFor: new Date("2026-03-15T14:00:00Z"),
      }),
    );

    // Should NOT trigger immediate execution
    expect(deps.taskProcessor.onTaskCreated).not.toHaveBeenCalled();

    expect(result.content[0].text).toContain("Scheduled for");
  });

  it("passes work items through", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "create_task");

    await handler({
      title: "Research flights",
      instructions: "Find cheapest flights CNX to BKK",
      work: [
        { description: "Search Google Flights" },
        { description: "Search AirAsia" },
      ],
      type: "immediate",
      conversationId: "conv-TEST01",
    });

    expect(deps.taskManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        work: [
          { description: "Search Google Flights", status: "pending" },
          { description: "Search AirAsia", status: "pending" },
        ],
      }),
    );
  });

  it("passes delivery actions through", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "create_task");

    await handler({
      title: "Send reminder on WhatsApp",
      instructions: "Send a reminder message",
      delivery: [
        { channel: "whatsapp", content: "Don't forget to call mom" },
      ],
      type: "scheduled",
      conversationId: "conv-TEST01",
      scheduledFor: "2026-03-15T14:00:00Z",
    });

    expect(deps.taskManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: [
          {
            channel: "whatsapp",
            content: "Don't forget to call mom",
            status: "pending",
          },
        ],
      }),
    );
  });

  it("passes delivery without content (agent composes)", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "create_task");

    await handler({
      title: "Research and email results",
      instructions: "Research Bangkok hotels and email me a summary",
      delivery: [{ channel: "email" }],
      type: "immediate",
      conversationId: "conv-TEST01",
    });

    expect(deps.taskManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery: [{ channel: "email", status: "pending" }],
      }),
    );
  });

  it("passes notifyOnCompletion and model through", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "create_task");

    await handler({
      title: "Deep research",
      instructions: "Thorough analysis",
      type: "immediate",
      conversationId: "conv-TEST01",
      notifyOnCompletion: "debrief",
      model: "claude-opus-4-6",
    });

    expect(deps.taskManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyOnCompletion: "debrief",
        model: "claude-opus-4-6",
      }),
    );
  });

  it("defaults notifyOnCompletion to immediate", async () => {
    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "create_task");

    await handler({
      title: "Quick task",
      instructions: "Do something",
      type: "immediate",
      conversationId: "conv-TEST01",
    });

    expect(deps.taskManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        notifyOnCompletion: "immediate",
      }),
    );
  });

  it("returns error when create fails", async () => {
    deps.taskManager.create = vi.fn(() => {
      throw new Error("DB write failed");
    });

    const server = createTaskToolsServer(deps as any);
    const handler = getToolHandler(server, "create_task");

    const result = await handler({
      title: "Failing task",
      instructions: "Will fail",
      type: "immediate",
      conversationId: "conv-TEST01",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("DB write failed");
    expect(deps.taskProcessor.onTaskCreated).not.toHaveBeenCalled();
  });
});
