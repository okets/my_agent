/**
 * M9.6-S15 Phase 2 Exit Gate: TTS real-incident replay (terminal path).
 *
 * TTS recovery ends in RESTORED_TERMINAL — no user input to replay.
 * The orchestrator fixes the plug, reverifies via smoke.sh, then emits
 * "terminal-fixed" ack (no reprocessTurn call).
 *
 * Preconditions (all must be present; suite skips otherwise):
 *   - .my_agent/capabilities/tts-edge-tts/CAPABILITY.md
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *   - tts-edge-tts smoke.sh exits 0 (edge-tts functional)
 *
 * Invocation:
 *   env -u CLAUDECODE node --env-file=packages/dashboard/.env \
 *     node_modules/.bin/vitest run tests/e2e/cfr-phase2-tts-replay
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  CfrEmitter,
  CapabilityRegistry,
  CapabilityWatcher,
  scanCapabilities,
  RecoveryOrchestrator,
  conversationOrigin,
} from "@my-agent/core";
import type { AckKind } from "@my-agent/core";
import { ConversationManager } from "../../src/conversations/index.js";
import { AppAutomationService } from "../../src/app.js";
import { AutomationManager } from "../../src/automations/automation-manager.js";
import { AutomationJobService } from "../../src/automations/automation-job-service.js";
import { AutomationExecutor } from "../../src/automations/automation-executor.js";
import { AutomationProcessor } from "../../src/automations/automation-processor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findAgentDir(): string | null {
  const candidate = path.resolve(__dirname, "../../../..", ".my_agent");
  return fs.existsSync(candidate) ? candidate : null;
}

const realAgentDir = findAgentDir();

const hasTtsPlug =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "tts-edge-tts", "CAPABILITY.md"));

const hasAuth = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);

// Pre-check: is edge-tts actually functional? Run smoke.sh on the real plug.
let ttsSmokePasses = false;
if (hasTtsPlug) {
  try {
    const smokeScript = join(realAgentDir!, "capabilities", "tts-edge-tts", "scripts", "smoke.sh");
    execFileSync("bash", [smokeScript], { timeout: 30_000, stdio: "pipe" });
    ttsSmokePasses = true;
  } catch {
    ttsSmokePasses = false; // exit 1 or 2 — skip
  }
}

const canRun = hasTtsPlug && hasAuth && ttsSmokePasses;

const MODEL_SONNET = "claude-sonnet-4-6";
const MODEL_OPUS = "claude-opus-4-6";
const TEST_CONV_ID = "cfr-s15-tts-exit-gate";
const TEST_TURN = 1;
const TERMINAL_STATUSES = new Set([
  "completed", "failed", "needs_review", "interrupted", "cancelled",
]);

describe.skipIf(!canRun)("M9.6-S15 Exit Gate: TTS real-incident replay (terminal path)", () => {
  let agentDir: string;
  let registry: CapabilityRegistry;
  let watcher: CapabilityWatcher;
  let cfr: CfrEmitter;
  let conversationManager: ConversationManager;
  let automations: AppAutomationService;
  let automationJobService: AutomationJobService;

  const emittedAcks: AckKind[] = [];
  let reprocessCalled = false;
  let surrenderEmitted = false;

  beforeAll(async () => {
    const automationsTempParent = join(realAgentDir!, "automations");
    mkdirSync(automationsTempParent, { recursive: true });
    agentDir = fs.mkdtempSync(join(automationsTempParent, ".cfr-s15-tts-"));
    mkdirSync(join(agentDir, "brain"), { recursive: true });
    mkdirSync(join(agentDir, "runtime"), { recursive: true });
    mkdirSync(join(agentDir, "automations"), { recursive: true });

    const capabilitiesDir = join(agentDir, "capabilities");
    const enabledFileAbs = join(capabilitiesDir, "tts-edge-tts", ".enabled");

    writeFileSync(
      join(agentDir, "CLAUDE.md"),
      `# CFR Fix Agent — Isolated Test Environment\n\n` +
      `**IMPORTANT: This is an isolated test environment. Do NOT modify files outside this directory.**\n\n` +
      `## Capabilities Location\n\n` +
      `The capabilities for THIS environment are at:\n` +
      `\`${capabilitiesDir}\`\n\n` +
      `Do NOT use the path \`.my_agent/capabilities/\` — that is the production system.\n\n` +
      `## Your Task\n\n` +
      `The \`tts-edge-tts\` capability is present but NOT enabled (symptom: not-enabled).\n` +
      `The \`.enabled\` marker file is missing. To fix it:\n\n` +
      `1. Create the file: \`${enabledFileAbs}\`\n` +
      `2. Run: \`touch "${enabledFileAbs}"\`\n` +
      `3. Verify: \`ls -la "${join(capabilitiesDir, "tts-edge-tts")}"\`\n` +
      `4. Write deliverable.md in your current run directory.\n\n` +
      `**Do NOT run synthesize.sh.** The orchestrator handles re-verification.\n` +
      `**Do NOT explore other directories.**\n`,
    );
    writeFileSync(
      join(agentDir, "brain", "AGENTS.md"),
      `# CFR Fix Agent\n\nRead CLAUDE.md for exact instructions. Create the .enabled file. Write deliverable.md.\n`,
    );

    // Copy tts-edge-tts WITHOUT .enabled (start enabled, then remove)
    cpSync(
      join(realAgentDir!, "capabilities", "tts-edge-tts"),
      join(capabilitiesDir, "tts-edge-tts"),
      { recursive: true },
    );
    // Remove .enabled to simulate the break
    const enabledPath = join(capabilitiesDir, "tts-edge-tts", ".enabled");
    if (existsSync(enabledPath)) fs.rmSync(enabledPath);

    const envPath = join(agentDir, ".env");
    const srcEnvPath = path.resolve(__dirname, "../../.env");
    if (existsSync(srcEnvPath)) fs.copyFileSync(srcEnvPath, envPath);
    else writeFileSync(envPath, "");

    registry = new CapabilityRegistry();
    registry.setProjectRoot(path.resolve(__dirname, "../../../.."));
    const caps = await scanCapabilities(capabilitiesDir, envPath);
    registry.load(caps);
    await registry.testAll();

    watcher = new CapabilityWatcher(capabilitiesDir, envPath, registry);
    await watcher.start();

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
      emitAck: async (_failure, kind) => {
        emittedAcks.push(kind);
        if (kind === "surrender" || kind === "surrender-budget") surrenderEmitted = true;
      },
      reprocessTurn: async () => {
        reprocessCalled = true; // Must NOT be called for TTS (RESTORED_TERMINAL)
      },
      now: () => new Date().toISOString(),
    });

    cfr.on("failure", (f) => {
      orchestrator.handle(f).catch((err) => {
        console.error("[S15-TTS] Orchestrator error:", err);
      });
    });
  }, 60_000);

  afterAll(async () => {
    await watcher.stop();
    conversationManager.close();
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("TTS recovers: attempt ack → fix → smoke reverify → terminal-fixed (no reprocess)", async () => {
    const enabledPath = join(agentDir, "capabilities", "tts-edge-tts", ".enabled");
    expect(existsSync(enabledPath)).toBe(false);

    // Emit CFR — simulates what capabilityInvoker fires after S15 TTS wiring
    cfr.emitFailure({
      capabilityType: "text-to-audio",
      capabilityName: "tts-edge-tts",
      symptom: "not-enabled",
      detail: "tts-edge-tts .enabled absent",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "dashboard", channelId: "dashboard", sender: "user" },
          TEST_CONV_ID,
          TEST_TURN,
        ),
        // No artifact — TTS has no retriable input
      },
    });

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      if (emittedAcks.includes("terminal-fixed") || surrenderEmitted) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // 1. Attempt ack fired
    expect(emittedAcks).toContain("attempt");

    // 2. Fix created .enabled
    expect(existsSync(enabledPath)).toBe(true);

    // 3. Registry updated to available
    const cap = registry.get("text-to-audio");
    expect(cap).toBeDefined();
    expect(cap!.status).toBe("available");

    // 4. Terminal-fixed ack (RESTORED_TERMINAL path — smoke passed)
    expect(emittedAcks).toContain("terminal-fixed");

    // 5. reprocessTurn NOT called (TTS has no retriable input)
    expect(reprocessCalled).toBe(false);

    // 6. No surrender
    expect(surrenderEmitted).toBe(false);
  }, 360_000);
});
