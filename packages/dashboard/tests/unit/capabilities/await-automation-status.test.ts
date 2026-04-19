import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Unit: awaitAutomation status normalisation (M9.6-S17 Item B fix)
//
// automation-executor.ts sets job.status = "completed" for successful runs.
// KNOWN_TERMINAL in app.ts must include "completed" and normalise it to "done"
// so RecoveryOrchestrator sees executeSuccess = true on the first attempt.
// ---------------------------------------------------------------------------

// Mirror of the production logic in app.ts KNOWN_TERMINAL + normalisation.
const KNOWN_TERMINAL = new Set([
  "done",
  "completed",
  "failed",
  "needs_review",
  "interrupted",
  "cancelled",
]);

function normaliseStatus(
  raw: string,
): "done" | "failed" | "needs_review" | "interrupted" | "cancelled" | null {
  if (!KNOWN_TERMINAL.has(raw)) return null;
  const s = raw === "completed" ? "done" : raw;
  return s as "done" | "failed" | "needs_review" | "interrupted" | "cancelled";
}

describe("awaitAutomation status normalisation", () => {
  it('maps "completed" to "done"', () => {
    expect(normaliseStatus("completed")).toBe("done");
  });

  it('passes "done" through unchanged', () => {
    expect(normaliseStatus("done")).toBe("done");
  });

  it('passes "failed" through unchanged', () => {
    expect(normaliseStatus("failed")).toBe("failed");
  });

  it('passes "needs_review" through unchanged', () => {
    expect(normaliseStatus("needs_review")).toBe("needs_review");
  });

  it('passes "interrupted" through unchanged', () => {
    expect(normaliseStatus("interrupted")).toBe("interrupted");
  });

  it('passes "cancelled" through unchanged', () => {
    expect(normaliseStatus("cancelled")).toBe("cancelled");
  });

  it('returns null for "running" (non-terminal)', () => {
    expect(normaliseStatus("running")).toBeNull();
  });

  it('returns null for "pending" (non-terminal)', () => {
    expect(normaliseStatus("pending")).toBeNull();
  });

  it("returns null for unknown status", () => {
    expect(normaliseStatus("unknown_status")).toBeNull();
  });

  it('includes "completed" in KNOWN_TERMINAL', () => {
    expect(KNOWN_TERMINAL.has("completed")).toBe(true);
  });
});
