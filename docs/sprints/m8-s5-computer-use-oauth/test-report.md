# Test Report: M8-S5 Computer Use OAuth Fix

> **Date:** 2026-04-02
> **Tester:** Claude Opus 4.6 (browser-verified)

## Test Results

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | TypeScript compiles | PASS | `npx tsc --noEmit` clean |
| 2 | Dashboard starts with OAuth only | PASS | `ComputerUseService initialized (auth: oauth)` |
| 3 | `/api/debug/desktop-status` reports available | PASS | `computerUseAvailable: true` |
| 4 | Raw API rejects OAuth | CONFIRMED | `401: OAuth authentication is currently not supported` |
| 5 | `desktop_task` called via dashboard chat | PASS | Audit log shows tool call |
| 6 | Agent SDK session runs | PASS | Screenshots captured (2 per task) |
| 7 | Screenshots stored in VAS | PASS | ~460-690KB PNGs in `.my_agent/screenshots/` |
| 8 | Screenshot displays inline in chat | PASS | Markdown image rendered via DOMPurify |
| 9 | Nina reads unsaved changes from screenshot | PASS | Identified "The unsaved thing is Here" text |
| 10 | Settings UI shows "Computer Use API connected" | PASS | Browser screenshot verified |

## Browser Verification

- Opened dashboard at `http://100.71.154.24:4321`
- New chat → asked Nina to screenshot VS Code ROADMAP.md
- Nina responded "On it." → called desktop_task → screenshot displayed inline
- Nina correctly identified unsaved changes in the editor

## Environment

- Platform: OVH VPS, Ubuntu 25.10
- Display: XRDP `:10`, 1648x883
- Auth: `CLAUDE_CODE_OAUTH_TOKEN` only (no API key)
- Agent SDK: `@anthropic-ai/claude-agent-sdk`
