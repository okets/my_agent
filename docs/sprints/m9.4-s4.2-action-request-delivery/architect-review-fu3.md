---
sprint: M9.4-S4.2 fu3 (post-execution)
auditor: architect (Claude — same context as plan author)
date: 2026-04-30
verdict: APPROVE WITH CONCERNS
---

# Architect Review — M9.4-S4.2 fu3 Implementation

## Method

Independent walk of master commits `bc17749..3e42e4d` against the fu3 plan ([`soak-day-3-followup-plan.md`](soak-day-3-followup-plan.md)). Branch merged via PR #13 at `f41ea2e` plus 2 post-merge commits. Verifications run from `/home/nina/my_agent`:

- Read every claimed code change at the cited line numbers.
- Re-ran probe-style grep verification on all "delete" claims.
- Independent `npx tsc --noEmit` → exit 0.
- Independent `npx vitest run` (full suite, not just executor tests) → **4 tests failing** (see Concerns §1).
- Reviewed `probe-run-2.md` for soundness.

---

## Design Conformance

### 1. Executor overwrite block (the load-bearing edit)

| Plan said | Code says | Status |
|---|---|---|
| Delete `automation-executor.ts:605-621` overwrite block | Lines 648-661 are now: presence check + read into `finalDeliverable` + defense-in-depth `runValidation` | ✅ |
| Drop `extractDeliverable(response)` call at line 603 | Gone. `response` flows directly to `resolveJobSummary` on the resume path | ✅ |
| Replacement code: ~10 lines instead of 20+ | Dev refactored to a free function `readAndValidateWorkerDeliverable(runDir)` at line 75 (24 lines including comment block); call site is 1 line | ✅ + |

**Plan deviation (positive):** dev extracted the logic into a free function rather than inlining. This is **better** than the plan — independently testable, single responsibility, with a thoroughly documented comment block explaining the historical drift. I'd promote this pattern.

The function's contract:
- Throws if `deliverable.md` missing (fail loud, no fabrication from response stream)
- Reads file content
- Runs `deliverable_written` validator one more time (defense in depth)
- Throws if validator fails
- Returns the file content

Both error messages reference where to look (`run_dir/todos.json`) — actionable when triaged.

### 2. `deliverable-utils.ts` deletion

```
$ ls packages/dashboard/src/automations/deliverable-utils.ts
ls: cannot access … No such file or directory

$ grep -rn "deliverable-utils\|extractDeliverable" packages/dashboard/src --include="*.ts"
(zero matches)
```

✅ File deleted. Zero remaining references. The legacy `<deliverable>` XML-tag contract is fully retired.

### 3. Cadence rule fix (`automation-executor.ts:1115` → `:1157`)

| Plan said | Code says | Status |
|---|---|---|
| Delete *"The last tool call before writing `deliverable.md` MUST be `todo_done` on your final step."* | Line 1115 is gone. Line 1154 retains the "first tool call MUST be `todo_in_progress`" rule | ✅ |
| Replace with corrected ordering | Line 1157: *"**Write `deliverable.md` first via the Write tool, then call `todo_done` on the deliverable-emit step.** The `deliverable_written` validator runs when you mark the step done — it reads the file you just wrote, so the file MUST exist before you mark the todo done."* | ✅ verbatim per plan |

### 4. Soak-probe two-stage check (`scripts/soak-probe.sh`)

Probe script grew to 425 lines with explicit STAGE 1 + STAGE 2 + OVERALL PASS/FAIL semantics. Inspected the STAGE 1 implementation at lines 126-163:

- Reads latest run dir's `deliverable.md`
- Strips frontmatter, checks body ≥50 chars
- Applies the same regex as the fu1-widened validator (STRONG_OPENERS + SECOND_MARKERS doubled-signal)
- Logs ✓ / ✗ per check

Post-merge commit `f14ccca` added notify-aware logic: if `notify: debrief`, skip STAGE 2 (no immediate delivery to observe). Sensible.

**Concern flagged in §2 below:** Strategy B (rotated SDK session) and Strategy A (fresh conv) both still nominally supported but only one branch (notify-aware) was tested in production. This is fine for fu3's narrow signal (worker→executor contract) but means STAGE 2 against the post-fu3 stack hasn't been observed for `notify: immediate` workers in production yet.

### 5. Test updates beyond the plan

The plan mentioned updating `automation-executor.test.ts`. Dev went further in commit `8b08c8a` and updated 3 additional test files using "Strategy B" mockImplementation (writes deliverable.md per-call):
- `tests/e2e/hitl-resume.test.ts`
- `tests/integration/automation-e2e.test.ts`
- `tests/integration/todo-lifecycle-acceptance.test.ts`

**This is exactly what plan Risk #5 anticipated** ("Existing tests assert post-run overwrite behavior and break / Update them"). Dev found and fixed them.

