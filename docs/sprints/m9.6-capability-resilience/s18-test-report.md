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
| `packages/core/tests/capabilities/reverify-audio-to-text.test.ts` | 5 | ✓ |
| `packages/core/tests/capabilities/reverify-tts.test.ts` (+2 new: MP3/WAV-rejects) | +2 | ✓ |
| `packages/dashboard/tests/integration/tts-paths.test.ts` (5 fallback table rows) | 5 | ✓ |
| `packages/dashboard/tests/integration/voice-reply-regression.test.ts` | 1 | ✓ |
| `packages/dashboard/tests/integration/cfr-tts-single-emit.test.ts` (=== 1 assertion) | 1 | ✓ |
| **Total new** | **14** | **all pass** |

## Modified tests

- `packages/core/tests/capabilities/reverify-dispatch.test.ts` — audio-to-text routing test now passes mock invoker; asserts `pass:true` and `recoveredContent === "hello"`.
- `packages/core/tests/capabilities/reverify-tts.test.ts` — existing "invalid headers" test regex updated from `/header/i` to `/not Ogg/i` to match new error message.

## Suites run

| Suite | Command | Result |
|-------|---------|--------|
| Core capabilities (reverify + dispatch) | `cd packages/core && npx vitest run tests/capabilities/reverify-audio-to-text tests/capabilities/reverify-tts tests/capabilities/reverify-dispatch` | 14 pass / 0 fail |
| Full core suite | `cd packages/core && npx vitest run` | 639 pass / 9 skip / 0 fail (84 files, 2 skipped) |
| Dashboard tts-paths | `cd packages/dashboard && npx vitest run tests/integration/tts-paths` | 5 pass / 0 fail |
| Dashboard voice-reply-regression | `cd packages/dashboard && npx vitest run tests/integration/voice-reply-regression` | 1 pass / 0 fail |
| Dashboard cfr-tts-single-emit | `cd packages/dashboard && npx vitest run tests/integration/cfr-tts-single-emit` | 1 pass / 0 fail |
| cfr-phase2-tts-replay regression gate | `cd packages/dashboard && npx vitest run tests/e2e/cfr-phase2-tts-replay` | 1 skipped (SMOKE_SKIPPED — no real TTS in CI, same as S17 baseline) |
| Full dashboard suite | `cd packages/dashboard && npx vitest run` | 1302 pass / 18 skip / 7 fail (168 files) |

### Dashboard pre-existing failures (S17 baseline, not introduced by S18)

All 7 failures are browser/e2e tests that require a running server or real API key:
- `tests/browser/capability-ack-render.test.ts` — Playwright, needs running dashboard
- `tests/unit/ui/progress-card.test.ts` — UI test (2 fails)
- `tests/browser/capabilities-singleton-visual.test.ts` — Playwright
- `tests/e2e/whatsapp-before-browser.test.ts` — E2E, connection error
- `tests/browser/automation-ui.test.ts` — "No Anthropic authentication configured"
- `tests/browser/progress-card.test.ts` — "SDK connection failed"

These failures were present on S17 master and are not caused by S18 changes.

## Plug smoke tests (env-loaded)

```
=== .my_agent/capabilities/browser-chrome/scripts/smoke.sh === OK
=== .my_agent/capabilities/desktop-x11/scripts/smoke.sh === OK
=== .my_agent/capabilities/stt-deepgram/scripts/smoke.sh === OK
=== .my_agent/capabilities/tts-edge-tts/scripts/smoke.sh === OK
```

All 4 plugs pass. `tts-edge-tts` smoke now validates OggS magic bytes (4f676753) — previously validated MP3 sync word.

## tts-edge-tts manual verification (Task 3)

```
synthesize.sh "smoke test" /tmp/test-tts-s18-<ts>.ogg
→ {"path": "/tmp/test-tts-s18-<ts>.ogg"}
od output: 4f676753  (OggS ✓)
file output: Ogg data, Opus audio, version 0.1, mono, 24000 Hz
```

## tsc

- `packages/core` — 0 errors
- `packages/dashboard` — 0 errors

## ffmpeg verification

```
/usr/bin/ffmpeg
ffmpeg version 7.1.1-1ubuntu4.2 Copyright (c) 2000-2025 the FFmpeg developers
```
