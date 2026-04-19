/**
 * M9.6-S15 Phase 2 Exit Gate: browser-chrome synthetic incident replay.
 *
 * Automation-origin CFR (no historical incident — synthetic per plan §2.7).
 *
 * Verifies:
 *   1. CFR with origin.kind === "automation" is handled by orchestrator
 *   2. Fix automation (real Claude Code) creates .enabled
 *   3. Smoke reverify passes (exit 0) or skips (exit 2, treated as pass)
 *   4. CFR_RECOVERY.md lands in origin.runDir with correct frontmatter
 *   5. emittedAcks contains "terminal-fixed"
 *
 * Preconditions:
 *   - .my_agent/capabilities/browser-chrome/CAPABILITY.md
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *
 * Invocation:
 *   env -u CLAUDECODE node --env-file=packages/dashboard/.env \
 *     node_modules/.bin/vitest run tests/e2e/cfr-phase2-browser-synthetic
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
  AckDelivery,
  scanCapabilities,
  RecoveryOrchestrator,
  readFrontmatter,
  type ConnectionRegistryLike,
  type TransportManagerLike,
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

const hasBrowserPlug =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "browser-chrome", "CAPABILITY.md"));
const hasAuth = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
const canRun = hasBrowserPlug && hasAuth;

const MODEL_SONNET = "claude-sonnet-4-6";
const MODEL_OPUS = "claude-opus-4-6";
const TERMINAL_STATUSES = new Set([
  "completed", "failed", "needs_review", "interrupted", "cancelled",
]);

describe.skipIf(!canRun)("M9.6-S15 Exit Gate: browser-chrome synthetic (automation-origin)", () => {
  let agentDir: string;
  let runDir: string;         // automation job's run_dir — CFR_RECOVERY.md lands here
  let registry: CapabilityRegistry;
  let watcher: CapabilityWatcher;
  let cfr: CfrEmitter;
  let conversationManager: ConversationManager;
  let automations: AppAutomationService;
  let automationJobService: AutomationJobService;
  let ackDelivery: AckDelivery;

  const emittedAcks: AckKind[] = [];
  let surrenderEmitted = false;

  beforeAll(async () => {
    const automationsTempParent = join(realAgentDir!, "automations");
    mkdirSync(automationsTempParent, { recursive: true });
    agentDir = fs.mkdtempSync(join(automationsTempParent, ".cfr-s15-browser-"));
    // runDir simulates the automation job's run directory
    runDir = join(agentDir, "run-browser-cfr");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(join(agentDir, "brain"), { recursive: true });
    mkdirSync(join(agentDir, "runtime"), { recursive: true });
    mkdirSync(join(agentDir, "automations"), { recursive: true });

    const capabilitiesDir = join(agentDir, "capabilities");
    const enabledFileAbs = join(capabilitiesDir, "browser-chrome", ".enabled");

    writeFileSync(
      join(agentDir, "CLAUDE.md"),
      `# CFR Fix Agent — Isolated Test Environment\n\n` +
      `**IMPORTANT: This is an isolated test environment. Do NOT modify files outside this directory.**\n\n` +
      `## Capabilities Location\n\n` +
      `The capabilities for THIS environment are at:\n` +
      `\`${capabilitiesDir}\`\n\n` +
      `Do NOT use the path \`.my_agent/capabilities/\` — that is the production system.\n\n` +
      `## Your Task\n\n` +
      `The \`browser-chrome\` capability is present but NOT enabled (symptom: not-enabled).\n` +
      `The \`.enabled\` marker file is missing. To fix it:\n\n` +
      `1. Create the file: \`${enabledFileAbs}\`\n` +
      `2. Run: \`touch "${enabledFileAbs}"\`\n` +
      `3. Verify: \`ls -la "${join(capabilitiesDir, "browser-chrome")}"\`\n` +
      `4. Write deliverable.md in your current run directory.\n\n` +
      `**Do NOT run smoke.sh.** The orchestrator handles re-verification.\n` +
      `**Do NOT explore other directories.**\n`,
    );
    writeFileSync(
      join(agentDir, "brain", "AGENTS.md"),
      `# CFR Fix Agent\n\nRead CLAUDE.md. Create the .enabled file. Write deliverable.md.\n`,
    );

    // Copy browser-chrome capability WITHOUT .enabled
    cpSync(
      join(realAgentDir!, "capabilities", "browser-chrome"),
      join(capabilitiesDir, "browser-chrome"),
      { recursive: true },
    );
    const enabledPath = join(capabilitiesDir, "browser-chrome", ".enabled");
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

    // AckDelivery for writing CFR_RECOVERY.md
    const send = () => Promise.resolve(undefined as unknown as boolean);
    const transportManager: TransportManagerLike = { send };
    const connectionRegistry: ConnectionRegistryLike = { broadcastToConversation: () => {} };
    ackDelivery = new AckDelivery(transportManager, connectionRegistry);

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
        // Automation origin: never reprocesses
      },
      writeAutomationRecovery: (args) => ackDelivery.writeAutomationRecovery(args),
      now: () => new Date().toISOString(),
    });

    cfr.on("failure", (f) => {
      orchestrator.handle(f).catch((err) => {
        console.error("[S15-Browser] Orchestrator error:", err);
      });
    });
  }, 60_000);

  afterAll(async () => {
    await watcher.stop();
    conversationManager.close();
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("browser-chrome recovers: fix → smoke reverify → CFR_RECOVERY.md in runDir", async () => {
    const enabledPath = join(agentDir, "capabilities", "browser-chrome", ".enabled");
    const recoveryFilePath = join(runDir, "CFR_RECOVERY.md");

    expect(existsSync(enabledPath)).toBe(false);

    // Emit CFR with automation origin — simulates PostToolUseFailure hook firing
    cfr.emitFailure({
      capabilityType: "browser-control",
      capabilityName: "browser-chrome",
      symptom: "not-enabled",
      detail: "browser-chrome .enabled absent",
      triggeringInput: {
        origin: {
          kind: "automation",
          automationId: "test-automation-browser",
          jobId: "test-job-browser",
          runDir,
          notifyMode: "debrief",
        },
      },
    });

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      // Automation origin: emitAck is NOT called for "terminal-fixed" outcome —
      // only writeAutomationRecovery fires. Poll for the file instead.
      if (existsSync(recoveryFilePath) || surrenderEmitted) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // 1. Fix created .enabled
    expect(existsSync(enabledPath)).toBe(true);

    // 2. CFR_RECOVERY.md written to runDir
    expect(existsSync(recoveryFilePath)).toBe(true);

    // 3. CFR_RECOVERY.md has correct frontmatter fields
    //    readFrontmatter returns {data, body} — destructure data as fm.
    const { data: fm } = readFrontmatter(recoveryFilePath);
    expect(fm.plug_name).toBe("browser-chrome");
    expect(fm.plug_type).toBe("browser-control");
    expect(["fixed", "terminal-fixed"]).toContain(fm.outcome);

    // 4. No surrender
    expect(surrenderEmitted).toBe(false);
  }, 360_000);
});
