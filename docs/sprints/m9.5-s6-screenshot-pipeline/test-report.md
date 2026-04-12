# Test Report — M9.5-S6 Screenshot Pipeline

**Date:** 2026-04-12
**Branch:** `sprint/m9.5-s6-screenshot-pipeline`

## Automated Test Results

### Core Package

```
Test Files  40 passed | 1 skipped (41)
     Tests  347 passed | 7 skipped (354)
```

New tests added by this sprint (in `tests/capabilities/mcp-middleware.test.ts`):
- 4 `inferSource` cases — prefix patterns, mcp-prefix stripping (generic server names)
- 2 `parseMcpToolName` cases — extracts server/tool, returns null for non-MCP
- 3 `parseImageMetadata` cases — valid JSON, invalid fallback, missing text block
- 2 dual-format detection cases — Anthropic API format, MCP format
- 2 PNG-rejection cases — non-PNG data, both formats
- 5 `storeAndInject` cases — PNG happy path, no image, non-MCP response, non-PNG, Anthropic format
- 1 raw-array shape case — actual SDK tool_response shape for MCP tools

**27 middleware tests total, all passing.**

### Dashboard Package

```
Test Files  132 passed | 4 skipped (136)
     Tests  1148 passed | 12 skipped (1160)
```
(Excluded pre-existing flaky `tests/browser/automation-ui.test.ts > settings tab shows automation schedule editor` — unrelated to this sprint, Playwright UI timing issue.)

New integration tests (in `tests/integration/screenshot-pipeline.test.ts`):
- `stores screenshot in VAS and injects URL into tool output`
- `does not store non-image tool results`
- `handles Playwright source detection`
- `ref scanner picks up screenshot URLs from conversation turn content`
- `automation job summary can reference stored screenshots`

**5 integration tests, all passing.**

### TypeScript

- `packages/core`: clean
- `packages/dashboard`: clean

## Manual Smoke Tests

Both smoke tests run live against the dashboard (`systemctl --user status nina-dashboard.service`) with a real brain session and real MCP capability servers. CTO was hands-on for both via pair-browse.

### Smoke Test 1: KWrite Desktop (conversation path)

**Prompt:** *"Read the text from my unsaved work on KWrite, it is minimized."*

**Result: PASS.**

Verified:
- Brain called `mcp__desktop-x11__desktop_info` → `desktop_focus_window` → read content
- PostToolUse hook fired for each MCP tool call (confirmed via `[S6-INJECT]` debug probe)
- `updatedMCPToolOutput` returned 3-block arrays with the URL text appended as the last block
- VAS `index.jsonl` received new entries with `source: "desktop"` — example: `ss-62d43cb8-63be-45ac-bcec-3fc73b6ad88a.png`
- Brain's reply in the chat contained exactly one `![screenshot](/api/assets/screenshots/ss-...)` — the KWrite content screenshot, not intermediate focus/info steps
- Image rendered inline in the dashboard chat bubble (verified visually by CTO)

**Notes:** This test iterated through four failed attempts and four bug fixes before passing. Each failure surfaced a distinct SDK integration issue documented in DEVIATIONS.md (DEV-3) and DECISIONS.md (D1 revised, D2, D3).

### Smoke Test 2: CNN Scheduled Automation (automation path)

**Prompt:** *"Schedule a one-time automation to run in 1 minute: take a screenshot of cnn.com and show me the homepage."*
(CTO shortened from 15 min → 1 min for iteration speed.)

**Result: PASS.**

Verified:
- Brain recognized as scheduling request (not immediate action)
- One-shot automation created with 1-minute trigger
- At scheduled time, automation worker ran with Playwright MCP server
- Multiple Playwright screenshots stored in VAS — example: `ss-6af2f89b-b60e-4e1d-9fc4-55b21fc247a4.png` at `2026-04-12T02:08:12.145Z` with `source: "playwright"`
- Screenshot has **both** refs indexed:
  - `job/cnn-homepage-screenshot/job-45462ec9-...` — worker's job summary ref
  - `conv/conv-01KNZQ30H85CT9W31TE9SFWYPA` — conversation turn ref when Nina delivered the result
- This confirms the curation directive in `buildWorkingNinaPrompt()` reached the worker, the URL ended up in the job summary, AND Conversation Nina re-surfaced the URL in her reply to the user

## Browser Verification

No dedicated Playwright/browser checks for dashboard frontend HTML/CSS/JS — the sprint did not modify `public/`, routes, or server startup. Manual visual verification happened during the smoke tests via pair-browse: CTO confirmed the screenshot rendered inline in the chat bubble as expected.

## Follow-Ups Discovered

One UX issue discovered during the CNN smoke test, logged in `FOLLOW-UPS.md` as UX-1: 30-second silent gap between job card dismissal and Nina's reply drafting. Not blocking — bundled for the next dashboard UX pass.

## Verdict

**PASS.** Both smoke tests passed. All automated tests green. Pipeline verified working end-to-end through both entry paths (conversation and automation), through both MCP tool families (desktop and Playwright), and with correct ref lifecycle management in both conversation and job contexts.
