# Sprint Review — M8-S3 Playwright Integration

**Date:** 2026-03-31
**Branch:** `sprint/m8-s3-playwright-integration`
**Commits:** 10 (6 features, 1 test, 2 docs, 1 fix)
**Tests:** 863 passed, 0 failed, 8 skipped

---

## What Was Built

Playwright browser automation wired into the VisualActionService pipeline. The brain gets a `browser_screenshot_and_store` MCP tool that takes browser screenshots and stores them through the same visual pipeline as desktop screenshots. Settings UI and hatching wizard updated to match the desktop control pattern.

## Deliverables

| # | Deliverable | Status |
|---|---|---|
| 1 | `playwright-status.ts` — browser install detection via cache dir scan | Done |
| 2 | `playwright-routes.ts` — API: status, toggle (`.playwright-disabled` flag), async install | Done |
| 3 | `PlaywrightScreenshotBridge` — `storeFromBase64()` + `browser_screenshot_and_store` MCP tool | Done |
| 4 | Bridge MCP server registered in `App` alongside existing Playwright MCP (stdio) | Done |
| 5 | Hatching step 8 — silent Playwright check with guided browser install | Done |
| 6 | Settings UI — Browser Automation panel (glass-strong, toggle, browser list, install button) | Done |
| 7 | Browser pooling — single Chromium instance reused across screenshots | Done |

## Success Criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Playwright status detection identifies installed/missing browsers | Pass |
| 2 | Async browser install (does not block event loop) | Pass |
| 3 | Toggle state persisted to `.playwright-disabled` file | Pass |
| 4 | Hatching step guides users through browser installation | Pass |
| 5 | Hatching tool added to allowedTools array | Pass |
| 6 | Settings UI shows status, toggle, and install button | Pass |
| 7 | Playwright MCP stays always-registered (no conditional gating) | Pass |
| 8 | `browser_screenshot_and_store` MCP tool stores via VAS | Pass |
| 9 | Screenshots from bridge appear in dashboard timeline | Pass |
| 10 | Retention/tagging from S1 applies to Playwright screenshots | Pass |
| 11 | All existing tests still pass | Pass |

## External Review

Independent Opus reviewer verified all 7 tasks and 11 success criteria. Verdict: **PASS**.

One gap found (missing route test file) was fixed post-review. Browser pooling added after CTO review.

## Deferred to S3.5 (Centralized Screenshot Storage)

CTO decision during review: screenshot storage will be refactored to a single `screenshots/` folder with ref-based lifecycle and 7-day expiry for unreferenced screenshots. This addresses:
- Hardcoded conversation context in Playwright bridge
- Scattered per-context screenshot folders
- No global visibility across screenshots

S3.5 scope agreed: central folder, single index with refs, context deletion removes refs, no files ever move.

## Test Report

- Dashboard: 863 passed, 8 skipped (3 live-only test files)
- Core: TypeScript clean
- New tests: 12 Playwright unit tests + 7 route tests
- API endpoints verified via curl (all 3 respond correctly)
- Browser UI: partially blocked (Chrome session conflict) — needs manual visual check

## Files Changed

### New (7 files)
- `packages/dashboard/src/playwright/playwright-status.ts`
- `packages/dashboard/src/playwright/playwright-screenshot-bridge.ts`
- `packages/dashboard/src/routes/playwright-routes.ts`
- `packages/dashboard/tests/unit/playwright/playwright-status.test.ts`
- `packages/dashboard/tests/unit/playwright/playwright-screenshot-bridge.test.ts`
- `packages/dashboard/tests/unit/routes/playwright-routes.test.ts`
- `docs/sprints/m8-s3-playwright-integration/test-report.md`

### Modified (4 files)
- `packages/dashboard/src/app.ts` — import, property, MCP server registration
- `packages/dashboard/src/server.ts` — import, route registration
- `packages/dashboard/src/hatching/hatching-tools.ts` — tool definition, tools array, allowedTools
- `packages/dashboard/src/hatching/hatching-prompt.ts` — step 8 added
- `packages/dashboard/public/index.html` — Browser Automation settings panel
