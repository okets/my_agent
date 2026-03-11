# M6.6: Memory Perfection — Design Spec

> **Status:** Approved
> **Created:** 2026-03-11
> **Milestone:** M6.6 (Agentic Lifecycle)
> **Design source:** [memory-first-agent-design.md](../../plans/2026-03-01-memory-first-agent-design.md)
> **Sprints:** 4 (S1–S4)

---

## Problem Statement

Nina doesn't remember facts across conversations. The user said "I'm in Chiang Mai" three times in one day. Each time Nina asked again. The memory system (notebook, search, MCP tools) is built and working — but nothing writes to it automatically, nothing pre-loads context, and the agent has no instructions to use memory tools proactively.

The infrastructure exists. The pipeline is broken.

---

## Core Principle

**Markdown is source of truth. SQLite is derived.**

Job definitions, facts, configuration, and operational state live in markdown files. Databases store run history, search indexes, and caches. If the database is deleted, the system rebuilds from markdown. If markdown is deleted, data is lost.

This principle applies to all components in this milestone: the work loop scheduler reads job definitions from `work-patterns.md`, facts live in `notebook/knowledge/`, operational state lives in `notebook/operations/current-state.md`. The `agent.db` tables created here store only execution history and search indexes.

---

## Design Overview

```
BACKGROUND (Work Loop)
├── Morning Prep (daily, Haiku) → reads notebook → writes current-state.md
├── Post-Conversation (idle OR inactive trigger) → fact extraction → knowledge/
├── Daily Summary (daily, Haiku) → consolidates daily log
└── Weekly Review (weekly, Haiku) → promotes facts, resolves conflicts

CONVERSATION
├── New: fresh session, system prompt includes current-state.md + reference/* + daily logs
├── Resumed: SDK session resume, system prompt rebuilt every query (fresh context)
└── Pre-compaction: flush important facts before context compressed

SYSTEM PROMPT INJECTION (every query)
├── Layer 1-2: Identity + skills (cached)
├── Layer 3: current-state.md + temporal context (dynamic)
├── Layer 4: Memory MCP tools (on-demand)
└── Layer 5-6: Inbound metadata + session context
```

### What the agent "always knows" (pre-loaded):

| Source | Injected | Contains |
|--------|----------|----------|
| `reference/*` | Every query | Contacts, preferences, standing orders |
| `operations/current-state.md` | Every query | Location, focus, schedule, pending items |
| `daily/{today,yesterday}` | Every query | Recent activity |

### What the agent "can find" (on-demand):

| Source | Via | Contains |
|--------|-----|----------|
| `knowledge/*` | `recall()` | Extracted facts, learned preferences, people |
| `lists/*` | `recall()` | Todos, shopping |
| Conversation transcripts | `conversation_search()` | Full history |

---

## Dependency Changes

**Previous roadmap:** M6.7 → M6.8 → M6.6

**Updated:** M6.7 → M6.6 (M6.8 is independent)

The M6.8 dependency was for loading `work-patterns.md` via `settingSources`. Since `work-patterns.md` lives in `notebook/operations/` and is injected by the existing `loadNotebookOperations()` loader, M6.8 is not required.

---

## Test Narrative: Thailand Vacation

All synthetic test data follows one story arc across all 4 sprints:

**Sprint 1 seeds:**
- "I just landed in Chiang Mai"
- "Found an amazing pad krapao place near Tha Phae Gate"
- "Meeting a local guide named Kai tomorrow for a temple tour"
- "Flying to Krabi on the 15th, back to Tel Aviv on the 20th"

**Sprint 2 processes:**
- Morning prep writes `current-state.md`: "Location: Chiang Mai, Thailand (until 15th, then Krabi)"
- Daily summary consolidates learnings

**Sprint 3 extracts:**
- Location: Chiang Mai → Krabi → Tel Aviv
- Preference: likes pad krapao
- Contact: Kai (local guide, Chiang Mai)
- Schedule: flights on 15th and 20th

