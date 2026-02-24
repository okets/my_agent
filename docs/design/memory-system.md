# Memory System — Design Specification

> **Status:** Approved
> **Date:** 2026-02-24
> **Scope:** Markdown-first notebook memory with SQLite index, local embeddings, hybrid search
> **Milestone:** M6
> **Supersedes:** Original M4b SQLite-backed list design

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [File Structure](#file-structure)
3. [SQLite Schema](#sqlite-schema)
4. [Embedding Infrastructure](#embedding-infrastructure)
5. [Agent Interface](#agent-interface)
6. [Pre-Compaction Flush](#pre-compaction-flush)
7. [Dashboard Interface](#dashboard-interface)
8. [Debug API](#debug-api)
9. [Configuration](#configuration)
10. [Migration Path](#migration-path)
11. [Implementation Notes](#implementation-notes)

---

## Architecture Overview

### What Changed (v1 → v2)

The original M4b design stored everything in SQLite with JSON columns (`lists` + `entries` tables). The v2 design inverts this: **markdown files are the source of truth**, SQLite is a derived, rebuildable index.

| Aspect | Old Design (M4b) | New Design (M6) |
|--------|-----------------|-----------------|
| Source of truth | SQLite (lists + entries) | Markdown files |
| Data model | Structured JSON entries | Free-form markdown |
| Agent tools | `list_create`, `entry_add`, `entry_search` | `remember`, `recall`, `daily_log`, `notebook_read`, `notebook_write` |
| Search | FTS5 on JSON data column | Hybrid BM25 + vector (embeddings) |
| Recovery | SQLite backup | Delete DB, re-sync from markdown |

### Why Markdown?

- **Human editability** — User can open any file in a text editor
- **Git friendliness** — Memory changes show up as meaningful diffs
- **Recoverability** — Delete `memory.db`, rebuild from markdown in seconds
- **Agent compatibility** — Nina already has `notebook_edit` for section-based markdown editing

### Storage Layers

```
                    ┌─────────────────────────────────┐
                    │         AGENT BRAIN              │
                    │                                  │
                    │  remember() / recall()           │
                    │  daily_log()                     │
                    │  notebook_read() / notebook_write│
                    └────────┬──────────┬──────────────┘
                             │          │
                    ┌────────▼──┐  ┌────▼──────────────┐
                    │  READ     │  │  WRITE            │
                    │           │  │                    │
                    │  SQLite   │  │  Markdown files    │
                    │  index    │  │  (source of truth) │
                    │  (fast)   │  │                    │
                    └────────┬──┘  └────┬──────────────┘
                             │          │
                             │    ┌─────▼──────────────┐
                             │    │  SYNC              │
                             │    │                    │
                             │    │  File watcher      │
                             │    │  Change detection  │
                             │    │  Chunking          │
                             │    │  Embedding         │
                             └────┤                    │
                                  │  SQLite index      │
                                  │  (derived)         │
                                  └────────────────────┘
```

### Data Flow

```
WRITE PATH (one-way):
  Nina/User edits markdown ──► File saved to notebook/
                                    │
                                    ▼
                              File watcher fires (debounced 1.5s)
                                    │
                                    ▼
                              SHA256 change detection
                                    │ (only if changed)
                                    ▼
                              Chunk text (400 tokens, 80 overlap)
                                    │
                                    ▼
                              Generate embeddings (embeddings plugin)
                                    │
                                    ▼
                              Upsert into SQLite (chunks, FTS, vectors)

READ PATH:
  recall("sarah phone")
      │
      ├──► FTS5 BM25 search (keyword match)
      │
      ├──► sqlite-vec cosine search (semantic match)
      │
      └──► Merge + group by source ──► Return to agent

RECOVERY:
  Delete memory.db ──► Next search triggers full rebuild from markdown
                       (or POST /api/debug/memory/rebuild)
```

### Key Design Decisions

1. **Markdown is source of truth** — SQLite is derived, rebuildable
2. **One flat notebook** — No artificial shared/nina split; Nina writes anywhere
3. **Folder organization** — `lists/`, `reference/`, `knowledge/`, `daily/`
4. **Grouped search results** — No score boosting; grouping IS the priority
5. **Local embeddings only** — Plugin system, `embeddings-local` as default
6. **Separate conversation search** — `recall()` for notebook, `conversation_search()` for transcripts
7. **Manual daily log** — Nina writes `daily_log()` entries; no automated Haiku summary
8. **`better-sqlite3` binding** — Consistent with existing `agent.db`, 10-67% faster than node:sqlite
9. **Hybrid tools** — Intent-based primary (`remember`, `recall`) + file-based escape hatch (`notebook_read`, `notebook_write`)

---

## File Structure

```
.my_agent/
├── notebook/
│   ├── lists/                    # High-churn tracking lists
│   │   ├── shopping.md           # "## Shopping List\n- Milk\n- Eggs"
│   │   ├── todos.md              # "## To Do\n- [ ] Call dentist"
│   │   └── reading.md            # User creates as needed
│   │
│   ├── reference/                # Stable reference data (always loaded in prompt)
│   │   ├── contacts.md           # "## Sarah Chen\n- Phone: 555-1234"
│   │   ├── preferences.md        # "## Morning routine\n- Coffee before meetings"
│   │   └── standing-orders.md    # "## Notification Rules\n- Don't ping before 9am"
│   │
│   ├── knowledge/                # Nina's learned facts and patterns
│   │   ├── facts.md              # "## Tech Stack\n- Frontend uses React 19"
│   │   └── patterns.md           # "## User Patterns\n- Usually free after 3pm"
│   │
│   └── daily/                    # One file per day (append-only)
│       ├── 2026-02-24.md         # Today's log
│       ├── 2026-02-23.md         # Yesterday
│       └── ...                   # Older days (searchable via index)
│
├── sessions/                     # Conversation transcripts (existing JSONL)
│
└── brain/
    └── memory.db                 # SQLite index (derived, rebuildable)
```

### Folder Purposes

| Folder | Purpose | Load Behavior |
|--------|---------|---------------|
| `lists/` | High-churn lists: shopping, todos, reading | On demand via tools |
| `reference/` | Stable reference: contacts, preferences, orders | **Always loaded in prompt** |
| `knowledge/` | Learned facts and observed patterns | On demand via tools |
| `daily/` | Temporal logs, one file per day | Today + yesterday always loaded |

### Prompt Integration

```
SYSTEM PROMPT ASSEMBLY (prompt.ts)
  │
  ├── brain/CLAUDE.md                    (personality — existing)
  ├── brain/memory/core/identity.md      (identity — existing)
  │
  ├── notebook/reference/*               (NEW: always loaded, up to 32K chars total)
  ├── notebook/daily/{today}.md          (NEW: today's log)
  └── notebook/daily/{yesterday}.md      (NEW: yesterday's log)
```

Per-file limit: 8000 chars. Total reference limit: 32000 chars.

---

## SQLite Schema

All tables live in `.my_agent/brain/memory.db`. This database is derived — deletable and rebuildable from markdown source files.

```sql
-- Enable WAL mode for concurrent reads during writes
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

-- ============================================================
-- FILE TRACKING
-- Change detection for incremental sync
-- ============================================================

CREATE TABLE files (
  path TEXT PRIMARY KEY,            -- Relative to notebook/ root
  hash TEXT NOT NULL,               -- SHA256 of file content
  mtime TEXT NOT NULL,              -- ISO 8601 modified time
  size INTEGER NOT NULL,            -- File size in bytes
  indexed_at TEXT NOT NULL          -- When we last indexed this file
);

-- ============================================================
-- CHUNKS
-- Text segments from markdown files, with embeddings
-- ============================================================

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,          -- FK to files.path (soft ref)
  heading TEXT,                     -- Nearest H1/H2 heading above chunk
  start_line INTEGER NOT NULL,      -- Line number in source file
  end_line INTEGER NOT NULL,        -- End line number
  text TEXT NOT NULL,               -- Raw chunk text
  hash TEXT NOT NULL,               -- SHA256 of chunk text (avoid re-embedding)
  embedding BLOB,                   -- Float32 array as blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chunks_file ON chunks(file_path);
CREATE INDEX idx_chunks_hash ON chunks(hash);

-- ============================================================
-- VECTOR SEARCH (sqlite-vec)
-- Virtual table for cosine similarity queries
-- ============================================================

CREATE VIRTUAL TABLE chunks_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[384]              -- Dimension from embeddings plugin config
);

-- ============================================================
-- FULL-TEXT SEARCH (FTS5)
-- BM25 keyword matching
-- ============================================================

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  heading,
  file_path UNINDEXED,
  chunk_id UNINDEXED
);

-- ============================================================
-- EMBEDDING CACHE
-- Avoid re-computing embeddings for unchanged chunks
-- ============================================================

CREATE TABLE embedding_cache (
  hash TEXT PRIMARY KEY,            -- SHA256 of chunk text
  model TEXT NOT NULL,              -- Model identifier (e.g. "embeddinggemma-300M")
  embedding BLOB NOT NULL,          -- Float32 array as blob
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- INDEX METADATA
-- Track which plugin/model built this index
-- ============================================================

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Stores: embeddingsPlugin, embeddingsModel, dimensions, builtAt
```

### Table Purposes

| Table | Purpose |
|-------|---------|
| `files` | Change detection — compare hash on sync; skip unchanged files |
| `chunks` | Text storage + metadata — one file produces multiple chunks |
| `chunks_vec` | Vector similarity search — sqlite-vec virtual table |
| `chunks_fts` | Keyword search — FTS5 BM25 ranking |
| `embedding_cache` | Avoid re-computation — same chunk text = same embedding |
| `meta` | Index metadata — track which plugin built the index |

---

## Embedding Infrastructure

Embeddings are provided via a plugin system. See [embeddings-plugin.md](embeddings-plugin.md) for the full plugin interface and registry spec.

### Default Plugin: `embeddings-local`

| Component | Choice | Notes |
|-----------|--------|-------|
| Runtime | node-llama-cpp | GPU support (CUDA/Metal/Vulkan), no Python needed |
| Model | embeddinggemma-300M | ~600MB GGUF, 384-dim vectors, auto-download |
| Vector storage | sqlite-vec | In-DB cosine queries, no external service |
| Keyword search | FTS5 | BM25 scoring built into SQLite |

### Graceful Degradation

If no embeddings plugin is ready (e.g., model still downloading):
- `recall()` falls back to FTS5-only search (keyword matching)
- Results are still useful, just less semantic
- Dashboard shows: "Semantic search disabled — model loading"

### Chunking Strategy

- Max chunk size: 400 tokens (~1600 chars)
- Overlap: 80 tokens (~320 chars)
- Respect headings: never split mid-H1/H2 section
- Attach nearest heading as metadata for search result display

### Sync Triggers

| Trigger | When | Type |
|---------|------|------|
| File watcher | File saved (debounced 1.5s) | Incremental |
| Session start | Brain session begins | Full sync (if dirty) |
| Search miss | `recall` finds stale index | Incremental for queried files |
| Manual rebuild | `POST /api/debug/memory/rebuild` | Full rebuild |

### Hybrid Search (RRF)

Results from FTS5 (BM25) and sqlite-vec (cosine) are merged using Reciprocal Rank Fusion:

```
RRF(d) = sum over all lists: 1 / (k + rank(d))
k = 60 (default) — balanced weight between BM25 and vector
```

---

## Agent Interface

### Memory Tools

The agent has five tools, split into intent-based (primary) and file-based (escape hatch).

#### Intent-Based Tools (Primary)

**`remember(content, options)`** — Store a fact, preference, contact, or list item

```typescript
interface RememberParams {
  content: string;        // What to remember
  category?: "lists" | "reference" | "knowledge";  // Default: auto-route
  file?: string;          // Specific file within category, e.g. "contacts"
  section?: string;       // H2 section to append under
}
```

Nina thinks in concepts, not files. `remember()` routes to the appropriate location automatically based on content and optional hints. If category is omitted, Nina decides based on the content type.

**`recall(query)`** — Search notebook and daily logs (semantic + keyword)

```typescript
interface RecallParams {
  query: string;
  maxResults?: number;   // Default: 15
  minScore?: number;     // Default: 0.25
}

interface RecallResult {
  notebook: SearchResult[];   // lists/ + reference/ + knowledge/
  daily: SearchResult[];      // daily/
}

interface SearchResult {
  filePath: string;           // e.g. "reference/contacts.md"
  heading: string | null;     // e.g. "## Sarah Chen"
  snippet: string;            // Matched text (~200 chars)
  score: number;              // 0.0 - 1.0 (hybrid BM25 + vector)
  lines: { start: number; end: number };
}
```

**`daily_log(entry)`** — Append to today's daily log

```typescript
interface DailyLogParams {
  entry: string;         // Text to append (agent adds timestamp prefix)
}
```

Creates `notebook/daily/YYYY-MM-DD.md` if it doesn't exist. Appends `## HH:MM — {first line}\n{entry}`.

#### File-Based Tools (Escape Hatch)

**`notebook_read(path, options)`** — Direct file read

```typescript
interface NotebookReadParams {
  path: string;          // Relative to notebook/, e.g. "reference/contacts.md"
  startLine?: number;    // Optional: read from this line
  lines?: number;        // Optional: read this many lines
}
// Returns: string (file content)
```

**`notebook_write(path, content, options)`** — Direct file write

```typescript
interface NotebookWriteParams {
  path: string;          // Relative path, e.g. "lists/shopping.md"
  content: string;       // Content to write
  section?: string;      // H2 section to target (e.g. "## Groceries")
  replace?: boolean;     // Replace section (true) or append (false, default)
}
// Returns: { success: boolean; message: string }
```

These file-based tools are available when Nina needs precise control (e.g., restructuring a file, replacing a specific section). For day-to-day memory operations, `remember()` and `recall()` are preferred.

### Conversation Search (Separate Tool)

Conversation transcripts are searched separately to avoid polluting curated notebook results:

**`conversation_search(query, options)`** — Search conversation transcripts (FTS/keyword)

```typescript
interface ConversationSearchParams {
  query: string;
  maxResults?: number;   // Default: 10
}
```

### Nina's Search Flow

```
1. Try recall() first          ← notebook + daily logs (semantic)
2. If not found: conversation_search()   ← conversation history (keyword)
3. If still not found: ask user
```

### Automatic Context Loading

These files are loaded into the system prompt on every brain query (no tool call needed):

| Source | When Loaded | Purpose |
|--------|-------------|---------|
| `notebook/reference/*` | Always | User's ground truth (contacts, preferences, orders) |
| `notebook/daily/{today}.md` | Always | What happened today |
| `notebook/daily/{yesterday}.md` | Always | Recent context from yesterday |

### Search Results — Grouped Display

```
recall("sarah phone")
    │
    ├── NOTEBOOK (2 results)
    │   ├── reference/contacts.md:3-6 ............ 0.87
    │   │   "## Sarah Chen\n- Phone: 555-1234..."
    │   └── knowledge/facts.md:12 ................ 0.64
    │       "Sarah prefers email over phone"
    │
    └── DAILY (1 result)
        └── daily/2026-02-20.md:8 ................ 0.52
            "Called Sarah about project timeline"
```

No score boosting between groups. Grouping IS the priority — Nina checks notebook group first per her instructions.

---

## Pre-Compaction Flush

### Problem

The Agent SDK compresses context when approaching the window limit. If Nina has learned something in the current session but hasn't written it to her notebook, that knowledge is lost during compaction.

### Solution

Before compaction fires, inject a silent system turn that prompts Nina to save durable memories:

```
[System] Session nearing compaction. Write any durable memories to
your notebook or daily log now. After compaction, only your notebook
and recent daily logs will be available.
```

### Implementation

In `packages/dashboard/src/agent/session-manager.ts`:

```typescript
// Agent SDK emits pre-compaction signal before compressing context
session.on('pre_compaction', async () => {
  await session.injectSystemTurn(
    'Session nearing compaction. Write any durable memories ' +
    'to your notebook or daily log now. After compaction, only ' +
    'your notebook and recent daily logs will be available.'
  );
});
```

If the SDK does not expose a pre-compaction event, implement a token-counting heuristic (trigger after estimated context usage exceeds 75% of model limit).

---

## Dashboard Interface

### New Components

#### Homepage: Notebook Quick-Access Card

```
┌─────────────────────────────────────────────────┐
│  NOTEBOOK                              [Search] │
│                                                  │
│  lists/         3 files      Shopping, Todos,... │
│  reference/     2 files      Contacts, Prefs     │
│  knowledge/     1 file       Facts               │
│  daily/        12 files      Latest: today       │
│                                                  │
│  [Open Notebook]                                 │
└─────────────────────────────────────────────────┘
```

#### Notebook Browser Tab

Full-width tab with folder navigation and file listing. Opens pages as tabs (desktop) or popovers (mobile).

#### Page View/Edit

Simple textarea with markdown preview. No WYSIWYG.

#### Memory Search

Grouped results matching the agent's `recall()` output:

```
┌─────────────────────────────────────────────────────────────┐
│  MEMORY SEARCH                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  [Search memory...                              ] Q  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  NOTEBOOK (2)                                                │
│  ├─ reference/contacts.md:3-6 .............. 0.87           │
│  │  "## Sarah Chen\n- Phone: 555-1234..."                   │
│  └─ knowledge/facts.md:12 .................. 0.64           │
│     "Sarah prefers email over phone"                         │
│                                                              │
│  DAILY (1)                                                   │
│  └─ daily/2026-02-20.md:8 .................. 0.52           │
│     "Called Sarah about project timeline"                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Settings: Memory Management

Under the existing Settings panel:

```
┌─────────────────────────────────────────────────────────────┐
│  MEMORY                                                      │
│                                                              │
│  Index Status                                                │
│  ├─ Files indexed: 18                                        │
│  ├─ Total chunks: 142                                        │
│  ├─ Last sync: 2 min ago                                     │
│  └─ Embedding model: embeddinggemma-300M (Local)            │
│                                                              │
│  [Rebuild Memory Index]     ← Deletes memory.db, re-syncs   │
│                                                              │
│  Embeddings                                                  │
│  Active: Local Embeddings (embeddinggemma-300M)   [Change]  │
│  Status: ✓ Ready (model loaded)                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

See [embeddings-plugin.md](embeddings-plugin.md) for the full plugin switcher UI spec.

---

## Debug API

New endpoints added to the existing debug/admin API at `localhost:4321`.

### Memory Inspection

```
GET  /api/debug/memory/status        # Index stats, last sync, chunk count
GET  /api/debug/memory/search?q=...  # Raw search results with scores
GET  /api/debug/memory/files         # List indexed files with hashes
POST /api/debug/memory/rebuild       # Trigger full reindex
```

### Notebook Operations (for test setup/teardown)

```
GET    /api/debug/notebook/pages     # List all pages
GET    /api/debug/notebook/:path     # Read page content
POST   /api/debug/notebook/:path     # Write page
DELETE /api/debug/notebook/:path     # Delete page
```

### Simulation (for E2E testing)

```
POST /api/debug/memory/simulate-compaction  # Trigger pre-compaction flush
POST /api/debug/brain/inject-turn           # Inject a turn (test Nina's writes)
```

---

## Configuration

### config.yaml additions

```yaml
# .my_agent/config.yaml

memory:
  notebookDir: notebook              # Relative to .my_agent/
  database: brain/memory.db

  embedding:
    plugin: embeddings-local         # Active embeddings plugin
    modelsDir: cache/models          # Where to store downloaded models

  chunking:
    maxTokens: 400                   # ~1600 chars per chunk
    overlapTokens: 80                # ~320 chars overlap
    respectHeadings: true            # Don't split mid-heading

  sync:
    watchDebounceMs: 1500            # Wait after last change before sync
    syncOnStart: true                # Full sync on brain start
    syncOnSearch: true               # Sync stale files before search

  search:
    maxResults: 15                   # Default result count
    minScore: 0.25                   # Minimum relevance threshold
    fusionK: 60                      # RRF constant

  prompt:
    referenceDir: reference          # Always loaded (relative to notebookDir)
    dailyWindow: 2                   # Days of daily logs to include
    maxPerFileChars: 8000            # Per-file size limit
    maxTotalReferenceChars: 32000    # Total reference section limit
```

---

## Migration Path

### Current State (after M4/M5)

- `runtime/standing-orders.md`, `runtime/external-communications.md`
- `notebook_edit` tool for section-based markdown editing
- Static files loaded into system prompt via `prompt.ts`
- No search, no indexing, no embeddings

### Migration Steps

1. Create notebook directory structure: `mkdir -p .my_agent/notebook/{lists,reference,knowledge,daily}`
2. Migrate contacts + preferences from `brain/memory/core/` into `notebook/reference/`
3. Migrate runtime files: `runtime/standing-orders.md` → `notebook/reference/standing-orders.md`, same for `external-communications.md`
4. Install dependencies: `npm install node-llama-cpp sqlite-vec` (`better-sqlite3` already present)
5. Implement `MemorySyncService`, `EmbeddingService`, and agent tools
6. Run initial `fullSync()` to build `memory.db`
7. Update `prompt.ts` to load from `notebook/reference/*` and `notebook/daily/`
8. Wire dashboard notebook browser and settings

### Backward Compatibility

During migration, `prompt.ts` checks both old and new paths:

```typescript
// Try new path first, fall back to old path
const standingOrders =
  await readOptionalFile(join(notebookDir, 'reference/standing-orders.md'))
  ?? await readOptionalFile(join(agentDir, 'runtime/standing-orders.md'));
```

---

## Implementation Notes

### Package Structure

```
packages/core/src/memory/
├── index.ts                # Public exports
├── types.ts                # Interfaces (SearchResult, SyncResult, etc.)
├── memory-db.ts            # SQLite schema, queries, migrations
├── embedding-service.ts    # Embeddings plugin wrapper
├── chunker.ts              # Markdown-aware text chunking
├── sync-service.ts         # File watching, change detection, indexing
├── search-service.ts       # Hybrid search (FTS5 + vector + RRF)
└── tools.ts                # Agent tool definitions

packages/dashboard/src/routes/
├── memory.ts               # REST API for dashboard notebook browser
└── debug.ts                # Extended with memory debug endpoints

packages/dashboard/public/js/stores/
└── notebook-store.js       # Alpine.js store for notebook UI
```

### Sprint Phasing (from risk analysis)

**Sprint 1 — Infrastructure + Notebook Indexing**
- SQLite memory.db setup (schema, sqlite-vec, FTS5)
- Embeddings plugin system + `embeddings-local` (node-llama-cpp)
- Markdown file sync (chokidar + SHA256 change detection)
- Chunking + embedding pipeline
- `recall()` and `notebook_read()` tools
- Debug API endpoints

**Sprint 2 — Memory Tools + Prompt Integration**
- `remember()`, `daily_log()`, `notebook_write()` tools
- `conversation_search()` tool
- Updated prompt assembly (auto-load reference + daily)
- Pre-compaction flush mechanism
- Nina's CLAUDE.md instructions

**Sprint 3 — Dashboard + Conversation Search**
- Notebook browser in dashboard (view + basic edit)
- Memory search UI (grouped results)
- Session transcript indexing (deferred complexity)
- Settings: "Rebuild Memory Index" + embeddings plugin switcher
- E2E testing

### Nina's Instructions (brain/CLAUDE.md addition)

```markdown
## Your Notebook

You share a notebook with the user at `notebook/`. Use it to:
- Track lists (shopping, contacts, todos)
- Record facts and preferences you've learned
- Keep notes that help you serve the user

**Organization:**
- `lists/` — Shopping, reading lists, todos. Create new lists as needed.
- `reference/` — Contacts, preferences, standing orders. Stable info.
- `knowledge/` — Facts you've learned, patterns you've observed.
- `daily/` — One file per day for summaries and temporal notes.

**When to write:**
- Pre-compaction: You'll be prompted to save before context compression
- After learning something durable: Don't wait, write it down
- After tasks: Log what you learned that might help next time

**Daily log vs notebook:**
- Daily log = "what happened today" (temporal, append-only)
- Notebook = "what I know" (durable, organized by topic)

**Search priority:**
When looking for information:
1. Check recall() first (notebook + daily logs)
2. Then conversation_search() (conversation history)
3. If not found: ask the user

The user can edit any page. If they change something you wrote, respect their version.
```

### Technical Dependencies

| Dependency | Purpose | Status |
|------------|---------|--------|
| `better-sqlite3` | SQLite binding for memory.db | Already installed (agent.db) |
| `sqlite-vec` | Vector similarity search extension | New |
| `node-llama-cpp` | Local embedding model runtime | New |
| `chokidar` | File watching for sync | Likely already present |

---

_Design specification created: 2026-02-24_
_Replaces original M4b notebook design with markdown-first architecture_
_Based on approved CTO decisions — see `.claude/tasks/m6-memory-design/decisions.md`_
