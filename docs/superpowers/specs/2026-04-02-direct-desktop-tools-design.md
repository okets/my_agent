# M8-S5.1: Direct Desktop Tools — Design Spec

> **Goal:** Promote desktop action tools to direct MCP tools on both Ninas, matching the Playwright pattern. Remove the subagent intermediary.
> **Date:** 2026-04-02
> **Sprint:** M8-S5.1 (course correction on M8-S5)
> **Prerequisite:** M8-S5 (Agent SDK computer use — established the 6 MCP tool definitions)

---

## Context

M8-S5 replaced the raw Anthropic API with an Agent SDK subagent (`AgentComputerUseService`). This works but spawns a hidden subprocess with no paper trail. The debate concluded:

- Desktop tools should be direct MCP tools — like Playwright's `browser_click`, `browser_navigate`, etc.
- Both Conversation Nina and Working Nina get them via the shared MCP server pool
- No subagent, no subprocess, no intermediary
- Nina sees the screen and acts, turn by turn
- Audit via PostToolUse hooks (unified across both Ninas)
- Skill guides delegation: quick checks in conversation, multi-step workflows as Working Nina jobs

**Precedent:** Playwright MCP server is registered as a stdio transport on the shared pool. Both Ninas use `browser_navigate`, `browser_click`, `browser_snapshot` directly. Desktop tools follow the same pattern.

---

## Architecture

### Before (M8-S5)

```
Brain calls desktop_task MCP tool
  → handleDesktopTask spawns AgentComputerUseService
    → Agent SDK query() spawns Sonnet subprocess
      → Subprocess has 6 MCP tools (click, type, screenshot, etc.)
      → Sonnet runs screenshot→action loop
    → Returns result + last screenshot to brain
```

### After (M8-S5.1)

```
Brain calls desktop_click / desktop_type / desktop_screenshot directly
  → MCP tool handler executes via X11Backend
  → Takes screenshot, stores in VAS
  → Returns screenshot image + URL to brain
  → Brain decides next action
```

No subagent. No subprocess. Nina controls the desktop the same way she controls the browser.

---

## New MCP Server: `desktop-action-server.ts`

Six tools registered on the shared MCP server pool:

| Tool | Parameters | Returns |
|------|-----------|---------|
| `desktop_screenshot` | `region?` | Screenshot image (existing tool, moved here) |
| `desktop_click` | `x`, `y`, `button?`, `double?` | Screenshot image after click + URL |
| `desktop_type` | `text` | Screenshot image after typing + URL |
| `desktop_key` | `key` (e.g., `ctrl+s`, `Return`) | Screenshot image after keypress + URL |
| `desktop_scroll` | `x`, `y`, `direction`, `amount?` | Screenshot image after scroll + URL |
| `desktop_wait` | `seconds` (0.1–10) | Screenshot image after wait + URL |

### Tool result format

Every action tool returns both an image (for Nina to see) and a text block with the screenshot URL (for Nina to share with the user):

```typescript
{
  content: [
    { type: "text", text: JSON.stringify({ screenshotUrl: "/api/assets/screenshots/ss-xxx.png" }) },
    { type: "image", data: base64, mimeType: "image/png" }
  ]
}
```

### Coordinate scaling

Scale factor computed once at server creation from `backend.displayInfo()`. All action tools translate API coordinates to screen coordinates via `toScreenCoord(apiCoord, scaleFactor)`. This matches the existing `AgentComputerUseService` logic.

---

## What Gets Removed

| File/Component | Reason |
|---------------|--------|
| `agent-computer-use-service.ts` | Subagent replaced by direct tools |
| `desktop_task` MCP tool in `desktop-server.ts` | No longer needed |
| `handleDesktopTask` function | No longer needed |
| `ComputerUseServiceLike` type in `desktop-server.ts` | No longer needed |
| `app.desktopComputerUse` property on App class | No longer needed |
| `ComputerUseService` import in `app.ts` | Dead code |
| `AgentComputerUseService` import in `app.ts` | Deleted file |

## What Stays

| Component | Notes |
|-----------|-------|
| `desktop_screenshot` handler | Moved to new server, same logic |
| `desktop_info` handler | Stays in `desktop-server.ts` (info-only, no actions) |
| `X11Backend` | Unchanged |
| `VisualActionService` | Unchanged |
| Rate limiter | Now fires per-action instead of per-task |
| `desktop-capability-detector.ts` | Unchanged |
| Settings UI (Desktop Control panel) | Unchanged — `computerUseAvailable` derived from backend existence |

---

## Audit

PostToolUse hook on `desktop_click|desktop_type|desktop_key|desktop_scroll`:
- Appends to shared `desktop-audit.jsonl` in agent dir
- Same audit logger as today, wired to individual tools
- Fires regardless of which Nina (Conversation or Working) invoked the tool
- One place to query all desktop activity

---

## Skill Update

`skills/desktop-control.md` rewritten:

- Lists 6 direct tools instead of `desktop_task`
- Guidance: "Start with `desktop_screenshot` to see the screen. Use coordinates from the most recent screenshot."
- Screenshot sharing: "Always include the screenshot URL as a markdown image in your response: `![Screenshot](url)`"
- No delegation rules enforced architecturally — Nina decides based on context

---

## Verification

Sprint complete when this scenario passes end-to-end:

1. Open dashboard in browser
2. New chat conversation
3. Ask Nina: "Use your desktop tools to screenshot the VS Code window showing ROADMAP.md"
4. Nina calls `desktop_screenshot` → sees screen → calls `desktop_click` on VS Code → calls `desktop_screenshot` again
5. Screenshot displays inline in chat message
6. No subagent spawned, no `AgentComputerUseService` involved

---

## Files

### New
| File | Purpose |
|------|---------|
| `packages/dashboard/src/mcp/desktop-action-server.ts` | 6 direct desktop MCP tools |

### Modified
| File | Change |
|------|--------|
| `packages/dashboard/src/app.ts` | Remove computer use service init, register desktop-action-server |
| `packages/dashboard/src/mcp/desktop-server.ts` | Remove `desktop_task`, `handleDesktopTask`, keep `desktop_info` |
| `skills/desktop-control.md` | Rewrite for direct tools |

### Deleted
| File | Reason |
|------|--------|
| `packages/dashboard/src/desktop/agent-computer-use-service.ts` | Replaced by direct tools |

---

*Spec written: 2026-04-02*
