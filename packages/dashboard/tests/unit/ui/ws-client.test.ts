/**
 * M9.4-S5: ws-client DOM event dispatch for handoff wiring.
 *
 * The test replicates the dispatch logic embedded in ws-client.js and
 * exercises it against a Node EventTarget (a drop-in stand-in for
 * window). Full integration is exercised in the Playwright browser
 * tests (Task 12).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Node 18+ provides EventTarget and CustomEvent globally.
// Cast to any to satisfy the ambient DOM-shaped signature used in ws-client.js.
let win: EventTarget;

function dispatchForWS(data: any): void {
  if (data.type === "start" && data.triggerJobId) {
    win.dispatchEvent(
      new CustomEvent("assistant-turn-start", {
        detail: { triggerJobId: data.triggerJobId },
      }),
    );
  } else if (data.type === "handoff_pending") {
    win.dispatchEvent(
      new CustomEvent("handoff-pending", {
        detail: { jobId: data.jobId },
      }),
    );
  }
}

describe("ws-client handoff DOM events (M9.4-S5)", () => {
  beforeEach(() => {
    win = new EventTarget();
  });

  it("emits assistant-turn-start when start carries triggerJobId", () => {
    const handler = vi.fn();
    win.addEventListener("assistant-turn-start", handler);
    dispatchForWS({ type: "start", triggerJobId: "job-1" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail.triggerJobId).toBe(
      "job-1",
    );
  });

  it("does NOT emit assistant-turn-start when start has no triggerJobId", () => {
    const handler = vi.fn();
    win.addEventListener("assistant-turn-start", handler);
    dispatchForWS({ type: "start" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("emits handoff-pending for every handoff_pending frame", () => {
    const handler = vi.fn();
    win.addEventListener("handoff-pending", handler);
    dispatchForWS({ type: "handoff_pending", jobId: "job-2" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail.jobId).toBe(
      "job-2",
    );
  });
});
