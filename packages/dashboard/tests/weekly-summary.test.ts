import { describe, it, expect, vi } from "vitest";

vi.mock("../src/scheduler/query-model.js", () => ({
  queryModel: vi.fn().mockResolvedValue("## Weekly Summary\n- Key theme: testing"),
}));

describe("runWeeklySummary", () => {
  it("produces summary from daily summaries", async () => {
    const { runWeeklySummary } = await import(
      "../src/scheduler/jobs/weekly-summary.js"
    );
    const result = await runWeeklySummary("## Day 1\n- thing\n\n## Day 2\n- thing");
    expect(result).toContain("Weekly Summary");
  });
});
