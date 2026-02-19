# M4.5-S2: Calendar Dashboard

> **Status:** Complete ✅
> **Date:** 2026-02-18
> **Depends on:** M4.5-S1 (CalDAV Infrastructure) — Complete
> **Review:** [review.md](review.md)

---

## Objectives

Add calendar tab to dashboard with full event management:

1. **FullCalendar integration** — Week/Month/Day/List views using FullCalendar v6
2. **Multi-calendar display** — System, User, Personal calendars with color coding
3. **Event CRUD** — Create, view, edit, delete events via REST API
4. **Drag-drop** — Move and resize events directly in calendar
5. **Chat integration** — Context badge, event creation from chat

---

## Reference

**Design spec:** `docs/design/calendar-system.md` §Dashboard Integration

**Key requirements:**
- FullCalendar v6 (MIT, CDN)
- Catppuccin color coding per calendar
- Visibility toggles per calendar (System hidden by default)
- Event detail popover with "Ask Nina" button
- WebSocket refresh when events change via chat

---

## Architecture

```
Dashboard                    REST API                   CalDAV
┌─────────────────┐         ┌─────────────────┐        ┌───────────┐
│ FullCalendar    │ ──GET──►│ /api/calendar   │──────► │ Radicale  │
│                 │         │   /events       │        │           │
│ Event Modal     │ ──POST─►│   /events       │        │ tsdav     │
│                 │         │   /events/:uid  │        │           │
│ Sidebar         │         └─────────────────┘        └───────────┘
│ (toggles)       │              ▲
└─────────────────┘              │
        │                   WebSocket
        └───────────────────────────────────────────────────────────
                        ws: calendar_event_changed
```

---

## Tasks

### T1: Calendar REST API

**File:** `packages/dashboard/src/routes/calendar.ts`

Extend existing health endpoint with CRUD operations:

```typescript
// GET /api/calendar/events?start=ISO&end=ISO&calendar=all
// Returns events in FullCalendar format

// POST /api/calendar/events
// Create new event, returns created event

// PUT /api/calendar/events/:uid
// Update event (title, start, end, etc.)

// DELETE /api/calendar/events/:uid
// Delete event

// GET /api/calendar/calendars
// List available calendars with visibility settings
```

**Considerations:**
- Transform CalendarEvent to FullCalendar event format
- Include calendar color in response
- Support `?calendar=system,user` filter

### T2: Calendar Configuration Endpoint

**File:** `packages/dashboard/src/routes/calendar.ts`

Add endpoint for calendar metadata:

```typescript
// GET /api/calendar/config
// Returns calendar list with colors, visibility defaults
{
  "calendars": [
    { "id": "system", "name": "System", "color": "#6c7086", "defaultVisible": false },
    { "id": "user", "name": "User Events", "color": "#89b4fa", "defaultVisible": true }
  ]
}
```

### T3: FullCalendar Setup

**Files:**
- `packages/dashboard/public/index.html` — Add CDN script
- `packages/dashboard/public/js/calendar.js` — Calendar initialization

Add FullCalendar v6 via CDN:
```html
<script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.8/index.global.min.js"></script>
```

Initialize with:
- `dayGridMonth`, `timeGridWeek`, `timeGridDay`, `listWeek` views
- Event source: `/api/calendar/events`
- Editable: true (drag-drop)
- Selectable: true (click to create)

### T4: Calendar Tab Content

**File:** `packages/dashboard/public/index.html`

Add Calendar tab alongside Home, Settings:

```html
<div x-show="activeTab === 'calendar'" class="h-full flex" x-cloak>
  <!-- Sidebar: calendar toggles -->
  <div class="w-48 shrink-0 p-4 border-r border-white/5">
    <h3 class="text-xs font-semibold text-tokyo-muted uppercase mb-3">
      Calendars
    </h3>
    <template x-for="cal in calendarList" :key="cal.id">
      <label class="flex items-center gap-2 py-1 cursor-pointer">
        <input type="checkbox" x-model="calendarVisibility[cal.id]"
               @change="refreshCalendar()"
               class="accent-current" :style="{ accentColor: cal.color }">
        <span class="w-2 h-2 rounded-full" :style="{ background: cal.color }"></span>
        <span class="text-sm" x-text="cal.name"></span>
      </label>
    </template>
  </div>

  <!-- Main: FullCalendar -->
  <div class="flex-1 p-4">
    <div x-ref="calendarEl" class="h-full"></div>
  </div>
</div>
```

