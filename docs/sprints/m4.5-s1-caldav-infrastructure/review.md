# M4.5-S1: CalDAV Infrastructure — Review

> **Status:** Complete
> **Date:** 2026-02-18
> **Team:** Tech Lead (Opus) + Backend Dev (Sonnet) + Reviewer (Opus)

---

## Deliverables

| ID | Deliverable | Status |
|----|-------------|--------|
| D1 | Radicale setup | Complete |
| D2 | CalendarRepository | Complete |
| D3 | Calendar context | Complete |
| D4 | Health endpoint | Complete |

All deliverables shipped. No scope reductions.

---

## Tasks

| Task | Description | Status |
|------|-------------|--------|
| T1 | Radicale Server Setup | Complete |
| T2 | Calendar Types Interface | Complete |
| T3 | CalDAV Client Implementation | Complete |
| T4 | Calendar Configuration | Complete |
| T5 | Calendar Context for System Prompt | Complete |
| T6 | Health Endpoint | Complete |
| T7 | Multi-Calendar Initialization | Complete |
| T8 | Integration with Brain | Complete |

---

## Files Created

### Private (`.my_agent/calendar/`)

| File | Purpose |
|------|---------|
| `radicale.conf` | Server config (bind 127.0.0.1:5232, file storage) |
| `htpasswd` | bcrypt-hashed credentials |
| `credentials.json` | CalDAV auth (username + password) |
| `data/` | CalDAV collection storage |
| `radicale-venv/` | Python virtualenv with Radicale |

### System (`~/.config/systemd/user/`)

| File | Purpose |
|------|---------|
| `radicale.service` | Systemd user service (auto-start enabled) |

### Core Package (`packages/core/src/calendar/`)

| File | Purpose |
|------|---------|
| `types.ts` | `CalendarEvent`, `Calendar`, `CalendarRepository`, `CalendarConfig` |
| `caldav-client.ts` | `CalDAVClient` class implementing `CalendarRepository` |
| `config.ts` | `loadCalendarConfig()`, `loadCalendarCredentials()` |
| `context.ts` | `assembleCalendarContext()` with 60s cache |
| `init.ts` | `initializeCalendars()`, `checkRadicaleHealth()` |
| `index.ts` | Module exports |

### Dashboard Package (`packages/dashboard/src/`)

| File | Purpose |
|------|---------|
| `routes/calendar.ts` | `GET /api/calendar/health` endpoint |
| `routes/debug.ts` | Updated to include calendar context in `/brain/prompt` |
| `agent/session-manager.ts` | Updated to inject calendar context into system prompt |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/prompt.ts` | Added `calendarContext` option to `assembleSystemPrompt()` |
| `packages/core/src/lib.ts` | Exported calendar module functions and types |
| `packages/dashboard/src/server.ts` | Registered calendar routes |

---

## Verification

| Check | Result |
|-------|--------|
| `systemctl --user status radicale` | active (running) |
| Auth: valid credentials | HTTP 207 (Multi-Status) |
| Auth: invalid credentials | HTTP 401 (Unauthorized) |
| `/api/calendar/health` | `"status": "healthy"` |
| Offline fallback | `"status": "offline"` (graceful) |
| Calendar in system prompt | 166 chars, includes Radicale description |
| `npx tsc --noEmit` (core) | Pass |
| `npx tsc --noEmit` (dashboard) | Pass |

---

## Issues Found & Fixed

### Issue 1: Calendar context didn't tell Nina she HAS a calendar

**Symptom:** Nina responded "I don't have access to your calendar" despite calendar being configured.

**Root cause:** The `assembleCalendarContext()` function only output "## Upcoming\n\nNo upcoming events." (32 chars). It didn't explain that Nina has a calendar system — only listed events.

**Fix:** Updated `context.ts` to output:
```markdown
## Calendar

You have access to a local CalDAV calendar system (Radicale). You can view, create, and manage calendar events.

### Upcoming Events

[event list or "No upcoming events."]
```

**Files changed:** `packages/core/src/calendar/context.ts`

### Issue 2: Debug API didn't include calendar context

**Symptom:** QA agent couldn't verify calendar context via `/api/debug/brain/prompt`.

**Root cause:** The debug endpoint called `assembleSystemPrompt(brainDir)` without passing `calendarContext`.

**Fix:** Updated debug.ts to load calendar config/credentials and pass context to `assembleSystemPrompt()`.

**Files changed:** `packages/dashboard/src/routes/debug.ts`

### Issue 3: Core package changes not picked up

**Symptom:** After editing `context.ts`, server still returned 32-char context.

**Root cause:** The dashboard imports from `@my-agent/core` which points to `dist/`. tsx hot-reloads TypeScript but not compiled dependencies.

**Fix:** Run `npm run build` in `packages/core` after changes to calendar module.

**Lesson learned:** Add to MEMORY.md: "Core package changes require rebuild (`npm run build`) before dashboard picks them up."

---

## Architecture Decisions

1. **Radicale over alternatives:** Lightweight Python CalDAV server with bcrypt auth fits local-first philosophy. Runs as systemd user service.

2. **tsdav as CalDAV client:** Handles DAV wire protocol so our `CalDAVClient` only maps responses to domain types.

3. **ical-expander for RRULE:** Recurring event expansion is non-trivial. Delegating avoids reimplementing RFC 5545 edge cases.

4. **luxon for dates:** Consistent timezone handling across event parsing and context assembly.

5. **60s context cache:** Prevents CalDAV round-trip on every brain query while staying fresh.

6. **Graceful degradation:** When Radicale offline, calendar context says "currently offline" — brain continues operating.

---

## Test Report

### Story 1: Verify Radicale Service
```bash
systemctl --user status radicale
```
**Result:** PASS — active (running), enabled for auto-start

### Story 2: Verify Authentication
```bash
curl -X PROPFIND -u "agent:$PASSWORD" http://127.0.0.1:5232/
```
**Result:** PASS — HTTP 207 (valid), HTTP 401 (invalid)

### Story 3: Health Endpoint
```bash
curl http://localhost:4321/api/calendar/health
```
**Result:** PASS — `"status": "healthy"`, latency ~200ms

### Story 4: Offline Fallback
```bash
systemctl --user stop radicale
curl http://localhost:4321/api/calendar/health
```
**Result:** PASS — `"status": "offline"`, dashboard didn't crash

### Story 5: Brain Awareness
Ask Nina "What's on my calendar?"

**Result:** PASS — Nina acknowledged having a CalDAV calendar:
```
[SessionManager] Calendar context assembled (166 chars)
[SessionManager] System prompt assembled (5429 chars), has calendar: true
```

---

## What's Next

- **M4.5-S2:** Dashboard calendar UI — week view, event creation, calendar toggle
- **M4.5-S3:** MCP tools for Nina — `calendar_create`, `calendar_update`, `calendar_delete`

---

## Metrics

| Metric | Value |
|--------|-------|
| Tasks completed | 8/8 |
| Files created | 12 |
| Files modified | 4 |
| Issues found | 3 |
| Issues fixed | 3 |

---

*Completed: 2026-02-18*
