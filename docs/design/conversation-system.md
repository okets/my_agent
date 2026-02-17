# Conversation System — Design Specification

> **Status:** Design Complete — Implementation Planned
> **Date:** 2026-02-14
> **Session:** Hanan + Claude Code (Opus 4.6)
> **Scope:** Conversation persistence, indexing, search, and recall across all channels
> **Milestone:** Core infrastructure for M2+ (web chat), M3 (WhatsApp), M6 (Email)

---

## Table of Contents

1. [Context and Motivation](#context-and-motivation)
2. [Terminology](#terminology)
3. [Conversation Lifecycle](#conversation-lifecycle)
4. [Channel Continuity Rules](#channel-continuity-rules)
5. [Default Conversation Behavior](#default-conversation-behavior)
6. [Slash Commands](#slash-commands)
7. [Cross-Channel Viewing in Web UI](#cross-channel-viewing-in-web-ui)
8. [Mixed Topic Handling](#mixed-topic-handling)
9. [Conversation Naming](#conversation-naming)
10. [Three Representations](#three-representations)
11. [Transcript (JSONL)](#transcript-jsonl)
12. [Index (SQLite --- FTS5 + vec)](#index-sqlite--fts5--vec)
13. [Working Context](#working-context)
14. [Indexing System](#indexing-system)
15. [Compression vs Abbreviation](#compression-vs-abbreviation)
16. [Data Flow Diagram](#data-flow-diagram)
17. [Semantic Search](#semantic-search)
18. [Agent Recall Tools](#agent-recall-tools)
19. [Data Model](#data-model)
20. [File Structure](#file-structure)
21. [Key Flows](#key-flows)
22. [Relationship to Future Memory System (M4b)](#relationship-to-future-memory-system-m4b)
23. [Implementation Notes](#implementation-notes)

---

## Context and Motivation

### The Problem

The current system (M2) creates a single Agent SDK session per WebSocket connection. When the user refreshes the page or disconnects, the conversation context is lost. There is no persistence, no history, and no way to search past conversations.

As channels are added (WhatsApp in M3, Email in M6), conversations will arrive from multiple sources. The agent needs to:

1. **Persist** every conversation as a durable transcript
2. **Resume** conversations across reconnections and restarts
3. **Search** past conversations for relevant context
4. **Maintain continuity** per channel (WhatsApp contacts get their own threads, email threads stay grouped)
5. **Allow the web UI** to view (read-only) conversations from other channels

### Design Principles

- **Conversations are the user-facing concept.** Not "sessions," not "threads," not "chats." The word "conversation" is used consistently in all UI, APIs, and internal code.
- **The agent manages topic coherence, not the system.** There is no automatic topic segmentation. If a conversation drifts across topics, that is natural and the agent handles it.
- **Compression and abbreviation are separate operations.** Compression fits more into the context window (SDK-managed). Abbreviation creates a searchable summary on transition (application-managed). They never interact.
- **Privacy by default.** All conversation data lives in `.my_agent/` (gitignored). Transcripts contain the user's actual messages and must never leak to the public repo.

---

## Terminology

These terms are used consistently across all code, APIs, UI, and documentation:

| Term                       | Definition                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conversation**           | A continuous exchange between the user and the agent. The primary user-facing concept. Used in all UI labels, API endpoints, and agent language. Never "session," "thread," or "chat" in user-facing contexts.                                                 |
| **Transcript**             | The durable, append-only record of a conversation. Stored as JSONL. One file per conversation. The source of truth.                                                                                                                                            |
| **Turn**                   | A single user message + agent response pair. The atomic unit of a conversation.                                                                                                                                                                                |
| **Working context**        | The portion of a conversation currently loaded in the Agent SDK's context window. May be compressed. Not the same as the full transcript.                                                                                                                      |
| **Compression**            | Fitting more into the context window. Triggered when context fills up. Output is a compressed transcript the agent uses to continue the conversation. Managed by the Agent SDK.                                                                                |
| **Abbreviation**           | A ~100-200 token meeting-notes-style summary of a conversation, generated by Haiku on transition events. Used for semantic indexing (vector search). Not the same as compression.                                                                              |
| **Index**                  | The searchable representation of conversation content. Two parts: abbreviation embeddings in SQLite-vec (vector search) and full transcript text in FTS5 (keyword search).                                                                                     |
| **Channel**                | The communication medium (web, WhatsApp, email). Each channel has its own continuity rules.                                                                                                                                                                    |
| **Conversation ID**        | A stable, unique identifier for each conversation. Format: `conv-{ulid}` (e.g., `conv-01HQXK5J7G8M3N4P5R6S7T8V9W`). Never changes after creation. The display name is a separate property (`title`).                                                           |
| **External Communication** | An exchange between the agent and a third party on a channel. NOT a conversation. Governed by trust tiers and escalation policies. Displayed in a separate UI area, not the conversation sidebar. See `channels.md` §Conversations vs External Communications. |

### Language Rules

- **User-facing (UI, agent speech):** Always "conversation." ("Let me check our previous conversations," "Starting a new conversation," "Conversation history.")
- **Code/API:** `conversation` in all identifiers. `conversationId`, `getConversation()`, `listConversations()`, `/api/conversations`.
- **Internal/technical:** "transcript" when referring to the JSONL file, "index" when referring to search data, "working context" when referring to what is in the SDK context window.

---

## Conversation Lifecycle

All conversations are **always resumable**. There is no "closed" state. A conversation can be returned to at any time, even months later.

```
CREATE → ACTIVE → (COMPRESS) → ACTIVE → ... → IDLE → ABBREVIATE
                                                ↑           │
                                                └───────────┘
                                              (user returns)
```

### States

| State          | Description                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Created**    | A new conversation is initialized. Transcript file created. Conversation ID assigned.                                                                                                                       |
| **Active**     | Messages are being exchanged. Each turn is appended to the transcript. Turns are indexed into FTS in real-time. The working context contains the recent history.                                            |
| **Compressed** | The working context has been compressed by the Agent SDK (automatic, when approaching context limits). The full transcript is unaffected. Compression is purely about fitting more into the context window. |
| **Idle**       | No messages for 10 minutes. Abbreviation is triggered in the background for search indexing. **The conversation remains resumable.**                                                                        |

### State Transitions

```
                    ┌──────────────────────┐
                    │                      │
                    ▼                      │
CREATE ──► ACTIVE ──► COMPRESS ──► ACTIVE ─┘
              │                       │
              │  (10min idle)         │  (10min idle)
              ▼                       ▼
          ABBREVIATE ◄────────────────┘
              │
              │  (user returns)
              ▼
           ACTIVE (resume from transcript)
```

### Creating a Conversation

A conversation is created when:

- **Web:** User sends their first message after page load (if no active conversation exists)
- **WhatsApp:** A message arrives from a contact that has no active conversation
- **Email:** An email arrives that does not match an existing conversation's thread

On creation:

1. Generate a stable conversation ID: `conv-{ulid}` (ULID provides time-ordered uniqueness)
2. Create the transcript file: `.my_agent/conversations/conv-{ulid}.jsonl`
3. Write the metadata header (first line of JSONL): `{ "type": "meta", "id": "conv-...", "channel": "...", "created": "...", "participants": [...] }`
4. Insert row into `conversations` table with `title = NULL`
5. The conversation title is initially null (displayed as "New conversation"). Auto-naming happens at turn 5.

### Resuming a Conversation

A conversation can be resumed after:

- **Page refresh / reconnection** (web): The server loads the most recent active web conversation and hydrates the working context from the transcript tail.
- **Process restart**: Same as refresh. The transcript is the durable state.
- **Explicit selection**: User picks a past conversation from the sidebar. The transcript is loaded and the agent resumes with context from that conversation.

Resume mechanics:

1. Read the transcript file (tail N turns for working context)
2. Create a new Agent SDK query with `continue: true` and the loaded context as preceding turns
3. The conversation continues seamlessly

### Abbreviation Trigger (Idle Timeout)

Abbreviation is triggered when a conversation goes idle. There is no "close" — all conversations remain resumable.

**Triggers:**

- **Idle timeout:** 10 minutes of inactivity triggers abbreviation
- **Conversation switch:** When user starts or switches to a different conversation

On idle:

1. Queue abbreviation generation (background, non-blocking)
2. Generate an abbreviation via Haiku (~100-200 tokens, meeting-notes style)
3. Embed the abbreviation (ONNX, local) and store in the vector index
4. Append `abbreviation` event to transcript

The conversation remains fully resumable. User can return at any time.

Short conversations (even 1-turn) receive no special handling — they are abbreviated on idle like any other conversation.

### Idle Timer (Abbreviation Trigger)

A single per-conversation idle timer operates:

| Timer            | Duration   | Effect                                    |
| ---------------- | ---------- | ----------------------------------------- |
| **Idle timeout** | 10 minutes | Triggers abbreviation for search indexing |

- Timer resets on every user message (or incoming channel message)
- After 10 minutes of inactivity, abbreviation runs in the background
- **All conversations are always resumable** — there is no "closed" state
- User can return to any conversation at any time, even months later
- On page load, the most recent conversation (by `updated` timestamp) is loaded

### Compression

Compression is handled by the Agent SDK automatically when the working context approaches the model's context window limit. This is **not** the same as abbreviation. Compression exists solely to fit more into the context window.

When compression occurs:

1. The SDK compresses older turns into a summary
2. The working context shrinks but retains the summary + recent turns
3. The compressed summary feeds back into the working context (the agent continues with it)
4. The full transcript is **not** affected --- it remains complete and append-only
5. No indexing or abbreviation is triggered by compression

---

## Channel Continuity Rules

Each channel has its own rules for how conversations are scoped and maintained. This is a core architectural decision: **conversation continuity is channel-specific.**

### Web (Dashboard)

| Aspect               | Rule                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| **Scope**            | Single user, single conversation at a time                                      |
| **Default**          | On page load, resume the most recent web conversation (by `updated`)            |
| **New conversation** | User explicitly starts one (button or command)                                  |
| **Idle**             | 10 minutes of inactivity triggers abbreviation (conversation remains resumable) |
| **History**          | Sidebar shows past web conversations, click to resume                           |
| **Multi-tab**        | Real-time sync across tabs (single SDK session, broadcast to all WS)            |

### WhatsApp (M3)

| Aspect               | Rule                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| **Scope**            | One active conversation **per contact**                                         |
| **Default**          | Message from a known contact continues their existing conversation              |
| **New conversation** | New contact, or explicit reset command from the contact                         |
| **Idle**             | 10 minutes of inactivity triggers abbreviation (conversation remains resumable) |
| **History**          | Past conversations with a contact are searchable but not shown in WhatsApp UI   |
| **Group chats**      | One conversation per group (scoped by group ID, not individual)                 |

### Email (M6)

| Aspect               | Rule                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| **Scope**            | One conversation **per email thread** (by `In-Reply-To` / `References` headers) |
| **Default**          | Reply to an existing thread continues that conversation                         |
| **New conversation** | New email with no thread reference starts a new conversation                    |
| **Idle**             | 10 minutes of inactivity triggers abbreviation (conversation remains resumable) |
| **History**          | Email threads are naturally archived by the email system                        |

### Channel Metadata in Transcripts

Each turn in a transcript includes channel metadata:

```jsonl
{ "type": "turn", "role": "user", "content": "...", "channel": "whatsapp", "sender": "+1555000000", "timestamp": "..." }
{ "type": "turn", "role": "assistant", "content": "...", "channel": "whatsapp", "timestamp": "..." }
```

This allows the web UI to display conversations from any channel with proper attribution.

---

## Default Conversation Behavior

### Web UI Default

When a user opens the web dashboard:

1. Check for an active (non-closed) web conversation
2. **If found:** Resume it. Load the last N turns into the chat view. The agent has continuity.
3. **If not found:** Show the empty chat state with a greeting. A new conversation is created on first message.

This means refreshing the page does not lose context. The user picks up where they left off.

### "New Conversation" Action

The user can explicitly start a new conversation via:

- A "New conversation" button in the sidebar or header
- A slash command (`/new`)

This starts a fresh conversation. The agent has no context from the previous conversation (unless it uses the recall tools to search).

---

## Slash Commands

Commands that work on both web and channel conversations. Slash commands are intercepted before reaching the LLM — they provide instant, deterministic responses with no token cost.

### `/new` — Reset Conversation

Creates a fresh conversation. Behavior differs by channel type:

**Web conversations:**

- Simply creates a new conversation
- The old conversation stays in the sidebar as a regular conversation (already deletable/continuable)
- No pinning logic needed

**Channel conversations (WhatsApp, Email):**

- The current conversation becomes "unpinned" and:
  - Moves to the main conversation list (no longer in Channels section)
  - Can be deleted
  - Can be continued via web dashboard (responses stay in dashboard only)
  - Keeps channel icon to indicate origin
- A new "pinned" conversation is created for that channel/party
- The new conversation inherits the currently active model

**Key rule:** Channel messages always route to the pinned conversation. Unpinned conversations are web-only for continuation.

### `/model` — Switch Model

Change the AI model for the current conversation.

| Command         | Effect                                    |
| --------------- | ----------------------------------------- |
| `/model`        | Shows current model and available options |
| `/model opus`   | Switch to Claude Opus                     |
| `/model sonnet` | Switch to Claude Sonnet                   |
| `/model haiku`  | Switch to Claude Haiku                    |

Model persists per conversation — same behavior as the web UI model selector dropdown. Switching models mid-conversation is useful for:

- Complex reasoning tasks (→ Opus)
- Quick responses (→ Haiku)
- General use (→ Sonnet)

### Implementation Notes

- Commands are detected and handled in `message-handler.ts` (channels) and `chat-handler.ts` (web)
- Processing happens **before** any brain/LLM call
- Response is sent directly back to the channel/client
- Dashboard is notified via WebSocket events for state synchronization

---

## Cross-Channel Viewing in Web UI

The web dashboard is the **primary interface** for viewing all conversations across all channels. Channel conversations are **read-only** in the web UI --- the user cannot reply to a WhatsApp contact through the web (the channel plugin handles responses).

### Sidebar Design

```
Conversations
├── Active
│   ├── [web]      autumn-wind-drifts         (2 min ago)
│   ├── [whatsapp] Hanan - server-check       (15 min ago)
│   └── [email]    Sarah - pricing-follow-up  (1 hour ago)
├── Recent
│   ├── [web]      morning-tea-break          (yesterday)
│   ├── [whatsapp] Hanan - login-bug          (2 days ago)
│   └── ...
└── Search...
```

### Viewing Rules

| Action                            | Behavior                                               |
| --------------------------------- | ------------------------------------------------------ |
| Click active web conversation     | Switch to it, full read-write                          |
| Click active channel conversation | View transcript read-only, live updates                |
| Click recent conversation         | View transcript read-only                              |
| Search                            | Semantic search across all conversations, all channels |

### Channel Indicators

Each conversation shows its channel origin with an icon and label:

- Web: globe icon, no label (default)
- WhatsApp: WhatsApp icon, contact name
- Email: envelope icon, sender name + subject

---

## Mixed Topic Handling

**Decision: No automatic topic segmentation.** This was explicitly discussed and decided.

### Rationale

Real conversations naturally drift across topics. A user might start talking about a server issue, mention a customer's birthday, and ask about a project status --- all in one conversation. Artificial segmentation would:

1. **Break natural flow** --- the user does not think in discrete topics
2. **Add complexity** --- topic detection is unreliable and would create false boundaries
3. **Lose context** --- the transition between topics often carries important context ("while you're fixing the server, also check the login bug Sarah mentioned")

### The Agent's Responsibility

The agent (Nina) handles mixed topics naturally:

- Recognizes topic shifts without needing system-level segmentation
- Can reference earlier topics in the same conversation
- Uses conversation naming to capture the dominant themes (see auto-naming with topic arrays)
- When abbreviating, the summary captures semantic content across topic boundaries

### When Topics Suggest a New Conversation

The agent may **suggest** starting a new conversation if the current one has become unwieldy ("We've covered a lot of ground --- want me to start a fresh conversation for the new project?"). But this is the agent's judgment, not a system rule.

---

## Conversation Naming

Conversations receive a short, descriptive auto-generated title. This happens at a specific point in the conversation, not immediately.

### Timing

- **Turn 5 (initial):** After the 5th user message, the system generates a title for the conversation. Earlier turns are often greetings or context-setting. By turn 5, the conversation has enough substance to name meaningfully.
- **On idle (periodic):** When the abbreviation queue processes a conversation after idle timeout, it also re-generates the title (if 10+ turns since last rename). As conversations evolve, the name stays relevant to the current content.
- **Manual override:** Users can rename a conversation at any time via inline edit in the chat header. Once manually renamed, auto-naming never overrides the user's choice (the `manuallyNamed` flag protects it).

### Title Format

The name is a short, descriptive phrase in title case (2-6 words, max 80 characters):

```
Server Monitoring Setup
Debugging the Login Flow
Weekend Trip Planning
Quick Math Questions
```

### Multi-Topic Detection

When generating the name, the agent also identifies the conversation's topics. This serves two purposes:

1. **Naming:** The title reflects the dominant theme
2. **Search metadata:** Topic tags improve search relevance

### Topic Arrays

Each conversation has a `topics` array in its metadata. Updated at naming time and on significant topic shifts:

```json
{
  "type": "meta_update",
  "name": "autumn-wind-drifts",
  "topics": ["server-monitoring", "deployment"],
  "timestamp": "2026-02-14T10:30:00Z"
}
```

Topics are short kebab-case labels. The agent generates them based on conversation content. They are **not** user-facing categories --- they are metadata for search and organization.

### Title Display

| Location       | Display                                                 |
| -------------- | ------------------------------------------------------- |
| Sidebar        | Title + relative time                                   |
| Chat header    | Title (click to view/edit)                              |
| Search results | Title + topic tags + preview snippet                    |
| API            | `id` is always stable ULID; `title` is the display name |

### Channel-Specific Naming (Future — M3/M6)

Web conversations use the auto-naming system described above. WhatsApp and Email conversations will need different naming strategies:

- **WhatsApp:** Title may include contact name + topic (e.g., "Hanan — server-check")
- **Email:** Title may derive from email subject line + thread context

These are deferred to their respective milestones (M3 for WhatsApp, M6 for Email). The `NamingService` interface is channel-agnostic and can be extended with channel-specific prompts.

### Before Turn 5

Before the title is generated, the conversation appears as:

- Sidebar: "New conversation" + relative time
- Chat header: "New conversation"
- API: `title` is null, `id` remains the stable ULID

Once the title is generated, the `title` field is populated and a `title_assigned` event is appended to the transcript. **The conversation ID never changes.**

### Manual Naming Protection

When a user manually renames a conversation, the `manuallyNamed` flag is set to `true`. This permanently protects the title from auto-rename:

- Turn 5 auto-naming checks for an existing title and skips if one exists
- Idle-triggered re-naming checks `manuallyNamed` and skips if `true`
- Only the user can change a manually-named title (by editing it again)

---

## Three Representations

Every conversation exists in three forms, each serving a different purpose:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  1. TRANSCRIPT (JSONL)                                   │
│     ├── Complete, append-only                            │
│     ├── Source of truth                                  │
│     ├── One file per conversation                        │
│     ├── Indexed into FTS in real-time (every turn)       │
│     └── Lives in .my_agent/conversations/                │
│                                                          │
│  2. INDEX (SQLite — FTS5 + vec)                          │
│     ├── FTS5: full-text search over transcript turns     │
│     ├── SQLite-vec: embedded abbreviations (one per      │
│     │   conversation, ~100-200 tokens each)              │
│     ├── Shared database for all conversations            │
│     └── Lives in .my_agent/conversations/conversations.db│
│                                                          │
│  3. WORKING CONTEXT                                      │
│     ├── What the Agent SDK currently has loaded           │
│     ├── May be compressed (summary + recent turns)       │
│     ├── Ephemeral — rebuilt from transcript on resume    │
│     └── Lives in Agent SDK memory (process RAM)          │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Relationship Between Representations

```
TRANSCRIPT ──── source of truth, always complete
    │
    ├──► FTS INDEX ──── derived, keyword search (built in real-time per turn)
    │
    ├──► ABBREVIATION ──► VECTOR INDEX ──── derived, semantic search
    │     (Haiku, on transition)         (one embedding per conversation)
    │
    └──► WORKING CONTEXT ──── derived, for active conversation
                               (built on resume from transcript tail)
```

The transcript is the canonical record. The FTS index, abbreviations, and working context are all derived from it. If the index is lost, FTS can be rebuilt from transcripts and abbreviations can be regenerated. If the working context is lost (process crash), it can be rebuilt from the transcript tail.

---

## Transcript (JSONL)

### Format

Each transcript is a JSONL (JSON Lines) file. One JSON object per line. Append-only.

```jsonl
{"type":"meta","id":"conv-01HQXK5J7G8M3N4P5R6S7T8V9W","channel":"web","created":"2026-02-14T09:00:00Z","participants":["user"]}
{"type":"turn","role":"user","content":"Good morning! Can you check the server status?","timestamp":"2026-02-14T09:00:01Z","turnNumber":1}
{"type":"turn","role":"assistant","content":"Good morning! Let me check that for you...","timestamp":"2026-02-14T09:00:05Z","turnNumber":1,"thinkingText":"I should check the production server...","usage":{"input":1200,"output":350},"cost":0.004}
{"type":"turn","role":"user","content":"Also, what's the status of the login bug?","timestamp":"2026-02-14T09:02:00Z","turnNumber":2}
{"type":"turn","role":"assistant","content":"The login bug is...","timestamp":"2026-02-14T09:02:08Z","turnNumber":2,"usage":{"input":1800,"output":500},"cost":0.006}
{"type":"event","event":"title_assigned","title":"autumn-wind-drifts","topics":["server-monitoring","login-bug"],"timestamp":"2026-02-14T09:10:00Z"}
{"type":"event","event":"compression","compressedThrough":3,"summary":"User asked about server status (healthy) and login bug (in progress)...","timestamp":"2026-02-14T09:30:00Z"}
{"type":"event","event":"abbreviation","text":"Checked production server status (healthy). Discussed login bug — still in progress, assigned to backend team. User asked for ETA, agent estimated end of week. No decisions pending.","timestamp":"2026-02-14T13:00:01Z"}
```

### Line Types

| Type          | Purpose                            | Fields                                                                                                  |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `meta`        | Conversation metadata (first line) | `id`, `channel`, `created`, `participants`                                                              |
| `turn`        | A message in the conversation      | `role`, `content`, `timestamp`, `turnNumber`, `thinkingText?`, `usage?`, `cost?`, `channel?`, `sender?` |
| `event`       | Lifecycle events                   | `event` (title_assigned, compression, close, abbreviation, meta_update), event-specific fields          |
| `meta_update` | Update to conversation metadata    | `title?`, `topics?`, `timestamp`                                                                        |

### Turn Numbering

Turns are numbered sequentially starting at 1. A turn consists of a user message + assistant response. Both share the same `turnNumber`. This makes it easy to count turns for the naming trigger.

### Why JSONL

- **Append-only:** New turns are appended without rewriting the file. Safe against partial writes.
- **Streamable:** Can read line-by-line without loading the entire file into memory.
- **Simple:** No schema migrations, no database, no dependencies. `fs.appendFileSync()`.
- **Inspectable:** Can be read with `cat`, `jq`, `tail -f`. Useful for debugging.
- **Rebuilable:** The index can always be rebuilt from JSONL files.

---

## Index (SQLite — FTS5 + vec)

### Purpose

The index makes conversation content searchable via two complementary mechanisms:

1. **FTS5 (full-text search):** Keyword search over full transcript turns. Built in real-time as turns are appended.
2. **SQLite-vec (vector search):** Semantic search over conversation abbreviations. One embedding per conversation, generated on transition.

### Database Location

```
.my_agent/conversations/conversations.db
```

Single database file alongside the transcript JSONL files. Contains metadata, FTS index, and vector embeddings for all conversations across all channels.

### Schema

```sql
-- Conversation metadata
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,           -- stable ULID (e.g., 'conv-01HQXK5J7G8M3N4P5R6S7T8V9W')
    channel TEXT NOT NULL,         -- 'web', 'whatsapp', 'email'
    title TEXT,                    -- display name (null before turn 5)
    topics TEXT,                   -- JSON array of topic strings
    created TEXT NOT NULL,         -- ISO timestamp
    updated TEXT NOT NULL,         -- last activity timestamp (for sorting)
    turn_count INTEGER DEFAULT 0,  -- number of turns (for naming trigger)
    participants TEXT,             -- JSON array of participant identifiers
    abbreviation TEXT,             -- ~100-200 token meeting-notes summary (null until idle)
    needs_abbreviation INTEGER DEFAULT 0, -- 1 if abbreviation failed and needs retry
    manually_named INTEGER DEFAULT 0  -- 1 if user manually set the title (protects from auto-rename)
);

-- Vector index over abbreviations (one per conversation)
CREATE VIRTUAL TABLE abbreviations_vec USING vec0(
    conversation_id TEXT PRIMARY KEY,  -- FK to conversations.id
    embedding FLOAT[384]               -- vector embedding of the abbreviation
);

-- Full-text search over transcript turns (real-time)
CREATE VIRTUAL TABLE turns_fts USING fts5(
    content,                       -- turn text (role-prefixed: "User: ..." / "Assistant: ...")
    conversation_id UNINDEXED,     -- FK to conversations.id
    turn_number UNINDEXED,
    timestamp UNINDEXED
);
```

### Embedding Model

Abbreviation embeddings are generated using an ONNX model. Runs locally with no API calls.

| Property       | Value                                                 |
| -------------- | ----------------------------------------------------- |
| **Model**      | `all-MiniLM-L6-v2` (or similar ONNX-compatible model) |
| **Dimensions** | 384 (depends on model)                                |
| **Runtime**    | ONNX Runtime for Node.js (`onnxruntime-node`)         |
| **Location**   | `.my_agent/models/` (downloaded once, gitignored)     |
| **Cost**       | Zero (local inference)                                |

### Abbreviation Generation

On idle events, Haiku generates a concise meeting-notes-style abbreviation:

| Property                | Value                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **Model**               | Haiku                                                                                   |
| **Trigger**             | Idle events (conversation switch or 10min idle timeout)                                 |
| **Output**              | ~100-200 tokens                                                                         |
| **Prompt**              | "Abbreviate this conversation. Keep entities, decisions, open threads. ~100-200 words." |
| **Preserves**           | Key topics, entities, decisions made/pending, context for resuming                      |
| **Drops**               | Pleasantries, repetition, thinking-out-loud                                             |
| **Short conversations** | No special handling. Even 1-turn conversations get abbreviated on idle.                 |

The abbreviation is stored both in the transcript (as an `abbreviation` event) and in the `conversations` table for quick access. It is then embedded and stored in `abbreviations_vec` for vector search.

---

## Working Context

The working context is the ephemeral, in-memory representation of the conversation as seen by the Agent SDK. It is **not** persisted directly --- it is rebuilt from the transcript when needed.

### Contents

- **System prompt:** Personality, skills, core memory (always loaded)
- **Conversation history:** Recent turns from the transcript
- **Compression summary:** If the SDK has compressed earlier turns, the summary is part of the working context

### Hydration (Loading from Transcript)

When resuming a conversation:

1. Read the transcript file
2. Load the last N turns (configurable, default: 20 turns or last 8000 tokens, whichever is smaller)
3. If a compression event exists in the transcript, include the compression summary as a "preceding context" block
4. Create a new Agent SDK query with this context

### Compression Events

When the Agent SDK compresses the working context:

1. The compression summary is appended to the transcript as an event:
   ```jsonl
   {
     "type": "event",
     "event": "compression",
     "compressedThrough": 15,
     "summary": "The user discussed...",
     "timestamp": "..."
   }
   ```
2. `compressedThrough` indicates the last turn number that was compressed
3. The compressed summary feeds back into the working context so the agent can continue
4. On next hydration, the summary is used as context for turns after `compressedThrough`
5. Compression does **not** trigger abbreviation or any indexing --- it is purely a context-window management operation

---

## Indexing System

### Philosophy

Indexing has two paths, each serving a different search need:

1. **FTS indexing (real-time):** Every turn is inserted into the FTS5 index as it is appended to the transcript. This enables keyword search across all conversations at all times.
2. **Abbreviation + embedding (on transition):** When a conversation transitions, Haiku generates an abbreviation which is embedded and stored in the vector index. This enables semantic search across conversations.

Neither path is related to compression. Compression is purely an Agent SDK context-window operation.

### FTS Indexing (Real-Time)

Every turn is indexed into FTS5 as it happens:

1. User sends a message → append to transcript → insert into `turns_fts`
2. Agent responds → append to transcript → insert into `turns_fts`

This is synchronous and fast (microsecond-level FTS5 insert). No batching, no queuing.

### Abbreviation Indexing (On Idle)

Triggered when a conversation goes idle:

| Trigger                 | When                                                      |
| ----------------------- | --------------------------------------------------------- |
| **Conversation switch** | User starts a new conversation or selects a different one |
| **Idle timeout**        | 10 minutes of inactivity                                  |

On transition:

1. Send the transcript to Haiku with the abbreviation prompt
2. Receive ~100-200 token meeting-notes summary
3. Append `abbreviation` event to the transcript
4. Store the abbreviation text in the `conversations` table
5. Embed the abbreviation (ONNX, local)
6. Insert into `abbreviations_vec`

### Background Abbreviation

**Abbreviation is non-blocking.** It runs in the background and does not delay conversation switching or the user's next message.

Implementation:

- Transition events are queued
- A background worker processes the queue serially (avoids duplicate work)
- The worker calls Haiku, runs embedding, and writes to SQLite
- Conversation switching proceeds immediately regardless of abbreviation status

### Abbreviation Failure Handling

If abbreviation fails (rate limit, network error, API outage):

1. **Do not block the user.** Conversation switch proceeds normally.
2. **Set `needs_abbreviation = 1`** in the conversations table.
3. **Log the error** with conversation ID and reason.
4. **Retry on next startup** (recovery flow checks `needs_abbreviation = 1`).
5. **Retry on idle check** (every 5 minutes, check for pending abbreviations).

If embedding fails after successful abbreviation:

1. **Store the abbreviation text** anyway (still useful for display/search).
2. **Set `needs_abbreviation = 1`** (will retry embedding on next pass).
3. **FTS search still works** — only vector search is degraded.

The system degrades gracefully: FTS search always works, vector search requires successful embedding.

```typescript
// Pseudocode
class AbbreviationQueue {
  private queue: AbbreviationTask[] = [];

  enqueue(conversationId: string): void {
    this.queue.push({ conversationId });
    this.processNext(); // non-blocking
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const task = this.queue.shift()!;
    const transcript = await this.loadTranscript(task.conversationId);
    const abbreviation = await this.abbreviateWithHaiku(transcript);
    const embedding = await this.embed(abbreviation);
    await this.store(task.conversationId, abbreviation, embedding);
    this.processing = false;
    this.processNext();
  }
}
```

---

## Compression vs Abbreviation

These are two separate operations with different purposes. This distinction is a key architectural decision.

```
                    COMPRESSION                         ABBREVIATION
                    ───────────                         ────────────
Purpose:            Fit more into context window         Semantic indexing for search
Trigger:            Context fills up (SDK auto)          TRANSITION events (switch, close, 30min idle)
Timing:             Real-time (during conversation)      Background (async, on transition)
Input:              Working context                      Full transcript
Output:             Compressed transcript                ~100-200 token meeting notes
                    (for agent to continue)              (for vector search)
Preserves:          Enough for agent continuity          Entities, decisions, open threads
Drops:              Detail from older turns              Pleasantries, repetition, thinking-out-loud
Affects transcript: No (transcript stays complete)       Yes (abbreviation event appended)
Reversible:         No (summary replaces detail          Yes (regenerate from transcript)
                    in working context)
Managed by:         Agent SDK                            Application code (Haiku call)
Output stored in:   Working context (RAM)                SQLite-vec (embedded) + transcript (text)
```

### Why They Are Separate

A conversation might be compressed multiple times during a long session but abbreviated only once (on transition). Conversely, a short 1-turn conversation might never be compressed but still gets abbreviated when it closes.

- **Compression** keeps the agent functional within its context window.
- **Abbreviation** makes the conversation findable via semantic search later.

They never interact. Compression does not trigger abbreviation. Abbreviation does not depend on whether compression occurred.

---

## Data Flow Diagram

How data moves between representations:

```
                         ┌──────────────────────┐
                         │   Working Context     │
                         │   (SDK RAM)           │
                         └──────┬───────▲────────┘
                                │       │
                          append │       │ hydrate (tail N turns)
                                │       │
                         ┌──────▼───────┴────────┐
                         │   Transcript (JSONL)   │◄──── source of truth
                         │   append-only          │
                         └──┬────────────────┬────┘
                            │                │
              real-time     │                │    on TRANSITION
              (every turn)  │                │    (switch/close/idle)
                            │                │
                    ┌───────▼──────┐    ┌────▼──────────────┐
                    │  FTS Index   │    │  Abbreviation     │
                    │  (FTS5)      │    │  (Haiku, ~100-200 │
                    │              │    │   tokens)          │
                    └───────┬──────┘    └────┬──────────────┘
                            │                │
                            │           embed (ONNX, local)
                            │                │
                            │         ┌──────▼──────────┐
                            │         │  Vector Index    │
                            │         │  (SQLite-vec)    │
                            │         └──────┬──────────┘
                            │                │
                    ┌───────▼────────────────▼───┐
                    │        Search               │
                    │  FTS (keywords) + Vector    │
                    │  (semantic) → merge & rank  │
                    └────────────────────────────┘

  Compression path (separate, SDK-managed):

    Context fills up → Haiku compress → back to Working Context
    (no interaction with indexing or abbreviation)
```

---

## Semantic Search

### Search Architecture

Search combines two strategies, each operating at a different level:

```
Query (natural language)
    │
    ├──► [Vector search abbreviations]
    │        Embed query (ONNX) → cosine similarity vs abbreviation embeddings
    │        → Top K conversation IDs by semantic similarity
    │
    ├──► [FTS search transcripts]
    │        BM25 keyword match across all turns
    │        → Top K conversation IDs by term frequency
    │
    └──► Merge & rank conversation IDs
              → Load relevant transcripts
              → Return specific turns
```

**Key insight:** Vector search operates on abbreviations (conversation-level), while FTS operates on transcript turns (turn-level). Both produce conversation IDs that are merged and ranked before loading actual turn content.

### Hybrid Search

The search uses a hybrid approach combining vector similarity on abbreviations and keyword matching on transcripts:

| Component                      | Searches over                        | Purpose                                                                                      |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Vector search (SQLite-vec)** | Abbreviations (one per conversation) | Semantic similarity --- finds conceptually related conversations even with different wording |
| **BM25 (FTS5)**                | Transcript turns (every turn)        | Keyword matching --- finds exact terms, names, identifiers that embeddings might miss        |

Both paths produce conversation IDs. These are merged, deduplicated, and ranked. The system then loads the relevant transcript turns from the top-ranked conversations.

### Search Parameters

| Parameter        | Default    | Description                                      |
| ---------------- | ---------- | ------------------------------------------------ |
| `query`          | (required) | Natural language search query                    |
| `limit`          | 10         | Maximum number of conversations to return        |
| `channel`        | (all)      | Filter by channel                                |
| `dateRange`      | (all)      | Filter by date range                             |
| `conversationId` | (all)      | Search within a specific conversation (FTS only) |

### Search Response

```typescript
interface SearchResult {
  conversationId: string;
  conversationName: string | null;
  channel: string;
  abbreviation: string; // the conversation's abbreviation
  matchedTurns: number[]; // turn numbers that matched (from FTS)
  timestamp: string;
  score: number; // hybrid score (0-1)
  topics: string[];
}
```

---

## Agent Recall Tools

The agent has two tools for accessing past conversations. These are MCP tools exposed to the brain.

### `search_conversations`

Search across all past conversations using natural language.

```typescript
interface SearchConversationsInput {
  query: string; // Natural language query
  channel?: string; // Filter: 'web', 'whatsapp', 'email'
  dateRange?: {
    from?: string; // ISO date
    to?: string; // ISO date
  };
  limit?: number; // Max results (default: 10)
}

interface SearchConversationsOutput {
  results: Array<{
    conversationId: string;
    conversationName: string | null;
    channel: string;
    snippet: string; // Relevant text (from abbreviation or matched turns)
    turnRange: string; // e.g., "turns 5-8"
    date: string; // Human-readable date
    score: number;
    topics: string[];
  }>;
  totalMatches: number;
}
```

**Usage by the agent:**

- "Let me check if we discussed this before..." + `search_conversations({ query: "server monitoring setup" })`
- "I recall Sarah mentioned something about pricing..." + `search_conversations({ query: "Sarah pricing", channel: "email" })`

### `fetch_context`

Load specific turns from a conversation transcript. Used after `search_conversations` identifies a relevant conversation.

```typescript
interface FetchContextInput {
  conversationId: string; // Which conversation
  turnRange?: {
    from: number; // Start turn (inclusive)
    to: number; // End turn (inclusive)
  };
  // If turnRange not specified, returns the last 10 turns
}

interface FetchContextOutput {
  conversationId: string;
  conversationName: string | null;
  channel: string;
  turns: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    turnNumber: number;
  }>;
  totalTurns: number;
}
```

**Usage by the agent:**

- After finding a relevant conversation via search, the agent fetches the specific turns for full context
- "Let me pull up the exact conversation..." + `fetch_context({ conversationId: "web_20260210_morning-code-flows", turnRange: { from: 5, to: 10 } })`

### Tool Availability

| Context             | search_conversations       | fetch_context |
| ------------------- | -------------------------- | ------------- |
| Brain (any channel) | Yes                        | Yes           |
| Project sessions    | No (use project CLAUDE.md) | No            |
| Ad-hoc agents       | Configurable               | Configurable  |

---

## Data Model

### Conversation Interface

```typescript
interface Conversation {
  /** Stable unique ID: conv-{ulid} */
  id: string;

  /** Communication channel */
  channel: "web" | "whatsapp" | "email";

  /** Display name (null before turn 5) */
  title: string | null;

  /** Topic tags (updated at naming and on significant shifts) */
  topics: string[];

  /** When the conversation was created */
  created: Date;

  /** When the conversation was last active (for sorting, idle timer) */
  updated: Date;

  /** Number of turns in the conversation (for naming trigger at turn 5) */
  turnCount: number;

  /** Abbreviation text (~100-200 tokens, null until idle timeout triggers) */
  abbreviation: string | null;

  /** Participants (user IDs, contact names, email addresses) */
  participants: string[];

  /** Whether the user manually set the title (protects from auto-rename) */
  manuallyNamed: boolean;

  /** Channel-specific metadata */
  channelMeta?: {
    /** WhatsApp: contact phone number */
    contactNumber?: string;
    /** Email: thread ID, subject line */
    threadId?: string;
    subject?: string;
    /** WhatsApp: group JID */
    groupId?: string;
  };
}

// Note: There is no "state" or "closed" field.
// All conversations are always resumable. The idle timer triggers
// abbreviation for search indexing, but does not "close" the conversation.
```

### AbbreviationRecord Interface

```typescript
interface AbbreviationRecord {
  /** Parent conversation ID */
  conversationId: string;

  /** The abbreviation text (~100-200 tokens, meeting-notes style) */
  text: string;

  /** When the abbreviation was generated */
  timestamp: Date;

  /** Vector embedding of the abbreviation (dimension depends on model) */
  embedding: Float32Array;
}
```

### TranscriptLine Types

```typescript
type TranscriptLine = TranscriptMeta | TranscriptTurn | TranscriptEvent;

interface TranscriptMeta {
  type: "meta";
  id: string;
  channel: string;
  created: string;
  participants: string[];
}

interface TranscriptTurn {
  type: "turn";
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  turnNumber: number;
  /** Agent's thinking text (if extended thinking was used) */
  thinkingText?: string;
  /** Token usage for this turn */
  usage?: { input: number; output: number };
  /** Cost in USD for this turn */
  cost?: number;
  /** Channel the message came from (for cross-channel conversations) */
  channel?: string;
  /** Sender identifier (phone number, email, etc.) */
  sender?: string;
}

interface TranscriptEvent {
  type: "event";
  event: "title_assigned" | "compression" | "abbreviation" | "meta_update";
  timestamp: string;
  /** title_assigned: the display name */
  title?: string;
  /** title_assigned, meta_update: topic tags */
  topics?: string[];
  /** compression: last turn number that was compressed */
  compressedThrough?: number;
  /** compression: the summary text */
  summary?: string;
  /** abbreviation: the meeting-notes-style summary (~100-200 tokens) */
  text?: string;
}
```

---

## File Structure

All conversation data lives in `.my_agent/` (gitignored, private):

```
.my_agent/
├── conversations/                  # Transcript storage (FLAT — no subdirs)
│   ├── conversations.db            # SQLite: metadata + FTS + vec
│   ├── conv-01HQXK5J7G8M3N4P5R6S7T8V9W.jsonl
│   ├── conv-01HQXL6K8H9N4O5P6R7S8T9U0V.jsonl
│   └── ...
│
├── models/                         # Local embedding model
│   └── all-MiniLM-L6-v2/          # ONNX model files
│       ├── model.onnx
│       ├── tokenizer.json
│       └── config.json
│
├── brain/                          # (existing) personality, memory, skills
├── config.yaml                     # (existing) channel config
└── auth.json                       # (existing) API auth
```

### Directory Creation

Directories are created lazily:

- `conversations/` is created when the first conversation starts
- `models/` is created when the embedding model is first downloaded

### File Naming

Transcript files use stable ULID-based names that **never change**:

- Format: `conv-{ulid}.jsonl`
- Example: `conv-01HQXK5J7G8M3N4P5R6S7T8V9W.jsonl`
- The display name is stored in the `conversations` table as `title`, not in the filename
- No renaming ever happens — the ID is stable from creation

---

## Key Flows

### Flow 1: Web Chat --- Normal Conversation

```
1. User opens dashboard
2. Server checks for active web conversation
   → Found: load transcript tail, hydrate working context
   → Not found: show empty chat (no transcript yet)
3. User sends message
   → If no active conversation: create one (transcript + meta line)
   → Append user turn to transcript + insert into FTS
   → Forward to Agent SDK (working context)
4. Agent responds (streaming)
   → Stream tokens to frontend
   → On completion: append assistant turn to transcript + insert into FTS
5. Repeat steps 3-4
6. At turn 5: auto-generate title + topics
   → Append title_assigned event to transcript
   → Update sidebar
7. User closes tab / refreshes
   → Working context is ephemeral (lost)
   → Transcript persists on disk
8. User returns
   → Resume from step 2
```

### Flow 2: Conversation Switch

```
1. User clicks "New conversation" or selects a past conversation
2. Current conversation:
   → Queue abbreviation generation (background, if not already abbreviated):
     a. Send transcript to Haiku
     b. Receive ~100-200 token abbreviation
     c. Append abbreviation event to transcript
     d. Embed abbreviation (ONNX)
     e. Store in abbreviations_vec
   (FTS is already up-to-date — every turn was indexed in real-time)
   (Current conversation remains resumable — no close event)
3. If new conversation:
   → Start fresh (no transcript until first message)
4. If resuming past conversation:
   → Load transcript tail
   → Hydrate working context
5. Continue chatting
```

### Flow 3: WhatsApp Message Arrives

```
1. WhatsApp plugin receives message from +1555XXXXXX
2. ChannelManager: dedup → debounce → forward to ChannelMessageHandler
3. ChannelMessageHandler checks: is sender in owner_identities for this channel?

   → YES (owner): Route to CONVERSATION flow
     a. Look up active conversation for this channel + owner
        → Found: append to existing transcript
        → Not found: create new conversation (whatsapp channel)
     b. Forward to brain with conversation context
     c. Brain responds → append to transcript → send via WhatsApp
     d. Conversation appears in sidebar (read-only in dashboard,
        source of truth is WhatsApp)

   → NO (external party): Route to EXTERNAL COMMUNICATION flow
     a. Look up external communication record for this party
        → Found: append message to existing record
        → Not found: create new external communication record
     b. Apply trust tier rules:
        - Known: respond within scope boundaries
        - Untrusted: acknowledge receipt, escalate to owner
     c. External communication appears in separate UI area
        (NOT in conversation sidebar)

4. Continue per respective flow
```

**Note:** The identity check uses normalized phone numbers (digits only, stripped of `@s.whatsapp.net` JID suffix) to avoid format mismatches.

**Note:** External communication flow (trust tiers, escalation, separate UI) is fully implemented in M3-S3. M3-S2 stores non-owner messages in a holding table without brain routing.

### Flow 4: Searching Past Conversations

```
1. Agent decides to search (triggered by user question or its own initiative)
2. Agent calls search_conversations({ query: "server monitoring setup" })
3. System:
   → Embed query using ONNX model
   → Vector search: cosine similarity vs abbreviation embeddings
     → Top K conversation IDs by semantic similarity
   → FTS search: BM25 keyword match across transcript turns
     → Top K conversation IDs by term frequency
   → Merge & rank conversation IDs (deduplicate, weighted combination)
   → Load abbreviations + matched turn numbers for top results
4. Agent receives results with abbreviations and conversation IDs
5. Agent optionally calls fetch_context() to load specific turns from a relevant conversation
6. Agent incorporates the recalled context into its response
```

### Flow 5: Abbreviation + Re-naming (Background)

```
1. Idle event fires (conversation switch or 10min idle)
2. AbbreviationQueue receives task: { conversationId }
3. Background worker:
   a. Load full transcript for the conversation
   b. Call Haiku: "Abbreviate this conversation. Keep entities,
      decisions, open threads. ~100-200 words."
   c. Receive abbreviation text (~100-200 tokens)
   d. Append abbreviation event to transcript JSONL
   e. Store abbreviation text in conversations table
   f. Embed abbreviation (ONNX model, local)
   g. Insert embedding into abbreviations_vec table
   h. If NOT manuallyNamed: re-generate title from recent turns
      → Update title and topics in DB
      → Broadcast conversation_renamed to all WebSocket clients
4. Process continues without blocking user interaction
```

Note: FTS indexing is **not** a background flow. It happens synchronously on every turn append (see Indexing System section).

### Flow 6: Process Restart Recovery

```
1. Server process starts
2. Scan .my_agent/conversations/ for all transcript files
3. For each transcript:
   → Read meta line to get conversation state
   → Check if it should be active (based on last turn timestamp + timeout rules)
   → Register in memory (conversation registry)
4. Check FTS integrity:
   → Compare turns_fts count with transcript turn counts
   → Re-insert any missing turns into FTS
5. Check abbreviation integrity:
   → Find conversations where needs_abbreviation = 1
   → Queue abbreviation generation for those conversations
6. Ready to accept connections
```

---

## WebSocket Protocol Messages

The conversation system requires new WebSocket message types for conversation management.

### Client → Server

```typescript
// Start a new conversation (closes current if active)
| { type: "new_conversation" }

// Switch to a different conversation
| { type: "switch_conversation"; conversationId: string }

// Rename current conversation
| { type: "rename_conversation"; title: string }
```

### Server → Client

```typescript
// On connect: send current conversation state and history
| { type: "conversation_loaded"; conversation: ConversationMeta; turns: Turn[]; hasMore: boolean }

// Sidebar: list of conversations
| { type: "conversation_list"; conversations: ConversationMeta[] }

// Real-time: conversation title was updated (turn 5 naming)
| { type: "conversation_renamed"; conversationId: string; title: string }

// Real-time: a new conversation was created
| { type: "conversation_created"; conversation: ConversationMeta }

// Multi-tab: broadcast when conversation updated from another tab
| { type: "conversation_updated"; conversationId: string; turn: Turn }
```

### ConversationMeta Type

```typescript
interface ConversationMeta {
  id: string; // conv-{ulid}
  channel: string; // "web" | "whatsapp" | "email"
  title: string | null; // display name
  topics: string[];
  created: string; // ISO timestamp
  updated: string; // last activity
  turnCount: number;
  // No "state" field — all conversations are always resumable
}
```

### Reconnect Protocol

When a WebSocket connection is established:

1. Server identifies the most recent active web conversation (or none)
2. Server sends `conversation_loaded` with:
   - `conversation`: metadata for the active conversation (or null if none)
   - `turns`: last N turns from transcript
   - `hasMore`: whether there are older turns to paginate
3. Server sends `conversation_list` with recent conversations for sidebar
4. Client renders the chat history and sidebar

If no active conversation exists, `conversation_loaded` is sent with `conversation: null` and `turns: []`. The user starts fresh.

---

## External Communications (M3-S3)

External communications share the same channel transport as conversations but use a separate data model and UI. This section defines the concept; full implementation is in M3-S3.

### What They Are

When a third party (not the owner) messages the agent on a dedicated channel, that exchange is an **external communication**, not a conversation. External communications:

- Use the same `ChannelPlugin` send/receive infrastructure
- Are stored in a separate database table (not `conversations`)
- Do NOT appear in the conversation sidebar
- Are displayed in a dedicated "External Communications" UI area
- Are governed by trust tiers (see `channels.md` §Trust Tiers)
- May have restricted agent autonomy (escalation to owner for unknowns)

### Relationship to Conversations

| Aspect                | Conversation          | External Communication |
| --------------------- | --------------------- | ---------------------- |
| Participants          | Owner ↔ Agent         | Third party ↔ Agent    |
| Trust level           | Full (owner)          | Known or Untrusted     |
| Brain routing         | Immediate             | Trust-dependent        |
| UI location           | Sidebar chat list     | Separate panel         |
| Dashboard interaction | Read-only for non-web | Read-only always       |
| Auto-respond          | Full agent autonomy   | Policy-governed        |

### Data Flow

```
Channel message arrives
  → Identity check (owner_identities)
    → Owner → Conversation flow (this spec)
    → External → ExternalCommunication table
      → Trust tier lookup
      → Policy-based response or escalation
```

### Implementation Status

| Component                         | Sprint | Status   |
| --------------------------------- | ------ | -------- |
| Identity routing + external store | M3-S2  | Complete |
| Trust tier enforcement            | M3-S4  | Planned  |
| External communications UI        | M3-S4  | Planned  |
| Escalation flow                   | M3-S4  | Planned  |
| Personal channel role             | M3-S4  | Planned  |

---

## Relationship to Future Memory System (M4b)

The conversation system and the memory system (M4b) are **complementary but distinct**:

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  CONVERSATION SYSTEM (this spec)                    │
│  ├── "What was said" — verbatim transcripts         │
│  ├── Searchable via abbreviation embeddings + FTS    │
│  ├── Per-conversation, per-channel                  │
│  └── Recall: search_conversations, fetch_context    │
│                                                     │
│  MEMORY SYSTEM (M4b)                                │
│  ├── "What was learned" — extracted insights        │
│  ├── Graph: entities, relations, observations       │
│  ├── Cross-conversation, cross-channel              │
│  └── Recall: search_memory, get_contact, etc.       │
│                                                     │
│  RELATIONSHIP                                       │
│  ├── Memory extracts insights FROM conversations    │
│  ├── Conversations provide the raw material         │
│  ├── Memory is the distilled knowledge              │
│  └── Both are searchable, different granularity     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### How They Connect

1. **Conversation ends** → memory system can extract insights (entities, decisions, learnings)
2. **Agent recalls** → might search conversations (verbatim) OR memory (insights), or both
3. **Daily summaries** (M4b) may reference conversation IDs for traceability
4. **Auto-enrichment** (M4b) enriches incoming messages with memory context, regardless of which conversation they belong to

### What is NOT in this spec

- Entity extraction from conversations (M4b)
- Graph memory (entities, relations, observations) (M4b)
- Daily summaries (M4b)
- Auto-enrichment pipeline (M4b)

These build on top of the conversation system but are not part of it.

---

## Implementation Notes

### Dependencies

| Dependency              | Purpose                                | Notes                              |
| ----------------------- | -------------------------------------- | ---------------------------------- |
| `better-sqlite3`        | SQLite database driver                 | Synchronous API, fast, widely used |
| `sqlite-vec`            | Vector similarity extension for SQLite | Loads as SQLite extension          |
| `onnxruntime-node`      | Local embedding model inference        | ONNX Runtime for Node.js           |
| (no new framework deps) | JSONL is just `fs.appendFileSync`      | Zero dependencies for transcripts  |

### Performance Considerations

- **Transcript writes:** Synchronous `appendFileSync` to ensure durability. Microsecond-level latency.
- **Embedding generation:** ~10-50ms per abbreviation (local ONNX). One embedding per conversation.
- **Vector search:** SQLite-vec can search 100K abbreviation vectors in <10ms. More than sufficient (one vector per conversation).
- **Transcript loading:** Reading 20 turns from a JSONL file is sub-millisecond.
- **Abbreviation regeneration:** If abbreviations are lost, regeneration requires one Haiku call per conversation. Parallelizable.

### Migration Path

The conversation system can be implemented incrementally:

1. **Phase 1: Transcripts + FTS** --- write transcripts for all conversations, insert turns into FTS in real-time. Keyword search available immediately.
2. **Phase 2: Abbreviation + vector search** --- add Haiku abbreviation on transition, ONNX embedding, SQLite-vec. Semantic search available.
3. **Phase 3: Cross-channel** --- extend to WhatsApp and Email conversations.

Phase 1 is the foundation and can ship with M2-S4 or as a standalone sprint. Phase 2 follows immediately. Phase 3 aligns with M3 and M6.

### Configuration

```yaml
# .my_agent/config.yaml (additions)
conversations:
  idleTimeout: 10m # Abbreviation trigger on idle (all channels)
  maxWorkingContext: 20 # Max turns to load into working context

index:
  embeddingModel: all-MiniLM-L6-v2
  abbreviationModel: haiku # Model for generating abbreviations
```

Configuration is intentionally simple. There is no channel-specific timeout because all conversations use the same 10-minute idle timer for abbreviation, and all conversations are always resumable (no "close" timeout).

### Error Handling

| Scenario                              | Behavior                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Transcript write fails                | Retry once, then log error. Do not lose the message --- keep in memory and retry on next turn. |
| FTS insert fails                      | Log error. FTS can be rebuilt from transcripts on next restart.                                |
| Abbreviation generation fails (Haiku) | Log error, leave `abbreviation` as NULL. Will retry on next startup (recovery flow).           |
| Embedding model not available         | Skip vector indexing, log warning. FTS search still works.                                     |
| Corrupt transcript line               | Skip the line during reading, log warning. Other lines are unaffected (JSONL advantage).       |
| SQLite-vec not available              | Fall back to FTS-only search (FTS5 does not require extensions).                               |

---

_Design specification created: 2026-02-14_
_Updated: 2026-02-14 — Compression/abbreviation separation, data flow diagram, FTS+vec search architecture_
_Updated: 2026-02-14 — Simplified lifecycle (no closed state), single 10min idle timer, multi-tab sync_
_Session: Hanan + Claude Code (Opus 4.6)_
