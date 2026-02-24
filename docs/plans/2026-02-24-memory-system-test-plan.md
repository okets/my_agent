# M6 Memory System — E2E Test Plan

**Date:** 2026-02-24
**Sprint:** M6 Memory System
**Author:** QA Designer
**Status:** Draft

---

## 1. Test Philosophy

### Principle: Source of Truth Is Files

The SQLite index is derived and rebuildable. Every test that verifies memory content must verify
the markdown file, not just the database. If the file is correct and the index is stale, the
correct recovery path is re-sync — not treating the index as authoritative.

### Principle: Test the Agent Interface, Not the Implementation

Users and Nina interact with memory through four surfaces:
1. Nina's tool calls (`memory_search`, `notebook_write`, etc.)
2. The dashboard UI (notebook browser, search, page editor)
3. The Debug API (for automated test setup and verification)
4. Direct file editing (user editing markdown files)

Tests should exercise these surfaces, not internal chunking logic or embedding math.

### Principle: Happy Path First, Then Failure Modes

Each user story gets a happy path test. Edge cases layer on top. A passing happy path with
failing edge cases is a ship-able v1; the reverse is not.

### Principle: Debug API Enables Repeatability

Every test scenario must be fully setup-able and teardown-able via Debug API calls. No test
should depend on state left by a previous test. Cold start = clean state = predictable results.

---

## 2. User Story Tests

### US-1: "Nina, make me a shopping list"

**Scenario:** User asks Nina to create a new list from scratch.

**Preconditions:**
- Clean state: no `notebook/lists/shopping.md` exists
- Debug API confirms no indexed chunks for that path

**Steps:**
1. User sends: "Nina, make me a shopping list"
2. Nina creates `notebook/lists/shopping.md` via `notebook_write`
3. File watcher triggers sync (debounced 1.5s)
4. After sync: Debug API `/api/debug/memory/search?q=shopping+list` returns the new page

**Expected Outcomes:**
- File exists at `.my_agent/notebook/lists/shopping.md`
- File contains a recognizable list header and structure
- SQLite index contains chunks for this file within ~3s of file creation
- Debug API `/api/debug/memory/files` shows the file with a valid SHA256 hash
- Next turn: User can say "add milk" and Nina appends to the existing file

**Failure Signals:**
- Nina creates list in wrong directory (e.g., `reference/` or root `notebook/`)
- File created but not indexed after 5s
- Second turn creates a new file instead of appending to existing

---

### US-2: "Remember Sarah's phone is 555-1234"

**Scenario:** User provides a contact detail. Nina stores it durably in reference.

**Preconditions:**
- Clean state: no `notebook/reference/contacts.md` or equivalent
- Or existing contacts file without Sarah

**Steps:**
1. User sends: "Remember Sarah's phone number is 555-1234"
2. Nina calls `notebook_write` with path `reference/contacts.md` (or similar)
3. File syncs to index
4. User asks in a new session: "What's Sarah's phone number?"
5. Nina calls `memory_search("Sarah phone")` — notebook group returns the contact
6. Nina answers correctly from search results

**Expected Outcomes:**
- Contact stored in `notebook/reference/` (not `lists/` or `knowledge/`)
- Content includes "Sarah" and "555-1234" in proximity
- Search result has score ≥ 0.25 (above minimum threshold)
- Notebook group returned before daily/sessions groups
- Nina's answer in step 6 is "555-1234" (not hallucinated)

**Failure Signals:**
- Stored in wrong folder (reference is for stable facts, not lists)
- Score below threshold — contact not retrieved
- Nina asks "Who's Sarah?" instead of looking it up

---

### US-3: "What did we discuss yesterday?"

**Scenario:** User wants to recall recent conversation content.

**Preconditions:**
- Yesterday's date has a daily summary at `notebook/daily/YYYY-MM-DD.md`
- At least one session from yesterday exists in `sessions/`
- Auto-context loading brings in today + yesterday daily files

