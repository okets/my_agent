/**
 * M9.6-S20 §2.5.2 Abbreviated Replays — remaining plug types.
 *
 * Covers plug types not exercised by the two exit-gate tests:
 *   A) text-to-audio (tts-edge-tts) — conversation-origin, terminal path
 *      (no reprocessTurn: TTS has no retriable input)
 *   B) desktop-control (desktop-x11) — automation-origin
 *      (if installed; smoke exits 0 or 2/SMOKE_SKIPPED — both treated as pass)
 *
 * S20-specific assertions (beyond S15):
 *   - deliverable.md body ≤ 5 lines + forensic.md exists in job dir
 *
 * Uses shared helpers from cfr-exit-gate-helpers.ts.
 *
 * Preconditions (A):
 *   - .my_agent/capabilities/tts-edge-tts/CAPABILITY.md
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *
 * Preconditions (B):
 *   - .my_agent/capabilities/desktop-x11/CAPABILITY.md
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *
 * Invocation:
 *   env -u CLAUDECODE node --env-file=packages/dashboard/.env \
 *     node_modules/.bin/vitest run tests/e2e/cfr-abbreviated-replays
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  CfrEmitter,
  AckDelivery,
  conversationOrigin,
  type ConnectionRegistryLike,
} from "@my-agent/core";
import type { AckKind } from "@my-agent/core";

import {
  realAgentDir,
  hasAuth,
  makeIsolatedAgentDir,
  writeCfrFixClaude,
  copyCapabilityWithoutEnabled,
  makeCapabilityStack,
  makeAutomationStack,
  makeOrchestrator,
  waitForConversationRecovery,
  waitForAutomationRecovery,
  assertCfrRecovery,
  assertTerseDeliverable,
  MockTransport,
  type OrchestratorCallbacks,
} from "./cfr-exit-gate-helpers.js";

// ─── A) TTS: text-to-audio, conversation-origin, terminal path ───────────────

const hasTtsPlug =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "tts-edge-tts", "CAPABILITY.md"));

// Skip when running inside Claude Code — automation executor can't spawn nested CC.
const isInsideClaude = !!process.env.CLAUDECODE;
const canRunTts = hasTtsPlug && hasAuth && !isInsideClaude;

const TTS_CONV_ID = "cfr-s20-tts-abbreviated";
const TTS_CHANNEL = { transportId: "dashboard", channelId: "dashboard", sender: "user" };

describe.skipIf(!canRunTts)(
  "M9.6-S20 Abbreviated Replay A: text-to-audio conversation-origin (terminal path)",
  () => {
    let agentDir: string;
    let cfr: CfrEmitter;

    const callbacks: OrchestratorCallbacks = {
      emittedAcks: [] as AckKind[],
      surrenderEmitted: false,
      reprocessCalledWith: null,
    };

    beforeAll(async () => {
      const isolated = makeIsolatedAgentDir(".cfr-s20-tts-abbrev-");
      agentDir = isolated.agentDir;

      mkdirSync(join(agentDir, "conversations", TTS_CONV_ID, "raw"), { recursive: true });

      const enabledFileAbs = join(isolated.capabilitiesDir, "tts-edge-tts", ".enabled");
      writeCfrFixClaude(agentDir, isolated.capabilitiesDir, "tts-edge-tts", enabledFileAbs,
        "\n**Do NOT run synthesize.sh.** The orchestrator handles re-verification.\n",
      );

      copyCapabilityWithoutEnabled("tts-edge-tts", isolated.capabilitiesDir);

      const { registry, watcher } = await makeCapabilityStack(
        isolated.capabilitiesDir,
        isolated.envPath,
      );
      const { automations, automationJobService } = makeAutomationStack(agentDir);

      const mockTransport = new MockTransport();
      const connectionRegistry: ConnectionRegistryLike = {
        broadcastToConversation: () => {},
      };
      const ackDelivery = new AckDelivery(mockTransport, connectionRegistry);

      cfr = new CfrEmitter();

      const orchestrator = makeOrchestrator(
        registry,
        watcher,
        automations,
        automationJobService,
        callbacks,
        ackDelivery,
      );

      cfr.on("failure", (f) => {
        orchestrator.handle(f).catch((err) => {
          console.error("[S20-TTS-Abbrev] Orchestrator error:", err);
        });
      });
    }, 60_000);

    afterAll(() => {
      rmSync(agentDir, { recursive: true, force: true });
    });

    it(
      "tts-edge-tts recovers: fix → smoke reverify → terminal-fixed (no reprocessTurn)",
      async () => {
        const enabledPath = join(agentDir, "capabilities", "tts-edge-tts", ".enabled");
        expect(existsSync(enabledPath)).toBe(false);

        cfr.emitFailure({
          capabilityType: "text-to-audio",
          capabilityName: "tts-edge-tts",
          symptom: "not-enabled",
          detail: "tts-edge-tts .enabled absent",
          triggeringInput: {
            origin: conversationOrigin(TTS_CHANNEL, TTS_CONV_ID, 1),
            // No rawMediaPath — TTS has no retriable input; recovery is terminal
          },
        });

        await waitForConversationRecovery(callbacks, 300_000);

        // 1. Fix created .enabled
        expect(existsSync(enabledPath)).toBe(true);

        // 2. Terminal-fixed ack (RESTORED_TERMINAL path — TTS has no retriable input)
        expect(callbacks.emittedAcks).toContain("terminal-fixed");

        // 3. reprocessTurn NOT called (no retriable audio artifact)
        expect(callbacks.reprocessCalledWith).toBeNull();

        // 4. No surrender
        expect(callbacks.surrenderEmitted).toBe(false);

        // 5. S20: deliverable.md is terse + forensic.md exists
        const automationsDir = join(agentDir, "automations");
        if (existsSync(automationsDir)) {
          for (const entry of readdirSync(automationsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const jobDir = join(automationsDir, entry.name);
            const delivPath = join(jobDir, "deliverable.md");
            if (existsSync(delivPath)) {
              assertTerseDeliverable(jobDir, { expectForensic: true });
            }
          }
        }
      },
      360_000,
    );
  },
);

// ─── B) Desktop: desktop-control, automation-origin ──────────────────────────

const hasDesktopPlug =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "desktop-x11", "CAPABILITY.md"));

const canRunDesktop = hasDesktopPlug && hasAuth && !isInsideClaude;

describe.skipIf(!canRunDesktop)(
  "M9.6-S20 Abbreviated Replay B: desktop-control automation-origin",
  () => {
    let agentDir: string;
    let runDir: string;
    let cfr: CfrEmitter;

    const callbacks: OrchestratorCallbacks = {
      emittedAcks: [] as AckKind[],
      surrenderEmitted: false,
      reprocessCalledWith: null,
    };

    beforeAll(async () => {
      const isolated = makeIsolatedAgentDir(".cfr-s20-desktop-abbrev-");
      agentDir = isolated.agentDir;

      runDir = join(agentDir, "run-desktop-cfr");
      mkdirSync(runDir, { recursive: true });

      const enabledFileAbs = join(isolated.capabilitiesDir, "desktop-x11", ".enabled");
      writeCfrFixClaude(agentDir, isolated.capabilitiesDir, "desktop-x11", enabledFileAbs);

      copyCapabilityWithoutEnabled("desktop-x11", isolated.capabilitiesDir);

      const { registry, watcher } = await makeCapabilityStack(
        isolated.capabilitiesDir,
        isolated.envPath,
      );
      const { automations, automationJobService } = makeAutomationStack(agentDir);

      const mockTransport = new MockTransport();
      const connectionRegistry: ConnectionRegistryLike = {
        broadcastToConversation: () => {},
      };
      const ackDelivery = new AckDelivery(mockTransport, connectionRegistry);

      cfr = new CfrEmitter();

      const orchestrator = makeOrchestrator(
        registry,
        watcher,
        automations,
        automationJobService,
        callbacks,
        ackDelivery,
      );

      cfr.on("failure", (f) => {
        orchestrator.handle(f).catch((err) => {
          console.error("[S20-Desktop-Abbrev] Orchestrator error:", err);
        });
      });
    }, 60_000);

    afterAll(() => {
      rmSync(agentDir, { recursive: true, force: true });
    });

    it(
      "desktop-x11 recovers: fix → smoke reverify → CFR_RECOVERY.md + terse deliverable",
      async () => {
        const enabledPath = join(agentDir, "capabilities", "desktop-x11", ".enabled");
        const recoveryFilePath = join(runDir, "CFR_RECOVERY.md");

        expect(existsSync(enabledPath)).toBe(false);

        cfr.emitFailure({
          capabilityType: "desktop-control",
          capabilityName: "desktop-x11",
          symptom: "not-enabled",
          detail: "desktop-x11 .enabled absent",
          triggeringInput: {
            origin: {
              kind: "automation",
              automationId: "test-s20-desktop-abbrev",
              jobId: "test-job-s20-desktop-abbrev",
              runDir,
              notifyMode: "debrief",
            },
          },
        });

        await waitForAutomationRecovery(recoveryFilePath, callbacks, 300_000);

        // 1. Fix created .enabled
        expect(existsSync(enabledPath)).toBe(true);

        // 2. CFR_RECOVERY.md written with correct frontmatter
        expect(existsSync(recoveryFilePath)).toBe(true);
        assertCfrRecovery(recoveryFilePath, "desktop-x11", "desktop-control");

        // 3. No surrender
        expect(callbacks.surrenderEmitted).toBe(false);

        // 4. S20: deliverable.md is terse + forensic.md exists in automation job dir
        const automationsDir = join(agentDir, "automations");
        if (existsSync(automationsDir)) {
          for (const entry of readdirSync(automationsDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const jobDir = join(automationsDir, entry.name);
            const delivPath = join(jobDir, "deliverable.md");
            if (existsSync(delivPath)) {
              assertTerseDeliverable(jobDir, { expectForensic: true });
            }
          }
        }
      },
      360_000,
    );
  },
);