**Sprint 4 verifies across all layers:**
- "What should I eat tonight?" → Nina knows Thailand, pad krapao
- "When do I fly home?" → March 20th
- "Who was that guide I met?" → Kai
- No synthetic data hardcoded in prompt — all retrieved from memory system

---

## Sprint 1: Context Foundation

**Goal:** The system prompt carries temporal awareness and a `current-state.md` briefing. When that file exists, Nina "already knows" without searching.

### Deliverables

#### 1.1 `current-state.md` schema

Define format in `notebook/operations/`:

```markdown
## Current State (updated 2026-03-11 07:00)
- Location: Chiang Mai, Thailand (until Mar 15, then Krabi)
- Focus: Vacation
- Schedule: Temple tour with Kai tomorrow
- Pending: Flight to Krabi Mar 15
```

Token budget: 500–1000 chars max. Concise briefing, not a report.

#### 1.2 Temporal context injection

Add to system prompt layer 3 (dynamic context):

```markdown
## Temporal Context
Current time: 2026-03-11 14:30
Session started: 2026-03-11 14:28
Notebook last updated: 2026-03-11 07:00
```

Nina can reason about staleness naturally — "that was updated this morning" vs "that's 3 days old."

**Implementation note:** Temporal context belongs in `SystemPromptBuilder.build()` (dashboard, layer 3 dynamic block), not in `packages/core/src/prompt.ts` (shared core). The core `assembleSystemPrompt()` is used by both REPL and dashboard — temporal context is a dashboard-only concern. `packages/core/src/prompt.ts` changes are limited to ensuring `loadNotebookOperations()` works correctly.

#### 1.3 Move `operations/*` to dynamic prompt block

`SystemPromptBuilder` currently loads `operations/*` (including `current-state.md`) as part of the cached stable prompt (layers 1–2). This means `current-state.md` content goes stale after first load until `invalidateCache()` is called.

**Fix:** Move `operations/*` loading from the cached stable block into the dynamic block (layer 3) in `SystemPromptBuilder.build()`. This ensures `current-state.md` is re-read on every query — matching the "rebuilt every query" intent of layer 3. `reference/*` stays cached (it changes rarely).

#### 1.4 Verify `loadNotebookOperations()`

Confirm `current-state.md` is injected by the existing loader in `packages/core/src/prompt.ts`. The function reads all `*.md` from `notebook/operations/`. If not working, wire it.

#### 1.4 Verify `notebook.md` skill

Confirm the skill file (`.my_agent/brain/skills/notebook.md`) is included in the assembled system prompt. Verify Nina calls `recall()` when asked a factual question.

#### 1.6 Fix stale data

`reference/contacts.md` currently says "Location: Tel Aviv" — auto-injected into every prompt, actively providing wrong information. Update for testing with synthetic vacation data.

### E2E Tests

| # | Test | Method | Pass Criteria |
|---|------|--------|---------------|
| 1 | `current-state.md` injected | Write synthetic file, inspect assembled prompt | File content appears in system prompt |
| 2 | Temporal context present | Inspect assembled system prompt | Contains `Current time:` with today's date |
| 3 | `notebook.md` skill loaded | Inspect assembled system prompt | Contains proactive memory instructions |
| 4 | Stale data doesn't persist | Update `contacts.md`, inspect prompt | Reflects updated content |
| 5 | Empty `operations/` is safe | Remove `current-state.md`, build prompt | No errors, prompt assembles without it |

### Files Modified

- `packages/dashboard/src/agent/system-prompt-builder.ts` — Move `operations/*` from cached to dynamic block, add temporal context injection
- `packages/core/src/prompt.ts` — Verify `loadNotebookOperations()` works (no changes expected)
- `.my_agent/notebook/operations/current-state.md` — Create with synthetic test data (gitignored)
- `.my_agent/notebook/reference/contacts.md` — Update for testing (gitignored)

### What S1 Does NOT Do

