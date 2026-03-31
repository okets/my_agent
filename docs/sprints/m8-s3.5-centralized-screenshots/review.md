# M8-S3.5: Centralized Screenshot Storage — External Review

> **Reviewer:** External Review Agent
> **Date:** 2026-03-29
> **Branch:** `sprint/m8-s3.5-centralized-screenshots`
> **Commits:** 9
> **Verdict:** PASS (concerns fixed post-review)

---

## Summary

The sprint successfully replaces distributed per-context screenshot storage with a single centralized folder using ref-based lifecycle management. The core refactoring is clean, well-tested, and matches the design spec. All 853 tests pass, TypeScript compiles cleanly across both packages, and old types have been fully removed.

---

## Task Verification

### Task 1: Update Core Types — PASS

- `packages/core/src/visual/types.ts` matches spec exactly: `ScreenshotSource`, `ScreenshotMetadata`, `Screenshot` with `refs: string[]`
- `packages/core/src/lib.ts` exports new types, no old type names remain
- `packages/core/src/visual/index.ts` re-exports correctly

### Task 2: Rewrite VisualActionService — PASS

- Complete rewrite in `packages/dashboard/src/visual/visual-action-service.ts`
- Single folder: `{agentDir}/screenshots/`
- JSONL index is source of truth
- Full interface implemented: `store`, `get`, `addRef`, `removeRefs`, `listByRef`, `listUnreferenced`, `url`, `delete`, `cleanup`, `onScreenshot`
- `screenshot-tagger.ts` deleted, old test file deleted, v2 test file created
- 10 unit tests covering all methods

### Task 3: Simplify Asset Serving Route — PASS

- Single route: `/api/assets/screenshots/:filename`
- Path traversal protection via `isSafe()` check
- Reads from `{agentDir}/screenshots/{filename}`

### Task 4: Update ComputerUseService — PASS

- `AssetContext` removed from `ComputerUseTask`
- `ScreenshotTag` removed from `ComputerUseResult.screenshots`
- All `store()` calls use new API: `{ description, width, height, source: "desktop" }`
- No pixel diff imports, no tag logic, no `previousBuffer`
- Audit log no longer includes `screenshotTag`

### Task 5: Update PlaywrightScreenshotBridge — PASS

- `StoreOptions` interface simplified (no context)
- `storeFromBase64` uses `source: "playwright"`
- MCP tool no longer passes hardcoded context
- No `AssetContext` imports remain

### Task 6: Wire Ref Management — PASS WITH CONCERN

**Implemented:**
- Conversation turn append: scans for screenshot URLs via regex, calls `addRef(screenshotId, "conv/{conversationId}")` (app.ts:424-433)
- Conversation deletion: calls `removeRefs("conv/{id}")` (app.ts:142)
- Automation deletion: calls `removeRefs("job/{id}")` (app.ts:1029)

**Missing: Job completion ref wiring.** The plan (Task 6, Step 5) specified scanning job deliverables for screenshot URLs and adding `job/{automationId}/{jobId}` refs on job completion. This was NOT implemented. See [Concern #1](#concern-1-missing-job-completion-ref-wiring) below.

### Task 7: DB Table — DEFERRED (as planned)

Correctly deferred. JSONL-only approach is consistent with the plan rationale.

### Task 8: Update Frontend + WebSocket Protocol — PASS

- `ScreenshotSnapshot` in `protocol.ts` uses `source` + `refs` (no `contextType`/`tag`)
- `StatePublisher.publishScreenshot` accepts new shape
- `onScreenshot` listener in app.ts broadcasts new shape
- Frontend Alpine store filters by `refs` using `r.includes(jobId)` and `r.startsWith("conv/" + conversationId)`

### Task 9: Ref Lifecycle Tests — PASS

- 3 lifecycle tests: automation deletion, one-off, cross-ref survival
- All pass

### Task 10: Update App Wiring — PASS

- VAS instantiation: `new VisualActionService(agentDir)` — unchanged constructor signature
- PlaywrightBridge: `new PlaywrightScreenshotBridge(app.visualActionService)` — works
- ComputerUseService: `new ComputerUseService(client, backend, app.visualActionService)` — works
- Desktop server: `visualService: app.visualActionService` — uses new context-free `store()`

### Task 11: Full Test Suite Verification — PASS

853 passed, 0 failed, 8 skipped (live tests).

---

## Success Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Single screenshot folder: `.my_agent/screenshots/` | PASS |
| 2 | Single JSONL index as source of truth | PASS |
| 3 | `screenshots` table in `agent.db` | N/A (deferred) |
| 4 | Producers store without context | PASS |
| 5 | Refs added when screenshots become visible | PARTIAL — conversation turns yes, job completion no |
| 6 | Refs removed on context deletion | PASS |
| 7 | Unreferenced screenshots expire after 7 days | PASS |
| 8 | Referenced screenshots live as long as any ref exists | PASS |
| 9 | Cross-referenced screenshots survive partial ref removal | PASS |
| 10 | Single asset route `/api/assets/screenshots/:filename` | PASS |
| 11 | No pixel diff, no tags, no `ScreenshotTag` | PASS |
| 12 | No `AssetContext` type anywhere | PASS |
| 13 | `ScreenshotSnapshot` uses `source` + `refs` | PASS |
| 14 | Frontend queries by ref prefix | PASS |
| 15 | All existing tests pass | PASS |
| 16 | `tsc --noEmit` clean | PASS |
| 17 | Dashboard starts and serves screenshots | Not verified (service not restarted during review) |

---

## Concerns

### ~~Concern #1: Missing Job Completion Ref Wiring~~ — FIXED

**FIXED** in commit `a142e17`. Job completion (`job:completed` / `job:needs_review`) now scans `job.summary` for screenshot URLs and adds `job/{automationId}/{jobId}` refs via `onJobEvent` callback in App.

### ~~Concern #2: Frontend `forJob` Uses `includes()` Instead of `startsWith()`~~ — FIXED

**FIXED** in commit `a142e17`. Changed `forJob` and `allForJob` from `r.includes(jobId)` to `r.endsWith("/" + jobId)` for consistent matching.

---

## Gap Analysis

### Spec Requirements Coverage

| Spec Requirement | Implemented |
|-----------------|-------------|
| Central folder | Yes |
| JSONL index | Yes |
| DB table (derived) | Deferred (acceptable) |
| Producers are dumb (no context) | Yes |
| Refs added on transcript write | Yes |
| Refs added on job completion | **No** |
| Refs removed on conversation delete | Yes |
| Refs removed on automation delete | Yes |
| Refs removed on job run_dir cleanup | Not applicable (run_dir cleanup not in scope) |
| Unreferenced 7-day expiry | Yes |
| Single serving route | Yes |

### Security

- Path traversal protection in asset route: adequate (`isSafe()` rejects `..`, `/`, `\`)
- No new authentication gaps (route uses existing Fastify middleware)

### Edge Cases

- Concurrent writes to JSONL: VAS reads/writes synchronously, safe for single-process use. Could be a concern if multiple processes access the same agent dir simultaneously, but that is not the current architecture.
- Empty index file: handled correctly (returns `[]`)
- Missing screenshot file on delete/cleanup: handled with try/catch

---

## Verdict: PASS WITH CONCERNS

The sprint achieves its primary goal: centralized screenshot storage with ref-based lifecycle. The implementation is clean, well-tested, and the refactoring is thorough (no old types remain). Both review concerns were fixed post-review (commit `a142e17`). 853 tests pass, TypeScript clean.
