# M6.7-S4: Search Infrastructure — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build conversation search infrastructure (FTS5 dedicated table, search service, REST API, MCP tools) that S5's Home widget will consume. Backend only — no UI changes.

**Prerequisites:** S1-S3 complete on master. FTS5 `searchConversations()` exists in `db.ts` but is basic. Need dedicated search tables, a proper search service, REST endpoints, and MCP tools.

**Recovery context:** [recovery/m6.7-conversations/](../../recovery/m6.7-conversations/) — This sprint was originally part of the lost `sprint/m6.7-s4-s5` branch. The original S4 also included a tab bar UI that was rejected during review. This reconstruction keeps only the backend search infra.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, sqlite-vec, Vitest

**Design doc:** `docs/plans/2026-03-04-conversation-nina-design.md`

---

## ⚠️ Pitfalls from Previous Attempt

1. **FTS5 already exists in `db.ts`.** Table `turns_fts`, methods `indexTurn()` (line ~453), `searchConversations()` (line ~474), and FTS cleanup on delete (line ~617) already exist. Task 1 is **extract and extend**, not create from scratch. Do NOT create a duplicate FTS table.
2. **Semantic search does NOT exist on master.** The recovery analysis says "hybrid search already existed" — this was on the **lost branch**. `conv_vec`, `hybridSearch()`, sqlite-vec usage — none of these are in the current codebase. The pre-implementation check will find nothing. You DO need to build the vector search parts.
3. **Admin route already serves conversation details.** `GET /api/admin/conversations/:id` exists in `routes/admin.ts` (lines 196-234). Decide: reuse it, or create a non-admin equivalent. Admin routes use `localhostOnly` middleware — users access over Tailscale, so new routes must NOT be localhost-only.
4. **Memory route queries `turns_fts` directly.** `routes/memory.ts` line ~361 queries `turns_fts` bypassing any service layer. If you rename/migrate the FTS table, update this route too.
5. **Don't touch the UI.** This sprint is backend only. S5 handles the UI. Any urge to "quickly add a search box" → stop, that's S5.
6. **Push after every commit.** `git push origin <branch>` immediately. Non-negotiable.
7. **Why this sprint exists despite "Skip S4-S5" in recovery analysis.** The analysis recommended skipping because it assumed search infra was on master. It's not — only basic FTS5 is. The search service, vector search, REST API, and MCP tools all need to be built.

---

## Task 1: Conversation Search Database

Extract existing FTS5 from `db.ts` into a dedicated class. Add sqlite-vec tables for vector search. The FTS5 table `turns_fts` and methods (`indexTurn`, `searchConversations`, FTS cleanup) already exist in `db.ts` — migrate them, don't duplicate.

**Files:**
- Create: `packages/dashboard/src/conversations/search-db.ts`
- Test: `packages/dashboard/tests/conversations/search-db.test.ts`

### Pre-implementation Check

Before writing any code, run:
```bash
grep -r "fts\|FTS5\|turns_fts\|conv_vec\|sqlite-vec" packages/dashboard/src/conversations/
grep -r "hybridSearch\|searchVector\|upsertEmbedding" packages/dashboard/src/
```

**Expected result:** You WILL find `turns_fts` and `indexTurn` in `db.ts`. You will NOT find `conv_vec` or `hybridSearch` — those were on the lost branch. Plan accordingly: extract existing FTS5, add new vector tables.

### Schema

```sql
-- FTS5 virtual table for full-text search on conversation turns
CREATE VIRTUAL TABLE IF NOT EXISTS conversation_turns_fts USING fts5(
  conversation_id UNINDEXED,
  turn_number UNINDEXED,
  role UNINDEXED,
  content,
  timestamp UNINDEXED
);

-- sqlite-vec table for semantic search
CREATE VIRTUAL TABLE IF NOT EXISTS conv_vec USING vec0(
  embedding float[768]
);

-- Mapping table (vec0 uses rowid)
CREATE TABLE IF NOT EXISTS conversation_embedding_map(
  rowid INTEGER PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  role TEXT NOT NULL,
  UNIQUE(conversation_id, turn_number)
);
```

### Methods

```typescript
export class ConversationSearchDB {
  constructor(private db: Database) { /* create tables */ }

  indexTurn(conversationId: string, turnNumber: number, role: string, content: string, timestamp: string): void
  removeTurns(conversationId: string): void
  searchKeyword(query: string, limit?: number): SearchResult[]
  upsertEmbedding(conversationId: string, turnNumber: number, role: string, embedding: Float32Array): void
  searchVector(embedding: Float32Array, limit?: number): VectorResult[]
}
```

