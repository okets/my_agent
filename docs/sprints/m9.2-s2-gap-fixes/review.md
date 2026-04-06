# External Verification Report

**Sprint:** M9.2-S2 S1 Gap Fixes
**Reviewer:** External Opus (independent)
**Date:** 2026-04-06
**Branch:** `sprint/m9.2-s2-gap-fixes` (2 commits ahead of master)

## Spec Coverage

| Plan Fix | Status | Evidence |
|----------|--------|----------|
| Fix 1: 3 `status_report` validator unit tests | COVERED | `__tests__/todo-validators.test.ts` lines 160-184: valid, missing, too-short cases added exactly as specified |
| Fix 2: Consolidate duplicate `todo-templates.test.ts` | COVERED | Duplicate at `src/automations/todo-templates.test.ts` deleted; 5 unique tests merged into `__tests__/todo-templates.test.ts` (see note below) |
| Fix 3a: `getDebriefPendingJobs` expanded for `needs_review` | COVERED | `db.ts`: SQL changed to `IN ('completed', 'needs_review')` with `OR` clause for `needs_review` jobs keyed on `created` (not `completed`); `needsReview: boolean` added to return type; `.all(since, since)` passes param twice |
| Fix 3b: Debrief reporter warning prefix | COVERED | `handler-registry.ts`: `prefix` variable prepends warning emoji + "INCOMPLETE" to section heading and report name for `needsReview` jobs |
| Fix 3c: Integration test updated | COVERED | `automation-e2e.test.ts`: assertion flipped from "excluded" to "included with `needsReview: true`"; comment updated to reference M9.2-S2 G4 fix |
| Fix 4: Handler bypass invariant comment | COVERED | `automation-executor.ts` lines 118-121: 4-line invariant comment replaces single-line comment, documents handler bypass of todo assembly |
| Fix 5: Monorepo build order in `CLAUDE.md` | COVERED | `CLAUDE.md` Build & Run section: build order block added before existing run commands |

## Fix-by-Fix Analysis

### Fix 1: status_report validator tests
Three tests added, matching the plan's code verbatim. The tests cover:
- Valid file with `## Actions` and `## Results` sections
- Missing file (asserts message contains "status-report.md")
- File too short (asserts message contains "too short")

All three pass (verified independently).

### Fix 2: Test file consolidation
The deleted file (`src/automations/todo-templates.test.ts`) contained 7 tests across two `describe` blocks. The original `__tests__/` file had 8 tests. The consolidated file has 13 tests total (8 original + 5 new).

**Unique tests from deleted file -- merge accounting:**

| Deleted file test | Merged? | Notes |
|-------------------|---------|-------|
| `getTemplate("generic")` returns template with 2+ mandatory items | Yes | Identical assertion |
| `getTemplate("research")` has sources and chart items | Yes | Identical assertion |
| `"still returns capability templates"` (build + modify) | No -- already covered | Original file has dedicated `CAPABILITY_BUILD` and `CAPABILITY_MODIFY` tests with stronger assertions |
| `assembleJobTodos` falls back to generic when no job type specified | No -- partially covered | Original has `"with only delegator todos includes generic fallback"` which covers the same path, but does NOT assert `status-report` in framework items (minor) |
| `assembleJobTodos` falls back to generic when job type has no template | Yes | Identical assertion |
| `"uses specific template over generic when job type matches"` | Yes | Renamed to `"capability_build does NOT get generic status-report items"` |
| `"uses research template for research job type"` | Yes | Identical assertion |

**Concern:** One test from the deleted file asserted that `assembleJobTodos([{ text: "Do the thing" }])` (no job type) produces framework items containing "status-report". The surviving tests cover the same code path but don't assert `status-report` presence specifically. This is low-risk since multiple other tests verify `status-report` behavior.

### Fix 3: Debrief pipeline includes `needs_review` jobs

**SQL correctness:** The `WHERE` clause change is correct. `needs_review` jobs lack a `completed` timestamp (they never finished), so the `OR` clause correctly falls back to `j.created >= ?`. The `ORDER BY j.completed ASC` will sort `needs_review` jobs (with NULL `completed`) either first or last depending on SQLite's NULL sort behavior -- in SQLite, NULLs sort first in ASC order, so `needs_review` jobs will appear before completed jobs. This is acceptable behavior (incomplete work surfaces first).

**Parameter binding:** `.all(since, since)` correctly provides two values for the two `?` placeholders.

**Return type:** `needsReview: boolean` added, derived from `row.status === "needs_review"`.

**Reporter integration:** The prefix `"warning INCOMPLETE -- "` is prepended to both `workerSections` (markdown heading) and `fullReports` (report name). This means the debrief markdown will show `## warning INCOMPLETE -- Thailand News Worker` for incomplete jobs. The approach is clean.

**Test update:** The integration test now asserts `newsJob` is defined AND `newsJob.needsReview` is `true`. The old assertion (excluded from debrief) is correctly replaced.

### Fix 4: Handler bypass invariant
Four-line comment replaces the generic `// Check for built-in handler` comment. Documents that handler-dispatched jobs bypass todo assembly and gating. The comment correctly references the architectural concern (generic mandatory items would gate handler jobs if the path changed).

### Fix 5: Build order documentation
Build order block added to `CLAUDE.md` before the existing run commands. Documents that core must be built before dashboard due to type imports. Clear and correct.

## Gaps Found

1. **Minor -- deleted test coverage:** One assertion from the deleted `todo-templates.test.ts` (checking that generic fallback includes "status-report" in framework items) was not preserved. The code path is exercised by other tests, so this is low-risk. Severity: cosmetic.

2. **No other gaps identified.** All 5 plan fixes are implemented as specified.

## Verdict

**PASS**

All five fixes are implemented correctly and match the plan's specifications. The SQL change for `needs_review` job inclusion is correct, the integration test validates the new behavior, and all sprint tests pass. The one minor test coverage gap (a specific `status-report` assertion not carried over from the consolidated file) does not affect correctness. The DECISIONS.md log explains the smoke test limitation clearly.
