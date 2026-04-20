/**
 * Shared helpers for M9.6-S20 exit-gate E2E tests.
 * Extracted from cfr-phase2-* test files (S15 architect §3 deferral).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { join } from "node:path";

import {
  CapabilityRegistry,
  CapabilityWatcher,
  CapabilityInvoker,
  CfrEmitter,
  AckDelivery,
  scanCapabilities,
  RecoveryOrchestrator,
  readFrontmatter,
  parseFrontmatterContent,
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

// ─── Auto-load packages/dashboard/.env if auth vars are missing ──────────────
// BUG-5 (M9.6-S21): exit-gate tests used to skip with "canRun=false" whenever
// the invoker forgot to pass `node --env-file=packages/dashboard/.env` to
// vitest. The `.env` file is the dashboard's canonical secret store; if it
// exists and the auth vars aren't already set, load it in-process so the
// precondition check below sees the key.
function ensureDashboardEnvLoaded(): void {
  if (
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN
  ) {
    return;
  }
  const envPath = path.resolve(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Don't clobber values that were explicitly set in the real env.
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
ensureDashboardEnvLoaded();

export const MODEL_SONNET = "claude-sonnet-4-6";
export const MODEL_OPUS = "claude-opus-4-6";

export const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "needs_review",
  "interrupted",
  "cancelled",
]);

// ─── Agent dir discovery ──────────────────────────────────────────────────────

export function findAgentDir(): string | null {
  const candidate = path.resolve(__dirname, "../../../..", ".my_agent");
  return fs.existsSync(candidate) ? candidate : null;
}

export const realAgentDir = findAgentDir();

export const hasAuth = !!(
  process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN
);

// ─── Isolated test agentDir setup ────────────────────────────────────────────

export interface IsolatedAgentDir {
  agentDir: string;
  capabilitiesDir: string;
  envPath: string;
}

/**
 * Create an isolated agentDir inside `.my_agent/automations/` so Claude Code
 * finds the project CLAUDE.md. Caller is responsible for cleanup (rmSync).
 */
export function makeIsolatedAgentDir(prefix: string): IsolatedAgentDir {
  if (!realAgentDir) throw new Error("realAgentDir not found");
  const automationsTempParent = join(realAgentDir, "automations");
  mkdirSync(automationsTempParent, { recursive: true });
  const agentDir = fs.mkdtempSync(join(automationsTempParent, prefix));
  mkdirSync(join(agentDir, "brain"), { recursive: true });
  mkdirSync(join(agentDir, "runtime"), { recursive: true });
  mkdirSync(join(agentDir, "automations"), { recursive: true });

  const capabilitiesDir = join(agentDir, "capabilities");
  const envPath = join(agentDir, ".env");

  // Copy .env for API keys (DEEPGRAM_API_KEY, etc.)
  const srcEnvPath = path.resolve(__dirname, "../../.env");
  if (existsSync(srcEnvPath)) fs.copyFileSync(srcEnvPath, envPath);
  else writeFileSync(envPath, "");

  return { agentDir, capabilitiesDir, envPath };
}

/**
 * Write a standard CFR fix-agent CLAUDE.md that scopes the agent to the
 * isolated test environment.
 */
export function writeCfrFixClaude(
  agentDir: string,
  capabilitiesDir: string,
  capabilityName: string,
  enabledFileAbs: string,
  extraInstructions?: string,
): void {
  writeFileSync(
    join(agentDir, "CLAUDE.md"),
    `# CFR Fix Agent — Isolated Test Environment\n\n` +
      `**IMPORTANT: This is an isolated test environment. Do NOT modify files outside this directory.**\n\n` +
      `## Capabilities Location\n\n` +
      `The capabilities for THIS environment are at:\n` +
      `\`${capabilitiesDir}\`\n\n` +
      `Do NOT use the path \`.my_agent/capabilities/\` — that is the production system.\n\n` +
      `## Your Task\n\n` +
      `The \`${capabilityName}\` capability is present but NOT enabled (symptom: not-enabled).\n` +
      `The \`.enabled\` marker file is missing. To fix it:\n\n` +
      `1. Create the file: \`${enabledFileAbs}\`\n` +
      `2. Run: \`touch "${enabledFileAbs}"\`\n` +
      `3. Verify: \`ls -la "${path.dirname(enabledFileAbs)}"\`\n` +
      `4. Write deliverable.md in your current run directory.\n\n` +
      `**Do NOT run smoke.sh.** The orchestrator handles re-verification.\n` +
      `**Do NOT explore other directories.**\n` +
      (extraInstructions ?? ""),
  );
  writeFileSync(
    join(agentDir, "brain", "AGENTS.md"),
    `# CFR Fix Agent\n\nRead CLAUDE.md. Create the .enabled file. Write deliverable.md.\n`,
  );
}

