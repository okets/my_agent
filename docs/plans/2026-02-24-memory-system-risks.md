# M6 Memory System — Risk Analysis

> **Date:** 2026-02-24
> **Author:** Risk Analyst (Opus)
> **Inputs:** Approved design (context.md), current design spec, OpenClaw reference, codebase review

---

## 1. Design Gaps

### 1.1 Old Design Spec vs New Approved Design — Major Divergence
**Priority: Critical**

The current `docs/design/memory-system.md` describes a **SQLite-backed structured list system** (lists + entries tables, MCP tools like `list_create`, `entry_add`, `entry_search`). The new approved design in `context.md` describes a **markdown-files-as-source-of-truth system** with SQLite as a derived search index (chunks, embeddings, FTS5, sqlite-vec).

These are fundamentally different architectures:

| Aspect | Old Design Spec | New Approved Design |
|--------|----------------|---------------------|
| Source of truth | SQLite (lists + entries) | Markdown files |
| Data model | Structured JSON entries | Free-form markdown |
| Agent tools | `list_create`, `entry_add`, `entry_search` | `memory_search`, `memory_get`, `notebook_write`, `daily_log` |
| Search | FTS5 on JSON data column | Hybrid BM25 + vector (embeddings) |
| Recovery | SQLite backup | Delete DB, re-sync from markdown |

**Risk:** If the design spec is not updated before sprints begin, developers will build the wrong thing. The old spec's MCP tool interfaces are completely different from the approved design's tools.

**Mitigation:** Update `docs/design/memory-system.md` to reflect the approved design before any sprint planning begins. This is a **blocker**.

### 1.2 Notebook Tool Overlap with Existing `notebook_edit`
**Priority: High**

The approved design introduces `notebook_write(page, content, options)` for writing to notebook files. However, `packages/core/src/tools/notebook-edit.ts` already exists with section-based markdown editing (`read`, `write`, `append`, `delete` operations). The approved design also has `memory_get(path)` which overlaps with the existing tool's `read` operation.

**Underspecified:**
- Does `notebook_write` replace `notebook_edit`? Or do they coexist?
- If `notebook_write` is the new interface, what happens to standing orders management (currently via `notebook_edit`)?
- The approved design's `notebook_write` has `section` and `replace` options — very similar to `notebook_edit`'s section-based approach.

**Mitigation:** Explicitly decide: consolidate into one tool or keep both with clear separation of concerns.

### 1.3 Allowed Paths for Notebook Writing
**Priority: High**

The current `NotebookEditor` restricts writes to `['brain', 'runtime']` directories within `.my_agent/`. The new design introduces a `notebook/` directory at `.my_agent/notebook/` with subdirectories `lists/`, `reference/`, `knowledge/`, `daily/`.

**Underspecified:**
- Must the `NotebookEditor` allowed paths be updated to include `notebook/`?
- Or does `notebook_write` bypass `NotebookEditor` entirely with its own path validation?
- Security: the new `notebook_write` tool needs path traversal protection equivalent to the existing tool.

### 1.4 `memory_search` Scope and Session Indexing
**Priority: High**

The approved design says `memory_search` can search across `"notebook" | "daily" | "sessions"` sources. Session indexing means indexing JSONL transcript files.

**Underspecified:**
- How are session transcripts chunked? They're JSONL format, not markdown.
- What's the indexing strategy for sessions — full transcript or just user/assistant text?
- Are all historical sessions indexed, or only recent ones?
- Session transcripts can be very large — what's the storage/performance budget?
- The OpenClaw code has separate `session-files.ts` and `sync-session-files.ts` for this — significant complexity.

### 1.5 Pre-Compaction Flush Mechanism
**Priority: Medium**

The design mentions: "Before context window compaction, silent turn prompts Nina." However:
- The Agent SDK's compaction behavior is not well-documented for external hooks.
- How does the system detect "nearing compaction"? Token counting? SDK event?
- What does "silent turn" mean technically — a system message injected into the conversation? A tool call?
- What happens if Nina doesn't flush in time?

**Mitigation:** Investigate Agent SDK compaction hooks. If none exist, implement a token-counting heuristic (e.g., after N turns or estimated token count > threshold).

### 1.6 Automatic Context Loading Size Budget
**Priority: Medium**

