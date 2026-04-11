# DECISIONS

## D1: `tool_response` shape from SDK PostToolUse hook

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

**Impact on implementation:**
- `findImageData()` primary path: MCP format `{ type: 'image', data: string }`
- `findImageData()` defensive fallback: Anthropic API format `{ type: 'image', source: { type: 'base64', data: string } }` (for future-proofing)
- Field name: use `input.tool_response` (not `tool_result`)
- `updatedMCPToolOutput` return shape: `{ content: [...originalContent, { type: 'text', text: 'Screenshot URL: ...' }] }` — mirrors MCP content array format
