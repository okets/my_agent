# External Verification Report

**Sprint:** M9.2-S1 Generic & Research Todo Templates
**Reviewer:** External Opus (independent)
**Date:** 2026-04-06

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| Add `'research'` to `job_type` union in `automation-types.ts` (both interfaces) | COVERED | Lines 48 and 98 in `packages/core/src/spaces/automation-types.ts` — both `AutomationManifest` and `CreateAutomationInput` updated |
| Add `'research'` to Zod enum in `automation-server.ts` | COVERED | Line 118 in `packages/dashboard/src/mcp/automation-server.ts` — enum now includes `"research"` |
| New unit tests for generic and research templates in `todo-templates.test.ts` | COVERED | `packages/dashboard/src/automations/todo-templates.test.ts` — 7 test cases, matches plan exactly |
| Generic template with verify-output + status-report items | COVERED | Lines 52-63 in `todo-templates.ts` — 2 mandatory items, text matches plan |
| Research template with sources, cross-check, chart, and status-report items | COVERED | Lines 65-85 in `todo-templates.ts` — 4 mandatory items, text matches plan |
| Generic fallback in `assembleJobTodos` (no job_type falls back to generic) | COVERED | Line 113 in `todo-templates.ts` — `?? getTemplate("generic")` |
| `status_report` validator in `todo-validators.ts` | COVERED | Lines 85-103 in `todo-validators.ts` — checks file exists and length >= 50 chars |
| Existing tests updated to match new behavior | COVERED | 8 test files updated, old `__tests__/todo-templates.test.ts` updated — see Gap Analysis for discussion |

## Test Results

- Dashboard (vitest): **1062 passed**, **1 failed**, 8 skipped (124 test files)
- Pre-existing known failure: `tests/unit/capabilities/capability-system.test.ts > scanCapabilities > skips malformed CAPABILITY.md files gracefully` (documented in task as expected)
- TypeScript: **1 error** on fresh checkout (stale core `.d.ts`), **0 errors** after rebuilding core with `npx tsc` in `packages/core/`

### TypeScript Build-Order Note

The sprint modified `packages/core/src/spaces/automation-types.ts` (source) but the compiled `packages/core/dist/spaces/automation-types.d.ts` is gitignored. On a fresh checkout, `npx tsc --noEmit` in the dashboard package fails with:

```
src/mcp/automation-server.ts(138,13): error TS2322: Type '"research"' is not assignable to type '"capability_build" | "capability_modify" | "generic" | undefined'.
```

This resolves by running `npx tsc` in `packages/core/` first. This is a monorepo build-order dependency, not a code bug. However, the sprint should document this or ensure CI rebuilds core before checking dashboard.

## Browser Verification

Skipped — this sprint only modifies internal library code (todo templates, validators, type definitions). No UI, routes, frontend assets, or server startup changes.

## Gaps Found

### G1: Debrief Pipeline Behavioral Change (Medium Concern)

The generic fallback means all mock-brain test jobs now get `needs_review` instead of `completed`. The debrief pipeline test (`automation-e2e.test.ts`, "Debrief Pipeline Mechanics") was updated to expect that `needs_review` jobs are *excluded* from the debrief collector:

```typescript
// Before: expect job to appear in debrief pending
expect(pending.some((j) => j.automationName === "Thailand News Worker")).toBe(true);

// After: expect job to NOT appear in debrief pending
expect(pending.some((j) => j.automationName === "Thailand News Worker")).toBe(false);
```

This is a real behavioral change in production: a job that completes its LLM work but has incomplete generic mandatory items (e.g., worker didn't write `status-report.md`) will not appear in the daily debrief. The test comment states "incomplete work shouldn't appear in debrief until mandatory items are done" — this is reasonable logic, but it means workers that do useful work but skip the status report will have their results hidden from the debrief flow.

**Verdict on G1:** This is defensible by design (the whole point of M9.2 is enforcement), but it's a change in production behavior that should be consciously acknowledged. The real LLM smoke tests (Steps 9-10) confirmed that actual workers complete the mandatory items, so this gap only manifests with non-compliant workers.

### G2: Breadth of Existing Test Changes (Low Concern)

Eight existing test files were modified to change expectations from `"completed"`/`success: true` to `"needs_review"`/`success: false`. The decision is logged in DECISIONS.md (D2) and the reasoning is sound: mock brains don't complete todos, so the completion gate correctly catches them. However:

- The sheer number of changed test files (8) makes this a significant ripple
- The tests now verify a negative path (mock brain fails gating) rather than the positive path (job succeeds)
- No test was added to verify that a job WITH completed generic items gets `"completed"` status

This means the positive path (real worker completes generic items, job gets `"completed"`) is only validated by the smoke tests, not by unit/integration tests.

### G3: No Regression Test for Positive Completion Path (Low Concern)

There is no unit or integration test that verifies: "given a job where all generic mandatory items are marked done, the job status should be `completed`." The existing todo-lifecycle-acceptance tests (`todo-lifecycle-acceptance.test.ts`) test the capability_build path with explicit todo completion, but no equivalent exists for the generic template path. The smoke tests cover this for real LLM sessions.

## Verdict

**PASS WITH CONCERNS**

All 7 plan requirements are implemented correctly and match the spec text precisely. The new unit tests pass. All existing tests pass (with the one pre-existing known failure). The implementation is clean, minimal, and focused.

Concerns (non-blocking):
1. **TypeScript compilation requires rebuilding core** — the monorepo's `dist/` is gitignored, so a fresh checkout fails `tsc --noEmit` until core is rebuilt. Document or add to CI.
2. **Debrief pipeline behavioral change** — `needs_review` jobs are now excluded from debrief. This is intentional enforcement but affects production behavior.
3. **Missing positive-path unit test** — no test verifies that completing generic mandatory items yields `"completed"` status. Only validated by smoke tests.