The design says `notebook/reference/*` is "always loaded in prompt" and `notebook/daily/` loads today + yesterday. But:
- No size limit is specified for reference files.
- The current prompt already loads brain files + notebook files + calendar context + skills. Adding reference/* could blow up the context.
- The existing `MAX_NOTEBOOK_CHARS = 8000` applies per file. Is that sufficient for reference?
- What if the user creates 20 reference files?

**Mitigation:** Define a total budget for auto-loaded memory content (e.g., 12K chars total across all reference + daily files). Prioritize by recency or explicit ordering.

### 1.7 Embedding Dimension and Vector Search Configuration
**Priority: Medium**

The design specifies `embeddinggemma-300M` but doesn't document:
- Embedding dimension (needed for sqlite-vec virtual table creation)
- Distance metric (cosine vs L2 vs inner product)
- Vector weight vs text weight for hybrid search scoring
- Minimum score threshold tuning guidance

The OpenClaw code uses configurable weights and the `mergeHybridResults` function. These parameters significantly affect search quality.

### 1.8 Daily Log vs Daily Summary
**Priority: Low**

The context.md design has `daily_log(entry)` which appends to today's daily file. The old design spec describes "daily summaries" generated by Haiku at 23:59.

**Underspecified:**
- Are these the same thing? The names suggest different purposes.
- Is daily_log just append-only entries Nina writes during conversation?
- Is the Haiku-generated summary still planned? Or replaced by Nina's own daily logs?
- If both exist, do they go in the same file or separate files?

---

## 2. Technical Risks

### 2.1 node-llama-cpp Build and Compatibility
**Priority: Critical**

node-llama-cpp requires native compilation (C++ with CMake). On WSL2:
- **Build dependencies:** cmake, build-essential, potentially CUDA toolkit for GPU acceleration
- **First build:** Can take 5-15 minutes depending on system
- **Node.js version sensitivity:** node-llama-cpp pins to specific Node.js versions; mismatches cause segfaults
- **WSL2 GPU passthrough:** CUDA/Vulkan support in WSL2 requires specific driver versions and configuration
- **CPU fallback:** Without GPU, embedding generation will be significantly slower (acceptable for small notebook, problematic for session indexing)
- **npm install impact:** node-llama-cpp adds significant weight to `node_modules` and install time

**Evidence from OpenClaw:** The `node-llama.ts` file is a thin wrapper (`import("node-llama-cpp")`), suggesting the real complexity is in build/configuration, not code.

**Mitigation:**
- Test build on clean WSL2 environment before sprint starts (prototype)
- Document exact Node.js version requirement
- Implement graceful degradation: if node-llama-cpp fails to load, fall back to FTS5-only search
- Consider making embeddings optional (FTS5 works without them)

### 2.2 sqlite-vec Availability
**Priority: High**

sqlite-vec is a SQLite extension that must be loaded at runtime. The OpenClaw code uses `sqlite-vec` npm package with `getLoadablePath()`.

**Risks:**
- The dashboard currently uses `better-sqlite3` (npm package). The new memory system design uses `node:sqlite` (Node.js built-in). These are **different SQLite bindings** with different extension loading APIs.
- `better-sqlite3` uses `.loadExtension()` on the database instance.
- `node:sqlite` (used in OpenClaw) uses `db.enableLoadExtension(true)` + `db.loadExtension()`.
- If we use `better-sqlite3` (consistent with dashboard), we need to verify sqlite-vec compatibility.
- If we use `node:sqlite`, we need Node.js 22+ (which has `node:sqlite` as experimental).

**Mitigation:** Decide which SQLite binding to use for memory.db before implementation. Options:
1. Use `better-sqlite3` (consistent with existing `agent.db`) — verify sqlite-vec loading works
2. Use `node:sqlite` (consistent with OpenClaw) — requires Node.js 22+, two different SQLite runtimes in one process
3. Use `better-sqlite3` for everything and port OpenClaw's sqlite-vec loading

**This is a CTO decision needed.**

### 2.3 embeddinggemma-300M Model Quality
**Priority: Medium**

The design specifies `embeddinggemma-300M` (~600MB GGUF). Considerations:
- This is a relatively small embedding model. Quality for personal notebook content (short entries, names, phone numbers) may be acceptable.
- For session transcript search (longer, conversational text), quality may degrade compared to remote APIs (OpenAI, Voyage).
- No benchmark data is provided for this specific model on personal assistant use cases.
- The OpenClaw codebase supports multiple embedding providers (OpenAI, Voyage, Gemini, node-llama-cpp) — my_agent only supports local, limiting quality options.

**Mitigation:** The hybrid search approach (BM25 + vector) compensates for weaker embeddings. BM25 handles exact matches (names, numbers) well; vector handles semantic similarity. This is a good design choice that reduces risk.

### 2.4 Performance on Large Notebooks
**Priority: Low (for now)**

For a personal assistant, notebook size should remain small (tens of files, not thousands). However:
- Session transcripts could grow large over months (hundreds of JSONL files, each potentially hundreds of KB)
- Full reindex (`POST /api/debug/memory/rebuild`) could be slow if session corpus is large
- Embedding generation for cold start (new install or DB rebuild) with local model on CPU could take minutes

**Mitigation:** Incremental sync (file hash change detection) means only modified files are re-embedded. Cold start cost is one-time. Session indexing can be bounded (e.g., last 90 days).

### 2.5 WSL2 File Watching (chokidar)
**Priority: Medium**

The design specifies "File watch (debounced 1.5s)" for sync triggers. WSL2 has known issues with inotify:
- File changes from Windows side (editing .my_agent files in Windows editor) may not trigger inotify events in WSL2
- chokidar's polling mode works but increases CPU usage
- The OpenClaw code uses chokidar — so this is a known-working approach, but WSL2 quirks remain

**Mitigation:**
- Use chokidar with `usePolling: true` as fallback for WSL2
- The "on search if dirty" trigger in the design is a good safety net — even if file watch misses a change, search will catch up
- "Session start" sync is another safety net

---

## 3. Integration Risks

### 3.1 Prompt Assembly Changes
**Priority: Critical**

The current `packages/core/src/prompt.ts` loads specific hardcoded files:
```typescript
const BRAIN_FILES = [
  { rel: 'CLAUDE.md', header: null },
  { rel: 'memory/core/identity.md', header: '## Identity' },
  { rel: 'memory/core/contacts.md', header: '## Key People' },
  { rel: 'memory/core/preferences.md', header: '## Preferences' },
]

const NOTEBOOK_FILES = [
  { rel: '../runtime/external-communications.md', header: '## External Communications Rules' },
  { rel: '../runtime/reminders.md', header: '## Reminders' },
  { rel: '../runtime/standing-orders.md', header: '## Standing Orders' },
]
```

The new design introduces `notebook/reference/*` (dynamic, glob-loaded) and `notebook/daily/` (today + yesterday). This requires:
- Replacing hardcoded `BRAIN_FILES` with a dynamic file discovery approach
- Adding a new "always-load" section for reference files
- Adding daily file loading logic
- Maintaining backward compatibility with existing `NOTEBOOK_FILES` (standing orders, external communications) or migrating them into the new notebook structure

**Risk:** The prompt assembly is used by every brain query. A regression here breaks everything.

**Mitigation:**
- Write thorough tests for the new prompt assembly before deploying
- Migration plan: move existing runtime files into `notebook/reference/` or keep them alongside
- Incremental approach: add notebook loading first, then remove old paths

### 3.2 Database Architecture — memory.db vs agent.db
**Priority: High**

The design puts memory.db at `.my_agent/brain/memory.db`. The existing `agent.db` is at `.my_agent/conversations/agent.db`.

**Considerations:**
- Two separate SQLite databases is fine architecturally (memory is derived, agent.db is source of truth for conversations/tasks)
- However, if `memory_search` needs to search sessions, it needs access to transcript paths — which are managed by `ConversationDatabase`/`agent.db`
- Cross-database queries aren't possible without ATTACH or application-level joining
- The session indexing in memory.db duplicates some metadata from agent.db (file paths, conversation IDs)

**Mitigation:** Keep them separate (correct for the derived-index model). Use application-level coordination: ConversationDatabase provides transcript paths, MemoryIndexManager indexes them.

### 3.3 Context Builder Integration
**Priority: Medium**

The current `context-builder.ts` builds context injection for cold-start conversation resumption (recent turns + abbreviation). The new memory system adds another dimension:
- Memory search results could provide relevant context for conversation resumption
- But the design doesn't specify how memory context interacts with conversation context injection
- Risk of context budget overflow: conversation history + memory reference files + daily logs + calendar context + skills could exceed useful prompt size

**Mitigation:** Define a total context budget and allocation strategy (e.g., reference: 4K, daily: 2K, calendar: 2K, skills: 2K, conversation history: variable).

### 3.4 Task System Integration
**Priority: Medium**

Tasks can trigger brain queries (scheduled tasks, immediate tasks). When a task runs:
- Should the task's brain query include memory context? (Probably yes)
- Should task results be indexed in memory? (The design doesn't mention this)
- Task logs are stored separately from conversation transcripts — are they searchable via `memory_search`?

**Mitigation:** For M6 Sprint 1, keep task integration minimal. Memory context loads for all brain queries (including task-triggered ones). Task log indexing can be deferred.

### 3.5 WhatsApp Channel Considerations
**Priority: Low**

WhatsApp messages go through the brain and are stored in conversation transcripts. No special handling needed for M6. However:
- If Nina learns something from a WhatsApp conversation and writes to notebook, the notebook write happens during a brain query triggered by WhatsApp — this should work with the existing tool infrastructure.
- WhatsApp media (images, voice notes) won't be indexed by the memory system.

---

## 4. Operational Risks

### 4.1 Database Corruption
**Priority: Medium**

memory.db is a derived index — corruption means delete and rebuild. However:
- Rebuild requires re-embedding all content (expensive with local model)
- If rebuild happens during active brain queries, concurrent access could cause issues
- `node:sqlite` DatabaseSync is synchronous — concurrent access patterns differ from `better-sqlite3`

**Mitigation:**
- WAL mode for concurrent reads during writes
- The "Recreate Memory Database" button in the dashboard settings provides user-facing recovery
- Rebuild should be asynchronous with progress reporting

### 4.2 First-Run Experience (Model Download)
**Priority: High**

node-llama-cpp auto-downloads the GGUF model (~600MB). On first run:
- The download blocks memory system initialization
- No search is available until download completes
- On slow connections, this could take 5-15 minutes
- If download fails (network issue), the memory system is non-functional
- No progress indicator unless we implement one

**Mitigation:**
- FTS5 search should work immediately (no embeddings needed for keyword search)
- Show download progress in dashboard (notification or status bar)
- Allow system to function without embeddings (keyword-only search as graceful degradation)
- Consider a "Download Embedding Model" button in settings rather than auto-download

### 4.3 Disk Space
**Priority: Low**

- Embedding model: ~600MB (one-time)
- memory.db: Proportional to content. For a personal notebook (< 100 files) + 6 months of sessions, expect < 50MB
- Embedding cache: Prevents re-computation but grows over time. Should have eviction policy.

**Mitigation:** Monitor disk usage in debug API status endpoint. Provide cache cleanup in settings.

### 4.4 Sync Failures
**Priority: Low**

File watch + hash-based change detection is robust. Failure modes:
- File deleted while being indexed → catch ENOENT, skip
- File locked by another process → retry with backoff
- Corrupted markdown → chunking should handle gracefully (just produce one big chunk)

The OpenClaw implementation is "battle-tested" per the design context. Extract carefully and these should be covered.

---

## 5. UX Risks

### 5.1 Search Quality with Local Embeddings
**Priority: Medium**

Local embeddings (300M parameter model) will produce lower-quality semantic matches than remote APIs. For a personal notebook:
- Names and exact terms: BM25 handles well (no embedding needed)
- Semantic queries ("what did we discuss about the birthday party"): Embedding quality matters
- Mixed queries ("Sarah's recommendation"): Hybrid approach helps

**Risk:** Users may perceive search as "not finding things" if they rely on semantic queries. The old design spec had simple FTS5 on JSON fields — actually sufficient for structured data.

**Mitigation:**
- Tune hybrid weights to favor BM25 for short queries, vector for longer queries
- Return more results (15, as specified) and let LLM filter
- Grouping by source (notebook > daily > sessions) provides natural prioritization

### 5.2 Nina Writing Too Much / Too Little
**Priority: Medium**

Nina's notebook writing behavior is governed by instructions in `brain/CLAUDE.md`. Risks:
- **Too much:** Nina saves every piece of information, cluttering the notebook. Daily logs become verbose.
- **Too little:** Nina doesn't proactively save, user expects her to remember things from conversations.
- **Wrong place:** Nina puts durable facts in daily log instead of reference, or vice versa.

**Mitigation:**
- Clear instructions with examples in CLAUDE.md (provided in the design)
- The pre-compaction flush prompt acts as a safety net
- User can review and edit notebook via dashboard
- Standing orders can tune behavior ("save more/less aggressively")

### 5.3 Notebook Organization Drift
**Priority: Low**

Over time, the notebook may accumulate:
- Duplicate entries across files
- Outdated information
- Orphaned daily logs
- Poorly organized knowledge files

**Mitigation:**
- Dashboard notebook browser lets users review and organize
- Future: periodic cleanup suggestions (not in M6 scope)
- Daily logs naturally archive (old dates become less relevant)

### 5.4 Dashboard Notebook Browser Complexity
**Priority: Medium**

The design describes a full notebook browser with folder navigation, page view/edit, and search. This is significant frontend work:
- Markdown rendering in the browser
- File editing with conflict detection (what if Nina writes while user is editing?)
- Folder tree navigation
- Real-time updates when Nina modifies files

**Mitigation:** Phase the dashboard work. Sprint 1: backend + tools. Sprint 2: basic dashboard viewer. Sprint 3: editing + search. Don't try to ship everything at once.

---

## 6. Mitigation Strategies Summary

| Risk | Priority | Mitigation |
|------|----------|------------|
| Old design spec divergence | **Critical** | Update design spec before sprints — **BLOCKER** |
| Prompt assembly changes | **Critical** | Incremental migration, thorough tests |
| node-llama-cpp build | **Critical** | Prototype on clean WSL2 first, graceful fallback to FTS5-only |
| SQLite binding choice | **High** | CTO decision: better-sqlite3 vs node:sqlite — **BLOCKER** |
| Notebook tool overlap | **High** | Decide: consolidate or separate notebook_edit and notebook_write |
| Session indexing complexity | **High** | Defer session indexing to Sprint 2 or 3; start with notebook-only |
| Model download UX | **High** | FTS5 works immediately; show progress; optional download |
| Reference file auto-load budget | **Medium** | Define total context budget with caps |
| Pre-compaction flush mechanism | **Medium** | Research Agent SDK hooks; implement token heuristic |
| WSL2 file watching | **Medium** | chokidar polling + on-search-if-dirty fallback |
| Search quality | **Medium** | Hybrid search, generous result count, BM25 for exact matches |
| Dashboard browser complexity | **Medium** | Phase into multiple sprints |

---

## 7. Dependencies

### What Must Exist Before M6 Can Start

| Dependency | Status | Notes |
|------------|--------|-------|
| M5 Task System | **Complete** | All 10 sprints done |
| Updated design spec | **Needed** | Current spec is outdated — must reflect approved design |
| SQLite binding decision | **Needed** | better-sqlite3 vs node:sqlite for memory.db |
| node-llama-cpp build validation | **Recommended** | Prototype on target WSL2 environment |
| Notebook tool consolidation decision | **Recommended** | Before implementing new tools |

### What M6 Blocks

| Blocked By M6 | Impact |
|----------------|--------|
| M8 Operations Dashboard | Memory viewer section requires M6 search API |
| M7 Coding Projects (partial) | Could benefit from memory search for project context, but not a hard dependency |

---

## 8. Recommended Sprint Phasing

Based on risk analysis, recommended sprint breakdown:

**Sprint 1 — Infrastructure + Notebook Indexing**
- SQLite memory.db setup (schema, sqlite-vec, FTS5)
- node-llama-cpp integration + model download
- Markdown file sync (chokidar + hash-based change detection)
- Chunking + embedding pipeline (extracted from OpenClaw)
- `memory_search` tool (notebook sources only, no sessions yet)
- `memory_get` tool
- Debug API endpoints

**Sprint 2 — Notebook Writing + Prompt Integration**
- `notebook_write` tool (or consolidate with notebook_edit)
- `daily_log` tool
- Updated prompt assembly (auto-load reference + daily)
- Pre-compaction flush mechanism
- Nina's CLAUDE.md instructions

**Sprint 3 — Dashboard + Session Indexing**
- Notebook browser in dashboard (view + basic edit)
- Memory search UI (grouped results)
- Session transcript indexing (deferred complexity)
- Settings: "Recreate Memory Database" button
- E2E testing

---

## 9. Open Questions for CTO

1. **SQLite binding:** Use `better-sqlite3` (consistent with dashboard) or `node:sqlite` (consistent with OpenClaw)? This affects how sqlite-vec and FTS5 are loaded.

2. **Notebook tool consolidation:** Should `notebook_write` from the new design replace `notebook_edit`? Or should they coexist with different scopes (notebook_edit for runtime files, notebook_write for notebook/ files)?

3. **Session indexing scope:** Index all historical sessions or bounded window (e.g., last 90 days)? Full session indexing adds significant complexity and storage.

4. **Daily summaries:** The old design spec describes Haiku-generated daily summaries at 23:59. The new design has `daily_log` (Nina writes manually). Are both needed, or does daily_log replace the automated summary?

5. **Embedding model download:** Auto-download on first use, or explicit "Download Model" action in settings?

---

_Analysis complete: 2026-02-24_
