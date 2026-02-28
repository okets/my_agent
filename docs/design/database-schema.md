# Database Schema Reference

> **Last updated:** 2026-02-28 (M6.5-S4)
> **Source of truth:** This document. Update when schema changes.

---

## Overview

The project uses **better-sqlite3** with two database files, both in WAL mode.

| Database | Runtime Path | Source | Purpose |
|----------|-------------|--------|---------|
| `agent.db` | `{agentDir}/conversations/agent.db` | `packages/dashboard/src/conversations/db.ts` | Conversations, tasks, FTS, external messages |
| `memory.db` | `{agentDir}/brain/memory.db` | `packages/core/src/memory/memory-db.ts` | Memory chunks, embeddings, vector search |

**`agentDir`** = result of `findAgentDir()` from `@my-agent/core` — walks up from cwd to find `.my_agent/`. Typically resolves to `{agentDir}/`.

**Transcript files** (JSONL): `{agentDir}/conversations/{conversation_id}.jsonl`
**Task log files** (JSONL): `{agentDir}/tasks/logs/{task_id}.jsonl`

---

## agent.db

**Full path:** `{agentDir}/conversations/agent.db`
**Class:** `ConversationDatabase` in `packages/dashboard/src/conversations/db.ts`
**Pragmas:** `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`

> **Migration note:** Renamed from `conversations.db` → `agent.db` in M5-S1. Code auto-migrates if old file exists.

### conversations

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | TEXT PK | — | `conv-{ulid}` |
| `channel` | TEXT NOT NULL | — | `"web"`, `"whatsapp"`, etc. |
| `title` | TEXT | — | Display title |
| `topics` | TEXT | — | JSON array of strings |
| `created` | TEXT NOT NULL | — | ISO 8601 |
| `updated` | TEXT NOT NULL | — | ISO 8601 |
| `turn_count` | INTEGER | `0` | |
| `participants` | TEXT | — | JSON array |
| `abbreviation` | TEXT | — | AI-generated summary |
| `needs_abbreviation` | INTEGER | `0` | Boolean flag |
| `manually_named` | INTEGER | `0` | Boolean flag (M5-S1) |
| `last_renamed_at_turn` | INTEGER | `NULL` | (M5-S1) |
| `model` | TEXT | `NULL` | Model used (M5-S1) |
| `external_party` | TEXT | `NULL` | Phone/email for channels (M5-S1) |
| `is_pinned` | INTEGER | `1` | 1=channel conv, 0=web-only (M5-S1) |
| `sdk_session_id` | TEXT | `NULL` | Agent SDK session for resume (M6.5-S2) |

**Indexes:** `idx_conversations_updated(updated DESC)`, `idx_conversations_channel(channel)`, `idx_conversations_external_party(channel, external_party)`

### tasks

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | TEXT PK | — | `task-{ulid}` |
| `type` | TEXT NOT NULL | — | `"scheduling"`, `"coding"`, etc. |
| `source_type` | TEXT NOT NULL | — | `"calendar"`, `"chat"`, `"recurring"` |
| `source_ref` | TEXT | — | Event ID, conversation ID |
| `title` | TEXT NOT NULL | — | User-facing title |
| `instructions` | TEXT NOT NULL | — | Detailed instructions for executor |
| `status` | TEXT NOT NULL | `'pending'` | `pending`, `started`, `completed`, `failed` |
| `session_id` | TEXT NOT NULL | — | Agent SDK session ID |
| `recurrence_id` | TEXT | — | Recurring task parent ID |
| `occurrence_date` | TEXT | — | Date for recurring instance |
| `scheduled_for` | TEXT | — | ISO 8601 scheduled time |
| `started_at` | TEXT | — | ISO 8601 |
| `completed_at` | TEXT | — | ISO 8601 |
| `created_by` | TEXT NOT NULL | — | User or system |
| `log_path` | TEXT NOT NULL | — | `{agentDir}/tasks/logs/task-*.jsonl` |
| `created_at` | TEXT NOT NULL | `datetime('now')` | |
| `deleted_at` | TEXT | `NULL` | Soft delete (M5-S5) |
| `steps` | TEXT | `NULL` | JSON array (legacy, M5-S9) |
| `current_step` | INTEGER | `NULL` | (legacy, M5-S9) |
| `work` | TEXT | `NULL` | JSON work breakdown (M5-S9) |
| `delivery` | TEXT | `NULL` | JSON delivery items (M5-S9) |
| `sdk_session_id` | TEXT | `NULL` | For session resume (M6.5-S2) |

**Indexes:** `idx_tasks_status(status)`, `idx_tasks_recurrence(recurrence_id)`, `idx_tasks_source(source_type, source_ref)`, `idx_tasks_scheduled(scheduled_for)`

