---
sprint: m9.6-s15
reviewer: External reviewer (claude-opus-4-7)
date: 2026-04-18
status: APPROVED
---

# M9.6-S15 External Review

## Verdict

**APPROVED** — Phase 2 exit gate closes. All four end-to-end incident-replay tests pass against real installed plugs (STT real-incident, TTS real-incident, browser-chrome synthetic, desktop-x11 synthetic). Typechecks clean in both packages. Core capabilities regression passes (290/290 + 2 pre-existing skips). S7 regression gate still passes (2/2). The 3 pre-existing dashboard integration failures (17 tests, all `sessionManager.setTurnContext is not a function`) are confirmed pre-existing on master and are NOT introduced by S15.

The sprint does what §2.7 asked: every installed plug type in `.my_agent/capabilities/` now has a working detection → fix → reverify → ack path exercised end-to-end with a real Claude Code fix automation. The extra `reverifyTextToAudio` MP3-header fix is correct, justified, and minimally scoped (a discovered S13 bug that only surfaces against the real plug — exactly the pre-condition work the §2.7 framing anticipates).

## Issues Found

None blocking. A few small notes for the record:

1. **§2.7 `MockTransport`/`AppHarness` was not implemented; direct CFR emit was used instead.** The plan explicitly acknowledges this in D2 and calls out the precedent (S7 exit gate). The rationale is sound — the four tests are about the recovery loop, not detection-trigger wiring, and detection is already covered by unit tests in S10/S12 plus the TTS wiring change in Task 1. This SHOULD have been filed in `s15-DEVIATIONS.md` (the self-audit noted this), but the DEVIATIONS file only mentions it obliquely. Not blocking — the architectural choice is defensible. Suggest a one-line addition to DEVIATIONS in future sprints when plan items are intentionally substituted.

2. **D8 — `.my_agent/` CAPABILITY.md frontmatter edits exist on disk but are uncommitted.** Confirmed via `grep -r "multi_instance:" .my_agent/capabilities/*/CAPABILITY.md` — all four files have the correct values. This is correct behavior (privacy guardrail, `.my_agent/` is gitignored). Task 0 verification passed.

3. **TTS smoke produces MP3, reverifier was checking Ogg/WAV only.** The fix (D7, commit `851fade`... wait, `8759141`... correct commit is the one adding MP3 sync/ID3 detection) correctly extends `reverifyTextToAudio` with four accepted formats: `OggS`, `RIFF` (WAV), `ID3` (tagged MP3), and MPEG sync word `0xFF 0xE0-FF` (raw MP3 frame). The header check bitmask `(headerBytes[1] & 0xe0) === 0xe0` correctly identifies MPEG sync (top 3 bits of byte 2 must be set). The updated test fixtures in `reverify-tts.test.ts` use `$2` for the output path, matching the new CLI arg contract. Both changes are internally consistent.

4. **Code duplication across the 4 E2E test files** is substantial (~200 lines of harness setup repeated). The self-audit flagged this as SUGGESTION-3. This is worth revisiting in Phase 3 as a harness-extraction follow-up. Not a sprint blocker.

5. **`s15-plan.md` and `s15-self-audit.md` are untracked** (visible in `git status`). These are useful artifacts — the plan describes intent, the self-audit describes the dev's own blocking-issue discovery before implementation. They deserve to be committed alongside the review so the trail is complete. The architect should commit them as part of the approval commit.

## Spec Coverage (§2.7)

