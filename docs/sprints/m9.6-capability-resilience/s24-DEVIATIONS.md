---
sprint: M9.6-S24
title: Deviations
date: 2026-04-22
---

# S24 Deviations

## DEV-1 — System-origin reverify always failed (live-test discovery)

**Plan said:** Fix agent repairs the capability → reverify passes → ring buffer transitions to `fixed`.

**What happened:** `dispatchReverify` routes `audio-to-text` to `reverifyAudioToText`, which requires `rawMediaPath` on `triggeringInput.artifact`. System-origin probes carry no artifact (no real audio file to replay). Reverify returned `pass: false` on every attempt even when the fix agent successfully repaired the script.

**Fix:** `packages/core/src/capabilities/reverify.ts` — added system-origin early-return after `waitForAvailability()` passes: `return { pass: true }`. The rescan+testAll result is the authoritative verification for system-origin failures. Per-type artifact-based reverifiers are skipped.

**Test updated:** `packages/core/tests/capabilities/reverify-audio-to-text.test.ts` — "returns pass:false when rawMediaPath is absent" → "returns pass:true for system-origin failures".

**Impact:** None on conversation/automation-origin paths. Decision documented as D9 in `s24-DECISIONS.md`.
