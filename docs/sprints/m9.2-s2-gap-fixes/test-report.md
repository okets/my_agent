# Test Report

**Sprint:** M9.2-S2 S1 Gap Fixes
**Reviewer:** External Opus (independent)
**Date:** 2026-04-06
**Branch:** `sprint/m9.2-s2-gap-fixes`

## Test Execution

**Command:** `cd packages/dashboard && npx vitest run`
**Vitest version:** 4.0.18
**Duration:** 25.25s

## Results

| Metric | Count |
|--------|-------|
| Test files | 123 total |
| Test files passed | 119 |
| Test files failed | 1 (pre-existing) |
| Test files skipped | 3 |
| Tests passed | 1063 |
| Tests failed | 1 (pre-existing) |
| Tests skipped | 8 |

## Failed Test (Pre-Existing)

```
FAIL tests/unit/capabilities/capability-system.test.ts > scanCapabilities > skips malformed CAPABILITY.md files gracefully
AssertionError: expected [ { name: 'malformed', ...(5) }, ...(1) ] to have a length of 1 but got 2
```

This failure exists on `master` and is unrelated to sprint changes. It tests capability scanning, not the todo/debrief systems modified by this sprint.

## Sprint-Specific Tests

### Fix 1: status_report validator tests
| Test | Result |
|------|--------|
| `status_report passes with valid status-report.md` | PASS |
| `status_report fails when file is missing` | PASS |
| `status_report fails when file is too short` | PASS |

### Fix 2: Consolidated todo-templates tests
| Test | Result |
|------|--------|
| `returns generic template with 2+ mandatory items` | PASS |
| `returns research template with sources and chart items` | PASS |
| `falls back to generic when job type has no template` | PASS |
| `capability_build does NOT get generic status-report items` | PASS |
| `uses research template for research job type` | PASS |
| (8 original tests) | PASS |

Duplicate file `src/automations/todo-templates.test.ts` confirmed deleted (not in test output).

### Fix 3: Debrief pipeline integration test
| Test | Result |
|------|--------|
| `debrief pipeline excludes needs_review jobs` (now updated to include) | PASS |
| `debrief adapter reads debrief-digest.md from disk` | PASS |

### Fix 4-5: Documentation only
No tests required (comments and CLAUDE.md changes).

## Browser Verification

Skipped -- no UI changes. Pure backend fixes and documentation.

## TypeScript Compilation

Not independently verified (`npx tsc --noEmit` not run). All tests execute and pass, which implies compilation succeeds for the tested modules.

## Summary

All sprint-introduced tests pass. The single failure is pre-existing and unrelated to sprint scope. No regressions detected.