- Does not write `current-state.md` automatically (S2)
- Does not extract facts from conversations (S3)
- The file is manually created — proving the injection pipeline works

---

## Sprint 2: Work Loop Scheduler + System Calendar

**Goal:** Nina runs background Haiku jobs on schedule. All jobs visible on a system calendar — transparent, inspectable, clickable.

### Deliverables

#### 2.1 `WorkLoopScheduler`

New class following `TaskScheduler` pattern:

- Polls every 60s, checks which jobs are due
- Job definitions read from `notebook/operations/work-patterns.md` (markdown = source of truth)
- `lastRun` stored in `work_loop_runs` table (SQLite = execution history only)
- Sequential execution — one Haiku call at a time
- States: `pending` → `running` → `completed` / `failed`
- Heartbeat retry: failed jobs stay due until they succeed

#### 2.2 `work-patterns.md` schema

```markdown
# Work Patterns

## Morning Prep
- cadence: daily:08:00
- model: haiku

## Daily Summary
- cadence: daily:23:00
- model: haiku

## Weekly Review
- cadence: weekly:sunday:09:00
- model: haiku
```

Scheduler reads this file on startup and on file change (via existing `SyncService` watcher). Edit the markdown → schedule changes on next cycle. Delete the database → lose history but schedule still works.

#### 2.3 Background Haiku query utility

Lightweight function: sends a single prompt to Haiku with notebook context, returns structured output. Should use `createBrainQuery()` from `@my-agent/core` (same pattern as `AbbreviationQueue`) with model override to `claude-haiku-4-5-20251001`. This keeps the existing SDK query pattern consistent across the codebase.

#### 2.10 Graceful shutdown

`WorkLoopScheduler` must implement `stop()` (matching `TaskScheduler` pattern). If a job is running when shutdown is requested, wait for it to complete before exiting. The scheduler interval is cleared, and no new jobs are started.

#### 2.4 Morning prep job (`daily:08:00`)

- Reads: `reference/*`, `daily/{yesterday}`, `knowledge/*`
- Writes: `operations/current-state.md` (500–1000 chars)
- Prompt enforces concise briefing format
- Logs to daily log: "Morning prep completed"

#### 2.5 Daily summary job (`daily:23:00`)

- Reads: today's daily log, today's conversation abbreviations
- Writes: summary section appended to `daily/{today}.md`
- Purpose: consolidate learnings, spot patterns, seed tomorrow's morning prep

#### 2.6 Database tables (execution history only)

`work_loop_runs` table in `agent.db`:
```
id, jobName, startedAt, completedAt, status, durationMs, output (text), error
```

No `work_loop_jobs` table — job definitions live in `work-patterns.md`.

#### 2.7 System calendar API

`/api/work-loop/events` — Returns FullCalendar-compatible events from `work_loop_runs`:

- Completed: solid accent-purple
- Failed: solid red
- Upcoming scheduled: dashed/outline accent-purple
- Each event carries `extendedProps` with output, duration, error

#### 2.8 FullCalendar integration

Second event source on existing calendar:

- `events: { url: "/api/work-loop/events" }` alongside existing CalDAV source
- Clicking a system event shows job output in a detail panel
- Distinct visual treatment from personal calendar events

#### 2.9 Manual trigger API

`POST /api/work-loop/trigger/:jobName` — Trigger any job immediately. For testing + dashboard "Run now" button.

### E2E Tests

