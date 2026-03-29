# External Verification Report

**Sprint:** M8-S3 Playwright Integration
**Reviewer:** External Opus (independent)
**Date:** 2026-03-29

---

## Spec Coverage

The design spec (`docs/superpowers/specs/2026-03-29-m8-desktop-automation-design.md`) defines S3 scope as:

> Wire Playwright screenshots into VisualActionService, surface browser automation screenshots in timeline/chat, unified visual audit trail

| Spec Requirement | Status | Evidence |
|---|---|---|
| Wire Playwright screenshots into VisualActionService | PASS | `PlaywrightScreenshotBridge.storeFromBase64()` calls `vas.store()` — verified in code and tests |
| Surface browser screenshots in timeline | PASS | VAS `store()` writes to screenshots.jsonl + publishes StatePublisher event (inherited from S1) |
| Unified visual audit trail | PASS | Playwright screenshots use same VAS pipeline as desktop screenshots |
| Hatching + settings for dependency management | PASS | Step 8 in hatching prompt, `get_playwright_status` tool, Settings UI panel |
| Graceful degradation | PASS | If package not installed, hatching skips; settings shows "Package not available" |

## Plan Task Verification

### Task 1: Playwright Status Detection

| Item | Status | Notes |
|---|---|---|
| `playwright-status.ts` created | PASS | Matches plan spec exactly |
| `detectPlaywrightStatus()` returns correct interface | PASS | `PlaywrightStatus` with installed, ready, browsers, setupNeeded, enabled |
| Browser cache directory check (`~/.cache/ms-playwright/`) | PASS | Checks for `chromium-` and `firefox-` prefixed dirs |
| `installPlaywrightBrowsers()` uses async `spawn` | PASS | Does not block event loop; 5-min timeout |
| Test file created with 5 tests | PASS | 5 tests (3 from plan + 2 extra: enabled passthrough, ready logic) |
| **Deviation:** Uses `createRequire(import.meta.url)` instead of raw `require` | ACCEPTABLE | ESM compatibility fix; plan used CommonJS `require` |
| **Deviation:** Uses `node:` prefixed imports | ACCEPTABLE | Modern Node.js convention |

### Task 2: Playwright API Routes

| Item | Status | Notes |
|---|---|---|
| `playwright-routes.ts` created | PASS | 3 endpoints: GET status, POST toggle, POST install |
| Toggle uses `.playwright-disabled` flag file | PASS | Enabled by default; file presence = disabled |
| Registered in `server.ts` | PASS | Line 267: `await registerPlaywrightRoutes(fastify)` |
| **Deviation:** Uses `fs/promises` (writeFile, unlink) instead of sync fs | ACCEPTABLE | Better for async route handlers |
| **Deviation:** Toggle writes ISO timestamp instead of empty string | ACCEPTABLE | More informative; no functional difference |
| ~~**Missing:** Route test file~~ | **FIXED** | Added post-review: 7 tests (status, toggle persistence, install). Commit `6bda8e5`. |

### Task 3: Playwright Screenshot Bridge

| Item | Status | Notes |
|---|---|---|
| `playwright-screenshot-bridge.ts` created | PASS | `PlaywrightScreenshotBridge` class with `storeFromBase64()` and `createMcpServer()` |
| `storeFromBase64()` calls VAS `store()` | PASS | Verified in code and tests |
| Default tag is `keep` | PASS | Matches spec (conversation screenshots always kept) |
| `browser_screenshot_and_store` MCP tool defined | PASS | Uses Playwright Node API directly, stores via VAS, returns base64 image |
| Test file with 6 tests | PASS | 3 from plan + 3 extra (default description, default dimensions, custom tag) |
| MCP server created via `createSdkMcpServer()` | PASS | Named "playwright-screenshot" |

### Task 4: Wire Bridge MCP Server into App

| Item | Status | Notes |
|---|---|---|
| Import added to `app.ts` | PASS | Line 100 |
| `playwrightBridge` property on App class | PASS | Line 365, typed `PlaywrightScreenshotBridge \| null` |
| MCP server registered via `addMcpServer()` | PASS | Lines 1181-1183, after VAS initialization |
| Console log on registration | PASS | "[App] Playwright screenshot bridge MCP server registered" |

### Task 5: Hatching Step

| Item | Status | Notes |
|---|---|---|
| `get_playwright_status` tool added to hatching-tools.ts | PASS | Lines 242-262, matches plan spec |
| Import of `detectPlaywrightStatus` added | PASS | Line 21 |
| Tool added to MCP server tools array | PASS | Line 370 |
| Tool added to `allowedTools` array | PASS | Line 391: `"mcp__hatching-tools__get_playwright_status"` |
| Step 8 added to hatching prompt | PASS | Lines 12-17, covers ready/installed/not-installed branches |

### Task 6: Settings UI