### task_conversations

Junction table linking tasks to conversations (M5-S5). Soft references, no FK constraints.

| Column | Type | Notes |
|--------|------|-------|
| `task_id` | TEXT NOT NULL | PK (composite) |
| `conversation_id` | TEXT NOT NULL | PK (composite) |
| `linked_at` | TEXT NOT NULL | ISO 8601 |

**Indexes:** `idx_task_conversations_task(task_id)`, `idx_task_conversations_conv(conversation_id)`

### turns_fts (FTS5 virtual table)

| Column | Indexed | Notes |
|--------|---------|-------|
| `content` | Yes | Turn text, prefixed `"User:"` or `"Assistant:"` |
| `conversation_id` | No | Reference to conversations.id |
| `turn_number` | No | |
| `timestamp` | No | |

### external_messages

Channel messages from non-owner contacts (M5-S3). Source: `packages/dashboard/src/channels/external-store.ts`.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | TEXT PK | — | Message ID |
| `channel_id` | TEXT NOT NULL | — | Channel identifier |
| `from_identity` | TEXT NOT NULL | — | Phone/email |
| `display_name` | TEXT | — | Sender name |
| `content` | TEXT NOT NULL | — | Message content |
| `timestamp` | TEXT NOT NULL | — | ISO 8601 |
| `status` | TEXT | `'pending'` | `pending`, `processed`, `failed` |
| `raw_json` | TEXT | — | Raw message JSON |

**Indexes:** `idx_external_channel_from(channel_id, from_identity)`

---

## memory.db

**Full path:** `{agentDir}/brain/memory.db`
**Class:** `MemoryDb` in `packages/core/src/memory/memory-db.ts`
**Pragmas:** `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`
**Extension:** `sqlite-vec` (loaded at startup)

### files

| Column | Type | Notes |
|--------|------|-------|
| `path` | TEXT PK | Relative to brain dir |
| `hash` | TEXT NOT NULL | Content hash |
| `mtime` | TEXT NOT NULL | Modified time |
| `size` | INTEGER NOT NULL | Bytes |
| `indexed_at` | TEXT NOT NULL | ISO 8601 |
| `indexed_with_embeddings` | INTEGER NOT NULL DEFAULT 0 | 1 if embeddings generated |

### chunks

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTOINCREMENT | |
| `file_path` | TEXT NOT NULL | Source file |
| `heading` | TEXT | Section heading |
| `start_line` | INTEGER NOT NULL | |
| `end_line` | INTEGER NOT NULL | |
| `text` | TEXT NOT NULL | Chunk content |
| `hash` | TEXT NOT NULL | Content hash |
| `created_at` | TEXT NOT NULL | `datetime('now')` |

**Indexes:** `idx_chunks_file(file_path)`, `idx_chunks_hash(hash)`

### chunks_fts (FTS5 virtual table)

| Column | Indexed | Notes |
|--------|---------|-------|
| `text` | Yes | Chunk text |
| `heading` | Yes | |
| `file_path` | No | |
| `chunk_id` | No | |

### chunks_vec (vec0 virtual table)

```sql
CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding FLOAT[{dimensions}]);
```

Created dynamically by `initVectorTable(dimensions)`. Dropped and recreated if dimensions change. `rowid` = `chunks.id`.

### embedding_cache

| Column | Type | Notes |
|--------|------|-------|
| `hash` | TEXT PK | Content hash |
| `model` | TEXT NOT NULL | e.g., `"nomic-embed-text"` |
| `embedding` | TEXT NOT NULL | JSON-encoded vector |
| `created_at` | TEXT NOT NULL | `datetime('now')` |

### meta (key-value store)

| Key | Example Value | Notes |
|-----|---------------|-------|
| `embeddingsPlugin` | `"ollama"` | Active plugin |
| `embeddingsModel` | `"nomic-embed-text"` | Model name |
| `dimensions` | `"768"` | Vector dimensions |
| `chunkTokens` | `"400"` | Tokens per chunk |
| `chunkOverlap` | `"80"` | Overlap between chunks |
| `builtAt` | ISO 8601 | Last index build time |

---

## Quick DB Access (for testing)

```bash
# From packages/dashboard/ directory:
node -e "
const Database = require('better-sqlite3');
const db = new Database('{agentDir}/conversations/agent.db');
const rows = db.prepare('SELECT id, title, sdk_session_id FROM conversations ORDER BY updated DESC LIMIT 10').all();
console.table(rows);
db.close();
"
```

---

## Reset Test Data

```bash
npx tsx packages/dashboard/tests/reset-test-data.ts
```

Clears: conversations, FTS, transcripts, tasks, task-conversation links, task logs, calendar entries.
