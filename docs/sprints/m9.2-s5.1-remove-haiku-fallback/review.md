# M9.2-S5.1 External Review: Remove Haiku Visual Fallback

**Reviewer:** Independent external reviewer (Claude Opus 4.6)
**Branch:** `experiment/remove-haiku-fallback`
**Date:** 2026-04-06
**Commits reviewed:** `0e62ef7` (experiment) + `123f7a1` (cleanup)

---

## Verdict: PASS (with 2 minor nits)

The 263 deleted lines in the cleanup commit (277 total across both commits) are all accounted for by the sprint plan. No unrelated functionality was removed. All surviving systems are intact.

---

## 1. Line-by-Line Deletion Breakdown

### Commit 1: `0e62ef7` — Experiment (short-circuit)

| File | Lines Added | Lines Deleted | What Changed |
|------|-------------|---------------|--------------|
| `src/conversations/post-response-hooks.ts` | 4 | 18 | Replaced `augmentWithVisual` body with early `return;` stub |
| **Subtotal** | **4** | **18** | |

### Commit 2: `123f7a1` — Cleanup (the "263 lines")

| File | Lines Added | Lines Deleted | What Changed |
|------|-------------|---------------|--------------|
| `src/chat/visual-augmentation.ts` | 0 | 180 | **Entire file deleted** (Haiku fallback hook) |
| `tests/unit/chat/visual-augmentation.test.ts` | 0 | 28 | **Entire file deleted** (heuristic unit tests) |
| `src/conversations/post-response-hooks.ts` | 0 | 24 | Removed: import (4 lines), `VisualAugmentationDeps` dep (2 lines), `augmentWithVisual` stub + call (14 lines), `turnNumber`/`imagesStoredDuringTurn` from options type (4 lines) |
| `src/app.ts` | 0 | 13 | Removed `visualAugmentation` deps wiring block |
| `src/chat/chat-service.ts` | 0 | 11 | Removed: `imagesStoredDuringTurn` counter (2 lines), `onScreenshot` listener (3 lines), `unsubScreenshots` cleanup (3 lines), `turnNumber`/`imagesStoredDuringTurn` from hooks call (3 lines) |
| `src/channels/message-handler.ts` | 0 | 4 | Removed `turnNumber`/`imagesStoredDuringTurn` from type (2 lines) and call site (2 lines) |
| `src/mcp/chart-server.ts` | 0 | 2 | Removed stale comment referencing `visual-augmentation.ts` in Zod schema |
| `skills/visual-presenter.md` | 1 | 1 | Replaced Haiku fallback framing with "data stays text-only" |
| **Subtotal** | **1** | **263** | |

### Combined Totals

