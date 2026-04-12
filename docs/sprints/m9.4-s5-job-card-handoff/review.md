---
reviewer: external (Sonnet, independent)
date: 2026-04-12
sprint: M9.4-S5
scope: spec.md (v3), plan.md (13 tasks), code diff master..HEAD (12 commits)
verdict: PASS WITH CONCERNS
---

# External Verification Report

**Sprint:** M9.4-S5 Job Card Handoff Continuity
**Reviewer:** External (independent — no shared context with implementation team)
**Date:** 2026-04-12

---

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| B1 `drainNow()` with reentrancy guard | COVERED | `heartbeat-service.ts:46–56`; `draining` boolean; `tick()` also guards (`heartbeat-service.ts:79–88`). Unit test: heartbeat-service.test.ts "concurrent drainNow calls don't double-deliver". |
| B2 `setHeartbeat()` setter; `drainNow()` called post-enqueue | COVERED | `automation-processor.ts:66–68` setter; `:272` fire-and-forget `.catch`. `app.ts:1575` wires before `start()`. Unit test: automation-processor.test.ts "calls heartbeat.drainNow() after enqueueing". |
| B3 `triggerJobId` tagged on alert turn's `start` frame | COVERED | `send-system-message.ts:52–54` conditional yield; `conversation-initiator.ts:111,127,153` all three `sendSystemMessage` call sites forward `triggerJobId`. Unit test: send-system-message.test.ts "emits start with triggerJobId when option present". |
| B4 `todoProgress` populated regardless of status | COVERED | `state-publisher.ts:530–547` removes `j.status === 'running' &&` gate. Integration test: state-publishing-jobs.test.ts "includes todoProgress on a completed job". |
| B5 `notify` field in `JobSnapshot` | COVERED | `state-publisher.ts:559`; `protocol.ts` `JobSnapshot` interface. Integration test: state-publishing-jobs.test.ts "includes notify field from the automation manifest". |
| B6 Explicit busy-skip event | DESCOPED (acceptable) | `send-system-message.ts:45–49` retains existing early-return (no new event type). Plan explicitly documents: "`handoff_pending` retry from B7 covers the recovery case." The `_onHandoffPending` handler resets all handing-off cards on any pending broadcast, including during retry ticks. No test for busy-skip → late-arrival specific path, but the B7 Stage-1 upfront broadcast adequately resets cards before any delivery attempt begins. Acceptable per plan rationale. |
| B7 Two-stage `handoff_pending` broadcast | COVERED | `heartbeat-service.ts:150–157` (Stage 1 upfront batch); `:171–176` (Stage 2 per-iteration). Unit test: heartbeat-service.test.ts "broadcasts handoff_pending for every pending notification BEFORE first alert awaits (Stage 1)". |
| F1 Per-card phase state (`phase`, `safetyTimers`, `frozenSnapshot`) | COVERED | `progress-card.js:17–19`. |
| F2 Phase transitions (running→handing-off, running→fading legacy, handing-off→fading on start/timer, dismiss cleanup) | COVERED | `progress-card.js:114–178` (`enterHandingOff`, `enterFading`, `legacyFade`); `dismiss()` and `confirmStop()` both clean phase/frozenSnapshot/safetyTimers. Browser tests: AC4, AC6, AC6b, AC7. |
| F3 `$watch` split: `enterHandingOff` pushes to `completedCards`; `enterFading` does not | COVERED | `progress-card.js:114–131` (`enterHandingOff` pushes); `enterFading` (`138–156`) does not push — matches spec NF7 resolution. `legacyFade` (`:163–179`) retains push for the non-handoff path. |
| F4 WS event wiring (`assistant-turn-start`, `handoff-pending`) | COVERED | `ws-client.js:124–139`; `progress-card.js:251–256`. Unit test: ws-client.test.ts all 3 cases. |
| F5 Sibling-aware safety net | COVERED | `progress-card.js:202–225` (`_onAssistantTurnStart` resets siblings; `_onHandoffPending` resets all handing-off). Browser test: AC5 "sibling card resets safety net when A fades"; AC12 "handoff_pending for own jobId resets safety net". |
| F6 Visual states (Done/Failed/Needs review labels + colors) | PARTIAL — gap documented below | `index.html:5992,5994` hardcodes `'Done'`/`'✓'` for all terminal states. Spec requires distinct labels and colors for `failed` (`text-pink-400`) and `needs_review` (`text-orange-400`). Plan explicitly defers this as "F6 status-specific labels — acceptable for v1." |
| AC1 Instrumentation → smoke test timing baseline | COVERED | test-report.md records 12.5s heartbeat wait confirming Contributor 1 dominant. Timing module (`timing.ts`) removed in Task 13 cleanup commit. |
| AC2 30s tick retained as retry path | COVERED | `heartbeat-service.ts:60–67` — 30s `setInterval` unchanged; `drainNow` is purely additive. |
| AC3 <300ms from enqueue to `alert() invoked` | COVERED (code path verified, no post-impl number) | `handleNotification`: `enqueue()` is synchronous; `drainNow()` called immediately fire-and-forget. Inside `deliverPendingNotifications`, `listPending()` + Stage-1 broadcasts precede the first `await ci.alert()` — no blocking I/O before loop entry. Post-impl timing number absent (timing logs removed in Task 13 before post-impl measurement was captured). The code path confirms 300ms is achievable, but the test report shows "Post-implementation timing: (filled by Task 13)" remains unfilled. See gaps. |
| AC5 Multi-card sibling-aware (NF8: alert latency > 10s) | COVERED | Browser test AC5 waits 8s then fires sibling `start`; card B verified still visible. |
| AC6 `notify=none` legacy fade | COVERED | Browser test AC6. |
| AC8 Drain mutex | COVERED | Unit test: "concurrent drainNow calls don't double-deliver". |
| AC9 No regression (M9.4-S3 T1–T10) | COVERED | All 10 M9.4-S3 browser tests pass in independent run. |
| AC10 Untagged `start` frames ignored | COVERED | Unit test: ws-client.test.ts "does NOT emit assistant-turn-start when start has no triggerJobId". |
| AC11 Protocol field optional + backwards compatible | COVERED | `triggerJobId?: string` (optional). |
| AC12 `handoff_pending` for own jobId resets safety net | COVERED | Browser test AC12 (14.6s). |
| NF5 `notify=undefined` → debrief → legacy fade | COVERED | `progress-card.js:241`; browser test AC6b. |

