# M5-S10: Live Dashboard

> **Milestone:** M5 — Task System
> **Sprint:** S10 of 10 (final sprint)
> **Status:** Planned
> **Goal:** Task results appear without refresh — state push via WebSocket, reactive Alpine stores
> **Design Spec:** [live-dashboard.md](../../design/live-dashboard.md)

---

## Problem

When Nina executes a task, the result is delivered via `chat:turn` WebSocket event but doesn't appear in the chat until manual refresh. The current event-based approach requires a handler per mutation type — as the system grows, this becomes maintenance burden.

**Root cause:** Event-based handlers don't properly update the reactive UI. Data binding (full state push) fixes this.

## Solution

**Data binding via state push:**
- Backend pushes full state arrays on changes
- Frontend Alpine stores receive state
- UI reactively renders from stores
- No per-field event handlers to maintain

---

## User Story

**Given:** User asks Nina to create an immediate task (e.g., "remind me to check email")
**When:** Task executes and result is delivered
**Then:** Result message appears immediately in chat without refresh

**Secondary:**
- Open dashboard in two tabs → create task in one → other tab updates automatically
- Network disconnect → visual indicator shows "Reconnecting..." → state syncs on reconnect

---

## Implementation Tasks

### 1. StatePublisher Service (Backend)

**File:** `packages/dashboard/src/state/state-publisher.ts` (new)

Create service that wraps `connectionRegistry.broadcastToAll()`:

```typescript
interface StatePublisher {
  publishTasks(): Promise<void>       // Broadcast all tasks
  publishCalendar(): Promise<void>    // Broadcast all calendar events
  publishConversations(): Promise<void> // Broadcast conversation metadata
  publishAllTo(socket: WebSocket): Promise<void> // Initial state for new connection
}
```

- Called after any CRUD operation on tasks, calendar events, or conversations
- Debounce publishes (100ms batch window) to prevent event storms

### 2. WebSocket Protocol Extension

**File:** `packages/dashboard/src/ws/protocol.ts`

Add state message types:

```typescript
type StateMessage =
  | { type: 'state:tasks'; tasks: Task[]; timestamp: number }
  | { type: 'state:calendar'; events: CalendarEvent[]; timestamp: number }
  | { type: 'state:conversations'; conversations: ConversationMetadata[]; timestamp: number }
```

### 3. Alpine Stores (Frontend)

**File:** `packages/dashboard/public/js/stores.js` (new)

Replace monolithic `data()` with reactive stores:

```javascript
Alpine.store('tasks', { items: [], loading: false })
Alpine.store('calendar', { events: [], configs: [] })
Alpine.store('conversations', { items: [] })
Alpine.store('connection', { status: 'connected' }) // 'connected' | 'reconnecting' | 'offline'
```

### 4. WebSocket Client Update

**File:** `packages/dashboard/public/js/ws-client.js`

Add handlers for state messages:

```javascript
case 'state:tasks':
  Alpine.store('tasks').items = message.tasks
  break
case 'state:conversations':
  Alpine.store('conversations').items = message.conversations
  break
```

### 5. Hook StatePublisher into CRUD Operations

**Files to modify:**
- `packages/dashboard/src/tasks/task-manager.ts` — call `statePublisher.publishTasks()` after create/update/delete
- `packages/dashboard/src/routes/tasks.ts` — ensure POST/PUT/DELETE trigger publish
- `packages/dashboard/src/ws/chat-handler.ts` — publish after conversation changes
- `packages/dashboard/src/scheduler/calendar-scheduler.ts` — publish after calendar sync

### 6. Connection Status UI

**File:** `packages/dashboard/public/index.html`

Add visual indicator in header:
- **Connected** — Green dot (subtle)
- **Reconnecting** — Yellow pulsing indicator
- **Offline** — Red indicator with reconnect button

### 7. Initial State on Connect

**File:** `packages/dashboard/src/ws/chat-handler.ts`

On new WebSocket connection, call `statePublisher.publishAllTo(socket)` to send current state.

---

## File Changes Summary

| File | Change |
|------|--------|
| `packages/dashboard/src/state/state-publisher.ts` | **NEW** — StatePublisher service |
| `packages/dashboard/src/ws/protocol.ts` | Add `state:*` message types |
| `packages/dashboard/public/js/stores.js` | **NEW** — Alpine stores |
| `packages/dashboard/public/js/ws-client.js` | Handle state messages, update stores |
| `packages/dashboard/public/index.html` | Connection status UI, use stores |
| `packages/dashboard/src/tasks/task-manager.ts` | Call statePublisher after mutations |
| `packages/dashboard/src/routes/tasks.ts` | Ensure publish on CRUD |
| `packages/dashboard/src/ws/chat-handler.ts` | Publish on conversation changes, initial state |
| `packages/dashboard/src/scheduler/calendar-scheduler.ts` | Publish after calendar sync |

---

## Success Criteria

- [ ] Task result appears in chat immediately without refresh
- [ ] StatePublisher broadcasts full state after mutations
- [ ] Alpine stores receive and render state reactively
- [ ] Multi-tab sync works (change in one tab appears in other)
- [ ] Connection status indicator shows connected/reconnecting/offline
- [ ] Initial state sent on new WebSocket connection
- [ ] No event handler maintenance burden — just state push

---

## Out of Scope

- Delta updates (full state push is fine at current scale)
- Per-topic subscriptions (all clients get all state)
- Offline queue (requires service worker)
- Navigable Timeline UI redesign (deferred to future work)

---

## Risks

| Risk | Mitigation |
|------|------------|
| Event storms on bulk ops | Debounce publishes (100ms batch window) |
| Race conditions | Timestamp on messages; frontend uses latest |
| Large state payloads | Acceptable at current scale; add pagination later |
| Breaking existing handlers | Keep existing event handlers alongside state push during transition |

---

## Dependencies

- S9: Work + Deliverable (complete — task execution works)
- Design spec: [live-dashboard.md](../../design/live-dashboard.md)

---

*Created: 2026-02-22*
