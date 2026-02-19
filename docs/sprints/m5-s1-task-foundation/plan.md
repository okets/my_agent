# M5-S1: Task Foundation

> **Milestone:** M5 — Task System
> **Sprint:** S1 of 4
> **Status:** Planned
> **Goal:** Task entity, storage, and database migration

---

## Overview

Establish Tasks as first-class entities in the system. This sprint creates the data model, storage layer, and migrates from `conversations.db` to `agent.db`.

## Deliverables

1. **Task entity interface** (`packages/core/src/tasks/types.ts`)
   - Task interface matching design spec
   - TaskStatus enum: pending, running, completed, failed, paused
   - TaskType: scheduled, immediate
   - SourceType: caldav, conversation, webhook, manual

2. **Database migration** (`packages/core/src/db/`)
   - Rename `conversations.db` → `agent.db`
   - Add `tasks` table with indexes
   - Migration script with rollback capability
   - Update all connection paths

3. **TaskManager** (`packages/core/src/tasks/task-manager.ts`)
   - `create(task)` — create new task
   - `findById(id)` — get task by ID
   - `findByRecurrence(recurrenceId)` — find recurring task instances
   - `update(id, changes)` — update task status/fields
   - `list(filters)` — list tasks with status/type filters
   - Session ID generation for Agent SDK continuity

4. **Execution log storage** (`packages/core/src/tasks/log-storage.ts`)
   - Log path: `.my_agent/tasks/logs/{task-id}.jsonl`
   - Same TranscriptLine format as conversations
   - `append(taskId, turn)` — append execution log entry
   - `read(taskId, options)` — read log with pagination

## Technical Approach

### Database Schema

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

### Migration Strategy

1. Check if `conversations.db` exists
2. If yes: add `tasks` table, then rename file
3. If no: create fresh `agent.db` with both tables
4. Update imports in conversation-store.ts

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Backend Dev | Sonnet | Task entity, TaskManager, migration |
| Reviewer | Opus | Schema review, migration safety |

## Success Criteria

- [ ] Task entity interface matches design spec
- [ ] Database migration completes without data loss
- [ ] TaskManager CRUD operations work
- [ ] Execution logs write and read correctly
- [ ] Existing conversation functionality unaffected

## Risks

| Risk | Mitigation |
|------|------------|
| Migration corrupts conversation data | Backup before migration, rollback script |
| Session ID collision | Use ULID for uniqueness |

## Dependencies

- M4.5 CalDAV UID access (already available)
- Existing conversation JSONL format (reuse)

---

*Created: 2026-02-20*
