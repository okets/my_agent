# S15 Decisions

## D1 — TTS detection wiring strategy

Chose a minimal `synthesizeAudio` refactor over a full S17 invoker sweep. S17 is Phase 3 work ("Duplicate TTS path collapse"). S15 needs TTS detection working for the exit gate; one targeted change in `chat-service.ts` is lower risk than a full collapse of all TTS paths. The fallback path (no invoker wired) ensures existing unit tests continue passing unchanged.

## D2 — CFR direct-emit pattern

Tests emit `cfr.emitFailure()` directly rather than triggering through `chat.sendMessage()`. Same pattern as S7's exit gate (`cfr-incident-replay.test.ts`). The E2E tests verify recovery-loop correctness, not detection-trigger wiring — detection is separately tested at the unit level in S10/S12/TTS detection work.

## D3 — Break mechanism

All four tests break the plug by removing `.enabled`. Simple, reversible, and the fix is a single `touch` command that Claude Code reliably executes without exploration. The CLAUDE.md in each test's isolated `agentDir` gives exact instructions and the precise file path.

## D4 — smoke.sh exit 2 (SMOKE_SKIPPED) treatment

Per S11 hermeticity rule, exit 2 is treated as inconclusive-pass by `runSmokeFixture`. Browser and desktop plugs return exit 2 when chromium/X11 is unavailable — confirmed during this sprint run. Desktop smoke exited 2 (SMOKE_SKIPPED — no display in test context); browser smoke exited 2 as well. Both tests passed because the orchestrator correctly treats exit 2 as inconclusive-pass.

## D5 — Stub plug non-coverage (§0.1 rule)

Two plug folders exist that are NOT exercised by S15:

- **`smoke-test-cap`** — test fixture only, not user-facing. Used in unit tests within `packages/core/tests/fixtures/`. No production use, no incident history.
- **`tts-edge`** — scaffold only, no `scripts/` folder, superseded by `tts-edge-tts`. Not used in production.

Exclusion is intentional. Per §0.1, only installed plugs in `.my_agent/capabilities/` with production use are in scope for Phase 2 exit gate. Silence on these two is intentional non-coverage, not an oversight.

## D6 — Production TTS state unchanged

`tts-edge-tts/.enabled` was absent in production before S15. S15 test scaffolding copies the plug without `.enabled` and tests the recovery loop. The production plug remains disabled after S15. Re-enabling is CTO action (see `s15-FOLLOW-UPS.md` FU-0).

## D7 — reverifyTextToAudio MP3 header fix (unplanned S13 bug)

The TTS reverifier checked for `OggS` and `RIFF` headers only. The real `tts-edge-tts/scripts/synthesize.sh` produces MP3 (MPEG sync word `ff f3`). This caused reverify to fail silently after the fix agent created `.enabled`, causing the orchestrator to launch attempt 2 instead of emitting `terminal-fixed`. Fixed by extending the header check to include MP3 (ID3 tag and MPEG sync word). The same fix updated reverify-tts.test.ts script fixtures to use `$2` for the output path (matching the new `synthesize.sh` arg contract).

## D8 — CAPABILITY.md files not committed (gitignored)

`.my_agent/` is gitignored in this public repo (privacy guardrail). The `multi_instance` backfill (Task 0) was applied on disk but the commit step from the plan was skipped — `git add` refused with "path is ignored". The changes exist on disk and will persist. This is correct behavior per the project's privacy architecture.

## D9 — Core dist rebuild required for reverify fix

The dashboard E2E tests import from `@my-agent/core` which resolves to the compiled `dist/` files. After fixing `reverify.ts` (MP3 header check), the core `dist/` was stale and needed `npx tsc` to rebuild before the TTS test could pick up the fix. Added this to the test run notes.