### T5: Event Creation Modal

**File:** `packages/dashboard/public/index.html`

Modal for creating/editing events:

```html
<div x-show="eventModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
  <div class="glass-strong rounded-xl p-5 w-96">
    <h3 class="text-lg font-semibold mb-4" x-text="editingEvent ? 'Edit Event' : 'New Event'"></h3>

    <div class="space-y-4">
      <input x-model="eventForm.title" placeholder="Event title"
             class="w-full bg-tokyo-card border border-white/10 rounded-lg px-3 py-2 text-sm">

      <div class="grid grid-cols-2 gap-3">
        <input type="datetime-local" x-model="eventForm.start"
               class="bg-tokyo-card border border-white/10 rounded-lg px-3 py-2 text-sm">
        <input type="datetime-local" x-model="eventForm.end"
               class="bg-tokyo-card border border-white/10 rounded-lg px-3 py-2 text-sm">
      </div>

      <label class="flex items-center gap-2">
        <input type="checkbox" x-model="eventForm.allDay">
        <span class="text-sm">All day</span>
      </label>

      <select x-model="eventForm.calendarId"
              class="w-full bg-tokyo-card border border-white/10 rounded-lg px-3 py-2 text-sm">
        <template x-for="cal in writableCalendars" :key="cal.id">
          <option :value="cal.id" x-text="cal.name"></option>
        </template>
      </select>

      <textarea x-model="eventForm.description" placeholder="Description (optional)"
                rows="3"
                class="w-full bg-tokyo-card border border-white/10 rounded-lg px-3 py-2 text-sm"></textarea>
    </div>

    <div class="flex justify-end gap-3 mt-5">
      <button @click="closeEventModal()" class="px-4 py-2 text-sm text-tokyo-muted hover:text-tokyo-text">
        Cancel
      </button>
      <button @click="saveEvent()" class="px-4 py-2 rounded-lg text-sm font-medium"
              style="background: #e07a5f; color: white">
        <span x-text="editingEvent ? 'Save' : 'Create'"></span>
      </button>
    </div>
  </div>
</div>
```

### T6: Event Detail Popover

**File:** `packages/dashboard/public/js/calendar.js`

FullCalendar `eventClick` handler shows popover:

```javascript
eventClick: (info) => {
  app.showEventPopover(info.event, info.el);
}
```

Popover content:
- Event title, time, description
- Calendar color indicator
- "Edit" button → opens modal
- "Delete" button → confirm + delete
- "Ask Nina" button → sets chat context, focuses input

### T7: Chat Context Integration

**File:** `packages/dashboard/public/js/app.js`

Add calendar context:

```javascript
setChatContextFromEvent(event) {
  this.chatContext = {
    type: 'event',
    icon: '📅',
    title: event.title,
    data: { uid: event.id, calendarId: event.extendedProps.calendarId }
  };
}
```

When user sends message with event context, include event details in message payload.

### T8: WebSocket Calendar Refresh

**File:** `packages/dashboard/src/ws/chat-handler.ts`

Detect when Nina creates/modifies calendar events:

```typescript
// After brain response, check for calendar tool use
if (response.toolUse?.includes('calendar_')) {
  ws.send(JSON.stringify({ type: 'calendar_refresh' }));
}
```

**File:** `packages/dashboard/public/js/ws-client.js`

Handle refresh:

```javascript
case 'calendar_refresh':
  if (app.calendar) {
    app.calendar.refetchEvents();
  }
  break;
```

### T9: Calendar Tab Button in Tab Bar

**File:** `packages/dashboard/public/index.html`

Add Calendar as a fixed tab (like Home):

