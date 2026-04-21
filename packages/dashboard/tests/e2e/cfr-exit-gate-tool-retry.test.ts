/**
 * M9.6-S22 Exit Gate: tool capability recovery with retryTurn dispatch.
 *
 * Verifies the third CFR shape (tool capabilities) end-to-end:
 *   1. browser-chrome is present but not enabled (symptom: not-enabled)
 *   2. User sends a conversation-origin turn requesting a screenshot
 *   3. CFR fires (PostToolUseFailure path, conversation origin)
 *   4. Fix-mode agent creates .enabled (real Claude Code session)
 *   5. Reverify (smoke fixture) passes
 *   6. terminalDrain emits "terminal-fixed" ack
 *   7. terminalDrain calls retryTurn (NEW — S22)
 *
 * Note: This automated test verifies orchestrator plumbing through step 7.
 * The "screenshot arrives after retry" assertion is covered by the CTO live
 * retest (which uses real app + brain + browser-chrome executing the task).
 * Live retest also uses real config/script corruption rather than .enabled
 * missing — requiring genuine fix-mode diagnosis.
 *
 * Preconditions:
 *   - .my_agent/capabilities/browser-chrome/CAPABILITY.md
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *
 * Invocation:
 *   env -u CLAUDECODE node --env-file=packages/dashboard/.env \
 *     node_modules/.bin/vitest run tests/e2e/cfr-exit-gate-tool-retry
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import { rmSync, existsSync, mkdirSync, cpSync } from "node:fs";
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
  waitForConversationRecovery,
  MockTransport,
  type OrchestratorCallbacks,
} from "./cfr-exit-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Precondition checks ──────────────────────────────────────────────────────

const hasBrowserPlug =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "browser-chrome", "CAPABILITY.md"));

// Skip when running inside Claude Code — automation executor can't spawn a
// nested Claude Code process (CLAUDECODE env var is set by the session).
const isInsideClaude = !!process.env.CLAUDECODE;
const canRun = hasBrowserPlug && hasAuth && !isInsideClaude;

const TEST_CONV_ID = "cfr-s22-tool-retry-e2e";
const TEST_CHANNEL = { transportId: "whatsapp", channelId: "+15550020", sender: "+15550020" };

describe.skipIf(!canRun)(
  "M9.6-S22 Exit Gate: browser-control tool recovery → retryTurn dispatch",
  () => {
    let agentDir: string;
    let cfr: CfrEmitter;
    let mockTransport: MockTransport;

    const callbacks: OrchestratorCallbacks = {
      emittedAcks: [] as AckKind[],
      surrenderEmitted: false,
      reprocessCalledWith: null,
      retryCalledWith: false,
    };

    beforeAll(async () => {
      const isolated = makeIsolatedAgentDir(".cfr-s22-tool-");
      agentDir = isolated.agentDir;

      mkdirSync(join(agentDir, "conversations", TEST_CONV_ID), { recursive: true });

      const enabledFileAbs = join(isolated.capabilitiesDir, "browser-chrome", ".enabled");
      writeCfrFixClaude(agentDir, isolated.capabilitiesDir, "browser-chrome", enabledFileAbs);

      copyCapabilityWithoutEnabled("browser-chrome", isolated.capabilitiesDir);

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

      const orchestrator = makeOrchestrator(
        registry,
        watcher,
        automations,
        automationJobService,
        callbacks,
        ackDelivery,
        // No invoker needed: browser-control uses smoke fixture fallback
      );

      cfr.on("failure", (f) => {
        orchestrator.handle(f).catch((err) => {
          console.error("[S22-Tool] Orchestrator error:", err);
        });
      });
    }, 60_000);

    afterAll(() => {
      rmSync(agentDir, { recursive: true, force: true });
    });

    it(
      "browser-chrome recovers: fix → smoke reverify → terminal-fixed ack + retryTurn dispatched",
      async () => {
        const enabledPath = join(agentDir, "capabilities", "browser-chrome", ".enabled");
        expect(existsSync(enabledPath)).toBe(false);

        cfr.emitFailure({
          capabilityType: "browser-control",
          capabilityName: "browser-chrome",
          symptom: "not-enabled",
          detail: "browser-chrome .enabled absent",
          triggeringInput: {
            // Conversation origin: user asked for a screenshot
            origin: conversationOrigin(TEST_CHANNEL, TEST_CONV_ID, 1),
          },
        });

        await waitForConversationRecovery(callbacks, 300_000);

        // Allow a brief window for retryTurn to complete after terminal-fixed
        if (!callbacks.retryCalledWith) {
          await new Promise((r) => setTimeout(r, 2000));
        }

        // 1. Fix created .enabled
        expect(existsSync(enabledPath)).toBe(true);

        // 2. No surrender
        expect(callbacks.surrenderEmitted).toBe(false);

        // 3. terminal-fixed ack delivered (user notified capability is restored)
        expect(callbacks.emittedAcks).toContain("terminal-fixed");

        // 4. retryTurn dispatched (S22 — new assertion vs S15/S20 tests)
        expect(callbacks.retryCalledWith).toBe(true);

        // 5. reprocessTurn NOT called (tool capability — no content to replay)
        expect(callbacks.reprocessCalledWith).toBeNull();

        // 6. MockTransport captured the attempt ack on the conversation channel
        const acksToChannel = mockTransport.sends.filter(
          (s) => s.transportId === TEST_CHANNEL.transportId && s.to === TEST_CHANNEL.channelId,
        );
        expect(acksToChannel.length).toBeGreaterThan(0);
      },
      360_000,
    );
  },
);
