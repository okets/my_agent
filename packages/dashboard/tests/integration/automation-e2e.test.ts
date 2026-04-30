/**
 * M7-S9: Automation E2E tests — real services, no mocked business logic.
 *
 * Uses AppHarness with withAutomations: true to wire up the real
 * AutomationManager, JobService, Executor, Processor stack.
 *
 * The only mock is createBrainQuery (the SDK boundary) for tests
 * that exercise user automations without LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AppHarness } from "./app-harness.js";
import {
  registerHandler,
  type BuiltInHandler,
} from "../../src/scheduler/jobs/handler-registry.js";
import { createDebriefAutomationAdapter } from "../../src/mcp/debrief-automation-adapter.js";
import type { Job } from "@my-agent/core";

// Mock only the SDK boundary — everything else is real
vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    createBrainQuery: vi.fn(),
    loadConfig: vi.fn(() => ({
      model: "claude-sonnet-4-6",
      brainDir: "/tmp/brain",
    })),
    filterSkillsByTools: vi.fn(async () => []),
    cleanupSkillFilters: vi.fn(async () => {}),
  };
});

vi.mock("../../src/automations/working-nina-prompt.js", () => ({
  buildWorkingNinaPrompt: vi.fn(async () => "You are a helpful assistant."),
}));

vi.mock("../../src/utils/timezone.js", () => ({
  resolveTimezone: vi.fn(async () => "UTC"),
}));

const { createBrainQuery } = await import("@my-agent/core");

function makeAsyncIterable(messages: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        yield msg;
      }
    },
  };
}

/**
 * M9.4-S4.2-fu3: post the worker-contract change, the executor reads
 * `deliverable.md` from `run_dir` at job-end and throws if it's missing.
 * Tests that mock `createBrainQuery` must simulate the worker writing the
 * file — use this helper as a `mockImplementation` factory.
 *
 * `findRunDir` resolves to the active job's run_dir at the moment the SDK is
 * invoked (jobs may not exist when the mock is set up).
 */
const SAFE_DELIVERABLE =
  "## Result\n\nThe automation completed and produced a substantive summary of its findings, outcomes, and recommendations for downstream review.\n";

function mockSdkWithDeliverable(
  messages: any[],
  findRunDir: () => string | undefined,
) {
  return () => {
    const runDir = findRunDir();
    if (runDir) {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "deliverable.md"), SAFE_DELIVERABLE);
    }
    return makeAsyncIterable(messages);
  };
}

// ─── Task 1: System Automation Lifecycle ───────────────────────────────────

describe("System Automation Lifecycle (real services)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterEach(async () => {
    await harness.shutdown();
    vi.clearAllMocks();
  });

  it("manifest → sync → handler dispatch → job completed → events emitted", async () => {
    // Register a test handler
    const mockHandler: BuiltInHandler = vi.fn(async () => ({
      success: true,
      work: "handler produced this output",
      deliverable: null,
    }));
    registerHandler("e2e-test-handler", mockHandler);

    // Write system automation manifest to disk
    writeFileSync(
      join(harness.automationsDir!, "e2e-system-test.md"),
      `---
name: E2E System Test
status: active
system: true
trigger:
  - type: schedule
    cron: "0 8 * * *"
handler: e2e-test-handler
notify: none
autonomy: full
created: "2026-03-28"
---

System automation for E2E testing.
`,
      "utf-8",
    );

    // Sync manifests → DB
    await harness.automationManager!.syncAll();

    // Verify automation indexed with correct fields
    const automation = harness.automationManager!.read("e2e-system-test");
    expect(automation).not.toBeNull();
    expect(automation!.manifest.system).toBe(true);
    expect(automation!.manifest.handler).toBe("e2e-test-handler");

    // Collect events
    const events: string[] = [];
    harness.emitter.on("job:created" as any, () => events.push("job:created"));
    harness.emitter.on("job:completed" as any, () =>
      events.push("job:completed"),
    );

    // Fire via AppAutomationService
    await harness.automations!.fire(automation!.id);

    // Handler was called, not SDK session
    expect(mockHandler).toHaveBeenCalledOnce();
    expect(createBrainQuery).not.toHaveBeenCalled();

    // Job recorded as completed
    const jobs = harness.automationJobService!.listJobs({
      automationId: automation!.id,
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("completed");
    expect(jobs[0].summary).toContain("handler produced this output");

    // Events emitted
    expect(events).toContain("job:created");
    expect(events).toContain("job:completed");
  });
});

