# Agent SDK Computer Use — Design Spec

> **Goal:** Route desktop computer use through the Agent SDK instead of the raw Anthropic API, enabling Max subscription (OAuth) support.
> **Date:** 2026-04-02
> **Sprint:** M8-S5 (correction sprint, blocks M9)
> **Issue:** [#1](https://github.com/Nina-VanKhan/my_agent/issues/1)

---

## Problem

`ComputerUseService` (M8-S2) uses `client.beta.messages.create()` with the `computer_20251124` beta tool. This requires a prepaid API key (`ANTHROPIC_API_KEY`). On a Max subscription, only `CLAUDE_CODE_OAUTH_TOKEN` is available. The raw Messages API rejects OAuth tokens (`401: OAuth authentication is currently not supported`).

**Impact:** Desktop computer use (desktop_task, screenshots, GUI interaction) is unavailable on Max plan setups.

## Constraint

**All Claude API calls must go through the Agent SDK.** The raw Anthropic SDK (`new Anthropic()`) must never be used directly. The Agent SDK handles OAuth internally.

---

## Solution

Replace `ComputerUseService` with `AgentComputerUseService`. Same external interface (`run(task): Promise<ComputerUseResult>`), different internals: Agent SDK `query()` with custom MCP tools instead of raw API.

### Architecture

```
Working Nina (Agent SDK session)
  |
  calls MCP tool: desktop_task("open VS Code and screenshot roadmap.md")
  |
  AgentComputerUseService.run(task):
    1. Build MCP server with low-level desktop tools
    2. Call Agent SDK query() with:
       - Computer-use system prompt
       - MCP tools: screenshot, click, type, key_press, scroll, wait
       - model: claude-sonnet-4-6 (configurable)
       - maxTurns: derived from maxActions
       - permissionMode: bypassPermissions (safety handled by outer MCP layer)
    3. Each tool call:
       - Executes action via X11Backend
       - Takes screenshot via X11Backend
       - Stores screenshot via VisualActionService
       - Returns screenshot as base64 image in tool result
    4. Agent SDK runs the loop until Claude stops calling tools
    5. Extract final text + screenshot list
    6. Return ComputerUseResult to desktop_task handler
```

### MCP Tools

Six tools exposed to the computer-use agent session:

| Tool | Parameters | Action |
|------|-----------|--------|
| `screenshot` | none | Take full-screen screenshot, return as image |
| `click` | `x`, `y`, `button?` (`left`/`right`/`middle`), `double?` | Click at coordinates |
| `type_text` | `text` | Type text string |
| `key_press` | `key` | Press key combo (e.g., `ctrl+s`, `Return`) |
| `scroll` | `x`, `y`, `direction` (`up`/`down`/`left`/`right`), `amount?` | Scroll at position |
| `wait` | `seconds` | Wait for UI to settle |

Each tool (except `wait`) returns a screenshot as an image content block after execution. This gives Claude visual feedback on every action.

**Not included:** `mouse_move`, `drag` — these are rarely needed for typical desktop tasks. Can be added later.

### System Prompt

```
You are controlling a Linux desktop to complete the user's task.

After each action, you receive a screenshot showing the current state.
Use the screenshot to decide your next action.

Available tools:
- screenshot: See the current screen state
- click(x, y): Click at pixel coordinates. Use button="right" for context menus.
- type_text(text): Type text at the current cursor position
- key_press(key): Press a key or combo (e.g., "ctrl+c", "Return", "alt+Tab")
- scroll(x, y, direction, amount): Scroll at a position
- wait(seconds): Wait for animations or loading

Guidelines:
- Start by taking a screenshot to see the current state
- Use coordinates from the most recent screenshot
- After clicking, wait for the UI to respond before taking the next action
- When the task is complete, describe what you accomplished
```

### Model Selection

- **Default:** `claude-sonnet-4-6` — fast, cost-effective for GUI interaction
- **Override:** via `task.model` parameter (passed through from `desktop_task` MCP tool)
- **No Opus default** — the outer Working Nina session already uses Opus for orchestration

### Scale Factor

The existing `ComputerUseService.computeScaleFactor()` logic is preserved. Screenshots are scaled to fit API constraints (max 1568px long edge, ~1.15 megapixels). The scale factor is applied:
- Before returning screenshots (scale down)
- After receiving coordinates from Claude (scale up to screen coordinates)

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| `computer-use-service.ts` | Raw `Anthropic` client, `client.beta.messages.create()` loop | Agent SDK `query()` with MCP tools |
| Auth | `ANTHROPIC_API_KEY` required | Works with `CLAUDE_CODE_OAUTH_TOKEN` (Agent SDK handles) |
| Computer use tool | `computer_20251124` beta | Custom MCP tools (click, type, screenshot, etc.) |
| Loop control | Manual while loop with action counting | Agent SDK `maxTurns` |
| `app.ts` init | `new Anthropic({ apiKey })` gated on API key | No API key needed; backend + VAS sufficient |

### What Stays the Same

| Component | Why |
|-----------|-----|
| `desktop-server.ts` | MCP tool handlers unchanged — same `ComputerUseService` interface |
| `DesktopBackend` / `X11Backend` | Unchanged — still executes all actions |
| `VisualActionService` | Unchanged — still stores all screenshots |
| Safety hooks, rate limiter, audit logger | Unchanged — fire on `desktop_task` MCP call |
| `desktop-capability-detector.ts` | Unchanged |
| Settings UI | Unchanged — shows same capabilities |
| All existing tests for MCP handlers | Unchanged — mock the service interface |

### Risk

| Risk | Severity | Mitigation |
|------|----------|------------|
| No `computer_20251124` fine-tuning | Medium | Good system prompt + Sonnet vision is strong. Fallback: bump to Opus. |
| Agent SDK subprocess overhead | Low | One subprocess per desktop_task. Tasks are infrequent (seconds between calls). |
| MCP image passthrough | Low | Already verified: `desktop_screenshot` returns images through MCP today. |

---

## Files

### New
| File | Purpose |
|------|---------|
| `packages/dashboard/src/desktop/agent-computer-use-service.ts` | New service implementation |

### Modified
| File | Change |
|------|--------|
| `packages/dashboard/src/app.ts` | Remove raw Anthropic client init, create AgentComputerUseService with backend + VAS |

### Deleted
| File | Reason |
|------|--------|
| None | `computer-use-service.ts` kept for reference; not imported |

---

## Verification

Sprint is complete when this works end-to-end:
1. Open dashboard in browser
2. Send chat message: "Nina, take a screenshot of the roadmap.md file in VS Code"
3. Nina calls `desktop_task` → `AgentComputerUseService` runs → screenshots captured
4. Nina responds with description of what she saw

No API key required. OAuth only.

---

*Spec written: 2026-04-02*
