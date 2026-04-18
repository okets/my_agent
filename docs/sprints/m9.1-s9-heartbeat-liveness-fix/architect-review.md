---
sprint: m9.1-s9
title: Heartbeat Liveness Fix — Architect Review
status: APPROVED
date: 2026-04-18
reviewer: architect (post-execution)
verdict: Ship — exceeds spec on two material points
---

# Architect Review — M9.1-S9: Heartbeat Liveness Fix

**Verdict: APPROVED. Ship as-is.**

The dev executed all 14 planned tasks, shipped both deviations as quality improvements over the spec, and produced a clean defense-in-depth implementation. Test coverage is complete, no regressions introduced, code is well-commented. Two minor follow-up items noted, neither blocking.

---

## Verification Performed

| Check | Result |
|---|---|
| Branch `sprint/m9.1-s9-heartbeat-liveness-fix`: 11 commits, on top of plan commit `5479e0e` | ✓ |
| Plan tasks 1–14 traceable to commits | ✓ |
| Audit-liveness unit tests (`audit-liveness.test.ts`) | **6/6 PASS** |
| Heartbeat unit tests (`heartbeat-service.test.ts`) | **14/14 PASS** (8 pre-existing, 6 new) |
| Manifest serializer round-trip tests (`automation-manager.test.ts`) | **3/3 PASS** |
| Integration tests (`heartbeat-acceptance`, `e2e-agentic-flow`, `restart-recovery-acceptance`, `status-prompt-acceptance`) | **21/21 PASS** |
| Full dashboard suite | 9 files / 24 tests fail — **all 24 pre-existing on master**, identical failure set, **zero S9 regressions** |
| Core typechecks (`packages/core && npx tsc --noEmit`) | clean |
| Live smoke (per dev's review): synthetic stale notification → recheck path discarded | confirmed via journal log |

---

## Spec Compliance

All four layers are present and correctly wired:

| Layer | Where | Notes |
|---|---|---|
| **L1** Audit-log liveness | `audit-liveness.ts:20`, `heartbeat-service.ts:173-176` | 64KB tail, drops partial first line, returns 0 on missing session/log. Helper has 6 unit tests including the off-tail-window edge case. |
| **L2** Lazy run-dir mtime | `heartbeat-service.ts:32-67`, `:186-189` | Lazy-evaluated only when L1 is also stale, depth-bounded to 4. **Improved beyond spec** — see deviation D1 below. |
| **L3** 60s min-age gate + recheck | `heartbeat-service.ts:18, 261-278` | Counter `falsePositivesDropped` exposed publicly per R10 hardening. Configurable via `interruptedMinAgeMs` — see deviation D2. |
| **L4** Per-automation threshold | `heartbeat-service.ts:179-181`, `app.ts:1923-1926`, `automation-manager.ts:60,306,332` | Resolver wired through `automationManager.findById()`. Threshold used in BOTH the lazy L2 gate (line 186) and the final isStale check (line 191). |

Manifest field plumbed through all three layers correctly:
- Type definition (`automation-types.ts:50-57`)
- Serializer write+read (`automation-manager.ts:60, 306, 332`)
- Resolver wiring (`app.ts:1923-1926`)

Round-trip test (`automation-manager.test.ts`) covers create / absent / update — uses public API rather than private serializer methods, which is cleaner than the plan suggested.

---

## Deviations From Spec — Both Correct

### D1. `EXECUTOR_FILES` exclusion in `readRunDirMtime`

**Plan said:** recursively walk run-dir for liveness signal.
**Dev did:** walk, but skip `todos.json`, `deliverable.md`, `CLAUDE.md`, `task.md` (commit `01bee5d`).

**Why this matters:** `deliverable.md` is written by the executor at job *completion* (line 489 of `automation-executor.ts`). Without the exclusion, every freshly-completed job would have a fresh run-dir mtime, **completely defeating L2 stale detection on jobs the executor itself just wrote to**. The dev caught this through tests — exactly what TDD is for. The exclusion list is hoisted to module scope (commit `9e5b782`) for clarity. Correct fix.

This is a real bug the spec missed. Without D1, L2 would be a no-op on most stale-job scenarios.

### D2. `interruptedMinAgeMs` made configurable via `HeartbeatConfig`

**Plan said:** hardcode `INTERRUPTED_MIN_AGE_MS = 60_000`.
**Dev did:** kept the constant as the default but added an optional config override (commit `01bee5d`), so single-tick integration tests can set it to `0`.

**Why this matters:** the existing `heartbeat-acceptance` and `e2e-agentic-flow` integration tests assert that a stale job → notification → delivery happens in a single tick. With a hardcoded 60s gate, those tests would have either (a) become flaky/slow with real timing, or (b) required `vi.useFakeTimers()` plumbing. The config knob is the cleaner approach. Production behavior is unchanged (default applies); tests get a way to bypass it cleanly. Both integration tests updated to pass `interruptedMinAgeMs: 0` with explanatory comments.

This is the right engineering instinct — keep the production guard while making it testable.

---

## Code Quality Observations

**Strong points:**
- All code paths annotated with `M9.1-S9` references and link back to the layer name (L1/L2/L3/L4)
- `EXECUTOR_FILES` is a `Set` (O(1) lookup), correctly hoisted to module scope
- `readLastAuditTimestamp` uses `try/finally` for the file descriptor — no leak path
- Lazy L2 evaluation actually gates on `>` not `>=` the threshold (line 186) — consistent with the final `isStale` check on line 191, no off-by-one
- Counter `falsePositivesDropped` is `public` (per R10) without being polluted with getters/setters
- The recheck branch correctly handles "fresh && fresh.status !== 'interrupted'" — a `null` job (record gone) falls through and delivers the alert, which is the safe default

**Minor things, not blocking:**

1. **Notification template wording** (`heartbeat-service.ts:354`) still says `"stale — no activity for 5+ minutes"`. With the per-automation override, the threshold can be 15 min. With the gate, the alert lands at least 60s after the stale check. Strictly speaking the wording is now imprecise. Low-priority cleanup — the brain reads this verbatim and forwards to the user.

2. **`automation-manager.ts:60` adds `health` to the explicit field-mapping in `manifestToFrontmatter` for the `create()` path**, but the `update()` path uses the same `manifestToFrontmatter` further down. That's fine — but worth noting that this serializer pattern (explicit field-by-field) means **future fields must remember to update three places** (input mapping, write, read). Not a bug; a structural debt for a follow-up sprint.

3. **The dev review claims "15 new tests"** which is accurate (6 + 6 + 3). Both the plan and the implementation agree on the test count.

---

## Risks Re-Assessed Post-Implementation

The plan's "Risks Accepted" section anticipated four limitations. Re-checking each against the shipped code:

| Risk | Status |
|---|---|
| Audit-log tail off-the-back under extreme concurrent load | Still possible. L2 (run-dir mtime) is the documented backstop. **The EXECUTOR_FILES exclusion makes L2 actually work** — without it, this backstop would have been illusory. D1 strengthens the risk story. |
| Subagent silent gaps | Same as planned — L2 + L4 are the escape hatches. |
| Min-age gate adds 60s to true positives | Configurable now (D2). Default unchanged. Acceptable. |
| `neverStarted` 2-min hair-trigger unchanged | Test "still triggers neverStarted even when audit log shows activity (intentional)" encodes the limitation as intended. |

No new risks discovered during execution.

---

## Smoke Test Adequacy

Dev's review.md (Step 11.4 of plan) confirms the synthetic-notification path was exercised end-to-end with a real `falsePositivesDropped` increment in the journal. This validates L3 in production. L1 was validated by the unit test "does NOT mark interrupted when audit log shows recent tool activity" plus the existing audit log naturally accumulating during normal operation.

The plan also called for a deterministic induced-stale test in production (Task 12 step 5) using a 30s threshold via per-automation override. Dev's review doesn't explicitly mention running that step but the L4 mechanism is unit-tested. Not a blocker — production traffic over the next few days will surface any L1/L2 issue and the `falsePositivesDropped` counter is the canary.

---

## Follow-Ups (Not Blocking)

The dev's review correctly enumerates these:

1. **Restart-recovery eligibility for scheduled workers** (Apr 7 incident class) — separate ticket as planned.
2. **`falsePositivesDropped` → `/health` endpoint or metrics** — counter is exposed but not yet wired to a visible surface. Small follow-up.
3. **Chunked backward reads in `audit-liveness.ts`** — only if 64KB tail proves insufficient. No evidence yet.

I'd add two more from this review:

4. **Notification template wording cleanup** (item 1 in Code Quality Observations).
5. **Manifest serializer pattern** (item 2) — for future fields, consider switching to a transparent pass-through with an allowlist, so adding a field is a one-line change. Not urgent.

---

## Decision

**APPROVED. Merge to master.** No follow-up sprint required for this fix. The implementation is correct, tested, regression-free, and exceeds spec on the two deviations.

Recommend the dev's commit log stand as-is — the commits tell a clean TDD story (failing test → impl → fix → refactor) and the two deviation commits (`01bee5d`, `9e5b782`) document their reasoning in the commit messages, which is exactly the audit trail this kind of corrective sprint needs.

Branch ready for fast-forward merge to master. No squash needed — the per-layer commit history is valuable for future reference.
