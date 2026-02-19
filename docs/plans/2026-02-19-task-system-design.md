# Task System Design

> **Status:** Approved
> **Date:** 2026-02-19
> **Scope:** Unified task system for autonomous agentic work

---

## Overview

This design establishes Tasks as first-class entities in the agentic flow. Tasks represent autonomous work units with execution logs, distinct from interactive Conversations.

**Core insight:** The agent does two types of work:
1. **Interactive:** Real-time conversation with user
2. **Autonomous:** Background work triggered by time, events, or commands

Tasks capture autonomous work with full execution history, enabling:
- Audit trails ("what did Nina do at 9am?")
- Continuity for recurring tasks ("continue where you left off")
- User visibility into agent actions
- Conversation context when discussing tasks

---

## Conceptual Model

```
┌─────────────────────────────────────────────────────────────┐
│                        TRIGGERS                             │
│                                                             │
│   Time       Event       Command       Future: Webhook      │
│   (9:00)     (email)     ("do X")      (external)          │
└─────────┬─────────┬─────────┬─────────────┬────────────────┘
          │         │         │             │
          ▼         ▼         ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│                         TASK                                │
│                                                             │
│   A discrete unit of autonomous work with:                  │
│   • Instructions (what to do)                               │
│   • Execution log (what happened)                           │
│   • Status (pending/running/done/failed)                    │
│   • Session ID (for continuity)                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    CONVERSATION                             │
│                                                             │
│   Interactive dialogue. Can be:                             │
│   • Standalone (user just chatting)                         │
│   • Task-bound (discussing a specific task)                 │
│                                                             │
│   When task-bound, agent reads the task's execution log     │
└─────────────────────────────────────────────────────────────┘
```

**Key distinctions:**
- **Tasks** have execution logs (read-only record of what Nina did)
- **Conversations** have transcripts (interactive dialogue)
- Conversations can reference tasks; agent reads task logs for context

---

## Task Entity

```typescript
interface Task {
  // Identity
  id: string;              // task-{ulid}
  type: 'scheduled' | 'immediate';

  // Source reference
  sourceType: 'caldav' | 'conversation' | 'webhook' | 'manual';
  sourceRef?: string;      // CalDAV UID, conversation ID, etc.

  // Content
  title: string;
  instructions: string;    // What Nina should do

  // Execution state
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  sessionId: string;       // For Agent SDK continuity

  // For recurring tasks
  recurrenceId?: string;   // Groups recurring instances
  occurrenceDate?: string; // This specific occurrence

  // Timestamps
  created: Date;
  scheduledFor?: Date;     // When to execute (null for immediate)
  startedAt?: Date;
  completedAt?: Date;

  // Metadata
  createdBy: string;       // 'scheduler' | 'user' | 'agent'
  logPath: string;         // Path to execution log JSONL
}
```

**Design decisions:**
- `sessionId` enables Agent SDK continuity across executions (`continue: true`)
- `recurrenceId` groups all instances of a recurring task (they share session)
- `logPath` points to execution log (same JSONL format as conversations)
- `sourceRef` links back to trigger source (CalDAV UID, conversation ID)

---

## Storage

**Location:** `.my_agent/tasks/logs/` for execution logs

**Database:** `agent.db` (renamed from `conversations.db`)

Rationale for same database:
- Foreign keys between tasks and conversations
- Single connection to manage
- Natural queries: "tasks related to this conversation"

**Schema:**

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT NOT NULL,
  recurrence_id TEXT,
  occurrence_date TEXT,
  scheduled_for TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_by TEXT NOT NULL,
  log_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_recurrence ON tasks(recurrence_id);
CREATE INDEX idx_tasks_source ON tasks(source_type, source_ref);
```

**Execution logs:** Same `TranscriptLine` format as conversations, stored in `.my_agent/tasks/logs/{task-id}.jsonl`. Enables reuse of compression logic.

---

## Execution Flow

### Scheduled Task Fires

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. CalendarScheduler detects event time arrived                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. TaskManager.findOrCreate(caldavUid, occurrenceDate)         │
│    - If recurring task exists for this recurrenceId: resume    │
│    - Otherwise: create new Task with new sessionId             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. TaskExecutor.run(task)                                      │
│    - Set status = 'running'                                    │
│    - Load prior execution log (for session continuity)         │
│    - Spawn brain query with continue: true                     │
│    - Append response to execution log                          │
│    - Set status = 'completed' (or 'failed')                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Log compression check                                       │
│    - If log exceeds threshold, trigger compression             │
└─────────────────────────────────────────────────────────────────┘
```

### Immediate Task Created

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User in conversation: "Nina, research X and summarize"      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Agent recognizes this as task creation                      │
│    - Creates Task with type='immediate', sourceRef=convId      │
│    - Responds: "I've created task 'Research X'. I'll work on   │
│      this and update you when done."                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. TaskExecutor.run(task) — same execution flow                │
│    - User can continue conversation while task runs            │
│    - When done, agent messages back in source conversation     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Session Continuity

### Recurring Tasks

Recurring tasks (e.g., "daily standup prep") share a single `sessionId`. Each occurrence appends to the same session, so the agent sees full history of prior runs.

**Context management:** Same compression approach as conversations:
- After threshold (10 executions or 50k tokens), trigger compression
- Older executions summarized, recent executions in full
- Agent sees: summary of older work + full recent executions

### Why Same Session?