**However:** the dev's coverage was incomplete. See Concerns §1.

---

## Probe Results (probe-run-2.md)

5/5 PASS, all STAGE 1, on `chiang-mai-aqi-worker` (notify: debrief). Sample deliverable:

```
## Chiang Mai Air Quality

**AQI: 89 (Moderate)**
PM2.5: ~30 µg/m³ | Dominant pollutant: PM2.5
…
```

Compare to pre-fu3 (Apr 30 morning, contaminated): `"I'll start by checking my todo list and then execute the automation. I need to understand…"`

Same worker, same model, same prompts. Only the executor block changed. Contamination eliminated.

**The probe-run-2 is sound evidence for STAGE 1.** The dev's interpretation is correct: this validates the worker→executor contract that was the load-bearing fix.

---

## Concerns

### 1. Four tests failing post-merge — dev's "0 failing" claim is incorrect

I ran the full vitest suite from a clean working tree at master HEAD. Result:

```
Test Files  2 failed | 180 passed | 14 skipped (196)
     Tests  4 failed | 1451 passed | 24 skipped (1479)
```

The 4 failing tests:

1. **`tests/e2e/automation-lifecycle.test.ts:169`** — *"user automation: manifest → sync → DB → executor → SDK session path"*
   Error: `Worker did not write deliverable.md to /tmp/lifecycle-…`
   Assertion: `expected 'failed' to be 'needs_review'`

2. **`tests/integration/e2e-agentic-flow.test.ts:226`** — *"completes job when all mandatory todos are done"*
   Error: `Final validator gate failed: deliverable.md body is too short (< 50 chars after frontmatter)`
   The mock writes `"All tasks done."` — only 15 body chars. Below the 50-char minimum the validator enforces.

3. **`tests/integration/e2e-agentic-flow.test.ts:275`** — *"gates completion when mandatory todos are incomplete"*
   Error: `Worker did not write deliverable.md`
   Assertion: `expected 'failed' to be 'needs_review'`

4. **`tests/integration/e2e-agentic-flow.test.ts:325`** — *"processor enqueues notification and heartbeat delivers"*
   Error: `Worker did not write deliverable.md`
   Assertion: `expected 'job_failed' to be 'job_needs_review'`