---

## Test Results

Run independently on branch `sprint/m9.4-s5-job-card-handoff`:

- **Unit + Integration:** 474 passed, 0 failed, 0 skipped (57 test files)
  - Matches implementation team's reported 474 — verified independently.
- **TypeScript:** compiles clean (`npx tsc --noEmit` — 0 errors)

---

## Browser Verification

Dashboard running at `http://localhost:4321` on sprint branch. Tests run with Playwright (vitest + chromium headless):

- [x] `tests/browser/progress-card-handoff.test.ts` — 6 tests, all pass (AC4, AC5, AC6, AC6b, AC7, AC12)
- [x] `tests/browser/progress-card.test.ts` (M9.4-S3 regression) — 10 tests (T1–T10), all pass
- [x] Dashboard loads at `/` without errors (implicitly confirmed by all 16 browser tests completing)

Total browser: 16 passed, 0 failed.

---

## Gaps Found

### Gap 1 — F6 Visual States: Partial Implementation (known, deferred)

**Severity:** Minor / cosmetic

**Spec says** (§F6):
- `handing-off (failed)`: label "Failed", counter `✕`, dot color `text-pink-400`
- `handing-off (needs_review)`: label "Needs review", counter `⚠`, dot color `text-orange-400`

**Implementation:** `index.html:5992` renders `isDone(job.id) ? 'Done' : ...` for both desktop and mobile — all terminal statuses show "Done" / "✓" regardless of underlying `frozenSnapshot.status`. The phase data exists to support status-specific labels but the template doesn't use it.

