# M6.6-S2: Work Loop Scheduler + System Calendar — Sprint Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nina runs background Haiku jobs on schedule. All jobs visible on a system calendar — transparent, inspectable, clickable.

**Architecture:** WorkLoopScheduler polls every 60s, checks `work-patterns.md` for due jobs, executes Haiku calls sequentially. Jobs write to markdown files (current-state.md, daily log). Run history stored in `work_loop_runs` SQLite table. REST API exposes events for FullCalendar, status, and manual triggers. Dashboard sidebar shows toggle + run buttons.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, FullCalendar, Haiku API

**Spec:** [memory-perfection-design.md](../../superpowers/specs/2026-03-11-memory-perfection-design.md) § Sprint 2

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/scheduler/work-patterns.ts` | Pattern parser, `isDue`, `getNextScheduledTime` | Create |
| `src/scheduler/work-loop-scheduler.ts` | Main scheduler class (poll, execute, DB) | Create |
| `src/scheduler/haiku-query.ts` | Haiku API wrapper for background jobs | Create |
| `src/scheduler/jobs/morning-prep.ts` | Morning prep prompt + handler | Create |
| `src/scheduler/jobs/daily-summary.ts` | Daily summary prompt + handler | Create |
| `src/routes/work-loop.ts` | REST API routes (events, status, trigger) | Create |
| `src/index.ts` | Scheduler init + graceful shutdown | Modify |
| `src/server.ts` | Fastify decorator + route registration | Modify |
| `src/agent/system-prompt-builder.ts` | `getNotebookLastUpdated` callback | Modify |
| `public/js/calendar.js` | Dual event sources, system toggle | Modify |
| `public/js/app.js` | Work loop state, toggle, detail panel | Modify |
| `public/index.html` | System section in sidebar, detail modal | Modify |

---

## Task 1: Work Pattern Parser

Parse `work-patterns.md` (H2 headings = jobs, `- key: value` = config). Support cadence formats: `daily:HH:MM`, `weekly:DAY:HH:MM`. Provide `isDue(cadence, lastRun)` and `getNextScheduledTime(cadence, from?)`.

**Files:**
- Create: `src/scheduler/work-patterns.ts`
- Create: `tests/work-patterns.test.ts`

- [x] Write tests for parsing, isDue, getNextScheduledTime
- [x] Implement parser
- [x] Verify 25 tests pass

## Task 2: WorkLoopScheduler Core

Poll every 60s, check patterns for due jobs, execute sequentially. Store run results in `work_loop_runs` table. Heartbeat retry: failed jobs stay due until they succeed.

**Files:**
- Create: `src/scheduler/work-loop-scheduler.ts`
- Create: `tests/work-loop-scheduler.test.ts`

- [x] Write tests for scheduler lifecycle, run recording, restart persistence
- [x] Implement scheduler with DB table creation, polling, graceful shutdown
- [x] Verify 12 tests pass

## Task 3: Haiku Query Wrapper

Thin wrapper around Anthropic API for Haiku calls. System prompt + user prompt in, text out. Used by all background jobs.

**Files:**
- Create: `src/scheduler/haiku-query.ts`

- [x] Implement `queryHaiku(system, user, model?)` function

## Task 4: Morning Prep Job

Reads notebook context (facts, contacts, calendar, tasks) → Haiku → writes `operations/current-state.md`. Prompt assembles relevant context for the model.

**Files:**
- Create: `src/scheduler/jobs/morning-prep.ts`

- [x] Define SYSTEM_PROMPT and USER_PROMPT_TEMPLATE constants
- [x] Implement `runMorningPrep()` handler

## Task 5: Daily Summary Job

Reads daily log + conversation abbreviations → Haiku → appends summary to daily log. Captures patterns and seeds next morning's context.

**Files:**
- Create: `src/scheduler/jobs/daily-summary.ts`

- [x] Define SYSTEM_PROMPT and USER_PROMPT_TEMPLATE constants
- [x] Implement `runDailySummary()` handler

## Task 6: Auto-Create Default Patterns

On first run, create `notebook/config/work-patterns.md` with morning-prep (daily:06:00) + daily-summary (daily:21:00) if it doesn't exist.

- [x] Add auto-creation logic to scheduler startup

## Task 7: REST API Routes

Three endpoints: GET /events (FullCalendar-compatible), GET /status (scheduler info), POST /trigger/:jobName (manual trigger).

**Files:**
- Create: `src/routes/work-loop.ts`
- Create: `tests/work-loop-api.test.ts`

- [x] Implement routes with Fastify typed generics
- [x] Write 4 API tests via Fastify inject
- [x] Verify all pass

## Task 8: Server Integration

Wire scheduler into Fastify server lifecycle: init on startup, decorate instance, register routes, graceful shutdown.

**Files:**
- Modify: `src/index.ts`
- Modify: `src/server.ts`

- [x] Add `workLoopScheduler` decorator
- [x] Init scheduler with DB and agent dir
- [x] Wire graceful shutdown (stop awaits active check)

## Task 9: Dashboard UI — Sidebar + Detail Modal

System section in calendar sidebar: toggle checkbox for system events, per-job "Run" buttons. Glass modal for event details (status, output, error, duration).

**Files:**
- Modify: `public/js/app.js`
- Modify: `public/js/calendar.js`
- Modify: `public/index.html`

- [x] Add `showSystemEvents` state + toggle
- [x] Add second FullCalendar event source (conditional on toggle)
- [x] Add work loop patterns loading + run buttons
- [x] Add detail modal with status, output, duration, error display

## Task 10: S1 Gap Closure — Notebook Last Updated

S1 spec required `getNotebookLastUpdated` in temporal context. Add callback to SystemPromptBuilder.

**Files:**
- Modify: `src/agent/system-prompt-builder.ts`
- Modify: `src/agent/session-manager.ts`
- Create: `tests/context-foundation.test.ts`

- [x] Add `getNotebookLastUpdated` callback to BuilderConfig
- [x] Wire lazy memoryDb in session-manager
- [x] Write 6 context foundation E2E tests
- [x] Verify prompt injection test (morning prep output flows through)

---

## Dependency Graph

```
T1 (parser) → T2 (scheduler) → T3 (haiku) → T4 (morning prep) → T5 (daily summary)
                              → T6 (auto-create)
              T7 (API) → T8 (server integration) → T9 (dashboard UI)
              T10 (S1 gap) — independent
```
