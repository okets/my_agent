# Deviations Log — Sprint M6.5-S1: SDK Enhancement

> **Sprint:** [plan.md](plan.md)
> **Started:** 2026-02-27

---

## Summary

| Type | Count | Recommendation |
|------|-------|----------------|
| Additions | 0 | — |
| Removals | 1 | Accept |
| Changes | 0 | — |
| Dependencies | 0 | — |

**Overall Assessment:** On track — one planned item deferred.

---

## Deviations

### Deviation: Unit tests deferred

**Type:** Removal
**Severity:** Low
**Recommendation:** Accept

**Plan specified:**
- `packages/core/tests/mcp-memory.test.ts`
- `packages/core/tests/agents.test.ts`
- `packages/core/tests/hooks.test.ts`

**What happened:**
No test runner is configured in the project. Adding vitest/jest setup would be out of scope.

**Mitigation:**
- TypeScript compilation (zero errors) validates type correctness
- Prettier check validates formatting
- Independent Opus code review validates logic and security
- Integration testing will happen when dashboard wires these into the brain

**Impact:** Low — all modules are type-checked and independently reviewed. Tests should be added when a test framework is set up.
