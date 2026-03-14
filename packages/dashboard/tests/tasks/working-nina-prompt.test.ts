import { describe, it, expect, vi } from "vitest";

vi.mock("@my-agent/core", () => ({
  assembleSystemPrompt: vi.fn().mockResolvedValue("## Notebook\nSome notes."),
}));

vi.mock("../../src/conversations/properties.js", () => ({
  readProperties: vi.fn().mockResolvedValue({
    timezone: { value: "Asia/Bangkok", confidence: "high", updated: "2026-03-14", source: "conversation" },
    location: { value: "Chiang Mai, Thailand", confidence: "high", updated: "2026-03-14", source: "conversation" },
    availability: { value: "No fixed schedule", confidence: "medium", updated: "2026-03-14", source: "conversation" },
  }),
}));

vi.mock("../../src/utils/timezone.js", () => ({
  resolveTimezone: vi.fn().mockResolvedValue("Asia/Bangkok"),
}));

import { buildWorkingNinaPrompt } from "../../src/tasks/working-nina-prompt.js";

describe("buildWorkingNinaPrompt", () => {
  const agentDir = "/tmp/test-agent";

  it("includes working Nina persona", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("autonomous");
    expect(prompt).toContain("get the job done");
  });

  it("includes temporal context with timezone", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("[Temporal Context]");
    expect(prompt).toContain("Asia/Bangkok");
  });

  it("includes dynamic properties", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("[Dynamic Status]");
    expect(prompt).toContain("Chiang Mai");
  });

  it("includes notebook context from assembleSystemPrompt", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("Notebook");
  });

  it("includes task title and ID", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("Check weather");
    expect(prompt).toContain("abc123");
  });

  it("includes calendar context when provided", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
      calendarContext: "## Calendar\nMeeting at 3pm",
    });
    expect(prompt).toContain("Meeting at 3pm");
  });

  it("includes status-report.md instruction", async () => {
    const prompt = await buildWorkingNinaPrompt(agentDir, {
      taskTitle: "Check weather",
      taskId: "abc123",
    });
    expect(prompt).toContain("status-report.md");
  });
});
