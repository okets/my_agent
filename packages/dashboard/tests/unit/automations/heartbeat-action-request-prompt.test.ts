/**
 * M9.4-S4.2 Task 6 — formatNotification.job_completed produces an
 * action-request prompt (not the old "Background work results: forward
 * verbatim" status-note framing). Pulls run_dir from the notification so
 * the prompt can reference the deliverable artifact directly.
 */

import { describe, it, expect } from "vitest";
import { HeartbeatService } from "../../../src/automations/heartbeat-service.js";
import type { PersistentNotification } from "../../../src/notifications/persistent-queue.js";

// formatNotification is private; expose via cast for the contract test.
function format(n: PersistentNotification): string {
  const hb = Object.create(HeartbeatService.prototype) as any;
  return hb.formatNotification(n);
}

describe("HeartbeatService.formatNotification(job_completed)", () => {
  it("does NOT contain the legacy 'Background work results' header", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "Today's brief summary…",
      run_dir: "/tmp/runs/morning-brief/2026-04-27",
      created: "2026-04-27T07:00:00Z",
      delivery_attempts: 0,
    });
    expect(prompt).not.toMatch(/Background work results/i);
  });

  it("does NOT instruct 'forward verbatim' (legacy status-note framing)", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "Today's brief summary…",
      run_dir: "/tmp/runs/morning-brief/2026-04-27",
      created: "2026-04-27T07:00:00Z",
      delivery_attempts: 0,
    });
    expect(prompt).not.toMatch(/forward.*verbatim/i);
  });

  it("references the run_dir/deliverable.md artifact when run_dir is provided", () => {
    const runDir = "/tmp/runs/morning-brief/2026-04-27-070000-abc";
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "Today's brief summary…",
      run_dir: runDir,
      created: "2026-04-27T07:00:00Z",
      delivery_attempts: 0,
    });
    expect(prompt).toContain(`${runDir}/deliverable.md`);
  });

  it("frames the prompt as an action request (deliver / present / render)", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "Today's brief summary…",
      run_dir: "/tmp/runs/morning-brief/2026-04-27",
      created: "2026-04-27T07:00:00Z",
      delivery_attempts: 0,
    });
    // At least one of these action verbs must appear; legacy framing had none.
    expect(prompt).toMatch(/\b(deliver|present|render)\b/i);
  });

  it("preserves editorial freedom and no-silent-drop guard in the prompt body", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "summary",
      run_dir: "/tmp/x",
      created: "2026-04-27T07:00:00Z",
      delivery_attempts: 0,
    });
    expect(prompt).toMatch(/voice/i);
    expect(prompt).toMatch(/silently drop/i);
  });

  it("falls back to summary text when run_dir is absent", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "Just a summary, no run_dir.",
      // run_dir intentionally omitted
      created: "2026-04-27T07:00:00Z",
      delivery_attempts: 0,
    });
    expect(prompt).toContain("Just a summary, no run_dir.");
    expect(prompt).not.toContain("undefined/deliverable.md");
  });

  it("does NOT log the celebratory '[Heartbeat] Delivering job_completed with VERBATIM framing' message", () => {
    // Capture console.log output and verify the legacy log line is gone.
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    };
    try {
      format({
        job_id: "j1",
        automation_id: "morning-brief",
        type: "job_completed",
        summary: "x",
        run_dir: "/tmp/x",
        created: "2026-04-27T07:00:00Z",
        delivery_attempts: 0,
      });
    } finally {
      console.log = orig;
    }
    expect(logs.some((l) => /VERBATIM framing/i.test(l))).toBe(false);
  });
});
