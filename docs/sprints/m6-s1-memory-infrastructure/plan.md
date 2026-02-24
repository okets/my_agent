# M6-S1: Memory Infrastructure — Sprint Plan

> **Milestone:** M6 Memory System
> **Sprint:** S1 — Infrastructure + Notebook Indexing
> **Status:** In Progress
> **Design Spec:** [memory-system.md](../../design/memory-system.md), [embeddings-plugin.md](../../design/embeddings-plugin.md)

---

## Scope

Build the foundational memory infrastructure: SQLite index, embeddings plugin system, file sync, and read-only tools.

**In Scope:**
- SQLite memory.db with FTS5 + sqlite-vec schema
- Embeddings plugin interface + `embeddings-local` (node-llama-cpp)
- Markdown file sync service (chokidar + SHA256 change detection)
- Chunking pipeline (markdown-aware, heading-respecting)
- `recall()` tool (hybrid search: BM25 + vector)
- `notebook_read()` tool (direct file access)
- Debug API endpoints (memory inspection)
- Notebook folder structure + initial migration

**Out of Scope (S2/S3):**
- Write tools (`remember`, `daily_log`, `notebook_write`)
- `conversation_search()` tool
- Prompt assembly changes (auto-load reference/daily)
- Dashboard UI (notebook browser, search UI, settings)
- Pre-compaction flush

---

## Tasks

### T1: SQLite Schema + Database Setup
**Owner:** Backend Dev
**Files:**
- `packages/core/src/memory/memory-db.ts` — NEW
- `packages/core/src/memory/types.ts` — NEW
- `packages/core/src/memory/index.ts` — NEW

**Work:**
1. Create `memory.db` schema (files, chunks, chunks_fts, embedding_cache, meta)
2. SQLite connection with WAL mode, busy_timeout, foreign_keys
3. Migration logic (create tables if not exist)
4. CRUD operations for files and chunks tables
5. FTS5 virtual table for keyword search

**Note:** sqlite-vec virtual table added in T3 after embeddings plugin provides dimensions.

**Acceptance:**
- `memory.db` created at `.my_agent/brain/memory.db`
- Tables match schema in design spec
- Unit tests for CRUD operations

---

### T2: Embeddings Plugin Interface + Registry
**Owner:** Backend Dev
**Files:**
- `packages/core/src/memory/embeddings/types.ts` — NEW (interface)
- `packages/core/src/memory/embeddings/registry.ts` — NEW
- `packages/core/src/memory/embeddings/index.ts` — NEW

**Work:**
1. Define `EmbeddingsPlugin` interface (from design spec)
2. Create `PluginRegistry` class
   - `register(plugin)`, `get(id)`, `list()`
   - `getActive()`, `setActive(id)` with config persistence
3. Store active plugin ID in config.yaml
4. Graceful degradation: `getActive()` returns null if no plugin ready

**Acceptance:**
- Interface matches design spec
- Registry manages plugin lifecycle
- Config persists active plugin choice

---

### T3: Local Embeddings Plugin (node-llama-cpp)
**Owner:** Backend Dev
**Files:**
- `packages/core/src/memory/embeddings/local.ts` — NEW
- `packages/core/package.json` — ADD node-llama-cpp dependency

**Work:**
1. Implement `EmbeddingsPlugin` using node-llama-cpp
2. Model: `hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf`
3. Auto-download model to `.my_agent/cache/models/`
4. Progress callback for download UI (future use)
5. `embed(text)` and `embedBatch(texts)` methods
6. Vector normalization (L2 norm)
7. Lazy loading: don't import node-llama-cpp until needed

**Note:** After this task, we know `dimensions: 384` — can create sqlite-vec table.

**Acceptance:**
- Plugin downloads model on first use (~600MB)
- Embedding returns 384-dim vector
- Vectors are normalized
- `isReady()` reflects model load state

---

### T4: sqlite-vec Integration
**Owner:** Backend Dev
**Files:**
- `packages/core/src/memory/memory-db.ts` — EXTEND
- `packages/core/package.json` — ADD sqlite-vec dependency

**Work:**
1. Add `chunks_vec` virtual table (sqlite-vec)
2. Vector storage: Float32 blob encoding
3. Cosine similarity search query
4. Insert/delete operations for vector table

**Dependencies:** T3 (need dimensions)

**Acceptance:**
- Vector table created with correct dimensions
- Can insert and query vectors
- Cosine similarity returns ranked results

---

### T5: Markdown Chunking Service
**Owner:** Backend Dev
**Files:**
- `packages/core/src/memory/chunker.ts` — NEW

**Work:**
1. Markdown-aware text chunking
2. Parameters: maxTokens=400 (~1600 chars), overlap=80 (~320 chars)
3. Respect headings: never split mid-H1/H2 section
4. Track nearest heading for each chunk (for search result display)
5. Return: `{ text, heading, startLine, endLine, hash }`

**Acceptance:**
- Chunks respect heading boundaries
- Overlap ensures context continuity
- Hash (SHA256) for deduplication

---

### T6: File Sync Service
**Owner:** Backend Dev
**Files:**
- `packages/core/src/memory/sync-service.ts` — NEW

**Work:**
1. File watching with chokidar (debounced 1.5s)
2. SHA256 change detection against `files` table
3. Incremental sync: only re-index changed files
4. Full sync: triggered manually or on startup
5. Processing pipeline: read file → chunk → embed → store
6. Handle file deletion (remove chunks + vectors)

**Dependencies:** T1, T3, T5

**Acceptance:**
- File changes trigger re-indexing
- Unchanged files skipped (hash match)
- Full sync rebuilds entire index

---