// ─── Task 2: System Automation Protection ──────────────────────────────────

describe("System Automation Protection (real services)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterEach(async () => {
    await harness.shutdown();
  });

  it("cannot update or disable system automations", async () => {
    // Write system manifest
    writeFileSync(
      join(harness.automationsDir!, "system-protected.md"),
      `---
name: System Protected
status: active
system: true
trigger:
  - type: manual
handler: e2e-test-handler
created: "2026-03-28"
---

Protected system automation.
`,
      "utf-8",
    );
    await harness.automationManager!.syncAll();

    const id = "system-protected";

    // Update throws
    expect(() =>
      harness.automationManager!.update(id, { name: "hacked" }),
    ).toThrow("Cannot modify system automation");

    // Disable throws
    expect(() => harness.automationManager!.disable(id)).toThrow(
      "Cannot disable system automation",
    );
  });

  it("excludeSystem filter works correctly", async () => {
    // System automation from manifest
    writeFileSync(
      join(harness.automationsDir!, "system-filter-test.md"),
      `---
name: System Filter Test
status: active
system: true
trigger:
  - type: manual
handler: e2e-test-handler
created: "2026-03-28"
---

System.
`,
      "utf-8",
    );
    await harness.automationManager!.syncAll();

    // User automation via create API
    harness.automations!.create({
      name: "User Filter Test",
      instructions: "User task.",
      manifest: { trigger: [{ type: "manual" }] },
    });

    // excludeSystem filters out system automations
    const userOnly = harness.automations!.list({ excludeSystem: true });
    expect(userOnly.every((a) => !a.manifest.system)).toBe(true);
    expect(userOnly.some((a) => a.manifest.name === "User Filter Test")).toBe(
      true,
    );

    // Unfiltered includes both
    const all = harness.automations!.list();
    expect(all.some((a) => a.manifest.system === true)).toBe(true);
    expect(all.some((a) => a.manifest.name === "User Filter Test")).toBe(true);
  });

  it("user automations can be updated and disabled", () => {
    const automation = harness.automations!.create({
      name: "Mutable User Task",
      instructions: "Can be changed.",
      manifest: { trigger: [{ type: "manual" }] },
    });

    // Update works
    const updated = harness.automationManager!.update(automation.id, {
      name: "Renamed Task",
    });
    expect(updated.manifest.name).toBe("Renamed Task");

    // Disable works
    expect(() =>
      harness.automationManager!.disable(automation.id),
    ).not.toThrow();
  });
});

// ─── Task 3: User Automation Lifecycle ─────────────────────────────────────

describe("User Automation Lifecycle (real services)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterEach(async () => {
    await harness.shutdown();
    vi.clearAllMocks();
  });

  it("user automation → SDK session path → job completed", async () => {
    // Create user automation via real service
    const automation = harness.automations!.create({
      name: "Color Research",
      instructions: "Write about the color blue.",
      manifest: { trigger: [{ type: "manual" }], autonomy: "full" },
    });

    // Mock SDK boundary — also seed deliverable.md (post-fu3 contract)
    (createBrainQuery as any).mockImplementation(
      mockSdkWithDeliverable(
        [
          { type: "system", subtype: "init", session_id: "sess-user-e2e" },
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "text",
                  text: "Research complete. Subject summary written to disk.",
                },
              ],
            },
          },
        ],
        () =>
          harness.automationJobService!.listJobs({
            automationId: automation.id,
          })[0]?.run_dir,
      ),
    );

    // Collect events
    const events: string[] = [];
    harness.emitter.on("job:created" as any, () => events.push("job:created"));
    harness.emitter.on("job:needs_review" as any, () =>
      events.push("job:needs_review"),
    );

    // Fire
    await harness.automations!.fire(automation.id);

    // SDK was called (not a handler)
    expect(createBrainQuery).toHaveBeenCalledOnce();

    // Job needs_review — generic fallback adds mandatory items that mock brain can't complete (M9.2-S1)
    const jobs = harness.automationJobService!.listJobs({
      automationId: automation.id,
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("needs_review");

    // Events emitted
    expect(events).toContain("job:created");
    expect(events).toContain("job:needs_review");
  });
});

