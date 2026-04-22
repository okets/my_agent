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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import type { CapabilityFailure } from "./cfr-types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityWatcher } from "./watcher.js";
import type { CapabilityInvoker } from "./invoker.js";

const execFileAsync = promisify(execFile);

type Reverifier = (
  failure: CapabilityFailure,
  registry: CapabilityRegistry,
  invoker?: CapabilityInvoker,
) => Promise<ReverifyResult>;

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
 * Reverifier for text-to-audio plugs. Runs synthesize.sh against a
 * deterministic fixture phrase; checks output file has Ogg or WAV magic bytes.
 * Returns recoveredContent: undefined — TTS has no retriable user input.
 */
export async function reverifyTextToAudio(
  failure: CapabilityFailure,
  registry: CapabilityRegistry,
): Promise<ReverifyResult> {
  const cap = registry.get("text-to-audio");
  if (!cap) {
    return { pass: false, failureMode: "text-to-audio capability not in registry" };
  }

  const scriptPath = join(cap.path, "scripts", "synthesize.sh");
  if (!existsSync(scriptPath)) {
    return { pass: false, failureMode: `synthesize.sh not found at ${scriptPath}` };
  }

  const outputPath = join(tmpdir(), `tts-reverify-${Date.now()}.audio`);

  try {
    await execFileAsync(scriptPath, ["This is a smoke test.", outputPath], {
      timeout: 30_000,
      cwd: cap.path,
      env: { ...process.env },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `synthesize.sh failed: ${message}`, verificationInputPath: scriptPath };
  }

  if (!existsSync(outputPath)) {
    return { pass: false, failureMode: "synthesize.sh exited 0 but no output file found", verificationInputPath: scriptPath };
  }

  const headerBytes = readFileSync(outputPath).slice(0, 4);
  const headerAscii = headerBytes.toString("ascii");
  // Strict Ogg-only (option a, S15-FU-4 / S18). Plugs must transcode to Ogg per template contract.
  if (!headerAscii.startsWith("OggS")) {
    return {
      pass: false,
      failureMode: `output file is not Ogg (magic: ${JSON.stringify(headerAscii)}); plug must transcode to Ogg per template contract`,
      verificationInputPath: scriptPath,
    };
  }

  return { pass: true, recoveredContent: undefined, verificationInputPath: scriptPath };
}

/**
 * Reverifier for image-to-text plugs. Runs ocr.sh against a template-supplied
 * stock test image; expects non-empty text on stdout.
 * Returns recoveredContent: undefined per design §7 (real-artifact reverify deferred).
 */
export async function reverifyImageToText(
  failure: CapabilityFailure,
  registry: CapabilityRegistry,
): Promise<ReverifyResult> {
  const cap = registry.get("image-to-text");
  if (!cap) {
    return { pass: false, failureMode: "image-to-text capability not in registry" };
  }

  const scriptPath = join(cap.path, "scripts", "ocr.sh");
  if (!existsSync(scriptPath)) {
    // Fall through to smoke fixture
    return runSmokeFixture(cap.path, registry, "image-to-text");
  }

  const testImagePath = join(cap.path, "scripts", "test-image.png");
  const scriptArgs = existsSync(testImagePath) ? [testImagePath] : [];

  try {
    const { stdout } = await execFileAsync(scriptPath, scriptArgs, {
      timeout: 30_000,
      cwd: cap.path,
      env: { ...process.env },
    });
    const text = stdout.trim();
    if (!text) {
      return { pass: false, failureMode: "ocr.sh produced empty output", verificationInputPath: scriptPath };
    }
    return { pass: true, recoveredContent: undefined, verificationInputPath: scriptPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `ocr.sh failed: ${message}`, verificationInputPath: scriptPath };
  }
}

/**
 * Reverifier for text-to-image plugs. Runs generate.sh against a deterministic
 * fixture prompt; checks output file has valid image header (PNG or JPEG).
 * Returns recoveredContent: undefined — no retriable user input.
 */
export async function reverifyTextToImage(
  failure: CapabilityFailure,
  registry: CapabilityRegistry,
): Promise<ReverifyResult> {
  const cap = registry.get("text-to-image");
  if (!cap) {
    return { pass: false, failureMode: "text-to-image capability not in registry" };
  }

  const scriptPath = join(cap.path, "scripts", "generate.sh");
  if (!existsSync(scriptPath)) {
    return runSmokeFixture(cap.path, registry, "text-to-image");
  }

  const outputPath = join(tmpdir(), `t2i-reverify-${Date.now()}.image`);

  try {
    await execFileAsync(scriptPath, [outputPath], {
      timeout: 60_000,
      cwd: cap.path,
      env: { ...process.env, T2I_REVERIFY_PROMPT: "A red circle on a white background." },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `generate.sh failed: ${message}`, verificationInputPath: scriptPath };
  }

  if (!existsSync(outputPath)) {
    return { pass: false, failureMode: "generate.sh exited 0 but no output file found", verificationInputPath: scriptPath };
  }

  const buf = readFileSync(outputPath);
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isWebp = buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";

  if (!isPng && !isJpeg && !isWebp) {
    return {
      pass: false,
      failureMode: `output file has invalid image header: ${buf.slice(0, 4).toString("hex")}`,
      verificationInputPath: scriptPath,
    };
  }

  return { pass: true, recoveredContent: undefined, verificationInputPath: scriptPath };
}

/**
 * Reverifier for audio-to-text plugs. Runs transcribe.sh against the raw media
 * file from the triggering input; expects JSON output with "text" field.
 */
async function reverifyAudioToText(
  failure: CapabilityFailure,
  registry: CapabilityRegistry,
  invoker?: CapabilityInvoker,
): Promise<ReverifyResult> {
  const rawMediaPath = failure.triggeringInput.artifact?.rawMediaPath;
  console.log(
    `[reverifyAudioToText] start — rawMediaPath=${rawMediaPath ?? "(missing)"} hasInvoker=${!!invoker}`,
  );
  if (!rawMediaPath) {
    console.warn(
      `[reverifyAudioToText] FAIL: no rawMediaPath on triggeringInput.artifact — ` +
        `artifact=${JSON.stringify(failure.triggeringInput.artifact)}`,
    );
    return {
      pass: false,
      failureMode: "no rawMediaPath on triggeringInput.artifact for audio-to-text reverification",
    };
  }

  if (!existsSync(rawMediaPath)) {
    console.warn(`[reverifyAudioToText] FAIL: raw media file not found: ${rawMediaPath}`);
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

  // Invoker is required for audio-to-text reverification (S10-FU-2 / S13-FU-1 / S18).
  // The legacy bash wrapper has been removed. If invoker is absent, fail fast.
  console.warn(
    `[reverifyAudioToText] FAIL: invoker required but absent — bash wrapper removed in S18`,
  );
  return {
    pass: false,
    failureMode: "invoker required for audio-to-text reverification — bash wrapper removed in S18",
  };
}

const REVERIFIERS: Record<string, Reverifier> = {
  "audio-to-text": reverifyAudioToText,
  "text-to-audio": reverifyTextToAudio,
  "image-to-text": reverifyImageToText,
  "text-to-image": reverifyTextToImage,
};

/**
 * Top-level reverify entry point (M9.6-S13). Routes to per-type reverifier
 * via REVERIFIERS table, or falls through to runSmokeFixture for MCP plugs
 * and unknown types.
 *
 * Replaces the old reverify() monolith. The old export is kept as a deprecated
 * alias for backwards compatibility with existing tests.
 */
export async function dispatchReverify(
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

  // System-origin probes have no artifact to replay — rescanNow() + testAll()
  // already verified health via waitForAvailability. Skip the per-type reverifier
  // (which requires an artifact) and return pass directly.
  if (failure.triggeringInput.origin.kind === "system") {
    console.log(
      `[dispatchReverify] system-origin: capability ${failure.capabilityType} ` +
        `healthy after rescan — skipping artifact reverifier`,
    );
    return { pass: true };
  }

  // Per-type reverifier
  const specific = REVERIFIERS[failure.capabilityType];
  if (specific) {
    return specific(failure, registry, invoker);
  }

  // Smoke-fixture default for MCP plugs and unknown types.
  // runSmokeFixture(capDir, registry, capabilityType) — resolve capDir first.
  const cap = registry.get(failure.capabilityType);
  if (!cap) {
    return { pass: false, failureMode: `${failure.capabilityType} not found in registry` };
  }
  return runSmokeFixture(cap.path, registry, failure.capabilityType);
}

/** @deprecated Use dispatchReverify instead (M9.6-S13). */
export const reverify = dispatchReverify;

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
