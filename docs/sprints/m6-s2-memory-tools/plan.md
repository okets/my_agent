# M6-S2: Memory Tools + Prompt Integration — Sprint Plan

## Context

S1 built the infrastructure: SQLite index, embeddings plugins, sync service, hybrid search.
S2 wires it all together: write tools for the agent, prompt integration, server initialization.

**Design spec:** [docs/design/memory-system.md](../../design/memory-system.md)

---

## Tasks

### T1: Server Initialization — Wire Memory Services
**Files:** `packages/dashboard/src/index.ts` (or new `memory-init.ts`)

- Initialize MemoryDb, PluginRegistry, SyncService, SearchService on server startup
- Attach to fastify decorators (memoryDb, syncService, searchService, pluginRegistry)
- Start file watcher (syncService.startWatching())
- Run initial sync on startup
- Graceful shutdown: stop watcher, close db

### T2: `remember()` Tool
**Files:** `packages/core/src/memory/tools.ts`
**Deps:** T1

Intent-based memory write. Routes to appropriate notebook file:
```typescript
interface RememberParams {
  content: string;        // What to remember
  category?: "lists" | "reference" | "knowledge";  // Default: auto-route
  file?: string;          // Specific file, e.g. "contacts"
  section?: string;       // H2 section to append under
}
```

Behavior:
- If category omitted, infer from content (contacts → reference/contacts, todo → lists/todos)
- If file omitted, use sensible defaults (contacts.md, preferences.md, facts.md)
- Append content under matching section (create section if missing)
- Return: `{ success, file, section }`

### T3: `daily_log()` Tool
**Files:** `packages/core/src/memory/tools.ts`
**Deps:** T1

Append to today's daily log:
```typescript
interface DailyLogParams {
  entry: string;         // Text to append (agent adds timestamp prefix)
}
```

Behavior:
- Get today's date in YYYY-MM-DD format
- Create `daily/{date}.md` if it doesn't exist (with `# {date}` header)
- Append entry with timestamp prefix: `- [HH:MM] {entry}`
- Return: `{ success, file, timestamp }`

### T4: `notebook_write()` Tool
**Files:** `packages/core/src/memory/tools.ts`
**Deps:** T1

Direct file write (escape hatch):
```typescript
interface NotebookWriteParams {
  path: string;          // Relative to notebook/, e.g. "lists/shopping.md"
  content: string;       // Content to write
  section?: string;      // Optional H2 section to target
  replace?: boolean;     // Replace section (true) or append (false)
}
```

Behavior:
- Validate path is within notebook/ (no escaping)
- If section specified: find/create section, replace or append
- If no section: replace entire file content
- Return: `{ success, message }`

### T5: `conversation_search()` Tool
**Files:** `packages/core/src/memory/tools.ts`
**Deps:** T1

Search conversation transcripts (separate from notebook):
```typescript
interface ConversationSearchParams {
  query: string;
  maxResults?: number;   // Default: 10
  channel?: string;      // Filter by channel
}
```

Behavior:
- Use FTS5 search on conversations.db (already has FTS)
- Return snippets with conversation ID, channel, timestamp
- Separate from recall() to avoid polluting notebook results

### T6: Prompt Assembly — Auto-Load Reference + Daily
**Files:** `packages/core/src/prompt.ts`
**Deps:** T1

Update `assembleSystemPrompt()` to include:
1. All files in `notebook/reference/*` (up to 32K chars total, 8K per file)
2. Today's daily log: `notebook/daily/{today}.md`
3. Yesterday's daily log: `notebook/daily/{yesterday}.md`

Format in prompt:
```
## Your Notebook (Reference)

### Standing Orders
{content of standing-orders.md}

### Contacts
{content of contacts.md}

### Preferences
{content of preferences.md}

## Recent Daily Logs

### Today (2026-02-24)
{content of today's log}

### Yesterday (2026-02-23)
{content of yesterday's log}
```

Backward compat: check old paths (`runtime/`, `brain/memory/core/`) if new paths empty.

### T7: Pre-Compaction Flush
**Files:** `packages/dashboard/src/agent/` (or new file)
**Deps:** T2, T3, T6

Before context compression, prompt Nina to save important memories:
```
System: Context is approaching limits. Before I compress our conversation:
1. Use remember() to save any important facts from this session
2. Use daily_log() to note what we accomplished
3. Say "done" when ready to continue
```

Trigger: SDK compaction event or token count threshold (~80% of limit).

### T8: Nina's CLAUDE.md Memory Instructions
**Files:** `.my_agent/brain/CLAUDE.md` (or template)
**Deps:** T2, T3, T4

Add memory section to Nina's CLAUDE.md:
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
- New contact or preference learned → remember()
- Important fact discovered → remember(category: "knowledge")
- Significant event or accomplishment → daily_log()
- Pre-compaction → save anything important before context is compressed

**Search priority:**
1. recall() first (notebook + daily logs)
2. conversation_search() if not in notebook
3. Ask user if still not found

The user can edit any page. Respect their changes.
```

### T9: Integration Testing
**Deps:** All

- Test remember() routes to correct files
- Test daily_log() creates and appends correctly
- Test notebook_write() with sections
- Test prompt assembly includes reference + daily
- Test conversation_search() finds transcript content
- Test graceful startup/shutdown

---

## Dependencies

```
T1 (Server Init) ─┬─► T2 (remember)
                  ├─► T3 (daily_log)
                  ├─► T4 (notebook_write)
                  ├─► T5 (conversation_search)
                  └─► T6 (Prompt Assembly)

T2, T3, T6 ─► T7 (Pre-Compaction)
T2, T3, T4 ─► T8 (CLAUDE.md)
All ─► T9 (Testing)
```

**Parallel tracks:**
- Track A: T1 → T2, T3, T4 (write tools)
- Track B: T1 → T5, T6 (search + prompt)
- Converge at T7, T8, T9

---

## Verification

- [ ] `npx tsc --noEmit` passes (core + dashboard)
- [ ] `npm run build` succeeds (core + dashboard)
- [ ] `npm test` passes (new + existing tests)
- [ ] Server starts with memory services initialized
- [ ] remember() writes to correct notebook files
- [ ] daily_log() creates and appends entries
- [ ] Prompt includes reference/* and daily logs
- [ ] conversation_search() finds transcript content
- [ ] Memory services stop cleanly on shutdown

---

## Team

| Role | Model |
|------|-------|
| Tech Lead | Opus |
| Backend Dev | Sonnet |
| Reviewer | Opus |

---

## Notes

- **Settings UI** is deferred to S3 — this sprint focuses on tools + prompt
- **Dashboard initialization** already has patterns from ConversationManager, ChannelManager
- **Pre-compaction** depends on understanding SDK compaction events
- **conversation_search** uses existing FTS on conversations.db, not notebook memory.db
