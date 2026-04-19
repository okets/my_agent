# M9.6-S15 Phase 2 Exit Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End-to-end incident-replay test for every installed plug type — STT, TTS, browser-control, desktop-control. Phase 2 closes here; M10 unblocks.

**Architecture:** Four new E2E tests plus one code change. The code change (Task 1) wires TTS failures through `CapabilityInvoker` so CFR fires automatically. The E2E tests (Tasks 2–5) emit CFR directly — the same "simulate what the invoker would fire" pattern used by the existing S7 exit gate — then drive the full recovery loop with a real Claude Code fix automation. All four tests follow the same scaffolding pattern established in `tests/e2e/cfr-incident-replay.test.ts`.

**Tech Stack:** Vitest · TypeScript · `@my-agent/core` (CfrEmitter, RecoveryOrchestrator, AckDelivery, conversationOrigin, scanCapabilities) · AutomationExecutor (real Claude Code subprocess) · Bash (smoke.sh)

**Design ref:** `docs/sprints/m9.6-capability-resilience/plan-phase2-coverage.md` §2.7

**Branch:** `sprint/m9.6-s15-phase2-exit-gate`

---

## Pre-read (before any code)

- `plan-phase2-coverage.md §2.7` — defines each test's acceptance criteria
- `tests/e2e/cfr-incident-replay.test.ts` — the pattern every new E2E test follows
- `tests/integration/cfr-automation-mcp.test.ts` — automation-origin assembly pattern
- `packages/core/src/capabilities/ack-delivery.ts` — `writeAutomationRecovery()` shape
- `packages/core/src/capabilities/recovery-orchestrator.ts:35` — `AckKind` union

