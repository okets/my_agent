# External Verification Report

**Sprint:** M9.1-S2 Todo Templates + Validation
**Reviewer:** External Opus (independent)
**Date:** 2026-04-05

## Spec Coverage

| # | Validation Criterion | Status | Evidence |
|---|---------------------|--------|----------|
| 1 | `npx vitest run` -- all sprint tests pass | COVERED | 56 tests pass across 6 test files (templates, validators, todo-server, acceptance, types, S1 acceptance). Both `tsc --noEmit` clean (core + dashboard). |
| 2 | Acceptance test passes -- 3-layer assembly verified, completion gating catches incomplete jobs | COVERED | `todo-lifecycle-acceptance.test.ts`: "3-layer todo assembly with capability_build type" verifies 2 delegator + 5 framework = 7 items; "executor fires job with 3-layer todos" verifies real executor creates assembled todos.json and gates to `needs_review` when mandatory items incomplete. |
| 3 | `create_automation` accepts `todos` and `job_type` parameters | COVERED | `automation-server.ts` lines 81-92: `todos` (z.array of {text}) and `job_type` (z.enum) added to create_automation schema. Passed through to manifest at lines 107-108. `automation-types.ts` updated with matching fields on both `AutomationManifest` and `CreateAutomationInput`. |
| 4 | Validator failure increments `validation_attempts` and returns `isError` | COVERED | `todo-server.ts` lines 96-132: validation check on `todo_update("done")` for mandatory items with validation rule. On fail: increments `validation_attempts`, returns `isError: true` with message. Tests: "todo_update with validation rejects when validator fails" confirms attempts=1 and isError. |
| 5 | After 3 failures, item auto-blocks | COVERED | `todo-server.ts` lines 108-122: when `validation_attempts >= 3`, sets `status: "blocked"` with notes. Tests: "todo_update auto-blocks after 3 failed validations" (todo-server.test.ts) and "validation rejects then auto-blocks after 3 failures" (acceptance test) both verify 3-attempt auto-block. |
| 6 | `resume_job({ force: true })` force-completes a needs_review job | COVERED | `automation-server.ts` lines 267-272: `force` boolean param added to resume_job schema. Lines 301-314: when force=true, updates job to `completed` with "Force-completed by user" summary. Acceptance test "force resume accepts incomplete jobs" verifies the lifecycle. |
| 7 | Existing automations with `target_path` containing capabilities auto-detect `job_type` | COVERED | `automation-executor.ts` lines 78-89: `detectJobType()` checks `automation.manifest.job_type` first, then falls back to checking if `target_path` contains `capabilities/`. Checks for existing `CAPABILITY.md` to distinguish `capability_modify` vs `capability_build`. |
| 8 | Builder agent definition has todo_list instruction and no competing YAML examples | COVERED | `definitions.ts` lines 41-42: "Call todo_list first to see your assignment. Work through each item. Mark items done as you complete them. Mandatory items require validation." Single YAML example block at lines 58-68 (CAPABILITY.md format only). Prompt reduced from ~85 lines to ~45 content lines. |

## Test Results

- **Templates:** 8 passed (todo-templates.test.ts)
- **Validators:** 10 passed (todo-validators.test.ts)
- **Todo server:** 15 passed (todo-server.test.ts) -- includes 8 new validation tests
- **S2 acceptance:** 6 passed (todo-lifecycle-acceptance.test.ts)
- **S1 acceptance:** 6 passed (todo-acceptance.test.ts) -- regression check
- **Automation types:** 11 passed (automation-types.test.ts) -- regression check
- **Total: 56 passed, 0 failed, 0 skipped**
- **TypeScript:** Core compiles clean. Dashboard compiles clean.

## Browser Verification

Skipped -- sprint is pure library/MCP/executor code with no UI or server changes.

## Gaps Found

None. All 8 validation criteria are fully covered.

### Minor Observations (not gaps)

1. **`detectJobType` path check:** Spec says `.my_agent/capabilities/`; code checks `capabilities/` (looser). Functionally equivalent since all capability `target_path` values include the full path. No risk.

2. **`frontmatterToManifest` fix (D1):** The sprint fixed a pre-existing bug where `target_path` was lost during disk round-trip. This is a bonus fix not in the original plan -- logged correctly in DECISIONS.md.

3. **Acceptance test "force resume":** Tests the force-complete via direct `jobService.updateJob()` calls rather than through the MCP `resume_job` tool. This is adequate since the MCP tool handler is simple delegation, but an MCP-level test would provide higher integration confidence.

## Verdict

**PASS**

All 8 validation criteria verified against the code. 56 tests pass, both packages type-check clean. The implementation matches the design spec for System 2 (Working Nina Todo Templates): 3-layer assembly, 4 validators, validation on todo_update with max retries, completion gating, force resume, job_type auto-detection, and builder prompt simplification.
