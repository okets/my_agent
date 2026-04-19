# M9.6-S18 — Duplicate TTS Path Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the duplicate TTS synthesis path so `chat-service.synthesizeAudio` is the sole authoritative path, `message-handler` consumes the `audioUrl` already in `done` events instead of re-synthesizing text, and the Baileys `onSendVoiceReply` synthesis path is deleted.

**Architecture:** Four inherited Phase 2 deferrals land first (bash wrapper removal, Ogg-strict format, plug contract fix, template validation), because they stabilise the reverify layer that S18's new paths depend on. Then the transport interface is split into `sendAudioUrlViaTransport` / `sendTextViaTransport`, `message-handler` is updated to capture `audioUrl` and follow the per-path fallback table, and the duplicate Baileys synthesis path is deleted. Three new integration test files verify the fallback table, healthy voice path, and single CFR-emit property.

**Tech Stack:** TypeScript, Node.js, bash, ffmpeg (Ogg transcode), Vitest

**Design ref:** `docs/sprints/m9.6-capability-resilience/plan-phase3-refinements.md` §2.3 — binding.

---

## §0.3 Compliance Rules (READ BEFORE STARTING) [ARCHITECT R2]

These rules are non-negotiable. S16 had two violations (premature merge + premature ROADMAP-Done); S17 restored discipline; S18 must keep it.

- **Do NOT merge to master.** All work stays on `sprint/m9.6-s18-tts-path-collapse` until the architect approves.
- **Do NOT update `docs/ROADMAP.md`.** Architect authors the ROADMAP-Done commit as the LAST commit after approval.
- **Do NOT write "APPROVED" or "all tasks complete" in any commit message.** The dev does not hold the role that decides "complete."
- **File `docs/sprints/m9.6-capability-resilience/proposals/s18-<slug>.md` for any deviation** before changing course.

---

## ARCHITECT REVIEW (2026-04-19) — required corrections before start

Phase 3 architect (Opus 4.7) reviewed v0 of this plan. Substantive scope coverage is strong (all four §0.5 inherited deferrals + the original §2.3 work named); D1/D2 are well-reasoned; task ordering sensible. Three required corrections + five suggestions before start. Inline edits below are marked `[ARCHITECT R#]` or `[ARCHITECT S#]`.

| Tag | What was missing | Where it landed |
|-----|------------------|-----------------|
| **R1** | Plan was at `docs/sprints/m9.6-s18-tts-path-collapse/plan.md`, breaking the M9.6 sprint convention. S1–S17 all live in `m9.6-capability-resilience/` with `sN-` prefix. ROADMAP S18 row + Phase 3 plan §4 design map both link to that folder. | Architect moved file to `docs/sprints/m9.6-capability-resilience/s18-plan.md` before this review. Sprint artifacts (DECISIONS / DEVIATIONS / FOLLOW-UPS / test-report / architect-review) all use `s18-` prefix in the same folder. Task 2 / Task 9 commit paths updated below. |
| **R2** | §0.3 compliance section absent at top of plan (S17 had it). Task 9 missed two required artifacts: `s18-DEVIATIONS.md` + `s18-test-report.md`. Same R1 gap S16/S17 plan reviews flagged. | New §0.3 section above; Task 9 expanded to cover all four artifacts. |
| **R3** | `tts-paths.test.ts` covered only 3 of 5 fallback-table rows. Spec says "one test per row." Missing: split-done with `splitAudioUrl`, error-event catch path. | Task 6 — two new test bodies added (search for `[ARCHITECT R3]`). |
| **S1** | ffmpeg precondition check was mid-task (Task 3 Step 1). If ffmpeg is absent, the dev has already done Tasks 1–2 work. | New Task 0 preflight step. |
| **S2** | `cfr-tts-single-emit.test.ts` asserted `<= 1` — trivially satisfied even when 0 emits (which would silently break resilience). | Task 8 — change to `=== 1`. |
| **S3** | `wireAudioCallbacks` deletion (Task 7) didn't verify the function had no other side effects. | Task 7 — added a verification step before deletion. |
| **S4** | Test bodies in Task 6 were speculative ("if mock structure doesn't align..."). | Task 6 — added a verification gate before committing test code. |
| **S5** | D2 (`Reverifier.invoker?` stays optional) is a smell with no target sprint for the type-system tightening. | Task 9 — D2 expanded with target sprint + interim safety guidance. |

### Confirmed answer to dev's S15-FU-4 question

**Option (a) — strict Ogg only.** S11-FU-5 (Task 3) makes `tts-edge-tts` actually emit Ogg via ffmpeg transcode, so the strict reverifier catches plug contract violations rather than masking them. We have no evidence of format diversity beyond Ogg/MP3 that would justify keeping the format-agnostic fallback. Defense-in-depth here is the wrong instinct — reverify is the contract gate. Plan now reflects this in Task 2.

### Sprint-time verification items (grep before relying on)

- **Confirm line numbers at sprint-start.** Plan references `app.ts:981–998`, `app.ts:2323–2358`, `message-handler.ts:560–602`, `reverify.ts:210–310`. May have drifted. `grep -n` first.
- **`printf '\xff\xfb...'` test fixtures (Task 2 Step 1)** write non-ASCII bytes through bash printf. Verify they actually produce the intended bytes on your machine before committing the tests: `bash -c 'printf "\xff\xfb"' | od -A n -t x1` (expected: `ff fb`).
- **Task 6 is the highest-risk task.** S15's `cfr-phase2-tts-replay.test.ts` is the regression gate — if it fails after Task 6, stop and investigate before continuing.
- **`tts-edge-tts` is currently disabled in production** (per S15 D6 / FU-0). After Task 3's plug fix, the CTO chooses whether to re-enable. **Don't touch `.enabled` in this sprint.**
- **Plan was moved by architect.** Original location `docs/sprints/m9.6-s18-tts-path-collapse/` is gone. All file paths in this plan use `docs/sprints/m9.6-capability-resilience/s18-*.md` for sprint artifacts and `docs/sprints/m9.6-capability-resilience/proposals/s18-*.md` for any proposals.

---

## Before/After

| Before | After |
|--------|-------|
| Two synthesis calls per voice turn: `chat-service.synthesizeAudio` (through CapabilityInvoker, CFR-capable) + `wireAudioCallbacks.onSendVoiceReply` (direct `execFile`, no CFR) | One synthesis call per voice turn: `chat-service.synthesizeAudio` only |
| `message-handler` ignores `audioUrl` from `done` events; calls `sendAudioViaTransport(text)` to re-synthesize | `message-handler` captures `audioUrl` from every `done` event; calls `sendAudioUrlViaTransport(audioUrl)` |
| TTS failures emit CFR only through the chat-service path; Baileys path fails silently | TTS failures always emit CFR (Baileys path deleted) |
| `reverifyAudioToText` falls back to `execFile("bash", scriptPath)` when invoker absent | `reverifyAudioToText` returns `pass: false` with explicit error when invoker absent; bash fallback deleted |
| `reverifyTextToAudio` accepts MP3/WAV/Ogg as valid audio | `reverifyTextToAudio` accepts Ogg only (strict; plug-side Ogg compliance via S11-FU-5) |
| `tts-edge-tts/scripts/synthesize.sh` outputs MPEG audio (MP3 bytes, `.ogg` extension) | `synthesize.sh` transcodes to real Ogg/Opus via ffmpeg |
| `tts-edge-tts/scripts/smoke.sh` validates MP3 magic bytes | `smoke.sh` validates OggS magic bytes |
| `text-to-audio.md` template smoke reference does not validate audio format | Template smoke validates OggS magic bytes |

---

## File Map

| File | Change |
|------|--------|
| `packages/core/src/capabilities/reverify.ts` | Remove bash fallback from `reverifyAudioToText`; add invoker-absent guard; remove MP3/WAV/ID3 checks from `reverifyTextToAudio` |
| `packages/core/tests/capabilities/reverify-audio-to-text.test.ts` | **New** — unit tests for `reverifyAudioToText` via `dispatchReverify` with mock invoker |
| `packages/core/tests/capabilities/reverify-tts.test.ts` | Add test: MP3 output now returns `pass: false` |
| `packages/core/tests/capabilities/reverify-dispatch.test.ts` | Update audio-to-text routing test to pass mock invoker |
| `.my_agent/capabilities/tts-edge-tts/scripts/synthesize.sh` | Add ffmpeg Ogg transcode step after edge-tts synthesis |
| `.my_agent/capabilities/tts-edge-tts/scripts/smoke.sh` | Validate OggS magic bytes instead of MP3 sync word |
| `skills/capability-templates/text-to-audio.md` | Strengthen reference `smoke.sh` to validate OggS magic bytes |
| `packages/dashboard/src/channels/message-handler.ts` | Replace `sendAudioViaTransport` dep with `sendAudioUrlViaTransport` + `sendTextViaTransport`; capture `audioUrl` from `done` events; implement per-path fallback table |
| `packages/dashboard/src/app.ts` | Add `sendAudioUrlViaTransport`, `sendTextViaTransport` closures; remove `sendAudioViaTransport` closure; delete `wireAudioCallbacks` function and its call site |
| `packages/dashboard/tests/integration/tts-paths.test.ts` | **New** — one test per fallback table row |
| `packages/dashboard/tests/integration/voice-reply-regression.test.ts` | **New** — healthy voice path regression |
| `packages/dashboard/tests/integration/cfr-tts-single-emit.test.ts` | **New** — CFR emits exactly once when TTS fails |

---

## Task 0 [ARCHITECT S1]: Preflight — ffmpeg + branch + S17 baseline

Before starting any task, verify preconditions. ffmpeg is required by Task 3; if absent, install before Task 1 (not mid-sprint).

- [ ] **Step 0.1: Confirm ffmpeg available**

```bash
which ffmpeg && ffmpeg -version 2>&1 | head -1
```

Expected: path + version line. If absent: `sudo apt-get install -y ffmpeg` (Debian/Ubuntu) before continuing.

- [ ] **Step 0.2: Create sprint branch from master**

