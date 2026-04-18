---
sprint: M9.6-S13
title: Reverify dispatcher + terminal-on-fix state — architect review
architect: Opus 4.7 (Phase 2 architect)
review_date: 2026-04-18
verdict: APPROVED
---

# S13 Architect Review

**Sprint:** M9.6-S13 — Reverify dispatcher + terminal-on-fix state
**Branch:** `sprint/m9.6-s13-reverify-dispatcher`
**Implementer commits:** `f5b9cca` → `1ceeaa7` (plan rewrite + C1/C2 fix) → 5× `feat`/`refactor` task commits → `7497661` (sprint artifacts)
**External auditor:** not run (optional per §0.3); architect is the only review pass
**Reviewed:** 2026-04-18
**Verdict:** **APPROVED.** No dev cleanup required. One minor doc nit in `s13-test-report.md` (non-blocking).

---

## 1. Sprint goal vs. delivered

**Goal (per `plan-phase2-coverage.md` §2.5):** per-type reverifiers + smoke-fixture default + `RESTORED_TERMINAL` state for plugs without retriable input.

**Delivered:** matches goal. `dispatchReverify` routes via `REVERIFIERS` table (audio/TTS/image-to-text/text-to-image) with `runSmokeFixture` fallback for MCP and unknown types. `RESTORED_TERMINAL` state + `TERMINAL_ACK` action + `REVERIFY_PASS_TERMINAL` event added to the state machine. Orchestrator branches on `recoveredContent` presence. `verificationInputPath` always populated from the reverifier. `runSmokeFixture` exit-2 inconclusive handling lands as planned. **REFLECTING / SPAWN_REFLECT_JOB / REFLECT_JOB_DONE all preserved** — reflect-collapse correctly stays in S17 as required.

---

## 2. Independent verification gates

| Check | Command | Result |
|---|---|---|
| Core typecheck | `cd packages/core && npx tsc --noEmit` | exit 0, zero errors |
| Dashboard typecheck | `cd packages/dashboard && npx tsc --noEmit` | exit 0, zero errors |
| S9 throws regression | grep `unreachable in S9` | zero matches (preserved from S12) |
| S13 unit + integration tests | 6 files, 22 tests | 22/22 PASS |
| Full capabilities + conversations regression | 43 files, 268 tests | 266 passed / 2 skipped (pre-existing); zero failures |
| REFLECT* preserved | grep state-machine | REFLECTING / SPAWN_REFLECT_JOB / REFLECT_JOB_DONE all intact |
| Plan file cleanup | `wc -l s13-plan.md` | 1412 lines (was 2060 pre-C1; ~648 lines of duplicate old content removed) |

The S12 pre-existing `integration.test.ts` MCP-spawn flake didn't fire this run — intermittent on master, not a concern.

---

## 3. Spec coverage (every design feature mapped)

| Feature | Source | Implementation |
|---|---|---|
| `REVERIFIERS` dispatch table | v2 §3.3, plan §2.5 | `reverify.ts:305-310` |
| `dispatchReverify` entry point | plan §2.5 | `reverify.ts:320-357` |
| `reverifyTextToAudio` (Ogg/WAV header check) | v2 §3.3 | implemented; 4 tests |
| `reverifyImageToText` (fixture-only, `recoveredContent: undefined`) | v2 §3.3, §7 | implemented; 3 tests; falls through to smoke when `ocr.sh` absent (D2) |
| `reverifyTextToImage` (PNG/JPEG/WebP header) | v2 §3.3 | implemented; 3 tests |
| `runSmokeFixture` exit-2 inconclusive | v2 §6.4, plan amendment | `reverify.ts` extended; new test added |
| `verificationInputPath` always populated | plan §2.5 | sourced from `ReverifyResult` (D3) |
| `RESTORED_TERMINAL` state + rename `DONE` → `RESTORED_WITH_REPROCESS` | v2 §3.4 | state machine extended |
| `REVERIFY_PASS_TERMINAL` event + `TERMINAL_ACK` action | v2 §3.4 | both added |
| Origin-aware terminal routing via S12's terminalDrain | v2 §3.4, S12 | extended `outcome` to include `"terminal-fixed"`; conversation branch emits `terminal-fixed` ack |
| `terminal-fixed` AckKind | plan §2.5 | added to `recovery-orchestrator.ts` |
| Backward-compat alias `reverify` | plan §2.5 | `export const reverify = dispatchReverify` (D1) |
| Inconclusive routes to RESTORED_TERMINAL | plan amendment + §6.4 | D5 documents the routing |