### Acceptance
- [ ] Tables created on startup (idempotent)
- [ ] `indexTurn` inserts into FTS5
- [ ] `searchKeyword` returns BM25-ranked results
- [ ] `upsertEmbedding` + `searchVector` work with sqlite-vec
- [ ] `removeTurns` cleans up when conversation is deleted
- [ ] Tests pass: `npx vitest run tests/conversations/search-db.test.ts`

### Commit
```bash
git add packages/dashboard/src/conversations/search-db.ts packages/dashboard/tests/conversations/search-db.test.ts
git commit -m "feat(m6.7-s4): add ConversationSearchDB — FTS5 + sqlite-vec tables"
git push origin <branch>
```

---

## Task 2: Search Service

Higher-level search service that combines keyword + semantic search with merged ranking.

**Files:**
- Create: `packages/dashboard/src/conversations/search-service.ts`
- Test: `packages/dashboard/tests/conversations/search-service.test.ts`

### Pre-implementation Check

Study the memory system's search service pattern:
```bash
cat packages/core/src/memory/search-service.ts | head -80
```
Follow the same pattern but for conversations.

### Architecture

```typescript
export class ConversationSearchService {
  constructor(
    private searchDB: ConversationSearchDB,
    private getEmbedding?: (text: string) => Promise<Float32Array | null>
  )

  /** Index a conversation turn (FTS5 + optional embedding) */
  async indexTurn(conversationId: string, turnNumber: number, role: string, content: string, timestamp: string): Promise<void>

  /** Hybrid search: FTS5 + vector with Reciprocal Rank Fusion */
  async search(query: string, limit?: number): Promise<ConversationSearchResult[]>

  /** Index all missing turns on startup */
  async indexMissing(getAllTurns: () => TurnData[]): Promise<number>
}
```

### Hybrid Search Algorithm (RRF)

Use Reciprocal Rank Fusion — NOT weighted linear combination. This matches the memory system's approach.

```typescript
// 1. Run FTS5 keyword search → ranked results
// 2. If embeddings available: embed query → vector search → ranked results
// 3. Merge with RRF: score = sum(1 / (k + rank_i)) for each result set
// 4. k = 60 (standard RRF constant)
// 5. Deduplicate by (conversationId, turnNumber)
// 6. Sort by combined score descending
```

### Graceful Degradation

- If `getEmbedding` is null or throws: fall back to FTS5 only, log warning
- Never block conversation flow on embedding failure
- Startup indexing: batch missing turns, don't re-index existing

### Example

```typescript
// "that ocean conversation" → no keyword match for "ocean" in "coral reef discussion"
// But semantic search finds it because the embeddings are close
// RRF merges both result sets, semantic results appear even without keyword overlap
```

### Acceptance
- [ ] `search("keyword match")` returns FTS5 results
- [ ] `search("semantic query")` returns vector results (if embeddings available)
- [ ] RRF merge produces sensible combined ranking
- [ ] Graceful degradation when Ollama is down
- [ ] `indexMissing` indexes turns that lack FTS5 entries
- [ ] Tests pass

### Commit
```bash
git add packages/dashboard/src/conversations/search-service.ts packages/dashboard/tests/conversations/search-service.test.ts
git commit -m "feat(m6.7-s4): add ConversationSearchService — hybrid search with RRF"
git push origin <branch>
```

---

## Task 3: REST API Endpoints

Add search and browse endpoints consumed by the Home widget (S5).

**Files:**
- Create: `packages/dashboard/src/routes/conversation-search.ts`
- Modify: `packages/dashboard/src/index.ts` — register routes

### Endpoints

```
GET /api/conversations/search?q=<query>&limit=10
  → { results: [{ conversationId, conversationTitle, turnNumber, role, snippet, timestamp, score }] }

GET /api/conversations/:id
  → { id, title, status, channel, turnCount, turns: [{ role, content, timestamp, channel }] }

GET /api/conversations
  → { conversations: [{ id, title, status, channel, turnCount, preview, updated }] }
```

### Notes

- `/api/conversations/search` uses `ConversationSearchService.search()`
- `/api/conversations/:id` fetches full transcript (for read-only preview in S5)
- `/api/conversations` may already exist as admin-only — check if it needs an `/api/` version
- Validate query params, return proper error responses

