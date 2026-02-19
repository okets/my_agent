# M5-S2: Task Execution

> **Milestone:** M5 — Task System
> **Sprint:** S2 of 4
> **Status:** Planned
> **Goal:** TaskExecutor with session continuity, CalDAV integration

---

## Overview

Build the execution engine that runs tasks with Agent SDK session continuity. Integrate with CalDAV scheduler so scheduled events create and execute Task entities.

## Deliverables

1. **TaskExecutor** (`packages/core/src/tasks/task-executor.ts`)
   - `run(task)` — execute task with brain query
   - Session continuity via `continue: true` + sessionId
   - Status management (pending → running → completed/failed)
   - Execution log appending
   - Error handling with status = 'failed'

2. **CalDAV integration** (`packages/core/src/scheduler/`)
   - Update CalendarScheduler to create Tasks on event fire
   - `findOrCreate(caldavUid, occurrenceDate)` for recurring tasks
   - Recurring tasks share sessionId (same recurrenceId)
   - Replace direct brain query with TaskExecutor.run()

3. **Session continuity**
   - Load prior execution log for recurring tasks
   - Pass to brain query as context
   - Maintain sessionId across executions

4. **Log compression integration**
   - Trigger compression when log exceeds threshold
   - Reuse conversation compression logic
   - Keep recent executions in full, summarize older

## Technical Approach

### Execution Flow

```
CalendarScheduler.handleEvent(event)
  → TaskManager.findOrCreate(event.uid, occurrence)
    → If recurring + existing: resume with same sessionId
    → Otherwise: create new Task
  → TaskExecutor.run(task)
    → Set status = 'running'
    → Load prior log (if recurring)
    → Brain query with continue: true
    → Append response to log
    → Set status = 'completed' or 'failed'
```

### Session Continuity

```typescript
async run(task: Task): Promise<void> {
  const priorLog = task.recurrenceId
    ? await this.loadPriorExecutions(task.recurrenceId)
    : [];

  const result = await brain.query({
    messages: [...priorLog, { role: 'user', content: task.instructions }],
    sessionId: task.sessionId,
    continue: true
  });

  await this.logStorage.append(task.id, result);
}
```

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Backend Dev | Sonnet | TaskExecutor, CalDAV integration |
| Reviewer | Opus | Session continuity correctness |

## Success Criteria

- [ ] Scheduled events create Task entities
- [ ] TaskExecutor runs with proper status transitions
- [ ] Recurring tasks resume with prior context
- [ ] Execution logs capture full agent response
- [ ] Compression triggers when threshold exceeded

## Risks

| Risk | Mitigation |
|------|------------|
| Session ID mismatch breaks continuity | Test with known recurring task |
| Compression loses important context | Keep last N executions uncompressed |

## Dependencies

- S1: Task entity, TaskManager, log storage
- M4.5: CalendarScheduler infrastructure

---

*Created: 2026-02-20*