| # | Test | Method | Pass Criteria |
|---|------|--------|---------------|
| 1 | Scheduler triggers due job | Register job with past-due time, wait one cycle | Job handler called, `work_loop_runs` row created |
| 2 | Morning prep writes `current-state.md` | Seed `reference/` + `daily/` with Thailand data, trigger manually | File exists, contains "Chiang Mai", under 1000 chars |
| 3 | Daily summary appends to daily log | Seed today's log + abbreviations, trigger manually | Today's log has new summary section |
| 4 | Failed job retries | Register job that throws first, succeeds second | Two runs in DB, second `completed` |
| 5 | Restart persistence | Run a job, restart scheduler, check `lastRun` | Job not re-triggered before next cadence |
| 6 | `current-state.md` in system prompt | Trigger morning prep → inspect assembled prompt | Prompt contains morning prep output |
| 7 | Calendar API returns events | Trigger two jobs → GET `/api/work-loop/events` | FullCalendar-format events with correct status/colors |
| 8 | Manual trigger API | POST `/api/work-loop/trigger/morning-prep` | 200 with job output |
| 9 | No concurrent jobs | Two jobs due simultaneously | Sequential execution, no overlap |

### Files Created/Modified

- `packages/dashboard/src/scheduler/work-loop-scheduler.ts` — New
- `packages/dashboard/src/scheduler/haiku-query.ts` — New
- `packages/dashboard/src/scheduler/jobs/morning-prep.ts` — New
- `packages/dashboard/src/scheduler/jobs/daily-summary.ts` — New
- `packages/dashboard/src/routes/work-loop.ts` — New (API routes)
- `packages/dashboard/src/index.ts` — Wire scheduler + routes
- `packages/dashboard/public/js/calendar.js` — Add second event source
- `.my_agent/notebook/operations/work-patterns.md` — Job definitions (gitignored)
- DB migration: `work_loop_runs` table

### What S2 Does NOT Do

- No fact extraction (S3)
- No weekly review (S3)
- No user task scheduling changes — system calendar is for work loop jobs only

---

## Sprint 3: Passive Learning

**Goal:** Nina learns from conversations without being told "remember this." Facts extracted automatically, weekly review promotes recurring facts.

### Deliverables

#### 3.1 Fact extraction pipeline

Parallel Haiku call added to `AbbreviationQueue`:

```
Conversation triggers (idle OR inactive)
  → Check: turnCount > lastExtractedAtTurn?
    → NO: skip (no new messages since last extraction)
    → YES:
      → Promise.all([
          summarize(turns),        // existing: lossy compression
          extractFacts(turns),     // NEW: precision extraction
        ])
      → saveAbbreviation(...)
      → persistFacts(...)          // → notebook/knowledge/
      → update lastExtractedAtTurn
```

Both run on the **original transcript**, not chained. Different goals, same input.

#### 3.2 Dual trigger for extraction

Two events enqueue a conversation for abbreviation + fact extraction:

1. **Idle timeout (10 min)** — existing trigger, conversation trails off
2. **Conversation becomes inactive** — channel switch or new conversation created, immediate enqueue

Efficiency guard: `lastExtractedAtTurn` tracked per conversation as a new column in the `conversations` table (DB migration required). If no new turns since last extraction, skip the Haiku call entirely.

#### 3.3 Fact extraction prompt

Haiku extracts structured facts from the transcript:

- Explicit preferences ("I prefer X", "always do Y")
- Location / schedule / travel plans
- Contact info (names, relationships, context)
- Decisions and commitments
- Output: one fact per line, categorized

Deduplication: before appending, search existing `knowledge/` content via search service. Skip facts that already exist (exact or high-confidence semantic match).

#### 3.4 `notebook/knowledge/` writes

Extracted facts appended to category files:

- `knowledge/facts.md` — general learned facts (location, schedule, events)
- `knowledge/people.md` — people mentioned (name, context, relationship)
- `knowledge/preferences.md` — inferred preferences (separate from `reference/preferences.md` which holds confirmed/promoted preferences)

#### 3.5 Weekly review job

Added to `work-patterns.md` with cadence `weekly:sunday:09:00`:

- Haiku reads: `knowledge/*`, `reference/*`
- **Promote:** Facts seen 3+ times across different conversations → move to `reference/`
- **Archive:** Facts older than 30 days with no reinforcement → add `[stale]` tag
- **Conflict resolution:** If `knowledge/` contradicts `reference/` (e.g., location changed) → update `reference/`, log the change
- Writes changes to both directories, logs to daily log