User requirement: "I want Nina to continue where she left off."
- User can give corrections mid-task
- Recurring tasks build on prior context
- Agent remembers what it did yesterday

---

## Task-Conversation Binding

### How Conversations Reference Tasks

```typescript
// In TranscriptTurn, optional task reference
interface TranscriptTurn {
  // ... existing fields ...

  taskRef?: {
    taskId: string;
    action: 'created' | 'updated' | 'discussed' | 'completed';
  };
}
```

### Agent Access to Task Logs

**Hybrid approach (recommended):**
- When task is referenced, inject recent execution summary into context
- Agent can use `read_task_log` tool for full details if needed
- Matches conversation model (recent turns + compression summary)

---

## Notification Model

| Task Type | Notification |
|-----------|--------------|
| **Immediate** | Report back in source conversation |
| **Scheduled** | Dashboard badge + "Needs attention" section |

### Immediate Tasks

Natural flow — task was created in a conversation, results return there.

### Scheduled Tasks

No active conversation context. User checks dashboard when convenient.

**MVP:**
- Dashboard badge when tasks need attention
- "Needs attention" section on homepage
- Task reports go to "Scheduled Events" conversation

**Future sprint (notification preferences):**
- User-configurable notification channel
- Options: WhatsApp, Slack, browser push, mobile push
- Preference stored in user settings

---

## Dashboard UI

### Scheduled Tasks (existing detail tab)

```
┌─────────────────────────────────────────┐
│ Task: Daily Standup Prep                │
│ Time: 09:00 - 09:15                     │
│ Calendar: user                          │
│ Status: completed ✓                     │  ← NEW
├─────────────────────────────────────────┤
│ [Edit] [Ask Nina] [Delete]              │
├─────────────────────────────────────────┤
│ Instructions                            │
│ ┌─────────────────────────────────────┐ │
│ │ Prepare standup notes based on...  │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ ▼ Execution History                     │  ← NEW
│                                         │
│ Feb 19, 09:01 • completed               │
│ ┌─────────────────────────────────────┐ │
│ │ I've prepared your standup notes   │ │
│ │ based on yesterday's commits...    │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Feb 18, 09:02 • completed               │
│ ┌─────────────────────────────────────┐ │
│ │ Here's your standup summary...     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Load more...]                          │
└─────────────────────────────────────────┘
```

### Immediate Tasks (new Tasks list)

New "Tasks" panel showing active/recent tasks:
- Status indicator
- Title + creation time
- "Resume Conversation" button
  - Opens the conversation that triggered the task
  - If conversation deleted: creates new conversation with task reference

---

## API Endpoints

### Task Management (Debug/Admin API)

```typescript
POST   /api/debug/tasks                 // Create immediate task
GET    /api/debug/tasks                 // List tasks (filter by status, type)
GET    /api/debug/tasks/:id             // Get task details
GET    /api/debug/tasks/:id/log         // Get execution log
PATCH  /api/debug/tasks/:id             // Update task (pause, cancel)
DELETE /api/debug/tasks/:id             // Delete task
```

### Dashboard API

```typescript
GET    /api/tasks                       // List tasks (user-facing)
GET    /api/tasks/needs-attention       // Tasks awaiting user input
GET    /api/tasks/:id                   // Task detail + recent log
```

### WebSocket Events

```typescript
{ type: 'task:created', task: Task }
{ type: 'task:status', taskId: string, status: TaskStatus }
{ type: 'task:log', taskId: string, turn: TranscriptTurn }
{ type: 'task:needs-attention', taskId: string, reason: string }
```

---

## Implementation Scope

### MVP (M4.5-S3 or M5-S1)

1. Task entity and storage (SQLite table, rename to agent.db)
2. TaskManager (create, find, update, list)
3. TaskExecutor (run with session continuity)
4. CalendarScheduler integration (create Task on fire)
5. Execution logs (JSONL, compression)
6. Dashboard: execution history in task detail tab
7. Dashboard: "Needs attention" section

### Future Sprints

1. **Immediate tasks:** Agent creates tasks from conversation
2. **Tasks list:** New dashboard panel for non-scheduled tasks
3. **Notification preferences:** User-configurable notification channels
4. **Additional triggers:** Webhooks, email rules, channel events

---

## Migration Notes

### Database Rename

`conversations.db` → `agent.db`

Migration:
1. Add `tasks` table to existing database
2. Rename file
3. Update all connection paths

### Event Handler Changes

Current `event-handler.ts` logs to "Scheduled Events" conversation.

New flow:
1. Create/resume Task
2. Execute via TaskExecutor
3. Log to task's execution log
4. Optionally notify via conversation (if task needs attention)

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Session ID management complexity | Medium | Clear ownership: TaskManager creates, TaskExecutor uses |
| Context growth for long-running recurring tasks | High | Same compression as conversations, proven approach |
| Agent confusion: task vs. conversation | Medium | Clear system prompt instructions, task context injection |
| Database migration breaks existing conversations | High | Migration script with backup, test thoroughly |

---

## Dependencies

- Agent SDK `continue: true` support (confirmed working)
- Existing compression logic (reusable)
- CalDAV event UID access (already available)
- WebSocket infrastructure (already in place)

---

## Related Documents

- [Scheduled Tasks Design](../design/scheduled-tasks.md)
- [Conversation System Design](../design/conversations.md)
- [Self-Evolving Infrastructure](../design/self-evolving-infrastructure.md)
- [Debug API Spec](../design/debug-api.md)

---

*Created: 2026-02-19*
