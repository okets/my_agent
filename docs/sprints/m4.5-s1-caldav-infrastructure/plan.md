# M4.5-S1: CalDAV Infrastructure

> **Status:** Complete
> **Dependencies:** M4-S2 (Dashboard Workspace Layout) — Complete
> **Design spec:** [calendar-system.md](../../design/calendar-system.md)
> **Prototype:** `prototypes/calendar/` — Validated 2026-02-18

---

## Overview

Set up the CalDAV backend infrastructure. Radicale server, tsdav client, CalendarRepository interface, and health checks. This sprint creates the foundation that S2 (Dashboard) and S3 (MCP Tools) build upon.

---

## Deliverables

| ID | Deliverable | Description |
|----|-------------|-------------|
| D1 | Radicale setup | Server config, systemd service, htpasswd auth |
| D2 | CalendarRepository | Interface + tsdav implementation |
| D3 | Calendar context | `assembleCalendarContext()` for system prompt |
| D4 | Health endpoint | `/api/calendar/health` for dashboard status |

---

## Tasks

### T1: Radicale Server Setup

**Location:** `.my_agent/calendar/`

| Item | Details |
|------|---------|
| Config | `radicale.conf` — bind 127.0.0.1:5232, file storage |
| Auth | `htpasswd` with bcrypt, credentials from `credentials.json` |
| Storage | `data/` directory for CalDAV collections |
| Service | `~/.config/systemd/user/radicale.service` |

**Files to create:**
- `.my_agent/calendar/radicale.conf`
- `.my_agent/calendar/htpasswd`
- `.my_agent/calendar/credentials.json`
- `~/.config/systemd/user/radicale.service`

**Acceptance:**
- [ ] Radicale starts on `systemctl --user start radicale`
- [ ] Auth works with credentials from config
- [ ] Data persists in `.my_agent/calendar/data/`

---

### T2: Calendar Types Interface

**Location:** `packages/core/src/calendar/types.ts`

```typescript
interface CalendarEvent {
  uid: string
  calendarId: string
  title: string
  description?: string
  start: Date
  end: Date
  allDay: boolean
  rrule?: string
  status: 'confirmed' | 'tentative' | 'cancelled'
  transparency: 'opaque' | 'transparent'
  location?: string
  // my_agent extensions
  taskId?: string
  taskType?: 'scheduled' | 'deadline' | 'reminder'
  action?: string
}

interface Calendar {
  id: string
  displayName: string
  url: string
  color: string
  role: 'owned' | 'subscribed'
  notifications: boolean | 'passthrough'
  defaultVisible: boolean
}

interface CalendarRepository {
  listCalendars(): Promise<Calendar[]>
  getEvents(calendarId: string, from: Date, to: Date): Promise<CalendarEvent[]>
  createEvent(calendarId: string, event: Omit<CalendarEvent, 'uid'>): Promise<CalendarEvent>
  updateEvent(calendarId: string, uid: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent>
  deleteEvent(calendarId: string, uid: string): Promise<void>
  getUpcoming(windowHours?: number): Promise<CalendarEvent[]>
}
```

**Acceptance:**
- [ ] Types exported from `packages/core/src/calendar/index.ts`
- [ ] No TypeScript errors

---

### T3: CalDAV Client Implementation

**Location:** `packages/core/src/calendar/caldav-client.ts`

Implements `CalendarRepository` using tsdav:

| Method | Implementation Notes |
|--------|---------------------|
| `listCalendars()` | `client.fetchCalendars()` → map to `Calendar[]` |
| `getEvents()` | `client.fetchCalendarObjects()` → parse iCal → expand RRULE |
| `createEvent()` | Generate iCal string → `client.createCalendarObject()` |
| `updateEvent()` | Fetch → modify → `client.updateCalendarObject()` |
| `deleteEvent()` | `client.deleteCalendarObject()` |
| `getUpcoming()` | `getEvents(now, now+windowHours)` sorted by start |

**Dependencies:**
- `tsdav` — CalDAV client
- `ical-expander` — RRULE expansion
- `luxon` — Date handling

**Acceptance:**
- [ ] All methods implemented
- [ ] Recurring events properly expanded
- [ ] Error handling for Radicale offline

---

### T4: Calendar Configuration

**Location:** `packages/core/src/calendar/config.ts`

Load calendar config from `.my_agent/config.yaml`:

```yaml
calendar:
  server:
    host: "127.0.0.1"
    port: 5232
  calendars:
    system:
      role: "owned"
      color: "overlay1"
      notifications: false
      defaultVisible: false
    user:
      role: "owned"
      color: "blue"
      notifications: true
      defaultVisible: true
```

**Acceptance:**
- [ ] Config loads from YAML
- [ ] Defaults applied when missing
- [ ] Credentials loaded from separate `credentials.json`

---

### T5: Calendar Context for System Prompt

**Location:** `packages/core/src/calendar/context.ts`

```typescript
async function assembleCalendarContext(repo: CalendarRepository): Promise<string>
```

Returns markdown like:
```markdown
## Upcoming

Today (Feb 18):
- 14:00 — Call dentist to reschedule
- 16:00 — Team standup (recurring)

Tomorrow (Feb 19):
- 09:00 — Review quarterly report [DEADLINE]
```

**Parameters:**
- Window: 48 hours look-ahead
- Max events: 10
- Cache: 60 seconds TTL

**Acceptance:**
- [ ] Returns formatted markdown
- [ ] Respects event limits
- [ ] Graceful fallback when Radicale offline: `[Calendar offline]`

---

### T6: Health Endpoint

**Location:** `packages/dashboard/src/routes/calendar.ts`

```
GET /api/calendar/health
```

Response:
```json
{
  "status": "healthy" | "degraded" | "offline",
  "radicale": { "reachable": true, "latencyMs": 12 },
  "calendars": ["system", "user"],
  "lastSync": "2026-02-18T14:30:00Z"
}
```

**Acceptance:**
- [ ] Returns status within 5s timeout
- [ ] Correctly identifies Radicale offline
- [ ] Dashboard can show calendar status

---

### T7: Multi-Calendar Initialization

**Location:** `packages/core/src/calendar/init.ts`

On first startup:
1. Check if `system` and `user` calendars exist
2. Create via CalDAV `MKCALENDAR` if missing
3. Apply display names and colors

**Acceptance:**
- [ ] Calendars auto-created on first run
- [ ] Idempotent (safe to run multiple times)

---

### T8: Integration with Brain

**Location:** `packages/core/src/prompt.ts`

Modify `assembleSystemPrompt()` to include calendar context:

```typescript
const calendarContext = await assembleCalendarContext(calendarRepo);
// Insert into system prompt after Notebook context
```

**Acceptance:**
- [ ] Calendar context appears in system prompt
- [ ] Graceful when calendar offline

---

## File Structure (After Sprint)

```
.my_agent/
├── calendar/
│   ├── radicale.conf         # T1
│   ├── htpasswd              # T1
│   ├── credentials.json      # T1 (gitignored)
│   └── data/                 # T1 (gitignored)

packages/core/
├── src/
│   ├── calendar/
│   │   ├── index.ts          # T2 exports
│   │   ├── types.ts          # T2
│   │   ├── caldav-client.ts  # T3
│   │   ├── config.ts         # T4
│   │   ├── context.ts        # T5
│   │   └── init.ts           # T7
│   └── prompt.ts             # T8 modified

packages/dashboard/
├── src/
│   └── routes/
│       └── calendar.ts       # T6

~/.config/systemd/user/
└── radicale.service          # T1
```

---

## Dependencies (npm)

Add to `packages/core/package.json`:
```json
{
  "tsdav": "^2.1.1",
  "ical-expander": "^3.1.0",
  "luxon": "^3.4.4"
}
```

Types:
```json
{
  "@types/luxon": "^3.4.2"
}
```

---

## Risks

| Risk | Mitigation |
|------|------------|
| Radicale Python dependency | Use venv in `.my_agent/calendar/radicale-venv/` |
| RRULE edge cases | Copy test cases from prototype |
| Timezone bugs | Use luxon throughout, explicit TZID |

---

## Out of Scope

- Dashboard calendar UI (S2)
- MCP tools for Nina (S3)
- Migration from `reminders.md` (S3)
- External calendar sync (Future)

---

## Team

| Role | Model | Tasks |
|------|-------|-------|
| Tech Lead | Opus | Architecture, T2, T8 |
| Backend Dev | Sonnet | T1, T3, T4, T5, T6, T7 |
| Reviewer | Opus | Final review |

---

*Created: 2026-02-18*
