# M6.7-S4 Search Infrastructure — Test Report

## Automated Tests

| Suite | Tests | Status |
|-------|-------|--------|
| `search-db.test.ts` | 17 | PASS |
| `search-service.test.ts` | 16 | PASS |
| `conversation-server.test.ts` | 5 | PASS |
| **Total** | **38** | **ALL PASS** |

### search-db.test.ts (17 tests)
- Constructor: loads sqlite-vec, creates mapping table
- initVectorTable: creates vec0 virtual table, idempotent on re-call
- searchKeyword: returns FTS5 results with BM25 ranking, handles empty queries
- upsertEmbedding + searchVector: inserts and retrieves by cosine similarity
- removeTurns: cleans up mapping + vec0 rows
- getEmbeddingCount / hasEmbedding: utility methods

### search-service.test.ts (16 tests)
- Hybrid search: combines FTS5 + vector results with RRF (K=60)
- Graceful degradation: falls back to FTS5-only when embed throws
- indexTurn: fire-and-forget, silently fails on error
- indexMissing: catches up unembedded turns on startup
- isSemanticAvailable: checks plugin + vec readiness

### conversation-server.test.ts (5 tests)
- Creates MCP server with correct name
- Exposes conversation_search and conversation_read tools
- Tools have correct parameter schemas

## Type Check

```
npx tsc --noEmit → CLEAN (0 errors)
```

## Prettier

```
npx prettier --check "src/**/*.ts" → 3 pre-existing warnings (channels/manager.ts, hatching/scripted-engine.ts, routes/channels.ts)
Our files: CLEAN
```

## Manual Verification (Live Server)

### Server Startup
- Dashboard restarted via `systemctl --user restart nina-dashboard.service`
- Logs confirm:
  - `[ConversationSearch] Vector table initialized (768 dims)`
  - `[ConversationSearch] Service initialized`
  - `[SessionManager] MCP servers initialized (memory → .../notebook, conversations)`

### REST API

| Endpoint | Test | Result |
|----------|------|--------|
| `GET /api/conversations` | List with limit=3 | Returns conversations with titles, previews, metadata |
| `GET /api/conversations/search?q=brain+files` | Hybrid search | Returns relevant result with score 0.0164 |
| `GET /api/conversations/:id` | Full transcript | Returns conversation with all turns |

### MCP Tools
- `conversation_search` and `conversation_read` registered on brain MCP server
- Available to brain agent via conversations namespace

## Pre-Existing Failures (Not Caused by Sprint)

- `tests/conversations.test.ts` ("creates database file") — fails on master
- `tests/step-executor.test.ts` — fails on master
- These were verified by stashing sprint changes and running tests.

## Verdict: PASS