```bash
cd /home/nina/my_agent
git checkout master
git pull
git checkout -b sprint/m9.6-s18-tts-path-collapse
```

- [ ] **Step 0.3: Confirm S17 baseline tests pass**

```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/orchestrator tests/capabilities/fix-mode-invocation tests/capabilities/fix-mode-escalate 2>&1 | tail -5
cd packages/dashboard && npx tsc --noEmit
```

Expected: zero tsc errors, all S17 tests pass. If anything regressed since S17, stop and file a proposal — something is wrong upstream.

- [ ] **Step 0.4: Verify printf-bytes test infrastructure works on this machine (R3 + Task 2 prep)**

```bash
bash -c 'printf "\xff\xfb"' | od -A n -t x1
```

Expected: `ff fb`. If you get something else (e.g., literal `\xff` chars), bash's printf doesn't interpret hex escapes — switch tests to `printf '%b' '\\xff\\xfb'` or use `node -e 'process.stdout.write(Buffer.from([0xff,0xfb]))'`. Update Task 2 fixtures accordingly before writing them.

---

## Task 1: Remove bash fallback from `reverifyAudioToText` (S10-FU-2 / S13-FU-1)

**Files:**
- Modify: `packages/core/src/capabilities/reverify.ts:210–310`
- Create: `packages/core/tests/capabilities/reverify-audio-to-text.test.ts`
- Modify: `packages/core/tests/capabilities/reverify-dispatch.test.ts:46–54`

### Background

`reverifyAudioToText` (line 210) has two paths:
1. **Invoker path** (lines 233–257): routes through `CapabilityInvoker.run()`. Correct, already in place since S10.
2. **Bash fallback** (lines 260–309): `execFile("bash", [scriptPath, rawMediaPath])`. This is the legacy path S10-FU-2 and S13-FU-1 asked us to remove.

The dispatch test at `reverify-dispatch.test.ts:51` calls `dispatchReverify(failure, registry, watcher)` — no invoker — for an audio-to-text failure. After this change the result will be `pass: false` (invoker absent guard). Update that test to pass a mock invoker so it exercises the real path.

- [ ] **Step 1: Write the new reverify-audio-to-text.test.ts (failing)**

```bash
cat > packages/core/tests/capabilities/reverify-audio-to-text.test.ts << 'EOF'
/**
 * Tests for reverifyAudioToText via dispatchReverify (M9.6-S18).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dispatchReverify } from "../../src/capabilities/reverify.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityWatcher } from "../../src/capabilities/watcher.js";
import type { CapabilityInvoker } from "../../src/capabilities/invoker.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";

function makeCapDir(): string {
  const capDir = join(tmpdir(), `stt-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  return capDir;
}

function makeRegistry(type: string, capDir: string): CapabilityRegistry {
  return {
    get: (t: string) =>
      t === type
        ? { status: "available", name: "stt-test", provides: type, path: capDir, interface: "script" }
        : undefined,
  } as unknown as CapabilityRegistry;
}

function makeWatcher(): CapabilityWatcher {
  return {
    rescanNow: vi.fn().mockResolvedValue(undefined),
    testAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as CapabilityWatcher;
}

function makeFailure(rawMediaPath: string): CapabilityFailure {
  return {
    id: "f-stt",
    capabilityType: "audio-to-text",
    symptom: "execution-error",
    triggeringInput: {
      origin: { kind: "conversation", conversationId: "c1" },
      artifact: { rawMediaPath },
    },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

function makeInvoker(result: { kind: "success"; parsed: unknown } | { kind: "failure"; detail: string }): CapabilityInvoker {
  return {
    run: vi.fn().mockResolvedValue(result),
  } as unknown as CapabilityInvoker;
}

describe("reverifyAudioToText (via dispatchReverify)", () => {
  const audioPath = join(tmpdir(), `test-audio-${randomUUID()}.ogg`);

  beforeEach(() => {
    writeFileSync(audioPath, Buffer.from("fake-audio-data"));
  });

  it("returns pass:true when invoker returns transcription", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const invoker = makeInvoker({ kind: "success", parsed: { text: "hello world", confidence: 0.95 } });
    const failure = makeFailure(audioPath);

    const result = await dispatchReverify(failure, registry, watcher, invoker);

    expect(result.pass).toBe(true);
    expect(result.recoveredContent).toBe("hello world");
    expect((invoker.run as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("returns pass:false with clear message when invoker is absent", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const failure = makeFailure(audioPath);

    const result = await dispatchReverify(failure, registry, watcher, undefined);

    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/invoker required/i);
  });

  it("returns pass:false when invoker returns failure", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const invoker = makeInvoker({ kind: "failure", detail: "timeout" });
    const failure = makeFailure(audioPath);

    const result = await dispatchReverify(failure, registry, watcher, invoker);

    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/invoker: timeout/);
  });

  it("returns pass:false when invoker returns empty text", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const invoker = makeInvoker({ kind: "success", parsed: { text: "" } });
    const failure = makeFailure(audioPath);

    const result = await dispatchReverify(failure, registry, watcher, invoker);

    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/non-empty.*text/i);
  });

  it("returns pass:false when rawMediaPath is absent from triggeringInput", async () => {
    const capDir = makeCapDir();
    const registry = makeRegistry("audio-to-text", capDir);
    const watcher = makeWatcher();
    const invoker = makeInvoker({ kind: "success", parsed: { text: "hello" } });
    const failure: CapabilityFailure = {
      id: "f-stt-no-path",
      capabilityType: "audio-to-text",
      symptom: "execution-error",
      triggeringInput: { origin: { kind: "system", component: "test" } }, // no artifact
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };

    const result = await dispatchReverify(failure, registry, watcher, invoker);

    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/rawMediaPath/i);
  });
});
EOF
```

- [ ] **Step 2: Run test — expect failures (bash fallback still present)**

```bash
cd packages/core && npx vitest run tests/capabilities/reverify-audio-to-text --reporter=verbose 2>&1 | tail -20
```

Expected: "invoker absent" test fails (bash fallback fires instead of returning pass:false with error).

- [ ] **Step 3: Edit `reverify.ts` — remove bash fallback, add invoker-absent guard**

In `packages/core/src/capabilities/reverify.ts`, replace lines 258–309 (the bash fallback block) with the invoker-absent guard:

```typescript
// --- BEFORE (lines ~258–309): ---
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
    // ... (many lines of JSON parsing) ...
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { pass: false, failureMode: `transcribe.sh execution error: ${message}` };
  }
```

Replace with:

```typescript
  // Invoker is required for audio-to-text reverification (S10-FU-2 / S13-FU-1 / S18).
  // The legacy bash wrapper has been removed. If invoker is absent, fail fast.
  return {
    pass: false,
    failureMode: "reverifyAudioToText requires an invoker — bash wrapper removed in S18",
  };
```

Also update the comment at line 260 (the old "Fallback path" comment block is replaced by the one-liner above).

The function after editing should look like:

```typescript
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

  if (!invoker) {
    return {
      pass: false,
      failureMode: "reverifyAudioToText requires an invoker — bash wrapper removed in S18",
    };
  }

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
```

- [ ] **Step 4: Update `reverify-dispatch.test.ts` — pass mock invoker for audio-to-text test**

In `packages/core/tests/capabilities/reverify-dispatch.test.ts`, update the "routes audio-to-text" test to pass a mock invoker. First add the import for `CapabilityInvoker` and `vi`:

```typescript
// Add near existing imports:
import { vi } from "vitest";
import type { CapabilityInvoker } from "../../src/capabilities/invoker.js";
```

Update the test at line ~47:

```typescript
it("routes audio-to-text to reverifyAudioToText (returns pass:true via mock invoker)", async () => {
  const registry = makeRegistry("audio-to-text");
  const watcher = makeWatcher();
  const failure = makeFailure("audio-to-text");
  // Provide a rawMediaPath so reverifyAudioToText doesn't bail early.
  (failure.triggeringInput as { artifact?: { rawMediaPath: string } }).artifact = {
    rawMediaPath: "/tmp/fake-audio.ogg",
  };
  // Write a fake file so existsSync passes.
  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/fake-audio.ogg", Buffer.from("fake"));

  const invoker: CapabilityInvoker = {
    run: vi.fn().mockResolvedValue({ kind: "success", parsed: { text: "hello" } }),
  } as unknown as CapabilityInvoker;

  const result = await dispatchReverify(failure, registry, watcher, invoker);
  expect(result.pass).toBe(true);
  expect(result.recoveredContent).toBe("hello");
});
```

- [ ] **Step 5: Run all reverify-audio-to-text tests**

```bash
cd packages/core && npx vitest run tests/capabilities/reverify-audio-to-text tests/capabilities/reverify-dispatch --reporter=verbose 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 6: Type-check core**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
cd /home/nina/my_agent
git add packages/core/src/capabilities/reverify.ts \
        packages/core/tests/capabilities/reverify-audio-to-text.test.ts \
        packages/core/tests/capabilities/reverify-dispatch.test.ts
git commit -m "refactor(reverify): remove bash wrapper from reverifyAudioToText (S10-FU-2/S13-FU-1)

Bash fallback deleted. Invoker-absent path now returns pass:false with explicit
message instead of falling through to execFile('bash', ...). New unit tests
verify the invoker path and the absent-invoker guard."
```

---

## Task 2: `reverifyTextToAudio` Ogg-strict format strategy (S15-FU-4)

**Files:**
- Modify: `packages/core/src/capabilities/reverify.ts:98–112`
- Modify: `packages/core/tests/capabilities/reverify-tts.test.ts`

### Background

`reverifyTextToAudio` currently accepts Ogg, WAV/RIFF, ID3, and MP3 MPEG sync word (lines 100–106). Option (a) from the spec: remove MP3/WAV/ID3, keep only OggS. This is safe because S11-FU-5 (Task 3) will make `tts-edge-tts` output real Ogg. The existing test at line 45 already passes with OggS — it keeps passing. We add a test confirming MP3 now fails.

- [ ] **Step 1: Add MP3-rejects test to `reverify-tts.test.ts` (failing)**

Add this test inside the `describe("reverifyTextToAudio")` block:

```typescript
it("returns pass:false when synthesize.sh produces MP3 output (option a — strict Ogg)", async () => {
  // MP3 MPEG sync word: ff fb
  const capDir = makeCapDir(`#!/usr/bin/env bash
OUTPUT="$2"
printf '\\xff\\xfb\\x90\\x00' > "$OUTPUT"
exit 0
`);
  const result = await reverifyTextToAudio(makeFailure(), makeRegistry(capDir));
  expect(result.pass).toBe(false);
  expect(result.failureMode).toMatch(/header/i);
});