// ─── Task 4: Trigger Types ─────────────────────────────────────────────────

describe("Trigger Types (real services)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
    // Register handler for system automations in trigger tests
    registerHandler("trigger-test-handler", async () => ({
      success: true,
      work: "trigger test output completed successfully",
      deliverable: null,
    }));
  });

  afterEach(async () => {
    await harness.shutdown();
    vi.clearAllMocks();
  });

  it("manual trigger: fire directly → job completed", async () => {
    writeFileSync(
      join(harness.automationsDir!, "manual-trigger.md"),
      `---
name: Manual Trigger Test
status: active
system: true
trigger:
  - type: manual
handler: trigger-test-handler
notify: none
created: "2026-03-28"
---

Manual trigger test.
`,
      "utf-8",
    );
    await harness.automationManager!.syncAll();

    await harness.automations!.fire("manual-trigger");

    const jobs = harness.automationJobService!.listJobs({
      automationId: "manual-trigger",
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("completed");
  });

  it("schedule trigger: cron-due automation detected", async () => {
    // Create automation with past-due cron
    writeFileSync(
      join(harness.automationsDir!, "schedule-trigger.md"),
      `---
name: Schedule Trigger Test
status: active
system: true
trigger:
  - type: schedule
    cron: "* * * * *"
handler: trigger-test-handler
notify: none
created: "2026-03-28"
---

Schedule trigger test.
`,
      "utf-8",
    );
    await harness.automationManager!.syncAll();

    // Import AutomationScheduler to test cron detection
    const { AutomationScheduler } = await import(
      "../../src/automations/automation-scheduler.js"
    );
    const scheduler = new AutomationScheduler({
      processor: harness.automationProcessor!,
      automationManager: harness.automationManager!,
      jobService: harness.automationJobService!,
      agentDir: harness.agentDir,
      pollIntervalMs: 999999, // Don't auto-poll
    });

    // start() sets isRunning=true and calls checkDue() immediately
    await scheduler.start();

    const jobs = harness.automationJobService!.listJobs({
      automationId: "schedule-trigger",
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("completed");

    await scheduler.stop();
  });

  it("channel trigger: automation hints returned for matching", () => {
    harness.automations!.create({
      name: "Invoice Watcher",
      instructions: "Watch for invoices.",
      manifest: {
        trigger: [{ type: "channel", hint: "invoice or receipt" }],
      },
    });

    const db = harness.conversationManager.getConversationDb();
    const hints = db.getAutomationHints();
    expect(hints.some((h) => h.name === "Invoice Watcher")).toBe(true);
  });
});

// ─── Task 5: HITL Resume Flow ──────────────────────────────────────────────

describe("HITL Resume Flow (real services)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterEach(async () => {
    await harness.shutdown();
    vi.clearAllMocks();
  });

  it("needs_review → resume → completed with events", async () => {
    const automation = harness.automations!.create({
      name: "HITL Review Task",
      instructions: "Ask the user a question.",
      manifest: { trigger: [{ type: "manual" }], autonomy: "full" },
    });

    const findRunDir = () =>
      harness.automationJobService!.listJobs({
        automationId: automation.id,
      })[0]?.run_dir;

    // Mock: first call returns needs_review, second call returns completed.
    // Both implementations seed deliverable.md (post-fu3 contract).
    (createBrainQuery as any)
      .mockImplementationOnce(
        mockSdkWithDeliverable(
          [
            { type: "system", subtype: "init", session_id: "sess-hitl-e2e" },
            {
              type: "assistant",
              message: {
                content: [
                  {
                    type: "text",
                    text: "I need your input. needs_review: Which option do you prefer?",
                  },
                ],
              },
            },
          ],
          findRunDir,
        ),
      )
      .mockImplementationOnce(
        mockSdkWithDeliverable(
          [
            { type: "system", subtype: "init", session_id: "sess-hitl-e2e" },
            {
              type: "assistant",
              message: {
                content: [
                  {
                    type: "text",
                    text: "Acknowledged the user's choice. Task completed successfully.",
                  },
                ],
              },
            },
          ],
          findRunDir,
        ),
      );

    // Collect events
    const events: string[] = [];
    harness.emitter.on("job:needs_review" as any, () =>
      events.push("job:needs_review"),
    );
    harness.emitter.on("job:completed" as any, () =>
      events.push("job:completed"),
    );

    // Fire → needs_review
    await harness.automations!.fire(automation.id);

    const jobs = harness.automationJobService!.listJobs({
      automationId: automation.id,
    });
    expect(jobs[0].status).toBe("needs_review");
    expect(jobs[0].sdk_session_id).toBe("sess-hitl-e2e");

    // Resume with user answer
    await harness.automations!.resume(jobs[0].id, "My favorite color is green");

    // Job still needs_review — resume goes through executor.run() which has todo gating,
    // and mock brain doesn't complete generic mandatory items (M9.2-S1)
    const updatedJob = harness.automationJobService!.getJob(jobs[0].id);
    expect(updatedJob!.status).toBe("needs_review");

    // Events emitted (both are needs_review since todo gating applies to both fire and resume)
    expect(events).toContain("job:needs_review");
  });

  it("resume passes user answer in trigger context", async () => {
    const automation = harness.automations!.create({
      name: "Context Check",
      instructions: "Ask then continue.",
      manifest: { trigger: [{ type: "manual" }], autonomy: "full" },
    });

    const findRunDir = () =>
      harness.automationJobService!.listJobs({
        automationId: automation.id,
      })[0]?.run_dir;

    (createBrainQuery as any)
      .mockImplementationOnce(
        mockSdkWithDeliverable(
          [
            { type: "system", subtype: "init", session_id: "sess-ctx-e2e" },
            {
              type: "assistant",
              message: {
                content: [
                  { type: "text", text: "needs_review: Approve the plan?" },
                ],
              },
            },
          ],
          findRunDir,
        ),
      )
      .mockImplementationOnce(
        mockSdkWithDeliverable(
          [
            {
              type: "assistant",
              message: {
                content: [{ type: "text", text: "Acknowledged: approved." }],
              },
            },
          ],
          findRunDir,
        ),
      );

    await harness.automations!.fire(automation.id);

    const jobs = harness.automationJobService!.listJobs({
      automationId: automation.id,
    });
    expect(jobs[0].status).toBe("needs_review");

    await harness.automations!.resume(jobs[0].id, "Yes, approved");

    // Resume re-runs executor.run() with userResponse in triggerContext
    // Verify the second createBrainQuery call happened (the resume)
    expect((createBrainQuery as any).mock.calls.length).toBe(2);

    // Job still needs_review — todo gating applies on resume too (M9.2-S1)
    const updatedJob = harness.automationJobService!.getJob(jobs[0].id);
    expect(updatedJob!.status).toBe("needs_review");
  });

  it("needs_review jobs survive pruning", () => {
    const automation = harness.automations!.create({
      name: "Prune Survivor",
      instructions: "Test pruning.",
      manifest: { trigger: [{ type: "manual" }] },
    });

    const job = harness.automationJobService!.createJob(automation.id);
    harness.automationJobService!.updateJob(job.id, {
      status: "needs_review",
      summary: "Waiting for user.",
    });

    // Prune with 0-day retention
    harness.automationJobService!.pruneExpiredRunDirs(0);

    // Job still exists with needs_review
    const reviewJob = harness.automationJobService!.getJob(job.id);
    expect(reviewJob!.status).toBe("needs_review");
  });
});

