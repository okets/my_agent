---
sprint: m9.6-s15
date: 2026-04-18
verified-by: External auditor (dev-contracted)
---

# M9.6-S15 Test Report

## Verification commands and output

### Core typecheck

```
cd packages/core && npx tsc --noEmit
# Exit 0 — no errors
```

### Dashboard typecheck

```
cd packages/dashboard && npx tsc --noEmit
# Exit 0 — no errors
```

### Capabilities regression (core)

```
cd packages/core && npx vitest run tests/capabilities

Test Files  43 passed | 1 skipped (44)
Tests       290 passed | 2 skipped (292)
Duration    28.34s
```

All 290 tests pass. 2 tests skipped (orchestrator-reverify-integration — pre-existing skip conditions).

### Dashboard integration tests

```
cd packages/dashboard && npx vitest run tests/cfr tests/integration

Test Files  3 failed | 25 passed (28)
Tests       17 failed | 197 passed (214)
```

3 test files with 17 failures are PRE-EXISTING before S15 (confirmed by checking
on the base branch before any S15 commits). These are not regressions introduced
by this sprint. The 3 failing files involve `sessionManager.setTurnContext` API
shape issues unrelated to capability resilience.

### S7 regression gate (cfr-incident-replay)

```
env -u CLAUDECODE node --env-file=packages/dashboard/.env \
  node_modules/.bin/vitest run tests/e2e/cfr-incident-replay

Tests  2 passed
Duration  173.30s
```

Passed. The `synthesizeAudio` fallback path change (Task 1) did not regress
the S7 exit gate.

### Phase 2 E2E exit gates (all 4 run in parallel)

```
env -u CLAUDECODE node --env-file=packages/dashboard/.env \
  node_modules/.bin/vitest run \
  tests/e2e/cfr-phase2-stt-replay \
  tests/e2e/cfr-phase2-tts-replay \
  tests/e2e/cfr-phase2-browser-synthetic \
  tests/e2e/cfr-phase2-desktop-synthetic

Test Files  4 passed (4)
Tests       4 passed (4)
Duration    213.70s (wall) / 707.44s (cumulative across 4 parallel workers)
```

All 4 passed.

## Precondition status

| Test | Skip condition | Status |
|---|---|---|
| STT replay | voice-1-incident.ogg + DEEPGRAM_API_KEY | **ran** — audio present, key loaded |
| TTS replay | edge-tts smoke.sh exit 0 | **ran** — smoke exits 0, edge-tts functional |
| browser synthetic | browser-chrome installed + auth | **ran** — plug installed, OAuth token present |
| desktop synthetic | desktop-x11 installed + auth | **ran** — plug installed, OAuth token present |

All 4 tests ran (no skips).

## Unplanned fixes applied

1. **reverifyTextToAudio MP3 header** (`packages/core/src/capabilities/reverify.ts`) —
   TTS reverifier only accepted Ogg/WAV; real plug produces MP3. Fixed to also accept
   ID3 and MPEG sync word headers. (S13 bug, discovered during S15 TTS E2E run.)

2. **reverify-tts.test.ts script fixtures** — Updated from `OUTPUT="$1"` to
   `OUTPUT="$2"` to match the new synthesize.sh arg contract from Task 1.5.

3. **Core dist rebuild** — After source changes to `reverify.ts`, ran `npx tsc` in
   `packages/core` to regenerate dist files before re-running dashboard E2E tests.

## Notes on smoke exit codes

- `browser-chrome/scripts/smoke.sh` — exits 2 (SMOKE_SKIPPED) in the test context (Chromium not available in the isolated env). Treated as inconclusive-pass per S11 hermeticity rule. `runSmokeFixture` returns pass, orchestrator emits `terminal-fixed` and writes CFR_RECOVERY.md.
- `desktop-x11/scripts/smoke.sh` — exits 2 (SMOKE_SKIPPED) in the test context (no DISPLAY set, xdotool unavailable). Same treatment.
- `tts-edge-tts/scripts/smoke.sh` — exits 0. Python + edge-tts network call succeeded.
- `stt-deepgram/scripts/smoke.sh` — not exercised in the reverify path (STT uses `reverifyAudioToText`, not `runSmokeFixture`). Deepgram transcription ran successfully via `transcribe.sh`.
