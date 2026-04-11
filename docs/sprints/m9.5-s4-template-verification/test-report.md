# M9.5-S4: Test Report

## Test Suite Results

| Suite | Pass | Fail | Skip | Notes |
|-------|------|------|------|-------|
| Core capabilities (new) | 54 | 0 | 0 | Schema validation, functional screenshot, contract tests |
| Full repo | 1457 | 28 | 32 | 10 failing test files — all pre-existing (S3 desktop module path migration) |

**TypeScript:** Both `packages/core` and `packages/dashboard` compile clean (`tsc --noEmit`).

## New Tests Added (This Sprint)

| File | Tests | What it covers |
|------|-------|----------------|
| `core/tests/capabilities/schema-validation.test.ts` | 5 | Tool contract validation: required present, optional validated, missing detected |
| `core/tests/capabilities/functional-screenshot.test.ts` | 1 | MCP screenshot tool returns valid PNG via test fixture |

## Browser Verification

### Test 1: Build-from-scratch loop (Task 7)

1. Deleted desktop-x11 capability via `scripts/reset-capability.sh`
2. Restarted dashboard — registry confirmed 3 capabilities (no desktop-control)
3. Opened dashboard chat, told Nina "I want desktop control"
4. Nina activated capability-brainstorming skill, found template, presented build plan
5. Builder completed 18/19 steps (step 19 hit non-blocking path validation bug)
6. Enabled capability, restarted dashboard
7. **Result: PASS** — Desktop Control (X11) [healthy, 2.3s]

### Test 2: Acceptance test — Nina reads KWrite (Task 8)

1. Restored original desktop-x11 capability from backup
2. Restarted dashboard
3. Opened new conversation (clicked "New" button)
4. Asked: "What text is in the Kwrite window? Show me the screenshot."
5. Nina used `desktop_screenshot` MCP tool — saw VS Code, no KWrite visible
6. Nina checked taskbar, found KWrite minimized, clicked it
7. Nina took another screenshot, read all text from KWrite window
8. Presented text content in a code block with accurate summary
9. **Result: PASS** — Desktop tools working end-to-end in conversation

### Issues found during browser testing

1. **Factory→session wiring bug (FIXED):** Relative entrypoint paths failed silently because SDK doesn't pass `cwd` to child process. Fixed by resolving to absolute paths.
2. **`?new=1` URL doesn't create new conversations:** Dashboard reuses most recent conversation. Must click "New" button for truly fresh session.
3. **Session resume reuses old MCP server config:** Resumed sessions don't re-establish MCP servers. Only affects conversations that existed before the factory was registered.
4. **Shared MCP server concurrency error (PRE-EXISTING):** "Already connected to a transport" when system message injection runs concurrently with user message. Non-blocking — query recovers.
5. **Desktop screenshots not rendered inline (CTO PRIORITY):** Screenshots returned as base64 to brain but not displayed in chat UI. CTO wants VAS integration for in-conversation image rendering. Logged as D4.

## Capability Test Harness Results

```
Desktop Control (X11) [healthy, 2.0s]
- Environment check: PASS (xdotool, maim present)
- Schema validation: PASS (7/7 required tools, correct params)
- Functional screenshot: PASS (valid PNG returned)
```

## Pre-existing Failures (Not This Sprint)

10 test files fail with import errors referencing `packages/dashboard/src/desktop/` — these modules were moved to `.my_agent/capabilities/desktop-x11/` during M9.5-S3. The test files were not updated. Not in scope for this sprint.
