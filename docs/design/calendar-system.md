# Calendar System Design

> **Status:** Draft
> **Date:** 2026-02-18
> **Depends on:** M4-S2 (Dashboard Workspace Layout)

---

## Overview

The Calendar System replaces scattered time-aware concepts (reminders.md, cron schedules, task deadlines) with a unified CalDAV-based calendar. Everything with a time dimension becomes a calendar event.

**Core thesis:** One clock for all time-based triggers in the system.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dashboard (FullCalendar)                  │
│                     Week/Month/Day views, drag-drop              │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ REST API
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Fastify Calendar Service                     │
│  • CalendarRepository interface                                  │
│  • ical-expander for RRULE expansion                            │
│  • In-memory cache (60s TTL)                                    │
│  • MCP tools for Nina                                           │
└─────────────────────────────────┬───────────────────────────────┘
                                  │ CalDAV (tsdav)
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Radicale (CalDAV Server)                     │
│  • Self-hosted, data in .my_agent/calendar/                     │
│  • Binds to 127.0.0.1:5232 only                                 │
│  • htpasswd authentication                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Unified Model

Everything with a time dimension is a calendar event:

| Old Concept | Calendar Event | Notes |
|-------------|----------------|-------|
| Reminder | VEVENT with start time | "Call dentist at 3pm" |
| Recurring reminder | VEVENT with RRULE | "Weekly standup every Monday" |
| Task deadline | VEVENT + `X-MYAGENT-TASK-ID` | Links to task folder |
| Daily summary | VEVENT `RRULE=DAILY` | `X-MYAGENT-ACTION: daily-summary` |
| Out-of-office | VEVENT from personal calendar | `TRANSP:TRANSPARENT` |

**What stays as Notebook files:**
- `external-communications.md` — not time-based, policy file
- `standing-orders.md` — not time-based, behavioral config

**What stays as code:**
- Watchdog/heartbeat — infrastructure, not user-scheduled

---

## Multi-Calendar Architecture

The system uses a three-calendar model separating system operations from user events:

### Calendar Types

| Calendar | Purpose | Owner | Color | Notifications |
|----------|---------|-------|-------|---------------|
| **system** | Agent routines: daily summaries, scheduled tasks, health checks, auto-generated events | Nina | Gray/Muted | Silent |
| **user** | User-requested events: reminders, appointments, deadlines, meetings | User via Nina | Blue | Active |
| **personal** | Synced external calendar (Google/Apple/Outlook) | User | Purple | Passthrough |

### Separation Benefits

1. **Visibility control** — User can hide "system" calendar to see only their events
2. **Audit trail** — Clear distinction: "Nina created this for system maintenance" vs "User asked for this reminder"
3. **Notification policies** — System events are silent by default; user events notify
4. **Cognitive load** — User sees clean calendar without internal agent housekeeping

### Event Routing Rules

| Event Type | Calendar | Example |
|------------|----------|---------|
| User says "remind me to call mom" | user | "Call mom" at specified time |
| User says "schedule meeting with Bob" | user | "Meeting with Bob" |
| Daily memory summary | system | "Daily Summary" at 23:59 |
| Scheduled task execution | system | "Run weekly report task" |
| Task deadline (user-facing) | user | "DEADLINE: Fix login bug" |
| Health check / watchdog | system | "Channel health check" (recurring) |
| Imported from personal calendar | personal | Read-only mirror of external events |

### Configuration

```yaml
# .my_agent/config.yaml
calendar:
  server:
    host: "127.0.0.1"
    port: 5232

  calendars:
    system:
      url: "http://localhost:5232/agent/system/"
      role: "owned"           # Nina full read/write
      color: "overlay1"       # Muted gray (Catppuccin)
      notifications: false    # Silent by default
      defaultVisible: false   # Hidden by default in UI

    user:
      url: "http://localhost:5232/agent/user/"
      role: "owned"           # Nina full read/write
      color: "blue"
      notifications: true     # Active notifications
      defaultVisible: true    # Always visible

    personal:
      url: "${PERSONAL_CALDAV_URL}"
      role: "subscribed"      # Read-only sync
      color: "purple"
      syncIntervalMinutes: 15
      notifications: passthrough  # Use external calendar's settings
      defaultVisible: true
```

### UI Behavior

**Sidebar toggles:**
```
My Calendars
  ● User Events        [visible]
  ○ System (Nina)      [hidden by default]
  ● Personal (synced)  [visible]
```