it("returns pass:false when synthesize.sh produces WAV output (option a — strict Ogg)", async () => {
  const capDir = makeCapDir(`#!/usr/bin/env bash
OUTPUT="$2"
printf 'RIFF\\x00\\x00\\x00\\x00' > "$OUTPUT"
exit 0
`);
  const result = await reverifyTextToAudio(makeFailure(), makeRegistry(capDir));
  expect(result.pass).toBe(false);
  expect(result.failureMode).toMatch(/header/i);
});
```

- [ ] **Step 2: Run test — expect both new tests fail (MP3/WAV still accepted)**

```bash
cd packages/core && npx vitest run tests/capabilities/reverify-tts --reporter=verbose 2>&1 | tail -20
```

Expected: the two new tests fail (current code accepts MP3/WAV).

- [ ] **Step 3: Edit `reverify.ts` — remove MP3/WAV/ID3 checks**

Replace lines ~99–106 in `reverifyTextToAudio`:

```typescript
// BEFORE:
  const headerBytes = readFileSync(outputPath).slice(0, 4);
  const headerAscii = headerBytes.toString("ascii");
  // Accept Ogg, WAV/RIFF, MP3 (ID3 tag), and MP3 MPEG sync word (0xFF 0xE0–0xFF)
  const isMpegSync = headerBytes[0] === 0xff && (headerBytes[1] & 0xe0) === 0xe0;
  const validHeader =
    headerAscii.startsWith("OggS") ||
    headerAscii.startsWith("RIFF") ||
    headerAscii.startsWith("ID3") ||
    isMpegSync;
  if (!validHeader) {
    return { pass: false, failureMode: `output file has invalid audio header: ${JSON.stringify(headerAscii)}`, verificationInputPath: scriptPath };
  }
```

```typescript
// AFTER (option a — strict Ogg per template contract; plugs must transcode):
  const headerBytes = readFileSync(outputPath).slice(0, 4);
  const headerAscii = headerBytes.toString("ascii");
  if (!headerAscii.startsWith("OggS")) {
    return {
      pass: false,
      failureMode: `output file is not Ogg (magic: ${JSON.stringify(headerAscii)}); plug must transcode to Ogg per template contract`,
      verificationInputPath: scriptPath,
    };
  }
```

- [ ] **Step 4: Run all reverify-tts tests**

```bash
cd packages/core && npx vitest run tests/capabilities/reverify-tts --reporter=verbose 2>&1 | tail -20
```

Expected: all pass (OggS test still passes; MP3/WAV tests now correctly fail).

- [ ] **Step 5: Type-check**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 6: Write DECISIONS.md entry [ARCHITECT R1 path corrected]**

Create `docs/sprints/m9.6-capability-resilience/s18-DECISIONS.md`:

```markdown
# M9.6-S18 Decisions

## D1 — reverifyTextToAudio format strategy: option (a) strict Ogg

**Chose:** Option (a) — strict Ogg only. Removed MP3/WAV/ID3 checks from `reverifyTextToAudio`.

**Why:** S11-FU-5 (Task 3 this sprint) fixes `tts-edge-tts/scripts/synthesize.sh` to transcode to real Ogg/Opus via ffmpeg. With the plug compliant, reverifier strictness is correct. If future plugs output other formats, they must transcode at the plug side — this is the template contract. Architect confirmed (a) over (b) at plan-review time.

**Risk logged:** if ffmpeg is absent on a machine running tts-edge-tts, the transcode fails and the plug emits CFR. Acceptable — CFR is the correct response to a missing dependency.
```

- [ ] **Step 7: Commit**

```bash
cd /home/nina/my_agent
git add packages/core/src/capabilities/reverify.ts \
        packages/core/tests/capabilities/reverify-tts.test.ts \
        docs/sprints/m9.6-capability-resilience/s18-DECISIONS.md
git commit -m "refactor(reverify): strict Ogg-only in reverifyTextToAudio (S15-FU-4)

Option (a): remove MP3/WAV/ID3 checks; accept OggS only. Plug-side Ogg
compliance enforced by S11-FU-5 (tts-edge-tts ffmpeg transcode). Decision
logged in DECISIONS.md."
```

---

## Task 3: Fix `tts-edge-tts` Ogg contract violation (S11-FU-5)

**Files:**
- Modify: `.my_agent/capabilities/tts-edge-tts/scripts/synthesize.sh`
- Modify: `.my_agent/capabilities/tts-edge-tts/scripts/smoke.sh`

### Background

`edge_tts.Communicate.save()` writes MPEG audio bytes regardless of the file extension. The template contract (`text-to-audio.md`) requires Ogg output. The current `smoke.sh` works around this by checking MP3 magic bytes — that workaround is now deleted, replaced by real Ogg output via ffmpeg transcode.

**Prerequisite:** ffmpeg must be available on the machine. Check with `which ffmpeg`. If absent, install before this task: `sudo apt-get install -y ffmpeg`.

- [ ] **Step 1: Verify ffmpeg is available**

```bash
which ffmpeg && ffmpeg -version 2>&1 | head -1
```

Expected: path + version line. If absent, install ffmpeg before continuing.

- [ ] **Step 2: Edit `synthesize.sh` — add ffmpeg Ogg transcode step**

After the `# --- Verify output ---` section (line 87–93) and before the `# --- Output result ---` section, insert the transcode block. The full replacement for lines 87 onwards:

```bash
# --- Verify raw output ---

FILE_SIZE=$(stat -c %s "$OUTPUT_PATH" 2>/dev/null || stat -f%z "$OUTPUT_PATH" 2>/dev/null || echo 0)
if [[ $FILE_SIZE -lt 100 ]]; then
  echo "Error: output file too small ($FILE_SIZE bytes) — edge-tts synthesis likely failed" >&2
  rm -f "$OUTPUT_PATH"
  exit 1
fi

# --- Transcode to Ogg/Opus (template contract: text-to-audio requires Ogg output) ---
# edge-tts saves MPEG audio regardless of filename extension; ffmpeg converts it.

TRANSCODE_TMP="${OUTPUT_PATH}.opus.ogg"
if ! ffmpeg -i "$OUTPUT_PATH" -c:a libopus -b:a 64k "$TRANSCODE_TMP" -y 2>/dev/null; then
  echo "Error: ffmpeg transcode to Ogg/Opus failed" >&2
  rm -f "$TRANSCODE_TMP"
  exit 1
fi
mv "$TRANSCODE_TMP" "$OUTPUT_PATH"

# Verify Ogg magic bytes (OggS)
MAGIC=$(od -A n -N 4 -t x1 "$OUTPUT_PATH" | tr -d ' \n')
if [[ "$MAGIC" != "4f677353" ]]; then
  echo "Error: output file is not valid Ogg after transcode (magic: $MAGIC)" >&2
  rm -f "$OUTPUT_PATH"
  exit 1
fi

# --- Output result ---

jq -n --arg path "$OUTPUT_PATH" '{"path": $path}'
```

- [ ] **Step 3: Run synthesize.sh manually to verify Ogg output**

```bash
set -a && . packages/dashboard/.env && set +a
OUTFILE="/tmp/test-tts-s18-$(date +%s).ogg"
.my_agent/capabilities/tts-edge-tts/scripts/synthesize.sh "smoke test" "$OUTFILE"
od -A n -N 4 -t x1 "$OUTFILE" | tr -d ' \n'   # should print: 4f677353
file "$OUTFILE"                                  # should say: Ogg data
rm -f "$OUTFILE"
```

Expected: `4f677353` (OggS) and `file` reports Ogg.

- [ ] **Step 4: Edit `smoke.sh` — validate OggS instead of MP3**

Replace the entire `smoke.sh` with:

```bash
#!/usr/bin/env bash
# Smoke test for Edge TTS
# Exit 0 = healthy, exit 2 = SMOKE_SKIPPED, other non-zero = broken
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

OUT="/tmp/smoke-tts-$$.ogg"
trap 'rm -f "$OUT"' EXIT

OUTPUT="$("$DIR/synthesize.sh" "smoke test" "$OUT")"
echo "$OUTPUT" | jq -e '.path != null' > /dev/null

[ -f "$OUT" ] && [ "$(wc -c < "$OUT")" -gt 100 ]

# Validate Ogg magic bytes (OggS = 4f 67 67 53)
MAGIC=$(od -A n -N 4 -t x1 "$OUT" | tr -d ' \n')
if [ "$MAGIC" != "4f677353" ]; then
  echo "Output is not valid Ogg (magic: $MAGIC); synthesize.sh contract violation" >&2
  exit 1
fi
```

- [ ] **Step 5: Run smoke.sh**

```bash
set -a && . packages/dashboard/.env && set +a
bash .my_agent/capabilities/tts-edge-tts/scripts/smoke.sh
echo "exit: $?"
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd /home/nina/my_agent
git add .my_agent/capabilities/tts-edge-tts/scripts/synthesize.sh \
        .my_agent/capabilities/tts-edge-tts/scripts/smoke.sh
git commit -m "fix(tts-edge-tts): transcode to Ogg/Opus via ffmpeg (S11-FU-5)

synthesize.sh: add ffmpeg transcode step after edge-tts synthesis so the
output file contains real Ogg/Opus bytes (not MP3 in a .ogg container).
smoke.sh: validate OggS magic bytes instead of the old MP3 sync-word
workaround."
```

