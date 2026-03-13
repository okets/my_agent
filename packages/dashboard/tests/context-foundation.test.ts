/**
 * S1: Context Foundation E2E Tests
 *
 * Tests from the M6.6 design spec for sprint 1.
 * Uses mocked @my-agent/core to avoid real filesystem dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SystemPromptBuilder } from "../src/agent/system-prompt-builder.js";

// Mock the core module
vi.mock("@my-agent/core", () => ({
  assembleSystemPrompt: vi.fn(),
  loadCalendarConfig: vi.fn().mockReturnValue(null),
  loadCalendarCredentials: vi.fn().mockReturnValue(null),
  createCalDAVClient: vi.fn(),
  assembleCalendarContext: vi.fn(),
  loadProperties: vi.fn().mockResolvedValue(null),
}));

const buildContext = {
  channel: "web",
  conversationId: "conv-test",
  messageIndex: 1,
};

describe("S1: Context Foundation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Test 1: current-state.md content appears in system prompt
  it("injects current-state.md content into system prompt", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");
    // Simulate assembleSystemPrompt returning content that includes operations/current-state.md
    vi.mocked(assembleSystemPrompt).mockResolvedValue(
      "## Identity\nYou are an assistant.\n\n## Current State\nLocation: Chiang Mai\nMood: Happy\n",
    );

    const builder = new SystemPromptBuilder({
      brainDir: "/tmp/brain",
      agentDir: "/tmp/agent",
    });
    const result = await builder.build(buildContext);

    // The stable prompt (block 0) should contain the current-state content
    expect(result[0].text).toContain("Current State");
    expect(result[0].text).toContain("Location: Chiang Mai");
  });

  // Test 2: Temporal context present with current date
  it("includes temporal context with current date", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");
    vi.mocked(assembleSystemPrompt).mockResolvedValue(
      "## Identity\nYou are an assistant.",
    );

    const builder = new SystemPromptBuilder({
      brainDir: "/tmp/brain",
      agentDir: "/tmp/agent",
    });
    const result = await builder.build(buildContext);

    const dynamicText = result[1].text;
    expect(dynamicText).toContain("[Temporal Context]");
    expect(dynamicText).toContain("Current time:");
    expect(dynamicText).toContain("[End Temporal Context]");

    // Should contain today's date (at least the year)
    const year = new Date().getFullYear().toString();
    expect(dynamicText).toContain(year);
  });

  // Test 3: Skills loaded into system prompt (notebook.md or any skill content)
  it("loads skills content into system prompt", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");
    // assembleSystemPrompt is responsible for loading skills from brain/skills/
    vi.mocked(assembleSystemPrompt).mockResolvedValue(
      "## Identity\nYou are an assistant.\n\n## Skills\n### notebook.md\nYou can manage a notebook.\n",
    );

    const builder = new SystemPromptBuilder({
      brainDir: "/tmp/brain",
      agentDir: "/tmp/agent",
    });
    const result = await builder.build(buildContext);

    expect(result[0].text).toContain("Skills");
    expect(result[0].text).toContain("notebook.md");
  });

  // Test 4: Cache invalidation — stale data doesn't persist after update
  it("reflects updated content after cache invalidation", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");

    // First call returns old content
    vi.mocked(assembleSystemPrompt).mockResolvedValue("## State\nOld content");

    const builder = new SystemPromptBuilder({
      brainDir: "/tmp/brain",
      agentDir: "/tmp/agent",
    });

    const result1 = await builder.build(buildContext);
    expect(result1[0].text).toContain("Old content");

    // Update the mock to return new content
    vi.mocked(assembleSystemPrompt).mockResolvedValue("## State\nNew content");

    // Without invalidation, should still return old content (cached)
    const result2 = await builder.build(buildContext);
    expect(result2[0].text).toContain("Old content");

    // After invalidation, should return new content
    builder.invalidateCache();
    const result3 = await builder.build(buildContext);
    expect(result3[0].text).toContain("New content");
  });

  // Test 5: Empty operations/ is safe — no errors when assembleSystemPrompt returns minimal content
  it("assembles prompt without errors when operations/ is empty", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");
    // Simulate minimal prompt with no operations content
    vi.mocked(assembleSystemPrompt).mockResolvedValue(
      "## Identity\nYou are an assistant.",
    );

    const builder = new SystemPromptBuilder({
      brainDir: "/tmp/brain",
      agentDir: "/tmp/agent",
    });

    // Should not throw
    const result = await builder.build(buildContext);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBeTruthy();
    expect(result[1].text).toBeTruthy();

    // Should still have temporal context
    expect(result[1].text).toContain("[Temporal Context]");
  });
});

describe("S2: Debrief Prep → System Prompt Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // E2E test #6: Trigger debrief prep → output appears in assembled prompt
  it("debrief prep output appears in assembled system prompt", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");

    // Step 1: Simulate assembleSystemPrompt including debrief prep output
    // In production: debrief prep writes current-state.md → assembleSystemPrompt reads it
    // In test: we mock the result to include the debrief prep content
    const morningPrepOutput =
      "Location: Chiang Mai. Weather: 32C sunny. Plan: Visit Doi Suthep.";
    vi.mocked(assembleSystemPrompt).mockResolvedValue(
      `## Identity\nYou are an assistant.\n\n## Current State\n${morningPrepOutput}\n`,
    );

    const builder = new SystemPromptBuilder({
      brainDir: "/tmp/brain",
      agentDir: "/tmp/agent",
    });

    const result = await builder.build(buildContext);

    // Verify the debrief prep output is in the stable prompt
    expect(result[0].text).toContain("Chiang Mai");
    expect(result[0].text).toContain("Doi Suthep");
    expect(result[0].text).toContain("Current State");
  });
});
