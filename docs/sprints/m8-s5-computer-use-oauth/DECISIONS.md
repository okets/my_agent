# Decisions: M8-S5 Computer Use OAuth Fix

## Decision: Use Agent SDK query() with custom MCP tools

**Timestamp:** 2026-04-02T09:05:00Z
**Severity:** Medium
**Context:** ComputerUseService requires `ANTHROPIC_API_KEY` for `client.beta.messages.create()`. Max subscription only has OAuth token. Raw API rejects OAuth (`401`).

**Options Considered:**
1. Use Anthropic SDK `authToken` parameter — correct auth mechanism but raw API rejects OAuth entirely
2. Agent SDK `query()` with custom MCP tools — replaces the raw API loop with Agent SDK session
3. Separate API key — user rejected this

**Decision:** Option 2
**Rationale:** The raw Messages API does not support OAuth at all (verified by test). The Agent SDK handles OAuth internally. Custom MCP tools replicate the `computer_20251124` tool's functionality.
**Reversibility:** Easy

## Decision: MCP image format (flat, not nested)

**Timestamp:** 2026-04-02T10:05:00Z
**Severity:** Minor
**Context:** MCP `CallToolResult` expects `{type:"image", data, mimeType}` (flat). The Anthropic API uses `{type:"image", source:{type:"base64", media_type, data}}` (nested).

**Decision:** Use MCP flat format for all MCP tool results.
**Rationale:** The MCP protocol spec defines `ImageContent` with flat fields. The nested format caused `undefined` data/mimeType.

## Decision: Include screenshot URLs in desktop_task results

**Timestamp:** 2026-04-02T10:10:00Z
**Severity:** Minor
**Context:** Nina saw screenshots via MCP tool results but couldn't share them with the user because the tool result only had a JSON summary.

**Decision:** Add `screenshotUrls` array to the JSON result. Update desktop skill to instruct Nina to include the URL as markdown image.
**Rationale:** The dashboard already renders markdown images via DOMPurify. Adding the URL to the tool result lets Nina share screenshots naturally.
