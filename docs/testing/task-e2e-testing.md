# E2E Testing Guide

> **Purpose:** Validate core systems via mobile UI.
> **Tester:** Hanan (mobile interface)
> **Agent:** Assists with backend observation, debugging, fixes

---

# Task System E2E Testing

## Context for Coding Agent

### What We're Testing
1. **Task creation** — Natural language → task object with extracted metadata
2. **Step extraction** — Multi-part instructions → discrete executable steps
3. **Scheduling** — Time expressions → calendar entries with triggers
4. **Execution** — Scheduled tasks fire at correct time and execute steps

### Architecture
- **Dashboard:** `packages/dashboard/` — Fastify server, WebSocket chat, REST API
- **Task storage:** `.my_agent/tasks/` — JSON files per task
- **Calendar:** `.my_agent/calendar/` — Scheduled entries
- **Task logs:** `.my_agent/task-logs/` — Execution logs

### Useful Commands
```bash
# Watch task creation
ls -la .my_agent/tasks/

# Watch calendar entries
ls -la .my_agent/calendar/

# Watch task logs
ls -la .my_agent/task-logs/

# Tail server logs
# (check terminal running dashboard)

# Reset all test data
npx tsx packages/dashboard/tests/reset-test-data.ts
```

### What to Check When Tests Fail
1. **Task not created** → Check server logs, WebSocket handling, task parser
2. **Steps not extracted** → Check step extraction logic, NLP parsing
3. **Schedule not set** → Check time expression parsing, calendar integration
4. **Task didn't fire** → Check scheduler, cron/timer system, calendar trigger
5. **Execution failed** → Check task executor, step runner, tool availability

---

## Test Checklist

### Phase 1: Immediate Tasks (No Scheduling)

| # | Task Input | Expected Steps | Expected Behavior | Status |
|---|------------|----------------|-------------------|--------|
| 1.1 | "Check the weather in Tel Aviv" | 1. Fetch weather | Single-step task, executes immediately, returns weather | ⬜ |
| 1.2 | "Check the weather in Tel Aviv and tell me if I need an umbrella" | 1. Fetch weather 2. Evaluate rain 3. Respond | Multi-step, conditional logic | ⬜ |
| 1.3 | "Look up AAPL and MSFT stock prices and tell me which is up more today" | 1. Fetch AAPL 2. Fetch MSFT 3. Compare 4. Report | Multi-fetch, comparison | ⬜ |
| 1.4 | "Draft a short thank-you message for Dana and save it as a note" | 1. Compose message 2. Save note | Generation + storage | ⬜ |
| 1.5 | "Review my calendar for tomorrow and list any time conflicts" | 1. Fetch calendar 2. Detect overlaps 3. Report | Data analysis task | ⬜ |

### Phase 2: Scheduled Tasks (Short Delays)

> **Timing:** Use 2-3 minute delays. Note the exact scheduled time for verification.

| # | Task Input | Expected Steps | Expected Behavior | Status |
|---|------------|----------------|-------------------|--------|
| 2.1 | "In 2 minutes, remind me to stretch" | 1. Send reminder | Basic scheduled reminder, fires at T+2min | ⬜ |
| 2.2 | "In 3 minutes, check the weather in Tel Aviv and message me on WhatsApp" | 1. Fetch weather 2. Send WhatsApp | Scheduled multi-step with external action | ⬜ |
| 2.3 | "At [specific time +3min], check my inbox and flag anything from Amazon" | 1. Query inbox 2. Filter 3. Update flags | Absolute time scheduling, multi-step | ⬜ |
| 2.4 | "In 2 minutes, check if I have any tasks due today and summarize them" | 1. Query tasks 2. Filter by date 3. Summarize | Self-referential (tasks about tasks) | ⬜ |

### Phase 3: Scheduled Tasks (Longer Delays)

> **Run after Phase 2 passes.** Tests 10-30 minute scheduling reliability.

| # | Task Input | Expected Steps | Expected Behavior | Status |
|---|------------|----------------|-------------------|--------|
| 3.1 | "In 15 minutes, send me a WhatsApp with a motivational quote" | 1. Generate quote 2. Send WhatsApp | Medium delay, generation + send | ⬜ |
| 3.2 | "In 30 minutes, check the news headlines and summarize top 3" | 1. Fetch news 2. Filter top 3 3. Summarize | Longer delay, multi-step | ⬜ |

### Phase 4: Edge Cases

| # | Task Input | Expected Behavior | Status |
|---|------------|-------------------|--------|
| 4.1 | "Remind me tomorrow at 9am to call the dentist" | Creates task scheduled for next day 9am | ⬜ |
| 4.2 | "Every day at 8am, check my calendar" | Recurring task (if supported) OR graceful rejection | ⬜ |
| 4.3 | "Do something in 5 minutes" | Handles vague instruction gracefully | ⬜ |
| 4.4 | "In -5 minutes, remind me" | Rejects invalid time | ⬜ |

---

## Reporting Format

When reporting a test result:

```
## Test X.X: [PASS/FAIL/PARTIAL]

**Input:** [exact message sent]
**Time:** [timestamp]

**Observed:**
- [what actually happened]

**Expected:**
- [what should have happened]

**Logs/Errors:** (if any)
[paste relevant logs]
```

---

# Memory System E2E Testing

## Context for Coding Agent

### What We're Testing
1. **File indexing** — Notebook files get chunked and indexed in SQLite
2. **Keyword search** — FTS5 full-text search on indexed content
3. **Semantic search** — Embeddings-based similarity search (requires plugin)
4. **Live updates** — File changes trigger dashboard updates via WebSocket
5. **Recall tool** — Nina can search her memory during conversations

### Architecture
- **Notebook:** `.my_agent/notebook/` — Markdown files organized by folder
- **Memory DB:** `.my_agent/memory.db` — SQLite with FTS5 + optional vectors
- **Sync service:** `packages/core/src/memory/sync-service.ts` — File watcher + indexer
- **Embeddings:** Optional plugins (Ollama, OpenAI) for semantic search

### Useful Commands
```bash
# Check indexed files
sqlite3 .my_agent/memory.db "SELECT path, size FROM files"

# Check chunk count
sqlite3 .my_agent/memory.db "SELECT COUNT(*) FROM chunks"

# Test keyword search
curl http://localhost:4321/api/debug/memory/search?q=test

# Check memory status
curl http://localhost:4321/api/debug/memory/status

# Trigger rebuild
curl -X POST http://localhost:4321/api/debug/memory/rebuild
```

### What to Check When Tests Fail
1. **File not indexed** → Check file watcher logs, verify `.md` extension
2. **Search returns nothing** → Check if file was synced, rebuild index
3. **Live update not received** → Check WebSocket connection, sync events
4. **Embeddings not working** → Check plugin activation, Ollama running
5. **Recall tool fails** → Check memory API, brain has access to tools

---

## Test Checklist

### Phase 5: Memory Indexing

| # | Action | Expected Behavior | Status |
|---|--------|-------------------|--------|
| 5.1 | Create file: `notebook/reference/test-doc.md` with content "The quick brown fox" | File appears in Settings → Memory → Files list | ⬜ |
| 5.2 | Modify the file, add "jumps over the lazy dog" | Chunk count increases, file mtime updates | ⬜ |
| 5.3 | Delete the file | File removed from index, chunks deleted | ⬜ |
| 5.4 | Click "Rebuild Index" in Settings | All notebook files re-indexed, stats update | ⬜ |

### Phase 6: Memory Search

| # | Action | Expected Behavior | Status |
|---|--------|-------------------|--------|
| 6.1 | Create `notebook/knowledge/animals.md` with "Dogs are loyal pets" | File indexed | ⬜ |
| 6.2 | Search "loyal" in Memory search box | Returns animals.md with highlight | ⬜ |
| 6.3 | Search "cats" (not in any file) | Returns empty results gracefully | ⬜ |
| 6.4 | Search partial word "loy" | Returns animals.md (prefix matching) | ⬜ |

### Phase 7: Live Updates

| # | Action | Expected Behavior | Status |
|---|--------|-------------------|--------|
| 7.1 | Open Settings → Memory, note file count | Baseline established | ⬜ |
| 7.2 | In terminal: `echo "# Test" > .my_agent/notebook/operations/live-test.md` | File count increments within 3 seconds (no refresh) | ⬜ |
| 7.3 | Delete the file: `rm .my_agent/notebook/operations/live-test.md` | File count decrements within 3 seconds | ⬜ |
| 7.4 | Modify existing file while watching Settings | "Last sync" timestamp updates | ⬜ |

### Phase 8: Recall Tool (Chat)

> **Setup:** Create `notebook/knowledge/facts.md` with test content:
> ```
> # Facts About Me
> My favorite color is blue.
> I was born in Tel Aviv.
> My dog's name is Max.
> ```

#### Direct Recall (Explicit Memory Request)

| # | Chat Message | Expected Behavior | Status |
|---|--------------|-------------------|--------|
| 8.1 | "What's my favorite color?" | Uses recall, returns "blue", cites facts.md | ⬜ |
| 8.2 | "Search your memory for my dog's name" | Uses recall, returns "Max" | ⬜ |
| 8.3 | "What do you know about where I was born?" | Uses recall, returns "Tel Aviv" | ⬜ |
| 8.4 | "Check your notes for my pet's name" | Uses recall, finds "Max" | ⬜ |

#### Indirect Recall (Implicit Memory Need)

| # | Chat Message | Expected Behavior | Status |
|---|--------------|-------------------|--------|
| 8.5 | "Should I buy a blue or red shirt?" | Recalls preference, suggests blue | ⬜ |
| 8.6 | "I'm planning a trip home, any tips?" | Recalls Tel Aviv, offers relevant advice | ⬜ |
| 8.7 | "What gift should I get for Max?" | Recalls Max is a dog, suggests dog-appropriate gift | ⬜ |
| 8.8 | "What's the weather like where I grew up?" | Recalls Tel Aviv, checks weather there | ⬜ |

