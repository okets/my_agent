/**
 * M9.4-S4.2 Task 6 — formatNotification.job_completed produces an
 * action-request prompt (not the old "Background work results: forward
 * verbatim" status-note framing). Pulls run_dir from the notification so
 * the prompt can reference the deliverable artifact directly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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

  // ─── M9.4-S4.2-fu2 — inline content; no Read tool invitation ──────────────

  it("inlines the deliverable summary content; does NOT reference a file path for the model to read", () => {
    const summary =
      "## Sensor Report\n\n**Reading: 145 (above threshold)**\nMeasurement: ~52 units";
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary,
      run_dir: "/tmp/runs/morning-brief/2026-04-30",
      created: "2026-04-30T07:00:00Z",
      delivery_attempts: 0,
    });
    // Inline content present
    expect(prompt).toContain(summary);
    // No file-path Read directive (this is the regression we're fixing)
    expect(prompt).not.toMatch(/Read the deliverable/i);
    expect(prompt).not.toMatch(/deliverable\.md\b/i);
    expect(prompt).not.toMatch(/\$\{?run_dir\}?/);
  });

  it("does NOT instruct any tool call (Read, Open, Fetch, etc.) — content is inline", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "## Brief\n**Body**",
      run_dir: "/tmp/x",
      created: "2026-04-30T07:00:00Z",
      delivery_attempts: 0,
    });
    // The structural fix: no instruction to invoke a tool. Sonnet narrates
    // tool calls; this prompt must not invite one.
    expect(prompt).not.toMatch(/\bRead\s+(the\s+)?(deliverable|file|content)\b/i);
    expect(prompt).not.toMatch(/\bOpen\s+the\b/i);
    expect(prompt).not.toMatch(/\bFetch\s+/i);
  });

  it("when run_dir is absent, still inlines summary (same shape as run_dir-present case)", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "## Brief\n**Body**",
      // run_dir intentionally omitted
      created: "2026-04-30T07:00:00Z",
      delivery_attempts: 0,
    });
    expect(prompt).toContain("## Brief");
    expect(prompt).toContain("**Body**");
  });

  it("delimits the inline content with a clear boundary so the model treats it as deliverable, not framing", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "BODY_SENTINEL",
      run_dir: "/tmp/x",
      created: "2026-04-30T07:00:00Z",
      delivery_attempts: 0,
    });
    // The body should be wrapped in a delimiter ("---" works) so the model
    // distinguishes content-to-render from framing-around-content.
    const idx = prompt.indexOf("BODY_SENTINEL");
    expect(idx).toBeGreaterThan(0);
    const before = prompt.slice(0, idx);
    const after = prompt.slice(idx + "BODY_SENTINEL".length);
    expect(before).toMatch(/---|```|<deliverable>/);
    expect(after).toMatch(/---|```|<\/deliverable>/);
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

  // ─── M9.4-S4.2-fu1 — Day-1 soak prompt tightening ────────────────────────

  it("prompt explicitly says 'now' to anchor delivery in present time", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "summary",
      run_dir: "/tmp/x",
      created: "2026-04-28T00:01:00Z",
      delivery_attempts: 0,
    });
    expect(prompt).toMatch(/\bnow\b/i);
  });

  it("prompt warns against 'tomorrow' / 'background' framing (Day-1 soak failure modes)", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "summary",
      run_dir: "/tmp/x",
      created: "2026-04-28T00:01:00Z",
      delivery_attempts: 0,
    });
    // The body must explicitly forbid the dismissal patterns Nina produced
    // on Apr 25–28 (mislabeling today's brief as "tomorrow's", calling
    // active delivery "background activity").
    expect(prompt).toMatch(/\btomorrow\b/i); // mentioned, in a forbidding context
    expect(prompt).toMatch(/\bbackground\b/i); // mentioned, in a forbidding context
  });

  it("prompt includes interruption-tolerance framing", () => {
    const prompt = format({
      job_id: "j1",
      automation_id: "morning-brief",
      type: "job_completed",
      summary: "summary",
      run_dir: "/tmp/x",
      created: "2026-04-28T00:01:00Z",
      delivery_attempts: 0,
    });
    // "the conversation may have been on another topic — pause and deliver"
    expect(prompt).toMatch(/pause|interrupt|other topic|in the middle/i);
  });

  // ─── M9.4-S4.3 Item G — surface SDK transcript path in prompt body ─────

  describe("Item G — Audit trail surfacing", () => {
    let tmpRunDir: string;

    beforeEach(() => {
      tmpRunDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-prompt-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpRunDir, { recursive: true, force: true });
    });

    it("includes 'Audit trail:' line when result.json has audit.transcript_path", () => {
      const transcriptPath =
        "/home/test/.claude/projects/encoded-path/sid-123.jsonl";
      fs.writeFileSync(
        path.join(tmpRunDir, "result.json"),
        JSON.stringify({
          audit: { transcript_path: transcriptPath, session_id: "sid-123" },
        }),
      );
      const prompt = format({
        job_id: "j1",
        automation_id: "morning-brief",
        type: "job_completed",
        summary: "Body content...",
        run_dir: tmpRunDir,
        created: "2026-05-02T07:00:00Z",
        delivery_attempts: 0,
      });
      expect(prompt).toContain(`Audit trail: ${transcriptPath}`);
    });

    it("MERGES with capability worker's structured result.json (audit field present alongside change_type, etc.)", () => {
      // Capability worker wrote its own result.json; framework's writeAuditMetadata
      // merged audit into it. Prompt should still surface the audit field.
      fs.writeFileSync(
        path.join(tmpRunDir, "result.json"),
        JSON.stringify({
          change_type: "configure",
          test_result: "pass",
          audit: { transcript_path: "/x/y/z.jsonl", session_id: "sid" },
        }),
      );
      const prompt = format({
        job_id: "j1",
        automation_id: "cap-modify",
        type: "job_completed",
        summary: "Capability fixed.",
        run_dir: tmpRunDir,
        created: "2026-05-02T07:00:00Z",
        delivery_attempts: 0,
      });
      expect(prompt).toContain("Audit trail: /x/y/z.jsonl");
    });

    it("omits 'Audit trail:' line gracefully when result.json is absent (no run_dir/result.json)", () => {
      // run_dir exists but no result.json (older runs, or pre-Item-F state)
      const prompt = format({
        job_id: "j1",
        automation_id: "morning-brief",
        type: "job_completed",
        summary: "Body content...",
        run_dir: tmpRunDir,
        created: "2026-05-02T07:00:00Z",
        delivery_attempts: 0,
      });
      expect(prompt).not.toMatch(/Audit trail:/);
      expect(prompt).not.toMatch(/undefined/);
    });

    it("omits 'Audit trail:' line when result.json present but lacks audit field", () => {
      fs.writeFileSync(
        path.join(tmpRunDir, "result.json"),
        JSON.stringify({ change_type: "configure" }), // no audit
      );
      const prompt = format({
        job_id: "j1",
        automation_id: "cap-modify",
        type: "job_completed",
        summary: "Body content...",
        run_dir: tmpRunDir,
        created: "2026-05-02T07:00:00Z",
        delivery_attempts: 0,
      });
      expect(prompt).not.toMatch(/Audit trail:/);
    });

    it("omits 'Audit trail:' line gracefully when run_dir no longer exists on disk (stale)", () => {
      // Notification queue is persistent; run_dir could be archived/pruned
      // between job-end and delivery format-time. Format must not crash.
      const prompt = format({
        job_id: "j1",
        automation_id: "morning-brief",
        type: "job_completed",
        summary: "Body content...",
        run_dir: "/tmp/this-path-was-archived-and-pruned-long-ago-" + Date.now(),
        created: "2026-05-02T07:00:00Z",
        delivery_attempts: 0,
      });
      expect(prompt).not.toMatch(/Audit trail:/);
      expect(prompt).not.toMatch(/undefined/);
      expect(prompt).not.toMatch(/null/);
      // body still delivered:
      expect(prompt).toContain("Body content...");
    });

    it("omits 'Audit trail:' line when result.json is malformed JSON (graceful)", () => {
      fs.writeFileSync(path.join(tmpRunDir, "result.json"), "{ this is not valid json");
      const prompt = format({
        job_id: "j1",
        automation_id: "morning-brief",
        type: "job_completed",
        summary: "Body content...",
        run_dir: tmpRunDir,
        created: "2026-05-02T07:00:00Z",
        delivery_attempts: 0,
      });
      expect(prompt).not.toMatch(/Audit trail:/);
      expect(prompt).toContain("Body content...");
    });
  });
});
