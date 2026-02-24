# Memory System v2 — Design Document

> **Status:** Approved
> **Date:** 2026-02-24
> **Scope:** Markdown-first notebook memory with SQLite index, local embeddings, hybrid search
> **Milestone:** M6
> **Supersedes:** `docs/design/memory-system.md` (original SQLite-only notebook design)

---

## 1. Executive Summary

### What

A persistent memory system where Nina's knowledge lives in **markdown files** (human-readable, git-friendly) and is indexed in **SQLite** (fast search, hybrid BM25 + vector). The notebook is organized into folders by purpose: lists, reference, knowledge, and daily logs.

### Why

The original M4b design stored everything in SQLite with JSON columns. This was adequate for structured lists but made the data opaque — not editable by humans, not versionable in git, and not recoverable if the database corrupted.

The v2 design inverts this: **markdown is the source of truth**, SQLite is a derived index. This gives us:

- **Human editability** — User can open any file in a text editor
- **Git friendliness** — Memory changes show up as meaningful diffs
- **Recoverability** — Delete `memory.db`, rebuild from markdown in seconds
- **Agent compatibility** — Nina already has `notebook_edit` for section-based markdown editing

### Key Decisions

1. **Markdown is source of truth** — SQLite is derived, rebuildable
2. **One flat notebook** — No artificial shared/nina split; Nina writes anywhere
3. **Folder organization** — `lists/`, `reference/`, `knowledge/`, `daily/`
4. **Grouped search results** — No score boosting, grouping IS the priority
5. **Local embeddings only** — node-llama-cpp, no external API dependency
6. **Extract from OpenClaw** — Chunking, embedding, sync infrastructure is battle-tested

---

## 2. Architecture Overview

### Storage Layers

