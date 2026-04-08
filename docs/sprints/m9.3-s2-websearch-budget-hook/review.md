# M9.3-S2 WebSearch Budget Hook -- External Review

**Reviewer:** Opus (external)
**Date:** 2026-04-08
**Branch:** `sprint/m9.3-s2-websearch-budget-hook`
**Commits:** 2 (1b2f3a1, 4d680ce)
**Files changed:** 6 (+161/-1)

---

## Verdict: PASS

The sprint delivers exactly what Tasks 5-6 of the plan specify. The hook correctly implements the budget pattern, the SDK types are used correctly, the wiring in SessionManager is sound, and the test coverage is thorough. Two suggestions below for minor improvements; neither blocks merge.

---

## Checklist Results

### 1. Does the hook correctly implement the budget pattern (count, allow, deny)?

**Yes.** The counter increments on each WebSearch call, allows calls where `count <= budget`, and denies where `count > budget`. The deny path returns both a `systemMessage` (for the LLM) and a `hookSpecificOutput` with `permissionDecision: 'deny'` (for the SDK). The allow path returns `{}` which is the correct no-op for `SyncHookJSONOutput`.

**Plan deviation (justified):** The plan sprint table says "nudge at 2, block at 3" suggesting a two-phase behavior (soft warning then hard block). The implementation uses a single-phase approach: allow up to budget, deny everything above. The plan's Task 5 code block (the actual implementation spec) matches the implementation exactly -- there is no nudge-vs-block distinction in the plan's code. The sprint table text appears to be a summary that was slightly imprecise. The single-phase "block with actionable systemMessage" is functionally equivalent and simpler, since the systemMessage itself serves as the nudge. This is a beneficial simplification.

### 2. Is the SDK type usage correct?

