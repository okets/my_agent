/**
 * Task 3: Debrief automation adapter — unit tests
 *
 * Verifies the adapter bridges DebriefSchedulerLike to the automation job system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDebriefAutomationAdapter } from "../../../src/mcp/debrief-automation-adapter.js";
import { AutomationJobService } from "../../../src/automations/automation-job-service.js";
import { ConversationDatabase } from "../../../src/conversations/db.js";
import { AutomationManager } from "../../../src/automations/automation-manager.js";
import {
  registerHandler,
  type BuiltInHandler,
} from "../../../src/scheduler/jobs/handler-registry.js";
import { mkdtempSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Debrief Automation Adapter", () => {
  let db: ConversationDatabase;
  let jobService: AutomationJobService;
  let manager: AutomationManager;
  let tempDir: string;
  let automationsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "debrief-adapter-"));
    automationsDir = join(tempDir, "automations");
    mkdirSync(automationsDir, { recursive: true });
    db = new ConversationDatabase(tempDir);
    jobService = new AutomationJobService(automationsDir, db);
    manager = new AutomationManager(automationsDir, db);
  });

  afterEach(() => {
    db.close();
  });

  it("hasRunToday returns false when no jobs exist", () => {
    const adapter = createDebriefAutomationAdapter(() => jobService, tempDir);
    expect(adapter.hasRunToday("debrief-context")).toBe(false);
  });

  it("hasRunToday returns true when a completed debrief job exists today", () => {
    // Create the debrief automation so job creation works
    manager.create({
      name: "Debrief",
      instructions: "Prep debrief.",
      manifest: {
        trigger: [{ type: "manual" }],
        handler: "debrief-context",
      },
    });

    const job = jobService.createJob("debrief");
    jobService.updateJob(job.id, {
      status: "completed",
      completed: new Date().toISOString(),
      summary: "Debrief output here.",
    });

    const adapter = createDebriefAutomationAdapter(() => jobService, tempDir);
    expect(adapter.hasRunToday("debrief-context")).toBe(true);
  });

  it("getDebriefOutput returns brief from file when it exists", () => {
    // Write morning-brief.md to the expected location
    const opsDir = join(tempDir, "notebook", "operations");
    mkdirSync(opsDir, { recursive: true });
    const { writeFileSync } = require("fs");
    writeFileSync(join(opsDir, "morning-brief.md"), "Today's debrief summary.");

    const adapter = createDebriefAutomationAdapter(() => jobService, tempDir);
    expect(adapter.getDebriefOutput()).toBe("Today's debrief summary.");
  });

  it("getDebriefOutput returns null when no job exists", () => {
    const adapter = createDebriefAutomationAdapter(() => jobService, tempDir);
    expect(adapter.getDebriefOutput()).toBeNull();
  });

  it("handleDebriefPrep calls the registered handler and returns output", async () => {
    const mockHandler: BuiltInHandler = vi.fn(async () => ({
      success: true,
      work: "Mock debrief output",
      deliverable: null,
    }));
    registerHandler("debrief-reporter", mockHandler);

    const adapter = createDebriefAutomationAdapter(() => jobService, tempDir);
    const output = await adapter.handleDebriefPrep();

    expect(output).toBe("Mock debrief output");
    expect(mockHandler).toHaveBeenCalledOnce();
    expect(mockHandler).toHaveBeenCalledWith(
      expect.objectContaining({ agentDir: tempDir }),
    );
  });

  it("lazy initialization — works when getJobService initially returns null", () => {
    let service: AutomationJobService | null = null;
    const adapter = createDebriefAutomationAdapter(() => service, tempDir);

    // Should not throw when service is null
    expect(adapter.hasRunToday("debrief-context")).toBe(false);
    expect(adapter.getDebriefOutput()).toBeNull();

    // Now provide the real service
    service = jobService;
    manager.create({
      name: "Debrief",
      instructions: "Prep debrief.",
      manifest: {
        trigger: [{ type: "manual" }],
        handler: "debrief-context",
      },
    });
    const job = jobService.createJob("debrief");
    jobService.updateJob(job.id, {
      status: "completed",
      completed: new Date().toISOString(),
      summary: "Lazy init worked.",
    });

    expect(adapter.hasRunToday("debrief-context")).toBe(true);
    // getDebriefOutput reads from file, not DB — write the file
    const opsDir = join(tempDir, "notebook", "operations");
    mkdirSync(opsDir, { recursive: true });
    const { writeFileSync } = require("fs");
    writeFileSync(join(opsDir, "morning-brief.md"), "Lazy init worked.");
    expect(adapter.getDebriefOutput()).toBe("Lazy init worked.");
  });
});