User can show/hide any calendar. "System" is hidden by default but available for transparency ("what is Nina doing?").

### Calendar Channels (Future)

External calendars are modeled as channel plugins:

```
plugins/
├── calendar-google/        # OAuth 2.0 flow
├── calendar-apple/         # App password + CalDAV
├── calendar-outlook/       # Microsoft Graph API
└── calendar-caldav/        # Generic CalDAV
```

Each channel:
- Has its own auth flow
- Registers calendars with CalendarManager
- Syncs on configurable schedule
- Can be read-only or read-write

---

## Data Model

### CalendarEvent Interface

```typescript
interface CalendarEvent {
  uid: string                    // Stable unique ID (UUID)
  calendarId: string             // Which calendar
  title: string
  description?: string
  start: Date
  end: Date
  allDay: boolean
  rrule?: string                 // RFC 5545 RRULE string
  status: 'confirmed' | 'tentative' | 'cancelled'
  transparency: 'opaque' | 'transparent'
  location?: string

  // my_agent extensions (stored as X- properties)
  taskId?: string                // Links to task folder
  taskType?: 'scheduled' | 'deadline' | 'reminder'
  action?: string                // "daily-summary", etc.
}
```

### CalendarRepository Interface

```typescript
interface CalendarRepository {
  listCalendars(): Promise<Calendar[]>
  getEvents(calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]>
  createEvent(calendarId: string, event: Omit<CalendarEvent, 'uid'>): Promise<CalendarEvent>
  updateEvent(calendarId: string, uid: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent>
  deleteEvent(calendarId: string, uid: string): Promise<void>
  getUpcoming(windowHours?: number): Promise<CalendarEvent[]>
}
```

This interface allows swapping backends (Radicale → SQLite → Google) without changing business logic.

---

## Recurring Events

### Creation

```typescript
// "Every Monday at 9am"
await calendar.createEvent('agent', {
  title: 'Team standup',
  start: new Date('2026-02-23T09:00:00'),
  end: new Date('2026-02-23T09:30:00'),
  rrule: 'FREQ=WEEKLY;BYDAY=MO'
});
```

### Modification Options

| Action | iCal Mechanism |
|--------|----------------|
| Delete one occurrence | Add `EXDATE` to master |
| Modify one occurrence | Create child VEVENT with `RECURRENCE-ID` |
| Modify all future | Update master + EXDATE past occurrences |
| Modify entire series | Update master RRULE |

### UX Pattern

Standard 3-option dialog when editing recurring events:
- "This event only"
- "This and following events"
- "All events in the series"

---

## MCP Tools for Nina

```typescript
// calendar_create
{
  name: "calendar_create",
  description: "Create a calendar event or reminder",
  input_schema: {
    title: string,
    start: string,          // ISO 8601
    end?: string,           // Defaults to start + 1 hour
    allDay?: boolean,
    description?: string,
    rrule?: string,         // e.g. "FREQ=WEEKLY;BYDAY=MO"
    calendarId?: string,    // Default: "agent"
  }
}

// calendar_list
{
  name: "calendar_list",
  description: "List upcoming events",
  input_schema: {
    from?: string,          // Default: now
    to?: string,            // Default: now + 7 days
    calendarId?: string,    // Default: all calendars
  }
}

// calendar_update
{
  name: "calendar_update",
  description: "Update an existing calendar event",
  input_schema: {
    uid: string,
    title?: string,
    start?: string,
    end?: string,
    description?: string,
    editMode?: 'this' | 'following' | 'all'  // For recurring
  }
}

// calendar_delete
{
  name: "calendar_delete",
  description: "Delete a calendar event",
  input_schema: {
    uid: string,
    calendarId?: string,
    editMode?: 'this' | 'following' | 'all'  // For recurring
  }
}
```

**Access control:** Same as `notebook_edit` — write operations require owner conversation context.

---

## Prompt Integration

The system prompt includes a dynamic calendar context (replaces static `reminders.md`):

```markdown
## Upcoming

Today (Feb 18):
- 14:00 — Call dentist to reschedule
- 16:00 — Team standup (recurring)

Tomorrow (Feb 19):
- 09:00 — Review quarterly report [DEADLINE]
- All day — Review Q1 budget (from: personal)

This week:
- Feb 21 — Pay rent (recurring)
```

**Parameters:**
- Window: 48 hours look-ahead
- Max events: 10 (to cap prompt size)
- Cache: 60 seconds TTL