---

## Task 4: Strengthen `text-to-audio` template smoke (S11-FU-2)

**Files:**
- Modify: `skills/capability-templates/text-to-audio.md` (around line 91–109)

### Background

The template's reference `smoke.sh` implementation currently only checks file size (`wc -c > 100`). It does not validate audio format. Since all plugs must output Ogg, add OggS magic-byte validation to the reference implementation.

- [ ] **Step 1: Read the current template smoke section**

```bash
grep -n "OggS\|magic\|smoke\|wc -c\|Reference implementation" skills/capability-templates/text-to-audio.md | head -20
```

- [ ] **Step 2: Replace the reference `smoke.sh` block**

The current reference at lines ~91–105:

```bash
~~~bash
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

OUT="/tmp/smoke-tts-$$.ogg"
trap 'rm -f "$OUT"' EXIT

OUTPUT="$("$DIR/synthesize.sh" "smoke test" "$OUT")"
echo "$OUTPUT" | jq -e '.path != null' > /dev/null

[ -f "$OUT" ] && [ "$(wc -c < "$OUT")" -gt 100 ]
~~~
```

Replace with:

```bash
~~~bash
#!/usr/bin/env bash
# Exit 0 = healthy, exit 2 = SMOKE_SKIPPED, other non-zero = broken
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

OUT="/tmp/smoke-tts-$$.ogg"
trap 'rm -f "$OUT"' EXIT

OUTPUT="$("$DIR/synthesize.sh" "smoke test" "$OUT")"
echo "$OUTPUT" | jq -e '.path != null' > /dev/null

[ -f "$OUT" ] && [ "$(wc -c < "$OUT")" -gt 100 ]

# Validate Ogg magic bytes (OggS = 4f 67 67 53)
MAGIC=$(od -A n -N 4 -t x1 "$OUT" | tr -d ' \n')
if [ "$MAGIC" != "4f677353" ]; then
  echo "Output is not valid Ogg (magic: $MAGIC); plug must transcode to Ogg per contract" >&2
  exit 1
fi
~~~
```

Also update the prose above the reference (line ~86–90) to mention Ogg validation:

```markdown
**Contract:**
- Calls `synthesize.sh` with a deterministic phrase
- Validates the JSON output has a `path` field
- Validates the output file exists and exceeds 100 bytes
- Validates Ogg magic bytes (`OggS`) — plugs must output Ogg/Opus format
- Cleans up temp files on exit
```

- [ ] **Step 3: Commit**

```bash
cd /home/nina/my_agent
git add skills/capability-templates/text-to-audio.md
git commit -m "docs(template): text-to-audio smoke validates OggS magic bytes (S11-FU-2)

Reference smoke.sh now validates Ogg magic bytes in addition to file size.
All text-to-audio plug implementations must output Ogg-format audio."
```

---

## Task 5: Split transport interface + new app.ts functions

**Files:**
- Modify: `packages/dashboard/src/channels/message-handler.ts:27–46` (MessageHandlerDeps interface)
- Modify: `packages/dashboard/src/app.ts:981–998` (replace sendAudioViaTransport closure)
- Create: `packages/dashboard/tests/integration/tts-paths.test.ts` (skeleton, tests added in Task 6)

### Background

`MessageHandlerDeps` currently has `sendAudioViaTransport?(transportId, to, text, language)`. This will be replaced by:
- `sendAudioUrlViaTransport?(transportId, to, audioUrl)` — reads the already-synthesized file from disk and calls `bp.sendAudio()`
- `sendTextViaTransport?(transportId, to, text)` — explicit text fallback, boolean return

`sendAudioUrlViaTransport` reads the file at `<agentDir>/audio/<basename>` (the path that `chat-service.synthesizeAudio` writes to, exposed as `/api/assets/audio/<basename>`).