| §2.7 item | Status | Notes |
|---|---|---|
| Pre-flight: `multi_instance` frontmatter on all 4 installed plugs | PASS | Verified on disk; uncommitted due to `.my_agent/` gitignore (correct) |
| `tests/integration/app-harness.ts` + `MockTransport` recording | SUBSTITUTED | Direct CFR emit pattern (same as S7). D2 rationale; should be named in DEVIATIONS |
| `cfr-phase2-stt-replay.test.ts` — real-incident replay, v2 plumbing | PASS | Asserts `origin.kind === "conversation"`, Songkran transcript, no surrender |
| `cfr-phase2-tts-replay.test.ts` — real-incident terminal path | PASS | Asserts `terminal-fixed` ack, `reprocessCalled === false`, no surrender |
| `cfr-phase2-browser-synthetic.test.ts` — automation-origin CFR_RECOVERY.md | PASS | Correctly polls for `CFR_RECOVERY.md` existence (self-audit BLOCKING-1 fix applied); asserts frontmatter via `{ data: fm }` destructure (BLOCKING-2 fix applied) |
| `cfr-phase2-desktop-synthetic.test.ts` — automation-origin CFR_RECOVERY.md | PASS | Same shape as browser; smoke.sh exits 2 (SMOKE_SKIPPED) in test env, correctly treated as inconclusive-pass |
| TTS detection wiring (S10 `// TODO(S13/S17)` deferral) | PASS | Task 1 rewrite of `synthesizeAudio` routes through `capabilityInvoker.run`; both caller sites updated; silent fallback preserved for unit tests |
| `reverifyTextToAudio` CLI arg contract (S13 pre-existing bug) | FIXED | Task 1.5 — text passed as `args[0]`, output path as `args[1]`; `TTS_REVERIFY_PHRASE` env var removed |
| `reverifyTextToAudio` MP3 header support (unplanned discovery) | FIXED | Extra fix beyond plan: accepts Ogg, WAV, ID3, MPEG sync; documented in D7 |
| Phase-2 exit gate: all 4 tests green on dev machine with plugs healthy | PASS | Real 4-parallel vitest run: 4 files, 4 tests, 199s wall-time |
| Universal-coverage rule (§0.1) for smoke-test-cap and tts-edge | COVERED | D5 explicitly names both as intentional non-coverage with rationale |

## Test run output (verified by external reviewer)

**Typechecks:**
```
cd packages/core && npx tsc --noEmit       # exit 0, silent
cd packages/dashboard && npx tsc --noEmit  # exit 0, silent
```

**Core capabilities regression:**
```
Test Files  43 passed | 1 skipped (44)
Tests       290 passed | 2 skipped (292)
Duration    27.97s
```

**S7 regression gate:**
```
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    177.11s
```

**Phase 2 exit gates (all 4 in parallel):**
```
Test Files  4 passed (4)
Tests       4 passed (4)
Duration    199.44s (wall) / 690.29s (cumulative)
```

**Dashboard integration/cfr (pre-existing state check):**
```
Test Files  3 failed | 25 passed (28)
Tests       17 failed | 197 passed (214)
```
All 17 failures are `sessionManager.setTurnContext is not a function`. Verified pre-existing by checking out master's `chat-service.ts`, `app.ts`, `session-manager.ts` and re-running the two failing files — same 9/9 failures at the same call sites. Not an S15 regression.

**Multi-instance frontmatter on disk:**
```
.my_agent/capabilities/browser-chrome/CAPABILITY.md:multi_instance: true
.my_agent/capabilities/desktop-x11/CAPABILITY.md:multi_instance: false
.my_agent/capabilities/stt-deepgram/CAPABILITY.md:multi_instance: false
.my_agent/capabilities/tts-edge-tts/CAPABILITY.md:multi_instance: false
```

## Approved to Merge

Yes. Phase 2 closes. M10 unblocks per the §2.7 / CTO-2026-04-17 rule that Phase 3 runs first.

Recommended post-approval actions (for the architect):
1. Commit `s15-plan.md` and `s15-self-audit.md` (currently untracked) alongside this review.
2. Add a one-line note to DEVIATIONS stating the `MockTransport`/`AppHarness` substitution (already effectively documented in D2 but not in the DEVIATIONS file itself).
3. Roadmap commit lands AFTER architect review per §0.3 — same rule as Phase 1.

---

*Reviewed by: External reviewer (claude-opus-4-7)*
*Independent verification — ran every gate, checked pre-existing failure state, confirmed on-disk `.my_agent/` edits.*
