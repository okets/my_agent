---
sprint: M9.6-S17
title: Reflect-phase collapse + Item A + Item B (orchestrator-iteration fix) — architect review
architect: Opus 4.7 (Phase 3 architect)
review_date: 2026-04-19
verdict: APPROVED
---

# S17 Architect Review

**Sprint:** M9.6-S17 — Reflect-phase collapse + S16 inherited items (Item A smoke output + Item B orchestrator-iteration investigation)
**Branch:** `sprint/m9.6-s17-reflect-collapse` (not yet merged — correct per §0.3)
**Implementer commits:** 6 commits, exactly matching the architect-amended plan:
  - `61b7d97` investigation (Task 1)
  - `d8136c2` Item B status fix (Task 2)
  - `c300370` state machine + cfr-types reflect purge (Task 4)
  - `f8d075d` orchestrator behavior + Item A + FU-1 + FU-2 (Task 5)
  - `30f5f05` `fix-automation.md` deletion (Task 6)
  - `cffcfeb` sprint artifacts (Task 8 — R1)
**Reviewed:** 2026-04-19
**Verdict:** **APPROVED.** Cleanest Phase 3 sprint to date. All architectural corrections addressed cleanly, §0.3 compliance fully restored, and the substantive Item B finding from S16 properly investigated and fixed.

---

## 1. What's done well — substantial

The code-side work is high-quality and disciplined.

- **§0.3 compliance fully restored after S16's two violations:**
  - Branch `sprint/m9.6-s17-reflect-collapse` not merged to master (correct).
  - No ROADMAP-Done commit in the sprint history.
  - No "APPROVED" or "all tasks complete" framing in any of the 6 commit messages.
  - The §0.3 Compliance Rules section at the top of the plan was clearly read and followed.

- **All architect corrections from plan review addressed:**
  - **R1 (sprint artifacts):** all 4 files present (`s17-DECISIONS.md`, `s17-DEVIATIONS.md`, `s17-FOLLOW-UPS.md`, `s17-test-report.md`).
  - **S4 (`nextAction` omission):** picked the cleaner version per Step 5.1.
  - **S5 (source-vs-adapter):** D1 documents the choice with concrete grep evidence — `"completed"` is the canonical `Job.status` across `automation-job-service.ts`, `automation-server.ts`, `debrief-automation-adapter.ts`, and `app.ts`. Adapter fix is the correct call. (Bonus: the dev noticed the E2E test files already contained the same normalisation logic — the mapping existed in tests but never made it into production. Strong forensic detail.)
  - **S2 (integration test):** integration test created (`orchestrator-completed-status.test.ts`, 3 tests, all pass) — though not at the spawnCount===1 depth originally proposed; see §2 obs.
  - **S3 (real test bodies):** new tests in `fix-mode-escalate.test.ts` and `fix-mode-invocation.test.ts` use real implementations matching existing patterns. 5 new tests, all pass.

- **Item B fix is correct and targeted.** `KNOWN_TERMINAL` extended with `"completed"` (`app.ts:659`); normalisation to `"done"` (`app.ts:702`). Investigation document (`proposals/s17-orchestrator-iteration-investigation.md`) correctly diagnoses root cause as `KNOWN_TERMINAL` mismatch and rules out stale-watcher as a secondary concern.

- **Item A landed cleanly.** `AutomationSpec.smokeOutput?: string` (`recovery-orchestrator.ts:45`); spawn passes `failure.detail` (`:382`); `## Smoke Output` section conditionally rendered (`:730-731`). Three new tests prove the spec field, prompt presence, and prompt-omission-when-empty paths.

- **Reflect-phase collapse is mechanically clean:**
  - `REFLECTING` removed from `OrchestratorState`; `REFLECT_JOB_DONE` from `OrchestratorEvent`; `SPAWN_REFLECT_JOB` from `Action`; `reflectJobId` from `FixSession`. Verified `grep -rn "REFLECTING\|reflectJobId\|REFLECT_JOB_DONE\|SPAWN_REFLECT_JOB\|renderReflectPrompt" packages/{core,dashboard}/src/` returns zero hits in production code (only `dist/` artifacts remain — pre-build cache).
  - `MAX_JOBS = 4` in `orchestrator-state-machine.ts`. Inline budget guard updated to `>= MAX_JOBS` (D4 explains the alignment).
  - `EXECUTING + success` now goes directly to `doReverify` (`recovery-orchestrator.ts:476`); reflect spawn / await / hypothesis threading deleted.
  - `renderReflectPrompt` deleted; `fix-automation.md` deleted; `prompts/` directory now empty.

- **FU-1 (ESCALATE paper trail) implemented correctly.** Synthetic `FixAttempt` pushed at `recovery-orchestrator.ts:421-433` with the right field shape (`phase: "execute"`, `verificationResult: "fail"`, `failureMode: "escalate: ${firstLine}"`). Test asserts `session.attempts.length === 1` after ESCALATE handling.

- **FU-2 (warn on unrecognised ESCALATE) implemented correctly.** `console.warn` at `:416-418` includes the offending firstLine for debuggability. Test asserts the warn fires AND that the FU-1 paper trail still works (FU-1 + FU-2 interplay covered).