### T7: Hybrid Search Service (RRF)
**Owner:** Backend Dev
**Files:**
- `packages/core/src/memory/search-service.ts` — NEW

**Work:**
1. FTS5 BM25 search query
2. Vector cosine similarity search
3. Reciprocal Rank Fusion (RRF) to merge results
   - `RRF(d) = sum(1 / (k + rank))`, k=60
4. Group results by source type (notebook vs daily)
5. Return `SearchResult[]` matching design spec interface

**Dependencies:** T4, T6

**Acceptance:**
- Hybrid search returns merged, scored results
- Results grouped by notebook/daily
- Graceful fallback to FTS5-only if embeddings unavailable

---

### T8: Agent Tools (recall + notebook_read)
**Owner:** Backend Dev
**Files:**
- `packages/core/src/tools/recall.ts` — NEW
- `packages/core/src/tools/notebook-read.ts` — NEW
- `packages/core/src/tools/index.ts` — EXTEND

**Work:**
1. `recall(query, options)` tool
   - Parameters: query, maxResults=15, minScore=0.25
   - Returns grouped SearchResult (notebook + daily)
2. `notebook_read(path, options)` tool
   - Parameters: path (relative to notebook/), startLine, lines
   - Direct file read
3. Register tools in tool index

**Dependencies:** T7

**Acceptance:**
- Tools callable from brain
- Results match design spec format
- Error handling for missing files

---

### T9: Notebook Folder Structure + Migration
**Owner:** Backend Dev
**Files:**
- `.my_agent/notebook/` — CREATE structure
- Migration script or init logic

**Work:**
1. Create folder structure:
   ```
   notebook/
   ├── lists/
   ├── reference/
   ├── knowledge/
   └── daily/
   ```
2. Migrate existing files:
   - `runtime/standing-orders.md` → `notebook/reference/standing-orders.md`
   - `runtime/external-communications.md` → `notebook/reference/external-communications.md`
   - Contacts/preferences from `brain/memory/core/` → `notebook/reference/`
3. Keep backward compatibility in prompt.ts (check both paths)

**Acceptance:**
- Folder structure exists
- Existing files migrated
- No data loss

---

### T10: Debug API Endpoints
**Owner:** Backend Dev
**Files:**
- `packages/dashboard/src/routes/debug.ts` — EXTEND (or `memory.ts` NEW)

**Work:**
1. `GET /api/debug/memory/status` — index stats, last sync, chunk count
2. `GET /api/debug/memory/search?q=...` — raw search results with scores
3. `GET /api/debug/memory/files` — list indexed files with hashes
4. `POST /api/debug/memory/rebuild` — trigger full reindex

**Dependencies:** T6, T7

**Acceptance:**
- All endpoints return correct data
- Rebuild triggers full sync
- Errors handled gracefully

---

### T11: Integration + E2E Testing
**Owner:** Reviewer
**Files:**
- `packages/core/src/memory/__tests__/` — NEW

**Work:**
1. Unit tests for each component
2. Integration test: create file → sync → search → find
3. Test graceful degradation (no embeddings → FTS5 only)
4. Test incremental sync (change file → only that file re-indexed)
5. Verify debug API endpoints

**Dependencies:** All above

**Acceptance:**
- All tests pass
- Edge cases covered (empty files, large files, special chars)

---

## Task Dependencies

```
T1 (SQLite Schema)
    │
    ├──► T2 (Plugin Interface)
    │       │
    │       └──► T3 (Local Plugin)
    │               │
    │               └──► T4 (sqlite-vec)
    │
    ├──► T5 (Chunker) ──────────────────────┐
    │                                        │
    └───────────────────────────────────────┼──► T6 (Sync Service)
                                            │       │
                                            │       └──► T7 (Search Service)
                                            │               │
                                            │               └──► T8 (Agent Tools)
                                            │
                                            └──► T9 (Migration)

T6, T7 ──► T10 (Debug API)

All ──► T11 (Testing)
```

**Parallel tracks:**
- **Track A:** T1 → T2 → T3 → T4 (database + embeddings)
- **Track B:** T5 (chunking — independent)
- **Converge:** T6 needs T1+T3+T5, then → T7 → T8

---

## Dependencies & New Packages

| Package | Purpose | Install Location |
|---------|---------|------------------|
| `node-llama-cpp` | Local embedding model runtime | `packages/core/` |
| `sqlite-vec` | Vector similarity search | `packages/core/` |
| `chokidar` | File watching | `packages/core/` (check if present) |

**Existing:**
- `better-sqlite3` — already in dashboard, add to core

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| node-llama-cpp GPU detection fails | Fallback to CPU (slower) | Test on target machine before sprint |
| sqlite-vec compatibility issues | Vector search unavailable | FTS5-only graceful fallback |
| Large model download (~600MB) | Slow first startup | Progress indicator, background download |
| Chunking edge cases | Poor search quality | Extensive test coverage |

---

## Verification Checklist

Before declaring done:
- [ ] `npm run build` passes (packages/core + packages/dashboard)
- [ ] `npx tsc --noEmit` passes
- [ ] `npx prettier --write` applied
- [ ] All 11 tasks complete
- [ ] Debug API endpoints work
- [ ] `recall()` returns results from test notebook
- [ ] Incremental sync works (change file → re-indexed)
- [ ] Graceful degradation (disable embeddings → FTS5 only)
- [ ] No console errors

---

## Team

| Role | Agent | Responsibilities |
|------|-------|------------------|
| Tech Lead | Opus (me) | Planning, architecture decisions, integration |
| Backend Dev | Sonnet | T1-T10 implementation |
| Reviewer | Opus | T11 testing, code review, quality gate |

---

_Sprint plan created: 2026-02-24_
