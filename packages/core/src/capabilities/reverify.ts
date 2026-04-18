/**
 * reverify.ts — Re-verify a capability fix against the user's actual triggering artifact.
 *
 * After each fix attempt, the orchestrator calls reverify() to confirm the capability
 * now works against the real input (not a synthetic fixture).
 *
 * Created in M9.6-S4.
 * M9.6-S10: reverifyAudioToText uses CapabilityInvoker; bash wrapper dropped.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CapabilityFailure } from "./cfr-types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityWatcher } from "./watcher.js";
import type { CapabilityInvoker } from "./invoker.js";

const execFileAsync = promisify(execFile);

/** Time to wait for capability to become available after rescan (ms) */
const AVAILABILITY_POLL_MS = 500;
const AVAILABILITY_TIMEOUT_MS = 10_000;

export interface ReverifyResult {
  pass: boolean;
  recoveredContent?: string;
  failureMode?: string;
  /**
   * Capability-reported confidence in `[0, 1]`, when the script emits it.
   * Populated by audio-to-text reverification starting in M9.6-S6. Consumed
   * by the reflect-phase prompt — lets Opus tell "Deepgram really heard
   * nothing" apart from "Deepgram is still broken".
   */
  confidence?: number;
  /**
   * Capability-reported audio duration in ms, when the script emits it.
   * Populated by audio-to-text reverification starting in M9.6-S6.
   */
  durationMs?: number;
  /**
   * Set to true when exit-2 (SMOKE_SKIPPED): external resource unavailable,
   * capability health indeterminate. Dispatcher treats as "might be healthy".
   */
  inconclusive?: boolean;
  /**
   * The path used for verification: artifact path for per-type reverifiers,
   * <capDir>/scripts/smoke.sh for smoke-fixture reverifier. Always populated
   * after S13 so FixAttempt.verificationInputPath is never empty string.
   */
  verificationInputPath?: string;
}

/**
 * Re-verify a capability fix against the user's actual triggering artifact.
 *
 * 1. Forces a watcher rescan (which also calls registry.testAll() internally).
 * 2. Waits up to 10s for the capability to become available.
 * 3. For audio-to-text: runs transcribe.sh against the raw media path from the failure.
 * 4. For unknown types: returns pass if capability is now available.
 *
 * M9.6-S10: invoker parameter added so reverifyAudioToText can route through
 * CapabilityInvoker instead of calling execFile("bash", ...) directly.
 * The invoker parameter is optional to preserve backwards compatibility with
 * tests that don't wire the full App.
 */
export async function reverify(
  failure: CapabilityFailure,
  registry: CapabilityRegistry,
  watcher: CapabilityWatcher,
  invoker?: CapabilityInvoker,
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
    return reverifyAudioToText(failure, registry, invoker);
  }

  // Unknown capability types: availability is the only check we can do
  const cap = registry.get(failure.capabilityType);
  return {
    pass: cap?.status === "available",
    failureMode: cap?.status !== "available" ? "capability unavailable" : "no reverifier registered",
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
  invoker?: CapabilityInvoker,
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

  // Route through invoker when available (M9.6-S10: drops the bash wrapper).
  // The invoker runs the script directly as execFile(scriptPath, args) — exec-bit
  // validation at scan time guarantees the script is executable.
  if (invoker) {
    const result = await invoker.run({
      capabilityType: "audio-to-text",
      scriptName: "transcribe.sh",
      args: [rawMediaPath],
      triggeringInput: failure.triggeringInput,
      expectJson: true,
    });

    if (result.kind === "failure") {
      return { pass: false, failureMode: `invoker: ${result.detail}` };
    }

    const parsed = result.parsed as Record<string, unknown>;
    const text = parsed?.text;
    if (typeof text !== "string" || text.trim() === "") {
      return { pass: false, failureMode: `transcribe.sh JSON missing non-empty "text" field` };
    }
    const rawConfidence = parsed?.confidence;
    const rawDuration = parsed?.duration_ms;
    const confidence =
      typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? rawConfidence : undefined;
    const durationMs =
      typeof rawDuration === "number" && Number.isFinite(rawDuration) ? rawDuration : undefined;
    return { pass: true, recoveredContent: text, confidence, durationMs };
  }

  // Fallback path for tests that don't wire the invoker (e.g. legacy unit tests).
  // Direct execFile call — preserved from pre-S10 for compatibility. When exec-bit
  // validation is guaranteed (S10 wired), the bash wrapper can be dropped in S13.
  const cap = registry.get("audio-to-text");
  if (!cap) {
    return { pass: false, failureMode: "audio-to-text capability not available" };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
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
      return { pass: false, failureMode: stderr.trim() || "transcribe.sh produced no output" };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { pass: false, failureMode: `transcribe.sh output is not valid JSON: ${trimmed.slice(0, 200)}` };
    }

    const text = parsed["text"];
    if (typeof text !== "string" || text.trim() === "") {
      return { pass: false, failureMode: `transcribe.sh JSON missing non-empty "text" field` };
    }

    const rawConfidence = parsed["confidence"];
    const rawDuration = parsed["duration_ms"];
    const confidence =
      typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? rawConfidence : undefined;
    const durationMs =
      typeof rawDuration === "number" && Number.isFinite(rawDuration) ? rawDuration : undefined;
    return { pass: true, recoveredContent: text, confidence, durationMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `transcribe.sh execution error: ${message}` };
  }
}

/** Maximum time to wait for smoke.sh to complete */
const SMOKE_TIMEOUT_MS = 30_000;

/**
 * Default reverifier for capability types without a per-type reverifier.
 *
 * Runs `<capDir>/scripts/smoke.sh` as a fresh out-of-session subprocess.
 * Exit 0 = pass. Missing smoke.sh = falls back to availability check with
 * a warning (this is a template-gap signal, not a normal path).
 *
 * Wired into the reverify dispatcher in S14. Exported here for unit testing.
 *
 * NOTE (S11 deviation): plan-universal-coverage.md §12.6 sketches runSmokeFixture(failure, registry).
 * Shipped here as (capDir, registry, capabilityType) — caller resolves capDir before calling.
 * S14 should adopt this signature; the plan sketch needs updating before S14 begins.
 */
export async function runSmokeFixture(
  capDir: string,
  registry: CapabilityRegistry,
  capabilityType: string,
): Promise<ReverifyResult> {
  const smokeScript = join(capDir, "scripts", "smoke.sh");

  if (!existsSync(smokeScript)) {
    const cap = registry.get(capabilityType);
    if (cap?.status === "available") {
      console.warn(
        `[runSmokeFixture] no smoke.sh in ${capDir} — template gap; falling back to availability check`,
      );
      return { pass: true };
    }
    return {
      pass: false,
      failureMode: `no smoke.sh found and capability ${capabilityType} not available`,
    };
  }

  try {
    await execFileAsync(smokeScript, [], {
      timeout: SMOKE_TIMEOUT_MS,
      cwd: capDir,
      env: { ...process.env },
    });
    return { pass: true, verificationInputPath: smokeScript };
  } catch (err: unknown) {
    // execFile rejects with err.code = exit code for non-zero exits.
    // Exit 2 = SMOKE_SKIPPED: external resource unavailable, health indeterminate.
    if (typeof err === "object" && err !== null && (err as Record<string, unknown>).code === 2) {
      return {
        pass: true,
        inconclusive: true,
        verificationInputPath: smokeScript,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `smoke.sh failed: ${message}`, verificationInputPath: smokeScript };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
