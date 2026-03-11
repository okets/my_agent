# M6.6-S2: Work Loop Scheduler — Sprint Review

> **Status:** Complete (with UX gaps → S2.5)
> **Date:** 2026-03-11
> **Spec:** [memory-perfection-design.md](../../superpowers/specs/2026-03-11-memory-perfection-design.md) § Sprint 2

---

## Goal

Nina runs background Haiku jobs on schedule. All jobs visible on a system calendar — transparent, inspectable, clickable.

## Deliverables

| # | Spec Item | Status | Notes |
|---|-----------|--------|-------|
| 2.1 | WorkLoopScheduler core | Done | Polls 60s, sequential execution, heartbeat retry |
| 2.2 | work-patterns.md parser | Done | H2 headings = jobs, `- key: value` = config, kebab-case names |
| 2.3 | Morning prep job | Done | Reads notebook context → Haiku → writes `operations/current-state.md` |
| 2.4 | Daily summary job | Done | Reads daily log + abbreviations → Haiku → appends to daily log |
| 2.5 | Auto-create default patterns | Done | Creates `work-patterns.md` with morning-prep + daily-summary on first run |
| 2.6 | Database table (`work_loop_runs`) | Done | id, job_name, started_at, completed_at, status, duration_ms, output, error |
| 2.7 | System calendar API | Done | GET /events (FullCalendar), GET /status, POST /trigger/:jobName |
| 2.8 | FullCalendar integration | Done | Second event source, sidebar toggle, distinct visual treatment |
| 2.9 | Manual trigger API + button | Done | POST trigger endpoint + sidebar "Run" buttons |
| 2.10 | Graceful shutdown | Done | `stop()` awaits `activeCheck` promise, clears interval |
| 1.2 | Notebook last updated (S1 gap) | Done | `getNotebookLastUpdated` callback in BuilderConfig |

## Gap Closure (from previous session)

15 gaps identified across S1+S2 via systematic spec comparison. All closed:

| Gap | Resolution |
|-----|-----------|
| S1 1.2: Notebook last updated timestamp | Added `getNotebookLastUpdated` callback, lazy memoryDb wiring |
| S1 E2E tests (5 spec tests) | `context-foundation.test.ts` — 6 tests |
| S2: Heartbeat retry verification | Test confirms `getLastRun` returns null for failed jobs |
| S2: Restart persistence | Test confirms run history survives scheduler restart |
| S2: API route tests | `work-loop-api.test.ts` — 4 tests via Fastify inject |
| S2: Sidebar toggle | Checkbox + `showSystemEvents` state + calendar source toggle |
| S2: Event detail panel | Glass modal with status, output, error, duration |
| S2: Run Now buttons | Per-job buttons in sidebar, result in detail panel |
| S2: Prompt injection test | Verifies morning prep output flows through to assembled prompt |

## Test Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Clean (dashboard) |
| `npx prettier --write` | Clean |
| work-patterns.test.ts | 25 passed |
| work-loop-scheduler.test.ts | 12 passed |
| work-loop-api.test.ts | 4 passed |
| context-foundation.test.ts | 6 passed |
| system-prompt-builder.test.ts | 10 passed |
| **Total** | **57 passed, 4 skipped (Haiku API)** |

## Files Created

| File | Purpose |
|------|---------|
| `src/scheduler/work-patterns.ts` | Pattern parser, `isDue`, `getNextScheduledTime` |
| `src/scheduler/work-loop-scheduler.ts` | Main scheduler class |
| `src/scheduler/haiku-query.ts` | Haiku API wrapper for background jobs |
| `src/scheduler/jobs/morning-prep.ts` | Morning prep prompt + handler |
| `src/scheduler/jobs/daily-summary.ts` | Daily summary prompt + handler |
| `src/routes/work-loop.ts` | REST API routes |
| `tests/work-patterns.test.ts` | Parser unit tests |
| `tests/work-loop-scheduler.test.ts` | Scheduler integration tests |
| `tests/work-loop-api.test.ts` | API route tests |
| `tests/context-foundation.test.ts` | S1 E2E + prompt injection tests |
| `tests/fixtures/thailand-vacation.ts` | Test fixture data |

## Files Modified

| File | Change |
|------|--------|
| `src/index.ts` | WorkLoopScheduler init, graceful shutdown, SyncService → reloadPatterns |
| `src/server.ts` | `workLoopScheduler` decorator, route registration |
| `src/agent/system-prompt-builder.ts` | `getNotebookLastUpdated` callback, temporal context |
| `src/agent/session-manager.ts` | `initPromptBuilder` options parameter |
| `public/js/calendar.js` | Dual event sources, `showSystemEvents` option |
| `public/js/app.js` | Work loop state, toggle, detail panel, run buttons, pattern loading |
| `public/index.html` | System section in sidebar, detail modal |

## Commits

| Hash | Message |
|------|---------|
| `5abac15` | feat(m6.6-s2): work loop scheduler, patterns, API routes, tests |
| `fd99e6c` | feat(m6.6-s1): add notebook-last-updated to temporal context |
| `081c9dc` | test(m6.6-s2): verify heartbeat retry and restart persistence |
| `e5ea4a6` | test(m6.6-s2): add API route tests for work loop endpoints |
| `1da4e44` | feat(m6.6-s2): add work loop UI — sidebar toggle, detail panel, run buttons |
| `06fc891` | test(m6.6): add context foundation E2E tests and prompt injection test |
| `26df52d` | style: apply prettier formatting |

## CTO Feedback (Live Review)

Two UX issues identified during manual verification:

1. **Recurring pattern display:** Calendar shows individual past runs + single next occurrence. Should display as a recurring event series (like a daily meeting) so the user sees the full schedule at a glance.

2. **Tab-based detail view:** Work loop events open in a modal popover instead of a proper tab. Should follow the existing task/event tab pattern — full tab with activity log, metadata, and chat-referenceable tag so the active conversation has context.

**Resolution:** These are UX improvements beyond the original spec. Scoped as **S2.5: Work Loop UX Polish**.
