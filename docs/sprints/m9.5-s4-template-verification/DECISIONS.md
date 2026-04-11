# M9.5-S4: Decisions Log

## D1: Build-from-scratch loop results

**Date:** 2026-04-11
**Task:** Task 7 — Agent builds capability from template

### Flow

1. Deleted existing desktop-x11 capability via `scripts/reset-capability.sh`
2. Restarted dashboard — registry confirmed 3 capabilities (no desktop-control)
3. Opened dashboard chat, sent "I want desktop control"
4. Nina initially thought she still had it (memory confusion — see D2)
5. Corrected Nina, she activated capability-brainstorming skill
6. Brainstorming skill found `skills/capability-templates/desktop-control.md`, presented build plan
7. Confirmed, Nina spawned capability-builder automation
8. Builder completed 18/19 steps — hit a CAPABILITY.md path validation bug (step 19)
9. Nina force-accepted, verified detect.sh and server smoke test manually
10. Enabled capability, restarted dashboard
11. **Test harness passed: Desktop Control (X11) [healthy, 2.3s]**

### Iterations needed: 1

The builder produced a working capability on the first try. The template was sufficiently prescriptive.

### Issues found

1. **Validator path bug** — builder's step 19 couldn't find CAPABILITY.md despite it existing. Likely a working directory mismatch in the validation step. Non-blocking — the file was correct.
2. **No `.enabled` file created** — builder didn't write the `.enabled` file. Had to be created manually. The template should mention this, or the builder flow should auto-enable on first build.

### Template adequacy

Nina's assessment: "No real design decisions to make — the template is prescriptive down to the file structure, tool schemas, and test contract. The only variable was which platform, and that's X11."

This confirms the template provides enough detail for single-shot reliable builds.

## D2: Nina's memory confused capability state

When the capability was deleted but Nina's memory still recalled having desktop tools, she responded "That's already available" instead of activating the brainstorming skill.

**Root cause:** The system prompt lists available capabilities but doesn't explicitly say what's NOT available. Nina's memory fills in the gap incorrectly.

**Potential fix for future:** Add negative capability hints to the system prompt (e.g., "Desktop control: not installed — use brainstorming skill if requested"). Low priority — this only matters for rebuild testing, not normal user flows.

## D3: Factory→session wiring bug (resolved)

**Date:** 2026-04-11
**Task:** Task 8 — Acceptance test

### Problem

Desktop MCP tools were not available in chat sessions despite the factory being registered. Nina fell back to xdotool/dbus workarounds instead of using her MCP tools.

### Root cause

The factory returned `{ command: 'npx', args: ['tsx', 'src/server.ts'], cwd: desktopCap.path }`. The SDK's `McpStdioServerConfig` type doesn't include `cwd` — the SDK spawns the child process without setting the working directory. So `npx tsx src/server.ts` ran from the agent directory (`.my_agent/`) and couldn't find `src/server.ts`.

### Fix

Resolve relative paths in entrypoint args to absolute paths before passing to the factory:
```typescript
const resolvedArgs = entrypointParts.slice(1).map((arg) =>
  arg.startsWith('.') || (!arg.startsWith('/') && arg.includes('/'))
    ? join(desktopCap.path, arg)
    : arg,
)
```

Result: `npx tsx /home/nina/.../desktop-x11/src/server.ts` — works regardless of cwd.

### Secondary issue

A pre-existing concurrency bug: shared MCP server instances (memory, skills, etc.) throw "Already connected to a transport" when a system message injection runs concurrently with a user message. Non-blocking — the query recovers, but the error is logged. Not in scope for this sprint.

## D4: Desktop screenshots should render inline in conversation (CTO PRIORITY)

**Date:** 2026-04-11
**Flagged by:** CTO

### Issue

When Nina takes a desktop screenshot via `desktop_screenshot`, the base64 image data is returned to the brain via MCP but is NOT displayed to the user in the conversation UI. Nina describes what she sees in text instead.

### CTO direction

> "The visual enhancement skill already should show images from jobs automatically. This is a classic one to use in-conversation. The user will see the desktop as Nina works. This will be awesome. A picture is worth a 1000 words."

### What's needed

1. The `desktop_screenshot` tool returns `{ type: 'image', data: base64, mimeType: 'image/png' }` — the data is already there
2. The Visual Action Service (VAS) and visual enhancement skill already handle image rendering for automation jobs
3. Desktop screenshots taken in conversation should use the same pipeline — store via VAS, render inline in the chat bubble
4. This turns desktop control from a text-described capability into a visual, interactive experience

### Priority

CTO-flagged. Should be addressed in the next sprint touching desktop or conversation rendering.
