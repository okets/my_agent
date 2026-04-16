---
sprint: M9.6-S8
reviewer: external-code-reviewer (Claude Sonnet 4.6)
date: 2026-04-16
verdict: APPROVED WITH OBSERVATIONS
---

# M9.6-S8 Code Review

## Summary

S8 is a three-item cleanup sprint closing S6 follow-ups. All three spec items are correctly implemented and TypeScript compiles clean in both packages. The core and dashboard test suites pass (26 core tests, 149 dashboard tests). One defect was found: the Playwright test for S6-FU5 calls a non-existent method name and would fail if the dashboard were running. One spec deviation (diff size) is within acceptable bounds for the test infrastructure required. No `.my_agent/` files were touched.

---

## Verdict: APPROVED WITH OBSERVATIONS

The implementation is functionally correct and safe to merge. The Playwright test bug (see Critical finding below) must be fixed before the test is considered part of the exit gate.

---

## What Was Done Well

- All three FU fixes are surgical and minimal in production code. The implementation files (`ack-delivery.ts`, `recovery-orchestrator.ts`, `resilience-messages.ts`, `protocol.ts`, `app.ts`) are tight: combined production-code changes are under 30 lines.
- The `surrender-cooldown` branching in `app.ts` correctly delivers the ack copy without writing a duplicate `capability_surrender` event, and logs the cooldown-hit at INFO level as specified.
- The `elapsedSec` removal is complete: interface, implementation, and both call sites (orchestrator emitAck callback in `app.ts`; note the orchestrator itself calls `emitAck(failure, "status")` and does not call `defaultCopy.status()` directly, so only one call site in `app.ts` needed updating — this is correct).
- TypeScript is clean in both packages with `--noEmit`. No type-level gaps introduced by the `AckKind` union extension.
- Existing tests were updated to reflect `"surrender-cooldown"` where they previously asserted `"surrender"` on cooldown paths (`orchestrator-budget.test.ts`, `orchestrator-surrender-scope.test.ts`). These are correct updates, not vacuous changes.
- Privacy guardrails respected: no `.my_agent/` modifications confirmed via diff.

---

## Issues

### Critical — Must Fix Before Exit Gate

**S6-FU5: Playwright test calls non-existent method**

File: `packages/dashboard/tests/browser/capability-ack-render.test.ts`, line 57

The test injects the WS message via:
```javascript
data.handleWebSocketMessage({ type: "capability_ack", ... });
```

The actual Alpine component method is `handleWsMessage` (defined at `packages/dashboard/public/js/app.js:1293`, called at line 888). `handleWebSocketMessage` does not exist on the Alpine data object.

When the dashboard is running, `Alpine.$data(body).handleWebSocketMessage(...)` will silently no-op (calling `undefined` is not caught in the evaluate context because it evaluates to `undefined(...)` which throws, but Playwright's `page.evaluate` will propagate that as a rejection). The test will then time out on the `.assistant-bubble` locator assertion and fail.

The test is currently skipped in CI because the dashboard is not running (the `isDashboardReachable()` guard returns false), which is why this did not surface in the test run. The bug will only manifest during a live dashboard test run.

Fix: change `data.handleWebSocketMessage({...})` to `data.handleWsMessage({...})` at line 57 of the test file.

---

### Important — Observation for Sprint Record

**Diff size exceeds spec escalation thresholds**

The spec (§10.6) states escalation is required if total diff exceeds ~150 lines across more than 6 files. Actual diff: 191 insertions / 14 deletions across 12 files.

The overage is entirely in the two new test files:
- `orchestrator-surrender-cooldown-ack.test.ts`: 74 lines (spec suggests ~15 lines)
- `capability-ack-render.test.ts`: 71 lines (Playwright setup/teardown makes brevity difficult)

The production code changes are appropriately sized. The orchestrator cooldown test's boilerplate helpers (`makeFailure`, `makeDeps`) are duplicated from `orchestrator-budget.test.ts` rather than extracted to a shared fixture. This is a minor maintainability concern, not a correctness issue. No deviation proposal was filed as required by §10.6.

No corrective action is required before merge, but a follow-up note in DEVIATIONS.md would satisfy the sprint's documentation standard.

**S6-FU3 acceptance test does not assert `appendEvent` call count**

The spec (§10.2) requires the acceptance test to assert "the mock event-appender was called exactly once (from the original surrender, not a second time)." The new test does not do this.

The test's own header comment (lines 6-12) acknowledges the gap and argues correctly that `appendEvent` is not an `OrchestratorDeps` dependency — it lives inside `app.ts`'s `emitAck` callback closure. Testing it would require a separate unit test for the app-level callback, not an orchestrator test.

The comment's proposed coverage argument ("TypeScript exhaustive check") is weak: the `else if (kind === "surrender-cooldown")` branch in `app.ts:733` is not exhaustive — it is an `else if`, not a type-narrowing `switch` with a `never` assertion. If a future `AckKind` variant is added and the `app.ts` branch is not updated, TypeScript will not catch it.

This is not a blocker but the coverage gap should be noted. A future sprint could add an `app.ts` emitAck unit test or convert the branching to a `switch` with exhaustive checking.

---

## Plan Alignment

| Spec Item | Implemented | Files Match Spec | Tests Present |
|-----------|-------------|------------------|---------------|
| S6-FU5: `capability_ack` WS type + frontend handler | Yes | Yes | Yes (defective — see Critical) |
| S6-FU3: `surrender-cooldown` AckKind, no duplicate event | Yes | Yes | Yes (partial — appendEvent invariant untested) |
| S6-FU2: Delete `elapsedSec` param | Yes | Yes | Yes (updated correctly) |

Non-goals from §10.5 (S6-FU4, S7-FU3, S4-FU3, S4-FU4) — confirmed no changes made to those areas.

---

## Pre-existing Failure Note

`orchestrator-reverify-integration.test.ts` was not modified in this sprint (confirmed via diff). Its failure requires `DEEPGRAM_API_KEY` in the shell session and is pre-existing. It is not caused by S8 changes.

---

## Checklist

- [x] All 3 spec items implemented
- [x] TypeScript clean — `packages/core && packages/dashboard`, both `--noEmit` pass
- [x] Core tests: 26 passed, 0 failed
- [x] Dashboard tests (cfr + conversations): 149 passed, 0 failed
- [x] No `.my_agent/` modifications
- [x] Total diff is 12 files (spec ceiling: 6 — deviation noted above)
- [ ] Playwright test method name correct — **DEFECT** (see Critical)
- [x] Pre-existing reverify failure not caused by S8
