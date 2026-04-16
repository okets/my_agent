---
sprint: M9.6-S8
date: 2026-04-16
runner: external-code-reviewer (Claude Sonnet 4.6)
branch: sprint/m9.6-s8-cleanup
---

# M9.6-S8 Test Report

## TypeScript Compilation

| Package | Command | Result |
|---------|---------|--------|
| `packages/core` | `npx tsc --noEmit` | PASS — no errors |
| `packages/dashboard` | `npx tsc --noEmit` | PASS — no errors |

---

## Core Capability Tests

Command: `cd packages/core && npx vitest run tests/capabilities/resilience-copy tests/capabilities/ack-delivery tests/capabilities/orchestrator/orchestrator-timing tests/capabilities/orchestrator/orchestrator-surrender-scope tests/capabilities/orchestrator/orchestrator-budget tests/capabilities/orchestrator/orchestrator-surrender-cooldown-ack`

| File | Tests | Result |
|------|-------|--------|
| `tests/capabilities/resilience-copy.test.ts` | 9 | PASS |
| `tests/capabilities/ack-delivery.test.ts` | 3 | PASS |
| `tests/capabilities/orchestrator/orchestrator-timing.test.ts` | 3 | PASS |
| `tests/capabilities/orchestrator/orchestrator-surrender-scope.test.ts` | 5 | PASS |
| `tests/capabilities/orchestrator/orchestrator-budget.test.ts` | 5 | PASS |
| `tests/capabilities/orchestrator/orchestrator-surrender-cooldown-ack.test.ts` | 1 | PASS |

**Total: 26 tests, 26 passed, 0 failed**

Duration: 592ms

---

## Dashboard Tests

Command: `cd packages/dashboard && npx vitest run tests/cfr tests/conversations`

| File | Tests | Result |
|------|-------|--------|
| `tests/cfr/raw-media-store.test.ts` | 17 | PASS |
| `tests/cfr/cfr-emit-stt-errors.test.ts` | 12 | PASS |
| `tests/cfr/cfr-emit-empty-silent-vs-broken.test.ts` | 11 | PASS |
| `tests/cfr/cfr-emit-deps-missing.test.ts` | 3 | PASS |
| `tests/cfr/boot-deps-wired.test.ts` | 4 | PASS |
| `tests/conversations/get-last-user-turn.test.ts` | 7 | PASS |
| `tests/conversations/search-service.test.ts` | 16 | PASS |
| `tests/conversations/search-db.test.ts` | 17 | PASS |
| `tests/conversations/abbreviation-honors-correction.test.ts` | 2 | PASS |
| `tests/conversations/orphan-watchdog-routing.test.ts` | 2 | PASS |
| `tests/conversations.test.ts` | 58 | PASS |

**Total: 149 tests, 149 passed, 0 failed**

Duration: 4.43s

---

## Playwright Test — capability-ack-render

File: `packages/dashboard/tests/browser/capability-ack-render.test.ts`

**Status: SKIPPED (dashboard unreachable) — DEFECT IDENTIFIED**

The test was skipped in this run because `DASHBOARD_URL` (http://localhost:4321) is not reachable in the review environment. This is expected behavior per the test's `isDashboardReachable()` guard.

However, the test contains a defect that would cause it to fail even when the dashboard is running:

- Line 57 calls `data.handleWebSocketMessage({...})`
- The actual Alpine component method is `handleWsMessage` (defined at `app.js:1293`)
- The method `handleWebSocketMessage` does not exist on the Alpine data object
- When the dashboard is live, `Alpine.$data(body).handleWebSocketMessage(...)` will throw inside `page.evaluate`, and the `.assistant-bubble` locator assertion will time out

This test cannot be considered passing for the S6-FU5 exit gate in its current form.

**Required fix:** Change `data.handleWebSocketMessage({...})` to `data.handleWsMessage({...})` at line 57.

---

## Pre-existing Failure

`packages/core/tests/capabilities/orchestrator/orchestrator-reverify-integration.test.ts` was not run in this suite per reviewer instructions. This file was not modified in the sprint (confirmed via `git diff master...sprint/m9.6-s8-cleanup`). Its failure is pre-existing and requires `DEEPGRAM_API_KEY` in the environment. It is not caused by S8 changes.

---

## New Test Coverage

Three new tests were added in this sprint:

| Test | Spec Item | Behavioral? | Note |
|------|-----------|-------------|------|
| `orchestrator-surrender-cooldown-ack.test.ts` — "second CFR within cooldown window emits surrender-cooldown, not surrender" | S6-FU3 | Yes — verifies correct AckKind emitted and no spurious spawn | Missing: appendEvent not-called invariant (out of scope for orchestrator unit test — see review) |
| `capability-ack-render.test.ts` — "injects capability_ack and sees ack text in an assistant bubble" | S6-FU5 | Yes — correct intent, tests real rendering path | DEFECTIVE: wrong method name, would fail on live dashboard |
| `resilience-copy.test.ts` update — "returns the status copy" (updated from "regardless of elapsed") | S6-FU2 | Yes — verifies signature change is correct | No new test needed per spec; update is correct |

---

## Overall Test Result

| Category | Result |
|----------|--------|
| TypeScript (core) | PASS |
| TypeScript (dashboard) | PASS |
| Core capability suite | PASS (26/26) |
| Dashboard CFR + conversations suite | PASS (149/149) |
| Playwright capability_ack render | SKIP / DEFECTIVE |
| Pre-existing reverify failure | Pre-existing, not caused by S8 |

**Exit gate: CONDITIONAL** — all automated tests pass; Playwright test requires method name fix before it can serve as an exit gate for S6-FU5.