- [ ] **Step 1: Create tts-paths.test.ts skeleton (failing — deps don't exist yet)**

```typescript
// packages/dashboard/tests/integration/tts-paths.test.ts
/**
 * Tests for message-handler fallback table (M9.6-S18).
 * One test per row of the per-path fallback table in plan-phase3-refinements.md §2.3.
 */

import { describe, it, expect, vi } from "vitest";
// Tests are added in Task 6 once MessageHandlerDeps is updated.
// This file is a placeholder to verify the test runner picks it up.

describe("tts-paths — fallback table (placeholder)", () => {
  it("test file loads", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Update `MessageHandlerDeps` interface in `message-handler.ts`**

Replace lines 36–42 (the `sendAudioViaTransport` dep):

```typescript
// BEFORE:
  /** Send a voice reply (audio buffer) via transport. Returns true if sent. */
  sendAudioViaTransport?: (
    transportId: string,
    to: string,
    text: string,
    language?: string,
  ) => Promise<boolean>;
```

```typescript
// AFTER:
  /**
   * Send an already-synthesized audio file via transport. Receives the `/api/assets/audio/`
   * URL produced by chat-service.synthesizeAudio; reads from disk and calls bp.sendAudio.
   * Returns true if sent successfully.
   */
  sendAudioUrlViaTransport?: (
    transportId: string,
    to: string,
    audioUrl: string,
  ) => Promise<boolean>;
  /**
   * Send a text reply via transport. Used as explicit fallback when TTS fails or
   * for error messages on voice-input turns. Returns true if sent.
   */
  sendTextViaTransport?: (
    transportId: string,
    to: string,
    text: string,
  ) => Promise<boolean>;
```

- [ ] **Step 3: Type-check dashboard (expect errors — app.ts still passes old dep)**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: errors about `sendAudioViaTransport` not existing on deps type.

- [ ] **Step 4: Add `sendAudioUrlViaTransport` closure in `app.ts`**

In `packages/dashboard/src/app.ts`, replace the `sendAudioViaTransport` closure (lines 981–998) with two new closures:

```typescript
// REPLACE lines ~981–998 with:
sendAudioUrlViaTransport: async (
  transportId: string,
  to: string,
  audioUrl: string,
): Promise<boolean> => {
  const plugins = app.transportManager!.getPlugins();
  const plugin = plugins.find((p) => p.id === transportId);
  if (!plugin || !("sendAudio" in plugin)) return false;
  const bp = plugin as BaileysPlugin;

  // audioUrl is "/api/assets/audio/<filename>" — resolve to agentDir/audio/<filename>
  const filename = audioUrl.split("/").pop();
  if (!filename) return false;
  const filePath = join(agentDir, "audio", filename);
  if (!existsSync(filePath)) {
    console.warn(`[App] sendAudioUrlViaTransport: file not found: ${filePath}`);
    return false;
  }

  try {
    const audioBuffer = readFileSync(filePath);
    await bp.sendAudio(to, audioBuffer);
    return true;
  } catch (err) {
    console.warn("[App] sendAudioUrlViaTransport failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
},
sendTextViaTransport: async (
  transportId: string,
  to: string,
  text: string,
): Promise<boolean> => {
  try {
    await app.transportManager!.send(transportId, to, { content: text });
    return true;
  } catch (err) {
    console.warn("[App] sendTextViaTransport failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
},
```

- [ ] **Step 5: Type-check dashboard**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: zero errors (or only errors about the old `sendAudioViaTransport` usage in message-handler.ts body — those are fixed in Task 6).

- [ ] **Step 6: Commit (interface + new functions, old usage not yet removed)**

```bash
cd /home/nina/my_agent
git add packages/dashboard/src/channels/message-handler.ts \
        packages/dashboard/src/app.ts \
        packages/dashboard/tests/integration/tts-paths.test.ts
git commit -m "feat(tts): split transport interface — sendAudioUrlViaTransport + sendTextViaTransport (S18)

MessageHandlerDeps: replace sendAudioViaTransport with two explicit functions.
app.ts: add sendAudioUrlViaTransport (reads file, calls bp.sendAudio) and
sendTextViaTransport (text fallback). Old sendAudioViaTransport removed from
deps. message-handler body update follows in next commit."
```

---

## Task 6: Update `message-handler` to capture `audioUrl` and follow fallback table

**Files:**
- Modify: `packages/dashboard/src/channels/message-handler.ts:560–602`
- Modify: `packages/dashboard/tests/integration/tts-paths.test.ts`

### Background

The fallback table from §2.3:

| Path | New behavior |
|------|-------------|
| Split `done` with `splitAudioUrl` | send audio via `sendAudioUrlViaTransport` if `first.isVoiceNote`; text fallback otherwise |
| Final `done` with `audioUrl` | send audio via `sendAudioUrlViaTransport` if `first.isVoiceNote` |
| `done` with empty/absent `audioUrl` | explicit text fallback via `sendTextViaTransport` if voice input; else `sendViaTransport` |
| `error` event catch path | send error text via `sendTextViaTransport` (not audio, even for voice) |
| Tool-only turn (empty text) | log and skip — nothing sent |

The streaming loop events arrive in order: `text_delta*`, `done` (split), `turn_advanced`, `start`, `text_delta*`, `done` (final). We capture `audioUrl` from every `done` event into `capturedAudioUrl`. The `turn_advanced` case uses `capturedAudioUrl` (for the split path), then resets it. After the loop, `capturedAudioUrl` holds the final done's `audioUrl`.

- [ ] **Step 1: Update `message-handler.ts` streaming loop and final send block**

Locate the streaming loop variables (around line 530) and add `capturedAudioUrl`:

```typescript
// After existing variable declarations (currentText, detectedLanguage, etc.):
let capturedAudioUrl: string | undefined;
```

Update `case "done"` (around line 571–575):

```typescript
case "done":
  if ("audioUrl" in event && event.audioUrl) {
    capturedAudioUrl = event.audioUrl;
  }
  if ("detectedLanguage" in event && event.detectedLanguage) {
    detectedLanguage = event.detectedLanguage;
  }
  break;
```

Update `case "turn_advanced"` (around line 564–569) to send audio or text for the split turn:

```typescript
case "turn_advanced":
  if (first.isVoiceNote && capturedAudioUrl && this.deps.sendAudioUrlViaTransport) {
    await this.deps.sendAudioUrlViaTransport(channelId, replyTo, capturedAudioUrl);
  } else if (currentText.trim()) {
    await this.deps.sendViaTransport(channelId, replyTo, { content: currentText });
  }
  capturedAudioUrl = undefined;
  currentText = "";
  isFirstMessage = false;
  break;
```

Replace the final send block (lines 586–602) with the fallback table implementation:

```typescript
// ── Send final response via channel ──────────────────────────────
if (first.isVoiceNote && capturedAudioUrl && this.deps.sendAudioUrlViaTransport) {
  // Voice input + synthesized audio ready — send as voice note
  const sent = await this.deps.sendAudioUrlViaTransport(channelId, replyTo, capturedAudioUrl);
  if (!sent) {
    // Audio send failed — fall back to text
    await this.deps.sendViaTransport(channelId, replyTo, { content: currentText });
  }
} else if (first.isVoiceNote && !capturedAudioUrl && this.deps.sendTextViaTransport && currentText.trim()) {
  // Voice input + TTS failed (no audioUrl) — explicit text fallback
  await this.deps.sendTextViaTransport(channelId, replyTo, currentText);
} else if (currentText.trim() || isFirstMessage) {
  // Text input, or voice input without TTS capability — normal text reply
  await this.deps.sendViaTransport(channelId, replyTo, { content: currentText });
} else {
  // Tool-only turn — empty assistant content, nothing to send
  console.log("[ChannelMessageHandler] Tool-only turn — skipping send");
}
```

- [ ] **Step 1.5 [ARCHITECT S4]: Verify ChannelMessageHandler API matches the mock structure BEFORE writing tests**

The Step 2 test file below assumes a specific mock shape (deps interface, `handleMessages(channelId, messages[])` signature, message field shape `{id, from, body, timestamp, isVoiceNote, audioPath, detectedLanguage}`). Before committing the test code, verify these against the actual class:

```bash
grep -n "class ChannelMessageHandler\|handleMessages\|isVoiceNote\|audioPath" packages/dashboard/src/channels/message-handler.ts | head -20
```

Specifically confirm:
- `ChannelMessageHandler` class export name + constructor signature `(deps, channelConfigs)`.
- `handleMessages(channelId: string, messages: SomeShape[]): Promise<void>` — name + signature.
- The message-shape interface (verify field names: `isVoiceNote`, `audioPath`, `detectedLanguage`, `from`).
- `MessageHandlerDeps` properties used in the mock (especially `app.chat.sendMessage` returning an `AsyncGenerator`).

If any field name or signature differs, **adjust the mock structure in Step 2 before committing**. Don't write speculative tests then debug later — verify first, write once.

- [ ] **Step 2: Replace the `tts-paths.test.ts` placeholder with actual tests**

The file currently has just a placeholder from Task 5. Replace its entire contents with: These tests use a mock `App` that returns a pre-configured event stream from `chat.sendMessage`, and mock transport deps. **One test per row of the per-path fallback table** (5 rows total per spec §2.3). Adjust the mock shape per Step 1.5 verification.

```typescript
/**
 * Tests for message-handler fallback table (M9.6-S18).
 * One test per row of the per-path fallback table in plan-phase3-refinements.md §2.3.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChannelMessageHandler } from "../../src/channels/message-handler.js";
import type { MessageHandlerDeps } from "../../src/channels/message-handler.js";

// If MessageHandlerDeps is not exported, export it from message-handler.ts (add export keyword).

type EventStream = AsyncGenerator<Record<string, unknown>>;

function makeStream(events: Record<string, unknown>[]): EventStream {
  return (async function* () {
    for (const e of events) yield e;
  })();
}

function makeDeps(overrides: Partial<MessageHandlerDeps> = {}): MessageHandlerDeps {
  return {
    conversationManager: {
      findByChannel: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "conv-1", channelId: "wa", externalId: "jid-1" }),
      get: vi.fn().mockResolvedValue({ id: "conv-1" }),
      appendTurn: vi.fn().mockResolvedValue(undefined),
      getRecentTurns: vi.fn().mockResolvedValue([]),
    } as unknown as MessageHandlerDeps["conversationManager"],
    connectionRegistry: {
      broadcastToConversation: vi.fn(),
      broadcastToAll: vi.fn(),
    } as unknown as MessageHandlerDeps["connectionRegistry"],
    sendViaTransport: vi.fn().mockResolvedValue(undefined),
    sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
    sendAudioUrlViaTransport: vi.fn().mockResolvedValue(true),
    sendTextViaTransport: vi.fn().mockResolvedValue(true),
    agentDir: "/tmp/test-agent",
    app: {
      chat: {
        sendMessage: vi.fn().mockReturnValue(makeStream([
          { type: "text_delta", text: "Hello" },
          { type: "done", audioUrl: undefined },
        ])),
      },
      emit: vi.fn(),
      conversationManager: {
        findByChannel: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "conv-1" }),
        get: vi.fn().mockResolvedValue({ id: "conv-1" }),
        appendTurn: vi.fn().mockResolvedValue(undefined),
        getRecentTurns: vi.fn().mockResolvedValue([]),
      },
    } as unknown as MessageHandlerDeps["app"],
    ...overrides,
  };
}

function makeVoiceMessage() {
  return [{
    id: "msg-1",
    from: "owner",
    body: "",
    timestamp: Date.now(),
    isVoiceNote: true,
    audioPath: "/tmp/test.ogg",
    detectedLanguage: "en",
  }];
}

function makeTextMessage() {
  return [{
    id: "msg-2",
    from: "owner",
    body: "hello",
    timestamp: Date.now(),
    isVoiceNote: false,
  }];
}

function makeHandler(deps: MessageHandlerDeps): ChannelMessageHandler {
  // Pass minimal channel config
  return new ChannelMessageHandler(deps, [
    { channelId: "wa", ownerIdentity: "owner", externalIdentity: "owner", type: "whatsapp" },
  ]);
}

describe("fallback table — final done with audioUrl (voice input)", () => {
  it("sends audio via sendAudioUrlViaTransport when voice input + audioUrl present", async () => {
    const deps = makeDeps({
      app: {
        chat: {
          sendMessage: vi.fn().mockReturnValue(makeStream([
            { type: "text_delta", text: "Reply" },
            { type: "done", audioUrl: "/api/assets/audio/tts-abc.ogg" },
          ])),
        },
        emit: vi.fn(),
        conversationManager: makeDeps().app.conversationManager,
      } as unknown as MessageHandlerDeps["app"],
    });

    const handler = makeHandler(deps);
    await handler.handleMessages("wa", makeVoiceMessage());

    expect(deps.sendAudioUrlViaTransport).toHaveBeenCalledWith("wa", "owner", "/api/assets/audio/tts-abc.ogg");
    expect(deps.sendTextViaTransport).not.toHaveBeenCalled();
    expect(deps.sendViaTransport).not.toHaveBeenCalled();
  });
});

describe("fallback table — final done without audioUrl (voice input + TTS failed)", () => {
  it("falls back to sendTextViaTransport when voice input but audioUrl absent", async () => {
    const deps = makeDeps({
      app: {
        chat: {
          sendMessage: vi.fn().mockReturnValue(makeStream([
            { type: "text_delta", text: "Sorry, voice reply failed" },
            { type: "done" }, // no audioUrl
          ])),
        },
        emit: vi.fn(),
        conversationManager: makeDeps().app.conversationManager,
      } as unknown as MessageHandlerDeps["app"],
    });

    const handler = makeHandler(deps);
    await handler.handleMessages("wa", makeVoiceMessage());

    expect(deps.sendTextViaTransport).toHaveBeenCalledWith("wa", "owner", "Sorry, voice reply failed");
    expect(deps.sendAudioUrlViaTransport).not.toHaveBeenCalled();
  });
});

describe("fallback table — text input (not voice note)", () => {
  it("uses sendViaTransport for text input regardless of audioUrl", async () => {
    const deps = makeDeps({
      app: {
        chat: {
          sendMessage: vi.fn().mockReturnValue(makeStream([
            { type: "text_delta", text: "Text reply" },
            { type: "done", audioUrl: "/api/assets/audio/tts-xyz.ogg" },
          ])),
        },
        emit: vi.fn(),
        conversationManager: makeDeps().app.conversationManager,
      } as unknown as MessageHandlerDeps["app"],
    });

    const handler = makeHandler(deps);
    await handler.handleMessages("wa", makeTextMessage());

    expect(deps.sendViaTransport).toHaveBeenCalledWith("wa", "owner", { content: "Text reply" });
    expect(deps.sendAudioUrlViaTransport).not.toHaveBeenCalled();
  });
});

describe("fallback table — tool-only turn (empty text)", () => {
  it("skips send when assistant text is empty", async () => {
    const deps = makeDeps({
      app: {
        chat: {
          sendMessage: vi.fn().mockReturnValue(makeStream([
            { type: "done" }, // no text_delta, no audioUrl
          ])),
        },
        emit: vi.fn(),
        conversationManager: makeDeps().app.conversationManager,
      } as unknown as MessageHandlerDeps["app"],
    });

    const handler = makeHandler(deps);
    await handler.handleMessages("wa", makeTextMessage());

    expect(deps.sendViaTransport).not.toHaveBeenCalled();
    expect(deps.sendAudioUrlViaTransport).not.toHaveBeenCalled();
    expect(deps.sendTextViaTransport).not.toHaveBeenCalled();
  });
});

// [ARCHITECT R3] Missing rows added to cover all 5 fallback-table cases per spec §2.3

describe("fallback table — split done with splitAudioUrl (voice input)", () => {
  it("turn_advanced sends audio via sendAudioUrlViaTransport when split-done has audioUrl + isVoiceNote", async () => {
    const deps = makeDeps({
      app: {
        chat: {
          sendMessage: vi.fn().mockReturnValue(makeStream([
            { type: "text_delta", text: "First half" },
            { type: "done", audioUrl: "/api/assets/audio/tts-split-1.ogg" },
            { type: "turn_advanced" },
            { type: "text_delta", text: "Second half" },
            { type: "done", audioUrl: "/api/assets/audio/tts-final-2.ogg" },
          ])),
        },
        emit: vi.fn(),
        conversationManager: makeDeps().app.conversationManager,
      } as unknown as MessageHandlerDeps["app"],
    });

    const handler = makeHandler(deps);
    await handler.handleMessages("wa", makeVoiceMessage());

    // Both split + final audio URLs sent via sendAudioUrlViaTransport
    expect(deps.sendAudioUrlViaTransport).toHaveBeenNthCalledWith(1, "wa", "owner", "/api/assets/audio/tts-split-1.ogg");
    expect(deps.sendAudioUrlViaTransport).toHaveBeenNthCalledWith(2, "wa", "owner", "/api/assets/audio/tts-final-2.ogg");
    expect(deps.sendAudioUrlViaTransport).toHaveBeenCalledTimes(2);
    expect(deps.sendTextViaTransport).not.toHaveBeenCalled();
  });

  it("turn_advanced sends text via sendViaTransport when split-done lacks audioUrl OR not voice input", async () => {
    const deps = makeDeps({
      app: {
        chat: {
          sendMessage: vi.fn().mockReturnValue(makeStream([
            { type: "text_delta", text: "Split text" },
            { type: "done" }, // no audioUrl
            { type: "turn_advanced" },
            { type: "text_delta", text: "Final" },
            { type: "done" },
          ])),
        },
        emit: vi.fn(),
        conversationManager: makeDeps().app.conversationManager,
      } as unknown as MessageHandlerDeps["app"],
    });

    const handler = makeHandler(deps);
    await handler.handleMessages("wa", makeTextMessage()); // text input — not voice

    // Split path uses sendViaTransport (text), no audio attempts
    expect(deps.sendViaTransport).toHaveBeenCalledWith("wa", "owner", { content: "Split text" });
    expect(deps.sendAudioUrlViaTransport).not.toHaveBeenCalled();
  });
});

describe("fallback table — error event catch path", () => {
  it("voice input + error event sends text via sendTextViaTransport (no audio invented for errors)", async () => {
    const deps = makeDeps({
      app: {
        chat: {
          sendMessage: vi.fn().mockReturnValue(makeStream([
            { type: "text_delta", text: "Partial response..." },
            { type: "error", error: "stream interrupted" },
          ])),
        },
        emit: vi.fn(),
        conversationManager: makeDeps().app.conversationManager,
      } as unknown as MessageHandlerDeps["app"],
    });

    const handler = makeHandler(deps);
    await handler.handleMessages("wa", makeVoiceMessage()); // voice input

    // Error path: text fallback used, even for voice input — don't synthesize audio for error strings
    expect(deps.sendTextViaTransport).toHaveBeenCalled();
    const sendTextCall = (deps.sendTextViaTransport as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sendTextCall?.[0]).toBe("wa");
    expect(sendTextCall?.[1]).toBe("owner");
    expect(String(sendTextCall?.[2])).toMatch(/error|interrupted|sorry|failed/i);
    expect(deps.sendAudioUrlViaTransport).not.toHaveBeenCalled();
  });
});
```

**Note:** the error-path test asserts the error message routes through `sendTextViaTransport` and matches a generic error-language regex. If the existing error-handling code in `message-handler.ts` produces a different error string format, adjust the regex — the key invariant is "error → text path, never audio." If the current `case "error"` doesn't route through `sendTextViaTransport` at all (i.e., uses `sendViaTransport` directly), change the test's expectation accordingly. The fallback-table row exists to formalize the "no audio for errors" rule; the implementation may already satisfy it via a different transport call.

**Note:** If `MessageHandlerDeps` is not exported from `message-handler.ts`, add `export` to the interface declaration before running tests.

- [ ] **Step 3: Export `MessageHandlerDeps` from `message-handler.ts`**

In `message-handler.ts` line 27, change:

```typescript
// BEFORE:
interface MessageHandlerDeps {
```

```typescript
// AFTER:
export interface MessageHandlerDeps {
```

- [ ] **Step 4: Run tts-paths tests**

```bash
cd packages/dashboard && npx vitest run tests/integration/tts-paths --reporter=verbose 2>&1 | tail -30
```

Expected: tests pass. If the `ChannelMessageHandler` import or mock structure doesn't align with the actual class, adjust the mock accordingly.

- [ ] **Step 5: Type-check dashboard**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
cd /home/nina/my_agent
git add packages/dashboard/src/channels/message-handler.ts \
        packages/dashboard/tests/integration/tts-paths.test.ts
git commit -m "feat(message-handler): capture audioUrl from done events; implement fallback table (S18)

message-handler now captures audioUrl from every done event. turn_advanced
sends split-turn audio via sendAudioUrlViaTransport when available. Final
send block follows the per-path fallback table from §2.3:
- voice + audioUrl → sendAudioUrlViaTransport
- voice + no audioUrl → sendTextViaTransport (explicit text fallback)
- text input → sendViaTransport
- tool-only (empty text) → log and skip"
```

---

## Task 7: Delete Baileys duplicate synthesis path

**Files:**
- Modify: `packages/dashboard/src/app.ts:2323–2358` (delete `wireAudioCallbacks`)
- Modify: `packages/dashboard/src/app.ts:966` (remove `wireAudioCallbacks(plugin, app)` call)
- Modify: `packages/dashboard/src/app.ts` (remove dead imports from `wireAudioCallbacks`: `execFileAsync`, `tmpdir`, `randomUUID`, `prepareForSpeech` if only used there)

### Background

`wireAudioCallbacks()` (line 2323) assigns `plugin.onSendVoiceReply` — the second synthesis path. After Task 5 replaced `sendAudioViaTransport` with `sendAudioUrlViaTransport`, the old `sendAudioViaTransport` closure (which called `bp.onSendVoiceReply`) is already gone from the deps wiring. Now we delete the `wireAudioCallbacks` function itself and its call at line 966.

`BaileysPlugin.onSendVoiceReply` (plugin.ts line 188) stays as `null` — nothing writes to it after this task. `BaileysPlugin.sendAudio` (plugin.ts line 816) stays — `sendAudioUrlViaTransport` now calls it directly via the buffer read.

- [ ] **Step 0.5 [ARCHITECT S3]: Verify `wireAudioCallbacks` has no other side effects before deletion**

Background asserts the function only assigns `plugin.onSendVoiceReply`. **Verify before deleting:**

```bash
sed -n '/^function wireAudioCallbacks/,/^}/p' packages/dashboard/src/app.ts | head -50
```

Read the full function body. Confirm it ONLY assigns `onSendVoiceReply`. If it also touches:
- Logging / metrics / event emission → those move elsewhere or get logged in DEVIATIONS.md before deletion.
- Plugin lifecycle hooks (init / teardown / state) → STOP and file `proposals/s18-wire-audio-side-effects.md`. Don't delete.
- Other plugin properties → name them; decide whether to preserve elsewhere or document the removal as intentional.

Document the verification in `s18-DECISIONS.md` D3 (new entry) — one line confirming the function's sole effect was `onSendVoiceReply` assignment, OR naming any additional effects + their disposition.

- [ ] **Step 1: Delete `wireAudioCallbacks` function and its call site**

In `packages/dashboard/src/app.ts`:

1. Remove the call at line ~966: `wireAudioCallbacks(plugin, app);`

2. Delete the entire `wireAudioCallbacks` function (lines ~2317–2358):
```
// ─────────────────────────────────────────────────────────────────
// Audio callback wiring (WhatsApp voice notes ↔ capability registry)
// ─────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

function wireAudioCallbacks(plugin: BaileysPlugin, app: App): void {
  // ...
}
```

- [ ] **Step 2: Remove dead imports if only used by `wireAudioCallbacks`**

Check which imports `wireAudioCallbacks` exclusively used. The function used:
- `execFile` + `promisify` — check if still used elsewhere in app.ts
- `tmpdir` — check if still used elsewhere
- `randomUUID` — check if still used elsewhere
- `prepareForSpeech` from `./chat/chat-service.js` — check if still used elsewhere

```bash
grep -n "execFileAsync\|execFile\b\|promisify\|tmpdir\|randomUUID\|prepareForSpeech" packages/dashboard/src/app.ts
```

Remove only imports that are now fully unused.

**Note:** `execFile` is declared at the top-level import. The `execFileAsync = promisify(execFile)` at line 2321 was local to the wireAudioCallbacks section — that whole block deletes. The top-level `execFile` import may still be used elsewhere; check before removing.

- [ ] **Step 3: Type-check dashboard**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Expected: zero errors.

- [ ] **Step 4: Run tts-paths tests to confirm nothing regressed**

```bash
cd packages/dashboard && npx vitest run tests/integration/tts-paths --reporter=verbose 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 5: Clean up duplicate JSDoc comment in `chat-service.ts`**

In `packages/dashboard/src/chat/chat-service.ts`, lines 1093–1109 have two JSDoc comments for `synthesizeAudio` — the stale `TODO(S15/S18)` one at 1093–1099 and the correct S15 one at 1101–1109. Remove the stale block:

```typescript
// REMOVE this stale JSDoc (lines 1093–1099):
  /**
   * Synthesize audio via the TTS capability script.
   * Returns the audio file path or null.
   *
   * TODO(S15/S18): route through CapabilityInvoker so TTS failures emit CFR.
   * Deferred per plan-phase2-coverage.md §2.2 — S15 may pre-wire if exit gate
   * needs it; S18 (Phase 3, "Duplicate TTS path collapse") formalizes.
   */
```

Keep the S15 JSDoc (lines 1101–1109, which no longer needs the S18 reference either):

```typescript
  /**
   * Synthesize audio via the TTS capability script.
   * Returns the audio URL path or null.
   *
   * Routed through CapabilityInvoker (M9.6-S15) so TTS failures emit CFR
   * automatically. Falls back to silent null return when capabilityInvoker
   * is not wired (unit tests, hatching).
   */
```

- [ ] **Step 6: Commit**

```bash
cd /home/nina/my_agent
git add packages/dashboard/src/app.ts \
        packages/dashboard/src/chat/chat-service.ts
git commit -m "refactor(tts): delete Baileys onSendVoiceReply synthesis path (S18)

wireAudioCallbacks deleted. Nothing assigns plugin.onSendVoiceReply anymore.
sendAudioUrlViaTransport reads the file chat-service already synthesized and
calls bp.sendAudio directly — one synthesis path per voice turn.
Stale TODO(S15/S18) comment in chat-service.ts cleaned up."
```

---

## Task 8: Voice-reply regression test + CFR single-emit test

**Files:**
- Create: `packages/dashboard/tests/integration/voice-reply-regression.test.ts`
- Create: `packages/dashboard/tests/integration/cfr-tts-single-emit.test.ts`

### Background

Two additional acceptance tests from §2.3:

**`voice-reply-regression.test.ts`:** Voice input → assistant reply → voice output. Confirms the healthy path works after the collapse and matches what S15 verified.

**`cfr-tts-single-emit.test.ts`:** Break TTS → send a voice-eligible reply → confirm CFR emits exactly once (not twice as it could when both paths were active).

These tests run against the `AppHarness` (headless App) per `docs/design/headless-api.md`. Since we can't run real LLM calls in CI, we mock the brain's stream. The CFR-single-emit test mocks the CapabilityInvoker to always return failure, then checks that only one CFR event fires.

- [ ] **Step 1: Create `voice-reply-regression.test.ts`**

```typescript
/**
 * Voice reply regression test (M9.6-S18).
 *
 * Confirms the healthy path after TTS path collapse:
 * voice input → chat-service synthesizes audio → message-handler sends audio URL.
 * Fails if message-handler falls back to re-synthesis or sends text instead.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("voice reply — healthy path regression (S18)", () => {
  it("message-handler sends audioUrl from done event, not re-synthesized text", async () => {
    // Arrange: mock deps where chat.sendMessage yields a done event with audioUrl
    const sendAudioUrlViaTransport = vi.fn().mockResolvedValue(true);
    const sendTextViaTransport = vi.fn().mockResolvedValue(true);
    const sendViaTransport = vi.fn().mockResolvedValue(undefined);

    const AUDIO_URL = "/api/assets/audio/tts-regression-test.ogg";

    // Mock the App's chat.sendMessage to return a stream with audioUrl in done
    const { ChannelMessageHandler } = await import("../../src/channels/message-handler.js");

    const mockApp = {
      chat: {
        sendMessage: vi.fn().mockReturnValue((async function* () {
          yield { type: "text_delta", text: "Your reply" };
          yield { type: "done", audioUrl: AUDIO_URL };
        })()),
      },
      emit: vi.fn(),
      conversationManager: {
        findByChannel: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "c1", channelId: "wa", externalId: "jid-1" }),
        get: vi.fn().mockResolvedValue({ id: "c1" }),
        appendTurn: vi.fn().mockResolvedValue(undefined),
        getRecentTurns: vi.fn().mockResolvedValue([]),
        setTitle: vi.fn(),
        setTopics: vi.fn(),
      },
    } as unknown as InstanceType<typeof import("../../src/app.js").App>;

    const handler = new ChannelMessageHandler(
      {
        conversationManager: mockApp.conversationManager,
        connectionRegistry: {
          broadcastToConversation: vi.fn(),
          broadcastToAll: vi.fn(),
        } as never,
        sendViaTransport,
        sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
        sendAudioUrlViaTransport,
        sendTextViaTransport,
        agentDir: "/tmp/test-agent",
        app: mockApp,
      },
      [{ channelId: "wa", ownerIdentity: "jid-1", externalIdentity: "jid-1", type: "whatsapp" }],
    );

    // Act: send a voice message
    await handler.handleMessages("wa", [{
      id: "voice-msg-1",
      from: "jid-1",
      body: "",
      timestamp: Date.now(),
      isVoiceNote: true,
      audioPath: "/tmp/fake-audio.ogg",
    }]);

    // Assert: audio URL sent, text not sent
    expect(sendAudioUrlViaTransport).toHaveBeenCalledWith("wa", "jid-1", AUDIO_URL);
    expect(sendTextViaTransport).not.toHaveBeenCalled();
    expect(sendViaTransport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Create `cfr-tts-single-emit.test.ts`**

```typescript
/**
 * CFR single-emit test (M9.6-S18).
 *
 * Before S18: two synthesis paths could both fire when TTS failed.
 * The Baileys onSendVoiceReply path would re-try, potentially triggering
 * a second CFR event via the direct execFile path (no CapabilityInvoker).
 *
 * After S18: only chat-service.synthesizeAudio fires; single CFR emit guaranteed.
 *
 * Test approach: inject a CapabilityInvoker that always fails for text-to-audio;
 * count CFR events emitted by the App.
 */

import { describe, it, expect, vi } from "vitest";

describe("TTS failure — CFR emits exactly once (S18)", () => {
  it("one CFR event when text-to-audio invoker fails on voice turn", async () => {
    // Track CFR events emitted
    const cfrEmits: unknown[] = [];

    // Mock a CapabilityInvoker that always fails for text-to-audio
    const failingInvoker = {
      run: vi.fn().mockImplementation(async (opts: { capabilityType: string }) => {
        if (opts.capabilityType === "text-to-audio") {
          return { kind: "failure", detail: "tts-test-failure" };
        }
        return { kind: "success", parsed: { text: "transcribed" } };
      }),
    };

    // Minimal mock App with CFR event tracking
    const mockApp = {
      capabilityInvoker: failingInvoker,
      chat: {
        sendMessage: vi.fn().mockReturnValue((async function* () {
          yield { type: "text_delta", text: "Reply text" };
          // synthesizeAudio is called here internally; it will fail → no audioUrl
          yield { type: "done", audioUrl: undefined };
        })()),
      },
      emit: vi.fn().mockImplementation((event: string, ...args: unknown[]) => {
        if (event === "capability:failure") {
          cfrEmits.push(args);
        }
      }),
      conversationManager: {
        findByChannel: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "c1", channelId: "wa", externalId: "jid-1" }),
        get: vi.fn().mockResolvedValue({ id: "c1" }),
        appendTurn: vi.fn().mockResolvedValue(undefined),
        getRecentTurns: vi.fn().mockResolvedValue([]),
        setTitle: vi.fn(),
        setTopics: vi.fn(),
      },
    } as unknown as InstanceType<typeof import("../../src/app.js").App>;

    const { ChannelMessageHandler } = await import("../../src/channels/message-handler.js");

    const handler = new ChannelMessageHandler(
      {
        conversationManager: mockApp.conversationManager,
        connectionRegistry: { broadcastToConversation: vi.fn(), broadcastToAll: vi.fn() } as never,
        sendViaTransport: vi.fn().mockResolvedValue(undefined),
        sendTypingIndicator: vi.fn().mockResolvedValue(undefined),
        sendAudioUrlViaTransport: vi.fn().mockResolvedValue(true),
        sendTextViaTransport: vi.fn().mockResolvedValue(true),
        agentDir: "/tmp/test-agent",
        app: mockApp,
      },
      [{ channelId: "wa", ownerIdentity: "jid-1", externalIdentity: "jid-1", type: "whatsapp" }],
    );

    await handler.handleMessages("wa", [{
      id: "v1",
      from: "jid-1",
      body: "",
      timestamp: Date.now(),
      isVoiceNote: true,
      audioPath: "/tmp/audio.ogg",
    }]);

    // [ARCHITECT S2] EXACTLY ONE — not <= 1. With Baileys path deleted,
    // the chat-service path is the sole source of TTS CFR. If 0 emits fire,
    // that means TTS failures aren't reaching the resilience layer at all —
    // a real bug, not an expected outcome. The test catches both:
    //   - 2+ emits → dual-path regression (Baileys path resurrected somehow)
    //   - 0 emits  → TTS detection broken upstream (S15 wiring lost)
    expect(cfrEmits.length).toBe(1);
  });
});
```

**[ARCHITECT S2] note:** the assertion is `=== 1`, not `<= 1`. Trivially-satisfiable bounds (`<=`) accept the broken state where 0 CFR fires (TTS detection absent), which is exactly the silent-failure pattern M9.6 was created to fix. If the test legitimately produces 0 emits because of how the mocked event stream interacts with the real `synthesizeAudio` path, **stop and investigate** — the mock structure may not be exercising the CapabilityInvoker. File `proposals/s18-cfr-emit-test-structure.md` if so. Do not weaken the assertion to make it pass.

- [ ] **Step 3: Run acceptance tests**

```bash
cd packages/dashboard && npx vitest run tests/integration/tts-paths tests/integration/voice-reply-regression tests/integration/cfr-tts-single-emit --reporter=verbose 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 4: Run full core suite (regression gate)**

```bash
cd packages/core && npx vitest run 2>&1 | tail -10
```

Expected: all pass (no regressions to Phase 2 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/nina/my_agent
git add packages/dashboard/tests/integration/voice-reply-regression.test.ts \
        packages/dashboard/tests/integration/cfr-tts-single-emit.test.ts
git commit -m "test(tts): voice-reply regression + CFR single-emit acceptance tests (S18)

voice-reply-regression: confirms sendAudioUrlViaTransport called with done-event
audioUrl, not re-synthesis. cfr-tts-single-emit: confirms TTS failure emits at
most one CFR (Baileys path deleted, only chat-service path remains)."
```

---

## Task 9 [ARCHITECT R2 + S5]: Universal coverage check + sprint artifacts (all four)

**Files [ARCHITECT R1 paths corrected + R2 artifacts complete]:**
- Modify: `docs/sprints/m9.6-capability-resilience/s18-DECISIONS.md` (created in Task 2; expanded here)
- Create: `docs/sprints/m9.6-capability-resilience/s18-DEVIATIONS.md` **[ARCHITECT R2]**
- Create: `docs/sprints/m9.6-capability-resilience/s18-FOLLOW-UPS.md`
- Create: `docs/sprints/m9.6-capability-resilience/s18-test-report.md` **[ARCHITECT R2]**

### Background

Per §0.1 of plan-phase3-refinements.md: confirm TTS detection flows through the same CapabilityInvoker gate as STT. Confirm S15's TTS replay test still passes.

Per §0.3 (carried into Phase 3): the dev MUST produce DECISIONS, DEVIATIONS, FOLLOW-UPS, and test-report. S16 originally missed two of these; S17 fixed the gap; S18 must keep it.

- [ ] **Step 1: Run Phase 2 TTS replay test**

```bash
cd packages/dashboard && npx vitest run tests/e2e/cfr-phase2-tts-replay --reporter=verbose 2>&1 | tail -20
```

Expected: pass. If it fails, investigate before marking sprint done.

- [ ] **Step 2: Run full dashboard test suite**

```bash
cd packages/dashboard && npx vitest run 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 3: Verify smoke tests for all plug types**

```bash
set -a && . packages/dashboard/.env && set +a
for s in .my_agent/capabilities/*/scripts/smoke.sh; do
  echo "=== $s ==="
  bash "$s" && echo "OK" || echo "FAIL: exit $?"
done
```

Expected: all exit 0 (or SMOKE_SKIPPED exit 2 for plugs that need hardware).

- [ ] **Step 4: Document Reverifier type note in DECISIONS.md [ARCHITECT S5 expanded]**

Add to `docs/sprints/m9.6-capability-resilience/s18-DECISIONS.md`:

```markdown
## D2 — Reverifier type: kept `invoker?` optional at the type level (interim)

**Chose:** Keep `Reverifier` type and `dispatchReverify` signature with `invoker?: CapabilityInvoker` (optional). Only `reverifyAudioToText` adds a runtime guard (returns `pass: false` when absent).

**Why:** Making the type fully required cascades to `dispatchReverify`, the orchestrator deps, and all existing tests. The runtime guard achieves the behavioral goal (no bash wrapper) without a broad refactor. The spec's "assert/throw if not present" is satisfied by the guard.

**Interim safety guidance:** Until the type is tightened, every reverifier-call site MUST be code-reviewed for invoker presence. `dispatchReverify` is the gate — any new call site that goes through it gets the runtime guard, but new caller code that bypasses `dispatchReverify` and calls a per-type reverifier directly will not.

**Target sprint for type tightening:** **S20** (final exit gate — natural place for a no-behavior-change refactor pass alongside the AppHarness mock-transport extension). If S20 is too crowded, escalate to a dedicated post-M9.6 cleanup. Don't leave this loose past M9.6 close.

## D3 — wireAudioCallbacks side-effect verification (per ARCHITECT S3)

**Verified:** `wireAudioCallbacks` in `app.ts` only assigns `plugin.onSendVoiceReply` and [add: any logging / metrics / lifecycle effects discovered, OR "no other side effects"]. Deletion is safe.

**Evidence:** `sed -n '/^function wireAudioCallbacks/,/^}/p' packages/dashboard/src/app.ts` — function body inspected at sprint-time, [N] lines, [single-purpose | other effects: ...].
```

- [ ] **Step 5: Create `s18-DEVIATIONS.md` [ARCHITECT R2]**

Index every `proposals/s18-*.md` file authored. If none filed, the file states that with one line.

```markdown
---
sprint: m9.6-s18
---

# S18 Deviations

## (none filed) — confirm at sprint-end
[OR list each: DEV-1 ... — title — link to proposal — resolution]
```

- [ ] **Step 6: Create `s18-FOLLOW-UPS.md`**

Per §0.1 universal-coverage rule: S18 doesn't add a new generic layer (it removes a duplicate path), so the rule technically doesn't apply. Confirm in this file:

```markdown
---
sprint: m9.6-s18
---

# S18 Follow-Ups

## §0.1 universal-coverage rule
S18 removes the duplicate Baileys synthesis path — no new generic layer added.
The §0.1 rule technically N/A. The four §0.5 Phase 2 deferrals all apply
uniformly to TTS plugs through the existing CapabilityInvoker gate.

## Inherited deferrals — landing confirmation
All §0.5 Phase 2 deferrals confirmed landed:
- S10-FU-2 / S13-FU-1: bash wrapper removed ✓
- S11-FU-2: template smoke validates OggS ✓
- S11-FU-5: tts-edge-tts transcodes to Ogg ✓
- S15-FU-4: reverifyTextToAudio Ogg-strict ✓ (option a per architect confirmation)

## Out-of-scope items noticed during the sprint (if any)
[list per format: FU-N — title — why deferred — target sprint]

## D2 follow-up (Reverifier type tightening)
Target: S20 per D2. Watch for it in S19/S20 plan reviews.
```

- [ ] **Step 7: Create `s18-test-report.md` [ARCHITECT R2]**

Verification command output for every test added/touched in S18 + regression sweep + tsc both packages. Format per Phase 1 / Phase 2 / S17 reports. Capture command lines, test counts, and any noted variance.

```markdown
---
sprint: M9.6-S18
title: Test report
date: 2026-04-19
branch: sprint/m9.6-s18-tts-path-collapse
---

# S18 Test Report

## New tests added
| File | Tests | Result |
|------|-------|--------|
| `tests/capabilities/reverify-audio-to-text.test.ts` | 5 | ✓ |
| `tests/capabilities/reverify-tts.test.ts` (new MP3/WAV-rejects cases) | +2 | ✓ |
| `tests/integration/tts-paths.test.ts` (5 fallback rows) | 5 | ✓ |
| `tests/integration/voice-reply-regression.test.ts` | 1 | ✓ |
| `tests/integration/cfr-tts-single-emit.test.ts` (=== 1 assertion) | 1 | ✓ |
| **Total new** | **14** | **all pass** |

## Modified tests
- `tests/capabilities/reverify-dispatch.test.ts` — audio-to-text routing test now passes mock invoker.

## Suites run
| Suite | Result |
|---|---|
| `packages/core/tests/capabilities/` | [N] pass / [M] skip / 0 fail |
| `packages/dashboard/tests/integration/` | [N] pass |
| Full core suite | [counts] |
| Full dashboard suite | [counts] (note pre-existing failures from S17 baseline) |
| `tests/e2e/cfr-phase2-tts-replay.test.ts` regression gate | ✓ pass |

## Plug smoke tests (env-loaded)
[output of `for s in .my_agent/capabilities/*/scripts/smoke.sh; do bash "$s"; done`]

## tsc
- `packages/core` — 0 errors
- `packages/dashboard` — 0 errors

## ffmpeg verification
[output of `which ffmpeg && ffmpeg -version | head -1`]

## tts-edge-tts manual verification (Task 3 Step 3)
[output of synthesize.sh + od magic-byte check + file-type check]
```

- [ ] **Step 8: Final type-check both packages**

```bash
cd packages/core && npx tsc --noEmit && echo "core OK"
cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit && echo "dashboard OK"
```

Expected: both OK.

- [ ] **Step 9: Final commit (all four artifacts) [ARCHITECT R2]**

```bash
cd /home/nina/my_agent
git add docs/sprints/m9.6-capability-resilience/s18-DECISIONS.md \
        docs/sprints/m9.6-capability-resilience/s18-DEVIATIONS.md \
        docs/sprints/m9.6-capability-resilience/s18-FOLLOW-UPS.md \
        docs/sprints/m9.6-capability-resilience/s18-test-report.md
git commit -m "docs(s18): sprint artifacts — DECISIONS, DEVIATIONS, FOLLOW-UPS, test-report"
```

- [ ] **Step 10: Stop the trip-sprint and notify CTO**

Notify CTO: "S18 dev is done; artifacts ready for architect review."

**Do NOT:**
- Commit `APPROVED` in any commit message.
- Mark S18 Done in `docs/ROADMAP.md`.
- Write `s18-architect-review.md` (architect's exclusively).
- Merge `sprint/m9.6-s18-tts-path-collapse` to master.

---

## Verification Commands (sprint exit)

```bash
# Core — reverify changes
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/reverify-audio-to-text tests/capabilities/reverify-tts tests/capabilities/reverify-dispatch

# Dashboard — acceptance tests
cd packages/dashboard && npx tsc --noEmit
cd packages/dashboard && npx vitest run tests/integration/tts-paths tests/integration/voice-reply-regression tests/integration/cfr-tts-single-emit

# Regression gate
cd packages/dashboard && npx vitest run tests/e2e/cfr-phase2-tts-replay
cd packages/core && npx vitest run
cd packages/dashboard && npx vitest run

# Plug smoke (env-mismatch protocol: source .env first)
set -a && . packages/dashboard/.env && set +a
for s in .my_agent/capabilities/*/scripts/smoke.sh; do bash "$s" && echo "OK: $s" || echo "FAIL: $s"; done
```

---

## Deviation Triggers

Stop and present to CTO if any of these are hit:

1. **Baileys plugin can't drop `onSendVoiceReply` without breaking audio-format compatibility** — e.g., the plugin's `sendAudio` requires a specific format that `sendAudioUrlViaTransport`'s readFileSync buffer doesn't satisfy.
2. **`audioUrl` not reliably produced by `done` events in all streaming paths** — e.g., split-done sometimes yields `undefined` audioUrl even when TTS succeeded.
3. **`sendAudioViaTransport` called from a path the fallback table doesn't cover** — grep `sendAudioViaTransport` before removing; if found elsewhere, expand the table.
4. **ffmpeg absent on the machine** — tts-edge-tts smoke will fail; install ffmpeg or escalate.
5. **reverifyTextToAudio Ogg-strict breaks an existing installed plug** — check all plug smoke tests after Task 2.

---

*Created: 2026-04-19*
*Sprint: M9.6-S18 — Duplicate TTS Path Collapse*
*Phase 3 plan ref: docs/sprints/m9.6-capability-resilience/plan-phase3-refinements.md §2.3*
