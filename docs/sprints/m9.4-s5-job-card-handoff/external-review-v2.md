---
reviewer: external (Opus, general-purpose agent)
date: 2026-04-12
scope: spec.md (v2)
prior_review: external-review.md
verdict: ready for implementation with two caveats (NF1, NF4 to decide; NF2 mechanical)
---

# External Review v2: M9.4-S5 Spec Revision

## Per-finding verdict

| ID | Verdict | One-line reason |
|----|---------|-----------------|
| C1 todoProgress stripped | **Resolved** | B4 removes `status==='running'` gate; F1 frozen snapshot adds defense-in-depth. |
| C2 initiate() can't fade | **Resolved (via descope)** | Explicitly removes `triggerJobId` from `initiate()`; falls back to 10s safety net. Honest limitation. |
| I1 Stray start events | **Resolved** | F4 explicit — `ws-client.js` emits handoff event only when `triggerJobId` present. |
| I2 Serial alert loop | **Resolved (via redesign)** | F5 sibling-aware reset replaces the unachievable "independent" criterion. Acceptance #5 rewritten. |
| I3 Busy-skip silently breaks | **Partially Resolved** | B6 adds explicit `skipped` event + retry, but `handoff_pending` WS broadcast is "optional." Without it, card fades at 10s and alert arrives later on a silent chat. See NF1. |
| I4 Mutex idempotency | **Resolved** | B1 adds `draining` flag. See verification 2 below. |
| I5 200ms budget | **Resolved** | Raised to 300ms with rationale. |
| I6 Setter pattern | **Partially Resolved** | Wiring order pinned "before start()"; degraded-but-not-broken in construction window. Acceptable as documented. |
| Q1 Frontend t0 | **Resolved** | Defined as `Date.parse(jobSnapshot.completed)` at handoff entry. |
| Q2 Mobile/desktop dual fade | **Resolved (documented)** | Risks section acknowledges as noise, not correctness. |
| M1 debrief regression | **Resolved** | B5 surfaces `notify`; F2 routes `none`/`debrief` to legacy 2s fade. |
| M2 job_interrupted floor | **Documented** | Called out in notification-types table. |
| M3 chat-service:770 | **Documented** | Listed in risks as future concern. |
| M4 confirmStop | **Partially Resolved** | F2 adds dismiss clear; "verify during implementation" — acceptable. |
| M5 activeCards filter | **Partially Resolved** | F3 picks `completedCards.push`; Files Touched still has "OR" — see NF2. |

## New findings

### NF1 — Important: Busy-skip half-fixed

`handoff_pending` WS broadcast is "optional." If deferred, the card-fades-then-alert-lands-on-silent-chat regression remains. Acceptance #7 only tests the never-delivered case, not the busy-skip-then-late-arrival case. Make mandatory in v1, OR add an acceptance test that documents the regression.

### NF4 — Important: Sibling safety net has a pre-first-start hole

Spec walk-through assumes "card #1's start arrives at t=2s." Acceptance #3 budgets 300ms only to `alert() invoked` — but SDK init + LLM first-token can legitimately exceed 10s. If card #1's first `start` arrives at t=12s, card #2's 10s safety net fires at t=10s and card #2 fades prematurely (before any sibling-reset signal can fire).

Three options:
- **(a)** Extend initial safety-net to 20–30s.
- **(b)** Emit `handoff_pending` broadcast on `drainNow` start for *every* queued notification (not only busy-skip), so siblings know delivery is in progress immediately.
- **(c)** Document as acceptable regression.

**(b) cleanly solves both NF1 and NF4 in one stroke** — make `handoff_pending` mandatory and broadcast for every notification at drainNow time.

### NF2 — Minor: "OR" ambiguity in Files Touched

`stores.js` line says "extend `activeCards` filter OR rely on `completedCards` push." F3 picks `completedCards`. Remove "extend activeCards filter" alternative.

### NF3 — Minor: "Mutex" terminology

In single-threaded JS, `draining` is a reentrancy guard, not a mutex. Phrasing nitpick — note it's not guarding true concurrency.

### NF5 — Minor: Default `notify` handling

Backend default: `notify ?? "debrief"` (`automation-processor.ts:201`). Frontend must mirror — `notify === undefined` → treat as debrief → legacy 2s fade. Spec doesn't state this explicitly.

### NF6 — Minor: Out-of-order WS delivery

If `start` arrives before `state:jobs(completed)` (extremely rare in practice — same process, TCP-ordered), the listener no-ops because no card is in handing-off yet. Card later runs full 10s safety net despite a real reply existing. Acceptable but worth a one-line note.

### NF7 — Minor: `completedCards.push` ambiguity

F3 says `enterHandingOff` pushes to `completedCards`; `enterFading` is the renamed body of `handleJobCompleted` (which currently pushes). Spec must say explicitly: "the push *moves* from `enterFading` to `enterHandingOff`; `enterFading` no longer pushes." Otherwise careless refactor double-pushes.

### NF8 — Minor: Playwright sibling-reset test specifics

Acceptance #5 test must mock alert stream latency to actually exercise sibling-reset. Just timing the `state:jobs` broadcast isn't enough — the test needs to delay the second alert long enough that the first sibling event must fire to keep card #2 alive.

## Verifications

**(2) Mutex correctness (B1).** Logic correct for stated invariant. JavaScript single-threaded → boolean flip is atomic, no real mutex needed. `checkStaleJobs` and `checkCapabilityHealth` still run regardless of `draining` — no starvation.

**(3) Sibling safety net pre-first-start.** See NF4 above — real hole.

**(4) Frozen snapshot vs activeCards.** B4 makes `todoProgress` populated on completed jobs, but `activeCards` filter still gates on `status === "running"` — so completed-with-todos jobs don't appear there. They appear via `completedCards` push. **`completedCards` is the correct mechanism** — drop the "OR" alternative.

**(5) `notify` field availability.** Verified via `automationManager.findById(j.automationId)` in StatePublisher. Handler-dispatched jobs have a manifest. Default-handling for `notify === undefined` → must be mirrored on frontend (NF5).

**(6) Mutex starvation.** Confirmed: stale-job and capability checks run unconditionally. No starvation.

**(7) Event ordering.** In normal flow, executor returns → `state:jobs(completed)` → `handleNotification` → `drainNow()` → `ci.alert()` → `start` yield. So `state:jobs` precedes `start`. Out-of-order is theoretically possible (NF6) but extremely rare.

**(8) handoff_pending optionality.** See NF1.

**(9) completedCards double-push.** See NF7.

**(10) Acceptance #6 contradiction.** Verified: works as stated. `notify === "debrief"` early-returns at `automation-processor.ts:232` — no enqueue, no `drainNow`. Frontend F2 routes directly to `enterFading`. Frontend default-handling (NF5) is the gotcha.

## Verdict

Spec v2 addresses all four critical gaps from v1 and most important ones. **Ready for implementation with two caveats:**

1. **Resolve NF2** (mechanical — pick `completedCards.push`).
2. **Decide NF1 + NF4** before coding. Recommended: option (b) — mandatory `handoff_pending` broadcast on every drainNow start. Solves both in one stroke.

Minor findings (NF3, NF5, NF6, NF7, NF8) are documentation/phrasing fixes that can fold in during implementation.