### Acceptance
- [ ] Search returns ranked results with snippets
- [ ] `:id` endpoint returns full transcript
- [ ] List endpoint returns all conversations with metadata
- [ ] Error handling for missing conversations, empty queries
- [ ] Routes registered in `index.ts`

### Commit
```bash
git add packages/dashboard/src/routes/conversation-search.ts packages/dashboard/src/index.ts
git commit -m "feat(m6.7-s4): add conversation search + browse REST API"
git push origin <branch>
```

---

## Task 4: MCP Conversation Tools

MCP tools so Nina can search and read past conversations during chat.

**Files:**
- Create: `packages/dashboard/src/mcp/conversation-server.ts`
- Modify: `packages/dashboard/src/agent/session-manager.ts` — wire into MCP servers
- Test: `packages/dashboard/tests/mcp/conversation-server.test.ts`

### Pre-implementation Check

Study the memory MCP tools pattern:
```bash
cat packages/core/src/mcp/tools.ts | head -60
```

### Tools

```typescript
// conversation_search: Search past conversations
// Input: { query: string, limit?: number }
// Output: Top results with conversation title, snippet, timestamp

// conversation_read: Read full transcript of a conversation
// Input: { conversationId: string }
// Output: Full transcript formatted as readable text
```

### Wiring

Add conversation MCP server alongside existing memory server in `initMcpServers()`:
```typescript
const conversationServer = createConversationMcpServer({ searchService, conversationManager });
sharedMcpServers = { memory: memoryServer, conversations: conversationServer };
```

### Acceptance
- [ ] `conversation_search` returns relevant results
- [ ] `conversation_read` returns formatted transcript
- [ ] Both tools available in brain session
- [ ] Tests pass

### Commit
```bash
git add packages/dashboard/src/mcp/conversation-server.ts packages/dashboard/src/agent/session-manager.ts packages/dashboard/tests/mcp/conversation-server.test.ts
git commit -m "feat(m6.7-s4): add conversation MCP tools (search + read)"
git push origin <branch>
```

---

## Task 5: Wire Search Indexing

Connect search indexing to the conversation flow — index turns as they're written.

**Files:**
- Modify: `packages/dashboard/src/ws/chat-handler.ts` — index turns after transcript write
- Modify: `packages/dashboard/src/index.ts` — startup indexing of missing turns

### Flow

1. **On message:** After writing turn to transcript, call `searchService.indexTurn()`
2. **On startup:** Call `searchService.indexMissing()` to catch up on any unindexed turns
3. **On conversation delete:** Call `searchDB.removeTurns()` to clean up

### Acceptance
- [ ] New messages become searchable immediately
- [ ] Server restart indexes any missed turns
- [ ] Deleted conversations are removed from search index
- [ ] No impact on message flow latency (indexing is fast or async)

### Commit
```bash
git add packages/dashboard/src/ws/chat-handler.ts packages/dashboard/src/index.ts
git commit -m "feat(m6.7-s4): wire conversation search indexing into message flow"
git push origin <branch>
```

---

## Task 6: Verification

### Automated
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run` — all tests pass
- [ ] `npx prettier --check packages/dashboard/src/conversations/search-*.ts` — formatted

### Manual
- [ ] Start server → logs show "Indexed N missing conversation turns"
- [ ] Send a message → search API finds it immediately
- [ ] Semantic query works (if Ollama reachable): "that conversation about X" finds relevant results
- [ ] MCP tools work: Nina can reference past conversations in chat

### Sprint Docs
- [ ] Create `review.md` in this sprint folder
- [ ] Update E2E scenarios file: `docs/sprints/m6.7-s4-e2e-scenarios.md`

---

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Tech Lead | Opus | Architecture, integration, MCP wiring |
| Backend Dev | Sonnet | Search DB, service, REST routes |
| Reviewer | Opus | Plan adherence, code quality, pattern consistency |

## Dependencies

- `better-sqlite3` (existing)
- `sqlite-vec` (existing dependency from memory system)
- Ollama on Unraid (${OLLAMA_HOST}) for embeddings — graceful degradation if unavailable

## Recovery Reference

- Transcript: `docs/recovery/m6.7-conversations/transcript-raw.md` (Parts 4, 6)
- Analysis: `docs/recovery/m6.7-conversations/analysis.md` (Section 3: Technical Discoveries)
- Before state: `docs/recovery/m6.7-conversations/file-reads-before-state.md`