**Plan status:** Explicitly deferred — "Acceptable for v1; track as polish." This is a known gap, not an oversight. No acceptance criterion requires this for v1 sign-off. Flagged here for completeness per reviewer procedure.

**Recommendation:** Track as a follow-up task. One-line template fix: replace `'Done'` with a ternary reading `frozenSnapshot[job.id]?.status`.

---

### Gap 2 — AC3 Post-Implementation Timing Number Missing

**Severity:** Minor / documentation

**Spec AC3 says:** "time from `[timing] enqueued` to `[timing] alert() invoked` is < 300 ms."

**Test report:** "Post-implementation timing: (filled by Task 13)" — this section was never filled. The timing instrumentation was added (Task 1), smoke-tested pre-implementation (baseline 12.5s heartbeat wait recorded), then removed in Task 13 cleanup. Task 13 in the plan includes "Step 6: record the timing here" but the test report section is empty.

**Mitigation:** The code path is synchronous — `enqueue()` is synchronous, `drainNow()` fires immediately after with no intervening `await`. Code inspection confirms the 300ms budget is achievable. This is a documentation gap, not a functional gap.

**Recommendation:** Either accept without a post-impl number (code path is auditable), or add a one-time log statement in the next sprint to confirm.

---

### Gap 3 — Closing CTO Smoke Test Pending

**Severity:** Blocker for full sign-off (per test-report.md header)

**Test report header says:** "sprint is not signed off until CTO repeats the M9.5-S6 closing CNN smoke test on the dashboard and confirms a smooth handoff (no perceptible silent gap)."

**Status:** "Closing smoke test: (filled by CTO after sprint review)" — not yet performed.

This is a stated exit criterion from DECISIONS.md D1 and the test report itself. Automated tests confirm correctness but cannot substitute for the human-eyes UX validation the CTO explicitly required.

**Verdict impact:** This is not a code defect; it is a sprint exit gate that requires human action. The automated evidence is sufficient for PASS WITH CONCERNS pending the smoke test.

---

## Specific Concern Verifications

**B6 descope reasoning:** `_onHandoffPending` in `progress-card.js:220–225` resets every handing-off card's safety timer on any `handoff_pending` event — including the card whose session is busy. Since the next heartbeat tick re-runs Stage-1 upfront broadcast for all still-pending notifications, the busy-skip case correctly keeps cards alive across retry windows. The reasoning holds.

**AC3 path synchrony:** Confirmed. `handleNotification` at line 257 calls synchronous `notificationQueue.enqueue()`; line 272 calls `drainNow()` as fire-and-forget (no `await`). Inside `deliverPendingNotifications`, Stage-1 `broadcastToAll` calls are synchronous before the first `await ci.alert()`. No blocking operations between enqueue and `alert() invoked`.

**`initiate()` path — no `triggerJobId`:** Confirmed at `heartbeat-service.ts:191–193`. `initiate()` call has no `triggerJobId`. Matches spec C2 descope.

**B4 conditional removed:** Confirmed. `state-publisher.ts:530` — `const todoProgress: JobSnapshot["todoProgress"] = j.run_dir ? (() => { ... })() : undefined` — no `j.status === 'running'` gate.

**F6 visual states:** Partial only. All terminal statuses show "Done" / "✓". Deferred per plan.

---

## Verdict

**PASS WITH CONCERNS**

All B1–B5, B7, F1–F5 spec requirements are implemented and tested. 474 unit/integration tests pass; TypeScript compiles clean; all 16 browser tests pass including 6 new handoff tests and 10 M9.4-S3 regressions. Two concerns:

1. **F6 visual states** (failed/needs_review label differentiation) is explicitly deferred as v1 polish — code supports it, templates don't expose it yet. Low urgency.
2. **Closing CTO smoke test** is a stated exit criterion (DECISIONS.md D1, test-report.md) that has not been performed. Sprint should not be formally signed off until the CTO confirms a smooth end-to-end UX. Automated evidence is strong; this is a human-eyes gate, not a code defect.
