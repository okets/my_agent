# M5-S8: End-to-End Task Flow

> **Milestone:** M5 — Task System
> **Sprint:** S8 of 8
> **Status:** Planned
> **Goal:** Pass two e2e tests proving tasks work end-to-end

---

## Overview

Tie together all M5 components so tasks flow from user request through brain creation to execution and result delivery. The design envisioned this flow but implementation was deferred. This sprint closes the loop.

## E2E Test Cases

### Test 1: Immediate Task

**User input:**
> "We are traveling to Bangkok with a 3 and a 5 YO girls. research must see places to see with kids. send me the list."

**Expected flow:**
1. User sends message in conversation
2. Brain recognizes this as research task (takes time, should run in background)
3. Brain creates immediate task via API
4. Brain responds: "I'll research that for you..."
5. TaskProcessor picks up pending immediate task
6. TaskExecutor runs task (separate brain query)
7. Result posted back to source conversation
8. User sees research results in chat

### Test 2: Scheduled Task

**User input:**
> "in 5 minutes, check if my website is loading https://thinking.homes"

**Expected flow:**
1. User sends message in conversation
2. Brain recognizes this as scheduled task
3. Brain creates scheduled task via API with `scheduledFor: now + 5min`
4. Brain responds: "I'll check that in 5 minutes..."
5. TaskScheduler detects task is due
6. TaskExecutor runs task
7. Result posted back to source conversation
8. User sees website status in chat (5 minutes later)

---

## Gap Analysis

| Gap | Current State | Fix |
|-----|---------------|-----|
| Brain can't create tasks | `task-api.md` skill not loaded (wrong format) | Move to `skills/task-api/SKILL.md` structure |
| Immediate tasks never run | No trigger after creation | TaskProcessor: event-driven on create |
| Scheduled tasks (API) never run | Only CalDAV triggers execution | TaskScheduler: poll for due tasks |
| Results don't reach user | Task completes silently | Post to linked conversation via WebSocket |

---

## Deliverables

### 1. Fix Brain Skill Loading

The brain needs to know HOW to create tasks. Currently `task-api.md` is a flat file but skill loader expects `skills/*/SKILL.md` structure.

**Option A:** Move to subdirectory structure
```
.my_agent/brain/skills/task-api/SKILL.md
```

**Option B:** Update skill loader to also load `*.md` files directly

**Recommendation:** Option B — simpler, backwards compatible, allows both patterns.

**Changes:**
- `packages/core/src/prompt.ts`: Update `loadSkillDescriptions()` to load both `skills/*/SKILL.md` and `skills/*.md`

### 2. TaskProcessor for Immediate Tasks

Execute immediate tasks as soon as they're created.

**Approach:** Event-driven (not polling)

```typescript
// packages/dashboard/src/tasks/task-processor.ts

export class TaskProcessor {
  constructor(
    private taskManager: TaskManager,
    private executor: TaskExecutor,
    private conversationManager: ConversationManager,
  ) {}

  /**
   * Called when a task is created.
   * If immediate, execute now.
   */
  async onTaskCreated(task: Task): Promise<void> {
    if (task.type === 'immediate' && task.status === 'pending') {
      await this.executeAndDeliver(task);
    }
  }

  private async executeAndDeliver(task: Task): Promise<void> {
    const result = await this.executor.run(task);
    await this.deliverResult(task, result);
  }

  private async deliverResult(task: Task, result: ExecutionResult): Promise<void> {
    // Find linked conversation (source)
    const links = this.taskManager.getConversationsForTask(task.id);
    if (links.length === 0) return;

    const conversationId = links[0].conversationId;

    // Post result as assistant message
    await this.conversationManager.appendTurn(conversationId, {
      type: 'turn',
      role: 'assistant',
      content: this.formatResult(task, result),
      timestamp: new Date().toISOString(),
      turnNumber: 0, // Will be set by manager
    });

    // Notify via WebSocket
    this.broadcastResult(conversationId, task, result);
  }
}
```

**Integration:**
- Hook into task creation in routes/tasks.ts
- When `POST /api/tasks` creates an immediate task, call `processor.onTaskCreated(task)`

### 3. TaskScheduler for Scheduled Tasks

Poll for tasks where `scheduledFor <= now` and `status = pending`.

```typescript
// packages/dashboard/src/tasks/task-scheduler.ts

export class TaskScheduler {
  private interval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 30_000; // 30 seconds

  constructor(
    private taskManager: TaskManager,
    private processor: TaskProcessor,
  ) {}

  start(): void {
    this.interval = setInterval(() => this.checkDueTasks(), this.POLL_INTERVAL);
    console.log('[TaskScheduler] Started, polling every 30s');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async checkDueTasks(): Promise<void> {
    const dueTasks = this.taskManager.findDueTasks();

    for (const task of dueTasks) {
      console.log(`[TaskScheduler] Executing due task: ${task.title}`);
      await this.processor.executeAndDeliver(task);
    }
  }
}
```

**TaskManager addition:**
```typescript
findDueTasks(): Task[] {
  const now = new Date();
  const stmt = this.db.prepare(`
    SELECT * FROM tasks
    WHERE type = 'scheduled'
      AND status = 'pending'
      AND scheduled_for IS NOT NULL
      AND datetime(scheduled_for) <= datetime(?)
  `);
  return stmt.all(now.toISOString()).map(this.rowToTask);
}
```

### 4. Result Delivery via WebSocket

When task completes, broadcast to conversation.