**The `agentDir` must live inside `.my_agent/automations/`** — same critical requirement as the S7 test (Claude Code subprocess walks up from job run_dir to find the project CLAUDE.md; temp dirs in `/tmp/` don't work).

---

## File Map

| Action | Path |
|---|---|
| Modify | `packages/core/src/capabilities/reverify.ts` |
| Modify | `packages/dashboard/src/chat/chat-service.ts` |
| Create | `packages/dashboard/tests/e2e/cfr-phase2-stt-replay.test.ts` |
| Create | `packages/dashboard/tests/e2e/cfr-phase2-tts-replay.test.ts` |
| Create | `packages/dashboard/tests/e2e/cfr-phase2-browser-synthetic.test.ts` |
| Create | `packages/dashboard/tests/e2e/cfr-phase2-desktop-synthetic.test.ts` |
| Modify | `.my_agent/capabilities/stt-deepgram/CAPABILITY.md` |
| Modify | `.my_agent/capabilities/tts-edge-tts/CAPABILITY.md` |
| Modify | `.my_agent/capabilities/browser-chrome/CAPABILITY.md` |
| Modify | `.my_agent/capabilities/desktop-x11/CAPABILITY.md` |
| Create | `docs/sprints/m9.6-capability-resilience/s15-DECISIONS.md` |
| Create | `docs/sprints/m9.6-capability-resilience/s15-DEVIATIONS.md` |
| Create | `docs/sprints/m9.6-capability-resilience/s15-FOLLOW-UPS.md` |
| Create | `docs/sprints/m9.6-capability-resilience/s15-test-report.md` |

---

## Task 0 — Pre-flight: backfill `multi_instance` frontmatter

**Files:** `.my_agent/capabilities/*/CAPABILITY.md` (4 edits)

- [ ] **Step 0.1 — Add `multi_instance: false` to stt-deepgram CAPABILITY.md**

  Open `.my_agent/capabilities/stt-deepgram/CAPABILITY.md`. The frontmatter block currently is:
  ```yaml
  ---
  name: Deepgram STT
  provides: audio-to-text
  interface: script
  requires:
    env:
      - DEEPGRAM_API_KEY
  ---
  ```
  Change to:
  ```yaml
  ---
  name: Deepgram STT
  provides: audio-to-text
  interface: script
  multi_instance: false
  requires:
    env:
      - DEEPGRAM_API_KEY
  ---
  ```

- [ ] **Step 0.2 — Add `multi_instance: false` to tts-edge-tts CAPABILITY.md**

  Open `.my_agent/capabilities/tts-edge-tts/CAPABILITY.md`. The frontmatter currently is:
  ```yaml
  ---
  name: Edge TTS
  provides: text-to-audio
  interface: script
  ---
  ```
  Change to:
  ```yaml
  ---
  name: Edge TTS
  provides: text-to-audio
  interface: script
  multi_instance: false
  ---
  ```

- [ ] **Step 0.3 — Add `multi_instance: true` to browser-chrome CAPABILITY.md**

  Open `.my_agent/capabilities/browser-chrome/CAPABILITY.md`. The frontmatter currently is:
  ```yaml
  ---
  name: browser-chrome
  provides: browser-control
  interface: mcp
  entrypoint: npx tsx src/server.ts
  icon: googlechrome
  requires:
    system:
      - npx
  ---
  ```
  Change to:
  ```yaml
  ---
  name: browser-chrome
  provides: browser-control
  interface: mcp
  multi_instance: true
  entrypoint: npx tsx src/server.ts
  icon: googlechrome
  requires:
    system:
      - npx
  ---
  ```

- [ ] **Step 0.4 — Add `multi_instance: false` to desktop-x11 CAPABILITY.md**

  Open `.my_agent/capabilities/desktop-x11/CAPABILITY.md`. The frontmatter currently is:
  ```yaml
  ---
  name: Desktop X11
  provides: desktop-control
  interface: mcp
  entrypoint: npx tsx src/server.ts
  requires:
    system:
      - xdotool
      - maim
  ---
  ```
  Change to:
  ```yaml
  ---
  name: Desktop X11
  provides: desktop-control
  interface: mcp
  multi_instance: false
  entrypoint: npx tsx src/server.ts
  requires:
    system:
      - xdotool
      - maim
  ---
  ```

- [ ] **Step 0.5 — Verify**

  Run:
  ```bash
  grep -r "multi_instance:" .my_agent/capabilities/*/CAPABILITY.md
  ```

  Expected output (all four files listed, each with their value):
  ```
  .my_agent/capabilities/browser-chrome/CAPABILITY.md:multi_instance: true
  .my_agent/capabilities/desktop-x11/CAPABILITY.md:multi_instance: false
  .my_agent/capabilities/stt-deepgram/CAPABILITY.md:multi_instance: false
  .my_agent/capabilities/tts-edge-tts/CAPABILITY.md:multi_instance: false
  ```

- [ ] **Step 0.6 — Commit**

  ```bash
  git add .my_agent/capabilities/stt-deepgram/CAPABILITY.md \
          .my_agent/capabilities/tts-edge-tts/CAPABILITY.md \
          .my_agent/capabilities/browser-chrome/CAPABILITY.md \
          .my_agent/capabilities/desktop-x11/CAPABILITY.md
  git commit -m "fix(m9.6-s15): backfill multi_instance frontmatter into installed plugs (FU-2 from S14)"
  ```

---

## Task 1 — Wire TTS CFR detection in `synthesizeAudio`

**Files:**
- Modify: `packages/dashboard/src/chat/chat-service.ts` (3 sites: method signature + 2 callers)

**Context:** `synthesizeAudio` currently calls `execFile` directly and swallows errors silently — TTS failures never emit CFR. The plan (§2.2, `// TODO(S15/S18)` comment at line 1095) anticipated wiring this in S15. The fix: add a `triggeringInput` parameter and route through `this.app.capabilityInvoker.run()` when the invoker is present. Keep a silent fallback for test contexts where the invoker is not wired.

- [ ] **Step 1.1 — Rewrite `synthesizeAudio` signature and body**

  In `packages/dashboard/src/chat/chat-service.ts`, find the `synthesizeAudio` method (currently at line ~1099). Replace the entire method with:

  ```typescript
  /**
   * Synthesize audio via the TTS capability script.
   * Returns the audio URL path or null.
   *
   * Routed through CapabilityInvoker (M9.6-S15) so TTS failures emit CFR
   * automatically. Falls back to silent null return when capabilityInvoker
   * is not wired (unit tests, hatching). S18 (Phase 3 "Duplicate TTS path
   * collapse") will formalize the full authoritative path.
   */
  private async synthesizeAudio(
    text: string,
    conversationId: string,
    triggeringInput: TriggeringInput,
    language?: string,
  ): Promise<string | null> {
    const audioDir = join(this.app.agentDir, "audio");
    mkdirSync(audioDir, { recursive: true });
    const outputFile = join(audioDir, `tts-${randomUUID()}.ogg`);

    const spokenText = prepareForSpeech(text);
    if (!spokenText.trim()) return null;

    const args = [spokenText, outputFile];
    if (language) args.push(language);

    if (this.app.capabilityInvoker) {
      const result = await this.app.capabilityInvoker.run({
        capabilityType: "text-to-audio",
        scriptName: "synthesize.sh",
        args,
        triggeringInput,
        timeoutMs: 30_000,
      });
      if (result.kind === "failure") return null;
      return `/api/assets/audio/${outputFile.split("/").pop()}`;
    }

    // No invoker: silent fallback (unit tests without capability wiring, hatching).
    const cap = this.app.capabilityRegistry?.get("text-to-audio");
    if (!cap || cap.status !== "available") return null;
    const scriptPath = join(cap.path, "scripts", "synthesize.sh");
    try {
      const execFileAsync = promisify(execFile);
      await execFileAsync(scriptPath, args, { timeout: 30_000 });
      return `/api/assets/audio/${outputFile.split("/").pop()}`;
    } catch {
      return null;
    }
  }
  ```

- [ ] **Step 1.2 — Update caller 1: split-turn TTS (around line 854)**

  Find the block that looks like:
  ```typescript
  // TTS for split turn if input was voice
  let splitAudioUrl: string | undefined;
  if (isAudioInput && assistantContent.trim()) {
    splitAudioUrl =
      (await this.synthesizeAudio(
        assistantContent,
        convId,
        detectedLanguage,
      )) ?? undefined;
  }
  ```
  Change to:
  ```typescript
  // TTS for split turn if input was voice
  let splitAudioUrl: string | undefined;
  if (isAudioInput && assistantContent.trim()) {
    splitAudioUrl =
      (await this.synthesizeAudio(
        assistantContent,
        convId,
        buildTriggeringInput(options, convId, turnNumber),
        detectedLanguage,
      )) ?? undefined;
  }
  ```

- [ ] **Step 1.3 — Update caller 2: final-turn TTS (around line 885)**

  Find the block that looks like:
  ```typescript
  // TTS: synthesize audio response if input was voice + TTS available
  let audioUrl: string | undefined;
  if (isAudioInput && assistantContent.trim()) {
    audioUrl =
      (await this.synthesizeAudio(
        assistantContent,
        convId,
        detectedLanguage,
      )) ?? undefined;
  }
  ```
  Change to:
  ```typescript
  // TTS: synthesize audio response if input was voice + TTS available
  let audioUrl: string | undefined;
  if (isAudioInput && assistantContent.trim()) {
    audioUrl =
      (await this.synthesizeAudio(
        assistantContent,
        convId,
        buildTriggeringInput(options, convId, turnNumber),
        detectedLanguage,
      )) ?? undefined;
  }
  ```

- [ ] **Step 1.4 — Typecheck**

  ```bash
  cd packages/dashboard && npx tsc --noEmit
  ```

  Expected: exit 0, no errors. If TypeScript complains that `buildTriggeringInput` is not in scope at the call sites, confirm it is defined as a top-level function at the top of `chat-service.ts` (line ~128). It takes `(options: ChatMessageOptions | undefined, convId: string, turnNumber: number, audioAttachment?): TriggeringInput` — no changes needed there.

- [ ] **Step 1.5 — Regression: existing chat tests still pass**

  ```bash
  cd packages/dashboard && npx vitest run tests/integration/chat-service
  ```

  Expected: all existing tests pass. The fallback path (no invoker) means tests that don't wire `capabilityInvoker` continue to work unchanged.

- [ ] **Step 1.6 — Commit**

  ```bash
  git add packages/dashboard/src/chat/chat-service.ts
  git commit -m "feat(m9.6-s15): wire TTS failures through CapabilityInvoker (synthesizeAudio → CFR detection)"
  ```

---

## Task 1.5 — Fix `reverifyTextToAudio` CLI arg contract (pre-existing S13 bug)

**File:** `packages/core/src/capabilities/reverify.ts` (1 edit, ~line 84)

**Context:** `reverifyTextToAudio` passes `[outputPath]` as the only positional arg to `synthesize.sh`, while the real `tts-edge-tts/scripts/synthesize.sh` requires `<text> <output-path>` (it exits 1 if `$# -lt 2`). S13's unit tests passed because they mocked the script. Against the real plug, TTS reverification always fails, forcing surrender instead of `RESTORED_TERMINAL`. Fix: pass the fixture phrase as arg 1, `outputPath` as arg 2. Remove the unused `TTS_REVERIFY_PHRASE` env var.

**Why here (not in S13):** This bug is only observable when running against the real installed plug — exactly what the Phase 2 exit gate does. Fixing it now is part of the exit gate's pre-condition work.

- [ ] **Step 1.5.1 — Fix the arg contract**

  In `packages/core/src/capabilities/reverify.ts`, find the `execFileAsync` call inside `reverifyTextToAudio` (around line 84):

  ```typescript
  await execFileAsync(scriptPath, [outputPath], {
    timeout: 30_000,
    cwd: cap.path,
    env: { ...process.env, TTS_REVERIFY_PHRASE: "This is a smoke test." },
  });
  ```

  Change to:

  ```typescript
  await execFileAsync(scriptPath, ["This is a smoke test.", outputPath], {
    timeout: 30_000,
    cwd: cap.path,
    env: { ...process.env },
  });
  ```

- [ ] **Step 1.5.2 — Typecheck core**

  ```bash
  cd packages/core && npx tsc --noEmit
  ```

  Expected: exit 0.

- [ ] **Step 1.5.3 — Run capabilities regression**

  ```bash
  cd packages/core && npx vitest run tests/capabilities
  ```

  Expected: all pass. The existing `reverifyTextToAudio` unit tests mock the script execution — they should still pass. If any test uses `TTS_REVERIFY_PHRASE` as a fixture, update it to `args[0] === "This is a smoke test."`.

- [ ] **Step 1.5.4 — Commit**

  ```bash
  git add packages/core/src/capabilities/reverify.ts
  git commit -m "fix(m9.6-s15): reverifyTextToAudio — pass text as arg 1 instead of env var (synthesize.sh requires \$# >= 2)"
  ```

---

## Task 2 — STT Phase 2 E2E test

**File:** `packages/dashboard/tests/e2e/cfr-phase2-stt-replay.test.ts` (new)

This test is a Phase 2 clone of the S7 exit gate (`cfr-incident-replay.test.ts`). Key differences from S7:
- Asserts the emitted CFR has `origin.kind === "conversation"` (v2 TriggeringOrigin discriminated union)
- Asserts the friendly-name ack copy contains "voice transcription" (S14 friendly names)
- Asserts the fix run produces `RESTORED_WITH_REPROCESS` (reprocessTurn called with transcript)

Skip conditions (any missing → skip entire suite):
- `packages/core/tests/fixtures/cfr/.local/voice-1-incident.ogg` — incident audio file
- `.my_agent/capabilities/stt-deepgram/CAPABILITY.md` — STT plug installed
- `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` — Claude Code auth
- `DEEPGRAM_API_KEY` — Deepgram API key for transcription

- [ ] **Step 2.1 — Write the test file**

  Create `packages/dashboard/tests/e2e/cfr-phase2-stt-replay.test.ts`:

  ```typescript
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
  ```

- [ ] **Step 2.2 — Run the test (skip guard will fire if audio/auth missing)**

  ```bash
  cd packages/dashboard
  env -u CLAUDECODE node --env-file=.env node_modules/.bin/vitest run tests/e2e/cfr-phase2-stt-replay
  ```

  **If skip guard fires** (audio fixture or auth missing): note which precondition is missing in `s15-DECISIONS.md` and continue. The S7 test at `tests/e2e/cfr-incident-replay` verifies the same recovery path; this test adds the v2-origin assertion.

  **If it runs:** expected output — `1 passed` (may take up to 6 minutes). Any failure: read the `[S15-STT]` log lines to find which step failed.

- [ ] **Step 2.3 — Commit**

  ```bash
  git add packages/dashboard/tests/e2e/cfr-phase2-stt-replay.test.ts
  git commit -m "test(m9.6-s15): STT Phase 2 exit gate — real-incident replay with v2 origin assertions"
  ```

---

## Task 3 — TTS Phase 2 E2E test

**File:** `packages/dashboard/tests/e2e/cfr-phase2-tts-replay.test.ts` (new)

TTS recovery ends in `RESTORED_TERMINAL` (no reprocess). The test emits CFR with `capabilityType: "text-to-audio"`, expects the orchestrator to spawn a fix automation, smoke-reverify, and emit `"terminal-fixed"` ack.

**Break mechanism:** remove `.enabled` from `tts-edge-tts` (same pattern as STT).

Skip conditions (any missing → skip):
- `.my_agent/capabilities/tts-edge-tts/CAPABILITY.md`
- `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`
- `tts-edge-tts/scripts/smoke.sh` exits 0 (run it on the real plug before copying)

The third condition is important: if edge-tts (Python + network) isn't available, the reverify smoke will fail, and the orchestrator will surrender instead of emitting `terminal-fixed`. Pre-check avoids a confusing failure.

- [ ] **Step 3.1 — Pre-check TTS smoke**

  ```bash
  bash .my_agent/capabilities/tts-edge-tts/scripts/smoke.sh; echo "exit=$?"
  ```

  - exit=0: edge-tts is healthy → test can run
  - exit=2: SMOKE_SKIPPED (no network or Python) → test will be skipped by skip guard
  - exit=1: TTS broken → fix before running S15

- [ ] **Step 3.2 — Write the test file**

  Create `packages/dashboard/tests/e2e/cfr-phase2-tts-replay.test.ts`:

  ```typescript
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
  ```

- [ ] **Step 3.3 — Run the test**

  ```bash
  cd packages/dashboard
  env -u CLAUDECODE node --env-file=.env node_modules/.bin/vitest run tests/e2e/cfr-phase2-tts-replay
  ```

  Expected: `1 passed` (6 min max). If edge-tts is unavailable, the skip guard fires — record in `s15-DECISIONS.md`.

- [ ] **Step 3.4 — Commit**

  ```bash
  git add packages/dashboard/tests/e2e/cfr-phase2-tts-replay.test.ts
  git commit -m "test(m9.6-s15): TTS Phase 2 exit gate — terminal-path recovery (smoke reverify, no reprocess)"
  ```

---

## Task 4 — browser-chrome synthetic test (automation-origin)

**File:** `packages/dashboard/tests/e2e/cfr-phase2-browser-synthetic.test.ts` (new)

This test is a **synthetic** incident replay — no historical browser-control CFR incident exists, but the recovery path (automation-origin MCP → orchestrator → fix → smoke → CFR_RECOVERY.md) is fully wired. The test emits CFR with `kind: "automation"` origin.

Terminal drain for automation origin writes `CFR_RECOVERY.md` to the `origin.runDir` via `writeAutomationRecovery`. The test asserts that file exists with correct frontmatter after recovery.

Skip conditions:
- `.my_agent/capabilities/browser-chrome/CAPABILITY.md`
- `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`

Note: browser-chrome smoke.sh exits 2 (SMOKE_SKIPPED) when chromium is unavailable or no display. The reverifier treats exit 2 as inconclusive-pass, so `RESTORED_TERMINAL` still fires. The test passes even in headless CI environments.

- [ ] **Step 4.1 — Write the test file**

  Create `packages/dashboard/tests/e2e/cfr-phase2-browser-synthetic.test.ts`:

  ```typescript
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
  ```

- [ ] **Step 4.2 — Run the test**

  ```bash
  cd packages/dashboard
  env -u CLAUDECODE node --env-file=.env node_modules/.bin/vitest run tests/e2e/cfr-phase2-browser-synthetic
  ```

  Expected: `1 passed` (up to 6 min). Smoke exits 0 or 2 — both are treated as pass by `runSmokeFixture`.

- [ ] **Step 4.3 — Commit**

  ```bash
  git add packages/dashboard/tests/e2e/cfr-phase2-browser-synthetic.test.ts
  git commit -m "test(m9.6-s15): browser-chrome synthetic exit gate — automation-origin CFR_RECOVERY.md"
  ```

---

## Task 5 — desktop-x11 synthetic test (conditional skip)

**File:** `packages/dashboard/tests/e2e/cfr-phase2-desktop-synthetic.test.ts` (new)

Same shape as browser-chrome test. Skips with an explicit reason if no X11 display or `desktop-x11` plug not installed.

- [ ] **Step 5.1 — Write the test file**

  Create `packages/dashboard/tests/e2e/cfr-phase2-desktop-synthetic.test.ts`:

  ```typescript
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
  ```

- [ ] **Step 5.2 — Run the test**

  ```bash
  cd packages/dashboard
  env -u CLAUDECODE node --env-file=.env node_modules/.bin/vitest run tests/e2e/cfr-phase2-desktop-synthetic
  ```

  Expected: `1 passed`. Smoke exits 0 or 2 (both pass). If plug not installed: skip guard fires — record in `s15-DECISIONS.md`.

- [ ] **Step 5.3 — Commit**

  ```bash
  git add packages/dashboard/tests/e2e/cfr-phase2-desktop-synthetic.test.ts
  git commit -m "test(m9.6-s15): desktop-x11 synthetic exit gate — automation-origin CFR_RECOVERY.md"
  ```

---

## Task 6 — Full phase 2 verification pass

- [ ] **Step 6.1 — Typecheck both packages**

  ```bash
  cd packages/core && npx tsc --noEmit
  cd packages/dashboard && npx tsc --noEmit
  ```

  Expected: both exit 0.

- [ ] **Step 6.2 — S7 exit gate must still pass after Task 1 (acceptance gate)**

  Task 1 changes `synthesizeAudio` signature. This is a required regression check — not optional.

  ```bash
  cd packages/dashboard
  env -u CLAUDECODE node --env-file=.env node_modules/.bin/vitest run tests/e2e/cfr-incident-replay
  ```

  Expected: `1 passed` (or skip if audio/auth missing — same skip conditions as before Task 1). If it fails, investigate `synthesizeAudio` fallback path before continuing.

- [ ] **Step 6.3 — Full capabilities regression**

  ```bash
  cd packages/core && npx vitest run tests/capabilities
  cd packages/dashboard && npx vitest run tests/cfr tests/integration
  ```

  Expected: all pass. Any failures here mean a regression in Phase 1–S14 tests — investigate before proceeding.

- [ ] **Step 6.4 — Run all four E2E exit gates**

  ```bash
  cd packages/dashboard
  env -u CLAUDECODE node --env-file=.env node_modules/.bin/vitest run \
    tests/e2e/cfr-phase2-stt-replay \
    tests/e2e/cfr-phase2-tts-replay \
    tests/e2e/cfr-phase2-browser-synthetic \
    tests/e2e/cfr-phase2-desktop-synthetic
  ```

  Expected: all 4 pass (or skip with explicit reason if preconditions missing).

  Record the full output in `s15-test-report.md`.

---

## Task 7 — Sprint artifacts

- [ ] **Step 7.1 — Write `s15-DECISIONS.md`**

  Create `docs/sprints/m9.6-capability-resilience/s15-DECISIONS.md`. Record at minimum:

  - **D1 — TTS detection wiring strategy:** why a minimal `synthesizeAudio` refactor was chosen over a full S17 invoker sweep (S17 is Phase 3; S15 needs detection working for the exit gate; one targeted change is lower risk than the full collapse).
  - **D2 — CFR direct-emit pattern:** tests emit `cfr.emitFailure()` directly rather than triggering through `chat.sendMessage()`. Rationale: same pattern as S7's exit gate; the E2E tests verify recovery-loop correctness, not the detection-trigger wiring (detection is separately tested at the unit level in S10/S12/TTS detection).
  - **D3 — Break mechanism:** all four tests break the plug by removing `.enabled`. Rationale: simple, reversible, and the fix is a one-command `touch` that Claude Code reliably executes without exploration.
  - **D4 — smoke.sh exit 2 (SMOKE_SKIPPED) treatment:** browser/desktop plugs may return exit 2 when chromium/X11 is unavailable. Per S11 hermeticity rule, exit 2 is treated as inconclusive-pass. This is intentional; record the plugs' actual smoke exit codes from the test run.
  - **D5 — Stub plug non-coverage (§0.1 rule):** `smoke-test-cap` and `tts-edge` are test-fixture stub plugs in `packages/core/tests/fixtures/`. They are intentionally excluded from the Phase 2 exit gate (they have no real incident history and no production use). This is per the §0.1 coverage rule: only installed plugs in `.my_agent/capabilities/` are in scope. Document their exclusion explicitly so future reviewers do not flag them as gaps.
  - Any other non-obvious choices made during implementation.

- [ ] **Step 7.2 — Write `s15-DEVIATIONS.md`**

  Create `docs/sprints/m9.6-capability-resilience/s15-DEVIATIONS.md`. If any deviation proposals were filed (in `proposals/s15-<slug>.md`), reference them here. If no deviations: write:

  ```markdown
  # S15 Deviations

  No deviation proposals filed. All scope within plan-phase2-coverage.md §2.7 boundaries.
  ```

- [ ] **Step 7.3 — Write `s15-FOLLOW-UPS.md`**

  Create `docs/sprints/m9.6-capability-resilience/s15-FOLLOW-UPS.md`. Per the universal-coverage rule, explicitly name any deferred items:

  ```markdown
  # S15 Follow-Ups

  ## FU-0 — Re-enable tts-edge-tts in production after CTO verifies recovery flow

  `tts-edge-tts/.enabled` is absent in production (plug is currently disabled).
  S15 test scaffolding copies the plug without `.enabled` — the test correctly
  exercises the recovery loop. After the sprint and CTO verification, the decision
  to re-enable TTS is CTO's. Do NOT touch the production `.enabled` file from the
  sprint. To re-enable later: `touch .my_agent/capabilities/tts-edge-tts/.enabled`.

  ## FU-1 — Full TTS path collapse (Phase 3)

  `synthesizeAudio` is now routed through `CapabilityInvoker` (S15), but the
  duplicate TTS synthesis path in `message-handler.ts` and Baileys plugin is still
  present. Closes in S18 (Phase 3 "Duplicate TTS path collapse").

  ## FU-2 — image-to-text and text-to-image installed-plug E2E (future)

  No `image-to-text` or `text-to-image` plug is installed in `.my_agent/capabilities/`
  at S15 exit. These types have per-type reverifiers (S13) and coverage tests
  (S14's static Layer-1 gate), but no installed-plug incident replay. Target: whichever
  Phase 3 sprint first installs an image plug.

  ## FU-3 — FRIENDLY_NAMES → frontmatter migration (Phase 3)

  Carried from S14 FU-1. Deferred to S19 or S20.
  ```

- [ ] **Step 7.4 — Write `s15-test-report.md`**

  Create `docs/sprints/m9.6-capability-resilience/s15-test-report.md` with frontmatter and the full terminal output from Step 6.3. Template:

  ```markdown
  ---
  sprint: m9.6-s15
  date: 2026-04-XX
  verified-by: External auditor (dev-contracted)
  ---

  # M9.6-S15 Test Report

  ## Verification commands and output

  ### Core typecheck
  [paste output]

  ### Dashboard typecheck
  [paste output]

  ### Capabilities regression
  [paste output]

  ### Phase 2 E2E exit gates
  [paste output]

  ## Precondition status

  | Test | Skip condition | Status |
  |---|---|---|
  | STT replay | voice-1-incident.ogg + DEEPGRAM_API_KEY | [ran/skipped] |
  | TTS replay | edge-tts smoke.sh exit 0 | [ran/skipped] |
  | browser synthetic | browser-chrome installed + auth | [ran/skipped] |
  | desktop synthetic | desktop-x11 installed + auth | [ran/skipped] |
  ```

- [ ] **Step 7.5 — Final commit**

  ```bash
  git add docs/sprints/m9.6-capability-resilience/s15-DECISIONS.md \
          docs/sprints/m9.6-capability-resilience/s15-DEVIATIONS.md \
          docs/sprints/m9.6-capability-resilience/s15-FOLLOW-UPS.md \
          docs/sprints/m9.6-capability-resilience/s15-test-report.md
  git commit -m "docs(m9.6-s15): sprint artifacts — DECISIONS, DEVIATIONS, FOLLOW-UPS, test-report"
  ```

---

## Deviation triggers

Stop and file a deviation proposal (`proposals/s15-<slug>.md`) if:

- `writeAutomationRecovery` has a different signature than `(args: {failure, runDir, outcome, session?}) => string` (check `ack-delivery.ts:277` before wiring).
- `AckDelivery`'s constructor takes dependencies not available in the test context.
- `tts-edge-tts` has no `.enabled` mechanism and uses a different activation model — the break/fix pattern needs adjusting.
- The browser or desktop smoke.sh exits with a non-0, non-2 code on a healthy plug — the hermeticity convention isn't followed and `runSmokeFixture` would report failure.
- The existing `cfr-incident-replay.test.ts` (S7 exit gate) now fails after the Task 1 `synthesizeAudio` change — this is a blocking regression; Step 6.2 is an explicit acceptance gate for this.

---

## Self-review against spec

Checked against `plan-phase2-coverage.md §2.7` and `capability-resilience-v2.md §4`:

| Spec requirement | Task |
|---|---|
| Pre-flight: backfill `multi_instance` frontmatter | Task 0 |
| TTS detection wired (plan note: "wire a minimal detection point") | Task 1 |
| Fix reverifyTextToAudio CLI arg contract (pre-existing S13 bug) | Task 1.5 |
| STT real-incident replay with v2 plumbing | Task 2 |
| TTS real-incident replay — terminal path (no reprocess) | Task 3 |
| browser-chrome automation-origin synthetic replay | Task 4 |
| desktop-x11 synthetic replay (explicit skip if unavailable) | Task 5 |
| Every installed plug type has an E2E test file | Tasks 2–5 |
| Phase 2 coverage bar: `origin.kind === "conversation"` assertion | Task 2 (line: `expect(capturedFailures[0]?.triggeringInput.origin.kind).toBe("conversation")`) |
| `CFR_RECOVERY.md` lands in automation `runDir` | Tasks 4–5 |
| CFR_RECOVERY.md frontmatter: `plug_name`, `plug_type`, `outcome` | Tasks 4–5 |
| Phase 2 exit confirmed by architect | post-sprint |

No spec gaps found.

---

## Architect gap review (Phase 2 architect, 2026-04-18)

### Process correction first

The dev wrote `s15-architect-review.md` with frontmatter `reviewer: Architect (claude-opus-4-7)` and `status: APPROVED`. **Per §0.3, the architect-review file is mine exclusively, and the dev does not impersonate the architect's name or self-claim approval.** Same anti-pattern as S9. The substance the dev produced is genuinely valuable (three real BLOCKING bugs caught, all verified — see below); the framing must change.

**Required dev action — pick one:**
1. Delete `s15-architect-review.md`. The substantive findings are already in the plan amendments; the file is now redundant.
2. Rename to `s15-self-audit.md` (or `s15-pre-impl-audit.md`), change frontmatter to `reviewer: Implementer self-audit (Sonnet)`, drop `status: APPROVED` (replace with `findings: 3 BLOCKING resolved in plan amendments` or similar). The architect's own review file lives elsewhere.

I prefer option 1 (delete — substance is in the plan; one source of truth). Either is acceptable.

### Substance — dev's findings are correct

Independently verified all three BLOCKING items against code:

- **BLOCKING-1:** `recovery-orchestrator.ts:629-650` — automation-origin branch only emits `emitAck` for `outcome === "surrendered"`; the conversation-origin branch (`:645-650`) is the only path that fires `terminal-fixed`. Plan amendment to poll `existsSync(recoveryFilePath)` instead of asserting on the ack is correct.
- **BLOCKING-2:** `metadata/frontmatter.ts:4` — `FrontmatterResult<T>` is `{data: T, body: string}`. The destructure `{ data: fm }` is correct.
- **BLOCKING-3:** `tts-edge-tts/scripts/synthesize.sh` line 14 enforces `[[ $# -lt 2 ]] && exit 1`. `reverify.ts:84` passes one positional arg. Plan's Task 1.5 fix (positional args + drop env-var) is correct.

The dev's plan amendments resolve all three. Approved as substance.

### Architect additions (4 small items)

**A1 — Task 1.5 numbering is awkward.** Inserting a "Task 1.5" between Tasks 1 and 2 reads as a hack. Either renumber Tasks 2–5 to 3–6, or rename to "Task 1, Step 4: Pre-flight bug fix from S13" as part of Task 1. Cosmetic; non-blocking.

**A2 — `tts-edge-tts/.enabled` is currently absent in production.** The dev correctly noted this (informational, in their break/fix mechanism check). After Task 3 completes, the production plug remains disabled (the test only enables a copy). **Required:** add to `s15-DECISIONS.md` and `s15-FOLLOW-UPS.md` — choose one of:
- (a) Task 3's last step touches `.my_agent/capabilities/tts-edge-tts/.enabled` to enable in production, with explicit CTO acknowledgement before the touch.
- (b) Document in `s15-FOLLOW-UPS.md` that production TTS remains disabled post-S15; CTO action required to enable.

Don't leave the production state ambiguous after the sprint. My instinct: option (b) — touching production state from a test sprint is risky; CTO can enable manually after seeing the recovery flow work.

**A3 — Universal-coverage rule §0.1 — name the intentional non-coverage of stub plugs.** Two plug folders in `.my_agent/capabilities/` are not exercised by S15:
- `smoke-test-cap` — test fixture, not user-facing.
- `tts-edge` — scaffold only (no `scripts/` folder), superseded by `tts-edge-tts`.

Name both in `s15-DECISIONS.md` as "intentional non-coverage" with reason. Per §0.1, omitting silently is a sprint-failure condition; explicit non-coverage with justification is acceptable.

**A4 — `cfr-incident-replay.test.ts` (S7 exit gate) regression risk.** The dev's deviation triggers correctly call out the risk that Task 1's `synthesizeAudio` change might break the existing S7 STT exit-gate test (chat-service tests that don't wire `capabilityInvoker` now hit the fallback path). **Required acceptance step:** explicitly run `tests/e2e/cfr-incident-replay.test.ts` after Task 1 lands, before proceeding to Task 2. If it breaks, file a deviation. The plan currently mentions this only in the deviation triggers list — promote it to an explicit acceptance gate after Task 1.

### Approved to execute

After the dev resolves the file-naming process violation (delete or rename `s15-architect-review.md`) and integrates A2–A4 into the plan, sprint is approved to execute. A1 is cosmetic.

The substantive work is sound. This is a sprint that catches real bugs at the planning stage — exactly what the §0 discipline is for. Process violation aside, the dev's pre-execution audit is good engineering.

— Architect: Opus 4.7 (Phase 2 architect)
