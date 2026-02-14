# Conversation Management System — Roadmap Integration

> **Status:** Draft
> **Date:** 2026-02-14
> **Context:** Designed during M2 development. Integrates into existing milestone plan.
> **Replaces:** Ad-hoc session handling in current SessionManager

---

## Design Summary

Conversations replace sessions as the core unit of interaction. Key principles:

- **Human terminology:** "Conversations" not "sessions" — users think in conversations.
- **Long-lived and resumable:** Conversations persist across browser refreshes, server restarts, and days/weeks of inactivity. They compress rather than expire.
- **Default = most recent:** Opening the web UI continues the most recent web conversation. No artificial "General" bucket.
- **Channel continuity:** Each channel-identity pair (e.g., WhatsApp/+1555000000) maps to exactly one conversation. Always continues, never creates new.
- **Mixed topics are natural:** The agent handles topic mixing conversationally. No system-imposed segmentation.
- **Cross-channel read-only:** WhatsApp and Email conversations are viewable (not editable) in the web UI — a unified inbox for context.
- **Lightweight naming:** Every 5 turns, Haiku auto-names the conversation and detects multi-topic splits (cheap, async, non-blocking).
- **Three representations per conversation:**
  1. **Transcript** — JSONL append-only log (source of truth)
  2. **Abbreviation** — ~150 word "meeting notes" (semantic search index)
  3. **Working context** — what the Agent SDK currently holds in memory
- **Two distinct operations on transcripts:**
  - **Compression** — technical necessity when Agent SDK context fills up. Shrinks the working context so the SDK can continue. Triggered automatically by context pressure.
  - **Abbreviation** — semantic operation on conversation *transition* (close, switch, 30min idle). Produces ~100-200 token "meeting notes" that preserve meaning for search. Every conversation gets abbreviated, even 1-2 turn exchanges.
- **Abbreviation format** — not a one-liner summary, but abbreviated meeting notes:
  - Preserves: entities, decisions, open questions, outcomes
  - Drops: pleasantries, repetition, back-and-forth verbosity
  - Example: *"User asked for Italian restaurant near downtown for anniversary dinner. Considered: Lucia's ($$, romantic but noisy), Trattoria Roma ($$$, quiet, good reviews). User leaning toward Roma but wants to check parking. No final decision."*
- **Search is hybrid:**
  - Full-text search (FTS) on complete transcripts — keyword precision
  - Vector search on abbreviations — semantic gist
  - Results merged and ranked
- **Indexing on transition:** Abbreviation and indexing happen when conversations transition (switch, close, 30min idle) — not on every turn.
- **Compression and abbreviation are independent:** Compression is an SDK-internal concern (context pressure). Abbreviation is our concern (search indexing). Different triggers, different outputs, no coordination needed.

---

## Where It Fits in the Milestone Map

The conversation system spans multiple milestones. It is not a single feature — it is infrastructure that evolves as the project grows.

```
M2: Web UI (current)
  └── S4: Conversation persistence     ← transcript + resume + sidebar
  └── S5: Conversation naming           ← Haiku auto-naming

M3: WhatsApp Bridge
  └── Channel conversations appear      ← channel-identity mapping
  └── Cross-channel read-only view      ← web UI shows WhatsApp history

M4b: Memory + Heartbeat
  └── Hybrid search                      ← FTS on transcripts + vector on abbreviations
  └── Cross-conversation recall          ← agent queries past conversations
  └── Search ranking                     ← merge FTS + vector results

M5: Operations Dashboard
  └── Conversation browser               ← search, filter, inspect
  └── Conversation analytics              ← usage, topics, cost per conversation
```

---

## M2 Integration (Web UI)

M2 currently has three completed or planned sprints:

| Sprint | Status | Focus |
|--------|--------|-------|
| M2-S1 | Complete | Server foundation + static chat UI |
| M2-S2 | Complete | Streaming + thinking + stop |
| M2-S3 | Complete | Chat-based hatching wizard |

