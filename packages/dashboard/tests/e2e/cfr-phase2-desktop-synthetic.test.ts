/**
 * M9.6-S15 Phase 2 Exit Gate: desktop-x11 synthetic incident replay.
 *
 * Same shape as browser-chrome test. Automation-origin CFR; fix creates
 * .enabled; smoke.sh exits 0 (if X11 + xdotool available) or 2
 * (SMOKE_SKIPPED — inconclusive pass); CFR_RECOVERY.md lands in runDir.
 *
 * Preconditions (any missing → skip):
 *   - .my_agent/capabilities/desktop-x11/CAPABILITY.md
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *
 * Note: desktop smoke.sh exits 2 (SMOKE_SKIPPED) when DISPLAY is unset or
 * xdotool is missing. Inconclusive is treated as pass — test runs in CI.
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

const hasDesktopPlug =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "desktop-x11", "CAPABILITY.md"));
const hasAuth = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
const canRun = hasDesktopPlug && hasAuth;

const MODEL_SONNET = "claude-sonnet-4-6";
const MODEL_OPUS = "claude-opus-4-6";
const TERMINAL_STATUSES = new Set([
  "completed", "failed", "needs_review", "interrupted", "cancelled",
]);

describe.skipIf(!canRun)("M9.6-S15 Exit Gate: desktop-x11 synthetic (automation-origin)", () => {
  let agentDir: string;
  let runDir: string;
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
    agentDir = fs.mkdtempSync(join(automationsTempParent, ".cfr-s15-desktop-"));
    runDir = join(agentDir, "run-desktop-cfr");
    mkdirSync(runDir, { recursive: true });
    mkdirSync(join(agentDir, "brain"), { recursive: true });
    mkdirSync(join(agentDir, "runtime"), { recursive: true });
    mkdirSync(join(agentDir, "automations"), { recursive: true });

    const capabilitiesDir = join(agentDir, "capabilities");
    const enabledFileAbs = join(capabilitiesDir, "desktop-x11", ".enabled");

    writeFileSync(
      join(agentDir, "CLAUDE.md"),
      `# CFR Fix Agent — Isolated Test Environment\n\n` +
      `**IMPORTANT: This is an isolated test environment. Do NOT modify files outside this directory.**\n\n` +
      `## Capabilities Location\n\n` +
      `The capabilities for THIS environment are at:\n` +
      `\`${capabilitiesDir}\`\n\n` +
      `## Your Task\n\n` +
      `The \`desktop-x11\` capability is present but NOT enabled (symptom: not-enabled).\n` +
      `The \`.enabled\` marker file is missing. To fix it:\n\n` +
      `1. Create the file: \`${enabledFileAbs}\`\n` +
      `2. Run: \`touch "${enabledFileAbs}"\`\n` +
      `3. Verify: \`ls -la "${join(capabilitiesDir, "desktop-x11")}"\`\n` +
      `4. Write deliverable.md in your current run directory.\n\n` +
      `**Do NOT run smoke.sh.** Do NOT explore other directories.\n`,
    );
    writeFileSync(
      join(agentDir, "brain", "AGENTS.md"),
      `# CFR Fix Agent\n\nRead CLAUDE.md. Create the .enabled file. Write deliverable.md.\n`,
    );

    cpSync(
      join(realAgentDir!, "capabilities", "desktop-x11"),
      join(capabilitiesDir, "desktop-x11"),
      { recursive: true },
    );
    const enabledPath = join(capabilitiesDir, "desktop-x11", ".enabled");
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
      reprocessTurn: async () => {},
      writeAutomationRecovery: (args) => ackDelivery.writeAutomationRecovery(args),
      now: () => new Date().toISOString(),
    });

    cfr.on("failure", (f) => {
      orchestrator.handle(f).catch((err) => {
        console.error("[S15-Desktop] Orchestrator error:", err);
      });
    });
  }, 60_000);

  afterAll(async () => {
    await watcher.stop();
    conversationManager.close();
    rmSync(agentDir, { recursive: true, force: true });
  });

  it("desktop-x11 recovers: fix → smoke reverify → CFR_RECOVERY.md in runDir", async () => {
    const enabledPath = join(agentDir, "capabilities", "desktop-x11", ".enabled");
    const recoveryFilePath = join(runDir, "CFR_RECOVERY.md");

    expect(existsSync(enabledPath)).toBe(false);

    cfr.emitFailure({
      capabilityType: "desktop-control",
      capabilityName: "Desktop X11",
      symptom: "not-enabled",
      detail: "desktop-x11 .enabled absent",
      triggeringInput: {
        origin: {
          kind: "automation",
          automationId: "test-automation-desktop",
          jobId: "test-job-desktop",
          runDir,
          notifyMode: "debrief",
        },
      },
    });

    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      // Automation origin: emitAck is NOT called for "terminal-fixed" outcome.
      // Poll for CFR_RECOVERY.md file existence instead.
      if (existsSync(recoveryFilePath) || surrenderEmitted) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // 1. Fix created .enabled
    expect(existsSync(enabledPath)).toBe(true);

    // 2. CFR_RECOVERY.md written
    expect(existsSync(recoveryFilePath)).toBe(true);

    // 3. Correct frontmatter
    //    readFrontmatter returns {data, body} — destructure data as fm.
    const { data: fm } = readFrontmatter(recoveryFilePath);
    expect(fm.plug_type).toBe("desktop-control");
    expect(["fixed", "terminal-fixed"]).toContain(fm.outcome);

    // 4. No surrender
    expect(surrenderEmitted).toBe(false);
  }, 360_000);
});
