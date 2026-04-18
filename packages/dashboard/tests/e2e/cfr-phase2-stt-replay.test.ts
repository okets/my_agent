/**
 * M9.6-S15 Phase 2 Exit Gate: STT real-incident replay.
 *
 * Mirrors S7's cfr-incident-replay.test.ts using v2 plumbing:
 *   - TriggeringOrigin discriminated union (S9)
 *   - CapabilityInvoker CFR path (S10, emitted directly here to avoid
 *     running the full chat-service stack)
 *   - reverifyAudioToText via dispatchReverify (S13)
 *   - Friendly-name ack "voice transcription" (S14)
 *
 * Assertions:
 *   1. CFR has origin.kind === "conversation"
 *   2. emittedAcks contains "attempt"
 *   3. Fix automation creates .enabled
 *   4. Registry reports capability available
 *   5. reprocessTurn called with real Songkran transcript
 *   6. No surrender
 *
 * Preconditions (all must be present; suite skips otherwise):
 *   - packages/core/tests/fixtures/cfr/.local/voice-1-incident.ogg
 *   - .my_agent/capabilities/stt-deepgram/CAPABILITY.md
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *   - DEEPGRAM_API_KEY
 *
 * Invocation:
 *   env -u CLAUDECODE node --env-file=packages/dashboard/.env \
 *     node_modules/.bin/vitest run tests/e2e/cfr-phase2-stt-replay
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { join } from "node:path";

import {
  CfrEmitter,
  CapabilityRegistry,
  CapabilityWatcher,
  scanCapabilities,
  RecoveryOrchestrator,
  conversationOrigin,
} from "@my-agent/core";
import type { AckKind, CapabilityFailure } from "@my-agent/core";
import { ConversationManager } from "../../src/conversations/index.js";
import { AppAutomationService } from "../../src/app.js";
import { AutomationManager } from "../../src/automations/automation-manager.js";
import { AutomationJobService } from "../../src/automations/automation-job-service.js";
import { AutomationExecutor } from "../../src/automations/automation-executor.js";
import { AutomationProcessor } from "../../src/automations/automation-processor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Fixture paths ────────────────────────────────────────────────────────────

const AUDIO_PATH =
  process.env.CFR_INCIDENT_AUDIO ??
  path.join(
    __dirname,
    "../../../core/tests/fixtures/cfr/.local/voice-1-incident.ogg",
  );

function findAgentDir(): string | null {
  const candidate = path.resolve(__dirname, "../../../..", ".my_agent");
  return fs.existsSync(candidate) ? candidate : null;
}

const realAgentDir = findAgentDir();

const hasAudio = existsSync(AUDIO_PATH);
const hasSttDeepgram =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "stt-deepgram", "CAPABILITY.md"));
const hasAuth = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
const hasDeepgram = !!process.env.DEEPGRAM_API_KEY;

const canRun = hasAudio && hasSttDeepgram && hasAuth && hasDeepgram;

const MODEL_SONNET = "claude-sonnet-4-6";
const MODEL_OPUS = "claude-opus-4-6";
const TEST_CONV_ID = "cfr-s15-stt-exit-gate";
const TEST_TURN = 1;
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "needs_review",
  "interrupted",
  "cancelled",
]);

describe.skipIf(!canRun)("M9.6-S15 Exit Gate: STT real-incident replay (Phase 2)", () => {
  let agentDir: string;
  let registry: CapabilityRegistry;
  let watcher: CapabilityWatcher;
  let cfr: CfrEmitter;
  let conversationManager: ConversationManager;
  let automations: AppAutomationService;
  let automationJobService: AutomationJobService;

  const emittedAcks: AckKind[] = [];
  const capturedFailures: CapabilityFailure[] = [];
  let reprocessCalledWith: string | null = null;
  let surrenderEmitted = false;

  beforeAll(async () => {
    // agentDir MUST be inside the project tree so Claude Code finds CLAUDE.md.
    const automationsTempParent = join(realAgentDir!, "automations");
    mkdirSync(automationsTempParent, { recursive: true });
    agentDir = fs.mkdtempSync(join(automationsTempParent, ".cfr-s15-stt-"));
    mkdirSync(join(agentDir, "brain"), { recursive: true });
    mkdirSync(join(agentDir, "runtime"), { recursive: true });
    mkdirSync(join(agentDir, "automations"), { recursive: true });
    mkdirSync(join(agentDir, "conversations", TEST_CONV_ID, "raw"), { recursive: true });

    const capabilitiesDir = join(agentDir, "capabilities");
    const enabledFileAbs = join(capabilitiesDir, "stt-deepgram", ".enabled");

    writeFileSync(
      join(agentDir, "CLAUDE.md"),
      `# CFR Fix Agent — Isolated Test Environment\n\n` +
      `**IMPORTANT: This is an isolated test environment. Do NOT modify files outside this directory.**\n\n` +
      `## Capabilities Location\n\n` +
      `The capabilities for THIS environment are at:\n` +
      `\`${capabilitiesDir}\`\n\n` +
      `Do NOT use the path \`.my_agent/capabilities/\` — that is the production system. You are in a test env.\n\n` +
      `## Your Task\n\n` +
      `The \`stt-deepgram\` capability is present but NOT enabled (symptom: not-enabled).\n` +
      `The \`.enabled\` marker file is missing. To fix it:\n\n` +
      `1. Create the file: \`${enabledFileAbs}\`\n` +
      `2. You can do this with a single Bash command: \`touch "${enabledFileAbs}"\`\n` +
      `3. Verify it exists: \`ls -la "${join(capabilitiesDir, "stt-deepgram")}"\`\n` +
      `4. Write deliverable.md in your current run directory.\n\n` +
      `**Do NOT run the transcribe.sh smoke test.** The orchestrator handles re-verification after you finish.\n` +
      `**Do NOT explore other directories.** The fix is a single file creation.\n`,
    );
    writeFileSync(
      join(agentDir, "brain", "AGENTS.md"),
      `# CFR Fix Agent\n\nYou have been spawned to fix a capability failure in an isolated test environment.\n\n` +
      `Read the CLAUDE.md in your agent directory for exact instructions and the file path to create.\n` +
      `The fix requires creating a single \`.enabled\` file. Do it immediately, verify it, write deliverable.md.\n`,
    );

    // Copy incident audio
    const rawAudioPath = join(agentDir, "conversations", TEST_CONV_ID, "raw", "voice-1.ogg");
    fs.copyFileSync(AUDIO_PATH, rawAudioPath);

    // Copy stt-deepgram capability WITHOUT .enabled
    cpSync(
      join(realAgentDir!, "capabilities", "stt-deepgram"),
      join(capabilitiesDir, "stt-deepgram"),
      { recursive: true },
    );
    const enabledPath = join(capabilitiesDir, "stt-deepgram", ".enabled");
    if (existsSync(enabledPath)) fs.rmSync(enabledPath);

    // Copy .env (for DEEPGRAM_API_KEY)
    const srcEnvPath = path.resolve(__dirname, "../../.env");
    const envPath = join(agentDir, ".env");
    if (existsSync(srcEnvPath)) fs.copyFileSync(srcEnvPath, envPath);
    else writeFileSync(envPath, "");

    // Registry + watcher
    registry = new CapabilityRegistry();
    registry.setProjectRoot(path.resolve(__dirname, "../../../.."));
    const caps = await scanCapabilities(capabilitiesDir, envPath);
    registry.load(caps);
    await registry.testAll();

    watcher = new CapabilityWatcher(capabilitiesDir, envPath, registry);
    await watcher.start();

    // Automation stack
    conversationManager = new ConversationManager(agentDir);
    const db = conversationManager.getConversationDb();
    const automationsDir = join(agentDir, "automations");

    const automationManager = new AutomationManager(automationsDir, db);
    automationJobService = new AutomationJobService(automationsDir, db);
    const automationExecutor = new AutomationExecutor({
      automationManager,
      jobService: automationJobService,
      agentDir,
      db,
      capabilityRegistry: registry,
    });
    const automationProcessor = new AutomationProcessor({
      automationManager,
      executor: automationExecutor,
      jobService: automationJobService,
      agentDir,
      onJobEvent: () => {},
    });
    const fakeApp = Object.assign({ emit: () => false } as any, {});
    automations = new AppAutomationService(
      automationManager,
      automationProcessor,
      automationJobService,
      fakeApp,
    );

    // CFR + orchestrator
    cfr = new CfrEmitter();
    const orchestrator = new RecoveryOrchestrator({
      spawnAutomation: async (spec) => {
        const model = spec.model === "opus" ? MODEL_OPUS : MODEL_SONNET;
        const automation = automations.create({
          name: spec.name,
          instructions: spec.prompt,
          manifest: {
            name: spec.name,
            model,
            autonomy: spec.autonomy === "cautious" ? "cautious" : "full",
            trigger: [{ type: "manual" }],
            once: true,
            job_type: spec.jobType,
          },
        });
        await automations.fire(automation.id);
        const jobs = automations.listJobs({ automationId: automation.id });
        const job = jobs[0];
        if (!job) throw new Error(`No job for automation ${automation.id}`);
        return { jobId: job.id, automationId: automation.id };
      },
      awaitAutomation: async (jobId, timeoutMs) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const job = automationJobService.getJob(jobId);
          if (job && TERMINAL_STATUSES.has(job.status)) {
            const mappedStatus = job.status === "completed" ? "done" : job.status;
            return { status: mappedStatus as any };
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        return { status: "failed" };
      },
      getJobRunDir: (jobId) => automationJobService.getJob(jobId)?.run_dir ?? null,
      capabilityRegistry: registry,
      watcher,
      emitAck: async (failure, kind) => {
        emittedAcks.push(kind);
        capturedFailures.push(failure);
        if (kind === "surrender" || kind === "surrender-budget") surrenderEmitted = true;
      },
      reprocessTurn: async (_failure, recoveredContent) => {
        reprocessCalledWith = recoveredContent;
      },
      now: () => new Date().toISOString(),
    });

    cfr.on("failure", (f) => {
      orchestrator.handle(f).catch((err) => {
        console.error("[S15-STT] Orchestrator error:", err);
      });
    });
  }, 60_000);

  afterAll(async () => {
    await watcher.stop();
    conversationManager.close();
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("STT recovers: attempt ack → fix → reverify → reprocessTurn with transcript", async () => {
    const rawAudioPath = join(agentDir, "conversations", TEST_CONV_ID, "raw", "voice-1.ogg");
    const enabledPath = join(agentDir, "capabilities", "stt-deepgram", ".enabled");

    expect(existsSync(enabledPath)).toBe(false);

    // Emit CFR — simulates what CapabilityInvoker fires when STT is not-enabled
    cfr.emitFailure({
      capabilityType: "audio-to-text",
      capabilityName: "stt-deepgram",
      symptom: "not-enabled",
      detail: "stt-deepgram .enabled absent",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-s15-stt", sender: "+10000000002" },
          TEST_CONV_ID,
          TEST_TURN,
        ),
        artifact: {
          type: "audio",
          rawMediaPath: rawAudioPath,
          mimeType: "audio/ogg",
        },
      },
    });

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      if (reprocessCalledWith !== null || surrenderEmitted) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // 1. Emitted attempt ack
    expect(emittedAcks).toContain("attempt");

    // 2. v2 origin shape: kind === "conversation"
    expect(capturedFailures[0]?.triggeringInput.origin.kind).toBe("conversation");

    // 3. Fix created .enabled
    expect(existsSync(enabledPath)).toBe(true);

    // 4. Registry updated to available
    const cap = registry.get("audio-to-text");
    expect(cap).toBeDefined();
    expect(cap!.status).toBe("available");

    // 5. reprocessTurn called with real transcript (Songkran audio)
    expect(reprocessCalledWith).not.toBeNull();
    expect(reprocessCalledWith!.toLowerCase()).toContain("songkran");

    // 6. No surrender
    expect(surrenderEmitted).toBe(false);
  }, 360_000);
});