#### 3.6 Pre-compaction flush

Wire existing `getPreCompactionFlushMessage()`:

- Before SDK compacts context, inject system message prompting Nina to save important facts
- Nina calls `remember()` / `daily_log()` with key facts from the conversation
- Trigger: token count > 75% of context window, or SDK `pre_compaction` event if available

#### 3.7 Calendar visibility

Each extraction run and weekly review creates a `work_loop_runs` entry, visible on the system calendar with extracted facts / review actions as output.

### E2E Tests

| # | Test | Method | Pass Criteria |
|---|------|--------|---------------|
| 1 | Extraction triggers after abbreviation | Create synthetic Thailand conversation, trigger abbreviation | `knowledge/facts.md` contains extracted facts |
| 2 | Parallel execution | Trigger abbreviation, verify both outputs exist | Both abbreviation and extracted facts present for same conversation; extraction ran on original transcript (not abbreviation output) |
| 3 | Deduplication works | Run extraction twice on same conversation | No duplicate facts in `knowledge/` |
| 4 | Location fact extracted | Conversation: "I just landed in Chiang Mai" | `knowledge/facts.md` contains Chiang Mai |
| 5 | Preference fact extracted | Conversation: "pad krapao is incredible" | `knowledge/preferences.md` contains pad krapao |
| 6 | Contact fact extracted | Conversation: "guide named Kai tomorrow" | `knowledge/people.md` contains Kai |
| 7 | Idle trigger works | Conversation idle for 10 min → extraction fires | Facts extracted |
| 8 | Inactive trigger works | Create new conversation (old becomes inactive) → extraction fires | Facts extracted from old conversation |
| 9 | Skip when no new turns | Trigger extraction twice, no new messages between | Second call skipped (no Haiku call) |
| 10 | Weekly review promotes | Seed `knowledge/` with fact 3+ times → trigger review | Fact in `reference/`, removed from `knowledge/` |
| 11 | Weekly review resolves conflicts | `reference/` says Tel Aviv, `knowledge/` says Chiang Mai → review | `reference/` updated |
| 12 | Pre-compaction flush | Call `POST /api/debug/memory/simulate-compaction` or mock token count > 75% threshold | `getPreCompactionFlushMessage()` output injected as system message in conversation |
| 13 | Calendar shows extraction | Trigger extraction → GET `/api/work-loop/events` | Event with extracted facts in output |

### Files Created/Modified

- `packages/dashboard/src/conversations/abbreviation.ts` — Add parallel `extractFacts()`, track `lastExtractedAtTurn`
- `packages/dashboard/src/conversations/fact-extractor.ts` — New (extraction prompt + persistence logic)
- `packages/dashboard/src/scheduler/jobs/weekly-review.ts` — New
- `packages/dashboard/src/conversations/manager.ts` — Enqueue abbreviation when conversation status changes to inactive (this is where `create()` demotes the old conversation)
- `packages/dashboard/src/ws/chat-handler.ts` — Enqueue abbreviation on `/new` slash command (conversation switch via web UI)
- `packages/dashboard/src/agent/session-manager.ts` — Wire pre-compaction flush
- `.my_agent/notebook/operations/work-patterns.md` — Add weekly review entry (gitignored)

### What S3 Does NOT Do

- No new MCP tools — `remember()`, `recall()`, `notebook_write()` already exist
- No changes to search — `knowledge/` files already indexed by sync service
- No UI changes beyond calendar entries

---

## Sprint 4: E2E Validation

**Goal:** Prove the entire memory lifecycle works end-to-end. Thailand vacation facts seeded in earlier sprints must reach Nina in conversation.

### Test Fixture

`packages/dashboard/tests/fixtures/thailand-vacation.ts` — Reusable synthetic conversation data:

```typescript
export const THAILAND_CONVERSATIONS = [
  {
    turns: [
      { role: "user", content: "I just landed in Chiang Mai!", channel: "whatsapp" },
      { role: "assistant", content: "Welcome to Chiang Mai! ...", channel: "whatsapp" },
      { role: "user", content: "Found an amazing pad krapao place near Tha Phae Gate", channel: "whatsapp" },
      { role: "assistant", content: "Tha Phae Gate area has great food ...", channel: "whatsapp" },
      { role: "user", content: "Meeting a local guide named Kai tomorrow for a temple tour", channel: "whatsapp" },
      { role: "assistant", content: "Temple tours are the best way ...", channel: "whatsapp" },
      { role: "user", content: "Flying to Krabi on the 15th, back to Tel Aviv on the 20th", channel: "whatsapp" },
      { role: "assistant", content: "Great itinerary! ...", channel: "whatsapp" },
    ],
  },
];
```

### Phase 1: Seeding (setup)

| # | Action |
|---|--------|
| 0a | Insert synthetic Thailand conversation into `agent.db` |
| 0b | Trigger abbreviation + fact extraction on that conversation |
| 0c | Trigger morning prep via `/api/work-loop/trigger/morning-prep` |

### Phase 2: Verify extraction

| # | Test | Pass Criteria |
|---|------|---------------|
| 1 | Facts in `knowledge/` | Contains: Chiang Mai, pad krapao, Kai, Krabi, March 15, March 20 |
| 2 | `current-state.md` written | Contains location + schedule, under 1000 chars |
| 3 | Daily log entry | Morning prep + extraction logged |
| 4 | Calendar shows runs | At least 2 work loop events visible |

### Phase 3: Verify memory reaches Nina

| # | Test | Pass Criteria |
|---|------|---------------|
| 5 | System prompt has context | Assembled prompt contains `current-state.md` content |
| 6 | "Where am I?" | Answers Chiang Mai without `recall()` (pre-loaded in system prompt) |
| 7 | "What should I eat?" | References pad krapao — may use `recall()` for `knowledge/` |
| 8 | "Who's Kai?" | Knows Kai is the temple guide — `recall()` finds `knowledge/people.md` |
| 9 | "When do I fly home?" | Answers March 20th |

### Phase 4: Lifecycle over time

| # | Test | Pass Criteria |
|---|------|---------------|
| 10 | New conversation, same facts | Start fresh conversation, "where am I?" → still knows Chiang Mai |
| 11 | Fact update propagates | New conversation: "Changed plans, Krabi tomorrow" → extraction + morning prep → `current-state.md` updated |
| 12 | Weekly review promotion | Seed 3+ extraction runs with same fact → trigger review → promoted to `reference/` |
| 13 | Post-promotion consistency | After promotion, morning prep sources from `reference/` |

### Phase 5: Resilience

| # | Test | Pass Criteria |
|---|------|---------------|
| 14 | Database rebuild | Delete `memory.db`, trigger sync → index rebuilt, search works |
| 15 | Cold start | Empty `knowledge/` + `operations/`, send message → no errors, graceful fallback |
| 16 | Concurrent extraction | Two conversations go idle simultaneously → no file corruption |
| 17 | Haiku API down | Mock failure in morning prep → fails, logs, retries next heartbeat, no crash |

### Verification Method

- **Tests 1–5, 10–17:** API-level assertions (file reads, DB queries, HTTP calls)
- **Tests 6–9:** Send message via WebSocket, capture Nina's response + tool call log. Primary assertion: check tool call logs (did `recall()` fire or not?) and verify the system prompt contains expected pre-loaded context. Secondary assertion: response text contains expected facts. Tool call assertions are deterministic; response text assertions allow some flexibility in phrasing.
- **Human walkthrough:** After all automated tests pass, one manual session in the browser — chat naturally, verify it feels like talking to someone who knows you.

### Files Created

- `packages/dashboard/tests/e2e/memory-lifecycle.test.ts` — Full test suite
- `packages/dashboard/tests/fixtures/thailand-vacation.ts` — Synthetic data

---

## Roadmap Updates

