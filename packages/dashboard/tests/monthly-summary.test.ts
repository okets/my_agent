import { describe, it, expect, vi } from "vitest";

vi.mock("../src/scheduler/query-model.js", () => ({
  queryModel: vi.fn().mockResolvedValue("## Monthly Summary\n- Shipped M6.6"),
}));

describe("runMonthlySummary", () => {
  it("produces summary from weekly summaries", async () => {
    const { runMonthlySummary } = await import(
      "../src/scheduler/jobs/monthly-summary.js"
    );
    const result = await runMonthlySummary("## Week 1\n- thing\n\n## Week 2\n- thing");
    expect(result).toContain("Monthly Summary");
  });
});