```
                    ┌─────────────────────────────────┐
                    │         AGENT BRAIN              │
                    │                                  │
                    │  memory_search()                 │
                    │  memory_get()                    │
                    │  notebook_write()                │
                    │  daily_log()                     │
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
                             │    │  Embedding          │
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
                              Generate embeddings (node-llama-cpp)
                                    │
                                    ▼
                              Upsert into SQLite (chunks, FTS, vectors)

READ PATH:
  memory_search("sarah phone")
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

### Prompt Integration

```
SYSTEM PROMPT ASSEMBLY (prompt.ts)
  │
  ├── brain/CLAUDE.md                    (personality — existing)
  ├── brain/memory/core/identity.md      (identity — existing)
  ├── brain/memory/core/contacts.md      (contacts — existing)
  ├── brain/memory/core/preferences.md   (preferences — existing)
  ├── runtime/standing-orders.md         (standing orders — existing)
  ├── runtime/external-communications.md (ext comms — existing)
  │
  ├── notebook/reference/*               (NEW: always loaded)
  ├── notebook/daily/{today}.md          (NEW: today's log)
  └── notebook/daily/{yesterday}.md      (NEW: yesterday's log)
```

---

## 3. File Structure

### Notebook Organization

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

### Example: `notebook/reference/contacts.md`

```markdown
# Contacts

## Sarah Chen
- Phone: 555-1234
- Email: sarah@example.com
- Company: Acme Corp, CTO
- Notes: Prefers email over phone. Vegetarian.

## Bob Smith
- Phone: 555-9876
- Notes: Old college friend. Lives in Austin.
```

### Example: `notebook/daily/2026-02-24.md`

```markdown
# Daily Log — 2026-02-24

## 09:15 — Morning check-in
User reviewed pending tasks. Cleared 3 items from todo list.

## 11:30 — Sarah meeting prep
Looked up Sarah's contact info. User mentioned new project timeline.
Sarah now at Acme Corp (previously TechFlow).
Updated contacts.

## 14:00 — Shopping list update
Added items for weekend dinner: salmon, asparagus, white wine.

## 17:45 — End of day
5 conversations, 2 tasks completed. Updated knowledge/facts.md with
new info about user's React project using v19.
```

### Example: `notebook/lists/shopping.md`

```markdown
# Shopping List

## Groceries
- Milk (oat)
- Eggs (dozen)
- Salmon fillet
- Asparagus
- White wine (Sauvignon Blanc)

## Hardware Store
- Light bulbs (LED, warm white)
- WD-40
```

---

## 4. SQLite Schema

All tables live in `.my_agent/brain/memory.db`. This database is derived — deletable and rebuildable from markdown source files.

```sql
-- Enable WAL mode and foreign keys
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
  embedding BLOB,                   -- Float32 array as blob (from node-llama-cpp)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_chunks_file ON chunks(file_path);
CREATE INDEX idx_chunks_hash ON chunks(hash);

-- ============================================================
-- VECTOR SEARCH (sqlite-vec)
-- Virtual table for cosine similarity queries
-- ============================================================

-- Dimension depends on model; embeddinggemma-300M produces 256-dim vectors
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[256]
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
```

### Why These Tables

| Table | Purpose | Notes |
|-------|---------|-------|
| `files` | Change detection | Compare hash on sync; skip unchanged files |
| `chunks` | Text storage + metadata | One file produces multiple chunks |
| `chunks_vec` | Vector similarity search | sqlite-vec virtual table, in-DB cosine search |
| `chunks_fts` | Keyword search | FTS5 BM25 ranking, no JS loop needed |
| `embedding_cache` | Avoid re-computation | Same chunk text = same embedding regardless of file |

### Index Lifecycle

```
File changed? (hash differs from files table)
    │
    YES ──► Delete old chunks for this file_path
    │       Parse into chunks (400 tokens, 80 overlap)
    │       For each chunk:
    │           Check embedding_cache by chunk hash
    │           ├── HIT: reuse cached embedding
    │           └── MISS: compute via node-llama-cpp, cache result
    │       Insert chunks + FTS + vec rows
    │       Update files table with new hash
    │
    NO ──► Skip (file unchanged)
```

---

## 5. Embedding Infrastructure

### Technology Stack

| Component | Choice | Notes |
|-----------|--------|-------|
| Runtime | node-llama-cpp | GPU support (CUDA/Metal/Vulkan), no Python needed |
| Model | embeddinggemma-300M | ~600MB GGUF, 256-dim vectors, auto-download |
| Vector storage | sqlite-vec | In-DB cosine queries, no external service |
| Keyword search | FTS5 | BM25 scoring built into SQLite |

### node-llama-cpp Setup

```typescript
import { getLlama, LlamaEmbeddingContext } from "node-llama-cpp";

class EmbeddingService {
  private context: LlamaEmbeddingContext | null = null;
  private modelPath: string;

  constructor(modelPath: string) {
    this.modelPath = modelPath;
  }

  /**
   * Initialize the embedding model (lazy, on first use).
   * Auto-downloads GGUF if not present.
   */
  async init(): Promise<void> {
    if (this.context) return;

    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: this.modelPath });
    this.context = await model.createEmbeddingContext();
  }

  /**
   * Embed a single text. Returns Float32Array.
   */
  async embed(text: string): Promise<Float32Array> {
    await this.init();
    const result = await this.context!.getEmbeddingFor(text);
    return result.vector;
  }

  /**
   * Batch embed multiple texts. More efficient than individual calls.
   */
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    await this.init();
    const results = await Promise.all(
      texts.map(text => this.context!.getEmbeddingFor(text))
    );
    return results.map(r => r.vector);
  }

  dispose(): void {
    this.context?.dispose();
    this.context = null;
  }
}
```

### Chunking Strategy

```typescript
interface ChunkOptions {
  maxTokens: number;     // 400 (~1600 chars)
  overlapTokens: number; // 80  (~320 chars)
  respectHeadings: boolean; // true — never split mid-heading section
}

/**
 * Chunk markdown text into overlapping segments.
 *
 * Strategy:
 * 1. Split on H1/H2 headings first (natural section boundaries)
 * 2. If a section exceeds maxTokens, split on paragraph breaks
 * 3. If still too long, split on sentence boundaries
 * 4. Apply overlap between consecutive chunks
 * 5. Attach nearest heading as metadata
 */
function chunkMarkdown(
  content: string,
  options: ChunkOptions
): Array<{
  text: string;
  heading: string | null;
  startLine: number;
  endLine: number;
}>;
```

### Sync Process

The `MemorySyncService` watches the notebook directory and keeps the SQLite index current.

```typescript
class MemorySyncService {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private dirty: Set<string> = new Set();