### Dependency graph change

```
Before:  M6.7 → M6.8 → M6.6
After:   M6.7 → M6.6    (M6.8 independent)
```

### After M6.6: Evaluation items

1. If SQLite-based scheduling + FullCalendar rendering works well for work loop jobs → **consider migrating user task scheduling** to the same system
2. If user tasks migrate → **evaluate Radicale removal**

These are separate decisions, not part of M6.6.

### Next milestone after M6.6

**Backup & Restore** — prerequisite for active use. Full backup (`.my_agent/` + DBs) and restore. Separate sprint, own design spec.

---

## CLAUDE.md Addition

Add to project `CLAUDE.md` under a new "Core Principles" section:

> **Markdown is source of truth.** SQLite is a derived index — deletable, rebuildable. Job definitions, facts, configuration, and operational state live in markdown files. Databases store run history, search indexes, and caches. If the database is deleted, the system rebuilds from markdown. If markdown is deleted, data is lost.

---

## Intentional Divergences from Earlier Design Docs

| Change | Original (design doc) | M6.6 (this spec) | Rationale |
|--------|----------------------|-------------------|-----------|
| `work-patterns.md` location | `.my_agent/brain/work-patterns.md` | `notebook/operations/work-patterns.md` | Auto-injected by `loadNotebookOperations()`, no new loader needed |
| `knowledge/` file names | `facts.md`, `patterns.md` | `facts.md`, `people.md`, `preferences.md` | Better semantic separation; `patterns.md` deferred (not needed for MVP) |
| Context refresher on resume | Dedicated mtime-based detection + injection | Not needed — `SystemPromptBuilder` rebuilds every query | M6.7's architecture already solved this; no separate mechanism required |

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Token budget bloat in `current-state.md` | Morning prep prompt enforces 500–1000 char limit |
| Haiku extraction quality | Structured prompt with examples; deduplication prevents noise accumulation |
| Concurrent file writes | Sequential job execution; extraction uses append with section markers |
| Stale `current-state.md` | Temporal context injection lets Nina reason about freshness |
| Heartbeat storm after long outage | Sequential execution + cadence check prevents burst |
| Fact conflicts (knowledge vs reference) | Weekly review explicitly resolves; most recent wins |

---

## File Index

### Design & Planning
- `docs/plans/2026-03-01-memory-first-agent-design.md` — Original design (approved)
- `docs/design/memory-system.md` — Memory system architecture
- `docs/design/embeddings-plugin.md` — Embeddings plugin spec

### Existing Implementation (working)
- `packages/core/src/memory/` — Memory module (DB, chunker, sync, search, tools)
- `packages/core/src/mcp/memory-server.ts` — MCP tool definitions
- `packages/core/src/prompt.ts` — System prompt assembly
- `packages/dashboard/src/agent/system-prompt-builder.ts` — 6-layer prompt builder
- `packages/dashboard/src/conversations/abbreviation.ts` — Abbreviation queue

### New Files (this milestone)
- `packages/dashboard/src/scheduler/work-loop-scheduler.ts`
- `packages/dashboard/src/scheduler/haiku-query.ts`
- `packages/dashboard/src/scheduler/jobs/morning-prep.ts`
- `packages/dashboard/src/scheduler/jobs/daily-summary.ts`
- `packages/dashboard/src/scheduler/jobs/weekly-review.ts`
- `packages/dashboard/src/conversations/fact-extractor.ts`
- `packages/dashboard/src/routes/work-loop.ts`
- `packages/dashboard/tests/e2e/memory-lifecycle.test.ts`
- `packages/dashboard/tests/fixtures/thailand-vacation.ts`

### Private Files (gitignored, `.my_agent/`)
- `notebook/operations/current-state.md`
- `notebook/operations/work-patterns.md`
- `notebook/knowledge/facts.md`
- `notebook/knowledge/people.md`
- `notebook/knowledge/preferences.md`

---

*Approved: 2026-03-11*