```typescript
// New WebSocket event type
interface TaskResultEvent {
  type: 'task:result';
  taskId: string;
  conversationId: string;
  success: boolean;
  response: string;
}
```

**Dashboard receives event:**
- If conversation is active, append message to chat
- Show notification badge if conversation not active

### 5. Brain Guidance Update

Update brain skill to clarify WHEN to create tasks:

```markdown
## When to Create Tasks

Create a task when the user's request:
- Requires research or external lookups (web, files, APIs)
- Should happen at a specific time ("in 5 minutes", "tomorrow at 9am")
- Is complex enough that you want to work on it without blocking the conversation

Do NOT create tasks for:
- Simple questions you can answer immediately
- Quick calculations or lookups
- Conversational responses

## Creating Immediate Tasks

For research or complex work that takes time:

\`\`\`bash
curl -X POST http://localhost:4321/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "immediate",
    "sourceType": "conversation",
    "title": "Research Bangkok attractions for kids",
    "instructions": "Find must-see places in Bangkok suitable for 3 and 5 year old girls. Focus on kid-friendly activities, indoor options for heat, and practical tips.",
    "createdBy": "agent",
    "conversationId": "YOUR_CONVERSATION_ID"
  }'
```

After creating, respond to user: "I'll research that for you and send the results shortly."

## Creating Scheduled Tasks

For time-delayed work:

\`\`\`bash
curl -X POST http://localhost:4321/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "scheduled",
    "sourceType": "conversation",
    "title": "Check website status",
    "instructions": "Check if https://thinking.homes is loading. Report status, response time, and any errors.",
    "createdBy": "agent",
    "scheduledFor": "2026-02-20T14:00:00Z",
    "conversationId": "YOUR_CONVERSATION_ID"
  }'
```

After creating, respond: "I'll check that at [time] and let you know."
```

---

## Architecture

```
User Message
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│ Brain (conversation session)                            │
│                                                         │
│ Recognizes task need → calls POST /api/tasks            │
│ Responds: "I'll work on that..."                        │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ POST /api/tasks                                         │
│                                                         │
│ Creates task with conversationId link                   │
└─────────────────────────┬───────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          │                               │
     type=immediate                  type=scheduled
          │                               │
          ▼                               ▼
┌─────────────────────┐       ┌─────────────────────┐
│ TaskProcessor       │       │ TaskScheduler       │
│ (event-driven)      │       │ (polls every 30s)   │
│                     │       │                     │
│ Executes NOW        │       │ Waits for due time  │
└─────────┬───────────┘       └─────────┬───────────┘
          │                             │
          └──────────────┬──────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ TaskExecutor.run(task)                                  │
│                                                         │
│ - Spawns separate brain query                           │
│ - Logs execution                                        │
│ - Returns result                                        │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Result Delivery                                         │
│                                                         │
│ - Append to source conversation                         │
│ - Broadcast via WebSocket                               │
│ - User sees result in chat                              │
└─────────────────────────────────────────────────────────┘
```

---

## File Changes

| File | Change |
|------|--------|
| `packages/core/src/prompt.ts` | Load `skills/*.md` in addition to `skills/*/SKILL.md` |
| `packages/dashboard/src/tasks/task-processor.ts` | NEW: Event-driven immediate task execution |
| `packages/dashboard/src/tasks/task-scheduler.ts` | NEW: Polls for due scheduled tasks |
| `packages/dashboard/src/tasks/task-manager.ts` | Add `findDueTasks()` method |
| `packages/dashboard/src/routes/tasks.ts` | Hook TaskProcessor on task creation |
| `packages/dashboard/src/index.ts` | Initialize TaskProcessor and TaskScheduler |
| `.my_agent/brain/skills/task-api.md` | Add guidance on WHEN to create tasks |

---

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Backend Dev | Sonnet | TaskProcessor, TaskScheduler, skill loading fix |
| Backend Dev | Sonnet | Result delivery, WebSocket events |
| Reviewer | Opus | E2E test verification, edge cases |

---

## Success Criteria

- [ ] Brain skill `task-api.md` loads into system prompt
- [ ] Immediate task created → executes within seconds
- [ ] Scheduled task created → executes at scheduled time (±30s)
- [ ] Task result appears in source conversation
- [ ] **E2E Test 1 passes:** Bangkok research returns results to chat
- [ ] **E2E Test 2 passes:** Website check runs after 5 minutes

---

## Test Plan

### E2E Test 1: Immediate Task

1. Open dashboard, start conversation
2. Send: "We are traveling to Bangkok with a 3 and a 5 YO girls. research must see places to see with kids. send me the list."
3. Verify:
   - Brain responds acknowledging task
   - Task appears in Tasks list (status: pending → running → completed)
   - Research results appear in conversation

### E2E Test 2: Scheduled Task

1. Open dashboard, start conversation
2. Send: "in 5 minutes, check if my website is loading https://thinking.homes"
3. Verify:
   - Brain responds acknowledging scheduled check
   - Task appears in Tasks list (status: pending, scheduledFor: +5min)
   - Wait 5 minutes
   - Task executes (status: running → completed)
   - Website status appears in conversation

---

## Risks

| Risk | Mitigation |
|------|------------|
| Brain doesn't recognize when to create tasks | Clear skill guidance + examples |
| Immediate task blocks conversation response | Execute async after API response |
| Scheduler misses task due to timing | Poll every 30s, catch up on missed |
| Result delivery fails silently | Log errors, retry once |

---

## Dependencies

- S5: Task REST API (complete)
- S6: Task UI (complete)
- TaskExecutor (complete from S2)

---

*Created: 2026-02-20*