**Fallback:** If Radicale unavailable, show `[Calendar offline]` warning.

---

## Dashboard Integration

### Calendar Tab

FullCalendar v6 in the left workspace panel:

```
┌──────────────────────────────────────────┬───────────────────────────┐
│  [Home] [Calendar] [external-comms.md]   │ [▼ Conversation dropdown] │
├──────────────────────────────────────────┼───────────────────────────┤
│  [← Feb 2026 →]  [Week|Month|Day|List]  │                           │
│  [+ New Event]    [Today]               │   Owner ↔ Nina Chat       │
│ ┌─────┬──────┬──────┬──────┬───┬───┐   │                           │
│ │     │ Mon  │ Tue  │ Wed  │Thu│Fri│   │   Context badge shows     │
│ │ All │ 17   │ 18   │ 19   │20 │21 │   │   selected event          │
│ │ day │      │      │      │   │   │   │                           │
│ ├─────┼──────┼──────┼──────┼───┼───┤   │                           │
│ │ 9am │      │      │      │   │   │   │                           │
│ │10am │      │[Mtg] │      │   │   │   │                           │
│ │ 3pm │[Den] │      │      │   │   │   │                           │
│ └─────┴──────┴──────┴──────┴───┴───┘   │                           │
└──────────────────────────────────────────┴───────────────────────────┘
```

### Features

- Week/Month/Day/List view switching
- Click to create event (opens modal)
- Drag to move/resize events
- Multi-calendar with color coding (Catppuccin palette)
- Visibility toggles per calendar
- Event detail popover with "Ask Nina" button

### Chat Integration

- Clicking event sets `chatContext` → context badge appears
- "Add meeting tomorrow 3pm" in chat → event created → calendar refreshes via WebSocket

---

## Tech Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| CalDAV server | Radicale | Self-hosted, data local, Python single process |
| CalDAV client | tsdav | cal.com maintained, OAuth built-in, ESM/CJS |
| RRULE expansion | ical-expander | Full iCal object graph, EXDATE/RECURRENCE-ID |
| Frontend | FullCalendar v6 | MIT, CDN, week/month/day, drag-drop |
| Timezone | luxon | Preserves TZID through operations |

---

## Security

- Radicale binds to `127.0.0.1` only — never `0.0.0.0`
- Fastify proxies CalDAV with service credentials
- Credentials in `.my_agent/calendar/credentials.json` (gitignored)
- Dashboard auth gap is a blocker before LAN exposure

---

## File Structure

```
.my_agent/
├── calendar/
│   ├── config               # Radicale server config
│   ├── credentials.json     # CalDAV credentials (gitignored)
│   ├── htpasswd             # Radicale auth (gitignored)
│   └── data/                # Radicale storage (gitignored)

packages/core/
├── src/
│   ├── calendar/
│   │   ├── index.ts         # CalendarClient (tsdav)
│   │   ├── types.ts         # Interfaces
│   │   ├── scheduler.ts     # Poll for firing events
│   │   ├── context.ts       # assembleCalendarContext()
│   │   ├── mcp-tools.ts     # calendar_* tools
│   │   └── migrate.ts       # reminders.md migration

packages/dashboard/
├── public/
│   ├── js/calendar.js       # FullCalendar init
│   └── css/calendar.css     # Catppuccin theming
├── src/
│   └── routes/caldav.ts     # CalDAV proxy routes
```

---

## Migration

On first CalDAV startup:
1. Parse `reminders.md` entries
2. Create corresponding VEVENTs in Radicale
3. Rename to `reminders.md.migrated`
4. Update `brain/CLAUDE.md` to reference calendar

---

## Dependencies

- M4-S2 (Dashboard Workspace Layout) — tab system exists
- M4-S3 (Notebook Editing Tool) — tool-use pattern established

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| RRULE complexity | Use ical-expander, explicit test suite |
| Radicale crash | systemd restart, health endpoint, degraded UI |
| CalDAV protocol | CalendarRepository interface for backend swap |
| Timezone bugs | luxon, explicit TZID storage, DST tests |

---

## Prototype (Pre-Sprint Validation)

2-hour proof-of-concept before sprint commitment:
1. Run Radicale on `127.0.0.1:5232`
2. Create events via tsdav (one-time + recurring)
3. Query and expand with ical-expander
4. Render in FullCalendar (standalone HTML)
5. Test recurring event modification

---

*Created: 2026-02-18*