  /**
   * Start watching notebook directory.
   * Debounces changes — waits 1.5s after last change before syncing.
   */
  startWatching(notebookDir: string): void;

  /**
   * Full sync: scan all files, detect changes, reindex as needed.
   * Called on startup and after rebuild.
   */
  async fullSync(): Promise<SyncResult>;

  /**
   * Incremental sync: process only files in the dirty set.
   * Called by debounced watcher.
   */
  async incrementalSync(paths: string[]): Promise<SyncResult>;

  /**
   * Force rebuild: delete all index data and reindex everything.
   * Used for recovery or after schema changes.
   */
  async rebuild(): Promise<SyncResult>;
}

interface SyncResult {
  filesScanned: number;
  filesChanged: number;
  chunksCreated: number;
  embeddingsComputed: number;
  embeddingsCached: number;  // Reused from cache
  durationMs: number;
}
```

### Sync Triggers

| Trigger | When | Type |
|---------|------|------|
| File watcher | File saved (debounced 1.5s) | Incremental |
| Session start | Brain session begins | Full sync (if dirty flag set) |
| Search miss | `memory_search` finds stale index | Incremental for queried files |
| Manual rebuild | `POST /api/debug/memory/rebuild` | Full rebuild |

### Model Auto-Download

The embedding model GGUF file is auto-downloaded on first use. Storage location:

```
.my_agent/models/
└── embeddinggemma-300M-Q8_0.gguf    # ~600MB, downloaded once
```

node-llama-cpp handles download and caching automatically via its built-in model management.

---

## 6. Agent Interface

### Tools

Four tools exposed to the agent brain:

#### `memory_search` — Hybrid search across all indexed memory

```typescript
interface MemorySearchParams {
  query: string;
  sources?: ("notebook" | "daily" | "sessions")[];  // Default: all
  maxResults?: number;   // Default: 15
  minScore?: number;     // Default: 0.25
}

interface MemorySearchResult {
  notebook: SearchResult[];
  daily: SearchResult[];
  sessions: SearchResult[];
}

interface SearchResult {
  filePath: string;       // e.g. "reference/contacts.md"
  heading: string | null; // e.g. "## Sarah Chen"
  snippet: string;        // Matched text (~200 chars)
  score: number;          // 0.0 - 1.0 (hybrid BM25 + vector)
  lines: { start: number; end: number };
}
```

**Search strategy:**
1. Run FTS5 BM25 query (keyword match)
2. Run sqlite-vec cosine query (semantic match)
3. Merge results with reciprocal rank fusion (RRF)
4. Group by source: notebook → daily → sessions
5. Return up to `maxResults` total, grouped

No score boosting between groups. Grouping IS the priority — the agent checks notebook results first per instructions.

#### `memory_get` — Read a specific memory file or section

```typescript
interface MemoryGetParams {
  path: string;          // Relative to notebook/, e.g. "reference/contacts.md"
  startLine?: number;    // Optional: read from this line
  lines?: number;        // Optional: read this many lines
}

// Returns: string (file content or section content)
```

#### `notebook_write` — Write to any notebook page

```typescript
interface NotebookWriteParams {
  page: string;          // Relative path, e.g. "lists/shopping.md"
  content: string;       // Content to write
  section?: string;      // H2 section to target (e.g. "## Groceries")
  replace?: boolean;     // Replace section (true) or append (false, default)
}

// Returns: { success: boolean; message: string }
```

This replaces the old `notebook_edit` tool's functionality for the new notebook directory. The existing `notebook_edit` continues to work for `runtime/` files (standing orders, etc.).

#### `daily_log` — Append to today's daily log

```typescript
interface DailyLogParams {
  entry: string;         // Text to append (agent adds timestamp prefix)
}

// Returns: { success: boolean; path: string }
```

Behavior:
- Creates `notebook/daily/YYYY-MM-DD.md` if it doesn't exist
- Appends `## HH:MM — {first line}\n{entry}` under today's date heading
- File is append-only during the day

### Automatic Context Loading

These files are loaded into the system prompt on every brain query (no tool call needed):

