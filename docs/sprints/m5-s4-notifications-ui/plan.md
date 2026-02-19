# M5-S4: Notifications & UI

> **Milestone:** M5 — Task System
> **Sprint:** S4 of 4
> **Status:** Planned
> **Goal:** Comms MCP server, notification routing, dashboard integration

---

## Overview

Build the communication layer for tasks — how Nina notifies about completions, requests input when needed, and respects standing orders. Add dashboard UI for task visibility.

## Deliverables

1. **Comms MCP server** (`packages/core/src/comms/`)
   - `notify(message, importance)` — fire-and-forget status update
   - `request_input(question, options, timeout)` — block for user response
   - `escalate(problem, severity)` — urgent notification
   - Runs as MCP server accessible to brain

2. **Notification routing** (`packages/core/src/notifications/`)
   - Route notifications based on importance + standing orders
   - Channels: dashboard (always), future: WhatsApp/email
   - Check standing orders before sending
   - Real-time delivery via WebSocket

3. **Dashboard: Needs Attention** (`packages/dashboard/`)
   - New section on homepage: tasks awaiting user input
   - Badge/counter for unread notifications
   - Quick response UI for request_input

4. **Dashboard: Execution History**
   - Task detail tab shows execution log
   - Chronological list of runs with timestamps
   - Expandable log entries

5. **WebSocket events**
   - `task:created`, `task:status`, `task:log`
   - `task:needs-attention` with reason
   - Dashboard subscribes to task updates

## Technical Approach

### Comms MCP Tools

```typescript
// notify — non-blocking
notify({
  message: "Completed daily standup prep",
  importance: "info" // info | warning | success
});
// → Routes to dashboard, respects standing orders

// request_input — blocking
const answer = await request_input({
  question: "Should I include last week's metrics?",
  options: ["Yes", "No", "Skip this time"],
  timeout: 30 * 60 * 1000 // 30 minutes
});
// → Shows in "Needs Attention", blocks until response

// escalate — urgent
escalate({
  problem: "Found potential security issue in codebase",
  severity: "high" // low | medium | high | critical
});
// → Immediate notification, all channels
```

### Notification Flow

```
Nina calls notify()
  → NotificationRouter.route(notification)
    → Check standing orders
      → If suppressed: log but don't display
      → If allowed: send via configured channels
    → Dashboard: push via WebSocket
    → Future: WhatsApp/email based on config
```

### Dashboard UI

```
┌─────────────────────────────────────────┐
│ Needs Attention (2)                     │
├─────────────────────────────────────────┤
│ 📋 Daily Standup Prep                   │
│    "Should I include last week's..."    │
│    [Yes] [No] [Skip]                    │
├─────────────────────────────────────────┤
│ ⚠️ Email Processing                     │
│    "Found email from unknown sender..." │
│    [Process] [Ignore] [Ask more]        │
└─────────────────────────────────────────┘
```

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Backend Dev | Sonnet | Comms MCP, notification routing |
| Frontend Dev | Sonnet | Dashboard UI components |
| Reviewer | Opus | Standing order integration, UX review |

## Success Criteria

- [ ] Comms MCP server runs and responds to tools
- [ ] Notifications appear in dashboard real-time
- [ ] Standing orders suppress unwanted notifications
- [ ] "Needs Attention" shows pending requests
- [ ] User can respond to request_input via dashboard
- [ ] Execution history displays in task detail

## Risks

| Risk | Mitigation |
|------|------------|
| WebSocket connection drops | Reconnect with missed event fetch |
| request_input timeout handling | Clear UI state, allow retry |
| Too many notifications | Standing orders + importance filtering |

## Dependencies

- S1: Task entity (for task references)
- S2: TaskExecutor (generates notifications)
- S3: Standing orders (for filtering)
- M2: Dashboard WebSocket infrastructure

---

*Created: 2026-02-20*