| Item | Status | Notes |
|---|---|---|
| Browser Automation panel added to index.html | PASS | Lines 3012-3109, glass-strong panel |
| Status indicator (Ready/Disabled/Not installed/Not available) | PASS | 4 states covered with correct colors |
| Browser list with checkmarks | PASS | Grid of browser names with installed status |
| Toggle switch (when ready) | PASS | Checkbox-based toggle calling `/api/debug/playwright-toggle` |
| Install button (when browsers missing) | PASS | Calls `/api/debug/playwright-install`, refreshes status |
| Design language compliance | PASS | glass-strong panel, emerald/amber/violet colors, Tokyo Night palette |

### Task 7: Full Test Suite Verification

| Item | Status | Notes |
|---|---|---|
| All dashboard tests pass | PASS | 855 passed, 0 failed, 8 skipped (3 live-only files) |
| TypeScript dashboard compiles | PASS | `npx tsc --noEmit` clean |
| TypeScript core compiles | PASS | `npx tsc --noEmit` clean |
| Dashboard starts and serves | PASS | systemd service active, API responding |

## Success Criteria Verification

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Playwright status detection identifies installed/missing browsers | PASS | API returns `browsers: [{name:"Chromium",installed:true},{name:"Firefox",installed:false}]` |
| 2 | Async browser install (does not block event loop) | PASS | Uses `child_process.spawn` with pipe stdio, Promise-based |
| 3 | Toggle state persisted to `.playwright-disabled` file | PASS | File created at `.my_agent/.playwright-disabled` on disable, removed on enable. Verified across toggle cycle. |
| 4 | Hatching step guides users through browser installation | PASS | Step 8 in prompt with 3 branches (ready/needs-install/skip) |
| 5 | Hatching tool added to allowedTools array | PASS | `"mcp__hatching-tools__get_playwright_status"` in allowedTools |
| 6 | Settings UI shows status, toggle, and install button | PASS | All elements present in index.html; API endpoints verified via curl |
| 7 | Playwright MCP stays always-registered | PASS | No changes to session-manager.ts; bridge MCP is additive |
| 8 | `browser_screenshot_and_store` MCP tool stores via VAS | PASS | Code calls `bridge.storeFromBase64()` which calls `vas.store()` |
| 9 | Screenshots from bridge appear in dashboard timeline | PASS | VAS `store()` writes to screenshots.jsonl; StatePublisher event fires (S1 infrastructure) |
| 10 | Retention/tagging from S1 applies | PASS | Default tag is `keep`; custom tags supported. Same VAS pipeline. |
| 11 | All existing tests still pass | PASS | 855 passed, 0 failed |

## Browser Verification

**Status:** PARTIALLY BLOCKED

Playwright MCP could not launch Chrome (existing session conflict on this desktop). Verification done via:

1. **curl API verification:** All 3 endpoints respond correctly
   - `GET /api/debug/playwright-status` returns full status object
   - `POST /api/debug/playwright-toggle` toggles enabled state, persisted to file
   - `POST /api/debug/playwright-install` endpoint exists (not exercised — Chromium already installed)
2. **Dashboard service:** Running after restart, serving on port 4321
3. **HTML inspection:** Settings panel HTML verified in source (lines 3012-3109)
4. **Toggle persistence:** Verified flag file creation/deletion cycle at `.my_agent/.playwright-disabled`

**Not verified (requires manual browser):** Visual rendering of Settings panel in actual browser.

## Gaps Found

### Minor

1. ~~**Missing route test file.**~~ **FIXED** — `tests/unit/routes/playwright-routes.test.ts` added post-review (7 tests, all passing). Commit `6bda8e5`.

2. **Plan header typo.** Review finding I2 says `.playwright-enabled` but implementation correctly uses `.playwright-disabled` (inverted — enabled by default). The plan's actual Task 2 code uses `.playwright-disabled`, so only the summary line is wrong.

3. **`browser_screenshot_and_store` hardcodes conversation context.** The MCP tool uses `{ type: "conversation", id: "active" }` as the asset context. If the brain calls this tool during a job/automation, the screenshot would be filed under conversations rather than the job. This is acceptable for S3 scope (S4 Rich I/O may address context propagation).

4. **MCP tool launches a new browser per screenshot.** Each `browser_screenshot_and_store` call does `chromium.launch()` + `browser.close()`. For frequent use this is expensive. Acceptable for S3 MVP; browser pooling could be a future optimization.

### Not a Gap (Explicitly Deferred)

- Chat-inline rendering of screenshots — deferred to S4 (Rich I/O), documented in plan
- Firefox not installed on this machine — not a code issue, just environment state

## Verdict

**PASS**

All 11 success criteria met. All 7 plan tasks implemented correctly. Code matches plan with only acceptable deviations (ESM imports, async fs, extra tests). Test suite green (862/862 after route test fix). TypeScript clean. API endpoints verified. Minor gap (route test file) fixed post-review.
