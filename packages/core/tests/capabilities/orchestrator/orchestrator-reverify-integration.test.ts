/**
 * Reverify integration test — runs against real incident audio.
 *
 * Requires CFR_INCIDENT_AUDIO env var or a fixture at
 * tests/fixtures/cfr/.local/voice-1-incident.ogg.
 * Skipped if absent — it'll run on any machine where the CTO has the incident audio locally.
 *
 * Requires:
 *   - stt-deepgram capability installed at .my_agent/capabilities/stt-deepgram/
 *   - .enabled file present
 *   - DEEPGRAM_API_KEY set in .env
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { reverify } from "../../../src/capabilities/reverify.js";
import { CapabilityRegistry } from "../../../src/capabilities/registry.js";
import { CapabilityWatcher } from "../../../src/capabilities/watcher.js";
import { scanCapabilities } from "../../../src/capabilities/scanner.js";
import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const audioPath =
  process.env.CFR_INCIDENT_AUDIO ??
  path.join(__dirname, "../../fixtures/cfr/.local/voice-1-incident.ogg");

// Resolve the real agent dir by walking up from this file
function findAgentDir(): string | null {
  // Look for .my_agent relative to the project root
  const projectRoot = path.resolve(__dirname, "../../../../..");
  const candidate = path.join(projectRoot, ".my_agent");
  return fs.existsSync(candidate) ? candidate : null;
}

function makeAudioToTextFailure(rawMediaPath: string): CapabilityFailure {
  return {
    id: "test-reverify-001",
    capabilityType: "audio-to-text",
    capabilityName: "stt-deepgram",
    symptom: "execution-error",
    detail: "test reverify",
    triggeringInput: {
      channel: {
        transportId: "whatsapp",
        channelId: "ch-test",
        sender: "+10000000001",
      },
      conversationId: "conv-test",
      turnNumber: 1,
      artifact: {
        type: "audio",
        rawMediaPath,
        mimeType: "audio/ogg",
      },
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

describe("reverify — incident audio integration", () => {
  let registry: CapabilityRegistry;
  let watcher: CapabilityWatcher;
  let tempDir: string;
  let envPath: string;

  beforeAll(async () => {
    tempDir = join(tmpdir(), `reverify-integration-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    envPath = join(tempDir, ".env");

    const agentDir = findAgentDir();
    const capabilitiesDir =
      process.env.MY_AGENT_CAPABILITIES_DIR ??
      (agentDir ? path.join(agentDir, "capabilities") : null);

    if (!capabilitiesDir || !fs.existsSync(capabilitiesDir)) {
      // No capabilities dir — tests will be skipped anyway (no audio file)
      registry = new CapabilityRegistry();
      const mockEnvPath = join(tempDir, ".env");
      writeFileSync(mockEnvPath, "");
      watcher = new CapabilityWatcher(tempDir, mockEnvPath, registry);
      return;
    }

    // Copy .env from the agent dir if it exists, so registry has access to API keys
    const agentEnvPath = path.join(agentDir!, "..", "packages", "dashboard", ".env");
    if (fs.existsSync(agentEnvPath)) {
      const envContent = fs.readFileSync(agentEnvPath, "utf-8");
      writeFileSync(envPath, envContent);
    } else {
      writeFileSync(envPath, "");
    }

    registry = new CapabilityRegistry();
    registry.setProjectRoot(path.resolve(__dirname, "../../../.."));

    const caps = await scanCapabilities(capabilitiesDir, envPath);
    registry.load(caps);
    await registry.testAll();

    watcher = new CapabilityWatcher(capabilitiesDir, envPath, registry);
    await watcher.start();
  });

  afterAll(async () => {
    await watcher.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Auth skip guard: reverify calls transcribe.sh which requires DEEPGRAM_API_KEY
  // in process.env. When invoked via plain `npx vitest`, process.env doesn't
  // auto-load the .env file. The test-e2e npm script in the dashboard package
  // loads it explicitly; this guard keeps the test from failing for the wrong
  // reason when someone runs `npx vitest` from the core package without the key.
  const canRun =
    fs.existsSync(audioPath) && !!process.env.DEEPGRAM_API_KEY;

  it.skipIf(!canRun)(
    "re-transcribes incident audio and recovers content containing 'songkran'",
    async () => {
      // Incident audio (conv-01KP3WPV3KGHWCRHD7VX8XVZFZ voice #1, the larger OGG)
      // says "hey nina how is songkran in chiang mai..." — NOT "voice messages now"
      // as the original M9.6 plan mis-cited from the incident JSONL narrative.
      // Verified at S7 exit gate (2026-04-16) via live Deepgram transcription.
      const failure = makeAudioToTextFailure(audioPath);
      const result = await reverify(failure, registry, watcher);

      expect(result.pass).toBe(true);
      expect(result.recoveredContent).toBeDefined();
      expect(result.recoveredContent?.toLowerCase()).toContain("songkran");
    },
    30_000,
  );

  it.skipIf(!canRun)(
    "reverify returns a non-empty string for recoveredContent",
    async () => {
      const failure = makeAudioToTextFailure(audioPath);
      const result = await reverify(failure, registry, watcher);

      if (result.pass) {
        expect(typeof result.recoveredContent).toBe("string");
        expect(result.recoveredContent!.trim().length).toBeGreaterThan(0);
      }
    },
    30_000,
  );
});
