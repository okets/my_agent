---
sprint: m9.6-s18
---

# M9.6-S18 Decisions

## D1 — reverifyTextToAudio format strategy: option (a) strict Ogg

**Chose:** Option (a) — strict Ogg only. Removed MP3/WAV/ID3 checks from `reverifyTextToAudio`.

**Why:** S11-FU-5 (Task 3 this sprint) fixes `tts-edge-tts/scripts/synthesize.sh` to transcode to real Ogg/Opus via ffmpeg. With the plug compliant, reverifier strictness is correct. If future plugs output other formats, they must transcode at the plug side — this is the template contract. Architect confirmed (a) over (b) at plan-review time.

**Risk logged:** if ffmpeg is absent on a machine running tts-edge-tts, the transcode fails and the plug emits CFR. Acceptable — CFR is the correct response to a missing dependency.

## D2 — Reverifier type: kept `invoker?` optional at the type level (interim)

**Chose:** Keep `Reverifier` type and `dispatchReverify` signature with `invoker?: CapabilityInvoker` (optional). Only `reverifyAudioToText` adds a runtime guard (returns `pass: false` when absent).

**Why:** Making the type fully required cascades to `dispatchReverify`, the orchestrator deps, and all existing tests. The runtime guard achieves the behavioral goal (no bash wrapper) without a broad refactor. The spec's "assert/throw if not present" is satisfied by the guard.

**Interim safety guidance:** Until the type is tightened, every reverifier-call site MUST be code-reviewed for invoker presence. `dispatchReverify` is the gate — any new call site that goes through it gets the runtime guard, but new caller code that bypasses `dispatchReverify` and calls a per-type reverifier directly will not.

**Target sprint for type tightening:** S20 (final exit gate — natural place for a no-behavior-change refactor pass alongside the AppHarness mock-transport extension). If S20 is too crowded, escalate to a dedicated post-M9.6 cleanup. Don't leave this loose past M9.6 close.

## D3 — wireAudioCallbacks side-effect verification (per ARCHITECT S3)

**Verified:** `wireAudioCallbacks` in `app.ts` had exactly one side effect: assigning `plugin.onSendVoiceReply` to an async function that called `synthesizeAudio` via direct execFile. No logging, no metrics, no event emission, no lifecycle hooks, no other plugin properties modified.

**Evidence:** Full function body read at sprint-time (lines 2340–2381 of the pre-S18 app.ts). The function contained:
1. A comment that STT (`onAudioMessage`) was already removed
2. Assignment: `plugin.onSendVoiceReply = async (text, _jid, language?) => { ... }`
3. The handler: read cap from registry, call `execFileAsync(scriptPath, args)`, read buffer, return it

Deletion is safe. `BaileysPlugin.onSendVoiceReply` stays as `null` (the plug's default) — nothing writes to it post-S18.
