---
sprint: M9.6-S9
title: TriggeringOrigin type landing — test report
date: 2026-04-17
result: ALL PASS
---

# S9 Test Report

**Sprint:** M9.6-S9 — `TriggeringOrigin` type landing
**Date:** 2026-04-17
**Result:** ALL PASS (no failures, no skips in S9-scope tests)

---

## Commands run

```bash
cd /home/nina/my_agent/packages/core && npx tsc --noEmit
cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit
cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/cfr-types-origin tests/capabilities tests/conversations
cd /home/nina/my_agent/packages/dashboard && npx vitest run tests/cfr
```

---

## TypeScript compilation

| Package | Command | Result |
|---------|---------|--------|
| `packages/core` | `tsc --noEmit` | PASS — zero errors, zero warnings |
| `packages/dashboard` | `tsc --noEmit` | PASS — zero errors, zero warnings |

Both packages compile cleanly with the new `TriggeringOrigin` union, the updated `TriggeringInput`, and all consumer-site narrowings in place.

---

## Core package tests

**Command:** `npx vitest run tests/capabilities/cfr-types-origin tests/capabilities tests/conversations`

**Result:** 28 test files passed, 1 skipped (pre-existing skip, unrelated to S9)

**Counts:** 166 tests passed, 2 skipped (the 2 skipped are in `orchestrator-reverify-integration.test.ts` — pre-existing, marked `it.skip`, unrelated to S9)

**Duration:** 27.73s

### S9-specific test: `cfr-types-origin.test.ts`

| Test | Result |
|------|--------|
| `conversationOrigin()` factory produces correct shape | PASS |
| `TriggeringInput` accepts `origin` + `artifact`, rejects old flat fields | PASS |
| switch narrows all three variants without TS error | PASS |
| automation origin has the expected fields | PASS |
| system origin has the expected fields | PASS |

**5 / 5 tests pass.**

### Phase 1 regression gate (capabilities + conversations suites)

All Phase 1 tests pass unchanged:

| Test file | Tests | Result |
|-----------|-------|--------|
| `orchestrator/orchestrator-budget.test.ts` | 5 | PASS |
| `orchestrator/orchestrator-timing.test.ts` | 3 | PASS |
| `orchestrator/orchestrator-state-machine.test.ts` | 19 | PASS |
| `orchestrator/orchestrator-surrender-scope.test.ts` | 5 | PASS |
| `orchestrator/orchestrator-surrender-cooldown-ack.test.ts` | 1 | PASS |
| `ack-delivery.test.ts` | 3 | PASS |
| `resilience-copy.test.ts` | 9 | PASS |
| `classify-empty-result-live.test.ts` | 7 | PASS |
| `registry-multi-instance.test.ts` | 16 | PASS |
| `registry-toggle.test.ts` | 10 | PASS |
| `mcp-middleware.test.ts` | 27 | PASS |
| `middleware-wiring.test.ts` | 7 | PASS |
| `get-health.test.ts` | 9 | PASS |
| `types.test.ts` | 3 | PASS |
| `scanner-system.test.ts` | 7 | PASS |
| `integration.test.ts` | 1 | PASS |
| `mcp-spawner.test.ts` | 5 | PASS |
| `mcp-spawner-crash.test.ts` | 2 | PASS |
| `mcp-middleware.test.ts` | 27 | PASS |
| `no-first-match-browser-control.test.ts` | 1 | PASS |
| `schema-validation.test.ts` | 5 | PASS |
| `test-harness-mcp.test.ts` | 3 | PASS |
| `desktop-extraction.test.ts` | 3 | PASS |
| `functional-screenshot.test.ts` | 1 | PASS |
| `watcher.test.ts` | 2 | PASS |
| `conversations/orphan-watchdog-audio-rescue.test.ts` | 2 | PASS |
| `conversations/orphan-watchdog-basic.test.ts` | 3 | PASS |
| `conversations/orphan-watchdog-idempotence.test.ts` | 2 | PASS |

Stderr output in orchestrator tests (spawn errors, surrender logs) is expected — these are intentional test stubs that exercise the surrender and budget logic.

---

## Dashboard package tests

**Command:** `npx vitest run tests/cfr`

**Result:** 5 test files passed, 0 skipped

**Counts:** 47 tests passed

**Duration:** 3.19s

| Test file | Tests | Result |
|-----------|-------|--------|
| `cfr/raw-media-store.test.ts` | 17 | PASS |
| `cfr/cfr-emit-empty-silent-vs-broken.test.ts` | 11 | PASS |
| `cfr/cfr-emit-stt-errors.test.ts` | 12 | PASS |
| `cfr/cfr-emit-deps-missing.test.ts` | 3 | PASS |
| `cfr/boot-deps-wired.test.ts` | 4 | PASS |

Stderr in `cfr-emit-deps-missing.test.ts` shows "No Anthropic authentication configured" — expected in CI/test environments without an API key. The tests are structured to emit CFR events before the SDK session is needed; the auth error is caught gracefully and does not affect the test assertions.

---

## Test failures

None.

---

## Observations

The stderr output from orchestrator tests (spawn failures, surrender log lines) is intentional — the test fixtures use stub `spawnJob` functions that throw by design to exercise error paths. None of these constitute test failures.

The `orchestrator-reverify-integration.test.ts` skip is pre-existing (marked `it.skip` since S4) and is unrelated to S9.

---

## Summary

| Scope | Files | Tests | Passed | Failed | Skipped |
|-------|-------|-------|--------|--------|---------|
| S9 new test | 1 | 5 | 5 | 0 | 0 |
| Core capabilities + conversations (Phase 1 regression) | 28 | 168 | 166 | 0 | 2 |
| Dashboard CFR suite | 5 | 47 | 47 | 0 | 0 |
| **Total** | **34** | **220** | **218** | **0** | **2** |

All verification commands from the sprint spec pass. S9 acceptance criteria fully met.