| Source | When Loaded | Purpose |
|--------|-------------|---------|
| `notebook/reference/*` | Always | User's ground truth (contacts, preferences, orders) |
| `notebook/daily/{today}.md` | Always | What happened today |
| `notebook/daily/{yesterday}.md` | Always | Recent context from yesterday |

**Implementation** — extend `prompt.ts`:

```typescript
// Add to NOTEBOOK_FILES array:
const NOTEBOOK_REFERENCE_DIR = '../notebook/reference'  // Glob all .md files
const NOTEBOOK_DAILY_DIR = '../notebook/daily'           // Today + yesterday

// In assembleSystemPrompt():
// 1. Read all files from notebook/reference/ (with per-file size limit)
// 2. Read today's daily log
// 3. Read yesterday's daily log
// 4. Inject into system prompt sections
```

Per-file size limit: 8000 chars (same as existing `MAX_NOTEBOOK_CHARS`). Total reference limit: 32000 chars (prevents prompt bloat if user creates many reference files).

### Search Strategy

Results are grouped by source, not ranked across sources:

```
memory_search("sarah phone")
    │
    ├── NOTEBOOK (2 results)
    │   ├── reference/contacts.md:3-6 ............ 0.87
    │   │   "## Sarah Chen\n- Phone: 555-1234..."
    │   └── knowledge/facts.md:12 ................ 0.64
    │       "Sarah prefers email over phone"
    │
    ├── DAILY (1 result)
    │   └── daily/2026-02-20.md:8 ................ 0.52
    │       "Called Sarah about project timeline"
    │
    └── SESSIONS (0 results)
```

Nina's instructions tell her to check notebook group first. No artificial score boosting needed — the grouping itself communicates priority.

---

## 7. Pre-Compaction Flush

### Problem

The Agent SDK compresses context when approaching the window limit. If Nina has learned something in the current session but hasn't written it to her notebook, that knowledge is lost during compaction.

### Solution

Before compaction fires, inject a silent system turn that prompts Nina to save durable memories:

```
[System] Session nearing compaction. Write any durable memories to
your notebook or daily log now. After compaction, only your notebook
and recent daily logs will be available.
```

### How It Works

```
Context window usage approaches limit
    │
    ▼
Agent SDK signals pre-compaction event
    │
    ▼
Dashboard intercepts, injects system turn:
  "Session nearing compaction. Write any durable memories
   to your notebook or daily log now."
    │
    ▼
Nina responds (may call notebook_write / daily_log)
    │
    ▼
Compaction proceeds
    │
    ▼
Post-compaction: system prompt still has reference/* and daily logs
    → Nina retains core knowledge
```

### Implementation

In `packages/dashboard/src/agent/session-manager.ts`, listen for the Agent SDK's compaction signal:

```typescript
// Agent SDK emits 'pre_compaction' before compressing context
session.on('pre_compaction', async () => {
  // Inject a system-level reminder turn
  await session.injectSystemTurn(
    'Session nearing compaction. Write any durable memories ' +
    'to your notebook or daily log now. After compaction, only ' +
    'your notebook and recent daily logs will be available.'
  );
});
```

### When It Triggers

- Only during long-running sessions (typically 50+ turns)
- At most once per compaction cycle
- Nina may choose not to write anything (if nothing is worth saving)
- The system turn is invisible to the user

---

## 8. Dashboard Interface

### Existing Patterns

The dashboard uses:
- **Fixed homepage** with quick-access cards (timeline, tasks)
- **Tabs** (desktop) or **popovers** (mobile) for detail views
- Existing `type: "notebook"` tab pattern from M4
- Alpine.js stores for reactive state
- Tokyo Night color scheme

### New Components

#### 8.1 Homepage: Notebook Quick-Access Card

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

#### 8.2 Notebook Browser Tab

Full-width tab with folder navigation:

```
┌─────────────────────────────────────────────────────────────┐
│  NOTEBOOK                                                    │
│                                                              │
│  [lists/]  [reference/]  [knowledge/]  [daily/]  [Search]   │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  reference/                                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  contacts.md          2.1 KB    Modified: today      │   │
│  │  preferences.md       0.8 KB    Modified: yesterday  │   │
│  │  standing-orders.md   1.2 KB    Modified: Feb 20     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  [+ New Page]                                                │
└─────────────────────────────────────────────────────────────┘
```