#### Memory Operations

| # | Chat Message | Expected Behavior | Status |
|---|--------------|-------------------|--------|
| 8.9 | "Remember that my sister's name is Dana" | Creates/updates notebook file with fact | ⬜ |
| 8.10 | "What's in your operations folder?" | Lists standing orders, external comms rules | ⬜ |
| 8.11 | "Search your memory for [nonexistent term]" | Returns "not found" gracefully | ⬜ |
| 8.12 | "Forget that my favorite color is blue" | Removes or updates the fact | ⬜ |

### Phase 9: Embeddings Setup

> **Requires:** Ollama installed (`curl -fsSL https://ollama.com/install.sh | sh`)

#### Ollama Connection

| # | Action | Expected Behavior | Status |
|---|--------|-------------------|--------|
| 9.1 | Start Ollama: `ollama serve` | Ollama running on :11434 | ⬜ |
| 9.2 | Settings → Memory → Select "Ollama Embeddings" | Host input appears | ⬜ |
| 9.3 | Enter `http://localhost:11434`, click Connect | Status shows "connecting..." | ⬜ |
| 9.4 | If model missing, auto-download prompt appears | User can approve download | ⬜ |

#### Model Management

| # | Action | Expected Behavior | Status |
|---|--------|-------------------|--------|
| 9.5 | Check available models: `ollama list` | Shows installed models | ⬜ |
| 9.6 | Pull embedding model: `ollama pull nomic-embed-text` | Model downloads (~274MB) | ⬜ |
| 9.7 | Verify in Settings: reconnect to Ollama | "Active" panel shows nomic-embed-text | ⬜ |
| 9.8 | Delete model: `ollama rm nomic-embed-text` | Model removed from system | ⬜ |
| 9.9 | Try connect after deletion | Graceful error: "model not found" | ⬜ |
| 9.10 | Re-pull model for further tests | Model available again | ⬜ |

### Phase 10: Semantic Search

> **Requires:** Embeddings active from Phase 9

#### Index Building

| # | Action | Expected Behavior | Status |
|---|--------|-------------------|--------|
| 10.1 | Click "Rebuild Index" with embeddings active | Progress indicator shows | ⬜ |
| 10.2 | Check rebuild completes | Stats show vector count > 0 | ⬜ |
| 10.3 | Verify chunks have embeddings | "Has vectors: Yes" in status | ⬜ |

#### Semantic Matching

| # | Search Term | File Contains | Expected Match | Status |
|---|-------------|---------------|----------------|--------|
| 10.4 | "canine" | "dog" | Yes (semantic) | ⬜ |
| 10.5 | "automobile" | "car" | Yes (semantic) | ⬜ |
| 10.6 | "happy" | "joyful" | Yes (semantic) | ⬜ |
| 10.7 | "Tel Aviv weather" | "born in Tel Aviv" | Yes (location match) | ⬜ |
| 10.8 | "xyz123random" | nothing similar | No results | ⬜ |

#### Hybrid Search (Keyword + Semantic)

| # | Action | Expected Behavior | Status |
|---|--------|-------------------|--------|
| 10.9 | Search exact term that exists | Returns keyword match (fast) | ⬜ |
| 10.10 | Search synonym of existing term | Returns semantic match | ⬜ |
| 10.11 | Search phrase spanning multiple chunks | Returns best matching chunks | ⬜ |

---

## Progress Tracker

### Task System

| Phase | Tests | Passed | Failed | Blocked |
|-------|-------|--------|--------|---------|
| 1. Immediate | 5 | 0 | 0 | 0 |
| 2. Short scheduled | 4 | 0 | 0 | 0 |
| 3. Long scheduled | 2 | 0 | 0 | 0 |
| 4. Edge cases | 4 | 0 | 0 | 0 |
| **Subtotal** | **15** | **0** | **0** | **0** |

### Memory System

| Phase | Tests | Passed | Failed | Blocked |
|-------|-------|--------|--------|---------|
| 5. Indexing | 4 | 0 | 0 | 0 |
| 6. Search | 4 | 0 | 0 | 0 |
| 7. Live updates | 4 | 0 | 0 | 0 |
| 8. Recall (direct) | 4 | 0 | 0 | 0 |
| 8. Recall (indirect) | 4 | 0 | 0 | 0 |
| 8. Recall (operations) | 4 | 0 | 0 | 0 |
| 9. Embeddings setup | 10 | 0 | 0 | 0 |
| 10. Semantic search | 11 | 0 | 0 | 0 |
| **Subtotal** | **45** | **0** | **0** | **0** |

### Overall

| System | Tests | Passed | Failed | Blocked |
|--------|-------|--------|--------|---------|
| Task | 15 | 0 | 0 | 0 |
| Memory | 45 | 0 | 0 | 0 |
| **Total** | **60** | **0** | **0** | **0** |

---

*Created: 2026-02-24*
*Updated: 2026-02-26 — Added Memory System tests (indexing, search, live updates, recall, embeddings, semantic search)*
