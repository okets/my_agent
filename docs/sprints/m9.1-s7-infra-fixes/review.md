# External Verification Report

**Sprint:** M9.1-S7 Infrastructure Fixes + Integration Test
**Reviewer:** External Opus (independent)
**Date:** 2026-04-06

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| Task 7.1: Scanner pushes invalid capability objects instead of skipping | COVERED | `scanner.ts` catch block pushes `{ status: 'invalid', error: ... }` instead of empty catch. Also handles missing `name` field. `types.ts` adds `'invalid'` to status union and `error?: string` field. `registry.ts` skips invalid caps in `load()`. |
| Task 7.2: `findById` returns full automation instructions from disk | COVERED | `automation-manager.ts:219-223` — `findById()` delegates to `read()` which reads from disk via `readFrontmatter()`. Pre-fixed, documented in DECISIONS.md D1. No code change needed. |
| Task 7.3: Paper trail uses `manifest.target_path` directly | COVERED | `automation-executor.ts:444` — replaced 15-line 3-source cascade with `const targetPath = automation.manifest.target_path`. `extractTargetPath()` regex method removed entirely. |
| Task 7.4: E2E integration test — full agentic lifecycle | COVERED | `e2e-agentic-flow.test.ts` — 5 tests covering: (1) 3-layer todo assembly, (2) happy path completion with todo gating, (3) gating catches incomplete mandatory items, (4) processor enqueues notification + heartbeat delivers, (5) stale job detection. All 5 pass. |
| Task 7.5: Acceptance test passes (full chain create-to-notify) | COVERED | Tests 2 + 4 together validate the full chain: create automation with todos, fire, executor assembles todos, mock worker marks items done, validators run, job completes, notification created, heartbeat delivers. |

## Test Results

- **Core:** 260 passed, 0 failed, 7 skipped (clean)
- **Dashboard:** 990 passed, 25 failed, 8 skipped
  - 25 failures are pre-existing on master (verified by running master baseline: 985 passed, 25 failed, 8 skipped; the 5 extra passes on the sprint branch are the new E2E tests)
  - Failing test files: `needs-review-notification.test.ts`, `trigger-types.test.ts`, `automation-e2e.test.ts`, `automation-processor.test.ts`, `desktop-server.test.ts` — all identical failures on master
- **E2E test (new):** 5/5 passed (126ms)
- **TypeScript (core):** compiles clean (0 errors)
- **TypeScript (dashboard):** 4 errors (REGRESSION — master compiles clean)

### TypeScript Regression Details

The new test file `src/automations/__tests__/e2e-agentic-flow.test.ts` introduces 4 TS compilation errors:

1. **TS6059** — imports `tests/integration/app-harness.ts` which is outside `rootDir: "src"`. The test is placed under `src/` but its dependency is in `tests/`.
2. **TS2352 + TS2493** — Line 419: `mockAlert.mock.calls[0][0] as string` — vitest mock types don't know the mock was called, so the tuple is typed as length 0.
3. **TS2345** — `app-harness.ts:130` — `StatePublisherOptions` missing `spacesDb` property. Pre-existing in the file but only surfaced because the new test imports it.

These are all in test code and don't affect runtime. Vitest handles them correctly (all tests pass). The fix would be either: (a) move the test to `tests/` instead of `src/`, or (b) add `// @ts-expect-error` annotations for the mock type issues.

## Browser Verification

Skipped — sprint is pure backend/library work with no UI or server changes.

## Gaps Found

1. **TypeScript compilation regression** — the new E2E test file causes 4 TS errors that didn't exist on master. While these are test-only and don't affect runtime, the pass criterion "All existing tests still pass" is met but the codebase no longer compiles clean under `tsc --noEmit` for the dashboard package.

2. **No traceability matrix in sprint plan** — the sprint plan lists tasks but doesn't include a formal traceability matrix mapping spec requirements to tasks and verification methods. This is a minor process gap.

## Post-Review Fix

The TypeScript compilation regression identified above was fixed in commit `c0b6747`:
- Moved test from `src/automations/__tests__/` to `tests/integration/` (resolves rootDir violation)
- Fixed mock typing (`mockAlert.mock.lastCall![0]` instead of `mockAlert.mock.calls[0][0]`)
- Dashboard now compiles clean under `tsc --noEmit`

## Verdict

**PASS**

All 5 pass criteria are satisfied: the E2E acceptance test passes (5/5), the scanner reports invalid capabilities with error messages, `findById` reads from disk (pre-fixed), paper trail uses `manifest.target_path` directly, and all existing tests still pass. TypeScript compilation concern from initial review has been resolved.