**Yes.** Verified against the actual SDK type definitions in `packages/core/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

| Aspect | Implementation | SDK Definition | Correct? |
|--------|---------------|----------------|----------|
| `HookCallback` signature | `async (input) => HookJSONOutput` | `(input: HookInput, toolUseID: string, options: { signal: AbortSignal }) => Promise<HookJSONOutput>` | Yes |
| `HookJSONOutput` | Returns `SyncHookJSONOutput` shape | `AsyncHookJSONOutput \| SyncHookJSONOutput` | Yes |
| `systemMessage` field | string on deny | `systemMessage?: string` on `SyncHookJSONOutput` | Yes |
| `hookSpecificOutput` | `PreToolUseHookSpecificOutput` shape | `{ hookEventName: 'PreToolUse'; permissionDecision?: 'allow' \| 'deny' \| 'ask'; permissionDecisionReason?: string; ... }` | Yes |
| `PreToolUseHookInput` | Cast from `HookInput`, uses `tool_name` | `{ hook_event_name: 'PreToolUse'; tool_name: string; tool_input: unknown; tool_use_id: string }` | Yes |
| Import of `HookJSONOutput` | Explicit import for return type annotation | Exported from SDK | Yes |

The implementation imports `HookJSONOutput` which the plan's code block did not -- this is a good improvement as it provides explicit return type annotation.

### 3. Is the wiring in SessionManager correct?

**Yes.** Three aspects verified:

1. **Hook registration:** Added to `this.hooks.PreToolUse` array in `doInitialize()` with `matcher: "WebSearch"`. This is the same pattern used by `createHooks()` for safety hooks (Write/Edit matcher for source code protection, Bash matcher for bash blocker). The matcher ensures the hook callback is only invoked for WebSearch tool calls, which is correct.

2. **Hook lifecycle:** The enforcer is created as a class property (`private delegationEnforcer: DelegationEnforcer = createDelegationEnforcer(2)`), so it is instantiated once per `SessionManager` instance. Since `doInitialize()` runs once per session via `ensureInitialized()`, the hook is pushed exactly once. Good.

3. **Import path:** Uses `@my-agent/core` (the package's public API via `lib.ts`), not a direct path. Correct.

**Plan deviation (justified):** The plan's Task 6 Step 3 suggested building a new `preToolUseHooks` array in `buildQuery()` and spreading `this.hooks`. The implementation instead pushes the hook in `doInitialize()`, which is simpler and consistent with how the SubagentStart/SubagentStop hooks are wired (lines 309-328 of `session-manager.ts`). This is a better approach -- it avoids rebuilding the hooks array on every query.

### 4. Does resetTurn happen at the right point?

**Yes.** `this.delegationEnforcer.resetTurn()` is called at the top of `buildQuery()` (line 459), before any prompt assembly or query construction. `buildQuery()` is called from `streamMessage()` which is triggered by each user message. The `messageIndex` increment happens in `streamMessage()` before `buildQuery()` is called, confirming a 1:1 mapping between user messages and reset calls.

Edge case: the fallback path in `streamMessage()` calls `buildQuery()` a second time (line 427) if session resume fails. This means `resetTurn()` would be called twice for the same user message. This is harmless -- resetting an already-zero counter is a no-op. The counter was already reset by the first `buildQuery()` call, and since the first stream processing failed (before any tool calls could complete), the counter is still at 0.

### 5. Is the systemMessage actionable for the LLM?

**Yes.** The message is well-structured:

1. States what happened: "WebSearch blocked (2 searches already used, limit is 2)"
2. Reframes the situation: "This is research-level work"
3. Gives a specific action: "delegate it to a working agent via create_automation"
4. Provides practical detail: "with notify: 'immediate' so the user gets results quickly"
5. Specifies what to include: "Include the full research context in the instructions field"

This aligns with the system prompt corrections from S1 (same vocabulary: "create_automation", "delegate", "immediate"). The LLM receives consistent messaging from both the prompt layer and the enforcement layer.

### 6. Are there edge cases not covered by tests?

**All important cases are covered.** The 7 tests cover: allow first call, allow at budget, deny on exceed, deny all subsequent, ignore non-WebSearch, reset on new turn, custom budget.

Two minor uncovered cases (acceptable risk):

- **Concurrent sessions:** Two `SessionManager` instances each have independent enforcers (class property), so there's no shared state risk. This is correct by construction, not something that needs a test.
- **Budget of zero:** `createDelegationEnforcer(0)` would block all WebSearch calls immediately. This is a valid edge case but unlikely to be used in practice. The default is 2 and the plan specifies 2.

### 7. Any spec gaps -- things the plan asked for that were not done?

**None for S2 scope.** Tasks 5 and 6 are fully implemented:

| Plan Step | Status | Notes |
|-----------|--------|-------|
| Task 5 Step 1: Write unit test | Done | 7 tests, all pass |
| Task 5 Step 3: Implement delegation enforcer | Done | Matches plan code exactly |
| Task 5 Step 4: Export from hooks index | Done | Both value and type exports |
| Task 6 Step 1: Import in session-manager | Done | Uses `@my-agent/core` import |
| Task 6 Step 2: Class property | Done | Initialized with budget=2 |
| Task 6 Step 3: Wire PreToolUse hook | Done | In `doInitialize()` (justified deviation) |
| Task 6 Step 4: Reset on each new query | Done | Top of `buildQuery()` |
| Task 6 Step 5: TypeScript clean compile | Done | Both packages compile clean |

The plan also specified `lib.ts` re-export, which was done (adding `createDelegationEnforcer` and `DelegationEnforcer` type to the public API).

---

## Issues

*None.*

---

## Suggestions

### 1. Test helper uses `as PreToolUseHookInput` cast with `hook_event_name` field

**File:** `packages/core/tests/delegation-hook.test.ts:6-11`

The test helper function `makePreToolInput` includes `hook_event_name: 'PreToolUse'` and `tool_use_id`, which matches the SDK's `PreToolUseHookInput` type definition. The plan's version did not include these fields. Including them is the correct approach since the SDK type requires them. Good improvement.

### 2. Consider adding `permissionDecisionReason` to test assertions

**File:** `packages/core/tests/delegation-hook.test.ts:37-43`

The deny test asserts `systemMessage` contains "create_automation" and checks `permissionDecision` is "deny", but does not verify the `permissionDecisionReason` field. Adding a quick check that the reason string is non-empty would strengthen the test:

```typescript
expect((result as any).hookSpecificOutput.permissionDecisionReason).toBeTruthy()
```

This is not blocking -- the field is set in the implementation and the main assertion (`permissionDecision: 'deny'`) is the one the SDK uses to make enforcement decisions.

---

## What Was Done Well

1. **Exact plan adherence with justified improvements.** Both deviations from the plan (hook registration in `doInitialize()` instead of `buildQuery()`, explicit `HookJSONOutput` return type import) are improvements that maintain consistency with existing patterns.

2. **Correct SDK type usage.** The `PreToolUseHookSpecificOutput` shape matches the SDK definition exactly. The `hookEventName` discriminant, `permissionDecision`, and `permissionDecisionReason` fields are all correctly typed with `as const` assertions.

3. **Clean separation of concerns.** The enforcer is a pure function factory in core (`packages/core/src/hooks/delegation.ts`) with no dashboard dependencies. The wiring is in the dashboard's SessionManager. This follows the established hooks architecture where core provides the building blocks and consumers compose them.

4. **Test quality.** Tests use proper SDK-shaped inputs (including `signal` via `AbortController`), cover the budget boundary (allow at N, deny at N+1), and verify the reset behavior. The custom budget test actually exercises the deny path (not just structural checks like the plan suggested).

5. **Mock update in existing tests.** The `session-manager-skills.test.ts` mock was updated to include `createDelegationEnforcer`, preventing test failures from the new import. This kind of attention to downstream impact is essential.

6. **Minimal diff.** 161 lines added across 6 files, with surgical changes to existing files (2 lines in hooks/index.ts, 3 in lib.ts, 13 in session-manager.ts, 4 in the mock). No unnecessary refactoring.