#### 8.3 Page View/Edit

Opens as a tab (desktop) or popover (mobile):

```
┌─────────────────────────────────────────────────────────────┐
│  reference/contacts.md                      [Edit] [Delete] │
│  ─────────────────────────────────────────────────────────── │
│                                                              │
│  # Contacts                                                  │
│                                                              │
│  ## Sarah Chen                                               │
│  - Phone: 555-1234                                           │
│  - Email: sarah@example.com                                  │
│  - Company: Acme Corp, CTO                                   │
│  - Notes: Prefers email over phone.                          │
│                                                              │
│  ## Bob Smith                                                │
│  - Phone: 555-9876                                           │
│  - Notes: Old college friend. Lives in Austin.               │
│                                                              │
│  ─────────────────────────────────────────────────────────── │
│  Last modified: 2026-02-24 11:30                             │
└─────────────────────────────────────────────────────────────┘
```

Edit mode: simple textarea with markdown preview. No WYSIWYG — keep it simple.

#### 8.4 Memory Search

Grouped results matching the agent's `memory_search` output:

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
│  SESSIONS (0)                                                │
│  (no matching sessions)                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 8.5 Settings: Memory Management

Under the existing Settings panel:

```
┌─────────────────────────────────────────────────────────────┐
│  MEMORY                                                      │
│                                                              │
│  Index Status                                                │
│  ├─ Files indexed: 18                                        │
│  ├─ Total chunks: 142                                        │
│  ├─ Last sync: 2 min ago                                     │
│  └─ Embedding model: embeddinggemma-300M                     │
│                                                              │
│  [Rebuild Memory Index]     ← Deletes memory.db, re-syncs   │
│                                                              │
│  Storage                                                     │
│  ├─ Notebook: 18 files, 24 KB                                │
│  ├─ Daily logs: 12 files, 8 KB                               │
│  └─ Index: memory.db, 4.2 MB                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Nina's Instructions

### Addition to `brain/CLAUDE.md`

The following section is added to Nina's brain instructions:

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
1. Check notebook results first (your own notes)
2. Then daily logs (recent events)
3. Then session transcripts (conversation history)
4. If not found: ask the user

The user can edit any page. If they change something you wrote, respect their version.
```

### System Prompt Context

Nina automatically sees in her system prompt (no tool call needed):
- All files from `notebook/reference/` — her stable knowledge
- Today's daily log — what's happened so far today
- Yesterday's daily log — recent context

Everything else (lists, knowledge, older daily logs, sessions) requires `memory_search` to access.

---

## 10. Debug API

New endpoints added to the existing debug/admin API at `localhost:4321`.

### Read Endpoints (Debug)

```
GET /api/debug/memory/status
```

Returns index health and statistics.

```json
{
  "indexed": true,
  "lastSync": "2026-02-24T14:30:00Z",
  "lastSyncDuration": 1234,
  "files": {
    "total": 18,
    "stale": 0
  },
  "chunks": {
    "total": 142,
    "withEmbeddings": 142,
    "cachedEmbeddings": 98
  },
  "embeddingModel": "embeddinggemma-300M",
  "dbSizeBytes": 4400000,
  "watcherActive": true
}
```

```
GET /api/debug/memory/search?q=sarah+phone&sources=notebook,daily
```

Raw search results with scores (same format as agent tool output).

```json
{
  "query": "sarah phone",
  "results": {
    "notebook": [
      {
        "filePath": "reference/contacts.md",
        "heading": "## Sarah Chen",
        "snippet": "- Phone: 555-1234\n- Email: sarah@example.com",
        "score": 0.87,
        "lines": { "start": 3, "end": 6 }
      }
    ],
    "daily": [],
    "sessions": []
  },
  "timing": {
    "ftsMs": 2,
    "vectorMs": 15,
    "totalMs": 18
  }
}
```

```
GET /api/debug/memory/files
```

List all indexed files with hashes and sync status.

```json
{
  "files": [
    {
      "path": "reference/contacts.md",
      "hash": "a1b2c3...",
      "mtime": "2026-02-24T11:30:00Z",
      "size": 2100,
      "chunks": 3,
      "stale": false
    }
  ]
}
```

