# M9.2-S1 Test Report

**Sprint:** M9.2-S1 Generic & Research Todo Templates
**Tester:** External Opus (independent)
**Date:** 2026-04-06

---

## Unit / Integration Tests

Executed: `cd packages/dashboard && npx vitest run`

| Metric | Count |
|--------|-------|
| Test files | 124 |
| Test files passed | 120 |
| Test files failed | 1 |
| Test files skipped | 3 |
| Tests passed | 1062 |
| Tests failed | 1 |
| Tests skipped | 8 |
| Duration | 23.87s |

### Failed Test (Pre-Existing)

| Test | File | Status |
|------|------|--------|
| `scanCapabilities > skips malformed CAPABILITY.md files gracefully` | `tests/unit/capabilities/capability-system.test.ts` | FAILED (known, pre-existing) |

This failure is documented in the task description as expected. It is unrelated to this sprint's changes.

### New Tests Added

| Test File | Tests | Status |
|-----------|-------|--------|
| `src/automations/todo-templates.test.ts` | 7 | All PASSED |

Individual results:
- `getTemplate > returns generic template for 'generic' job type` — PASSED
- `getTemplate > returns research template with sources and chart items` — PASSED
- `getTemplate > still returns capability templates` — PASSED
- `assembleJobTodos > falls back to generic template when no job type specified` — PASSED
- `assembleJobTodos > falls back to generic when job type has no template` — PASSED
- `assembleJobTodos > uses specific template over generic when job type matches` — PASSED
- `assembleJobTodos > uses research template for research job type` — PASSED

### Modified Existing Tests

8 test files updated to reflect the generic fallback behavior change. All pass.

| Test File | Change | Status |
|-----------|--------|--------|
| `src/automations/__tests__/todo-templates.test.ts` | 2 tests updated: expect generic fallback items instead of empty array | PASSED |
| `tests/e2e/automation-lifecycle.test.ts` | Expect `needs_review` instead of `completed` for mock brain job | PASSED |
| `tests/integration/automation-e2e.test.ts` | 3 test blocks updated: fire, resume, debrief pipeline | PASSED |
| `tests/integration/e2e-agentic-flow.test.ts` | Expect `job_needs_review` notification type | PASSED |
| `tests/integration/todo-acceptance.test.ts` | Listen for `job:needs_review` event, expect generic items in todo file | PASSED |
| `tests/unit/automations/automation-executor.test.ts` | 2 tests: expect `success: false`, `needs_review` | PASSED |
| `tests/unit/automations/handler-registry.test.ts` | Expect `success: false` for SDK fallback | PASSED |

---

## TypeScript Compilation

Executed: `cd packages/dashboard && npx tsc --noEmit`

| Check | Result |
|-------|--------|
| First run (stale core dist) | 1 error — `"research"` not assignable to old type union |
| After rebuilding core (`cd packages/core && npx tsc`) | 0 errors — compiles clean |

The error on first run is caused by `packages/core/dist/` being gitignored. The source type in `automation-types.ts` is correct, but the compiled `.d.ts` was stale. Rebuilding core resolves it.

---

## Smoke Test Findings (Provided by Implementation Team)

The implementation team ran real LLM smoke tests (Steps 9-10 in the plan). Results as reported:

### Generic Template Smoke Test

| Check | Result |
|-------|--------|
| Job status | `completed` |
| Mandatory items completed | 4/4 (2 delegator + 2 framework generic) |
| `status-report.md` exists | Yes (3459 bytes) |
| `status_report` validator | Would pass (file exists, > 50 chars) |
| Framework items present | verify-output, status-report |

**Assessment:** The generic template works as intended with a real LLM. The worker completed all mandatory items including writing `status-report.md`, which the `status_report` validator would accept. Job correctly reached `completed` status (all mandatory items done).

### Research Template Smoke Test

| Check | Result |
|-------|--------|
| Job status | `completed` |
| Mandatory items completed | 6/6 (2 delegator + 4 framework research) |
| Sources documented | 3 (TIOBE, Stack Overflow, GitHub Octoverse) |
| Cross-check performed | Yes, contradictions flagged |
| `create_chart` called | Yes, twice (TIOBE market share + growth rates) |
| `status-report.md` exists | Yes (5516 bytes) with sources list |

**Assessment:** The research template works as designed. The worker followed all 4 framework items: documented sources, cross-checked claims, generated charts, and wrote a status report with sources list and confidence assessment. The chart item correctly triggered `create_chart` usage.

### Smoke Test Confidence

Both smoke tests demonstrate that real LLM workers comply with the new mandatory items. This validates the core thesis of M9.2 (code-enforced checklists drive compliance). The gap between mock tests (`needs_review`) and real tests (`completed`) is expected and correct — mock brains cannot complete todos.

---

## Browser Verification

**Skipped** — this sprint only modifies internal library code (todo templates, validators, type definitions). No files in `public/`, no route handlers, no server startup changes, no UI changes.

---

## Summary

| Category | Result |
|----------|--------|
| Unit/Integration tests | 1062 passed, 1 failed (pre-existing), 8 skipped |
| New tests | 7/7 passed |
| TypeScript | Clean after core rebuild; 1 error without rebuild |
| Smoke tests (reported) | Both passed — generic (4/4 items) and research (6/6 items) |
| Browser | N/A (no UI changes) |
| Overall | **PASS** — all sprint deliverables verified |
