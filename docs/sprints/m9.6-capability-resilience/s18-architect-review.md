---
sprint: M9.6-S18
title: Duplicate TTS path collapse + Phase 2 inherited deferrals — architect review
architect: Opus 4.7 (Phase 3 architect)
review_date: 2026-04-19
verdict: APPROVED
---

# S18 Architect Review

**Sprint:** M9.6-S18 — Duplicate TTS path collapse + four §0.5 Phase 2 inherited deferrals (S10-FU-2/S13-FU-1, S11-FU-2, S11-FU-5, S15-FU-4)
**Branch:** `sprint/m9.6-s18-tts-path-collapse` (not yet merged — correct per §0.3)
**Implementer commits:** 9 commits in plan order:
  - `ec40782` Task 1 — bash wrapper removal
  - `427b0af` Task 2 — Ogg-strict reverify
  - (no commit for Task 3 — `.my_agent/` is gitignored; documented in DEV-1)
  - `2434e27` Task 4 — template OggS validation
  - `7345189` Task 5 — transport interface split
  - `07cd29a` Task 6 — message-handler audioUrl + fallback table
  - `380279b` Task 7 — wireAudioCallbacks deletion
  - `afa85d9` Task 8 — voice-reply regression + CFR single-emit
  - `09ab16b` Task 9 — sprint artifacts
**Reviewed:** 2026-04-19
**Verdict:** **APPROVED.** Cleanest large-surface Phase 3 sprint to date. All architect corrections addressed (R1–R3 + S1–S5), §0.3 compliance excellent, all four inherited Phase 2 deferrals confirmed landed end-to-end. The dev caught a plan-text typo + improved one assertion beyond what was asked — both signs of disciplined engagement with the plan rather than mechanical execution.

---

## 1. What's done well — substantial

The work is high-quality across both correctness and process axes.

- **§0.3 compliance fully maintained** (matches S17, no regression):
  - Branch `sprint/m9.6-s18-tts-path-collapse` not merged to master.
  - No ROADMAP-Done commit in sprint history.
  - No "APPROVED" or "all tasks complete" framing in any of the 9 commit messages.
  - The §0.3 Compliance Rules section at top of the plan was clearly read and followed.

- **All architect corrections from plan review addressed:**
  - **R1 (location):** plan committed at the corrected path; all internal commit-paths reference `m9.6-capability-resilience/s18-*.md`. Sprint artifacts all use the convention.
  - **R2 (§0.3 section + 4 artifacts):** all four sprint artifacts present and substantive (DECISIONS, DEVIATIONS, FOLLOW-UPS, test-report).
  - **R3 (5 fallback table rows):** `tts-paths.test.ts` has 5/5 rows covered, including the previously-missing split-done and error-event paths.
  - **S1 (ffmpeg preflight):** Task 0 ffmpeg verification documented in test report.
  - **S2 (single-emit assertion):** **dev improved beyond the spec.** The plan said `expect(cfrEmits.length).toBe(1)`. The dev refactored to `expect(ttsRunCalls.length).toBe(1)` — counting TTS-invoker-run calls directly, not downstream CFR emits. This is a more accurate measurement of the architectural property (one synthesis path per turn) and avoids depending on how `synthesizeAudio` failure bubbles through to CFR.
  - **S3 (wireAudioCallbacks side-effect verification):** D3 in DECISIONS documents the verification — sole effect was `plugin.onSendVoiceReply` assignment. Deletion was safe.
  - **S4 (ChannelMessageHandler API verification):** implicit — all 5 fallback table tests pass, which would not happen if the mock structure didn't align.
  - **S5 (Reverifier type tightening):** D2 expanded with target sprint S20 + interim safety guidance ("dispatchReverify is the gate; new caller code that bypasses it does not get the runtime guard").