The conversation system adds two sprints to M2:

### M2-S4: Conversation Persistence + Sidebar

**Goal:** Conversations survive page refresh, server restart, and time. Users can have multiple conversations and switch between them.

**What gets built:**
- Transcript storage: JSONL files per conversation in `.my_agent/conversations/`
- Conversation metadata: SQLite table (id, title, channel, created, updated, turn_count, abbreviation)
- Resume on reconnect: web UI loads most recent web conversation on connect
- New conversation: explicit "New Chat" action (no auto-creation on topic change)
- Sidebar: conversation list sorted by recency, click to switch
- Agent SDK session binding: each conversation maps to an Agent SDK session; switching conversations switches (or creates) sessions
- Abbreviation on transition: when a conversation is closed, switched away from, or idle for 30min, generate ~150 word meeting notes from transcript
- Compression is transparent: when Agent SDK compresses working context, the full pre-compression content is already in transcript — no action needed from us

**Data model:**
```
.my_agent/conversations/
  ├── conversations.db          # SQLite: metadata + FTS index (later: vector embeddings)
  ├── conv-{uuid}.jsonl         # Transcript: one JSON object per turn
  └── ...
```

**Abbreviation details:**
- Triggered on conversation transition: switch, close, or 30min idle timeout
- Haiku generates ~100-200 token meeting notes from the transcript
- Stored in `abbreviation` column of conversations table
- Even short conversations (1-2 turns) get abbreviated on close — no special case needed
- Format preserves entities, decisions, open questions, outcomes; drops pleasantries and repetition

**Does NOT include:** Hybrid search, vector embeddings, cross-conversation recall, channel conversations. Those come in M4b.

### M2-S5: Conversation Naming + Multi-Topic Detection

**Goal:** Conversations get meaningful names automatically. Multi-topic conversations are flagged for potential splitting.

**What gets built:**
- Auto-naming trigger: after every 5th user turn, fire Haiku with last N turns
- Haiku returns: `{ title: string, topics: string[], suggestSplit: boolean }`
- Title updates in sidebar in real-time
- If `suggestSplit`, agent mentions it naturally ("We're covering a lot — want me to start a new conversation for X?")
- Manual rename: click conversation title in sidebar to edit
- Cost: approximately $0.001 per naming call (Haiku is cheap)

**Does NOT include:** Automatic splitting, topic-based search, embeddings.

---

## M3 Integration (WhatsApp Bridge)

When WhatsApp lands, the conversation system extends naturally:

**Channel-identity mapping:**
- Each WhatsApp sender (phone number) = one conversation
- Conversation metadata includes `channel: "whatsapp"` and `identity: "+1555000000"`
- Same JSONL transcript format, same metadata table

**Cross-channel read-only view:**
- Web sidebar shows WhatsApp conversations (distinct visual treatment — icon, color)
- Clicking opens read-only transcript view (no compose bar)
- Agent context includes relevant channel history when user asks about it

**No new sprint needed** — this is part of the WhatsApp bridge sprint itself. The conversation infrastructure from M2-S4 supports it directly.

---

## M4b Integration (Memory + Heartbeat)

This is where conversation data becomes searchable knowledge via hybrid search.

**Hybrid search architecture:**
- **FTS on transcripts** — SQLite FTS5 over full JSONL transcripts. Keyword precision: finds exact names, error messages, code snippets, specific phrases.
- **Vector search on abbreviations** — SQLite-vec embeddings of the ~150 word abbreviations generated in M2-S4. Semantic gist: finds conceptually related conversations even with different wording.
- **Merge and rank** — Results from both sources are merged, deduplicated, and ranked. FTS hits on exact terms score higher; vector hits provide recall for fuzzy/conceptual queries.
- Embedding model: voyage-3 or similar (small, fast, cheap)

