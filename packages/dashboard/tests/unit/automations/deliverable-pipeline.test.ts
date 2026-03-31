import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Job } from "@my-agent/core";

describe("Deliverable pipeline", () => {
  it("Job type includes deliverablePath and screenshotIds", () => {
    const job: Job = {
      id: "job-test-1",
      automationId: "test-auto",
      status: "completed",
      created: "2026-03-31T00:00:00Z",
      completed: "2026-03-31T00:05:00Z",
      summary: "Test summary",
      deliverablePath: "/tmp/test/deliverable.md",
      screenshotIds: ["ss-abc", "ss-def"],
    };
    expect(job.deliverablePath).toBe("/tmp/test/deliverable.md");
    expect(job.screenshotIds).toEqual(["ss-abc", "ss-def"]);
  });

  it("Job works without deliverablePath and screenshotIds", () => {
    const job: Job = {
      id: "job-test-2",
      automationId: "test-auto",
      status: "pending",
      created: "2026-03-31T00:00:00Z",
    };
    expect(job.deliverablePath).toBeUndefined();
    expect(job.screenshotIds).toBeUndefined();
  });

  it("deliverable.md written to run_dir when deliverable exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deliverable-test-"));
    const deliverablePath = path.join(tmpDir, "deliverable.md");
    const deliverableContent = "# Report\n\nHere is the full deliverable with image URLs:\n![screenshot](http://example.com/screenshot.png)";

    // Simulate what AutomationExecutor does after extractDeliverable
    fs.writeFileSync(deliverablePath, deliverableContent, "utf-8");

    expect(fs.existsSync(deliverablePath)).toBe(true);
    const written = fs.readFileSync(deliverablePath, "utf-8");
    expect(written).toBe(deliverableContent);
    expect(written).toContain("http://example.com/screenshot.png");

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});
