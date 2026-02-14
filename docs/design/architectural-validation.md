# Architectural Validation

> **Purpose:** Validate that all architectural decisions are feasible before sprint planning
> **Date:** 2026-02-14
> **Status:** In Progress

---

## Summary

| Component | Status | Notes |
|-----------|--------|-------|
| M3 WhatsApp (Baileys) | **Validated** | Baileys is proven, used in production by many projects |
| M4a Claude Code Spawning | **Validated** | `-p` flag provides non-interactive mode with JSON output |
| M4a Comms MCP Server | **Needs Design** | Pattern is feasible, implementation approach needs spec |
| M4b Memory Graph | **Validated** | @modelcontextprotocol/server-memory provides entities, relations, observations |
| M5 Ops Dashboard | **Validated** | Standard web UI, no novel technology |
| M6 Email (MS Graph) | **Validated** | Microsoft Graph API is well-documented |

---

## M3: WhatsApp Channel

### Validation

**Baileys library** is a reverse-engineered WhatsApp Web client. Widely used in production:
- Multi-device support (required since 2021)
- Active maintenance
- No official API exists, so this is the standard approach

### Risks

| Risk | Mitigation |
|------|------------|
| WhatsApp ToS violation | Use dedicated agent number, not user's personal account |
| Rate limiting / bans | Implement backoff, avoid bulk messaging |
| Library breaking changes | Pin version, monitor for updates |

### Decision

**Proceed with Baileys.** It's the industry standard for WhatsApp automation.

---

## M4a: Claude Code Spawning

### Validation

Claude Code CLI supports programmatic use via [headless mode](https://code.claude.com/docs/en/headless):

```bash
# Non-interactive execution
claude -p "Investigate this bug. Context in CLAUDE.md." \
  --cwd /path/to/project/folder \
  --output-format stream-json
```

Features:
- `-p` flag for non-interactive mode
- `--output-format stream-json` for streaming structured output
- `--continue` for resuming sessions
- `--cwd` for setting working directory

### How Brain Spawns Tasks

```typescript
import { spawn } from 'child_process';

const claude = spawn('claude', [
  '-p', 'Investigate the bug. Context in CLAUDE.md.',
  '--cwd', projectFolder,
  '--output-format', 'stream-json'
]);

claude.stdout.on('data', (data) => {
  // Parse streaming JSON events
  const event = JSON.parse(data);
  // Handle: text, tool_use, completion, etc.
});

claude.on('close', (code) => {
  // Session ended (completed or needs review)
});
```

### Decision

**Validated.** Claude Code CLI has all required capabilities.

---

## M4a: Comms MCP Server

### The Challenge

When the brain spawns a Claude Code session for a project, the session needs to communicate back:

- `notify(message)` — send status updates
- `request_review(plan)` — block for user approval
- `escalate(problem)` — urgent notification
- `ask_quick(question)` — quick decision with timeout

The spawned session is a separate process. How does it call these tools?

### Proposed Architecture

**Option A: Task Folder MCP Configuration (Recommended)**

1. Brain creates project folder with `.claude/settings.json`
2. Settings configure a "comms" MCP server pointing to the brain
3. Brain exposes an HTTP endpoint (e.g., `http://localhost:4321/mcp/comms`)
4. When Claude Code starts, it connects to the configured MCP server
5. Tools like `notify()` send HTTP requests to the brain

```json
// .my_agent/projects/2026-02-14-login-bug/.claude/settings.json
{
  "mcpServers": {
    "comms": {
      "transport": "http",
      "url": "http://localhost:4321/mcp/comms",
      "headers": {
        "X-Task-ID": "2026-02-14-login-bug"
      }
    }
  }
}
```

**Option B: File-Based Signaling (Simpler, Less Real-Time)**

1. Claude Code writes to a signal file in the task folder
2. Brain watches the folder for changes
3. On file change, brain reads and processes the signal

```
# Claude Code writes:
.my_agent/projects/2026-02-14-login-bug/.signals/request_review.json

# Brain watches *.signals/* and processes
```

**Option C: Unix Socket MCP Server**

1. Brain creates a Unix socket for each spawned session
2. Socket path passed via environment variable
3. Claude Code connects via stdio-over-socket

### Trade-offs

| Option | Real-time | Complexity | Cross-platform |
|--------|-----------|------------|----------------|
| HTTP MCP | Yes | Medium | Yes |
| File-based | No (polling) | Low | Yes |
| Unix socket | Yes | High | Linux/macOS only |

### Recommendation

**Start with Option B (file-based)** for M4a MVP:
- Simplest to implement
- No new infrastructure
- Good enough for project-level granularity (not chatty)

**Upgrade to Option A (HTTP MCP)** if real-time updates become important.

### Decision Required

**Choice:** File-based signaling for MVP, HTTP MCP for v2?

---

## M4b: Memory System

### Validation

[@modelcontextprotocol/server-memory](https://www.npmjs.com/package/@modelcontextprotocol/server-memory) is a **knowledge graph** MCP server providing:

- Entities (create, read, update, delete)
- Relations between entities
- Observations attached to entities
- Search capabilities
- JSONL-based persistent storage

This matches our memory-system.md design exactly.

### MVP Approach

1. Run @modelcontextprotocol/server-memory as an MCP server
2. Configure brain to connect to it
3. Use MCP tools for entity operations
4. Add custom extraction logic (Haiku calls) that write to the memory server

### Future Upgrade Path

If query capabilities prove insufficient:
- Graphiti + Memgraph for full graph database
- SQLite with custom graph tables
- Mem0 for managed service

### Decision

**Proceed with @modelcontextprotocol/server-memory for MVP.** Upgrade path exists if needed.

---

## M5: Operations Dashboard

### Validation

Standard web UI technology:
- Alpine.js + Tailwind CSS (existing from M2)
- Fastify REST APIs
- SQLite queries + folder reads

No novel technology required.

### Decision

**No blockers.** Standard web development.

---

## M6: Email Channel

### Validation

Microsoft Graph API for email:
- Well-documented, stable API
- OAuth 2.0 authentication
- Full send/receive capabilities
- Webhook support for real-time notifications

### Risks

| Risk | Mitigation |
|------|------------|
| OAuth complexity | Use established libraries (msal-node) |
| Token refresh | Implement proper token management |
| Rate limits | Respect Graph API limits |

### Decision

**Proceed with Microsoft Graph.** Industry-standard approach.

---

## Remaining Decisions

### 1. Comms MCP Server Approach (M4a)

**Options:**
- A) HTTP-based MCP server (real-time, medium complexity)
- B) File-based signaling (simple, polling-based)
- C) Unix socket (real-time, complex, not cross-platform)

**Recommendation:** B for MVP, upgrade to A if needed.

**Decision needed:** Confirm file-based approach for MVP?

### 2. Auto-Enrichment Trigger (M4b)

**Options:**
- Every incoming message (most context, highest cost)
- Only when entities detected in message (medium)
- Only on explicit agent recall (lowest cost)

**Recommendation:** Option 2 — enrich when entities are detected.

**Decision needed:** Confirm entity-detection approach?

---

## Conclusion

**All major architectural components are validated.** Two implementation decisions remain:

1. Comms MCP Server approach — recommend file-based for MVP
2. Auto-enrichment trigger — recommend entity-detection based

These can be confirmed during sprint planning, but the **architecture is sound** and the project can proceed to sprint breakdowns.

---

_Created: 2026-02-14_
