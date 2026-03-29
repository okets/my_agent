# M8-S1: Visual Action Pipeline -- External Review

**Reviewer:** Claude Opus 4.6 (external)
**Date:** 2026-03-29
**Branch:** `sprint/m8-s1-visual-action-pipeline` (12 commits, base: `master`)
**Verdict:** PASS

---

## What Was Built

A complete screenshot capture-store-serve-render pipeline:

1. **Core types** (`packages/core/src/visual/types.ts`) -- Screenshot, AssetContext, CaptureOptions, ScreenshotMetadata, ScreenshotTag, ScreenshotIndex interfaces
2. **VisualActionService** (`packages/dashboard/src/visual/visual-action-service.ts`) -- store, list, url, updateTag, cleanup, onScreenshot callback
3. **Pixel diff tagger** (`packages/dashboard/src/visual/screenshot-tagger.ts`) -- computeDiffRatio + tagByDiff fallback for untagged screenshots
4. **Asset serving route** (`packages/dashboard/src/routes/asset-routes.ts`) -- two Fastify routes for job and conversation screenshot serving
5. **WebSocket protocol** -- ScreenshotSnapshot type + `state:screenshot` ServerMessage variant
6. **StatePublisher** -- publishScreenshot() method wired to VisualActionService.onScreenshot
7. **App wiring** -- VisualActionService instantiated in App constructor, callback wired to StatePublisher
8. **Frontend** -- Alpine screenshots store, WS handler, timeline thumbnail rendering with "show all" expander
9. **Retention cleanup** -- cleanup() deletes skip-tagged screenshots past retention, protects error/escalation screenshots

---

## Spec Compliance

### Fully Implemented

| Spec Requirement | Status |
|------------------|--------|
| VisualActionService interface (store, list, url) | Done |
| JSONL index per context directory | Done |
| Storage paths: job + conversation | Done |
| Screenshot tagging (keep/skip) | Done |
| Pixel diff fallback tagger | Done |
| Retention policy (skip deleted after period, error/escalation protected) | Done |
| Asset serving route | Done |
| Path traversal protection | Done |
| StatePublisher event (`state:screenshot`) | Done |
| Dashboard rendering (timeline thumbnails, show all expander) | Done |

### Intentional Deviations (Acceptable)

1. **No `capture()` method.** The spec defines `capture()` which delegates to a DesktopBackend. Since backends are S2 scope, only `store()` (for externally-produced images) is implemented. This is correct scoping.

2. **No `session` context type.** The spec defines `AssetContext.type` as `'job' | 'conversation' | 'session'`. The implementation uses only `'job' | 'conversation'`. The plan explicitly narrowed this -- `session` is not used by any current consumer. Acceptable; easy to add later.

3. **Index filename is `index.jsonl` not `screenshots.jsonl`.** The spec says "A `screenshots.jsonl` index file in each directory tracks metadata." The implementation uses `index.jsonl`. This is a minor naming deviation with no functional impact since it is internal. The plan specified `screenshots.jsonl` but the implementation diverged. Not a blocker.

4. **`store()` is synchronous, not async.** The spec defines `store()` as `Promise<Screenshot>`. The implementation returns `Screenshot` directly (sync filesystem writes). The plan specified this too. This is fine -- all I/O is sync (`writeFileSync`), and the tests that `await` the result work correctly because `await` on a non-Promise value is a no-op.

5. **Hard-coded `image/png` content type.** The spec mentions `mime-types` lookup. The implementation always returns `image/png`. Since all screenshots are PNGs, this is correct for now. The plan originally specified `mime-types` usage, but the implementation simplified. When JPEG support is added (S2 resolution handling), this should be revisited.

### Not In Scope (Correctly Deferred)

- `capture()` method (needs DesktopBackend, S2)
- Conversation screenshots rendering in chat (S2+)
- Lightbox store (`$store.lightbox`) -- referenced in HTML click handler with safe fallback to `window.open`

---

## Code Quality Assessment

### Strengths

