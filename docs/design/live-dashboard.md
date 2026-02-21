# Live Dashboard Design

> **Milestone:** M5.5
> **Status:** Design Complete
> **Dependencies:** M5 (Task System)

## Context

The dashboard currently requires manual refresh to see state changes. For kiosk displays and general UX, we need **live data binding** — backend pushes state, frontend auto-renders.

| Screen | Current Behavior | Issue |
|--------|------------------|-------|
| Tasks | REST poll after events | Stale until refresh |
| Calendar | Load once at init | No multi-tab sync |
| Conversations | Gets renames only | Missing create/delete |
| Connection | Silent reconnect | No visual feedback |

## Design Decision

**Data binding via state push** (not event-based):
- Backend pushes full state arrays on changes
- Frontend Alpine stores receive state
- UI reactively renders from stores
- No per-field event handlers to maintain

### Why Not Event-Based?

| Aspect | Event-based | Data binding |
|--------|-------------|--------------|
| New fields | Add event + handler | Just works |
| Bandwidth | Sends deltas only | Sends full state |
| Complexity | Grows with events | Stays constant |
| Consistency | Can drift | Always in sync |

Event-based requires a handler per mutation type. As the system grows, this becomes maintenance burden. Data binding pushes the full state — the UI always reflects truth.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Backend                                                  │
│                                                          │
│  Any state change ──► StatePublisher.publish('topic')   │
│                       └──► broadcastToAll(state)        │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────┐
│ Frontend                                                 │
│                                                          │
│  ws.on('state:*') ──► Alpine.store(topic).items = data  │
│                              │                           │
│  <template x-for="item in $store.topic.items">          │
│    (auto-updates)                                        │
└─────────────────────────────────────────────────────────┘
```

## Components

### StatePublisher Service (Backend)

New service at `packages/dashboard/src/state/state-publisher.ts`:

- Wraps `connectionRegistry.broadcastToAll()`
- Methods: `publishTasks()`, `publishCalendar()`, `publishConversations()`
- Called after any CRUD operation on tasks, calendar events, or conversations
- `publishAllTo(socket)` for initial state on new connections

### Alpine Stores (Frontend)

Replace monolithic `data()` with reactive stores:

- `Alpine.store('tasks', { items: [], loading: false })`
- `Alpine.store('calendar', { events: [], configs: [] })`
- `Alpine.store('conversations', { items: [] })`
- `Alpine.store('connection', { status: 'connected' | 'reconnecting' | 'offline' })`

### WebSocket Message Types

Add to `protocol.ts`:

- `state:tasks` — full task array
- `state:calendar` — full calendar events array
- `state:conversations` — full conversation metadata array

Each includes `timestamp` for ordering.

### Connection State UI

Visual indicator in header:
- **Connected** — Green dot (subtle)
- **Reconnecting** — Yellow pulsing indicator
- **Offline** — Red indicator with reconnect button

## Gap Analysis

| Component | Current State | Gap | Effort |
|-----------|--------------|-----|--------|
| Frontend state | Single data() object | Alpine stores | Medium |
| WebSocket protocol | Chat + conversation messages | Add state types | Low |
| Calendar broadcasts | No broadcasts | Add after CRUD | Medium |
| Task broadcasts | Partial (conversation-linked) | Extend all mutations | Medium |
| Connection status | Tracked but not displayed | Add UI indicator | Low |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Event storms on bulk ops | Debounce publishes (100ms batch window) |
| Race conditions | Timestamp on messages; frontend uses latest |
| Large state payloads | Acceptable at current scale; add pagination later |

## Acceptance Tests

### Primary: Task Result Delivery

**Current bug:** When Nina executes an immediate task, the result message is delivered via `chat:turn` WebSocket event but doesn't appear in the chat until manual refresh.

**Test flow:**
1. Ask Nina to create an immediate task (e.g., "remind me to check email")
2. Nina responds "creating task" (streams, visible)
3. Task executes, result delivered to conversation
4. **Expected:** Result message appears immediately without refresh
5. **Current:** Result only appears after manual refresh

**Root cause:** Event-based handler for `chat:turn` doesn't properly update the reactive UI. Data binding fixes this by pushing full conversation state.

### Secondary: Multi-Tab Sync

- Open dashboard in two tabs
- Create/complete task in one tab
- Other tab updates automatically

### Tertiary: Connection Resilience

- Disconnect network briefly
- Visual indicator shows "Reconnecting..."
- On reconnect, state syncs and indicator clears

## Out of Scope

- Delta updates (full state push is fine at current scale)
- Per-topic subscriptions (all clients get all state)
- Offline queue (requires service worker)

---

_Created: 2026-02-20_
