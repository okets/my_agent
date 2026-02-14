# Sprint M2-S4: Conversation Persistence + Sidebar

> **Status:** Planned
> **Depends on:** M2-S3 (Complete)
> **Design spec:** `docs/design/conversation-system.md`
> **Risk review:** 2026-02-14

## Goal

Conversations survive page refresh, server restart, and time. Users can have multiple conversations and switch between them via a sidebar.

## Key Principles

- **Stable IDs:** `conv-{ulid}` — never changes after creation
- **JSONL transcripts:** Append-only, source of truth for UI display
- **SQLite metadata:** Single `conversations.db` alongside transcripts
- **Always resumable:** No "closed" state — all conversations can be returned to at any time
- **History injection:** On cold start, inject recent turns + summary into system prompt (not SDK replay)
- **10-min idle timer:** Per-conversation timer triggers abbreviation for search indexing
- **Multi-tab sync:** Single SDK session per conversation, broadcasts to all connected WebSockets
- **FTS in real-time:** Every turn indexed immediately

## Session Continuity Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ USER SEES (UI)                 │ AGENT KNOWS (SDK Context)      │
├────────────────────────────────┼─────────────────────────────────│
│ Full transcript from JSONL     │ Recent turns + summary          │
│ All messages, all time         │ Injected on cold start          │
│ Loaded on page load            │ continue: true while warm       │
└─────────────────────────────────────────────────────────────────┘

Cold start = server restart OR session evicted from LRU cache OR long gap

On cold start, inject into system prompt:
  [Prior conversation - {time_gap} ago]
  {summary if available}

  Recent messages:
  User: ...
  Assistant: ...
  [End prior conversation]
```

## Tasks

### Task 1: Transcript Storage + ConversationManager

Create the conversation persistence layer: JSONL transcripts and SQLite metadata.

**Files:**
- `packages/dashboard/src/conversations/types.ts` — NEW: Conversation, TranscriptTurn types
- `packages/dashboard/src/conversations/transcript.ts` — NEW: append/read JSONL transcripts
- `packages/dashboard/src/conversations/db.ts` — NEW: SQLite metadata + FTS
- `packages/dashboard/src/conversations/manager.ts` — NEW: ConversationManager class
- `packages/dashboard/src/conversations/index.ts` — NEW: re-exports

**ConversationManager API:**
```typescript
class ConversationManager {
  constructor(agentDir: string)

  // Lifecycle
  create(channel: 'web' | 'whatsapp' | 'email'): Promise<Conversation>
  get(id: string): Promise<Conversation | null>
  list(options?: { channel?: string, limit?: number }): Promise<Conversation[]>
  getMostRecent(channel: string): Promise<Conversation | null>

  // Turns
  appendTurn(id: string, turn: TranscriptTurn): Promise<void>
  getTurns(id: string, options?: { limit?: number, offset?: number }): Promise<TranscriptTurn[]>
  getRecentTurns(id: string, limit: number): Promise<TranscriptTurn[]>  // for context injection

  // Abbreviation
  setAbbreviation(id: string, text: string): Promise<void>
  getPendingAbbreviations(): Promise<string[]>
  markNeedsAbbreviation(id: string): Promise<void>
}
```

**Database schema:**
```sql
-- Initialize with pragmas (in db.ts constructor)
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;

CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    title TEXT,
    topics TEXT,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    turn_count INTEGER DEFAULT 0,
    participants TEXT,
    abbreviation TEXT,
    needs_abbreviation INTEGER DEFAULT 0
);

CREATE VIRTUAL TABLE turns_fts USING fts5(
    content,
    conversation_id UNINDEXED,
    turn_number UNINDEXED,
    timestamp UNINDEXED
);
```

**JSONL resilience:** Reader must handle partial lines (crash mid-write) by skipping malformed JSON.

**Done when:** Can create conversations, append turns, list conversations. FTS search works. WAL mode active.

### Task 2: Session Binding + History Injection

Replace the current single-SessionManager pattern with conversation-bound sessions using history injection.

**Files:**
- `packages/dashboard/src/agent/session-manager.ts` — MODIFY: accept conversationId, support context injection
- `packages/dashboard/src/agent/session-registry.ts` — NEW: LRU cache of sessions per conversation
- `packages/dashboard/src/agent/context-builder.ts` — NEW: builds history injection prompt

**SessionRegistry API:**
```typescript
class SessionRegistry {
  constructor(maxSessions: number = 5)  // LRU eviction

