# Conversation System — Design Specification

> **Status:** Revised for M6.7 (Two-Agent Refactor)
> **Date:** 2026-03-04
> **Scope:** Conversation lifecycle, persistence, indexing, search, and recall
> **Milestones:** M2 (web chat), M6.7 (session architecture), M6.8 (skills)
> **Design doc:** [conversation-nina-design.md](../plans/2026-03-04-conversation-nina-design.md)

---

## Table of Contents

1. [Terminology](#terminology)
2. [Conversation Lifecycle](#conversation-lifecycle)
3. [Session Mechanics](#session-mechanics)
4. [Channel Routing](#channel-routing)
5. [New Conversation Triggers](#new-conversation-triggers)
6. [Browsable Conversations](#browsable-conversations)
7. [Conversation Naming](#conversation-naming)
8. [Three Representations](#three-representations)
9. [Transcript (JSONL)](#transcript-jsonl)
10. [Index (SQLite — FTS5)](#index-sqlite--fts5)
11. [System Prompt Architecture](#system-prompt-architecture)
12. [MCP Conversation Tools](#mcp-conversation-tools)
13. [Data Model](#data-model)
14. [File Structure](#file-structure)
15. [Key Flows](#key-flows)

---

## Terminology

| Term | Definition |
|------|-----------|
| **Conversation** | A sequence of user↔agent exchanges with a persistent ID |
| **Transcript** | Append-only JSONL record of every turn, event, and metadata change |
| **Turn** | One user message + one agent response (share same turn number) |
| **Current** | The actively receiving conversation. One per owner at any time |
| **Inactive** | A parked conversation. Browsable, referable, resumable |
| **Channel** | Communication transport (web, WhatsApp, email, etc.) |

---

## Conversation Lifecycle

### Status Model

One conversation is **current** at any time. All others are **inactive**.

There is no "archived", "closed", or "read-only" state. Every conversation is resumable.

| State | Meaning |
|-------|---------|
| **Current** | Actively receiving messages. One per owner. |
| **Inactive** | Parked. Browsable, referable, resumable at any time. |

### Status Transitions

```
[New] ──────────────────────────────────────────► [Current]
                                                     │
                    ┌────────────────────────────────┘
                    │ (trigger: /new, Web→WhatsApp, idle timeout)
                    ▼
               [Inactive] ◄──────────────────── [Current]
                    │                                ▲
                    │ (resume: user clicks Resume)   │
                    └────────────────────────────────┘
```

When a new conversation becomes current, the previous current becomes inactive. Only one swap at a time — no race conditions.

### What happens when a conversation becomes inactive

- SDK session ID is retained (for future resume)
- Transcript persists (JSONL + SQLite metadata)
- Auto-generated summary for search/browsing (abbreviation)
- No data is lost or archived

---

## Session Mechanics

### Resume + SystemPrompt

Every query to Conversation Nina passes both:
- **`resume`** — SDK session ID (preserves full conversation history)
- **`systemPrompt`** — freshly rebuilt 6-layer prompt (ensures fresh context)

The SDK resumes the session with the new system prompt, applying it while preserving the full conversation history. This was validated via CLI test.

**Key constraint:** `resume` and `systemPrompt` are independent optional fields. Only `continue` and `resume` are mutually exclusive.

### Single buildQuery Path

There is ONE code path for building queries — no branching between "fresh" and "resume". The system prompt is always rebuilt. The resume ID is always passed if available.

```typescript
// Always:
createBrainQuery(content, {
  model,
  systemPrompt,  // Fresh every query
  resume: sdkSessionId ?? undefined,  // Present when resuming
  // ...
});
```

### Resume Failure Fallback

If resuming fails (stale session, SDK error):
1. Clear the session ID
2. Retry with fresh session (same system prompt, no resume)
3. Log the fallback for debugging

---

## Channel Routing

### Owner Messages → Conversation Nina

All channels carrying **owner** messages route to the same Conversation Nina.

| Channel | Routing |
|---------|---------|
| Web UI | Direct → Conversation Nina |
| WhatsApp (owner's number) | Direct → Conversation Nina |
| Future owner channels | Direct → Conversation Nina |

Channel is transport only. Nina knows the active channel via inbound metadata.

### External Contact Messages → Working Agents

External contacts **never reach** Conversation Nina. They are handled by Working Agents.

| Source | Routing |
|--------|---------|
| WhatsApp (other contacts) | → Working Agent (per-task or per-contact) |
| Email (inbound) | → Task creation → Working Agent |
| Future external channels | → Working Agent |

Email is a **task submission mechanism**, not a conversation channel.

### Escalation Flow

```
External Contact
  → Working Agent handles communication
  → Needs owner input → escalate_to_owner()
  → Stored in escalation queue (task folder)
  → Nina's next system prompt rebuild includes it (layer 3)
  → Owner sees escalation in Conversation Nina
  → Owner responds
  → Response routed back to Working Agent
  → Working Agent replies to External Contact
```

---

## New Conversation Triggers

| Trigger | Behavior |
|---------|----------|
| `/new` command (any channel) | Current becomes inactive, new conversation starts |
| Web → WhatsApp switch | Current becomes inactive, new conversation starts |
| Idle timeout (configurable, default 8h) | On next message: current becomes inactive, new starts |

### NOT a New Conversation

| Scenario | Reason |
|----------|--------|
| WhatsApp → Web switch | Web UI shows full transcript; user has full context |

This is the **asymmetric channel switching** rule: switching to a richer medium (Web) continues; switching to a limited medium (WhatsApp) starts fresh.

### Idle Timeout

Configurable (default: 8 hours). On next message after timeout, previous conversation becomes inactive and a new one starts. No automatic session expiry mid-conversation.

---

## Browsable Conversations

### Homepage

Inactive conversations are displayed on the Web UI homepage as entry points. Each shows:
- Date and time range
- Summary snippet (abbreviation)
- Channel badges (which channels were used)
- Message count

### Tabs

Click an inactive conversation to open it in a tab alongside the current chat. Tabs support:
- **Read** — Browse the full transcript
- **Reference** — Use as context when talking to current Conversation Nina
- **Resume** — Make this conversation current (previous current becomes inactive)

### UI-Assisted Referencing

User browses conversations in tabs, clicks "Reference" → injects a reference into the current chat context. Nina loads the referenced transcript via `conversation_read` MCP tool.

---

## Conversation Naming

### Auto-Naming

At turn 5, the system generates a short title using a Haiku model. The title is a descriptive phrase, not a summary.

### Re-Naming

Periodically (every 10 turns after initial naming), the title may be updated if the conversation topic has shifted significantly.

### Manual Override

User can rename via the UI. Manual names are protected from auto-rename.

---

## Three Representations

| Representation | Storage | Purpose |
|----------------|---------|---------|
| **Transcript** | JSONL file | Complete record, append-only |
| **Index** | SQLite (FTS5) | Fast search, metadata queries |
| **Summary** | Abbreviation field | Quick preview, search snippets |

---

## Transcript (JSONL)

Each conversation has a JSONL transcript file at:
```
.my_agent/conversations/transcripts/{conversation-id}.jsonl
```

### Line Types

```jsonl
{"type":"meta","id":"conv-...","channel":"web","created":"...","participants":["user"]}
{"type":"turn","role":"user","content":"Hello","timestamp":"...","turnNumber":1,"channel":"web"}
{"type":"turn","role":"assistant","content":"Hi!","timestamp":"...","turnNumber":1}
{"type":"event","event":"title_assigned","title":"Morning Catchup","timestamp":"..."}
{"type":"event","event":"abbreviation","text":"Discussed calendar and tasks...","timestamp":"..."}
```

### Channel Badges

Every user turn carries a `channel` field indicating which channel it originated from:

```jsonl
{"type":"turn","role":"user","content":"Check my calendar","channel":"web","turnNumber":3}
{"type":"turn","role":"user","content":"Push that to 3pm","channel":"whatsapp","turnNumber":4}
```

The Web UI renders these as badges. WhatsApp shows only its own messages. Web is the canonical view with the complete picture.

---

## Index (SQLite — FTS5)

SQLite database at `.my_agent/conversations/agent.db` stores:

- **conversations** table — metadata (id, channel, title, status, timestamps, etc.)
- **turns_fts** — FTS5 virtual table for full-text search across transcript content
- **tasks** table — task metadata (separate concern, same DB)

### Status Column

```sql
ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive';
```

Only one conversation can have `status = 'current'` at a time. Enforced at application level via `makeCurrent()`.

---

## System Prompt Architecture

Rebuilt on every query. Six layers, top to bottom.

| Layer | Source | Cache | Changes? |
|-------|--------|-------|----------|
| 1. Identity | `.my_agent/brain/CLAUDE.md` + memory files | `cache_control: ephemeral` | Rarely |
| 2. Skills | Framework + brain skills | `cache_control: ephemeral` | Rarely |
| 3. Current State | Tasks, calendar, escalations | Rebuilt | Frequently |
| 4. Memory Context | Daily summary + MCP retrievals | Rebuilt | Varies |
| 5. Inbound Metadata | Channel, timestamp, flags (JSON) | Rebuilt | Every message |
| 6. Session Context | Conversation ID, message count | Rebuilt | Every message |

### Prompt Caching

Layers 1-2 (~2000-2500 tokens) are annotated with `cache_control: { type: "ephemeral" }` — ~90% cost reduction after the first message.

Layers 3-6 (~500-1000 tokens) are rebuilt fresh. Trivial cost.

### Inbound Metadata Block

System-role, trusted, not visible to user:

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

### What This Replaced

- `contextInjection` parameter in SessionManager (removed)
- `context-builder.ts` — cold-start injection (deleted)
- Two-branch `buildQuery()` — resume OR systemPrompt (unified)

---

## Search Infrastructure (M6.7-S4)

Conversation search follows the same architecture as notebook memory search: **files are the source of truth, embeddings are a disposable derived index.**

### Source of Truth

| Layer | Storage | Rebuildable From |
|-------|---------|-----------------|
| Transcript content | JSONL files (`{agentDir}/conversations/{id}.jsonl`) | — (primary) |
| Conversation metadata | `agent.db` → `conversations` table | JSONL headers |
| FTS5 keyword index | `agent.db` → `turns_fts` | JSONL turn content |
| Vector embeddings | `agent.db` → `conv_vec` + `conversation_embedding_map` | JSONL turn content + embedding model |

All embeddings can be dropped and rebuilt from transcript files. This enables:
- Swapping embedding models (local → Ollama, or different Ollama models)
- Changing vector dimensions without data loss
- Full database rebuild from source files after migration/crash

### Hybrid Search (FTS5 + Vector)

Two search paths, merged with **Reciprocal Rank Fusion (RRF, K=60)** — same algorithm as the memory system:

1. **FTS5 (keyword):** BM25 ranking on `turns_fts` virtual table
2. **Vector (semantic):** Cosine similarity on `conv_vec` via sqlite-vec

When embeddings are unavailable (Ollama down, no model configured), search gracefully degrades to FTS5-only. No error to the user.

### Embedding Flow

```
User/assistant message arrives
  → conversationManager.appendTurn()     # FTS5 indexed (synchronous, must succeed)
  → searchService.indexTurn()            # Vector embedded (fire-and-forget, never blocks)
```

On conversation delete:
```
  → searchService.removeConversation()   # Clean up embeddings + mapping
  → conversationManager.delete()         # Clean up metadata + FTS + transcript
```

On startup or model recovery:
```
  → searchService.indexMissing()         # Catch up turns without embeddings
```

### Architecture

```
ConversationSearchDB (search-db.ts)
  ├── searchKeyword()     → FTS5 BM25 via turns_fts
  ├── searchVector()      → sqlite-vec KNN via conv_vec + mapping
  ├── upsertEmbedding()   → BigInt rowids, JSON-encoded vectors
  └── removeTurns()       → Cleanup on conversation delete

ConversationSearchService (search-service.ts)
  ├── search()            → Hybrid RRF merge (K=60)
  ├── indexTurn()          → Fire-and-forget embedding
  ├── indexMissing()       → Startup catch-up
  └── removeConversation() → Delegates to searchDb.removeTurns()
```

### sqlite-vec Patterns

These patterns match the memory system's `MemoryDb`:

- **BigInt rowids:** vec0 requires `BigInt(rowid)` for inserts
- **JSON-encoded embeddings:** `JSON.stringify(embedding)` for both insert and query (not Float32Array)
- **KNN with JOINs:** Use `WHERE v.embedding MATCH ? AND v.k = ?` (not `LIMIT ?`, which is invisible through JOINs)

---

## MCP Conversation Tools

Nina can reference past conversations via MCP tools (registered as `conversations` namespace on the brain MCP server):

### conversation_search

Search across conversation transcripts using hybrid keyword + semantic search.

**Input:** `{ query: string, limit?: number }`
**Output:** Matching turns with conversation ID, title, channel, snippet, timestamp, RRF score

### conversation_read

Load the full transcript of a specific conversation.

**Input:** `{ conversationId: string }`
**Output:** Conversation metadata + all turns with timestamps and roles

These tools enable Nina to recall prior discussions without the user navigating the UI.

### REST API

Three endpoints under `/api/conversations`:

| Endpoint | Purpose |
|----------|---------|
| `GET /search?q=&limit=` | Hybrid search with metadata enrichment |
| `GET /:id` | Full conversation with all turns |
| `GET /` | List conversations with preview snippets |

---

## Data Model

```typescript
interface Conversation {
  id: string;                    // conv-{ulid}
  channel: string;               // Origin channel
  status: "current" | "inactive"; // Lifecycle status
  title: string | null;          // Auto-generated or manual
  topics: string[];              // Topic tags
  created: Date;
  updated: Date;
  turnCount: number;
  participants: string[];
  abbreviation: string | null;   // Summary for search/preview
  needsAbbreviation: boolean;
  manuallyNamed: boolean;
  lastRenamedAtTurn: number | null;
  model: string | null;
  externalParty: string | null;  // For channel conversations
  isPinned: boolean;             // Channel routing
  sdkSessionId: string | null;   // For SDK resume
}
```

---

## File Structure

```
.my_agent/
├── conversations/
│   ├── agent.db              # SQLite: metadata, FTS, tasks
│   └── transcripts/
│       ├── conv-ABC123.jsonl # Each conversation's transcript
│       └── conv-DEF456.jsonl
```

---

## Key Flows

### New Message on Current Conversation

```
User sends message (web/WhatsApp)
  → ConversationRouter identifies owner
  → Route to Conversation Nina
  → SystemPromptBuilder.build() → 6-layer prompt
  → createBrainQuery(content, { systemPrompt, resume })
  → Stream response
  → Append turn to transcript
  → Update SQLite metadata (updated, turnCount)
```

### /new Command

```
User sends /new
  → Current conversation → inactive (status swap)
  → Create new conversation (status: current)
  → New SDK session (no resume ID yet)
  → SystemPromptBuilder.build() → fresh prompt
  → Send confirmation
```

### Resume Inactive Conversation

```
User clicks "Resume" on inactive conversation
  → Target conversation → current (status swap)
  → Previous current → inactive
  → Load SDK session ID from DB
  → Next message uses resume + fresh systemPrompt
```

### Channel Switch (Web → WhatsApp)

```
User was chatting on Web
  → User sends message on WhatsApp
  → ConversationRouter detects Web→WhatsApp switch
  → Current (web) conversation → inactive
  → New conversation starts on WhatsApp
  → Fresh SDK session
```

### Channel Switch (WhatsApp → Web)

```
User was chatting on WhatsApp
  → User sends message on Web
  → ConversationRouter: NOT a new conversation
  → Same conversation continues
  → Web UI shows full transcript with channel badges
```

---

_Design specification created: 2026-02-14_
_Revised: 2026-03-04 — M6.7 Two-Agent Refactor (current/inactive model, resume+systemPrompt, channel routing)_