These tests were broken by fu3 (the new fail-loud behavior is correct; the tests' mocks are stale). The dev fixed 3 similar test files in commit `8b08c8a` but missed these 2 files (4 cases). Two distinct fix patterns needed:

- **Tests #2 with insufficient content** — update the mock's deliverable to ≥50 chars of clean body. ~5-line per-test fix.
- **Tests #1, #3, #4** — these test the fail-path. Pre-fu3 the executor silently fabricated and the job ended `needs_review`. Post-fu3 the executor throws and the job ends `failed`. The test assertions need to update to match the new contract (this is a CORRECT behavior change, not a regression — the assertion just needs to reflect it).

The dev's `8b08c8a` commit message claimed *"All 7 previously-failing tests now pass. Full suite: 173 files / 1373 tests passing, 0 failing."* My run shows 196 files / 1451 passing / 4 failing — 23 more files and 78 more tests than the dev measured, including these 4 failures. The dev's verification was incomplete.

**Severity: medium.** Not blocking production morning brief (probe-run-2 is independent evidence the production fix works). But the "0 failing" claim is incorrect, and the gap suggests the dev didn't run the full suite from a clean tree at the final commit.

**Fix effort:** ~30 minutes. ~10 lines of test fixture updates across 2 files.

### 2. STAGE 2 not yet validated in production post-fu3

`probe-run-2.md` only tested `notify: debrief` workers (chiang-mai-aqi-worker). STAGE 2 (assistant turn cleanliness on `notify: immediate` deliveries) is NOT covered by probe-run-2. The dev acknowledges this in §"What's still pending":

> **Task 8.3 (manual verification on real conv):** fire `debrief-reporter` once into the user's real conversation. […] **Task 9 (Day-4 morning soak observation, 2026-05-01):** the calendar-day soak gate.

The plan called for "5x Trigger 1 PASS gates the soak." STAGE 1 is 5x. STAGE 2 is 0x in production for `notify: immediate`. So the soak gate is partially met.

The dev's reasoning is sound:
- fu3 changes the worker→executor contract (STAGE 1 surface)
- fu2 already validated the prompt-body delivery path (probe-run-1, 5x Trigger 2)
- STAGE 1 + fu2's validated stack → STAGE 2 should follow

But this is composition reasoning, not direct evidence. **Tomorrow's calendar morning observation (2026-05-01) is the actual STAGE 2 test for `notify: immediate`.** The dev should explicitly NOT close fu3 until both delivery types are observed clean for at least 1 calendar morning.

**Severity: low.** Acknowledged gap, deferred appropriately.

### 3. Worker timeout 150s is tight

`f14ccca` bumped `WORKER_TIMEOUT_SECS` from 90 → 150. The probe-run-2 observations: max worker run was 140s. That's within 10s of the timeout cap.

If the SDK or web fetch slows under different conditions (rate limiting, network jitter, model warmup), runs could exceed 150s and the probe will fail-flake.

**Severity: low.** Easy follow-up: switch from fixed timeout to "poll for `deliverable.md` to appear in run dir, with 300s upper bound." Or just bump to 240s.

### 4. Resume path no longer fail-loud on missing deliverable

`automation-executor.ts:1015` (resume path):

```typescript
const summary = resolveJobSummary(job.run_dir, response);
```

`resolveJobSummary` (sync) reads `deliverable.md` if present, falls back to `response` if not. Pre-fu3 the resume path called `extractDeliverable(response)` and could fabricate. Post-fu3 it just passes raw `response` as the fallback. If the resumed worker doesn't write `deliverable.md`, the response stream becomes the deliverable — same shape as the bug we just fixed, but on the resume edge case.

**Severity: low.** Resume is a degraded path anyway (recovering from interruption). The main fail-loud guarantee is on the primary execution path. But strictly speaking, the fail-loud invariant is only half-applied. Worth a follow-up to extend `readAndValidateWorkerDeliverable` to the resume path too, or document the exception.

### 5. Defense-in-depth gate could be tighter

The job-end validator at line 89 calls `runValidation("deliverable_written", runDir)`. This catches narration contamination (Hypothesis H2). But the validator's own regex has known holes (the dev acknowledged this in fu1 + the plan's "Out of scope" #3). If a future worker emits new narration patterns the regex doesn't catch, the gate misses.

**Severity: low.** The regex is the same one the worker-runtime validator uses; not a regression. Tracking new patterns as they surface is the documented ongoing-maintenance approach. The defense-in-depth gate is still net-positive — it catches validator-bypass cases (H2) regardless of whether the regex is exhaustive.

---

## Verdict

**APPROVE WITH CONCERNS.**

The load-bearing fix is correct and well-implemented. fu3's `readAndValidateWorkerDeliverable` is a refactor improvement over the plan's inline code; the worker contract is now coherent (one writer, two validator gates, no silent overwrite); the legacy XML-tag contract is fully retired; the cadence-rule contradiction is resolved; the soak-probe correctly distinguishes the two stages. Probe-run-2 produced 5/5 STAGE 1 PASS in production with direct content evidence — same worker that was contaminated this morning is now clean.

Three above-and-beyond moves: (a) extracting the helper as a free function, (b) finding and fixing 3 additional test files the plan didn't enumerate, (c) adding notify-aware probe logic post-merge.

Concerns are real but bounded:
- **Concern #1 (4 failing tests)** is the only one needing immediate cleanup. ~30 min of test fixture / assertion updates. Should land before Task 9 (calendar morning observation) so the master tree is green.
- **Concern #2 (STAGE 2 not yet probed in production for notify: immediate)** is documented and tomorrow's calendar morning closes it.
- **Concerns #3-5** are forward-improvements, track for S4.3 or follow-up; non-blocking.

Recommend: **fix Concern #1 today** (4 test fixture/assertion updates), then proceed with Task 8.3 (manual fire on real conv) and Task 9 (Day-4 morning observation). Do not close fu3 until Concern #1 is green and at least one calendar morning is observed clean for both `notify: debrief` and `notify: immediate` deliveries.

---

## What's not in this audit

- The morning calendar observation for 2026-05-01 (Task 9). That's the next gate; review it when the soak-day-4.md report lands.
- S4.3 deferred items (chart augmentation, capability template migration). Tracked on roadmap; not part of fu3 scope.
- Live-LLM e2e tests (24 skipped on env preconditions). Pre-existing skip pattern; not affected by fu3.

## References

- Plan: [`soak-day-3-followup-plan.md`](soak-day-3-followup-plan.md)
- Investigation docs: [`worker-pipeline-history.md`](worker-pipeline-history.md), [`worker-pipeline-mechanism-inventory.md`](worker-pipeline-mechanism-inventory.md), [`worker-pipeline-redesign.md`](worker-pipeline-redesign.md)
- Probe results: [`probe-run-2.md`](probe-run-2.md) (STAGE 1, 5/5 PASS)
- PR: #13 merged at `f41ea2e`
- Post-merge: `f14ccca` (probe notify-aware), `3e42e4d` (probe-run-2 docs)
- Open follow-up: 4 failing tests in `e2e/automation-lifecycle.test.ts` + `integration/e2e-agentic-flow.test.ts`