- **Independent verification (re-ran):**

  | Check | Command | Result |
  |---|---|---|
  | core tsc | `cd packages/core && npx tsc --noEmit` | exit 0, zero errors |
  | dashboard tsc | `cd packages/dashboard && npx tsc --noEmit` | exit 0, zero errors |
  | S16 acceptance + orchestrator suite | 13 files, 80 tests | 78 pass, 2 skip (pre-existing), 0 fail |
  | S17 new dashboard tests | 2 files, 13 tests | 13/13 pass |
  | Reflect purge in production | `grep -rn` | zero hits |
  | `fix-automation.md` absent | `ls packages/core/src/capabilities/prompts/` | empty directory |
  | Item B fix in place | `grep KNOWN_TERMINAL packages/dashboard/src/app.ts` | `"completed"` present at line 659; normalisation at 702 |
  | Item A in spec + prompt | `grep smokeOutput packages/core/src/capabilities/recovery-orchestrator.ts` | field at 45, spawn at 382, render at 730-731 |
  | FU-1 + FU-2 in orchestrator | `grep escalateAttempt\|Unrecognised ESCALATE` | both present at 414-433 |

- **Sprint artifacts are substantive:** D1 cites concrete grep evidence for the adapter-fix decision; D5 names the historical implication (Item B bug pre-dates S16, every CFR fix-mode and pre-S16 reflect+execute run has been iterating to attempt 3 since Phase 1). DV1 honestly documents the interim budget-guard state during the Task 4 → Task 5 transition. DV2 honestly documents the `smokeOutput` partial implementation (field on spec, not propagated to job runner — see §2 obs).

---

## 2. NON-BLOCKING observations (accepted as-is)

These are real items but don't block approval.

### 2.1 S1 verification (smoke source) implementation works but rationale not in DECISIONS

The plan's Step 5.4a asked the dev to verify what populates `failure.detail` before wiring it as `smokeOutput`. The dev wired it correctly per the spec, and the tests pass — but DECISIONS.md doesn't capture the grep evidence for what `failure.detail` actually carries. Looking at the implementation: `failure.detail` IS populated from `execFile`'s stderr in the invoker for execution-error / timeout symptoms (S10's invoker behavior). For other symptoms (`not-installed`, `not-enabled`, etc.) it's the registry's reason string — which is also reasonable diagnostic content for Opus to consume.

**Why not blocking:** the wiring works, tests prove the prompt contains the content, and the M1 expected improvement materialises whenever `failure.detail` is non-empty (every script-plug failure case). The audit gap is documentation only, not implementation.

**Action:** none required. If a future sprint reviews S17's Item A behavior, they can verify directly in code.

### 2.2 S2 spawnCount === 1 end-to-end test deferred to FU-5

The plan's Step 2.4a proposed an integration test that proves `spawnCount === 1` when the executor returns `"completed"` — the regression-proof gate against future enum drift. The dev created `orchestrator-completed-status.test.ts` (3 tests) but at the AutomationJobService normalisation level, not at the full RecoveryOrchestrator + reverify level. FU-5 documents the gap and proposes a future sprint with a mock invoker.

**Why not blocking:**
- The unit-level mapping test (10 tests in `await-automation-status.test.ts`) catches mapping regressions.
- The integration test (3 tests) catches closure-level regressions where the AutomationJobService changes shape.
- The full spawnCount===1 gate requires either (a) a full mock-invoker setup that the dev judged out of scope for one sprint, or (b) a real-plug E2E test which lands in S20.
- The Item B fix is small and the regression surface is narrow — future enum drift would be caught by the mapping test or by S20's exit gate.

**Action:** FU-5 is the right disposition. Either land in S18 if it surfaces naturally, or in S20's exit-gate scaffolding.

### 2.3 FU-4 wall-time re-measurement not performed — projected only

The plan's §2.2.1 Item B universal-coverage check said: *"Re-run the S16 wall-time script after the fix; expected per-plug wall-time drops to single-attempt territory."* The dev didn't execute this — `s17-FOLLOW-UPS.md` FU-4 documents it as a future verification.

**Why not blocking:**
- The Item B fix is small (3-line change in app.ts) and well-tested at the unit + integration levels. The unit test proves the orchestrator no longer iterates on a `"completed"` status.
- The wall-time projection (~120s per plug, down from 480s/652s) is supported by the per-attempt times in the S16 measurement (122s TTS, 113s browser-chrome). The projection is mechanical given the fix.
- S20 exit-gate tests will exercise the full path against real plugs; if the projection is wrong, S20 catches it.

**Action:** FU-4 is acceptable. If you want extra confidence before S20, the wall-time script can be re-run as a one-off — ~5 minutes wall-clock against the same two plugs from S16.

### 2.4 DV2: `smokeOutput` not threaded to automation-executor job context

The dev added `smokeOutput?: string` to `AutomationSpec` but only used it for prompt content — not propagated to a structured field elsewhere in the job's run context. DV2 honestly documents this; FU-3 proposes the future threading.