### Write Endpoints (Admin)

```
POST /api/debug/memory/rebuild
```

Trigger full reindex. Deletes all index data and rebuilds from markdown.

```json
{
  "started": true,
  "message": "Full rebuild initiated"
}
// Response after completion (long-poll or websocket):
{
  "completed": true,
  "result": {
    "filesScanned": 18,
    "filesChanged": 18,
    "chunksCreated": 142,
    "embeddingsComputed": 142,
    "durationMs": 3400
  }
}
```

### Notebook Operations (Admin — for test setup/teardown)

```
GET    /api/debug/notebook/pages           # List all notebook pages
GET    /api/debug/notebook/:path           # Read page content
POST   /api/debug/notebook/:path           # Write page (for test setup)
DELETE /api/debug/notebook/:path           # Delete page (for test cleanup)
```

### Simulation (Admin — for E2E testing)

```
POST /api/debug/memory/simulate-compaction
```

Triggers the pre-compaction flush mechanism. Used to test that Nina saves memories before context compression.

```
POST /api/debug/brain/inject-turn
```

Injects a turn into the current brain session. Used to test Nina's memory-writing behavior.

```json
{
  "role": "user",
  "content": "Remember that Sarah's new number is 555-4321"
}
```

---

## 11. Migration Path

### Current State

M4 implemented a basic notebook system with:
- `runtime/standing-orders.md`, `runtime/external-communications.md`, `runtime/reminders.md`
- `notebook_edit` tool for section-based markdown editing
- Static files loaded into system prompt via `prompt.ts`
- No search, no indexing, no embeddings

### Migration Steps

#### Step 1: Create notebook directory structure

```bash
mkdir -p .my_agent/notebook/{lists,reference,knowledge,daily}
```

#### Step 2: Migrate existing reference data

Move relevant content from existing `brain/memory/core/` files into the new notebook:

```
brain/memory/core/contacts.md  →  notebook/reference/contacts.md
brain/memory/core/preferences.md  →  notebook/reference/preferences.md
```

