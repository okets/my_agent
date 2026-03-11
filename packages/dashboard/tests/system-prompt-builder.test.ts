import { describe, it, expect, vi, beforeEach } from "vitest";
import { SystemPromptBuilder } from "../src/agent/system-prompt-builder.js";

// Mock @my-agent/core to avoid filesystem dependencies in tests
vi.mock("@my-agent/core", () => ({
  assembleSystemPrompt: vi.fn().mockResolvedValue("## Identity\nYou are Nina."),
  loadCalendarConfig: vi.fn().mockReturnValue(null),
  loadCalendarCredentials: vi.fn().mockReturnValue(null),
  createCalDAVClient: vi.fn().mockResolvedValue({}),
  assembleCalendarContext: vi
    .fn()
    .mockResolvedValue("[Calendar: no events today]"),
}));

describe("SystemPromptBuilder", () => {
  let builder: SystemPromptBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    builder = new SystemPromptBuilder({
      brainDir: "/tmp/test-brain",
      agentDir: "/tmp/test-agent",
    });
  });

  it("returns system prompt as array of content blocks", async () => {
    const result = await builder.build({
      channel: "web",
      conversationId: "conv-TEST123",
      messageIndex: 1,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("text");
  });

  it("applies cache_control on stable layers (block 0) only", async () => {
    const result = await builder.build({
      channel: "web",
      conversationId: "conv-TEST123",
      messageIndex: 1,
    });

    // First block (identity + skills) should have cache_control
    expect(result[0].cache_control).toEqual({ type: "ephemeral" });

    // Last block (dynamic layers) should NOT have cache_control
    expect(result[1].cache_control).toBeUndefined();
  });

  it("includes inbound metadata as JSON in dynamic block", async () => {
    const result = await builder.build({
      channel: "whatsapp",
      conversationId: "conv-ABC",
      messageIndex: 5,
    });

    const dynamicText = result[1].text;
    expect(dynamicText).toContain('"channel": "whatsapp"');
    expect(dynamicText).toContain('"conversation_id": "conv-ABC"');
    expect(dynamicText).toContain('"message_index": 5');
  });

  it("includes conversation ID in session context", async () => {
    const result = await builder.build({
      channel: "web",
      conversationId: "conv-XYZ",
      messageIndex: 3,
    });

    const dynamicText = result[1].text;
    expect(dynamicText).toContain("conv-XYZ");
    expect(dynamicText).toContain("Message index: 3");
  });

  it("caches stable prompt across calls", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");

    await builder.build({
      channel: "web",
      conversationId: "c1",
      messageIndex: 1,
    });
    await builder.build({
      channel: "web",
      conversationId: "c1",
      messageIndex: 2,
    });

    // assembleSystemPrompt should only be called once (cached)
    expect(assembleSystemPrompt).toHaveBeenCalledTimes(1);
  });

  it("includes calendar context when config and credentials exist", async () => {
    const {
      loadCalendarConfig,
      loadCalendarCredentials,
      assembleSystemPrompt,
    } = await import("@my-agent/core");

    vi.mocked(loadCalendarConfig).mockReturnValue({
      url: "https://cal.example.com",
    } as any);
    vi.mocked(loadCalendarCredentials).mockReturnValue({
      username: "user",
      password: "pass",
    } as any);
    vi.mocked(assembleSystemPrompt).mockResolvedValue(
      "## Identity\nYou are Nina.\n\n[Calendar: 2 events today]",
    );

    const result = await builder.build({
      channel: "web",
      conversationId: "conv-CAL",
      messageIndex: 1,
    });

    expect(result[0].text).toContain("[Calendar: 2 events today]");
    expect(assembleSystemPrompt).toHaveBeenCalledWith("/tmp/test-brain", {
      calendarContext: "[Calendar: no events today]",
    });
  });

  it("includes notebook last updated when callback returns a timestamp", async () => {
    const builderWithNotebook = new SystemPromptBuilder({
      brainDir: "/tmp/test-brain",
      agentDir: "/tmp/test-agent",
      getNotebookLastUpdated: () => "2026-03-11T10:30:00.000Z",
    });

    const result = await builderWithNotebook.build({
      channel: "web",
      conversationId: "conv-NB1",
      messageIndex: 1,
    });

    const dynamicText = result[1].text;
    expect(dynamicText).toContain("Notebook last updated:");
    expect(dynamicText).toContain("[Temporal Context]");
    expect(dynamicText).toContain("[End Temporal Context]");
  });

  it("omits notebook last updated when callback returns null", async () => {
    const builderWithNull = new SystemPromptBuilder({
      brainDir: "/tmp/test-brain",
      agentDir: "/tmp/test-agent",
      getNotebookLastUpdated: () => null,
    });

    const result = await builderWithNull.build({
      channel: "web",
      conversationId: "conv-NB2",
      messageIndex: 1,
    });

    const dynamicText = result[1].text;
    expect(dynamicText).not.toContain("Notebook last updated:");
    expect(dynamicText).toContain("[Temporal Context]");
    expect(dynamicText).toContain("[End Temporal Context]");
  });

  it("omits notebook last updated when callback is not provided", async () => {
    // Default builder (no getNotebookLastUpdated)
    const result = await builder.build({
      channel: "web",
      conversationId: "conv-NB3",
      messageIndex: 1,
    });

    const dynamicText = result[1].text;
    expect(dynamicText).not.toContain("Notebook last updated:");
    expect(dynamicText).toContain("[Temporal Context]");
    expect(dynamicText).toContain("[End Temporal Context]");
  });

  it("invalidateCache forces re-read of stable prompt", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");

    await builder.build({
      channel: "web",
      conversationId: "c1",
      messageIndex: 1,
    });
    builder.invalidateCache();
    await builder.build({
      channel: "web",
      conversationId: "c1",
      messageIndex: 2,
    });

    expect(assembleSystemPrompt).toHaveBeenCalledTimes(2);
  });
});