/**
 * Copy a capability from realAgentDir into isolated capabilitiesDir,
 * removing .enabled so the capability starts in "not-enabled" state.
 */
export function copyCapabilityWithoutEnabled(
  capabilityName: string,
  capabilitiesDir: string,
): string {
  if (!realAgentDir) throw new Error("realAgentDir not found");
  cpSync(
    join(realAgentDir, "capabilities", capabilityName),
    join(capabilitiesDir, capabilityName),
    { recursive: true },
  );
  const enabledPath = join(capabilitiesDir, capabilityName, ".enabled");
  if (existsSync(enabledPath)) fs.rmSync(enabledPath);
  return enabledPath;
}

// ─── Capability stack setup ───────────────────────────────────────────────────

export interface CapabilityStack {
  registry: CapabilityRegistry;
  watcher: CapabilityWatcher;
}

export async function makeCapabilityStack(
  capabilitiesDir: string,
  envPath: string,
): Promise<CapabilityStack> {
  const registry = new CapabilityRegistry();
  registry.setProjectRoot(path.resolve(__dirname, "../../../.."));
  const caps = await scanCapabilities(capabilitiesDir, envPath);
  registry.load(caps);
  await registry.testAll();

  const watcher = new CapabilityWatcher(capabilitiesDir, envPath, registry);
  await watcher.start();

  return { registry, watcher };
}

// ─── Automation stack setup ───────────────────────────────────────────────────

export interface AutomationStack {
  automations: AppAutomationService;
  automationJobService: AutomationJobService;
  conversationManager: ConversationManager;
}

export function makeAutomationStack(agentDir: string): AutomationStack {
  const conversationManager = new ConversationManager(agentDir);
  const db = conversationManager.getConversationDb();
  const automationsDir = join(agentDir, "automations");

  const automationManager = new AutomationManager(automationsDir, db);
  const automationJobService = new AutomationJobService(automationsDir, db);
  const automationExecutor = new AutomationExecutor({
    automationManager,
    jobService: automationJobService,
    agentDir,
    db,
    capabilityRegistry: null as any,
  });
  const automationProcessor = new AutomationProcessor({
    automationManager,
    executor: automationExecutor,
    jobService: automationJobService,
    agentDir,
    onJobEvent: () => {},
  });
  const fakeApp = Object.assign({ emit: () => false } as any, {});
  const automations = new AppAutomationService(
    automationManager,
    automationProcessor,
    automationJobService,
    fakeApp,
  );

  return { automations, automationJobService, conversationManager };
}

// ─── Orchestrator setup ───────────────────────────────────────────────────────

export interface OrchestratorCallbacks {
  emittedAcks: AckKind[];
  surrenderEmitted: boolean;
  reprocessCalledWith: string | null;
}

export function makeOrchestrator(
  registry: CapabilityStack["registry"],
  watcher: CapabilityStack["watcher"],
  automations: AppAutomationService,
  automationJobService: AutomationJobService,
  callbacks: OrchestratorCallbacks,
  ackDelivery: AckDelivery,
  invoker?: CapabilityInvoker,
): RecoveryOrchestrator {
  return new RecoveryOrchestrator({
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
    invoker,
    emitAck: async (_failure, kind) => {
      callbacks.emittedAcks.push(kind);
      if (kind === "surrender" || kind === "surrender-budget")
        callbacks.surrenderEmitted = true;
    },
    reprocessTurn: async (_failure, recoveredContent) => {
      callbacks.reprocessCalledWith = recoveredContent ?? null;
    },
    writeAutomationRecovery: (args) => ackDelivery.writeAutomationRecovery(args),
    now: () => new Date().toISOString(),
  });
}

