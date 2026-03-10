# M6.7-S4 Search Infrastructure — Full Sprint Review

## Verdict: PASS

## Summary

Built complete conversation search infrastructure: FTS5 + vector hybrid search with RRF ranking, REST API, MCP tools, chat flow integration, and model switching support. Backend only — no UI changes. Two bugs found and fixed during CTO-directed E2E testing.

---

## Plan Adherence

| Task | Plan | Actual | Status |
|------|------|--------|--------|
| T1: ConversationSearchDB | New class wrapping sqlite-vec alongside FTS5 | `search-db.ts` — vec0, mapping table, keyword/vector search, dimension-aware table management | DONE |
| T2: ConversationSearchService | Hybrid RRF service, fire-and-forget indexing | `search-service.ts` — K=60 RRF, graceful degradation, removeConversation | DONE |
| T3: REST API | Endpoints under `/api/conversations` | 3 endpoints: search, detail, list — all working | DONE |
| T4: MCP Tools | Brain agent tools for conversation search/read | `conversation_search` + `conversation_read` via Agent SDK | DONE |
| T5: Wire Indexing | Hook into chat flow + server init | index.ts creates services, chat-handler fires indexTurn, delete cleans up | DONE |
| T6: Verification | Type check, tests, manual | 38 tests pass, tsc clean, live server verified, E2E model switch tested | DONE |
| Post-sprint: Docs | — | Design docs, database schema, ROADMAP updated | DONE |
| Post-sprint: E2E | CTO-directed | Ollama installed, model switch tested, two bugs found and fixed | DONE |

---

## Architecture

### Source of Truth Philosophy

Files are the primary source of truth. Embeddings are a disposable derived index.

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

### Component Layout

```
chat-handler.ts
  ├── appendTurn() → conversationManager (FTS5 in db.ts, synchronous)
  ├── indexTurn() → ConversationSearchService (vector, fire-and-forget)
  └── removeConversation() → on delete, cleans up embeddings before DB delete

index.ts
  ├── Creates ConversationSearchDB (shares agent.db via getDb())
  ├── Creates ConversationSearchService (with pluginRegistry.getActive)
  ├── Config-aware plugin restore (config.yaml overrides saved DB meta)
  ├── Dimension-aware vec table init (drop+recreate on model switch)
  ├── Passes to initMcpServers (for brain agent)
  └── Sets server.conversationSearchService (for REST API)

REST API: /api/conversations/{search, :id, list}
MCP: conversation_search, conversation_read (brain agent namespace)
```

### Two Things Get Embedded

| System | Content | Source of Truth | Embedded In |
|--------|---------|-----------------|-------------|
| **Memory** | Markdown files from `.my_agent/notebook/` | The `.md` files | `memory.db` → `chunks_vec` |
| **Conversations** | Message turns (user + assistant) | JSONL transcript files | `agent.db` → `conv_vec` |

Both use the same embedding plugin (configured in `config.yaml`), same RRF algorithm (K=60), same graceful degradation pattern.

---

## Key Patterns

- **BigInt rowids** + `JSON.stringify` embeddings for vec0
- **`v.k = ?`** constraint (not LIMIT) for JOINed KNN queries
- **RRF K=60** matches memory system
- **Fire-and-forget embedding** never blocks conversation flow
- **Graceful degradation** to FTS5-only when embeddings unavailable
- **HealthMonitor recovery** re-initializes conversation vector table
- **Config-authoritative plugin restore** — config.yaml wins over saved DB meta on model switch
- **Dimension-aware conv_vec** — drops and recreates vec table when dimensions change

---

## E2E Test Results (CTO-Directed)

Tested with Ollama installed locally, two models: `nomic-embed-text` (768 dims) and `all-minilm` (384 dims).

| Test | Result |
|------|--------|
| Baseline (local plugin, FTS only) | Search returns correct results |
| Switch to Ollama all-minilm (384 dims) | Config change detected, plugin switched, vec table recreated |
| Index 8 turns with all-minilm | All embedded successfully at 384 dims |
| Hybrid search (FTS + vector) | "hard reboot" → top result correct, higher combined score |
| Semantic search | "computer crash recovery" finds turns despite no exact keyword match |
| Switch to nomic-embed-text (768 dims) | Model change detected, vec table dropped+recreated, meta updated |
| FTS fallback after switch | Search works immediately (0 embeddings, FTS handles it) |
| Memory meta consistency | Plugin name, model, dimensions all correct after each switch |

