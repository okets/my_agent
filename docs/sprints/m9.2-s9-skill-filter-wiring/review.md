# M9.2-S9: Skill Filter Wiring — Code Review

**Reviewer:** External (Opus)
**Date:** 2026-04-07
**Commit:** `dd7b3f3` — fix(m9.2-s9): wire skill filter into prompt assembly

---

## Summary

Sprint S9 successfully wires the `filterSkillsByTools()` return value through the full chain: session manager -> SystemPromptBuilder -> `assembleSystemPrompt()`. Skills requiring unavailable tools are now actually excluded from the system prompt. The implementation is clean, minimal, and well-tested.

**Verdict: PASS** — all checklist items satisfied, no critical issues.

---

## Plan Alignment

| Plan Step | Status | Notes |
|-----------|--------|-------|
| 1a: Add `excludeSkills` to `assembleSystemPrompt` | Done | Added to `AssemblePromptOptions` interface and wired into framework skills scan loop |
| 2a: Wire session manager | Done | `doInitialize()` passes `disabledSkills` to `promptBuilder.excludeSkills` |
| 2b: Wire automation executor | Correctly Skipped | See deviation analysis below |
| 2c: Remove dead call in `app.ts` | Done | `filterSkillsByTools` import and call removed, replaced with `app.emit("skills:changed")` |
| 3a: Unit tests | Done | 3 tests covering exclude, empty set, and undefined |
| 4a: Full test suite | Done | Core: 264 passed, 7 skipped. Dashboard: 1081 passed, 8 skipped. |

### Justified Deviation: Step 2b (Automation Executor)

The plan called for wiring `filterSkillsByTools()` into the automation executor at line ~176. The implementation correctly skips this step. The automation executor uses `buildWorkingNinaPrompt()` (introduced in S8), which does NOT load framework skills at all — it has its own worker persona + task context. Since the worker prompt never includes framework skills, there is nothing to exclude. The `disabledSkills` result in the automation executor is only consumed by the legacy `cleanupSkillFilters()` call, which is harmless backward compat cleanup.

This is a beneficial deviation: the plan was written before S8 fully separated worker prompts from brain identity, so Step 2b became unnecessary.

---

## Checklist Results

### 1. Wiring Complete

The exclude set flows correctly:
- `filterSkillsByTools(agentDir, CONVERSATION_TOOLS)` returns disabled skill names (session-manager.ts:331)
- Result stored in `this.disabledSkills` and converted to `Set<string>` (session-manager.ts:338)
- Passed to `SystemPromptBuilder._excludeSkills` via setter (system-prompt-builder.ts:61)
- Forwarded to `assembleSystemPrompt()` in `getStablePrompt()` (system-prompt-builder.ts:212)
- Applied in framework skills scan loop via `options.excludeSkills?.has(skillName)` (prompt.ts:611)

### 2. Cache Invalidation

The `excludeSkills` setter correctly sets `this.stablePromptCache = null`, forcing a rebuild on the next `build()` call. This ensures skill filtering changes take effect immediately.

### 3. Backward Compatibility

`assembleSystemPrompt()` uses the existing `AssemblePromptOptions` interface with `excludeSkills` as optional. The `options` parameter defaults to `{}`. All existing callers that don't pass `excludeSkills` continue to work identically — no filtering is applied when the field is undefined or absent.

The builder also guards with `this._excludeSkills.size > 0 ? this._excludeSkills : undefined`, avoiding passing an empty set (which would be harmless but unnecessary).

### 4. Dead Code Removal

The `filterSkillsByTools` import is cleanly removed from `app.ts` (line 45 of diff). The `onSkillCreated` callback now emits `skills:changed` instead of calling the no-op function. The comment explaining the removal is accurate and helpful.

### 5. Test Coverage

Three new tests in `prompt-always-on.test.ts`:
- **Exclude set filters correctly:** Creates two skills, excludes one, verifies only the other appears
- **Empty set loads all:** Verifies `new Set()` does not accidentally filter anything
- **Undefined loads all:** Verifies omitting the parameter entirely works

Tests use the same temp directory structure as existing tests and are consistent in style.

---

## Issues

### Important

**Shared prompt builder mutation from multiple sessions.** The `SessionManager` uses `sharedPromptBuilder` (a singleton). When `doInitialize()` sets `this.promptBuilder.excludeSkills`, it mutates state shared across all session manager instances. Currently this is safe because all Conversation Nina sessions use the same `CONVERSATION_TOOLS` constant, so they compute identical `disabledSkills`. However, if future work introduces per-session or per-channel tool variations, this shared mutation would cause the last-initialized session's exclude set to silently override all others.

**Recommendation:** Add a comment in `session-manager.ts` near line 337 documenting this assumption: "All brain sessions use identical CONVERSATION_TOOLS, so the shared builder's excludeSkills is the same for all sessions. If per-session tool sets are needed, move excludeSkills to per-session state."

### Suggestions

1. **`skills:changed` event does not invalidate prompt builder cache.** The `onSkillCreated` callback now emits `skills:changed`, but no listener calls `getPromptBuilder()?.invalidateCache()` in response. This means a skill created at runtime won't appear in the system prompt until the cache is invalidated by another event. This is pre-existing behavior (before this sprint, the `filterSkillsByTools` call was the only action), but the refactoring makes it more visible. Consider wiring `skills:changed` -> `invalidateCache()` as a follow-up.

2. **Automation executor's `disabledSkills` is now dead state.** In `automation-executor.ts:176-179`, `filterSkillsByTools()` still runs and its result is stored, but the only consumer is `cleanupSkillFilters()` in the finally block. Since S8 made `filterSkillsByTools` pure (no disk writes), and `cleanupSkillFilters` is deprecated (no-op when there are no disk flags), this entire code path is dead. Consider removing it in a cleanup sprint.

---

## What Was Done Well

- Minimal, focused changes — only 59 lines added across 5 files
- Clean integration with existing `AssemblePromptOptions` interface rather than a new parameter
- Proper cache invalidation on setter — prevents stale prompts
- Good defensive coding: `options.excludeSkills?.has(skillName)` handles undefined gracefully
- Tests match the plan's specifications almost exactly, with appropriate adaptation to use real skill content rather than mock strings
- The `app.ts` cleanup replaces a dead function call with a meaningful event emission
- Accurate, non-verbose comments explaining the rationale for changes
