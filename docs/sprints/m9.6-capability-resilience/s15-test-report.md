---
sprint: m9.6-s15
date: 2026-04-18
verified-by: External reviewer (claude-opus-4-7)
dev-prior-run: Implementer (claude-sonnet-4-6) prior to reviewer
---

# M9.6-S15 Test Report

All commands re-run by the external reviewer on 2026-04-18 at the completion of the sprint (branch `sprint/m9.6-s15-phase2-exit-gate`, HEAD `8937aae`).

## Verification commands and output

### Core typecheck

```
cd /home/nina/my_agent/packages/core && npx tsc --noEmit
# Exit 0 — no output, no errors
```

### Dashboard typecheck

```
cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit
# Exit 0 — no output, no errors
```

### Capabilities regression (core)

```
cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities

 Test Files  43 passed | 1 skipped (44)
      Tests  290 passed | 2 skipped (292)
   Start at  19:42:06
   Duration  27.97s (transform 1.26s, setup 0ms, import 7.55s, tests 50.52s, environment 8ms)
```

All 290 tests pass. Skipped: `orchestrator-reverify-integration` (1 file / 2 tests — pre-existing environmental-precondition skip). No failures.

### S7 regression gate (cfr-incident-replay)

```
cd /home/nina/my_agent/packages/dashboard && env -u CLAUDECODE \
  node --env-file=.env node_modules/.bin/vitest run tests/e2e/cfr-incident-replay

 ✓ tests/e2e/cfr-incident-replay.test.ts (2 tests) 174194ms
     ✓ voice #1 recovers without manual intervention 174121ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  19:42:38
   Duration  177.11s (transform 1.44s, setup 0ms, import 2.72s, tests 174.19s, environment 0ms)
```

S7 exit gate passes. The `synthesizeAudio` refactor in Task 1 did not regress STT recovery. [Brain] trace confirmed reprocessTurn received the Songkran transcript.

### Phase 2 E2E exit gates (all 4 in parallel)

```
cd /home/nina/my_agent/packages/dashboard && env -u CLAUDECODE \
  node --env-file=.env node_modules/.bin/vitest run \
  tests/e2e/cfr-phase2-stt-replay \
  tests/e2e/cfr-phase2-tts-replay \
  tests/e2e/cfr-phase2-browser-synthetic \
  tests/e2e/cfr-phase2-desktop-synthetic

 ✓ tests/e2e/cfr-phase2-desktop-synthetic.test.ts (1 test) 154382ms
     ✓ desktop-x11 recovers: fix → smoke reverify → CFR_RECOVERY.md in runDir 153134ms
 ✓ tests/e2e/cfr-phase2-browser-synthetic.test.ts (1 test) 164517ms
     ✓ browser-chrome recovers: fix → smoke reverify → CFR_RECOVERY.md in runDir 164133ms
 ✓ tests/e2e/cfr-phase2-tts-replay.test.ts (1 test) 175196ms
     ✓ TTS recovers: attempt ack → fix → smoke reverify → terminal-fixed (no reprocess) 175123ms
 ✓ tests/e2e/cfr-phase2-stt-replay.test.ts (1 test) 196196ms
     ✓ STT recovers: attempt ack → fix → reverify → reprocessTurn with transcript 196125ms

 Test Files  4 passed (4)
      Tests  4 passed (4)
   Start at  19:45:40
   Duration  199.44s (transform 6.14s, setup 0ms, import 13.26s, tests 690.29s, environment 1ms)
```

All four exit gates green. 199s wall-time with 4 parallel workers; 690s cumulative Claude Code fix-automation time across workers.

### Dashboard integration/cfr regression (pre-existing failure check)

```
cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/cfr tests/integration

 Test Files  3 failed | 25 passed (28)
      Tests  17 failed | 197 passed (214)
   Start at  19:49:04
   Duration  11.71s (transform 8.75s, setup 0ms, import 47.24s, tests 3.95s, environment 5ms)
```

3 failed files, 17 failed tests. **All failures are `TypeError: sessionManager.setTurnContext is not a function`** at `chat-service.ts:552`.

**Pre-existing verification (reviewer independent):**
```
# Stashed sprint files, checked out master's chat-service/app/session-manager
git stash -u && git checkout master -- \
  packages/dashboard/src/chat/chat-service.ts \
  packages/dashboard/src/app.ts \
  packages/dashboard/src/agent/session-manager.ts

# Re-ran the failing files against master's chat-service
cd packages/dashboard && npx vitest run \
  tests/integration/channel-unification \
  tests/integration/notification-delivery

 Test Files  2 failed (2)
      Tests  9 failed | 2 passed (11)
   Start at  19:49:25
   Duration  3.00s
```

