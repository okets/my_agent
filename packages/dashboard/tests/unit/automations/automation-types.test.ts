import { describe, it, expect } from "vitest";
import type {
  TriggerConfig,
  AutomationManifest,
  Automation,
  JobStatus,
  Job,
  CreateAutomationInput,
} from "@my-agent/core";

describe("Automation type definitions", () => {
  it("TriggerConfig supports schedule type with cron", () => {
    const trigger: TriggerConfig = {
      type: "schedule",
      cron: "0 9 * * 1-5",
    };
    expect(trigger.type).toBe("schedule");
    expect(trigger.cron).toBe("0 9 * * 1-5");
  });

  it("TriggerConfig supports channel type with hint", () => {
    const trigger: TriggerConfig = {
      type: "channel",
      hint: "invoice receipt",
    };
    expect(trigger.type).toBe("channel");
    expect(trigger.hint).toBe("invoice receipt");
  });

  it("TriggerConfig supports watch type with all fields", () => {
    const trigger: TriggerConfig = {
      type: "watch",
      path: "/data/incoming",
      space: "invoices",
      events: ["add", "change"],
      polling: true,
      interval: 10000,
    };
    expect(trigger.type).toBe("watch");
    expect(trigger.polling).toBe(true);
    expect(trigger.interval).toBe(10000);
    expect(trigger.events).toEqual(["add", "change"]);
  });

  it("TriggerConfig supports manual type", () => {
    const trigger: TriggerConfig = { type: "manual" };
    expect(trigger.type).toBe("manual");
  });

  it("AutomationManifest satisfies full manifest shape", () => {
    const manifest = {
      name: "File Invoices",
      status: "active" as const,
      trigger: [{ type: "schedule" as const, cron: "0 9 * * 1" }],
      spaces: ["invoices"],
      model: "claude-sonnet-4-6",
      notify: "debrief" as const,
      persist_session: false,
      autonomy: "full" as const,
      once: false,
      created: "2026-03-23T00:00:00Z",
    } satisfies AutomationManifest;

    expect(manifest.name).toBe("File Invoices");
    expect(manifest.trigger).toHaveLength(1);
    expect(manifest.trigger[0].type).toBe("schedule");
  });

  it("AutomationManifest works with minimal required fields", () => {
    const manifest: AutomationManifest = {
      name: "Simple Task",
      status: "active",
      trigger: [{ type: "manual" }],
      created: "2026-03-23T00:00:00Z",
    };
    expect(manifest.spaces).toBeUndefined();
    expect(manifest.model).toBeUndefined();
    expect(manifest.notify).toBeUndefined();
  });

  it("Automation combines manifest with file metadata", () => {
    const automation: Automation = {
      id: "file-invoices",
      manifest: {
        name: "File Invoices",
        status: "active",
        trigger: [{ type: "manual" }],
        created: "2026-03-23T00:00:00Z",
      },
      filePath: "/home/user/.my_agent/automations/file-invoices.md",
      instructions: "File incoming invoices to the correct folder.",
      indexedAt: "2026-03-23T10:00:00Z",
    };
    expect(automation.id).toBe("file-invoices");
    expect(automation.manifest.name).toBe("File Invoices");
    expect(automation.instructions).toContain("invoices");
  });

  it("JobStatus covers all valid states", () => {
    const statuses: JobStatus[] = [
      "pending",
      "running",
      "completed",
      "failed",
      "needs_review",
      "interrupted",
    ];
    expect(statuses).toHaveLength(6);
    expect(new Set(statuses).size).toBe(6);
  });

  it("Job interface has correct shape", () => {
    const job: Job = {
      id: "job-abc123",
      automationId: "file-invoices",
      status: "completed",
      created: "2026-03-23T14:00:00Z",
      completed: "2026-03-23T14:05:00Z",
      summary: "Filed 3 invoices",
      context: { trigger: "schedule" },
      sdk_session_id: "sess-xyz",
      run_dir: "/home/user/.my_agent/automations/.runs/file-invoices/job-abc123",
    };
    expect(job.id).toBe("job-abc123");
    expect(job.status).toBe("completed");
    expect(job.context).toEqual({ trigger: "schedule" });
  });

  it("Job works with minimal required fields", () => {
    const job: Job = {
      id: "job-min",
      automationId: "test",
      status: "pending",
      created: "2026-03-23T00:00:00Z",
    };
    expect(job.completed).toBeUndefined();
    expect(job.summary).toBeUndefined();
    expect(job.context).toBeUndefined();
    expect(job.sdk_session_id).toBeUndefined();
    expect(job.run_dir).toBeUndefined();
  });

  it("CreateAutomationInput has correct shape", () => {
    const input: CreateAutomationInput = {
      name: "Daily Report",
      instructions: "Generate a daily summary report.",
      trigger: [{ type: "schedule", cron: "0 18 * * *" }],
      spaces: ["reports"],
      notify: "immediate",
    };
    expect(input.name).toBe("Daily Report");
    expect(input.trigger[0].cron).toBe("0 18 * * *");
  });
});
