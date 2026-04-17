---
sprint: m9.6-s10
title: CapabilityInvoker + exec-bit validation — follow-ups
---

# S10 Follow-Ups

## FU-1 — Wire TTS (synthesizeAudio) through invoker [S13/S17]

**Marker:** `// TODO(S13/S17): route through invoker` in chat-service.ts `synthesizeAudio()`.

`synthesizeAudio()` still calls the TTS script via the legacy path without a `CapabilityInvoker`. This means TTS failures do not automatically emit CFR. Per plan-phase2-coverage.md §2.2, TTS detection coverage is deferred to S13 (or S17 for the audio-synthesis failure taxonomy). When that sprint lands, `synthesizeAudio()` should be refactored identically to `transcribeAudio()`: build `TriggeringInput`, call `invoker.run({ capabilityType: "text-to-audio", scriptName: "synthesize.sh", ... })`, return null on failure.

**Universal-coverage rule §0.1:** Any call-site that invokes a script plug without going through the invoker is a coverage gap. This gap is tracked here until S13/S17 closes it.

---

## FU-2 — Remove legacy bash wrapper from reverifyAudioToText [S13]

**File:** `packages/core/src/capabilities/reverify.ts`, `reverifyAudioToText()` fallback block.

The `execFile("bash", [scriptPath, ...])` path is kept for tests that don't wire a `CapabilityInvoker`. In S13, when all recovery/reverify tests migrate to use the invoker (or a fake invoker), the fallback block should be deleted. At that point `invoker` should be a required parameter to `reverify()`, not optional.

---

## FU-4 — Named-instance selection parameter for CapabilityInvoker [S12/S14]

**Background:** `CapabilityInvoker.run()` currently picks the first *enabled+available* instance of the requested capability type (changed from first-by-insertion in S10 per auditor C1). For single-instance types this is sufficient. For multi-instance types (`browser-control`, `desktop-control`) where multiple instances may be registered (e.g. two browser profiles), the "first enabled+available" policy will silently pick an arbitrary instance.

S14 spec references multi-instance ack disambiguation, which implies the invoker must eventually select a specific named instance. The fix is to add an optional `capabilityName?: string` to `InvokeOptions` — when set, `listByProvides` results are filtered to the named instance before the enabled/available checks. When unset, current first-enabled+available behavior is preserved.

This work should land in whichever sprint first wires a multi-instance capable caller.

---

## FU-3 — Non-audio capability types need invoker wiring [S17+]

Any future capability types (image generation, desktop control, etc.) that use the `script` interface MUST be wired through `CapabilityInvoker` from day one — not via ad-hoc `execFile` calls. The exec-bit validation and CFR emission are only effective for script plugs that go through the invoker. S17 (Phase 3 universal coverage) should include an audit of all script-interface call sites.
