/**
 * debrief-reporter System Health section — integration tests (M9.6-S24 Task 6)
 *
 * Verifies:
 *   - Ring buffer with fixed events → digest includes `## System Health`
 *     section listing self-healed caps with timestamps.
 *   - Ring buffer with surrendered events → listed under Surrendered.
 *   - Ring buffer empty (or all "in-progress" entries) → section omitted.
 *   - The formatter itself (formatSystemHealthSection) is tested
 *     independently so the branch logic is covered without touching disk.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AckDelivery } from "@my-agent/core";

import {
  formatSystemHealthSection,
  // registerHandler side-effect — importing loads all handlers
  // including debrief-reporter and debrief-context.
} from "../../src/scheduler/jobs/handler-registry.js";
import { getHandler } from "../../src/scheduler/jobs/handler-registry.js";

// The reporter runs debrief-context as its first step, which calls queryModel
// via runDebriefPrep. Mock it so the integration test doesn't need a live SDK.
vi.mock("../../src/scheduler/query-model.js", () => ({
  queryModel: vi.fn(async () => "mocked current-state digest"),
}));

function makeAckDelivery(): AckDelivery {
  // TransportManager / ConnectionRegistry are required by the constructor but
  // never touched on the system-origin path we exercise here.
  return new AckDelivery(
    { send: async () => {} } as any,
    { broadcastToConversation: () => {} } as any,
  );
}

// Recent timestamp (1h ago) — stays within the 24h filter window regardless
// of when the suite runs.
const recentTs = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe("formatSystemHealthSection (M9.6-S24 Task 6)", () => {
  it("returns empty string when ackDelivery is undefined", () => {
    expect(formatSystemHealthSection(undefined)).toBe("");
  });

  it("returns empty string when ring buffer has no fixed/surrendered entries", () => {
    const ack = makeAckDelivery();
    // No events at all — section omitted.
    expect(formatSystemHealthSection(ack)).toBe("");
  });

  it("lists fixed caps under Self-healed", () => {
    const ack = makeAckDelivery();
    const ts = recentTs();
    ack.recordSystemOutcome({
      component: "capability-health-probe",
      capabilityType: "audio-to-text",
      capabilityName: "stt-deepgram",
      symptom: "execution-error",
      outcome: "fixed",
      timestamp: ts,
    });

    const section = formatSystemHealthSection(ack);
    expect(section).toContain("## System Health");
    expect(section).toContain("Self-healed:");
    expect(section).toContain(`- stt-deepgram (audio-to-text) at ${ts}`);
    expect(section).not.toContain("Surrendered:");
  });

  it("lists surrendered caps under Surrendered", () => {
    const ack = makeAckDelivery();
    const ts = recentTs();
    ack.recordSystemOutcome({
      component: "capability-health-probe",
      capabilityType: "browser-control",
      capabilityName: "browser-chrome",
      symptom: "execution-error",
      outcome: "surrendered",
      timestamp: ts,
    });

    const section = formatSystemHealthSection(ack);
    expect(section).toContain("## System Health");
    expect(section).toContain("Surrendered:");
    expect(section).toContain(`- browser-chrome (browser-control) at ${ts}`);
    expect(section).not.toContain("Self-healed:");
  });

  it("lists both when both kinds present", () => {
    const ack = makeAckDelivery();
    const ts1 = recentTs();
    const ts2 = recentTs();
    ack.recordSystemOutcome({
      component: "capability-health-probe",
      capabilityType: "audio-to-text",
      capabilityName: "stt-deepgram",
      symptom: "execution-error",
      outcome: "fixed",
      timestamp: ts1,
    });
    ack.recordSystemOutcome({
      component: "capability-health-probe",
      capabilityType: "text-to-audio",
      capabilityName: "tts-elevenlabs",
      symptom: "execution-error",
      outcome: "surrendered",
      timestamp: ts2,
    });

    const section = formatSystemHealthSection(ack);
    expect(section).toContain("Self-healed:");
    expect(section).toContain("stt-deepgram (audio-to-text)");
    expect(section).toContain("Surrendered:");
    expect(section).toContain("tts-elevenlabs (text-to-audio)");
  });

  it("falls back to capabilityType when capabilityName is absent", () => {
    const ack = makeAckDelivery();
    const ts = recentTs();
    ack.recordSystemOutcome({
      component: "capability-health-probe",
      capabilityType: "custom-type",
      outcome: "fixed",
      symptom: "execution-error",
      timestamp: ts,
    });

    const section = formatSystemHealthSection(ack);
    expect(section).toContain(`- custom-type (custom-type) at ${ts}`);
  });
});

describe("debrief-reporter handler — System Health integration", () => {
  let agentDir: string;
  let opsDir: string;
  let dbStub: any;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "debrief-reporter-sh-"));
    opsDir = join(agentDir, "notebook", "operations");
    mkdirSync(opsDir, { recursive: true });
    // Minimal ConversationDatabase stub — returns empty worker list so the
    // System Health section is the only dynamic content.
    dbStub = {
      getDebriefPendingJobs: vi.fn().mockReturnValue([]),
    };
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("includes System Health section when ring buffer has fixed events", async () => {
    const ack = makeAckDelivery();
    ack.recordSystemOutcome({
      component: "capability-health-probe",
      capabilityType: "audio-to-text",
      capabilityName: "stt-deepgram",
      symptom: "execution-error",
      outcome: "fixed",
      timestamp: recentTs(),
    });

    const reporter = getHandler("debrief-reporter");
    expect(reporter).toBeDefined();

    const result = await reporter!({
      agentDir,
      jobId: "test-job-1",
      db: dbStub,
      ackDelivery: ack,
    });

    expect(result.success).toBe(true);
    expect(result.deliverable).toContain("## System Health");
    expect(result.deliverable).toContain("Self-healed:");
    expect(result.deliverable).toContain("stt-deepgram (audio-to-text)");

    const digestPath = join(opsDir, "debrief-digest.md");
    expect(existsSync(digestPath)).toBe(true);
    const digest = readFileSync(digestPath, "utf-8");
    expect(digest).toContain("## System Health");
    expect(digest).toContain("stt-deepgram");
  });

  it("omits System Health section when ring buffer is empty", async () => {
    const ack = makeAckDelivery(); // empty ring buffer

    const reporter = getHandler("debrief-reporter");
    const result = await reporter!({
      agentDir,
      jobId: "test-job-2",
      db: dbStub,
      ackDelivery: ack,
    });

    // No workers AND no system events → early return, no digest file written.
    expect(result.deliverable).toBe("No background work to report.");
    expect(result.work).toBe("No background work to report.");
    expect(existsSync(join(opsDir, "debrief-digest.md"))).toBe(false);
  });

  it("lists surrendered events under the Surrendered sub-header", async () => {
    const ack = makeAckDelivery();
    ack.recordSystemOutcome({
      component: "capability-health-probe",
      capabilityType: "browser-control",
      capabilityName: "browser-chrome",
      symptom: "execution-error",
      outcome: "surrendered",
      timestamp: recentTs(),
    });
    ack.recordSystemOutcome({
      component: "capability-health-probe",
      capabilityType: "desktop-control",
      capabilityName: "desktop-x11",
      symptom: "execution-error",
      outcome: "surrendered",
      timestamp: recentTs(),
    });

    const reporter = getHandler("debrief-reporter");
    const result = await reporter!({
      agentDir,
      jobId: "test-job-3",
      db: dbStub,
      ackDelivery: ack,
    });

    expect(result.deliverable).toContain("## System Health");
    expect(result.deliverable).toContain("Surrendered:");
    expect(result.deliverable).toContain("browser-chrome (browser-control)");
    expect(result.deliverable).toContain("desktop-x11 (desktop-control)");
    expect(result.deliverable).not.toContain("Self-healed:");
  });

  it("skips System Health section when all entries are still in-progress", async () => {
    // An attempt ack that flowed through deliver() would push an in-progress
    // entry. Simulate that via the public API — this confirms the reporter
    // only surfaces terminal outcomes.
    const ack = makeAckDelivery();
    (ack as any).systemEventLog.push({
      component: "capability-health-probe",
      capabilityType: "audio-to-text",
      capabilityName: "stt-deepgram",
      symptom: "execution-error",
      outcome: "in-progress",
      timestamp: recentTs(),
    });

    const reporter = getHandler("debrief-reporter");
    const result = await reporter!({
      agentDir,
      jobId: "test-job-4",
      db: dbStub,
      ackDelivery: ack,
    });

    // No terminal events → section omitted, no workers → early return path.
    expect(result.deliverable).toBe("No background work to report.");
    expect(existsSync(join(opsDir, "debrief-digest.md"))).toBe(false);
  });
});