**Steps:**
1. User opens a new session (today's date)
2. Nina's prompt is assembled — verify yesterday's daily log is included in context
3. User asks: "What did we discuss yesterday?"
4. Nina answers from loaded context (no search needed for daily — it's auto-loaded)
5. User asks about a specific topic from yesterday that requires session search
6. Nina calls `memory_search` with `sources: ["sessions"]`

**Expected Outcomes:**
- Yesterday's daily summary auto-loaded in prompt (verify via Debug API turn injection)
- Nina can answer general "what did we discuss" from daily context
- For specific details, Nina correctly searches sessions
- Session search results show date-stamped excerpts

**Failure Signals:**
- Yesterday's daily not loaded (auto-context bug)
- Nina invents yesterday's activities instead of retrieving them
- Session search returns today's sessions for "yesterday" query

---

### US-4: "Add milk to my shopping list"

**Scenario:** Nina updates an existing list without recreating it.

**Preconditions:**
- `notebook/lists/shopping.md` exists with some items
- Index is up to date

**Steps:**
1. User sends: "Add milk to my shopping list"
2. Nina calls `memory_search("shopping list")` — finds existing file
3. Nina calls `notebook_write` with `section` or `replace: false` (append mode)
4. File is updated; file watcher triggers re-sync
5. Debug API confirms new chunk containing "milk" is indexed

**Expected Outcomes:**
- File modified, not replaced (mtime changes, path stays same)
- "Milk" appears in file content (case-insensitive)
- SHA256 hash in `files` table updates after sync
- Old chunks removed, new chunks added (no duplicates)
- Existing items still present in file

**Failure Signals:**
- Nina creates `notebook/lists/shopping-2.md` instead of updating existing
- Nina overwrites entire file, losing previous items
- Duplicate chunks after re-sync

---

### US-5: Search Across All Sources

**Scenario:** User searches for a topic that appears in notebook, daily log, and sessions.

**Preconditions:**
- "project timeline" appears in:
  - `notebook/knowledge/facts.md` (a fact Nina recorded)
  - `notebook/daily/2026-02-23.md` (logged in daily summary)
  - A recent session transcript (user discussed it)

**Steps:**
1. User triggers memory search: "project timeline"
2. Via dashboard Memory Search UI
3. Verify grouped results: notebook → daily → sessions

**Expected Outcomes:**
- All three sources return results
- Notebook results appear first in UI regardless of score order
- Scores are displayed per result
- Sources are labeled (NOTEBOOK, DAILY, SESSIONS)
- UI shows file path + line range for each result

**Failure Signals:**
- Results sorted by score only (grouping broken)
- Sessions appear before notebook
- Source labels missing
- Scores not displayed

---

## 3. Edge Case Tests

### EC-1: Large File (Many Chunks)

**Scenario:** A notebook file grows large enough to produce many chunks.

**Setup:** Write a synthetic file with ~50 sections via Debug API POST `/api/debug/notebook/knowledge/large-test.md`

**Test:**
- File contains 50 sections × 300 words = ~15,000 words
- Expected chunks: ~37 chunks (400 token windows with 80 overlap)
- Trigger sync, verify Debug API `/api/debug/memory/status` shows correct chunk count
- Search for content from section 40 — verify it's retrievable
- Delete file, verify all 37 chunks removed from index

**Expected Outcomes:**
- All chunks indexed, no truncation
- Content from deep sections is searchable
- Chunk cleanup on deletion is complete (no orphan chunks)

**Failure Signals:**
- Chunk count lower than expected (chunking stopped early)
- Last sections not searchable
- Orphan chunks remain after file deletion

---

### EC-2: Rapid Updates (Debounce Behavior)

**Scenario:** File updated 5 times in quick succession (user rapidly editing or Nina multi-step write).

**Setup:** Script that writes to `notebook/lists/test-debounce.md` 5 times in 200ms intervals.

**Test:**
- Fire 5 writes within 1 second (within 1.5s debounce window)
- Wait 3s total
- Verify index sync happened exactly once (not 5 times)
- Verify final file content matches last write

**Expected Outcomes:**
- Exactly one sync triggered (debounce working)
- Index reflects final file state
- No partial-write state indexed

**Failure Signals:**
- 5 sync operations triggered (debounce not working)
- Index reflects intermediate state, not final
- Lock contention error during rapid writes

---

### EC-3: Concurrent Writes (User + Nina)

**Scenario:** User edits a notebook page in the dashboard while Nina is writing to the same file.

**Test:**
- Nina starts a `notebook_write` operation (simulated via Debug API inject-turn)
- Dashboard editor simultaneously sends a save
- Both writes complete
- Verify file integrity (no corruption, no lost content)

**Expected Outcomes:**
- Last write wins (both are valid operations)
- File is valid markdown (not corrupted/interleaved)
- Index re-syncs cleanly from final state
- No error thrown to user

**Failure Signals:**
- File contains interleaved content from both writes
- JSON/markdown parsing error in resulting file
- Index enters inconsistent state

---

### EC-4: Database Corruption Recovery

**Scenario:** `memory.db` is corrupted or deleted. System should recover automatically.

**Test:**
- Manually corrupt/delete `.my_agent/brain/memory.db` via Debug API DELETE or direct file op
- Trigger a memory search
- System should detect missing/corrupt DB and trigger rebuild
- Verify rebuild completes from markdown source files
- Verify search works after rebuild

**Expected Outcomes:**
- System detects corruption without crashing
- Automatic rebuild triggered (or fallback to full re-sync)
- All markdown files re-indexed
- Search returns correct results after recovery
- No user-visible error (or graceful error with recovery in progress message)

**Debug API endpoint needed:** `GET /api/debug/memory/status` should report `db_healthy: boolean`

**Failure Signals:**
- System crashes instead of recovering
- Partial rebuild (some files missed)
- Search returns empty after rebuild

---

### EC-5: Empty Notebook (Cold Start)

**Scenario:** Brand new agent with no notebook files, no sessions, no daily logs.

**Test:**
- Clean environment: `notebook/` directory empty
- User asks: "What's on my shopping list?"
- Nina calls `memory_search("shopping list")` — returns empty results
- Nina responds gracefully: "You don't have a shopping list yet. Want me to start one?"

**Expected Outcomes:**
- `memory_search` returns `{ notebook: [], daily: [], sessions: [] }`
- No error or crash on empty results
- Nina's response acknowledges absence, offers to create
- Debug API `/api/debug/memory/status` shows `chunk_count: 0`

**Failure Signals:**
- Search throws error on empty index
- Nina hallucinates a shopping list
- Nina ignores the empty result and says "I don't know"

---

### EC-6: Search With No Results

**Scenario:** Search query that matches nothing in the index.

**Test:**
- Index contains realistic content (contacts, lists, daily logs)
- Search for `"quantum entanglement purple rhinoceros"` (guaranteed no match)
- Verify response handling

**Expected Outcomes:**
- `memory_search` returns all empty arrays, no error
- `minScore: 0.25` filter correctly excludes low-confidence matches
- Nina tells user she doesn't have that information
- Dashboard search UI shows "No results found" per group

**Failure Signals:**
- Low-score garbage results returned (score filter not applied)
- Error thrown on empty results
- Nina fabricates results

---

### EC-7: Pre-Compaction Flush Timing

**Scenario:** Session approaches context window limit; Nina must flush durable memories before compaction.

**Test:**
- Simulate compaction signal via `POST /api/debug/memory/simulate-compaction`
- Verify Nina receives the silent prompt
- Verify Nina calls `notebook_write` and/or `daily_log` before compaction
- Verify written content appears in index within sync window
- Verify session can resume after compaction with context from notebook

**Expected Outcomes:**
- Compaction signal triggers Nina's write-to-notebook behavior
- At least one file write occurs within 10s of signal
- Written content is indexed before compaction completes
- Post-compaction: `memory_search` finds the flushed content

**Failure Signals:**
- Nina ignores compaction signal (no writes triggered)
- Writes happen after compaction (data lost)
- Content written but not indexed before next session starts

---

## 4. Debug API Test Scenarios

### Required Endpoints

| Endpoint | Method | Purpose | Used By |
|----------|--------|---------|---------|
| `/api/debug/memory/status` | GET | Index stats, chunk count, last sync time, db health | EC-4, EC-5, all setup/teardown |
| `/api/debug/memory/search?q=...` | GET | Raw search results with scores (unfiltered) | US-2, US-5, all search validation |
| `/api/debug/memory/files` | GET | List indexed files with SHA256 hashes and mtime | US-1, US-4, EC-2 |
| `/api/debug/memory/rebuild` | POST | Trigger full reindex from markdown files | EC-4, test setup |
| `/api/debug/notebook/pages` | GET | List all notebook pages with paths | US-1 setup/teardown |
| `/api/debug/notebook/:path` | GET | Read page content | All US validation |
| `/api/debug/notebook/:path` | POST | Write page (test setup) | EC-1, EC-2, EC-3 |
| `/api/debug/notebook/:path` | DELETE | Delete page (test cleanup) | All teardown |
| `/api/debug/memory/simulate-compaction` | POST | Trigger pre-compaction flush signal | EC-7 |
| `/api/debug/brain/inject-turn` | POST | Inject a turn into Nina's session | US-3, EC-3, EC-7 |

### Sample Test Sequence: Contact Storage (US-2)

```
# Setup
DELETE /api/debug/notebook/reference/contacts.md

# Baseline
GET /api/debug/memory/search?q=Sarah+phone
→ { results: [], total: 0 }

# Inject turn simulating user request
POST /api/debug/brain/inject-turn
{ "content": "Remember Sarah's phone is 555-1234" }

# Wait for Nina to write and sync (poll with timeout)
GET /api/debug/memory/status
→ wait until last_sync > inject_time

# Verify file written
GET /api/debug/notebook/reference/contacts.md
→ body contains "555-1234"

# Verify indexed
GET /api/debug/memory/search?q=Sarah+phone
→ { results: [{ path: "reference/contacts.md", score: ≥0.25 }] }

# Teardown
DELETE /api/debug/notebook/reference/contacts.md
POST /api/debug/memory/rebuild
```

### Sample Test Sequence: Recovery (EC-4)

```
# Verify healthy baseline
GET /api/debug/memory/status
→ { db_healthy: true, chunk_count: N }

# Corrupt the database (requires file system access or dedicated endpoint)
# Proposed: POST /api/debug/memory/corrupt  (test environments only, guarded by env flag)

# Trigger search (should auto-recover)
GET /api/debug/memory/search?q=test

# Poll for recovery
GET /api/debug/memory/status
→ wait for db_healthy: true, chunk_count: N (same as before)
```

### Additional Debug API Endpoint Needed

`POST /api/debug/memory/corrupt` — Intentionally corrupt the database for recovery testing.
Should only be available when `NODE_ENV=test`. Returns 403 in production.

---

## 5. Performance Scenarios

### PS-1: Index Rebuild Time

**Baseline target:** Rebuild 100 markdown files (avg 500 words each) in under 30s on dev hardware.

**Test:**
- Setup: 100 synthetic notebook files via batch Debug API writes
- Trigger: `POST /api/debug/memory/rebuild`
- Measure: Time from trigger to `status.last_sync` updating
- Assert: Duration < 30s

**Key Variables:**
- First build (all embeddings computed): slower
- Rebuild with no file changes (all cached): near-instant
- Rebuild after 10% files changed: proportional to changed files

**Expected Cache Behavior:**
- `embedding_cache` table prevents re-computing unchanged chunks
- Second rebuild (no changes) should be < 1s

---

### PS-2: Search Latency

**Target:** Search returns results in < 500ms for a 10,000-chunk index.

**Test:**
- Populate index with 200 files (avg 50 chunks each = 10,000 chunks)
- Run 10 search queries via `GET /api/debug/memory/search?q=...`
- Measure end-to-end API response time
- Assert p99 < 500ms

**Breakdown targets:**
- Embedding the query string: < 100ms
- Vector search (sqlite-vec): < 200ms
- BM25 search (FTS5): < 50ms
- Result merging and ranking: < 50ms
- Total: < 400ms (leaves 100ms buffer)

---

### PS-3: Embedding Throughput

**Target:** Process a new notebook page (2,000 words, ~5 chunks) in under 5s.

**Test:**
- Write a 2,000-word synthetic page via Debug API
- Measure time from file write to all chunks indexed
- Assert < 5s end-to-end

**Key Measurement:** Time from file watcher firing (after 1.5s debounce) to sync complete.

---

## 6. Integration Tests

### INT-1: Memory + Chat Integration

**Scenario:** Nina uses memory search mid-conversation to answer a factual question.

**Test Flow:**
1. Pre-populate `notebook/reference/contacts.md` with contact data
2. Open chat session via dashboard
3. Send: "What's Alex's email address?"
4. Verify Nina calls `memory_search("Alex email")` (observable via tool use in response)
5. Verify Nina's answer matches the notebook data exactly

**Validation:**
- Response includes the correct email address
- No hallucination (if Alex not in contacts, Nina says so)
- Turn duration < 10s (search + LLM response)

---

### INT-2: Memory + Tasks Integration

**Scenario:** Task system creates a daily log entry when a task completes.

**Test Flow:**
1. Create a test task via task system
2. Complete the task
3. Verify a daily log entry for today is written referencing the task
4. Verify daily log is indexed
5. Next session: "What tasks did we complete today?" → Nina retrieves from daily log

**Validation:**
- Daily log entry created (file exists, has task reference)
- Entry indexed within sync window
- `memory_search` finds the task reference

---

### INT-3: Dashboard ↔ Memory Sync

**Scenario:** User edits a notebook page in the dashboard; changes appear in next search.

**Test Flow:**
1. Open Notebook Browser in dashboard
2. Navigate to `notebook/reference/contacts.md`
3. Edit "Alex's email" to a new value via the page editor
4. Save
5. Wait for sync indicator (if any) or wait 3s
6. Open Memory Search
7. Search "Alex email"
8. Verify result shows the updated email

**Validation:**
- Dashboard editor saves to file (not just in-memory)
- File change triggers file watcher and re-sync
- Search returns updated content, not stale cached version
- Debug API `GET /api/debug/memory/files` shows updated hash for the file

---

### INT-4: Notebook Browser — Create/Edit/Delete

**Scenario:** Full CRUD workflow via dashboard UI.

**Test Flow:**
1. Navigate to Notebook Browser
2. Create new page: `knowledge/test-page.md` with some content
3. Verify page appears in folder tree
4. Edit the page — add a section
5. Verify edit persists after page reload
6. Delete the page
7. Verify page removed from tree and from search index

**Validation:**
- CRUD operations hit correct file paths
- File watcher syncs after each operation
- Search index clean after deletion (no orphan chunks)

---

## 7. Test Execution Order

For CI/automated test runs:

```
1. Environment setup (clean state via Debug API)
2. Cold Start tests (EC-5)
3. Happy path user stories (US-1 through US-5)
4. Integration tests (INT-1 through INT-4)
5. Edge cases (EC-1 through EC-7, except EC-4)
6. Recovery test (EC-4 — destructive, run last)
7. Performance tests (PS-1 through PS-3 — run in isolation)
```

Recovery and performance tests run last because they are disruptive to index state.

---

## 8. Open Questions for Implementation Team

1. **EC-3 (Concurrent Writes):** What is the intended conflict resolution strategy? Last write wins is assumed — confirm.
2. **EC-7 (Pre-Compaction Flush):** How is the compaction signal detected? Token count threshold? SDK event? Needs implementation detail before test can be written precisely.
3. **PS-1 (Rebuild Time):** Is the 30s target realistic with `embeddinggemma-300M` on CPU? May need to measure on target hardware first.
4. **EC-4 (DB Corruption):** Should the Debug API expose a `/corrupt` endpoint, or should tests manipulate the file directly via filesystem? Recommend API endpoint with `NODE_ENV=test` guard.
5. **Dashboard sync indicator:** Should the UI show a "syncing..." state after edits? Affects INT-3 test reliability (currently assumes 3s wait).

---

*End of Test Plan*
