# M6.6-S2.5: Work Loop UX Polish — Sprint Review

**Date:** 2026-03-11
**Status:** Complete
**Duration:** Single session

---

## Goal

Work loop jobs display as recurring calendar events, open as full tabs with activity logs, prompt inspection, and chat context tags. Replace the modal detail panel with a proper tab + mobile popover following Nina V1 design language.

## Delivered

### Backend (API + Events)

- **GET /api/work-loop/jobs/:jobName** — New endpoint returning job metadata, cadence, model, prompts, and paginated run history
- **Prompt exposure** — Exported `SYSTEM_PROMPT` and `USER_PROMPT_TEMPLATE` from morning-prep and daily-summary job modules; `getJobPrompts()` method on WorkLoopScheduler
- **Recurring calendar events** — Server generates multiple future scheduled occurrences (cursor-based loop, capped at 50), replacing the single "next scheduled" event
- **No duplication** — Scheduled occurrences only generated for future times; past times show as actual runs from DB. Manual triggers don't suppress future scheduled events.
- **30-minute display width** — Both past runs and scheduled events use 30-min minimum so they're visible in week/day views (was 1 minute, rendering as invisible slivers)

### Frontend (Desktop)

- **Work loop tab** — Replaces modal. Glass-strong panels, Tokyo Night colors, violet badges for cadence/model, collapsible prompts section, expandable activity log with status badges and output/error display
- **Chat context** — Active work loop tab sets chat context tag automatically
- **Calendar defaults** — List view as default (clearest for system tasks), time hidden in month/week views, "(scheduled)" stripped from month/week titles for space
- **Sidebar cleanup** — Renamed "Work Loop Jobs" toggle to "Show system tasks"; removed per-job list with Run buttons from sidebar (belongs in job detail tab)
- **`slotEventOverlap: false`** — Overlapping events stack side by side instead of rendering on top of each other

### Frontend (Mobile)

- **Work loop popover** — Sheet-style popover with same content as desktop tab (header, badges, schedule cards, collapsible prompts, activity log), gradient Run Now button, gesture support

### Tests

- **10 tests passing** — Original 4 + 6 new: job detail with history, 404 for unknown job, prompts field, recurring occurrences, multiple manual runs as separate events, no duplication between scheduled and completed

## CTO Feedback (Applied)

1. "Can't see the meeting in the calendar" — Fixed: 1-minute display → 30-minute minimum
2. "Show system tasks not Work Loop Jobs" — Fixed: human-friendly label
3. "Tasks don't belong on sidebar" — Fixed: removed job list from calendar sidebar
4. "Remove time from views" — Fixed: time hidden except list view
5. "Remove (scheduled) from month/week" — Fixed: per-view eventContent callbacks
6. "Morning prep appears twice on current day" — Fixed: scheduled occurrences only for future times
7. "Only one task showing when times overlap" — Fixed: `slotEventOverlap: false`
8. "List view shows runs best" — Fixed: default view changed to listWeek

## Files Changed

| File | Change |
|------|--------|
| `src/routes/work-loop.ts` | Job detail endpoint, recurring events, 30-min display, future-only scheduled |
| `src/scheduler/work-loop-scheduler.ts` | `getJobPrompts()` method, prompt imports |
| `src/scheduler/jobs/morning-prep.ts` | Export prompt constants |
| `src/scheduler/jobs/daily-summary.ts` | Export prompt constants |
| `public/js/app.js` | Work loop tab/popover logic, state, mobile detection |
| `public/js/calendar.js` | List view default, per-view settings, slotEventOverlap |
| `public/index.html` | Desktop tab template, mobile popover template, sidebar cleanup |
| `tests/work-loop-api.test.ts` | 6 new tests (10 total) |

## Verification

- [x] `npx vitest run` — 10/10 pass
- [x] `npx tsc --noEmit` — clean
- [x] Desktop browser validation — tabs, calendar, prompts, activity log
- [x] Mobile popover — opens from calendar event click
- [x] Manual trigger — 3 runs show as separate events
- [x] No duplication — scheduled vs completed events don't overlap