- **Clean separation:** Types in core, service in dashboard, routes isolated. Follows existing project patterns.
- **Consistent style:** Import paths use `node:` prefix, file structure mirrors existing packages.
- **Good test coverage:** 25 service tests + 7 tagger tests + 4 route tests = 36 new tests. Tests cover happy paths, edge cases (empty context, missing index), and security (path traversal).
- **Security:** Path traversal protection uses segment-level validation (`isSafe()` checks for `..`, `/`, `\`). The route test verifies URL-encoded traversal (`..%2F..%2F`) is caught.
- **Defensive coding:** `list()` returns empty array on missing index. `cleanup()` catches file-not-found during unlink. `updateTag()` throws on missing index (explicit error, not silent failure).
- **Event architecture:** The `onScreenshot` callback pattern is simple and effective for the StatePublisher integration. No over-engineering with EventEmitter for a single event type.

### Issues Found

#### Important (Should Fix)

1. **`ScreenshotIndex` interface is declared but never implemented or used.** It is exported from `packages/core/src/lib.ts` but no class implements it, and `VisualActionService` does not reference it. Either remove it from types.ts and lib.ts, or have `VisualActionService` implement it. Dead code in a public API surface is confusing.

2. **`store()` return type mismatch with spec.** While the sync implementation works, the spec contract says `Promise<Screenshot>`. If external consumers (e.g., future MCP tool handlers) expect a Promise, they will get a raw value. Consider making `store()` async (trivial change: add `async` keyword) for forward compatibility, or document that the interface was intentionally simplified.

3. **`await` on synchronous `store()` in tests.** Lines 169, 181-182, 201, 211 of the test file use `await service.store(...)` even though `store()` returns `Screenshot` not `Promise<Screenshot>`. This works but is misleading -- readers will assume the method is async. Either make the method async or remove the `await` from tests.

#### Suggestions (Nice to Have)

4. **Consider temp directory cleanup in visual service tests.** The `beforeEach` creates temp directories via `mkdtempSync` but there is no `afterEach` cleanup (unlike the asset-routes test which uses `rmSync`). Not a bug since the OS cleans `/tmp`, but good hygiene.

5. **The `url()` method does not guard against missing `automationId` for job context.** If `ctx.type === "job"` but `ctx.automationId` is undefined, the URL will contain `undefined` as a segment: `/api/assets/job/undefined/job-1/screenshots/...`. The `screenshotDir()` method has the same issue with `context.automationId!` (non-null assertion). Consider a runtime check or making `automationId` required when `type === 'job'` via a discriminated union.

6. **No max-items guard on `list()`.** If a long-running desktop task produces thousands of screenshots, `list()` reads the entire JSONL file into memory. For S1 this is fine, but worth noting for S2.

---

## Security Review

**Path traversal:** Properly handled. The `isSafe()` function rejects segments containing `..`, `/`, or `\`. Both URL-decoded and encoded traversal patterns are caught because Fastify decodes URL parameters before passing to handlers, and the test at line 87-94 of asset-routes.test.ts confirms `..%2F` is rejected.

**No injection vectors identified.** Screenshot filenames are generated server-side (`ss-{uuid}.png`), not user-supplied. JSONL parsing uses `JSON.parse` on server-written data.

**File serving is scoped correctly.** Routes only serve from within the agentDir subtree. The join-after-validation pattern is safe because each segment is validated individually.

---

## Integration Assessment

**App wiring is correct.** The VisualActionService is instantiated in the App constructor (line 356 of app.ts), making it available before any async initialization. The StatePublisher wiring (lines 650-665) fires after `statePublisher.subscribeToApp(app)`, which is the correct ordering.

**Frontend integration looks correct.** The Alpine store matches the ScreenshotSnapshot shape from the protocol. The WS handler dispatches to the store's `add()` method. The timeline rendering uses the store's `forJob()` method for keep-only filtering and `allForJob()` for the expander.

**The lightbox fallback is smart.** `@click="$store.lightbox && $store.lightbox.open ? $store.lightbox.open(ss.url, ss.description) : window.open(ss.url, '_blank')"` gracefully degrades when no lightbox store exists yet.

---

## Summary

Solid S1 delivery. The pipeline is well-structured, tested, and ready for S2 to plug in the DesktopBackend. The main items to address are the unused `ScreenshotIndex` interface (cleanup) and the sync/async mismatch (clarify intent). Neither blocks merge.