  getOrCreate(conversationId: string, manager: ConversationManager): Promise<SessionManager>
  remove(conversationId: string): void
  getAll(): Map<string, SessionManager>

  // Returns true if session existed in cache (warm), false if created (cold)
  isWarm(conversationId: string): boolean
}
```

**ContextBuilder API:**
```typescript
function buildContextInjection(
  turns: TranscriptTurn[],
  abbreviation: string | null,
  lastActivity: Date
): string

// Returns formatted string like:
// [Prior conversation - 3 hours ago]
// Summary: User discussed restaurant booking...
//
// Recent messages:
// User: Can you book it for 7pm?
// Assistant: Done - booked for 7pm.
// [End prior conversation]
```

**Session lifecycle:**
1. `getOrCreate(convId)` checks LRU cache
2. If warm: return existing session, use `continue: true`
3. If cold: load recent turns (10) + abbreviation, build context, create new session
4. First message includes context injection in system prompt
5. Subsequent messages use `continue: true`

**Done when:** Sessions are bound to conversations. Cold start injects context. LRU evicts after 5 sessions.

### Task 3: WebSocket Protocol + Handler Updates

Update the chat handler to use ConversationManager and handle conversation switching.

**Files:**
- `packages/dashboard/src/ws/protocol.ts` — MODIFY: add conversation message types
- `packages/dashboard/src/ws/chat-handler.ts` — MODIFY: use ConversationManager, handle new/switch
- `packages/dashboard/src/ws/connection-registry.ts` — NEW: track WebSockets per conversation

**New ClientMessage types:**
```typescript
| { type: "connect"; conversationId?: string }  // specify which conversation to load
| { type: "new_conversation" }
| { type: "switch_conversation"; conversationId: string }
| { type: "rename_conversation"; title: string }
| { type: "load_more_turns"; before: string }  // pagination
```

**New ServerMessage types:**
```typescript
| { type: "conversation_loaded"; conversation: ConversationMeta | null; turns: Turn[]; hasMore: boolean }
| { type: "conversation_list"; conversations: ConversationMeta[] }
| { type: "conversation_renamed"; conversationId: string; title: string }
| { type: "conversation_created"; conversation: ConversationMeta }
| { type: "conversation_updated"; conversationId: string; turn: Turn }
| { type: "turns_loaded"; turns: Turn[]; hasMore: boolean }  // pagination response
```

**ConnectionRegistry API:**
```typescript
class ConnectionRegistry {
  add(socket: WebSocket, conversationId: string): void
  remove(socket: WebSocket): void
  switchConversation(socket: WebSocket, newConversationId: string): void

  getViewerCount(conversationId: string): number  // for abbreviation safety
  broadcastToConversation(conversationId: string, message: ServerMessage, exclude?: WebSocket): void
}
```

**Handler changes:**
- On connect: if `conversationId` provided, load it; else load most recent; send `conversation_loaded` + `conversation_list`
- On `new_conversation`: queue abbreviation for current (if viewer count = 0), create new, send `conversation_created`
- On `switch_conversation`: update registry, queue abbreviation if last viewer, send `conversation_loaded`
- On `message`: append turn, touch idle timer, broadcast to all tabs

**Done when:** WebSocket sends conversation state on connect. New/switch works. Multi-tab broadcasts work.

### Task 4: Frontend Sidebar + Conversation Switching

Add a sidebar showing conversation list with switching support.

**Files:**
- `packages/dashboard/public/index.html` — MODIFY: add sidebar HTML
- `packages/dashboard/public/js/app.js` — MODIFY: conversation state, sidebar logic
- `packages/dashboard/public/css/app.css` — MODIFY: sidebar styles

**App state additions:**
```javascript
{
  conversations: [],
  currentConversationId: null,
  sidebarOpen: true,
}

