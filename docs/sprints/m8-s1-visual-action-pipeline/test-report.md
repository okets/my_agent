# M8-S1: Visual Action Pipeline -- Test Report

**Date:** 2026-03-29
**Branch:** `sprint/m8-s1-visual-action-pipeline`
**Runner:** vitest 4.0.18 (dashboard), vitest 4.1.2 (workspace root)

---

## Sprint-Specific Tests

### Visual Service Tests (`tests/unit/visual/visual-action-service.test.ts`)

```
 18 tests | 18 passed | 0 failed
 Duration: 36ms
```

| Test | Result |
|------|--------|
| store() saves screenshot and returns correct metadata | PASS |
| store() tag defaults to 'keep' | PASS |
| store() accepts explicit tag 'skip' | PASS |
| store() writes PNG file to disk | PASS |
| store() uses job screenshot directory for job context | PASS |
| store() uses conversations directory for conversation context | PASS |
| list() returns stored screenshots in order | PASS |
| list() returns empty array for unknown context | PASS |
| list() returns empty array when no screenshots stored yet | PASS |
| url() generates correct job asset URL | PASS |
| url() generates correct conversation asset URL | PASS |
| updateTag() updates the tag in the JSONL index | PASS |
| updateTag() only modifies the targeted screenshot | PASS |
| updateTag() throws when index does not exist | PASS |
| onScreenshot fires callback when screenshot is stored | PASS |
| cleanup() deletes skip-tagged screenshots older than retention period | PASS |
| cleanup() does not delete skip-tagged screenshots within retention period | PASS |
| cleanup() never deletes screenshots with error/escalation descriptions | PASS |

### Screenshot Tagger Tests (`tests/unit/visual/screenshot-tagger.test.ts`)

```
 7 tests | 7 passed | 0 failed
 Duration: 11ms
```

| Test | Result |
|------|--------|
| computeDiffRatio returns 0 for identical buffers | PASS |
| computeDiffRatio returns 1 for completely different buffers | PASS |
| computeDiffRatio returns ~0.5 for half-different buffers | PASS |
| computeDiffRatio handles different length buffers by using shorter length | PASS |
| tagByDiff keeps the first screenshot when there is no previous | PASS |
| tagByDiff skips when screenshots are similar | PASS |
| tagByDiff keeps when screenshots differ significantly | PASS |

### Asset Routes Tests (`tests/unit/routes/asset-routes.test.ts`)

```
 4 tests | 4 passed | 0 failed
 Duration: 223ms
```

| Test | Result |
|------|--------|
| serves a job screenshot with 200 and correct content | PASS |
| serves a conversation screenshot with 200 and correct content | PASS |
| returns 404 for a missing file | PASS |
| returns 400 for path traversal attempt | PASS |

---

## Full Suite Regression Check

```
 Test Files  107 passed | 2 failed | 4 skipped (113)
      Tests  1006 passed | 18 skipped (1024)
 Duration   26.52s
```

### Pre-Existing Failures (not regressions)

Both failures reproduce identically on `master`:

1. **`packages/dashboard/tests/browser/automation-ui.test.ts`** -- `EACCES: permission denied, mkdir '/home/docs/sprints/m7-s9-e2e-test-suite/screenshots'`. Hardcoded absolute path that does not exist on this machine.

2. **`packages/dashboard/tests/mcp/skill-triage-scenarios.test.ts`** -- `task-triage SKILL.md not found`. Missing skill file in the test environment.

**Conclusion:** Zero regressions introduced by this sprint.

---

## TypeScript Compilation

```
packages/core:      npx tsc        -- clean (0 errors)
packages/dashboard: npx tsc --noEmit -- clean (0 errors)
```

---

## New Test Coverage Summary

| Area | Tests Added | Coverage |
|------|-------------|----------|
| VisualActionService (store, list, url, updateTag, cleanup, callback) | 18 | All public methods tested |
| Screenshot pixel diff tagger | 7 | computeDiffRatio + tagByDiff |
| Asset serving routes | 4 | Job + conversation serving, 404, path traversal |
| **Total** | **29** | |
