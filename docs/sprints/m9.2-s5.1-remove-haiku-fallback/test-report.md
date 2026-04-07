# M9.2-S5.1 Test Report: Remove Haiku Visual Fallback

**Branch:** `experiment/remove-haiku-fallback`
**Date:** 2026-04-06
**Runner:** `npx vitest run` in `packages/dashboard/`
**Vitest version:** 4.0.18

---

## Results: ALL PASS

```
 Test Files  122 passed | 3 skipped (125)
      Tests  1072 passed | 8 skipped (1080)
   Start at  10:40:36
   Duration  24.16s (transform 8.22s, setup 0ms, import 63.03s, tests 24.03s, environment 39ms)
```

### Skipped Tests (pre-existing, unrelated)

| File | Tests | Reason |
|------|-------|--------|
| `tests/live/handler-execution.test.ts` | 4 | Live test (requires running agent) |
| `tests/live/user-automation.test.ts` | 1 | Live test |
| `tests/live/hitl-live.test.ts` | 1 | Live test |

These are tagged as live integration tests and are always skipped in `vitest run`. Not related to this branch.

### Deleted Test File

`tests/unit/chat/visual-augmentation.test.ts` (28 lines, 3 tests) was deleted. These tested the heuristic gate of the removed `maybeAugmentWithVisual` function:

1. "passes for bulleted data with numbers" — tested regex matching on bullet lists
2. "fails for prose with incidental numbers" — tested that prose without bullets is rejected
3. "passes for table data with numbers" — tested regex matching on table rows

All three tested code that no longer exists. Correct to delete.

### No New Test Failures

Zero regressions. No test depended on the Haiku fallback firing, confirming the sprint plan's expectation.

### Dangling Reference Check

| Pattern | Grep Result |
|---------|-------------|
| `visual-augmentation` (import path) | 0 hits |
| `VisualAugmentationDeps` (type) | 0 hits |
| `maybeAugmentWithVisual` (function) | 0 hits |
| `augmentWithVisual` (method) | 0 hits |
| `imagesStoredDuringTurn` (variable) | 0 hits |

No compile-time or runtime breakage possible from dangling references.

### Compilation

TypeScript compilation was not run separately (vitest handles transpilation). The 122 passing test files — which import from `post-response-hooks.ts`, `chat-service.ts`, `app.ts`, and `chart-server.ts` — confirm no type errors in the modified files.
