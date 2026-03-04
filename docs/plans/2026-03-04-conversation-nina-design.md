# Conversation Nina — Revised Design

> **Date:** 2026-03-04
> **Status:** Approved
> **Scope:** Conversation lifecycle, channel routing, external communication separation, system prompt architecture
> **Milestone:** M6.7 (Two-Agent Refactor)

---

## Summary

Conversation Nina uses resumable SDK sessions with a system prompt rebuilt on every query. This eliminates context staleness, removes cold-start injection, and enables seamless channel switching. Working Agents retain the folder-as-context model.

The key technical enabler: the Agent SDK accepts both `resume` and `systemPrompt` together. Validated via CLI test — a resumed session applies the new system prompt while preserving full conversation history.

---

## 1. Conversation Lifecycle

### Session Model

One conversation is **current** at any time. All others are **inactive**.

There is no "archived" or "read-only" state. Every conversation is resumable.

| State | Meaning |
|-------|---------|
| **Current** | Actively receiving messages. One per owner. |
| **Inactive** | Parked. Browsable, referable, resumable. |

### New Conversation Triggers

| Trigger | Behavior |
|---------|----------|
| `/new` command (any channel) | Current becomes inactive, new conversation starts |
| Web → WhatsApp switch | Current becomes inactive, new conversation starts |
| Idle timeout (e.g. 8h) | On next message: current becomes inactive, new starts |

### NOT a New Conversation

| Scenario | Why |
|----------|-----|
| WhatsApp → Web switch | Web UI shows full transcript; user has full context |

### Session Mechanics

Every query to Conversation Nina passes both `resume` (SDK session ID) and `systemPrompt` (freshly rebuilt). The SDK resumes the session with the new system prompt, preserving full conversation history while injecting fresh context.

When a conversation becomes inactive:
- SDK session ID is retained (for future resume)
- Transcript persists (JSONL + SQLite metadata)
- Auto-generated summary for search/browsing

### Idle Timeout

Configurable (default: 8 hours). On next message after timeout, previous conversation becomes inactive and a new one starts. No automatic session expiry mid-conversation.

---

## 2. Channel Routing & External Communication Separation

### Owner Routing (Conversation Nina)

Conversation Nina **only speaks to the owner**. All channels carrying owner messages route to the same Conversation Nina.