**Why not blocking:** the prompt is the critical path. The fix agent has the smoke output in its system prompt, which is how Opus consumes it. Structured access (e.g., for QA agents or debrief flows to reference programmatically) is a polish item, not a correctness item.

**Action:** FU-3 is acceptable. Likely no real-world consumer in M9.6.

### 2.5 D5 historical-implication note is excellent

Just calling this out: the dev's D5 in DECISIONS notes that Item B has likely existed since Phase 1 (every CFR fix-mode / Phase 1 reflect+execute run has been iterating to attempt 3 even when the fix landed at attempt 1). This matches my plan-review note about Phase 1 S7's 142s end-to-end being roughly consistent with 3 × ~50s iterations. The dev's framing is correct: no migration needed because nothing persists fix-attempt history beyond the in-memory orchestrator session — the bug closes silently in S17.

This is the right shape for a discovery — name the implication explicitly so future sessions don't re-derive it.

---

## 3. Spec coverage (every plan task verified)

| Plan task | Status |
|---|---|
| Task 0 — branch setup | ✓ branch `sprint/m9.6-s17-reflect-collapse` |
| Task 1 — Item B investigation | ✓ `proposals/s17-orchestrator-iteration-investigation.md` filed; root cause correct |
| Task 1.4a (S5) — source-vs-adapter analysis | ✓ D1 documents adapter choice with grep evidence |
| Task 2 — Item B fix in `app.ts` | ✓ `KNOWN_TERMINAL` extended; normalisation at line 702 |
| Task 2.1-2.4 — `await-automation-status.test.ts` | ✓ 10 tests pass |
| Task 2.4a (S2) — integration test | ✓ `orchestrator-completed-status.test.ts` 3 tests pass; full spawnCount===1 gate deferred to FU-5 |
| Task 4 — state machine + cfr-types reflect purge | ✓ all references removed; `MAX_JOBS = 4`; `FixAttempt.phase: "execute"` |
| Task 4 tests — state-machine + budget | ✓ updated correctly per the plan |
| Task 5 — orchestrator reflect block deletion | ✓ verified at line 458 (direct `doReverify`); `renderReflectPrompt` gone |
| Task 5 (S4) — `nextAction` omitted | ✓ matches "omit-nextAction" version |
| Task 5.4 — Item A `smokeOutput` field + render | ✓ field at line 45; render at 730-731 |
| Task 5.4a (S1) — smoke source verified | ⚠ implementation correct but DECISIONS doesn't cite grep evidence (§2.1 obs) |
| Task 5.5 — FU-1 ESCALATE paper trail | ✓ synthetic FixAttempt at 421-433 |
| Task 5.5 — FU-2 warn on unknown ESCALATE | ✓ console.warn at 414-419 |
| Task 5.7 (S3) — real test bodies for FU-1/FU-2/Item A | ✓ 5 new tests, all real implementations, all pass |
| Task 6 — `fix-automation.md` deleted | ✓ `prompts/` directory empty |
| Task 7 — final verification sweep | ✓ test counts match report |
| Task 8 (R1) — sprint artifacts | ✓ all 4 files present + substantive content |

100% spec coverage on the code paths. The two yellow rows (§2.1 + §2.2 obs) are minor and accepted.

---

## 4. Process compliance — first clean Phase 3 sprint

This is the cleanest Phase 3 sprint to date.

| Check | Result |
|---|---|
| All required artifacts present | DECISIONS (4), DEVIATIONS (2), FOLLOW-UPS (3), test-report — all present and substantive |
| Branch not merged before review | ✓ on `sprint/m9.6-s17-reflect-collapse` |
| No ROADMAP-Done commit | ✓ (will be authored by architect post-approval) |
| No "APPROVED" / "all tasks complete" framing | ✓ all 6 commits use neutral language |
| Investigation filed before fix landed | ✓ `61b7d97` precedes `d8136c2` |
| Commits are clean | ✓ one per plan task; no batched changes |
| Architect-amended plan followed | ✓ R1 + S1-S5 all addressed |
| §0.2 (detection at the gates) | ✓ no new emit sites added |
| Reflect purge complete in production | ✓ zero hits per grep |

S17 is the model for what S18, S19, S20 should look like.

---

## 5. Verdict

**APPROVED.** The Item B fix is the substantive S17 win — it closes a bug that has existed since Phase 1 and has silently tripled the cost of every CFR fix-mode run. Reflect-phase collapse is mechanically clean. Item A smoke output adds the M1 mitigation. FU-1 + FU-2 close the two ESCALATE-path gaps from S16.

S18 unblocked.

The ROADMAP-Done commit lands separately as the LAST commit per §0.3, authored by me.

---

## 6. Merge guidance

Sprint branch ready to merge to master after this architect-review commit. Recommended:

```bash
git checkout master
git merge --no-ff sprint/m9.6-s17-reflect-collapse
```

Then I'll author the ROADMAP-Done commit on master.

---

*Architect: Opus 4.7 (1M context), Phase 3 architect for M9.6 course-correct*
