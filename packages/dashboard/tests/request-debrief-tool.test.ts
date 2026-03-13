import { describe, it, expect, vi } from "vitest";

describe("request_debrief MCP tool", () => {
  it("returns cached debrief when already run today", async () => {
    const mockScheduler = {
      hasRunToday: vi.fn().mockReturnValue(true),
      getDebriefOutput: vi.fn().mockReturnValue("# Today's Debrief\n\nAll good."),
      handleDebriefPrep: vi.fn(),
    };

    const { createDebriefHandler } = await import("../src/mcp/debrief-server.js");
    const handler = createDebriefHandler(mockScheduler as any);
    const result = await handler();

    expect(mockScheduler.hasRunToday).toHaveBeenCalledWith("debrief-prep");
    expect(mockScheduler.handleDebriefPrep).not.toHaveBeenCalled();
    expect(result).toContain("Today's Debrief");
  });

  it("triggers fresh debrief-prep when not run today", async () => {
    const mockScheduler = {
      hasRunToday: vi.fn().mockReturnValue(false),
      getDebriefOutput: vi.fn(),
      handleDebriefPrep: vi.fn().mockResolvedValue("# Fresh Debrief\n\nNew content."),
    };

    const { createDebriefHandler } = await import("../src/mcp/debrief-server.js");
    const handler = createDebriefHandler(mockScheduler as any);
    const result = await handler();

    expect(mockScheduler.handleDebriefPrep).toHaveBeenCalled();
    expect(result).toContain("Fresh Debrief");
  });
});
