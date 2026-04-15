/**
 * reverify.ts — Re-verify a capability fix against the user's actual triggering artifact.
 *
 * After each fix attempt, the orchestrator calls reverify() to confirm the capability
 * now works against the real input (not a synthetic fixture).
 *
 * Created in M9.6-S4.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CapabilityFailure } from "./cfr-types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityWatcher } from "./watcher.js";

const execFileAsync = promisify(execFile);

/** Time to wait for capability to become available after rescan (ms) */
const AVAILABILITY_POLL_MS = 500;
const AVAILABILITY_TIMEOUT_MS = 10_000;

export interface ReverifyResult {
  pass: boolean;
  recoveredContent?: string;
  failureMode?: string;
}

/**
 * Re-verify a capability fix against the user's actual triggering artifact.
 *
 * 1. Forces a watcher rescan (which also calls registry.testAll() internally).
 * 2. Waits up to 10s for the capability to become available.
 * 3. For audio-to-text: runs transcribe.sh against the raw media path from the failure.
 * 4. For unknown types: returns pass if capability is now available.
 */
export async function reverify(
  failure: CapabilityFailure,
  registry: CapabilityRegistry,
  watcher: CapabilityWatcher,
): Promise<ReverifyResult> {
  // Force rescan + testAll
  await watcher.rescanNow();

  // Wait for capability to be available
  const available = await waitForAvailability(
    registry,
    failure.capabilityType,
    AVAILABILITY_TIMEOUT_MS,
    AVAILABILITY_POLL_MS,
  );

  if (!available) {
    return {
      pass: false,
      failureMode: `capability ${failure.capabilityType} still unavailable after rescan`,
    };
  }

  // Type-specific reverification
  if (failure.capabilityType === "audio-to-text") {
    return reverifyAudioToText(failure, registry);
  }

  // Unknown capability types: availability is the only check we can do
  return {
    pass: true,
    failureMode: undefined,
    recoveredContent: undefined,
  };
}

/** Wait up to timeoutMs for the capability to reach status=available */
async function waitForAvailability(
  registry: CapabilityRegistry,
  capabilityType: string,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const cap = registry.get(capabilityType);
    if (cap?.status === "available") return true;
    await sleep(pollMs);
  }

  // Final check
  return registry.get(capabilityType)?.status === "available";
}

async function reverifyAudioToText(
  failure: CapabilityFailure,
  registry: CapabilityRegistry,
): Promise<ReverifyResult> {
  const rawMediaPath = failure.triggeringInput.artifact?.rawMediaPath;
  if (!rawMediaPath) {
    return {
      pass: false,
      failureMode: "no rawMediaPath on triggeringInput.artifact for audio-to-text reverification",
    };
  }

  if (!existsSync(rawMediaPath)) {
    return {
      pass: false,
      failureMode: `raw media file not found: ${rawMediaPath}`,
    };
  }

  const cap = registry.get("audio-to-text");
  if (!cap) {
    return { pass: false, failureMode: "audio-to-text capability not available" };
  }

  const scriptPath = join(cap.path, "scripts", "transcribe.sh");
  if (!existsSync(scriptPath)) {
    return { pass: false, failureMode: `transcribe.sh not found at ${scriptPath}` };
  }

  try {
    const { stdout, stderr } = await execFileAsync("bash", [scriptPath, rawMediaPath], {
      timeout: 30_000,
      env: { ...process.env },
    });

    const trimmed = stdout.trim();
    if (!trimmed) {
      const errMsg = stderr.trim();
      return {
        pass: false,
        failureMode: errMsg || "transcribe.sh produced no output",
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        pass: false,
        failureMode: `transcribe.sh output is not valid JSON: ${trimmed.slice(0, 200)}`,
      };
    }

    const text = parsed["text"];
    if (typeof text !== "string" || text.trim() === "") {
      return {
        pass: false,
        failureMode: `transcribe.sh JSON missing non-empty "text" field`,
      };
    }

    return { pass: true, recoveredContent: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `transcribe.sh execution error: ${message}` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