Keep the `brain/memory/core/identity.md` in place (it's part of the personality system, not the notebook).

#### Step 3: Migrate runtime notebook files

```
runtime/standing-orders.md  →  notebook/reference/standing-orders.md
runtime/reminders.md  →  (retired — replaced by calendar system in M4.5)
runtime/external-communications.md  →  notebook/reference/external-communications.md
```

Update `prompt.ts` to load from new paths (with backward compatibility for old paths during transition).

#### Step 4: Install dependencies

```bash
cd packages/core
npm install node-llama-cpp sqlite-vec better-sqlite3
```

Note: `better-sqlite3` is already a dependency (used by `agent.db`). We create a separate database (`memory.db`) for the memory index.

#### Step 5: Build sync infrastructure

Implement `MemorySyncService`, `EmbeddingService`, and the four agent tools.

#### Step 6: Initial index build

On first run after migration, `MemorySyncService.fullSync()` indexes all notebook files and creates `memory.db`.

#### Step 7: Update prompt assembly

Extend `assembleSystemPrompt()` in `prompt.ts` to:
1. Load all `notebook/reference/*.md` files
2. Load `notebook/daily/{today}.md` and `notebook/daily/{yesterday}.md`
3. Apply per-file and total size limits

#### Step 8: Wire dashboard

Add notebook browser tab, memory search, and settings panel to the dashboard.

### Backward Compatibility

During migration, `prompt.ts` checks both old and new paths:

```typescript
// Try new path first, fall back to old path
const standingOrders =
  await readOptionalFile(join(notebookDir, 'reference/standing-orders.md'))
  ?? await readOptionalFile(join(agentDir, 'runtime/standing-orders.md'));
```

The `notebook_edit` tool continues to work for both `runtime/` and `notebook/` paths (update `allowedPaths` config).

---

## 12. Configuration

### config.yaml additions

```yaml
# .my_agent/config.yaml

memory:
  # Notebook root (relative to .my_agent/)
  notebookDir: notebook

  # SQLite index location
  database: brain/memory.db

  # Embedding model
  embedding:
    model: embeddinggemma-300M     # GGUF model name (auto-download)
    dimensions: 256                 # Must match model output
    modelsDir: models               # Where to store downloaded models

  # Chunking
  chunking:
    maxTokens: 400                 # ~1600 chars per chunk
    overlapTokens: 80              # ~320 chars overlap
    respectHeadings: true          # Don't split mid-heading

  # Sync
  sync:
    watchDebounceMs: 1500          # Wait after last change before sync
    syncOnStart: true              # Full sync on brain start
    syncOnSearch: true             # Sync stale files before search

  # Search
  search:
    maxResults: 15                 # Default result count
    minScore: 0.25                 # Minimum relevance threshold
    fusionK: 60                    # RRF constant (higher = more weight to BM25)

  # Prompt injection
  prompt:
    referenceDir: reference        # Always loaded (relative to notebookDir)
    dailyWindow: 2                 # Days of daily logs to include (today + yesterday)
    maxPerFileChars: 8000          # Per-file size limit
    maxTotalReferenceChars: 32000  # Total reference section limit

  # Daily summaries
  dailySummary:
    enabled: true
    time: "23:59"
    model: claude-haiku-4-5-20251001  # Use Haiku for cost efficiency
```

### Default Values

All configuration has sensible defaults. A fresh install with no `config.yaml` memory section works out of the box:

| Setting | Default | Notes |
|---------|---------|-------|
| `notebookDir` | `notebook` | Relative to `.my_agent/` |
| `database` | `brain/memory.db` | Same location as old design |
| `embedding.model` | `embeddinggemma-300M` | Auto-downloads on first use |
| `chunking.maxTokens` | 400 | ~1600 chars |
| `chunking.overlapTokens` | 80 | ~320 chars |
| `sync.watchDebounceMs` | 1500 | 1.5 seconds |
| `search.maxResults` | 15 | More results, let LLM filter |
| `search.minScore` | 0.25 | Low threshold, trust grouping |
| `prompt.dailyWindow` | 2 | Today + yesterday |
| `prompt.maxPerFileChars` | 8000 | Same as existing limit |
| `prompt.maxTotalReferenceChars` | 32000 | ~8K tokens total |

---

## Appendix A: Reciprocal Rank Fusion (RRF)

The hybrid search merges BM25 (keyword) and vector (semantic) results using RRF:

```typescript
/**
 * Merge two ranked result lists using Reciprocal Rank Fusion.
 *
 * RRF(d) = sum over all lists: 1 / (k + rank(d))
 *
 * k = 60 (default) gives balanced weight to both lists.
 * Higher k = more weight to BM25 (keyword exact match).
 * Lower k = more weight to vector (semantic similarity).
 */
function reciprocalRankFusion(
  bm25Results: RankedResult[],
  vectorResults: RankedResult[],
  k: number = 60
): MergedResult[];
```

---

## Appendix B: Package Structure

New code lives primarily in `packages/core/src/memory/`:

```
packages/core/src/memory/
├── index.ts                # Public exports
├── types.ts                # Interfaces (SearchResult, SyncResult, etc.)
├── memory-db.ts            # SQLite schema, queries, migrations
├── embedding-service.ts    # node-llama-cpp wrapper
├── chunker.ts              # Markdown-aware text chunking
├── sync-service.ts         # File watching, change detection, indexing
├── search-service.ts       # Hybrid search (FTS5 + vector + RRF)
└── tools.ts                # Agent tool definitions (memory_search, etc.)

packages/dashboard/src/routes/
├── memory.ts               # REST API for dashboard notebook browser
└── debug.ts                # Extended with memory debug endpoints

packages/dashboard/public/js/
└── stores/
    └── notebook-store.js   # Alpine.js store for notebook UI
```

---

## Appendix C: Session Transcript Indexing

Conversation transcripts (`.my_agent/sessions/*.jsonl`) are also indexed in the same SQLite database, but with lower priority in search results.

The existing `turns_fts` table in `agent.db` already provides FTS for conversations. For M6, we add:
- Vector embeddings for conversation turns (batch-processed, not real-time)
- Unified search that queries both `memory.db` (notebook/daily) and `agent.db` (sessions)

Session indexing runs as a background job, not on every message. Frequency: once per hour or on demand via debug API.

---

_Design document created: 2026-02-24_
_Based on approved brainstorming session decisions captured in context.md_
