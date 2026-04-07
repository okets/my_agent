# M9.2-S7 Test Report

**Date:** 2026-04-07
**Branch:** `sprint/m9.2-s7-framework-instance-split`
**Commit:** `ea14b0e`
**Runner:** External reviewer (Claude Opus 4.6)

---

## Test Results

### packages/core

```
Test Files:  26 passed | 1 skipped (27)
Tests:       259 passed | 7 skipped (266)
Duration:    2.77s
```

**Skipped:** `triage-behavioral.test.ts` (7 tests) -- requires `ANTHROPIC_API_KEY` and live `.my_agent/brain/` directory. Expected skip in automated runs.

### packages/dashboard

```
Test Files:  122 passed | 3 skipped (125)
Tests:       1074 passed | 8 skipped (1082)
Duration:    24.89s
```

**Skipped:**
- `handler-execution.test.ts` (4 tests) -- live handler tests
- `hitl-live.test.ts` (1 test) -- live human-in-the-loop test
- `user-automation.test.ts` (1 test) -- live user automation test

All skips are pre-existing environment-gated tests, not new failures.

---

## Sprint-Specific Test Coverage

### Modified test files

| File | Tests | Status | What changed |
|------|-------|--------|-------------|
| `core/tests/prompt-triage-regression.test.ts` | 12 | All pass | Restructured to use framework skills dir; assertions updated to `create_automation`; added stale-ref negative checks |
| `core/tests/prompt-always-on.test.ts` | 6 | All pass | Restructured to use framework skills dir; verifies level:brain loading, frontmatter stripping, non-brain exclusion |
| `core/tests/triage-behavioral.test.ts` | 7 | All skip | Updated `create_automation` in LLM prompt; skipped (no API key) |
| `dashboard/tests/mcp/skill-triage-scenarios.test.ts` | 5 | All pass | Updated to read from repo-root skills/; added stale-ref and checklist assertions |

### Key assertions verified

- `create_automation` appears in assembled prompt (not `create_task`)
- `revise_task`, `search_tasks`, `update_property` do NOT appear in prompt
- YAML frontmatter stripped before injection (`level: brain` not in output)
- Skills without `level: brain` are excluded from prompt
- Skills without frontmatter are excluded from prompt
- No duplicate triage content in assembled prompt
- Automation Design Checklist present in task-triage content
- Skill CRUD tools (`create_skill`, `update_skill`, `delete_skill`) present

---

## No regressions detected

All 1333 passing tests continue to pass. No new failures introduced.
