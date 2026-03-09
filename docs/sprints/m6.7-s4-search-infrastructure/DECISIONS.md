# M6.7-S4 Search Infrastructure — Decisions Log

## Format
| Severity | Decision | Rationale | Risks | Timestamp |
|----------|----------|-----------|-------|-----------|

## Decisions

| Minor | Use same `agent.db` database for vector tables | FTS5 already lives there. Single DB = simpler joins, no cross-DB complexity. Follows MemoryDb pattern from core. | Need to load sqlite-vec extension in conversations/db.ts constructor | T1-start |
| Minor | Add sqlite-vec as dashboard dependency (not just core) | Dashboard owns conversation search; core's sqlite-vec is for memory. Separate concerns. | Extra dependency, but it's the same native module | T1-start |
| Minor | Create `search-db.ts` as separate class taking DB instance from `ConversationDatabase.getDb()` | Plan says extract+extend. Clean separation: db.ts = metadata+FTS, search-db.ts = vector search. Don't bloat db.ts further. | Requires exposing getDb() — already exists | T1-start |
