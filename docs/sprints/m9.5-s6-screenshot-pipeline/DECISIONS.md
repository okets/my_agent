# DECISIONS

## D1 (revised after KWrite smoke test): `tool_response` shape from SDK PostToolUse hook

**Date:** 2026-04-11
**Context:** Task 0 verification — traced SDK source code (`cli.js`) to determine how MCP tool results are passed to PostToolUse hooks.

**Finding:** For MCP tools, the SDK passes the raw MCP `CallToolResult` through unchanged:

```json
{
  "content": [
    { "type": "text", "text": "{\"description\":\"Screenshot captured\",\"scaleFactor\":0.5,\"width\":1920,\"height\":1080}" },
    { "type": "image", "data": "iVBORw0KGgo...", "mimeType": "image/png" }
  ]
}
```

The field name is `tool_response` (confirmed at SDK line 958-962 in types, and in the minified hook dispatch: `hook_event_name:"PostToolUse",tool_name:A,tool_input:K,tool_response:Y`).

For non-MCP built-in tools (Read, Bash, etc.), the SDK may use different formats (e.g., image files get Anthropic API format with `source.type: "base64"`). But the catch-all interceptor only cares about MCP tool results.

**`updatedMCPToolOutput` confirmed working:** The SDK checks `if("updatedMCPToolOutput" in t)` and replaces the tool output with it, but only for MCP tools (gated by `av(A)` which checks `isMcp`). Then the updated output is sent to the model.

**Impact on implementation (as discovered during smoke testing, SDK source trace was incomplete):**
- `findImageData()` MUST handle Anthropic API format (`source.data`) as the primary path — the SDK converts MCP image blocks to this format before passing to PostToolUse
- `findImageData()` also handles MCP format (`data`) as fallback
- Field name: `input.tool_response` (confirmed — initial code had bug using `tool_result`)
- `tool_response` is a **raw content-block array**, NOT wrapped in `{ content: [...] }`. `toContentBlocks()` helper handles both shapes defensively.
- `updatedMCPToolOutput` MUST be a raw array too (same shape as `tool_response`). Wrapping in `{ content: [...] }` causes double-wrapping downstream when the SDK calls `mapToolResultToToolResultBlockParam`.
- MCP tool names are prefixed by the SDK: `mcp__<server>__<tool>` (e.g., `mcp__desktop-x11__desktop_info`). `parseMcpToolName()` strips the prefix for source inference and extracts the server name for audit logging.

## D2: Curation directive must be in the framework system prompt, not the plug

**Context:** Initial implementation (Task 5) added the curation instruction to `desktop-x11/CAPABILITY.md` and the worker prompt. Neither reached the brain — `loadCapabilityHints()` only outputs name/health, not the CAPABILITY.md body.

**Resolution:** Created `formatScreenshotCurationDirective()` in `packages/core/src/prompt.ts` and included it in `assembleSystemPrompt()` and `buildWorkingNinaPrompt()`. This is the correct architectural layer — screenshot curation is framework behavior (runs on every image-producing MCP tool), not plug behavior.

## D3: Directive must be imperative, not advisory

**Context:** First version of the curation directive said "include the most relevant... if worth showing." Brain consistently chose NOT to include screenshots even when clearly warranted (e.g., reading KWrite content).

**Resolution:** Rewrote as imperative with MUST language, concrete format examples, explicit rules (one screenshot, near top of reply, copy URL exactly). After this change, brain reliably includes the screenshot on the first try.

**Lesson:** Framework-level behavioral directives aimed at LLM brains need to be prescriptive, not suggestive. "You MAY X if worth showing" gets deprioritized. "You MUST X" gets followed.