```javascript
// In Alpine data
openTabs: [
  { id: 'home', type: 'home', title: 'Home', icon: '🏠', closeable: false },
  { id: 'calendar', type: 'calendar', title: 'Calendar', icon: '📅', closeable: false }
],
```

### T10: Mini Calendar on Home

**File:** `packages/dashboard/public/index.html`

Add compact calendar widget to Home tab showing upcoming events:

```html
<!-- In Home tab, after Channels section -->
<div class="mt-8">
  <div class="flex items-center justify-between mb-3">
    <h2 class="text-sm font-semibold text-tokyo-muted uppercase tracking-wide">
      Upcoming
    </h2>
    <button @click="switchTab('calendar')"
            class="text-xs text-tokyo-blue hover:underline">
      View calendar
    </button>
  </div>

  <!-- Mini month view (FullCalendar dayGridMonth, compact) -->
  <div class="glass-strong rounded-xl p-4">
    <div x-ref="miniCalendarEl" class="mini-calendar"></div>
  </div>

  <!-- Today's events list -->
  <div class="mt-3 space-y-2">
    <template x-for="event in todayEvents" :key="event.id">
      <button @click="showEventPopover(event)"
              class="w-full flex items-center gap-3 p-2 rounded-lg glass-strong hover:bg-tokyo-card/80 text-left">
        <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: event.color }"></span>
        <span class="text-xs text-tokyo-muted w-12" x-text="formatEventTime(event)"></span>
        <span class="text-sm truncate" x-text="event.title"></span>
      </button>
    </template>
    <template x-if="todayEvents.length === 0">
      <p class="text-sm text-tokyo-muted text-center py-2">No events today</p>
    </template>
  </div>
</div>
```

**Styling:** Compact month grid with small date cells, click date to open full calendar on that day.

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/dashboard/public/js/calendar.js` | FullCalendar init, event handlers |
| `packages/dashboard/public/css/calendar.css` | Catppuccin overrides for FullCalendar |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/dashboard/src/routes/calendar.ts` | CRUD endpoints |
| `packages/dashboard/public/index.html` | Calendar tab, modals, sidebar |
| `packages/dashboard/public/js/app.js` | Calendar state, context integration |
| `packages/dashboard/public/js/ws-client.js` | Calendar refresh handler |
| `packages/dashboard/src/ws/chat-handler.ts` | Emit calendar_refresh on tool use |

---

## Team

| Role | Agent | Tasks |
|------|-------|-------|
| Tech Lead | Opus | T1, T2, T8 (backend + integration) |
| Frontend Dev | Sonnet | T3, T4, T5, T6, T9, T10 (UI) |
| Backend Dev | Sonnet | T7 (context) |
| Reviewer | Opus | Quality gate, security review |

---

## Verification

1. **Calendar loads:** Open Calendar tab, see week view with events
2. **Multi-calendar:** Toggle visibility, colors match config
3. **Create event:** Click date → modal → save → event appears
4. **Drag event:** Move event → PUT request → event persists
5. **Delete event:** Click event → popover → delete → gone
6. **Ask Nina:** Click "Ask Nina" → context badge appears → send message
7. **WebSocket refresh:** Nina creates event via tool → calendar auto-refreshes
8. **Mini calendar:** Home tab shows month widget + today's events list
9. **TypeScript:** `npx tsc --noEmit` passes

---

## Dependencies

- **Upstream:** M4.5-S1 (Radicale running, CalDAVClient working)
- **Downstream:** M4.5-S3 (MCP tools will use same REST API)

---

## Risk: Sprint Size

10 tasks across backend and frontend. If progress stalls:

**Split into S2a + S2b:**
- **S2a: Calendar Display** (T1, T2, T3, T4, T9, T10) — API + calendar views (full + mini)
- **S2b: Event Management** (T5, T6, T7, T8) — CRUD modals, context integration

Review at mid-sprint.

---

## Not in Scope

- Recurring event editing UI (M4.5-S3 or later)
- External calendar sync (Future: calendar channel plugins)
- Mobile-optimized calendar (Future wishlist)