/**
 * Create a CapabilityInvoker suitable for E2E tests.
 * originFactory is never called during reverification (only on failure paths).
 */
export function makeTestInvoker(cfr: CfrEmitter, registry: CapabilityRegistry): CapabilityInvoker {
  return new CapabilityInvoker({
    cfr,
    registry,
    originFactory: () => {
      throw new Error("[makeTestInvoker] originFactory called unexpectedly in test");
    },
  });
}

// ─── MockTransport ────────────────────────────────────────────────────────────

export interface RecordedSend {
  transportId: string;
  to: string;
  content: string;
  replyTo?: string;
}

/** Records all transport.send() calls — use for asserting ack and reply delivery. */
export class MockTransport implements TransportManagerLike {
  readonly sends: RecordedSend[] = [];

  send(
    transportId: string,
    to: string,
    message: { content: string; replyTo?: string },
  ): Promise<void> {
    this.sends.push({ transportId, to, content: message.content, replyTo: message.replyTo });
    return Promise.resolve();
  }
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

export function assertCfrRecovery(
  recoveryFilePath: string,
  expectedPlugName: string,
  expectedPlugType: string,
): void {
  const { data: fm } = readFrontmatter(recoveryFilePath);
  if (fm.plug_name !== expectedPlugName)
    throw new Error(`Expected plug_name "${expectedPlugName}", got "${fm.plug_name}"`);
  if (fm.plug_type !== expectedPlugType)
    throw new Error(`Expected plug_type "${expectedPlugType}", got "${fm.plug_type}"`);
  if (!["fixed", "terminal-fixed"].includes(String(fm.outcome)))
    throw new Error(`Expected outcome fixed/terminal-fixed, got "${fm.outcome}"`);
}

/**
 * Assert that deliverable.md in runDir follows the S20 terse contract:
 * body ≤ 5 lines, each matching "Attempt N: ..." format.
 */
export function assertTerseDeliverable(
  runDir: string,
  { expectForensic = true }: { expectForensic?: boolean } = {},
): void {
  const delivPath = join(runDir, "deliverable.md");
  if (!existsSync(delivPath))
    throw new Error(`deliverable.md not found in ${runDir}`);
  const raw = fs.readFileSync(delivPath, "utf-8");
  const { body } = parseFrontmatterContent(raw);
  const nonEmptyLines = body.split("\n").filter((l: string) => l.trim().length > 0);
  if (nonEmptyLines.length > 5)
    throw new Error(
      `deliverable.md body has ${nonEmptyLines.length} non-empty lines (max 5). Lines:\n${nonEmptyLines.join("\n")}`,
    );
  if (expectForensic && !existsSync(join(runDir, "forensic.md")))
    throw new Error(`forensic.md not found in ${runDir} (expected per S20 terse contract)`);
}

// ─── Polling helpers ──────────────────────────────────────────────────────────

/**
 * Wait for `recoveryFilePath` to appear (automation-origin test) or for
 * `surrenderEmitted` to be set, up to `timeoutMs`.
 */
export async function waitForAutomationRecovery(
  recoveryFilePath: string,
  callbacks: OrchestratorCallbacks,
  timeoutMs = 300_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(recoveryFilePath) || callbacks.surrenderEmitted) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * Wait for orchestrator to reach a terminal ack kind (fixed or surrender),
 * up to `timeoutMs`.
 */
export async function waitForConversationRecovery(
  callbacks: OrchestratorCallbacks,
  timeoutMs = 300_000,
): Promise<void> {
  // STT recovery calls reprocessTurn (no terminal ack emitted); TTS/other call emitAck("terminal-fixed").
  const TERMINAL_ACKS = new Set(["terminal-fixed", "surrender", "surrender-budget"]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (callbacks.emittedAcks.some((k) => TERMINAL_ACKS.has(k))) return;
    if (callbacks.reprocessCalledWith !== null) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
