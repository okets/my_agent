/**
 * M9.6-S20 §2.5.2 Exit-gate Test 2 — audio-to-text, conversation-origin.
 *
 * Supersedes S15's cfr-phase2-stt-replay.test.ts as the definitive
 * conversation-origin exit gate. Uses shared helpers from cfr-exit-gate-helpers.ts.
 *
 * Scenario: `stt-deepgram` capability present but .enabled missing.
 * User sends a voice message. CFR fires (conversation-origin). "Hold on" ack sent
 * via MockTransport. Fix-mode agent creates .enabled. Reverify transcribes the
 * original audio. reprocessTurn called with real transcription (not silently dropped).
 *
 * S20-specific assertions (beyond S15):
 *   - MockTransport captures at least one ack on the conversation's channel
 *   - reprocessTurn called with non-empty transcription
 *   - deliverable.md body ≤ 5 lines + forensic.md exists
 *
 * Preconditions:
 *   - packages/core/tests/fixtures/cfr/.local/voice-1-incident.ogg
 *   - .my_agent/capabilities/stt-deepgram/CAPABILITY.md
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *   - DEEPGRAM_API_KEY
 *
 * Invocation:
 *   env -u CLAUDECODE node --env-file=packages/dashboard/.env \
 *     node_modules/.bin/vitest run tests/e2e/cfr-exit-gate-conversation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import { rmSync, existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CfrEmitter,
  AckDelivery,
  type ConnectionRegistryLike,
  conversationOrigin,
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
  makeTestInvoker,
  waitForConversationRecovery,
  assertTerseDeliverable,
  MockTransport,
  type OrchestratorCallbacks,
} from "./cfr-exit-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Precondition checks ──────────────────────────────────────────────────────

const AUDIO_PATH =
  process.env.CFR_INCIDENT_AUDIO ??
  path.join(__dirname, "../../../core/tests/fixtures/cfr/.local/voice-1-incident.ogg");

const hasSttPlug =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "stt-deepgram", "CAPABILITY.md"));
const hasAudio = existsSync(AUDIO_PATH);
const hasDeepgram = !!process.env.DEEPGRAM_API_KEY;

const canRun = hasSttPlug && hasAudio && hasAuth && hasDeepgram;

const TEST_CONV_ID = "cfr-s20-stt-exit-gate";
const TEST_CHANNEL = { transportId: "whatsapp", channelId: "+15550001", sender: "+15550001" };

describe.skipIf(!canRun)(
  "M9.6-S20 Exit Gate Test 2: audio-to-text conversation-origin",
  () => {
    let agentDir: string;
    let rawAudioPath: string;
    let cfr: CfrEmitter;
    let mockTransport: MockTransport;

    const callbacks: OrchestratorCallbacks = {
      emittedAcks: [] as AckKind[],
      surrenderEmitted: false,
      reprocessCalledWith: null,
    };

    beforeAll(async () => {
      const isolated = makeIsolatedAgentDir(".cfr-s20-stt-");
      agentDir = isolated.agentDir;

      mkdirSync(join(agentDir, "conversations", TEST_CONV_ID, "raw"), { recursive: true });

      const enabledFileAbs = join(isolated.capabilitiesDir, "stt-deepgram", ".enabled");
      writeCfrFixClaude(agentDir, isolated.capabilitiesDir, "stt-deepgram", enabledFileAbs);

      // Copy incident audio to raw media store path
      rawAudioPath = join(agentDir, "conversations", TEST_CONV_ID, "raw", "voice-1.ogg");
      fs.copyFileSync(AUDIO_PATH, rawAudioPath);

      copyCapabilityWithoutEnabled("stt-deepgram", isolated.capabilitiesDir);

      const { registry, watcher } = await makeCapabilityStack(
        isolated.capabilitiesDir,
        isolated.envPath,
      );
      const { automations, automationJobService } = makeAutomationStack(agentDir);

      mockTransport = new MockTransport();
      const connectionRegistry: ConnectionRegistryLike = {
        broadcastToConversation: () => {},
      };
      const ackDelivery = new AckDelivery(mockTransport, connectionRegistry);

      cfr = new CfrEmitter();

      const invoker = makeTestInvoker(cfr, registry);
      const orchestrator = makeOrchestrator(
        registry,
        watcher,
        automations,
        automationJobService,
        callbacks,
        ackDelivery,
        invoker,
      );

      cfr.on("failure", (f) => {
        orchestrator.handle(f).catch((err) => {
          console.error("[S20-STT] Orchestrator error:", err);
        });
      });
    }, 60_000);

    afterAll(() => {
      rmSync(agentDir, { recursive: true, force: true });
    });

    it(
      "stt-deepgram recovers: ack → fix → reverify → reprocessTurn with real transcription",
      async () => {
        const enabledPath = join(agentDir, "capabilities", "stt-deepgram", ".enabled");
        expect(existsSync(enabledPath)).toBe(false);

        cfr.emitFailure({
          capabilityType: "audio-to-text",
          capabilityName: "stt-deepgram",
          symptom: "not-enabled",
          detail: "stt-deepgram .enabled absent",
          triggeringInput: {
            origin: conversationOrigin(TEST_CHANNEL, TEST_CONV_ID, 1),
            artifact: {
              type: "audio",
              rawMediaPath: rawAudioPath,
              mimeType: "audio/ogg",
            },
          },
        });

        await waitForConversationRecovery(callbacks, 300_000);

        // 1. Fix created .enabled
        expect(existsSync(enabledPath)).toBe(true);

        // 2. No surrender
        expect(callbacks.surrenderEmitted).toBe(false);

        // 3. reprocessTurn called with real transcription (not null, not empty)
        expect(callbacks.reprocessCalledWith).not.toBeNull();
        expect(callbacks.reprocessCalledWith!.length).toBeGreaterThan(0);

        // 4. MockTransport captured at least one ack on the conversation's channel
        //    (the "hold on — fixing" ack sent by AckDelivery)
        const acksToChannel = mockTransport.sends.filter(
          (s) => s.transportId === TEST_CHANNEL.transportId && s.to === TEST_CHANNEL.channelId,
        );
        expect(acksToChannel.length).toBeGreaterThan(0);

        // 5. S20: deliverable.md is terse + forensic.md exists in the job dir
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
