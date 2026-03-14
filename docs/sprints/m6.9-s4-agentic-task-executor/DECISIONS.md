# M6.9-S4 Decisions

## D2: T10 E2E deferred to post-merge

**Date:** 2026-03-14
**Decision:** E2E test tasks (T10) require a running dashboard service with the new code deployed. This needs `systemctl --user restart nina-dashboard.service` after merge to master. The 3 test tasks and infrastructure guard negative test will be run post-merge as verification.

## D3: uv installed to snap-specific path

**Date:** 2026-03-14
**Decision:** `uv` installed to `/home/nina/snap/code/228/.local/bin/uv` (VS Code snap sandbox). For tasks to use `uv`, the dashboard service's PATH needs to include this, or uv needs to be installed outside the snap context. Will verify during T10 E2E testing.

---

## D1: Deferred Tool Loading — Automatic for MCP Tools

**Date:** 2026-03-14
**Decision:** No explicit `defer_loading` config needed. MCP tools are automatically deferred by Claude Code.

**Findings from PoC:**

Inspected the Claude Code CLI binary (v2.1.76). The `isDeferredTool()` function shows:
```
if(H.isMcp===!0) return !0    // All MCP tools are deferred
```

This means:
- All tools registered via `Options.mcpServers` are automatically deferred
- Claude sees tool names only; schemas load on demand via `ToolSearch`
- No `defer_loading: true` flag is needed (it's not in the SDK types because it's handled internally)
- The 85% token reduction from the spec happens automatically for MCP tools

**Impact on implementation:**
- Remove `defer_loading` references from spec/plan
- MCP server config stays simple: just register servers normally
- Core tools (Bash, Read, Write, Edit, Glob, Grep) are loaded directly (not MCP, not deferred)
- Memory, knowledge, debrief, playwright MCP tools are all auto-deferred

**How the Anthropic article relates:**
The `defer_loading: true` API flag is for raw Anthropic API users who define tools manually. The Agent SDK/Claude Code handles this automatically for MCP tools. Same outcome, different mechanism.