// Reset all chat state on conversation switch
resetChatState() {
  this.messages = [];
  this.currentAssistantMessage = null;
  this.thinkingText = '';
  this.isThinking = false;
  this.isResponding = false;
  this.pendingControls = null;
  this.composeHint = null;
}
```

**New handlers:**
- `conversation_loaded`: call `resetChatState()`, set messages, currentConversationId
- `conversation_list`: set conversations
- `conversation_created`: prepend to conversations, switch to it
- `conversation_updated`: if not current, update sidebar timestamp; if current tab, ignore (we already have it)

**Done when:** Sidebar shows conversations. Can create new and switch between them. State resets properly.

### Task 5: Abbreviation Background Worker + Idle Timer

Implement the abbreviation queue and per-conversation idle timers.

**Files:**
- `packages/dashboard/src/conversations/abbreviation.ts` — NEW: AbbreviationQueue class
- `packages/dashboard/src/conversations/idle-timer.ts` — NEW: IdleTimerManager class
- `packages/dashboard/src/index.ts` — MODIFY: start worker on server start, drain on shutdown

**IdleTimerManager API:**
```typescript
class IdleTimerManager {
  constructor(
    queue: AbbreviationQueue,
    registry: ConnectionRegistry,
    idleMs: number = 10 * 60 * 1000
  )

  touch(conversationId: string): void  // reset timer on user message AND assistant done
  clear(conversationId: string): void
}
```

**AbbreviationQueue API:**
```typescript
class AbbreviationQueue {
  constructor(manager: ConversationManager, apiKey: string)

  enqueue(conversationId: string): void  // deduplicates
  processNext(): Promise<void>
  retryPending(): Promise<void>

  // Graceful shutdown
  drain(): Promise<void>  // finish current, mark rest as needs_abbreviation
}
```

**Safety checks:**
- Before abbreviation: check `registry.getViewerCount(id) === 0`
- After abbreviation: check if `turn_count` changed; if so, re-queue
- On failure: set `needs_abbreviation = 1`

**Done when:** Idle timer triggers abbreviation. Graceful shutdown works. Deduplication works.

### Task 6: Integration + Verification

Wire everything together, verify end-to-end flow.

**Verification:**
1. `npx tsc --noEmit` — clean compilation
2. `npx prettier --write packages/dashboard/src/`
3. Fresh start (delete `.my_agent/conversations/`) → dashboard → sidebar empty
4. Send message → conversation created, appears in sidebar
5. Send more messages → conversation persists
6. Refresh page → same conversation loads, messages preserved, agent remembers context
7. Restart server → conversation loads, agent has context via injection
8. Click "New conversation" → new empty conversation, old one in sidebar
9. Switch back → old conversation loads with history
10. **Multi-tab:** Open second tab → same conversation, send message in one tab → appears in both
11. **Idle timer:** Wait 10+ minutes → abbreviation generated (check DB)
12. **LRU:** Open 6+ conversations → verify oldest evicted, cold start works

## Risk Mitigations

| ID | Risk | Mitigation |
|----|------|------------|
| G2 | No conversationId in handshake | Added `connect` message with optional conversationId |
| B1 | Unbounded sessions in memory | LRU eviction in SessionRegistry (max 5) |
| B3 | SQLite WAL mode not configured | Added pragmas in db.ts constructor |
| R1 | Multi-tab abbreviation race | ConnectionRegistry tracks viewer count per conversation |
| R2 | Abbreviation on stale transcript | Check turn_count before/after, re-queue if changed |
| R3 | AbbreviationQueue no dedup | Track pending IDs in Set |
| R4 | Idle timer during streaming | Touch on assistant done, not just user message |
| R5 | No graceful shutdown | AbbreviationQueue.drain() on SIGINT/SIGTERM |
| R6 | JSONL partial line crash | Skip malformed lines in reader |

## Dependencies

```
Task 1 (ConversationManager + SQLite)
  ├── Task 2 (session binding + LRU + context builder)
  ├── Task 3 (WS protocol + connection registry) ──┬── Task 4 (frontend)
  └── Task 5 (abbreviation + idle timer)           │
                                                   └── Task 6 (integration)
```

Task 1 is the foundation. Tasks 2, 3, 5 can be parallel after Task 1. Task 4 needs Task 3. Task 6 needs all.

## Out of Scope (Later Sprints)

- Haiku auto-naming at turn 5 (M2-S5)
- Vector embeddings for semantic search (M4b)
- Cross-conversation search (M4b)
- Channel conversations — WhatsApp (M3), Email (M6)
