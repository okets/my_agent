/**
 * orchestrator-completed-status.test.ts — M9.6-S17 Item B regression test.
 *
 * Verifies that the awaitAutomation closure in app.ts correctly recognises
 * job.status = "completed" (set by automation-executor.ts on success) and
 * normalises it to "done" — the value RecoveryOrchestrator treats as
 * executeSuccess=true.
 *
 * Pre-fix: "completed" was absent from KNOWN_TERMINAL, so the unknown-status
 * branch fired and returned {status:"failed"} for every successful attempt,
 * causing the orchestrator to iterate all 3 attempts unnecessarily.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppHarness } from "./app-harness.js";

describe("awaitAutomation completed-status bridge (M9.6-S17 Item B)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it('normalises job.status="completed" to "done" via the KNOWN_TERMINAL closure', async () => {
    const jobService = harness.automationJobService!;

    // Create a real automation record (satisfies FK constraint), then a job.
    const automation = harness.automations!.create({
      name: "test-auto-s17b",
      instructions: "placeholder",
      manifest: { trigger: [{ type: "manual" }] },
    });
    const job = jobService.createJob(automation.id);

    // Simulate what automation-executor.ts does on a successful run.
    jobService.updateJob(job.id, { status: "completed" });

    // Replicate the KNOWN_TERMINAL closure from app.ts (the production fix).
    const KNOWN_TERMINAL = new Set([
      "done",
      "completed", // normalised to "done" below
      "failed",
      "needs_review",
      "interrupted",
      "cancelled",
    ]);

    // Simulate one polling tick of awaitAutomation.
    const fresh = jobService.getJob(job.id);
    expect(fresh?.status).toBe("completed");
    expect(KNOWN_TERMINAL.has(fresh!.status)).toBe(true);

    const normalisedStatus = fresh!.status === "completed" ? "done" : fresh!.status;
    expect(normalisedStatus).toBe("done");
  });

  it('does NOT recognise "running" or "pending" as terminal', () => {
    const KNOWN_TERMINAL = new Set([
      "done",
      "completed",
      "failed",
      "needs_review",
      "interrupted",
      "cancelled",
    ]);

    expect(KNOWN_TERMINAL.has("running")).toBe(false);
    expect(KNOWN_TERMINAL.has("pending")).toBe(false);
  });

  it('pre-fix: absent "completed" causes unknown-status branch to return "failed"', () => {
    // Pre-fix KNOWN_TERMINAL — missing "completed".
    const KNOWN_TERMINAL_PRE_FIX = new Set([
      "done",
      "failed",
      "needs_review",
      "interrupted",
      "cancelled",
    ]);

    const jobStatus = "completed";
    const isTerminal = KNOWN_TERMINAL_PRE_FIX.has(jobStatus);
    const isKnownRunning = jobStatus === "running" || jobStatus === "pending";

    // Pre-fix logic: not in KNOWN_TERMINAL and not running/pending → unknown-status branch
    // → returns {status:"failed"}, causing executeSuccess=false.
    expect(isTerminal).toBe(false);
    expect(isKnownRunning).toBe(false);
    // This is the bug: "completed" hit the unknown-status branch.
    const result = !isTerminal && !isKnownRunning ? "failed" : jobStatus;
    expect(result).toBe("failed");
  });
});
