# M6.7-S4 Search Infrastructure — Sprint Review

## Verdict: PASS

## Summary

Built complete conversation search infrastructure: FTS5 + vector hybrid search with RRF ranking, REST API, MCP tools, and chat flow integration. Backend only — no UI changes.

## Plan Adherence

| Task | Plan | Actual | Status |
|------|------|--------|--------|
| T1: ConversationSearchDB | New class wrapping sqlite-vec alongside FTS5 | Implemented as `search-db.ts` with vec0, mapping table, keyword/vector search | DONE |
| T2: ConversationSearchService | Hybrid RRF service, fire-and-forget indexing | Implemented as `search-service.ts` with K=60 RRF, graceful degradation | DONE |
| T3: REST API | Endpoints under `/api/conversations` | 3 endpoints: search, detail, list — all working | DONE |
| T4: MCP Tools | Brain agent tools for conversation search/read | `conversation_search` + `conversation_read` via Agent SDK | DONE |
| T5: Wire Indexing | Hook into chat flow + server init | index.ts creates services, chat-handler fires indexTurn, delete cleans up | DONE |
| T6: Verification | Type check, tests, manual | 38 tests pass, tsc clean, live server verified | DONE |

## Architecture

```
chat-handler.ts
  ├── appendTurn() → conversationManager (FTS5 in db.ts)
  └── indexTurn() → ConversationSearchService → ConversationSearchDB (vec0)

index.ts
  ├── Creates ConversationSearchDB (shares agent.db via getDb())
  ├── Creates ConversationSearchService (with pluginRegistry getActive)
  ├── Passes to initMcpServers (for brain agent)
  └── Sets server.conversationSearchService (for REST API)

REST API: /api/conversations/{search, :id, list}
MCP: conversation_search, conversation_read
```

## Key Patterns (from Recovery Analyst)

- BigInt rowids + JSON.stringify embeddings for vec0
- `v.k = ?` constraint (not LIMIT) for JOINed KNN queries
- RRF K=60 matches memory system
- Fire-and-forget embedding never blocks conversation flow
- Graceful degradation to FTS5-only when Ollama unavailable
- HealthMonitor recovery re-initializes conversation vector table

## Test Coverage

- 38 automated tests across 3 suites
- Manual verification on live server
- All REST endpoints return correct data
- MCP tools registered and accessible to brain

## Risks

- **Embedding catch-up**: `indexMissing()` is defined but not called on startup yet. This is a known gap — future sprint can add startup catch-up if needed.
- **Pre-existing test failures**: 2 tests fail on master (not caused by this sprint).

## Deviations

None. Sprint followed plan exactly.

## Files Changed

### New Files
- `src/conversations/search-db.ts` — Vector search DB layer
- `src/conversations/search-service.ts` — Hybrid search service
- `src/routes/conversation-search.ts` — REST endpoints
- `src/mcp/conversation-server.ts` — MCP tools
- `tests/conversations/search-db.test.ts` — 17 tests
- `tests/conversations/search-service.test.ts` — 16 tests
- `tests/mcp/conversation-server.test.ts` — 5 tests

### Modified Files
- `src/conversations/index.ts` — New exports
- `src/index.ts` — Service creation, MCP wiring, health recovery
- `src/ws/chat-handler.ts` — Fire-and-forget indexing, delete cleanup
- `src/server.ts` — Decorator + route registration
- `src/agent/session-manager.ts` — Extended initMcpServers signature