### Bugs Found and Fixed During E2E

1. **Config ignored on startup** — Saved DB meta always overrode config.yaml. If user changed `embeddings.plugin` in config.yaml from `local` to `ollama`, the system silently kept using the old plugin. Fixed: startup compares config vs saved meta, config wins, uses `resetVectorIndex()` for proper meta update.

2. **conv_vec dimension mismatch** — `initVectorTable` used `CREATE VIRTUAL TABLE IF NOT EXISTS`, so switching from 768-dim to 384-dim model left the old 768-dim table in place. All inserts failed with "Dimension mismatch". Fixed: detects existing dimensions on construction, drops+recreates table when dimensions change, clears incompatible embeddings.

---

## Automated Tests

| Suite | Tests | Status |
|-------|-------|--------|
| `search-db.test.ts` | 17 | PASS |
| `search-service.test.ts` | 16 | PASS |
| `conversation-server.test.ts` | 5 | PASS |
| **Total** | **38** | **ALL PASS** |

Type check: `npx tsc --noEmit` → clean
Prettier: our files clean (3 pre-existing warnings in unrelated files)

---

## Commits (11 total)

```
fe9f726 fix(embeddings): respect config.yaml on plugin/model switch
e7706ea docs: update design docs for M6.7-S4 search infrastructure
3422ef4 docs: M6.7-S4 sprint review and test report
b5a537f style: format search infrastructure files with prettier
3c987b7 feat(search): wire conversation search into chat flow (T5)
109aac6 feat(search): add conversation MCP server with search and read tools (T4)
ed91b44 feat(search): add REST API endpoints for conversation search (T3)
a6c4bba feat(search): add ConversationSearchService with hybrid RRF ranking (T2)
278aadf feat(skills): add Agent Team Setup to sprint skills
e2ace1d docs: add Backup & Restore to pre-release checklist
a4fd2f2 feat(search): add ConversationSearchDB with FTS5 + sqlite-vec (T1)
```

Branch: `sprint/m6.7-s4-search-infrastructure` — all pushed.

---

## Files Changed

### New Files (packages/dashboard/)
- `src/conversations/search-db.ts` — Vector search DB layer (sqlite-vec, dimension management)
- `src/conversations/search-service.ts` — Hybrid RRF search service
- `src/routes/conversation-search.ts` — REST endpoints
- `src/mcp/conversation-server.ts` — MCP tools for brain agent
- `tests/conversations/search-db.test.ts` — 17 tests
- `tests/conversations/search-service.test.ts` — 16 tests
- `tests/mcp/conversation-server.test.ts` — 5 tests

### Modified Files (packages/dashboard/)
- `src/conversations/index.ts` — New exports
- `src/index.ts` — Service creation, config-aware plugin restore, MCP wiring, health recovery
- `src/ws/chat-handler.ts` — Fire-and-forget indexing, delete cleanup
- `src/server.ts` — Decorator + route registration
- `src/agent/session-manager.ts` — Extended initMcpServers signature

### Documentation
- `docs/design/conversation-system.md` — Search Infrastructure section, expanded MCP tool specs
- `docs/design/database-schema.md` — `conversation_embedding_map` + `conv_vec` tables
- `docs/ROADMAP.md` — S4 status updated to complete
- `docs/sprints/m6.7-s4-search-infrastructure/DECISIONS.md` — 6 decisions logged

---

## Known Gaps

- **`indexMissing()` not called on startup** — Implemented but not wired. New turns index as they arrive; existing turns need manual catch-up or a startup trigger in a future sprint.
- **Pre-existing test failures** — 2 tests fail on master (`conversations.test.ts`, `step-executor.test.ts`), not caused by this sprint.

---

## Deviations

| Deviation | Reason |
|-----------|--------|
| Added config-override logic to index.ts | E2E testing revealed saved DB meta always won over config.yaml — essential fix for model switching |
| Added dimension detection to search-db.ts | E2E testing revealed conv_vec wasn't dropped on dimension change — data integrity fix |

These were discovered during CTO-directed E2E testing and are improvements beyond the original plan scope.

---

## Ready For

- **Merge review** — branch is stable, all tests pass, live server verified
- **S5 (Conversation Home Widget)** — consumes `/api/conversations/{search, :id, list}` endpoints
- **S6 (E2E Validation)** — search infrastructure is testable
