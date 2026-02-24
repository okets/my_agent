# M6-S1: Memory Infrastructure — Sprint Review

**Sprint:** M6-S1 Memory Infrastructure
**Date:** 2026-02-24
**Status:** Complete

---

## Summary

Built the complete memory system infrastructure: SQLite index with FTS5 + sqlite-vec for hybrid search, two embeddings plugins (local CPU + Ollama GPU), file sync service, and debug/admin API endpoints.

---

## Deliverables

### Core Memory System (`packages/core/src/memory/`)

| File | Description | Status |
|------|-------------|--------|
| `memory-db.ts` | SQLite schema (files, chunks, chunks_fts, chunks_vec, embedding_cache, meta) | Done |
| `chunker.ts` | Markdown-aware chunking (400 tokens, 80 overlap, heading boundaries) | Done |
| `sync-service.ts` | Chokidar file watcher + incremental indexing | Done |
| `search-service.ts` | Hybrid search with RRF merge (k=60) | Done |
| `tools.ts` | Agent tools (recall, notebook_read) | Done |
| `init.ts` | Notebook folder structure + migration | Done |
| `types.ts` | Type definitions | Done |
| `index.ts` | Module exports | Done |

### Embeddings Plugins (`packages/core/src/memory/embeddings/`)

| File | Description | Status |
|------|-------------|--------|
| `types.ts` | EmbeddingsPlugin interface | Done |
| `registry.ts` | Plugin registry + active plugin management | Done |
| `local.ts` | node-llama-cpp plugin (embeddinggemma-300M, 768 dims) | Done |
| `ollama.ts` | Generic Ollama plugin (configurable host/model) | Done |

### Dashboard API (`packages/dashboard/src/routes/`)

**Debug endpoints** (`/api/debug/memory/...`):
- `GET /status` — Index stats, embeddings status
- `GET /search?q=...` — Raw hybrid search results
- `GET /files` — Indexed files list
- `GET /embeddings` — Plugin status

**Admin endpoints** (`/api/admin/memory/...`):
- `POST /rebuild` — Full reindex (destructive)
- `POST /sync` — Trigger sync without clearing
- `POST /embeddings/activate` — Switch embeddings plugin
- `DELETE /embeddings/local-model` — Delete downloaded model files

### Tests (`packages/core/tests/`)

| Test Suite | Tests | Status |
|------------|-------|--------|
| MemoryDb | 5 | Pass |
| Markdown Chunker | 5 | Pass |
| SyncService | 4 | Pass |
| SearchService | 5 | Pass |
| Notebook Initialization | 4 | Pass |
| **Total** | **23** | **Pass** |

---

## Technical Decisions

1. **sqlite-vec v0.1.6** — Used JSON format for vectors, BigInt for rowid (better-sqlite3 requirement)

2. **Graceful degradation** — When embeddings unavailable, falls back to FTS5-only search

3. **RRF scoring** — Combined FTS5 BM25 + vector cosine similarity with k=60. Note: FTS5-only scores are low (~0.016) so `minScore` should be 0 for FTS5-only mode

4. **Dimensions** — embeddinggemma-300M uses 768 dimensions (not 384 as originally spec'd)

5. **chunks_vec table** — Created dynamically when dimensions are set, handled gracefully when missing

6. **Ollama host** — Defaults to `localhost` in code; configure via admin API for remote servers

---

## Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| `node-llama-cpp` | ^3.16.2 | Local embeddings |
| `sqlite-vec` | ^0.1.6 | Vector search |
| `chokidar` | ^5.0.0 | File watching |
| `vitest` | ^4.0.18 | Testing (devDep) |

---

## What's Next (M6-S2)

1. **Dashboard initialization** — Wire memory services into server startup
2. **Settings UI** — Embeddings plugin selection, Ollama host config, delete local model button
3. **Brain integration** — Inject recall results into system prompt
4. **Memory status widget** — Show index stats in dashboard

---

## Verification Checklist

- [x] `npx tsc --noEmit` passes (core + dashboard)
- [x] `npm run build` succeeds (core + dashboard)
- [x] `npm test` — 23/23 tests passing
- [x] Both plugins implemented (local + Ollama)
- [x] Graceful FTS5 fallback when embeddings unavailable
- [x] Debug API endpoints functional
- [x] Admin API endpoints functional