**Cross-conversation recall:**
- New MCP tool: `search_conversations(query)` — hybrid search across all conversations
- Returns relevant matches with conversation title, date, abbreviation, and surrounding transcript context
- Agent uses this when user references past discussions ("remember when we talked about X?")
- Distinct from graph memory: conversations = episodic memory, graph = structured knowledge

**Compression vs. abbreviation — no overlap:**
- Compression is an Agent SDK internal operation (shrinks working context when it fills up). We do not control it; we do not need to. The full transcript is already on disk before compression happens.
- Abbreviation is our operation (creates search-friendly meeting notes on conversation transition). Already implemented in M2-S4.
- In M4b, we add vector embeddings of existing abbreviations. No new generation step — just embed what M2-S4 already produces.

**No new sprint needed** — folds into M4b's memory sprint. The transcript + abbreviation infrastructure from M2-S4 is the foundation.

---

## M5 Integration (Operations Dashboard)

**Conversation browser:**
- Hybrid search (FTS + vector) exposed in the UI
- Filter by channel, date range, topic
- Search results show abbreviation as preview, click to expand full transcript
- Conversation detail view with full transcript

**Analytics:**
- Turns per conversation, cost per conversation
- Topic distribution over time
- Channel activity breakdown

---

## Updated Milestone Summary

| Milestone | Sprint | Conversation System Work |
|-----------|--------|--------------------------|
| **M2** | S4 | Transcript persistence, abbreviation on transition, resume, sidebar, new/switch |
| **M2** | S5 | Haiku auto-naming, multi-topic detection |
| **M3** | (WhatsApp sprint) | Channel-identity mapping, cross-channel read-only |
| **M4b** | (Memory sprint) | FTS on transcripts, vector embeddings on abbreviations, hybrid search + ranking, search_conversations tool |
| **M5** | (Ops dashboard) | Conversation browser, hybrid search UI, analytics |

---

## What This Does NOT Change

- **Hatching (M2-S3):** Hatching is a one-time flow, not a conversation. It writes config files and transitions to chat. No conversation persistence needed during hatching.
- **Task system (M4a):** Projects have their own folder-based context. Conversations and projects are separate systems. A conversation might *reference* a project ("fix that bug we discussed"), but the project folder is not a conversation.
- **Graph memory (M4b):** Graph memory stores structured knowledge (entities, relations). Conversation indexing stores episodic memory (what was discussed). Both are queryable, but they serve different purposes and use different storage.

---

## Key Technical Decisions Locked In

1. **JSONL transcripts, not database blobs.** Human-readable, appendable, streamable, git-friendly.
2. **SQLite for metadata + index.** Single file, zero infrastructure, supports FTS5 and vec extension.
3. **Compression and abbreviation are separate operations.**
   - *Compression* = SDK-internal, triggered by context pressure. Shrinks working context so the agent can continue. We do not control it; the transcript already has the full content.
   - *Abbreviation* = our operation, triggered by conversation transition (close, switch, 30min idle). Produces ~150 word meeting notes for search indexing. Every conversation gets one, regardless of length.
4. **Abbreviation format: meeting notes, not one-liner summaries.** ~100-200 tokens preserving entities, decisions, open questions, outcomes. Drops pleasantries and verbosity.
5. **Hybrid search: FTS + vector.** FTS on full transcripts for keyword precision. Vector search on abbreviations for semantic recall. Merged and ranked.
6. **Abbreviation on transition, not on every turn.** Triggered by: close, switch to another conversation, or 30min idle timeout.
7. **No special case for short conversations.** Even 1-2 turn exchanges get abbreviated on close. The abbreviation is just shorter.
8. **Channel conversations are read-only in web UI.** The web UI is for web conversations. Channel conversations are viewable for context but not editable. The agent responds via the original channel.
9. **No automatic topic splitting.** The agent suggests it; the user decides. Mixed-topic conversations are a feature, not a bug.

---

*Created: 2026-02-14*
*Updated: 2026-02-14 — Separated compression vs. abbreviation, hybrid search, abbreviation format*
*Context: Conversation management design session (Hanan + Claude Code)*
