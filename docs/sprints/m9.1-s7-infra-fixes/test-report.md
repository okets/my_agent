# M9.1-S7 Test Report

**Date:** 2026-04-06
**Tester:** External Opus (independent)
**Branch:** `sprint/m9.1-s7-infra-fixes`

---

## Test Execution Summary

| Suite | Passed | Failed | Skipped | Status |
|-------|--------|--------|---------|--------|
| Core (vitest) | 260 | 0 | 7 | CLEAN |
| Dashboard (vitest) | 990 | 25 | 8 | NO REGRESSION |
| E2E agentic flow (new) | 5 | 0 | 0 | CLEAN |
| Core (tsc --noEmit) | — | 0 | — | CLEAN |
| Dashboard (tsc --noEmit) | — | 4 | — | REGRESSION |

## E2E Test Results (new)

All 5 tests passed in 126ms:

| # | Test | Status | Time |
|---|------|--------|------|
| 1 | assembles 3-layer todo list (delegator + template + baseline) | PASS | <1ms |
| 2 | completes job when all mandatory todos are done | PASS | ~40ms |
| 3 | gates completion when mandatory todos are incomplete | PASS | ~30ms |
| 4 | processor enqueues notification and heartbeat delivers | PASS | ~30ms |
| 5 | heartbeat detects stale running job and creates interrupt notification | PASS | ~20ms |

## Pre-Existing Failures (25, unchanged from master)

Verified by running `npx vitest run` on both master and sprint branch:

- **Master:** 985 passed, 25 failed, 8 skipped
- **Sprint:** 990 passed, 25 failed, 8 skipped (delta: +5 passed = new E2E tests)

Failing files (all pre-existing):
- `tests/automations/needs-review-notification.test.ts` (3 failures)
- `tests/e2e/trigger-types.test.ts` (1 failure)
- `tests/integration/automation-e2e.test.ts` (2 failures)
- `tests/unit/automations/automation-processor.test.ts` (3 failures)
- `tests/unit/mcp/desktop-server.test.ts` (16 failures — `handleDesktopTask` is not a function)

## TypeScript Compilation

### Core package: CLEAN
```
$ npx tsc --noEmit
(no output — 0 errors)
```

### Dashboard package: 4 ERRORS (regression)

```
src/automations/__tests__/e2e-agentic-flow.test.ts(16,28): error TS6059:
  File 'tests/integration/app-harness.ts' is not under 'rootDir' 'src'.

src/automations/__tests__/e2e-agentic-flow.test.ts(419,25): error TS2352:
  Conversion of type 'undefined' to type 'string' may be a mistake.

src/automations/__tests__/e2e-agentic-flow.test.ts(419,49): error TS2493:
  Tuple type '[]' of length '0' has no element at index '0'.

tests/integration/app-harness.ts(130,46): error TS2345:
  Property 'spacesDb' is missing in StatePublisherOptions.
```

Master compiles clean. The errors are introduced by the new test file.

## Recommendations

1. Move `e2e-agentic-flow.test.ts` from `src/automations/__tests__/` to `tests/integration/` to resolve the rootDir violation.
2. Fix mock typing on line 419: `const alertPrompt = (mockAlert.mock.calls[0] as [string])[0];` or use `mockAlert.mock.lastCall![0] as string`.
3. Add `spacesDb` to the `StatePublisherOptions` mock in `app-harness.ts` (pre-existing issue, now surfaced).
