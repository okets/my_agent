/**
 * CFR STT reprocess-chain test (M9.6-S21 BUG-3).
 *
 * Verifies that after a conversation-origin audio-to-text failure, the full
 * recovery chain fires: ack(attempt) → fix automation → reverify with rawMediaPath
 * → reprocessTurn called with recovered text.
 *
 * This test would have caught the live-test BUG-3 (reprocessTurn never called
 * after STT fix) before the 2026-04-20 incident.
 *
 * Approach:
 *   - Build an isolated orchestrator using E2E helpers (real automation stack).
 *   - Stub the invoker: first run() returns "not-enabled" failure; subsequent
 *     calls return success with transcribed text. This simulates the capability
 *     being fixed mid-recovery.
 *   - Fix automation (CLAUDE.md instructs agent to create .enabled) runs for
 *     real; after it completes the stub invoker starts returning success.
 *   - Assert reprocessCalledWith !== null and non-empty within timeout.
 *
 * Preconditions (integration, not E2E):
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN (for the fix agent)
 *   - .my_agent/capabilities/stt-deepgram/CAPABILITY.md present
 *   - packages/core/tests/fixtures/cfr/.local/voice-1-incident.ogg present
 *
 * Invocation:
 *   env -u CLAUDECODE node --env-file=packages/dashboard/.env \
 *     node_modules/.bin/vitest run tests/integration/cfr-stt-reprocess-chain
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import {
  CfrEmitter,
  AckDelivery,
  CapabilityInvoker,
  conversationOrigin,
  type ConnectionRegistryLike,
} from "@my-agent/core";
import type { InvokeOptions, InvokeResult } from "@my-agent/core";
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
  MockTransport,
  type OrchestratorCallbacks,
} from "../e2e/cfr-exit-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Precondition checks ──────────────────────────────────────────────────────

const AUDIO_FIXTURE =
  process.env.CFR_INCIDENT_AUDIO ??
  path.join(__dirname, "../../../core/tests/fixtures/cfr/.local/voice-1-incident.ogg");

const hasSttPlug =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "stt-deepgram", "CAPABILITY.md"));
const hasAudio = existsSync(AUDIO_FIXTURE);

// Skip when running inside Claude Code — automation executor can't spawn a
// nested Claude Code process (CLAUDECODE env var is set by the session).
const isInsideClaude = !!process.env.CLAUDECODE;
const canRun = hasSttPlug && hasAudio && hasAuth && !isInsideClaude;

const TEST_CONV_ID = "cfr-s21-stt-reprocess-chain";
const TEST_CHANNEL = { transportId: "whatsapp", channelId: "+15550002", sender: "+15550002" };

describe.skipIf(!canRun)(
  "M9.6-S21 BUG-3: STT reverify → reprocessTurn chain",
  () => {
    let agentDir: string;
    let rawAudioPath: string;
    let cfr: CfrEmitter;

    const callbacks: OrchestratorCallbacks = {
      emittedAcks: [] as AckKind[],
      surrenderEmitted: false,
      reprocessCalledWith: null,
    };

    beforeAll(async () => {
      const isolated = makeIsolatedAgentDir(".cfr-s21-stt-reprocess-");
      agentDir = isolated.agentDir;

      mkdirSync(join(agentDir, "conversations", TEST_CONV_ID, "raw"), { recursive: true });

      const enabledFileAbs = join(isolated.capabilitiesDir, "stt-deepgram", ".enabled");
      writeCfrFixClaude(agentDir, isolated.capabilitiesDir, "stt-deepgram", enabledFileAbs);

      rawAudioPath = join(agentDir, "conversations", TEST_CONV_ID, "raw", "voice-s21.ogg");
      fs.copyFileSync(AUDIO_FIXTURE, rawAudioPath);

      copyCapabilityWithoutEnabled("stt-deepgram", isolated.capabilitiesDir);

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

      // Stub invoker: first call returns failure (not-enabled), subsequent calls
      // return success with a fixture transcription. This simulates the cap being
      // fixed by the automation mid-recovery.
      let callCount = 0;
      const stubInvoker: CapabilityInvoker = {
        run: async (opts: InvokeOptions): Promise<InvokeResult> => {
          callCount++;
          if (opts.capabilityType === "audio-to-text") {
            if (callCount === 1) {
              cfr.emitFailure({
                capabilityType: "audio-to-text",
                capabilityName: "stt-deepgram",
                symptom: "not-enabled",
                detail: "stub: not-enabled (pre-fix)",
                triggeringInput: opts.triggeringInput,
              });
              return { kind: "failure", symptom: "not-enabled", detail: "stub: not-enabled (pre-fix)" };
            }
            // Post-fix: return success with fixture transcription
            return {
              kind: "success",
              stdout: JSON.stringify({ text: "This is the recovered transcription from STT.", confidence: 0.98 }),
              stderr: "",
              parsed: { text: "This is the recovered transcription from STT.", confidence: 0.98 },
            };
          }
          return { kind: "failure", symptom: "not-installed", detail: "stub: unknown type" };
        },
      } as unknown as CapabilityInvoker;

      const orchestrator = makeOrchestrator(
        registry,
        watcher,
        automations,
        automationJobService,
        callbacks,
        ackDelivery,
        stubInvoker,
      );

      cfr.on("failure", (f) => {
        orchestrator.handle(f).catch((err) => {
          console.error("[S21-STT-chain] Orchestrator error:", err);
        });
      });
    }, 60_000);

    afterAll(() => {
      rmSync(agentDir, { recursive: true, force: true });
    });

    it(
      "STT recovery chain: ack(attempt) → fix → reverify → reprocessTurn with non-empty text",
      async () => {
        // Fire the initial CFR with rawMediaPath correctly set inside artifact
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

        // Must not have surrendered
        expect(callbacks.surrenderEmitted).toBe(false);

        // reprocessTurn must have been called with the recovered transcription
        expect(callbacks.reprocessCalledWith).not.toBeNull();
        expect(callbacks.reprocessCalledWith!.length).toBeGreaterThan(0);

        // attempt ack must have been sent
        expect(callbacks.emittedAcks).toContain("attempt");
      },
      360_000,
    );
  },
);