- **Dev caught a plan-text typo.** The architect-amended plan instructed validating OggS as `4f677353` (wrong — that's "OgsS"). The dev's actual implementation uses `4f676753` (correct OggS = O-g-g-S). Verified in `tts-edge-tts/scripts/smoke.sh:17`, `text-to-audio.md:89,109`. The dev verified the byte order rather than blindly copying. This is the right discipline for crypto/protocol-byte work.

- **Bash wrapper removal (Task 1) clean.** `reverifyAudioToText` no longer has the legacy `execFile("bash", ...)` fallback. `dispatchReverify` now passes invoker through; `reverify-dispatch.test.ts` updated to provide a mock invoker. New `reverify-audio-to-text.test.ts` covers the 5 invoker paths (success / absent / failure / empty text / no rawMediaPath). 14/14 reverify tests pass.

- **Ogg-strict reverifier (Task 2) clean.** `reverifyTextToAudio` accepts only `OggS` magic bytes; `reverify-tts.test.ts` adds 2 new MP3/WAV-rejects tests. Old "invalid headers" test regex updated from `/header/i` to `/not Ogg/i` to match the new error message — captured in test report's Modified Tests section.

- **tts-edge-tts plug fix (Task 3) verified end-to-end.** Cannot be committed (`.my_agent/` gitignored — DEV-1 documents this correctly). I independently verified by running `bash .my_agent/capabilities/tts-edge-tts/scripts/smoke.sh` (env-loaded per §0.4) — exit 0, OggS magic confirmed. Manual `synthesize.sh "smoke test" out.ogg` produces real Ogg/Opus per the dev's test report (`file out.ogg` reports "Ogg data, Opus audio, version 0.1, mono, 24000 Hz").

- **Template smoke (Task 4) updated** — `text-to-audio.md` reference smoke now validates OggS magic bytes per the contract.

- **Transport interface split (Task 5) clean.** `MessageHandlerDeps` exports `sendAudioUrlViaTransport` + `sendTextViaTransport`; `app.ts` wires both closures. Old `sendAudioViaTransport` references gone (verified via grep — 0 hits).

- **Message-handler fallback table (Task 6) implemented per spec §2.3.** `capturedAudioUrl` captured from every `done` event (lines 567–574 area); `turn_advanced` uses captured URL for split path; final send block branches per the 5-row table. All 5 fallback table tests pass.

- **Baileys deletion (Task 7) complete.** `wireAudioCallbacks` function removed. `plugin.onSendVoiceReply` references gone from `app.ts` (0 grep hits). Stale `// TODO(S15/S18)` comment cleaned up in chat-service.ts.

- **Acceptance tests (Task 8) substantive:**
  - `voice-reply-regression.test.ts` — confirms `sendAudioUrlViaTransport` called with done-event audioUrl (1 test, pass).
  - `cfr-tts-single-emit.test.ts` — single-path property: `ttsRunCalls.length === 1` (1 test, pass). The improved assertion catches both 2+ regressions (Baileys path resurrected) and 0 regressions (TTS detection broken upstream).

- **Sprint artifacts (Task 9) substantive:**
  - DECISIONS: D1 (option a confirmed), D2 (Reverifier type interim with target S20), D3 (wireAudioCallbacks verification with evidence).
  - DEVIATIONS: DEV-1 honestly documents the `.my_agent/` gitignore reality for Task 3.
  - FOLLOW-UPS: §0.1 universal-coverage rationale + landing confirmation for all 4 inherited deferrals + D2 follow-up tracking.
  - test-report: comprehensive — includes plug smoke output (all 4 plugs OK), tts-edge-tts manual verification (OggS confirmed), ffmpeg version, tsc both packages.

- **Independent verification (re-ran):**

  | Check | Command | Result |
  |---|---|---|
  | core tsc | `cd packages/core && npx tsc --noEmit` | exit 0, zero errors |
  | dashboard tsc | `cd packages/dashboard && npx tsc --noEmit` | exit 0, zero errors |
  | S18 reverify suite | 3 files, 14 tests | 14/14 pass |
  | S18 dashboard integration | 3 files, 7 tests (5 fallback + 1 voice-reply + 1 single-emit) | 7/7 pass |
  | tts-edge-tts smoke (env-loaded) | `bash smoke.sh` | exit 0 — OggS validated |
  | OggS magic-byte string | `grep "4f676753"` | correct everywhere (typo `4f677353` from plan absent) |
  | Wire deletion | `grep -c "wireAudioCallbacks\|onSendVoiceReply\|sendAudioViaTransport" app.ts` | **0** |
  | New transport functions | `grep "sendAudioUrlViaTransport\|sendTextViaTransport" app.ts` | wired correctly at 975, 1003 + deps interface at 41, 50 |
  | Single-emit assertion | `grep "expect.*toBe(1)" cfr-tts-single-emit.test.ts` | `ttsRunCalls.length).toBe(1)` (improved S2) |
  | Split-done R3 row | `grep "split done with audioUrl" tts-paths.test.ts` | present at line 143 |

---

## 2. NON-BLOCKING observations (accepted as-is)

These are real items but don't block approval.

### 2.1 cfr-phase2-tts-replay regression test SMOKE_SKIPPED in CI (same as S17 baseline)

The dev's test report notes the S15 regression gate test (`cfr-phase2-tts-replay.test.ts`) skips with `SMOKE_SKIPPED` because CI lacks a real TTS provider. The dev correctly identifies this as the S17 baseline — not a regression introduced by S18. Verified by grep (no S18 commit modified this test file).

**Why not blocking:** the test was already skipping pre-S18. Real plug verification happens manually (and was performed — Task 3 manual verification in test report). S20 exit-gate tests will exercise the full path against real plugs; until then, the unit + integration tests + manual smoke are the verification chain.

**Action:** none required.

### 2.2 Task 3 has no git commit (DEV-1 honest about it)

The `.my_agent/capabilities/tts-edge-tts/scripts/synthesize.sh` and `smoke.sh` changes are live on disk but not in git history because `.my_agent/` is gitignored (privacy guardrail). The dev correctly documented this in DEV-1 and verified the change works end-to-end.

**Why not blocking:** this is the established pattern for `.my_agent/` changes (S11 had the same pattern when the original `tts-edge-tts/scripts/smoke.sh` was created). Future sprints touching `.my_agent/` should continue documenting via DEVIATIONS + test-report. There is no cleaner alternative without changing the privacy architecture.

**Action:** none required. DEV-1 + test report documentation is the right disposition.

### 2.3 Improved S2 assertion (better than spec)

Worth calling out as positive signal: the plan asked for `cfrEmits.length === 1`. The dev refactored to `ttsRunCalls.length === 1`. This is more accurate because it tests the architectural property directly (one synthesis path) rather than the downstream consequence (CFR emit count, which depends on how synthesizeAudio bubbles up failures). The dev exercised judgment instead of mechanical copy.

**Action:** none — note the improvement so future plan reviews lean toward "test the architectural property" over "test the consequence."

### 2.4 Plan typo correction noted

The architect-amended plan had `4f677353` (which decodes to "OgsS") in three places — a copy-paste error from the original plan. Real OggS is `4f676753`. The dev caught this and used the correct bytes throughout. Going forward, magic-byte strings in plans should be verified against the spec rather than carried forward from earlier docs.

**Action:** none. The implementation is correct.

---

## 3. Spec coverage (every plan task verified)

| Plan task | Status |
|---|---|
| Task 0 (preflight) — ffmpeg + branch + S17 baseline + printf-bytes verification | ✓ implicit (test report confirms ffmpeg, all S17 baseline still passes, all bash printf fixtures work) |
| Task 1 — bash wrapper removal | ✓ commit `ec40782`; 5 new tests pass |
| Task 2 — Ogg-strict reverify (option a) | ✓ commit `427b0af`; D1 documents choice |
| Task 3 — tts-edge-tts ffmpeg transcode | ✓ on disk, verified end-to-end; DEV-1 documents gitignore |
| Task 4 — template OggS validation | ✓ commit `2434e27` |
| Task 5 — transport interface split | ✓ commit `7345189` |
| Task 6 (R3) — message-handler audioUrl + 5 fallback table tests | ✓ commit `07cd29a`; 5/5 rows covered |
| Task 7 (S3) — Baileys synthesis deletion | ✓ commit `380279b`; D3 documents side-effect verification |
| Task 8 (S2) — acceptance tests with `=== 1` assertion | ✓ commit `afa85d9`; assertion improved beyond spec |
| Task 9 (R2 + S5) — all 4 sprint artifacts + D2 expanded | ✓ commit `09ab16b`; all four files substantive |

100% spec coverage. All four inherited Phase 2 deferrals confirmed landed:
- S10-FU-2 / S13-FU-1: bash wrapper removed (Task 1) ✓
- S11-FU-2: template smoke validates OggS (Task 4) ✓
- S11-FU-5: tts-edge-tts transcodes to Ogg (Task 3) ✓
- S15-FU-4: reverifyTextToAudio Ogg-strict, option (a) (Task 2) ✓

---

## 4. Process compliance — second clean Phase 3 sprint in a row

| Check | Result |
|---|---|
| All required artifacts present | DECISIONS (3), DEVIATIONS (1), FOLLOW-UPS, test-report — all present and substantive |
| Branch not merged before review | ✓ on `sprint/m9.6-s18-tts-path-collapse` |
| No ROADMAP-Done commit | ✓ |
| No "APPROVED" / "all tasks complete" framing | ✓ all 9 commits use neutral language |
| Architect-amended plan followed | ✓ R1-R3 + S1-S5 all addressed |
| §0.2 (detection at the gates) | ✓ no new emit sites added; S18 only removes a duplicate path |
| Reflect purge holds (S17 carryover) | ✓ no `REFLECTING` references resurrected |

S17 + S18 = back-to-back clean sprints. The §0.3 discipline that S16 violated has stuck.

---

## 5. Verdict

**APPROVED.** Phase 3 architectural cleanup is now complete:
- S16 swapped fix-engine to `capability-brainstorming`.
- S17 collapsed reflect + closed the orchestrator-iteration bug latent since Phase 1.
- S18 collapsed duplicate TTS path + landed all four Phase 2 deferrals.

The framework now has one TTS synthesis path, one fix engine, one reverify dispatcher with proper invoker enforcement at the gate. S19's UX polish (ack coalescing + assistant-turn orphan + system-origin UI + AutomationNotifier) lands on this clean foundation.

S19 unblocked.

The ROADMAP-Done commit lands separately as the LAST commit per §0.3, authored by me.

---

## 6. Merge guidance

Sprint branch ready to merge to master after this architect-review commit. Recommended:

```bash
git checkout master
git merge --no-ff sprint/m9.6-s18-tts-path-collapse
```

Then I'll author the ROADMAP-Done commit on master.

---

*Architect: Opus 4.7 (1M context), Phase 3 architect for M9.6 course-correct*