| Metric | Count |
|--------|-------|
| Total lines deleted | 281 (18 + 263) |
| Total lines added | 5 (4 + 1) |
| Net lines removed | 276 |
| `git diff master...HEAD` reports | 277 deletions, 1 insertion (the first commit's 4 additions were subsequently deleted in the second commit, netting to 0) |

### Where the 263 Lines Went

| Category | Lines | % |
|----------|-------|---|
| Deleted file: `visual-augmentation.ts` | 180 | 68.4% |
| Deleted file: `visual-augmentation.test.ts` | 28 | 10.6% |
| Cleanup edits across 5 files | 55 | 20.9% |
| **Total** | **263** | **100%** |

---

## 2. Verification: Nothing Accidentally Removed

### Confirmed INTACT

| Item | File | Status |
|------|------|--------|
| `handleCreateChart` function | `src/mcp/chart-server.ts` (line 48) | Present, exported, fully functional |
| `create_chart` MCP tool | `src/mcp/chart-server.ts` (line 105) | Present, registered via `createSdkMcpServer` |
| `fetch_image` MCP tool | `src/mcp/image-fetch-server.ts` (line 227) | Present, untouched by this branch |
| `PostResponseHooks.run()` | `src/conversations/post-response-hooks.ts` (line 56) | Works — calls `detectMissedTasks` + `responseWatchdog` |
| `PostResponseHooks` class export | `src/conversations/post-response-hooks.ts` (line 45) | Exported, used in `app.ts`, `chat/types.ts`, `server.ts` |
| `VisualActionService` class | `src/visual/visual-action-service.ts` (line 20) | Present, untouched |
| `VisualActionService.onScreenshot()` | `src/visual/visual-action-service.ts` (line 30) | Present — still used by `automation-executor.ts` (line 226) and `app.ts` (line 915) |

### Collateral Removal Analysis

The branch also removed `turnNumber` from `PostResponseHooks.run()` options and from the `message-handler.ts` type/call site. This was NOT explicitly listed in the sprint plan but is **correct**: `turnNumber` was only consumed by `augmentWithVisual`, which is now deleted. No other code path reads `turnNumber` from the hooks options. Removing dead fields is appropriate cleanup.

---

## 3. Findings

### No Issues (all deletions justified)

Every deleted line falls into one of these categories:
1. The `visual-augmentation.ts` file itself (Haiku fallback logic, prompts, types)
2. The test file for the above
3. Import/type/dep references to the deleted file
4. The `imagesStoredDuringTurn` counter and `onScreenshot` subscription in `chat-service.ts` (only purpose was feeding the deleted hook)
5. The `visualAugmentation` deps wiring in `app.ts` (only purpose was feeding the deleted hook)
6. The `turnNumber`/`imagesStoredDuringTurn` in hook options (only consumer was the deleted method)
7. Stale comments referencing the deleted code
8. Skill text reframing

### Nit 1: Stale comment in `chart-server.ts` line 46

```
// -- Handler (exported for visual augmentation hook) --
```

The Zod schema comment was removed (2 lines), but this section header still says "exported for visual augmentation hook." The hook no longer exists. `handleCreateChart` is still exported (used by the MCP tool handler), so the export is fine — just the comment is stale. Should read something like:

```
// -- Handler --
```

**Severity:** Cosmetic. No functional impact.

### Nit 2: Stale comments referencing "visual augmentation"

Two comments still reference "visual augmentation" after the feature is removed:

1. `src/channels/message-handler.ts` line 774:
   ```
   // Post-response hooks (task extraction, visual augmentation) -- fire-and-forget
   ```

2. `src/conversations/post-response-hooks.ts` lines 8-9 (module docblock):
   ```
   * - Visual augmentation: attaches screenshots to conversations
   ```

**Severity:** Cosmetic. No functional impact. Should be cleaned up for accuracy.

---

## 4. Risk Assessment

| Risk | Assessment |
|------|------------|
| Compile errors from dangling imports | **None** — all references to `visual-augmentation.ts`, `VisualAugmentationDeps`, `maybeAugmentWithVisual`, `imagesStoredDuringTurn`, `augmentWithVisual` are fully removed. Zero grep hits. |
| Runtime errors from missing deps | **None** — `PostResponseHooks` constructor no longer expects `visualAugmentation` in deps. `app.ts` no longer passes it. |
| Brain-side chart creation broken | **No** — `handleCreateChart`, `create_chart` MCP tool, and `createChartServer` are completely untouched. |
| Image fetch broken | **No** — `image-fetch-server.ts` is completely untouched. |
| Screenshot storage broken | **No** — `VisualActionService` is untouched. `onScreenshot` is still used by `automation-executor.ts` and `app.ts`. |
| Post-response hooks broken | **No** — `run()` still calls `detectMissedTasks` and `responseWatchdog`. Tests pass. |
| Rollback complexity | **Trivial** — `git checkout master` restores everything. |

---

## 5. Conclusion

The sprint cleanly removes the Haiku visual fallback with no collateral damage. The 263 lines in the cleanup commit (68% from the deleted file, 11% from its test, 21% from cleanup edits) are all directly traceable to the sprint plan.

Two stale comments survive (nit severity). Recommend a quick follow-up to clean those, or accept as-is — they cause no functional issues.

**Recommendation:** Safe to merge.
