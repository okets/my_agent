# M9.2-S9: Skill Filter Wiring — Test Report

**Date:** 2026-04-07
**Commit:** `dd7b3f3`

---

## Test Execution

### Core Package

```
Test Files  26 passed | 1 skipped (27)
Tests       264 passed | 7 skipped (271)
Duration    3.06s
```

All 264 tests pass. 7 skipped tests are live LLM tests (triage-behavioral) gated behind API keys — expected.

### Dashboard Package

```
Test Files  123 passed | 3 skipped (126)
Tests       1081 passed | 8 skipped (1089)
Duration    28.48s
```

All 1081 tests pass. 8 skipped tests are live LLM tests (handler-execution, user-automation, hitl-live) — expected.

---

## New Tests (3)

All in `packages/core/tests/prompt-always-on.test.ts`:

| Test | What It Verifies | Result |
|------|-----------------|--------|
| excludes skills in the excludeSkills set | Creates `conversation-role` and `task-triage` skills, excludes `conversation-role`, verifies only `task-triage` content appears | PASS |
| loads all skills when excludeSkills is empty | Passes `new Set()`, verifies skill content still loads | PASS |
| loads all skills when excludeSkills is undefined | Omits `excludeSkills` entirely, verifies skill content loads | PASS |

### Test Quality Assessment

- Tests use real file system (temp directory), not mocks — they exercise the actual `readdir` + frontmatter parsing + exclude logic
- Skill files include proper YAML frontmatter with `level: brain`, matching production skill format
- Assertions check for skill body content (not frontmatter), confirming the frontmatter stripping still works alongside exclusion
- The exclude test verifies both negative (excluded skill absent) and positive (non-excluded skill present) in the same assertion block

---

## Regression Risk

**Low.** The changes add an optional parameter to an existing function and wire it through an existing caching layer. No existing behavior is modified when `excludeSkills` is not provided. All 1345 pre-existing tests continue to pass.

---

## Coverage Gaps

1. **No integration test for the full chain** (session manager -> builder -> assembleSystemPrompt). The unit tests prove `assembleSystemPrompt` respects `excludeSkills`, but there is no test proving that `SessionManager.doInitialize()` correctly sets `excludeSkills` on the builder. This is acceptable for this sprint since the wiring is 3 lines of straightforward code, but a follow-up integration test would strengthen confidence.

2. **No test for cache invalidation behavior.** The setter nullifies `stablePromptCache`, but no test calls `build()`, then sets `excludeSkills`, then calls `build()` again to verify the cache was actually regenerated. The existing cache invalidation tests in the dashboard test suite cover `invalidateCache()` directly, so this is low risk.
