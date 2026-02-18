# M4.5-S1: CalDAV Infrastructure — Review

> **Status:** Complete
> **Date:** 2026-02-18
> **Team:** Tech Lead (Opus) + Backend Dev (Sonnet) + Reviewer (Opus)

---

## Deliverables

| Task | Deliverable | Status |
|------|-------------|--------|
| T1 | Radicale server setup | Complete |
| T2 | Calendar types interface | Complete |
| T3 | CalDAV client implementation | Complete |
| T4 | Calendar configuration loader | Complete |
| T5 | Calendar context for system prompt | Complete |
| T6 | Health endpoint | Complete |
| T7 | Multi-calendar initialization | Complete |
| T8 | Brain integration | Complete |

All 8 tasks completed. No scope reductions.

---

## Files Created/Modified

### New Files (Private — `.my_agent/`)

- `.my_agent/calendar/radicale.conf` — Server config (bind 127.0.0.1:5232, file storage)
- `.my_agent/calendar/htpasswd` — bcrypt auth credentials
- `.my_agent/calendar/credentials.json` — CalDAV credentials (gitignored)
- `~/.config/systemd/user/radicale.service` — systemd user service (auto-start enabled)

### New Files (Core Package)

- `packages/core/src/calendar/types.ts` — `CalendarEvent`, `Calendar`, `CalendarRepository`, `CalendarConfig` interfaces
- `packages/core/src/calendar/caldav-client.ts` — `CalDAVClient` class implementing `CalendarRepository` (tsdav + ical-expander + luxon)
- `packages/core/src/calendar/config.ts` — `loadCalendarConfig()`, `loadCalendarCredentials()`
- `packages/core/src/calendar/context.ts` — `assembleCalendarContext()` with 60s TTL cache
- `packages/core/src/calendar/init.ts` — `initializeCalendars()` (idempotent system/user calendar creation)

### New Files (Dashboard Package)

- `packages/dashboard/src/routes/calendar.ts` — `GET /api/calendar/health` endpoint

### Modified Files

- `packages/core/src/prompt.ts` — Added `calendarContext` option to `assembleSystemPrompt()`

---

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (core) | Pass |
| `npx tsc --noEmit` (dashboard) | Pass |
| npm dependencies installed | `tsdav`, `ical-expander`, `luxon` present |
| Radicale service running | `systemctl --user status radicale` — active |
| Auth: valid credentials | HTTP 207 (Multi-Status) |
| Auth: invalid credentials | HTTP 401 (Unauthorized) |

---

## Architecture Decisions

1. **Radicale over self-hosted alternatives:** Lightweight Python CalDAV server with bcrypt auth fits the local-first, no-cloud philosophy. Runs as a systemd user service alongside the brain.

2. **tsdav as CalDAV client:** Handles the DAV wire protocol (PROPFIND, REPORT, MKCALENDAR) so the `CalDAVClient` only needs to map responses to domain types.

3. **ical-expander for RRULE:** Recurring event expansion is non-trivial. Delegating to a dedicated library avoids reimplementing RFC 5545 edge cases (EXDATE, UNTIL vs COUNT, timezone interaction).

4. **luxon for dates:** Consistent timezone handling across event parsing, context assembly, and upcoming window calculation.

5. **60s context cache:** Calendar context is injected into every system prompt. Caching prevents a CalDAV round-trip on every brain query while staying fresh enough for real-time scheduling awareness.

6. **Graceful degradation:** When Radicale is offline, `assembleCalendarContext()` returns `[Calendar offline]` and the brain continues operating. Health endpoint reports `"status": "offline"` without crashing the dashboard.

---

## What's Next

- **M4.5-S2:** Dashboard calendar UI — week view, event creation, calendar toggle
- **M4.5-S3:** MCP tools for Nina — `calendar_create`, `calendar_update`, `calendar_delete`, migration from `reminders.md`

---

## User Stories for Testing

### Story 1: Verify Radicale Service

**Steps:**
1. Open a terminal
2. Run: `systemctl --user status radicale`

**Expected:** Service is `active (running)`. If not running, `systemctl --user start radicale` should bring it up.

### Story 2: Verify Authentication

**Steps:**
1. Test valid auth: `curl -u "your-agent:your-password" -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5232/`
2. Test invalid auth: `curl -u "wrong:wrong" -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5232/`

**Expected:** Step 1 returns `207`. Step 2 returns `401`.

### Story 3: Check Health Endpoint

**Steps:**
1. Start the dashboard: `cd packages/dashboard && npm run dev`
2. Request: `curl -s http://localhost:4321/api/calendar/health | jq .`

**Expected:** JSON response with `"status": "healthy"`, `"radicale": { "reachable": true, "latencyMs": <number> }`, and a `"calendars"` array listing `"system"` and `"user"`.

### Story 4: Verify Offline Fallback

**Steps:**
1. Stop Radicale: `systemctl --user stop radicale`
2. Request the health endpoint: `curl -s http://localhost:4321/api/calendar/health | jq .`
3. Restart Radicale: `systemctl --user start radicale`

**Expected:** Step 2 returns `"status": "offline"` with `"radicale": { "reachable": false }`. Dashboard and brain continue working normally.

### Story 5: Verify Calendar Context in Brain

**Steps:**
1. Ensure Radicale is running
2. Start dashboard: `cd packages/dashboard && npm run dev`
3. Open http://localhost:4321
4. Ask Nina: "What's on my calendar today?"

**Expected:** Nina either describes upcoming events (if any exist) or states her calendar is empty — she should not error or be unaware that a calendar system exists.

---

_Completed: 2026-02-18_
