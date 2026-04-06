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

## Architectural Gaps (CTO-requested analysis)

### G4: No recovery path for `needs_review` jobs with incomplete mandatory items (Medium-High Concern)

The generic fallback means every job now has mandatory items with validators (specifically `status_report`). If a worker completes its LLM work but fails to satisfy a validator (e.g., didn't write `status-report.md`, or wrote one under 50 chars), the job lands in `needs_review` permanently.

**What happens today:**
1. Worker finishes LLM session with useful output
2. Todo completion gating catches the incomplete mandatory item → `needs_review`
3. A `job_needs_review` notification is sent to the brain via the heartbeat's notification delivery
4. **Nothing else.** The heartbeat (`heartbeat-service.ts`) only monitors `running` jobs for staleness. It does not monitor or retry `needs_review` jobs.

**The stuck state:** The job has real deliverable content, but it's invisible to:
- The **debrief pipeline** — `getDebriefPendingJobs()` queries `WHERE status = 'completed'` only
- The **user** — unless the brain successfully delivers the `job_needs_review` notification (which depends on an active conversation)
- **Future workers** — no mechanism to resume and complete the missing item

**Why this matters:** The generic fallback is universal — it applies to every job without a specific type template, including jobs created by Conversation Nina's `create_task` tool. A single missed `status-report.md` silently drops otherwise-useful work from all downstream pipelines.

**Potential mitigations (for Architect to evaluate):**
- **A.** Heartbeat monitors `needs_review` jobs with incomplete validators. After N minutes, auto-retry the validator (the worker may have written the file late). If still failing, escalate notification.
- **B.** Debrief pipeline includes `needs_review` jobs with a flag: "incomplete — missing: status-report.md". Don't hide the work, surface it with a warning.
- **C.** The executor retries the validator once after a short delay before committing to `needs_review` — workers sometimes write files asynchronously.
- **D.** Accept the gap. Smoke tests proved real workers complete items. The `needs_review` state is rare in practice and the notification covers it.

### G5: Generic fallback applies to handler-dispatched jobs (Low Concern)

Built-in handler jobs (like `debrief-prep`) bypass the SDK session but still go through `assembleJobTodos`, which now adds generic mandatory items. Handlers return `{ success: true }` directly, but the executor's todo gating still checks the `todos.json` file. If the handler doesn't explicitly mark todos as done, the job gets `needs_review`.

**Current state:** The handler dispatch tests pass because handler results bypass the todo gating code path (the handler returns before step 8.5 in the executor). This was verified in tests. But if the handler code path changes in the future, the generic fallback could inadvertently gate handler jobs.

**Risk:** Low — handler path currently bypasses gating. But worth documenting the invariant.

### G6: `status_report` validator has no content quality check (Low Concern)

The `status_report` validator checks: (1) file exists, (2) content >= 50 chars. A worker could write "aaaa..." repeated 50 times and pass. The validator doesn't check for expected sections (actions, results, artifacts, issues) mentioned in the todo item text.

**Risk:** Low — real LLM workers write substantive reports (3459 and 5516 bytes in smoke tests). A structural check could be added later but isn't critical now.

## Verdict

**PASS WITH CONCERNS**

All 7 plan requirements are implemented correctly and match the spec text precisely. The new unit tests pass. All existing tests pass (with the one pre-existing known failure). The implementation is clean, minimal, and focused.

Concerns (non-blocking):
1. **TypeScript compilation requires rebuilding core** — the monorepo's `dist/` is gitignored, so a fresh checkout fails `tsc --noEmit` until core is rebuilt. Document or add to CI.
2. **Debrief pipeline behavioral change** — `needs_review` jobs are now excluded from debrief. This is intentional enforcement but affects production behavior.
3. **Missing positive-path unit test** — no test verifies that completing generic mandatory items yields `"completed"` status. Only validated by smoke tests.

Architectural gaps (for Architect review):
4. **No recovery path for stuck `needs_review` jobs** — work is silently dropped from debrief and downstream pipelines. See G4 above.
5. **Generic fallback applies to handler jobs** — currently safe but undocumented invariant. See G5 above.
6. **Validator checks length, not content quality** — low risk, real workers write substantive reports. See G6 above.