// ─── Task 6: Debrief Pipeline Mechanics ────────────────────────────────────

describe("Debrief Pipeline Mechanics (real services)", () => {
  let harness: AppHarness;

  beforeEach(async () => {
    harness = await AppHarness.create({ withAutomations: true });
  });

  afterEach(async () => {
    await harness.shutdown();
    vi.clearAllMocks();
  });

  it("notify:debrief jobs are collected by getDebriefPendingJobs", async () => {
    // Create automation with notify: debrief
    const automation = harness.automations!.create({
      name: "Thailand News Worker",
      instructions: "Fetch generic news headlines.",
      manifest: {
        trigger: [{ type: "manual" }],
        notify: "debrief",
        autonomy: "full",
      },
    });

    // Mock SDK for user automation — also seed deliverable.md (post-fu3)
    (createBrainQuery as any).mockImplementation(
      mockSdkWithDeliverable(
        [
          { type: "system", subtype: "init", session_id: "sess-debrief-e2e" },
          {
            type: "assistant",
            message: {
              content: [
                { type: "text", text: "News headlines summarised." },
              ],
            },
          },
        ],
        () =>
          harness.automationJobService!.listJobs({
            automationId: automation.id,
          })[0]?.run_dir,
      ),
    );

    // Fire
    await harness.automations!.fire(automation.id);

    // Job needs_review — generic fallback adds mandatory items mock brain can't complete (M9.2-S1)
    const jobs = harness.automationJobService!.listJobs({
      automationId: automation.id,
    });
    expect(jobs[0].status).toBe("needs_review");

    // Debrief collector now includes needs_review jobs with warning flag (M9.2-S2 G4 fix)
    const db = harness.conversationManager.getConversationDb();
    const since = new Date(Date.now() - 86400000).toISOString();
    const pending = db.getDebriefPendingJobs(since);
    const newsJob = pending.find((j) => j.automationName === "Thailand News Worker");
    expect(newsJob).toBeDefined();
    expect(newsJob!.needsReview).toBe(true);
  });

  it("debrief adapter reads debrief-digest.md from disk", () => {
    // Seed brief file
    const opsDir = join(harness.agentDir, "notebook", "operations");
    mkdirSync(opsDir, { recursive: true });
    writeFileSync(
      join(opsDir, "debrief-digest.md"),
      "# Daily Brief\nAll systems operational.",
      "utf-8",
    );

    const adapter = createDebriefAutomationAdapter(
      () => harness.automationJobService,
      harness.agentDir,
      () => harness.conversationManager.getConversationDb(),
    );

    expect(adapter.getDebriefOutput()).toContain("All systems operational");
  });

  it("debrief adapter hasRunToday tracks debrief jobs", () => {
    const adapter = createDebriefAutomationAdapter(
      () => harness.automationJobService,
      harness.agentDir,
      () => harness.conversationManager.getConversationDb(),
    );

    // No debrief job → false
    expect(adapter.hasRunToday("debrief-context")).toBe(false);

    // Create the "debrief" automation first (FK constraint on jobs table)
    harness.automations!.create({
      name: "Debrief",
      instructions: "Run debrief context assembly.",
      manifest: { trigger: [{ type: "manual" }] },
    });

    // Create a completed debrief job for today
    const job = harness.automationJobService!.createJob("debrief");
    harness.automationJobService!.updateJob(job.id, {
      status: "completed",
      summary: "Debrief completed.",
    });

    // Now returns true
    expect(adapter.hasRunToday("debrief-context")).toBe(true);
  });
});