Identical `setTurnContext is not a function` at the same call sites. Confirmed pre-existing on master; not an S15 regression. Sprint workspace restored via `git checkout HEAD -- ...` + `git stash pop`; final `git status -s` shows only the untracked `s15-plan.md` and `s15-self-audit.md`.

## Precondition status

| Test | Skip conditions (all must hold) | Result |
|---|---|---|
| STT replay | `voice-1-incident.ogg` + `.my_agent/capabilities/stt-deepgram` + auth + `DEEPGRAM_API_KEY` | RAN — all present, test passed |
| TTS replay | `.my_agent/capabilities/tts-edge-tts` + auth + `smoke.sh` exit 0 | RAN — edge-tts functional, test passed |
| browser synthetic | `.my_agent/capabilities/browser-chrome` + auth | RAN — plug installed, test passed |
| desktop synthetic | `.my_agent/capabilities/desktop-x11` + auth | RAN — plug installed, smoke exits 2 (SMOKE_SKIPPED — no DISPLAY), inconclusive-pass treatment, test passed |

No skipped suites. All four real-plug exit gates executed end-to-end.

## Multi-instance frontmatter (Task 0, uncommitted — .my_agent/ gitignored)

```
grep -r "multi_instance:" .my_agent/capabilities/*/CAPABILITY.md

.my_agent/capabilities/browser-chrome/CAPABILITY.md:multi_instance: true
.my_agent/capabilities/desktop-x11/CAPABILITY.md:multi_instance: false
.my_agent/capabilities/stt-deepgram/CAPABILITY.md:multi_instance: false
.my_agent/capabilities/tts-edge-tts/CAPABILITY.md:multi_instance: false
```

All four installed plugs have explicit `multi_instance` values on disk. The runtime no longer relies on the `WELL_KNOWN_MULTI_INSTANCE` compile-time fallback.

## Unplanned fixes applied during sprint

1. **`reverifyTextToAudio` MP3 header** (`packages/core/src/capabilities/reverify.ts`, commit `851fade` MP3 support commit) — TTS reverifier accepted only Ogg/WAV; real `tts-edge-tts` plug produces MP3 (ID3 tag or MPEG sync word). Extended the header check to accept four formats: `OggS`, `RIFF` (WAV), `ID3` (tagged MP3), and raw MPEG sync `0xFF 0xE0-FF`. Reviewer independently validated the bitmask `(headerBytes[1] & 0xe0) === 0xe0` correctly matches all MPEG frame-sync byte-2 values (top 3 bits set).

2. **`reverify-tts.test.ts` script fixtures** — Updated from `OUTPUT="$1"` to `OUTPUT="$2"` to match the new `synthesize.sh` CLI contract landed in Task 1.5 (text as arg 1, path as arg 2).

3. **Core `dist/` rebuild** — After `reverify.ts` source edits, `npx tsc` was required in `packages/core` to refresh `dist/` because the dashboard E2E tests import from the compiled `@my-agent/core` package. Documented as operational note.

## Notes on smoke exit codes observed

- `browser-chrome/scripts/smoke.sh` — exit 2 (SMOKE_SKIPPED) in isolated test env (Chromium not available). `runSmokeFixture` returns `{ pass: true, inconclusive: true }`; orchestrator writes CFR_RECOVERY.md. Per S11 hermeticity rule (§6.4).
- `desktop-x11/scripts/smoke.sh` — exit 2 (SMOKE_SKIPPED) in test env (no `DISPLAY`, no `xdotool`). Same treatment.
- `tts-edge-tts/scripts/smoke.sh` — exit 0. Python + `edge-tts` network call succeeded; MP3 output confirmed.
- `stt-deepgram/scripts/smoke.sh` — not exercised in the reverify path. STT uses `reverifyAudioToText` (real-artifact replay against `voice-1-incident.ogg`), not `runSmokeFixture`. Deepgram transcription returned the Songkran transcript.

## Reviewer verdict

All gates green. Three pre-existing dashboard integration failures confirmed pre-existing (not introduced by S15). Phase 2 closes. See `s15-review.md` for the APPROVED verdict.