| Channel | Routing |
|---------|---------|
| Web UI | Direct → Conversation Nina |
| WhatsApp (owner's number) | Direct → Conversation Nina |
| Future owner channels | Direct → Conversation Nina |

Channel is transport only. Nina is aware of the active channel (via inbound metadata) and responds there.

### External Contact Routing (Working Agents)

External contacts never reach Conversation Nina. They are handled by Working Agents.

| Source | Routing |
|--------|---------|
| WhatsApp (other contacts) | → Working Agent (per-task or per-contact) |
| Email (inbound) | → Task creation → Working Agent |
| Future external channels | → Working Agent |

Email is a task submission mechanism, not a conversation channel.

### Escalation Flow

```
External Contact
  → Working Agent handles communication
  → Needs owner input → escalate_to_owner()
  → Stored in escalation queue (task folder)
  → Nina's next system prompt rebuild includes it
  → Owner sees escalation in Conversation Nina
  → Owner responds
  → Response routed back to Working Agent
  → Working Agent replies to External Contact
```

### Channel Switch Behavior

```
Web conversation active
  → User sends message on WhatsApp
  → Web conversation becomes inactive
  → New conversation starts on WhatsApp
  → Nina rebuilds system prompt (fresh context)

WhatsApp conversation active
  → User sends message on Web UI
  → Same conversation continues
  → Web UI shows full transcript with channel badges
```

### Channel Badges

Every message in the transcript carries a channel origin marker. The Web UI displays these as badges:

```
[Web] Hey Nina, can you check my calendar?
[Nina] You have a 2pm with...

[WhatsApp] Actually push that to 3pm
[Nina] Done, moved to 3pm.
```

WhatsApp shows only messages from the WhatsApp portion. Web UI is the canonical view with the complete picture.

---

## 3. Browsable Conversations & References

### Homepage

Inactive conversations displayed on the Web UI homepage as entry points. Each shows: date, summary snippet, channel badges, message count.

### Tabs

Click an inactive conversation to open it in a tab alongside the current chat. Tabs support:
- **Read:** Browse the full transcript
- **Reference:** Use as context when talking to current Conversation Nina
- **Resume:** Make this conversation current again (previous current becomes inactive)

### MCP Tools for Nina

Nina can reference past conversations without the user navigating:

- **`conversation_search`** — semantic/keyword search across transcripts
- **`conversation_read`** — load full transcript of a specific conversation

When referenced, Nina sees the full transcript — not a summary. She can quote specific parts and build on prior context.

### UI-Assisted Referencing

User browses conversations in tabs, clicks "Reference" → injects a reference into the current chat context. Nina loads the referenced transcript via `conversation_read`.

---

## 4. System Prompt Architecture

Rebuilt on every query. Six layers, top to bottom.

### Layer Structure

```
1. Identity          — personality, voice, operating rules
2. Skills            — active skill definitions
3. Current State     — time, active tasks, pending escalations
4. Memory Context    — daily summary + relevant memory retrievals
5. Inbound Metadata  — channel, timestamp, flags (JSON, trusted)
6. Session Context   — conversation ID, message count
```

### Layer Details

| Layer | Source | Cache | Changes between queries? |
|-------|--------|-------|------------------------|
| Identity | `.my_agent/brain/CLAUDE.md` | `cache_control: ephemeral` | Rarely |
| Skills | SDK `settingSources` | `cache_control: ephemeral` | Rarely |
| Current State | Tasks, calendar, escalations | Rebuilt | Frequently |
| Memory Context | Daily summary + MCP retrievals | Rebuilt | Varies |
| Inbound Metadata | Request context | Rebuilt | Every message |
| Session Context | Conversation record | Rebuilt | Every message |

### Prompt Caching (Built-in)

Layers 1-2 (Identity + Skills) are annotated with `cache_control: { type: "ephemeral" }`. These ~2000-2500 tokens get a 90% cost reduction after the first message in a conversation.

Layers 3-6 (~500-1000 tokens) are always rebuilt fresh. Trivial cost.

### Inbound Metadata Block

System-role, trusted, not visible to user. Structured JSON:

```json
{
  "channel": "whatsapp",
  "timestamp": "2026-03-04T14:32:00Z",
  "message_index": 7,
  "conversation_id": "conv_abc123",
  "has_pending_escalations": true,
  "active_working_agents": ["email-reply-task-42"]
}
```

### Token Budget

| Layer | Estimate |
|-------|----------|
| Identity | ~1500 tokens |
| Skills | ~500-1000 tokens |
| Current State | ~300-500 tokens |
| Memory Context | ~500 tokens |
| Metadata + Session | ~100 tokens |
| **Total** | **~3000-3500 tokens/query** |

### What This Replaces

- `contextInjection` parameter in SessionManager
- `context-builder.ts` (removed)
- Two-branch `buildQuery()` (resume OR systemPrompt)

---

## 5. Working Agents (Unchanged)

Working Agents retain the **folder-as-context** model:

- Each task → folder with `CLAUDE.md` + `task.md`
- Agent spawned with folder as cwd
- Session scoped to task lifetime — closes on task completion
- Folder provides isolation, inspectability, clear boundaries

The resume+systemPrompt pattern is not applied to Working Agents. Their problem (task isolation, clear boundaries) is different from Conversation Nina's (long-lived relationship, context freshness).

| | Conversation Nina | Working Agents |
|--|--|--|
| **Lifespan** | Long-lived, relationship | Short-lived, task-scoped |
| **Session** | Resume + dynamic system prompt | Folder as context |
| **Concurrency** | One current | Multiple in parallel |
| **Inspectability** | Transcript + tabs | Folder with artifacts |

---

## 6. Implementation Impact

### Files to Modify

| File | Change |
|------|--------|
| `session-manager.ts` | Single `buildQuery()` path — always `resume` + `systemPrompt`. Remove two-branch split. |
| `chat-handler.ts` | Remove context injection logic |
| `session-registry.ts` | Track current/inactive conversation per owner |
| `conversation-manager.ts` | Add status field (current/inactive), swap logic |
| `message-handler.ts` | Channel-aware routing, Web→WhatsApp detection |
| `app.js` | Homepage with inactive conversations, tab support, resume button |
| `ws-client.js` | Conversation status changes, tab management |
| `index.html` | Homepage layout, tab container |
| `channels.md` | Per-contact scoping → Working Agents only |
| `conversation-system.md` | Full rewrite |

### Files to Remove

| File | Why |
|------|-----|
| `context-builder.ts` | Cold-start context injection no longer needed |

### New Components

| Component | Purpose |
|-----------|---------|
| `system-prompt-builder.ts` | Assembles 6-layer system prompt with caching annotations |
| `conversation-router.ts` | Channel → agent routing. Owner detection, Web→WhatsApp switch. |
| `conversation-server.ts` (MCP) | `conversation_search` + `conversation_read` tools |

### What's Removed

- Cold-start context injection
- Context abbreviation for new sessions
- Two-branch buildQuery
- "Archived" / "read-only" conversation state
- Per-contact conversation scoping for Conversation Nina

### Roadmap Impact

- **M6.7 (Two-Agent Refactor):** Primary vehicle for this work
- **M6.5:** Two-branch session resume replaced with unified path
- **M6.6 (Lifecycle):** Simplified — system prompt rebuild handles context freshness

---

## Validation

**Resume + systemPrompt compatibility** validated via CLI test:
1. Created session with system prompt "Test bot."
2. Resumed same session with different system prompt "You are NINJA BOT."
3. Response confirmed new system prompt was applied on resume.

SDK type definitions confirm `resume` and `systemPrompt` are independent optional fields with no mutual exclusivity constraint. Only `continue` and `resume` are mutually exclusive.