100% design coverage.

---

## 4. Process compliance

| Check | Result |
|---|---|
| C1 (delete duplicate old plan content) | DONE — commit `1ceeaa7`; plan now 1412 lines, ends cleanly |
| C2 (S10-FU-2 deferred to S18 in FOLLOW-UPS) | DONE — `s13-FOLLOW-UPS.md` FU-1 names target sprint S18 |
| All required artifacts present | DECISIONS (5 entries), DEVIATIONS (1 entry), FOLLOW-UPS (1 entry), test-report — all present |
| External auditor optional | Skipped — architect is sole review pass |
| No premature APPROVED commit | Confirmed — branch has zero `APPROVED` framing in commit messages |
| No roadmap-done commit | Confirmed — ROADMAP.md S13 row not yet marked Done |
| No `s13-architect-review.md` written by dev | Confirmed — this file is mine |
| §0.2 (detection at the gates) | Holds — no new emit sites added; S13 only touches reverify + state machine + orchestrator |
| Reflect-phase NOT collapsed | Confirmed — REFLECTING / SPAWN_REFLECT_JOB / REFLECT_JOB_DONE all intact (S17 territory) |

Clean run.

---

## 5. Observations (non-blocking)

1. **`s13-test-report.md` universal-coverage table has one misleading row.** The `stt-deepgram` entry says "smoke.sh takes precedence" — that's wrong. `audio-to-text` is in `REVERIFIERS`, so `reverifyAudioToText` runs first; smoke fallback is reachable only for MCP/unknown types. The actual code is correct (`reverify.ts:344-357`); only the doc is misleading. Worth a one-line fix for future readers. **Not blocking — the rule's substance (every installed type is covered) holds.**

2. **No external auditor this sprint.** §0.3 makes the auditor optional — dev relied on plan discipline + architect review. Acceptable but worth noting: S12's auditor caught a real spec gap (debrief-prep `runDir` wiring) before architect review. The independent read is valuable when the work is structurally novel; for a sprint as scoped as S13, going without is reasonable.

3. **DEV-1 deviation (two-call registry mock for "not found in registry" test)** is a sensible test-design decision. The single-call mock would have hit a 10-second timeout before reaching the intended branch. Documented properly.

---

## 6. Plan amendments

**None required.** S13 didn't surface any new deferrals beyond what's already tracked:

- S10-FU-2 (bash-wrapper removal) → S18 (already in `s13-FOLLOW-UPS.md` FU-1; S18 plan already touches reverify wiring per Phase 3 plan §2.3)
- `reverify` alias removal → S18 (per D1)

Both deferrals are correctly cross-referenced to S18 which is the natural place to drop both during the duplicate-TTS-path collapse.

---

## 7. Verdict

**APPROVED.** Sprint work is high-quality and complete. Spec coverage 100%. Process discipline restored after the initial wrong-plan misfire. The corrections (C1 + C2) landed cleanly in the first remediation commit.

S14 unblocked. The terminal-state machinery + dispatcher S13 delivered give S14 exactly what it needs to wire friendly names + multi-instance copy + per-type fallback action through the terminal ack path.

---

## 8. Merge guidance

Sprint branch `sprint/m9.6-s13-reverify-dispatcher` ready to merge to master after this architect-review commit. Recommended:

```bash
git merge --no-ff sprint/m9.6-s13-reverify-dispatcher
```

Roadmap-done commit lands AFTER merge per §0.3.

Optional cleanup (architect, this commit): fix the misleading `stt-deepgram` row in `s13-test-report.md` to reflect that `audio-to-text` routes through `reverifyAudioToText`, not smoke. Trivial.

---

*Architect: Opus 4.7 (1M context), Phase 2 architect for M9.6 course-correct*
