/**
 * M9.6-S20 §2.5.2 Exit-gate Test 1 — browser-control, automation-origin.
 *
 * Supersedes S15's cfr-phase2-browser-synthetic.test.ts as the definitive
 * automation-origin exit gate. Uses shared helpers from cfr-exit-gate-helpers.ts.
 *
 * Scenario: `browser-chrome` capability present but .enabled missing.
 * Automation fires, CFR emits (automation-origin), fix-mode agent creates .enabled,
 * smoke verifies, CFR_RECOVERY.md written to runDir, debrief can be produced.
 *
 * S20-specific assertions (beyond S15):
 *   - deliverable.md body ≤ 5 lines
 *   - forensic.md exists alongside deliverable.md
 *
 * Preconditions:
 *   - .my_agent/capabilities/browser-chrome/CAPABILITY.md
 *   - ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
 *
 * Invocation:
 *   env -u CLAUDECODE node --env-file=packages/dashboard/.env \
 *     node_modules/.bin/vitest run tests/e2e/cfr-exit-gate-automation
 *
 * S12 obs #1 named deferral:
 *   Parallel-conversation originFactory not tested here. See s20-DECISIONS.md D-3.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { CfrEmitter, AckDelivery, type ConnectionRegistryLike } from "@my-agent/core";
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
  waitForAutomationRecovery,
  assertCfrRecovery,
  assertTerseDeliverable,
  MockTransport,
  type OrchestratorCallbacks,
} from "./cfr-exit-gate-helpers.js";

// ─── Precondition checks ──────────────────────────────────────────────────────

const hasBrowserPlug =
  realAgentDir !== null &&
  existsSync(join(realAgentDir, "capabilities", "browser-chrome", "CAPABILITY.md"));

const canRun = hasBrowserPlug && hasAuth;

describe.skipIf(!canRun)(
  "M9.6-S20 Exit Gate Test 1: browser-control automation-origin",
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
      const isolated = makeIsolatedAgentDir(".cfr-s20-browser-");
      agentDir = isolated.agentDir;

      runDir = join(agentDir, "run-browser-cfr");
      mkdirSync(runDir, { recursive: true });

      const enabledFileAbs = join(isolated.capabilitiesDir, "browser-chrome", ".enabled");
      writeCfrFixClaude(agentDir, isolated.capabilitiesDir, "browser-chrome", enabledFileAbs);

      copyCapabilityWithoutEnabled("browser-chrome", isolated.capabilitiesDir);

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
          console.error("[S20-Browser] Orchestrator error:", err);
        });
      });
    }, 60_000);

    afterAll(() => {
      rmSync(agentDir, { recursive: true, force: true });
    });

    it(
      "browser-chrome recovers: fix → smoke reverify → CFR_RECOVERY.md + terse deliverable",
      async () => {
        const enabledPath = join(agentDir, "capabilities", "browser-chrome", ".enabled");
        const recoveryFilePath = join(runDir, "CFR_RECOVERY.md");

        expect(existsSync(enabledPath)).toBe(false);

        cfr.emitFailure({
          capabilityType: "browser-control",
          capabilityName: "browser-chrome",
          symptom: "not-enabled",
          detail: "browser-chrome .enabled absent",
          triggeringInput: {
            origin: {
              kind: "automation",
              automationId: "test-s20-browser",
              jobId: "test-job-s20-browser",
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
        assertCfrRecovery(recoveryFilePath, "browser-chrome", "browser-control");

        // 3. No surrender
        expect(callbacks.surrenderEmitted).toBe(false);

        // 4. S20: deliverable.md is terse + forensic.md exists in the automation job dir
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
