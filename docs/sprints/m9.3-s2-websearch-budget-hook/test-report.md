# M9.3-S2 WebSearch Budget Hook -- Test Report

**Date:** 2026-04-08
**Branch:** `sprint/m9.3-s2-websearch-budget-hook`

---

## Summary

| Package | Total | Passed | Skipped | Failed |
|---------|-------|--------|---------|--------|
| Core | 273 | 273 | 7 | 0 |
| Dashboard | 1090 | 1090 | 8 | 0 |
| **Total** | **1363** | **1363** | **15** | **0** |

TypeScript compilation: clean on both packages.

---

## New Tests (S2)

### `packages/core/tests/delegation-hook.test.ts` (7 tests)

| Test | Description | Status |
|------|-------------|--------|
| should allow first WebSearch call | Budget=2, first call returns `{}` | PASS |
| should allow second WebSearch call (at budget) | Budget=2, second call returns `{}` | PASS |
| should deny on the call that exceeds budget | Budget=2, third call returns deny with systemMessage | PASS |
| should block all subsequent calls after exceeding budget | Fourth+ calls also denied | PASS |
| should not affect non-WebSearch tools | Read tool returns `{}` regardless of state | PASS |
| should reset count on new turn | After exhaust + resetTurn(), first call allowed again | PASS |
| should work with custom budget | Budget=1, first allowed, second denied | PASS |

### Modified test: `packages/dashboard/tests/session-manager-skills.test.ts`

| Change | Description | Status |
|--------|-------------|--------|
| Mock update | Added `createDelegationEnforcer` to `@my-agent/core` mock | PASS (all existing 1090 dashboard tests unaffected) |

---

## Test Quality Assessment

**Coverage:** The 7 new tests cover all behavioral paths of the enforcer:
- Allow path (count within budget)
- Deny path (count exceeds budget)
- Boundary condition (exactly at budget)
- Continuation after deny (all subsequent blocked)
- Tool discrimination (non-WebSearch ignored)
- State reset (turn boundary)
- Parameterization (custom budget value)

**SDK fidelity:** Test inputs use the correct `PreToolUseHookInput` shape including `hook_event_name`, `tool_name`, `tool_input`, and `tool_use_id` fields. Hook callbacks receive the `toolUseID` string and `{ signal }` options matching the `HookCallback` signature.

**Assertions:** Deny tests verify three properties: `systemMessage` content (contains "create_automation"), `hookSpecificOutput.hookEventName` (equals "PreToolUse"), and `hookSpecificOutput.permissionDecision` (equals "deny"). These are the fields the SDK uses to enforce the decision.

---

## Regression Risk

**Low.** The new hook is additive:
- No existing hooks were modified
- The `createHooks()` factory is unchanged
- The SessionManager mock was updated to include the new import
- Dashboard tests all pass without modification (only the mock file changed)

---

## Not Tested (deferred to S3)

- E2E delegation compliance (real LLM against dashboard) -- Task 7 in the plan, S3 scope
- Integration with `create_automation` tool (verifying the LLM actually calls it after being blocked)
- Multi-turn conversation with budget resets across messages
