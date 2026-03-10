# M6.7-S4 Search Infrastructure — Decisions Log

## Format
| Severity | Decision | Rationale | Risks | Timestamp |
|----------|----------|-----------|-------|-----------|

## Decisions

| Minor | Use same `agent.db` database for vector tables | FTS5 already lives there. Single DB = simpler joins, no cross-DB complexity. Follows MemoryDb pattern from core. | Need to load sqlite-vec extension in conversations/db.ts constructor | T1-start |
| Minor | Add sqlite-vec as dashboard dependency (not just core) | Dashboard owns conversation search; core's sqlite-vec is for memory. Separate concerns. | Extra dependency, but it's the same native module | T1-start |
| Minor | Create `search-db.ts` as separate class taking DB instance from `ConversationDatabase.getDb()` | Plan says extract+extend. Clean separation: db.ts = metadata+FTS, search-db.ts = vector search. Don't bloat db.ts further. | Requires exposing getDb() — already exists | T1-start |
| Minor | vec0 requires BigInt rowids and JSON-encoded embeddings | Discovered from core's MemoryDb pattern. Float32Array doesn't work with vec0. | None — this is just how sqlite-vec works | T1-impl |
| Minor | vec0 KNN requires `v.k = ?` constraint, not `LIMIT ?` when used with JOINs | sqlite-vec limitation: LIMIT is invisible through JOINs | None — standard vec0 pattern | T1-impl |
| Minor | Dispatch Tasks 3+4 as parallel agents | REST endpoints and MCP tools are independent once search service exists. Both consume the service, neither depends on the other. | Agents may conflict on shared files (server.ts) — mitigated by clear task boundaries | T3+T4-start |
