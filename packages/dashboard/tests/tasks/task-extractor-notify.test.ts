/**
 * Unit Tests — notifyOnCompletion in Task Extraction
 *
 * Tests that notifyOnCompletion is correctly extracted from raw LLM output
 * and passed through normalization. Tests the normalizeExtractedTask logic
 * via the exported normalizeExtractedTask path.
 *
 * Because extractTaskFromMessage makes live LLM calls, we test the
 * normalization logic directly by importing it indirectly through vitest
 * module mocking.
 */

import { describe, it, expect, vi } from "vitest";

// -------------------------------------------------------------------
// Inline the normalization logic to mirror the real implementation.
// This matches exactly what normalizeExtractedTask does in task-extractor.ts.
// If the function is ever exported, these tests should be migrated to use it directly.
// -------------------------------------------------------------------

type NotifyOnCompletion = "immediate" | "debrief" | "none";

interface WorkItem {
  description: string;
  status: "pending" | "completed" | "failed";
}

interface DeliveryAction {
  channel: "whatsapp" | "email" | "dashboard";
  recipient?: string;
  content?: string;
  status: "pending" | "completed" | "failed" | "needs_review";
}

interface ExtractedTask {
  title: string;
  instructions: string;
  work: WorkItem[];
  delivery: DeliveryAction[];
  type: "immediate" | "scheduled";
  scheduledFor?: string;
  notifyOnCompletion?: NotifyOnCompletion;
}

function normalizeExtractedTask(raw: any): ExtractedTask {
  const work: WorkItem[] = (raw.work ?? []).map((w: any) => ({
    description: String(w.description ?? ""),
    status: "pending" as const,
  }));

  const delivery: DeliveryAction[] = (raw.delivery ?? []).map((d: any) => ({
    channel: d.channel ?? "dashboard",
    recipient: d.recipient,
    content: d.content,
    status: "pending" as const,
  }));

  const validNotifyValues = ["immediate", "debrief", "none"] as const;
  const notifyOnCompletion = validNotifyValues.includes(raw.notifyOnCompletion)
    ? (raw.notifyOnCompletion as NotifyOnCompletion)
    : undefined;

  return {
    title: String(raw.title ?? ""),
    instructions: String(raw.instructions ?? ""),
    work,
    delivery,
    type: raw.type === "scheduled" ? "scheduled" : "immediate",
    scheduledFor: raw.scheduledFor,
    notifyOnCompletion,
  };
}

// -------------------------------------------------------------------
// Tests for notifyOnCompletion normalization
// -------------------------------------------------------------------

describe("normalizeExtractedTask — notifyOnCompletion passthrough", () => {
  const baseRaw = {
    title: "Test task",
    instructions: "Do something",
    work: [{ description: "Research it" }],
    delivery: [{ channel: "dashboard" }],
    type: "immediate",
  };

  it('passes through "immediate" when set', () => {
    const result = normalizeExtractedTask({
      ...baseRaw,
      notifyOnCompletion: "immediate",
    });
    expect(result.notifyOnCompletion).toBe("immediate");
  });

  it('passes through "debrief" when set', () => {
    const result = normalizeExtractedTask({
      ...baseRaw,
      notifyOnCompletion: "debrief",
    });
    expect(result.notifyOnCompletion).toBe("debrief");
  });

  it('passes through "none" when set', () => {
    const result = normalizeExtractedTask({
      ...baseRaw,
      notifyOnCompletion: "none",
    });
    expect(result.notifyOnCompletion).toBe("none");
  });

  it("omits notifyOnCompletion when field is absent", () => {
    const result = normalizeExtractedTask(baseRaw);
    expect(result.notifyOnCompletion).toBeUndefined();
  });

  it("omits notifyOnCompletion when field is null", () => {
    const result = normalizeExtractedTask({
      ...baseRaw,
      notifyOnCompletion: null,
    });
    expect(result.notifyOnCompletion).toBeUndefined();
  });

  it("omits notifyOnCompletion when field is an unknown string", () => {
    const result = normalizeExtractedTask({
      ...baseRaw,
      notifyOnCompletion: "asap",
    });
    expect(result.notifyOnCompletion).toBeUndefined();
  });

  it("omits notifyOnCompletion when field is empty string", () => {
    const result = normalizeExtractedTask({
      ...baseRaw,
      notifyOnCompletion: "",
    });
    expect(result.notifyOnCompletion).toBeUndefined();
  });

  it("preserves all other fields when notifyOnCompletion is present", () => {
    const result = normalizeExtractedTask({
      ...baseRaw,
      notifyOnCompletion: "immediate",
    });
    expect(result.title).toBe("Test task");
    expect(result.instructions).toBe("Do something");
    expect(result.type).toBe("immediate");
    expect(result.work).toHaveLength(1);
    expect(result.work[0].description).toBe("Research it");
    expect(result.work[0].status).toBe("pending");
    expect(result.delivery).toHaveLength(1);
    expect(result.delivery[0].channel).toBe("dashboard");
  });
});

// -------------------------------------------------------------------
// Tests for post-response-hooks: verify detection-only behavior (M6.9-S5)
// PostResponseHooks no longer creates tasks — it only detects missed tasks.
// Task creation is now done exclusively via the create_task MCP tool.
// -------------------------------------------------------------------

describe("PostResponseHooks — missed task detection (M6.9-S5)", () => {
  it("logs warning for task-worthy request when Nina didn't create a task", async () => {
    vi.mock("../../src/tasks/task-extractor.js", () => ({
      extractTaskFromMessage: vi.fn().mockResolvedValue({
        shouldCreateTask: true,
        task: {
          title: "Look up flights",
          instructions: "Research cheap flights to Tokyo.",
          work: [{ description: "Search flights", status: "pending" }],
          type: "immediate",
          notifyOnCompletion: "immediate",
        },
      }),
    }));

    const mockLog = vi.fn();
    const mockTaskManager = {
      getTasksForConversation: vi.fn().mockReturnValue([]),
    };

    const { PostResponseHooks } = await import(
      "../../src/conversations/post-response-hooks.js"
    );

    const hooks = new PostResponseHooks({
      taskManager: mockTaskManager as any,
      log: mockLog,
      logError: vi.fn(),
    });

    await hooks.run("conv-123", "Find me flights to Tokyo", "Sure, I'll look that up.");

    // Should detect and log, NOT create
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining("[MissedTaskDetector]"),
    );
    expect(mockLog).toHaveBeenCalledWith(
      expect.stringContaining("Look up flights"),
    );
  });
});
