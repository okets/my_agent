# M9.2-S8 Test Report

**Date:** 2026-04-07
**Runner:** External Opus reviewer
**Framework:** Vitest 4.0.18

---

## New Tests Added

### Worker Prompt Isolation (7 tests)

**File:** `packages/dashboard/tests/unit/automations/working-nina-prompt.test.ts`

| # | Test | Result | What It Verifies |
|---|------|--------|------------------|
| 1 | does NOT include brain identity or conversation role | PASS | No "conversation layer", "do not do work yourself", "create_automation", "Delegation" |
| 2 | does NOT include triage routing or delegation checklist | PASS | No "task-triage", "Automation Design Checklist", "Interview-First Rule" |
| 3 | does NOT include daily logs or notebook tree | PASS | No "Recent Daily Logs", "Notebook Directory" |
| 4 | does NOT include standing orders or trust tiers | PASS | No "Trust Tiers", "Escalation Rules", "Standing Orders" |
| 5 | does NOT include automation hints | PASS | No "Active Automations", "fire_automation" |
| 6 | includes worker-specific persona and todo system | PASS | Contains "Working Nina", "Pre-Completion Self-Check", "todo_list", "Todo System" |
| 7 | includes temporal context | PASS | Contains "Temporal Context" and task title |

**Test quality:** Tests set up a realistic agent directory with brain content (identity file, standing orders, daily logs, framework skills with brain-level frontmatter, automation manifests). This ensures the test is meaningful -- the content exists on disk but does not leak into the worker prompt.

### Skill Filter Safety (7 tests)

**File:** `packages/core/tests/skill-filter.test.ts`

| # | Test | Result | What It Verifies |
|---|------|--------|------------------|
| 1 | returns skills whose allowed-tools are not in session tools | PASS | Correct identification of skills to disable |
| 2 | does NOT modify SKILL.md files on disk | PASS | File content unchanged after filter, no disable-model-invocation written |
| 3 | keeps skills whose allowed-tools are all available | PASS | Skills with matching tools return empty disabled list |
| 4 | keeps skills without allowed-tools field (backwards compatible) | PASS | Legacy skills without the field are never disabled |
| 5 | keeps skills when session has all required tools (Working Nina) | PASS | Worker sessions with full tool set disable nothing |
| 6 | does not leave artifacts on simulated crash (no disk writes) | PASS | Filter runs, no cleanup called, file unchanged on disk |
| 7 | cleanupSkillFilters is a no-op and does not throw | PASS | Deprecated function resolves without error |

**Test quality:** The crash simulation test (test 6) is the key safety test -- it runs `filterSkillsByTools` and intentionally skips `cleanupSkillFilters`, then verifies no `disable-model-invocation` flag was written. This directly proves the sprint goal.

---

## Full Suite Results

| Package | Passed | Skipped | Failed |
|---------|--------|---------|--------|
| Core | 261 | 7 | 0 |
| Dashboard | 1081 | 8 | 0 |

No regressions detected. Skipped tests are pre-existing (not related to S8 changes).

---

## Targeted Test Runs (Verified by Reviewer)

```
packages/core/tests/skill-filter.test.ts          7/7 passed  (55ms)
packages/dashboard/tests/unit/automations/working-nina-prompt.test.ts  7/7 passed  (55ms)
```

Both test files were executed independently by the reviewer and confirmed passing.

---

## Coverage Gaps

1. **No integration test for skill exclusion wiring.** The `filterSkillsByTools` return value is not currently consumed by prompt assembly (see review.md Important issue). When the wiring is added, an integration test should verify that disabled skills are actually excluded from the assembled prompt.

2. **No smoke tests executed.** Plan steps 13-15 (live dashboard smoke tests for worker isolation, crash recovery, and research job completion) were not run. These require a running dashboard and are tracked for follow-up.
