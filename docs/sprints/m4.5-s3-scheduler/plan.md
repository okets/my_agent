# M4.5-S3: API Discovery + CalendarScheduler

> **Status:** Complete
> **Started:** 2026-02-19
> **Completed:** 2026-02-19
> **Mode:** Overnight Sprint (Autonomous)
> **Branch:** `sprint/m4.5-s3-scheduler`

---

## Context

M4.5-S2 delivered calendar dashboard with REST API. This sprint adds:
1. API discoverability for agents (no MCP tools needed)
2. CalendarScheduler for event triggering

**Decision:** Skip MCP tools — REST API is sufficient if discoverable.

---

## Tasks

| ID | Task | Owner | Status |
|----|------|-------|--------|
| T1 | Add `GET /api/debug/api-spec` endpoint | Backend | Done |
| T2 | Update SKILL.md with structured endpoints | Backend | Done |
| T3 | Add "Quick Actions" to calendar context | Backend | Done |
| T4 | Create CalendarScheduler class | Backend | Done |
| T5 | Add scheduler types to types.ts | Backend | Done |
| T6 | Initialize scheduler in server.ts | Backend | Done |
| T7 | Add `GET /api/debug/scheduler/status` | Backend | Done |
| T8 | Export scheduler from index.ts | Backend | Done |

---

## Files to Modify

| File | Action |
|------|--------|
| `packages/dashboard/src/routes/debug.ts` | Add api-spec + scheduler-status endpoints |
| `packages/core/src/calendar/context.ts` | Add Quick Actions section |
| `packages/core/src/calendar/scheduler.ts` | **New:** CalendarScheduler |
| `packages/core/src/calendar/types.ts` | Add scheduler types |
| `packages/core/src/calendar/index.ts` | Export scheduler |
| `packages/dashboard/src/server.ts` | Initialize scheduler |
| `packages/core/skills/calendar/SKILL.md` | Update with discovery hint |

---

## Verification

1. `curl http://localhost:4321/api/debug/api-spec | jq .calendar`
2. `curl http://localhost:4321/api/debug/scheduler/status`
3. Create event 2 min in future, watch logs for firing

---

## User Stories

### US1: API Discovery
1. QA agent calls `/api/debug/api-spec`
2. Response contains calendar endpoints with methods/paths/fields
3. Agent can create event using discovered endpoint

### US2: Scheduler Fires Events
1. Create event starting in 2 minutes
2. Wait for scheduler poll
3. Server logs show `[Scheduler] Event fired: ...`
4. `/api/debug/scheduler/status` shows incremented firedCount

### US3: Calendar Context Shows Actions
1. Start conversation with Nina
2. Calendar context in system prompt includes Quick Actions
3. Nina knows how to create/update/delete events

---

*Plan created: 2026-02-19*
