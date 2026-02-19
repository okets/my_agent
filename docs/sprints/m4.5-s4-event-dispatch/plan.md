# M4.5-S4: Event Dispatch

> **Status:** Complete
> **Started:** 2026-02-19
> **Completed:** 2026-02-19
> **Mode:** Overnight Sprint (Autonomous)
> **Dependencies:** M4.5-S3 (CalendarScheduler)

---

## Context

S3 delivered CalendarScheduler that polls and fires events, but `onEventFired` only logs. This sprint closes the loop: when an event fires, spawn a brain query so Nina can respond.

**Goal:** Calendar event fires → Nina wakes up → handles it (notify, act, or acknowledge).

---

## Design

### Flow

```
Event time arrives
       │
       ▼
CalendarScheduler.poll()
       │
       ▼
onEventFired(event)
       │
       ▼
spawnEventQuery(event)
       │
       ├─► Create/resume "scheduler" conversation
       │
       ├─► Inject event into system prompt
       │
       ▼
Brain responds
       │
       ├─► Log response
       │
       └─► (Future: route to channel if event.notify is set)
```

### Event Context Injection

Add event context block to system prompt:

```markdown
## Triggered Event

A calendar event just fired. Review and take appropriate action.

**Event:** {title}
**Time:** {start} - {end}
**Calendar:** {calendarId}
**Description:** {description}
**Action:** {action} (if set)

Respond naturally. If this is a reminder, inform the user. If it has an action field, execute it.
```

### Conversation Strategy

Use a dedicated "scheduler" conversation for event-triggered queries:
- Channel: `system` (internal)
- Conversation ID: `scheduler-events`
- Persisted like normal conversations (for audit trail)
- Each event = one turn in ongoing conversation

---

## Tasks

| ID | Task | Owner | Status |
|----|------|-------|--------|
| T1 | Create `spawnEventQuery()` function | Backend | Done |
| T2 | Add event context to prompt assembly | Backend | Done |
| T3 | Wire scheduler to use `spawnEventQuery` | Backend | Done |
| T4 | Test: create event → fire → brain responds | QA | Done |

---

## Files to Modify

| File | Action |
|------|--------|
| `packages/dashboard/src/scheduler/event-handler.ts` | **New:** Event dispatch logic |
| `packages/core/src/prompt.ts` | Add `eventContext` option to `assembleSystemPrompt` |
| `packages/dashboard/src/index.ts` | Wire new handler to scheduler |

---

## Implementation Details

### T1: spawnEventQuery()

```typescript
// packages/dashboard/src/scheduler/event-handler.ts

import { createBrainQuery, assembleSystemPrompt } from "@my-agent/core";

export async function spawnEventQuery(
  event: CalendarEvent,
  conversationManager: ConversationManager,
  agentDir: string,
): Promise<void> {
  // Get or create scheduler conversation
  const convId = "scheduler-events";
  let conversation = await conversationManager.get(convId);
  if (!conversation) {
    conversation = await conversationManager.create({
      id: convId,
      channelId: "system",
      title: "Scheduled Events",
    });
  }

  // Build prompt with event context
  const systemPrompt = await assembleSystemPrompt(agentDir, {
    eventContext: {
      title: event.title,
      start: event.start.toISOString(),
      end: event.end?.toISOString(),
      calendarId: event.calendarId,
      description: event.description,
      action: event.action,
    },
  });

  // Spawn brain query
  const brain = createBrainQuery({
    systemPrompt,
    conversationId: convId,
  });

  const message = `Calendar event fired: "${event.title}"`;

  for await (const chunk of brain.query(message)) {
    // Log streaming response
    if (chunk.type === "text") {
      process.stdout.write(chunk.text);
    }
  }

  console.log("\n[Scheduler] Event handled");
}
```

### T2: Prompt Assembly

Add optional `eventContext` to `AssemblePromptOptions`:

```typescript
// In packages/core/src/prompt.ts

interface AssemblePromptOptions {
  // ... existing options
  eventContext?: {
    title: string;
    start: string;
    end?: string;
    calendarId: string;
    description?: string;
    action?: string;
  };
}

// In assembleSystemPrompt():
if (options.eventContext) {
  sections.push(formatEventContext(options.eventContext));
}
```

### T3: Wire Handler

```typescript
// In packages/dashboard/src/index.ts

import { spawnEventQuery } from "./scheduler/event-handler.js";

// When creating scheduler:
calendarScheduler = new CalendarScheduler(caldavClient, {
  pollIntervalMs: 60_000,
  lookAheadMinutes: 5,
  onEventFired: (event) => spawnEventQuery(event, conversationManager, agentDir),
  firedEventsPath: `${agentDir}/runtime/fired-events.json`,
});
```

---

## Verification

1. Create event 2 min in future:
   ```bash
   curl -X POST http://localhost:4321/api/calendar/events \
     -H "Content-Type: application/json" \
     -d '{"calendarId": "user", "title": "Test Reminder", "start": "2026-02-19T03:00:00", "description": "Remember to check the logs"}'
   ```

2. Watch server logs for brain response

3. Check `/api/debug/scheduler/status` shows firedCount=1

4. Verify conversation exists:
   ```bash
   curl http://localhost:4321/api/conversations/scheduler-events
   ```

---

## User Stories

### US1: Reminder Event
1. Create event: "Call Mom" at 3pm
2. At 3pm, scheduler fires
3. Nina responds: "Reminder: It's time to call Mom"
4. Response logged to scheduler-events conversation

### US2: Action Event
1. Create event with `action: "daily-summary"`
2. Event fires
3. Nina sees action field, executes daily summary logic
4. (For MVP: logs "daily-summary action triggered")

---

## Out of Scope

- Channel routing (send reminder to WhatsApp) — future enhancement
- Push notifications to UI — future enhancement
- Concurrent event handling — events processed sequentially for now

---

*Plan created: 2026-02-19*
