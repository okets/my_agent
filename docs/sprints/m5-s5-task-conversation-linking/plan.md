# M5-S5: Task-Conversation Linking

> **Milestone:** M5 — Task System
> **Sprint:** S5 of 5
> **Status:** Planned
> **Goal:** Link tasks to conversations, Task REST API, brain context injection

---

## Overview

Connect the task system to conversations, enabling full traceability between user interactions and task actions. Add soft delete for tasks, build a complete REST API for task management, and inject conversation context into the brain so it can associate actions with conversations.

## Deliverables

### Phase 1: Schema & Storage Foundation

1. **Soft delete support** (`packages/core/src/tasks/`)
   - Add `'deleted'` to TaskStatus union in types.ts
   - Add `deletedAt?: Date` to Task type
   - Add `deleted_at TEXT` column migration in ConversationDatabase.initialize()
   - Update TaskManager.delete() to set status='deleted' and deleted_at
   - Update TaskManager.list() to exclude deleted by default, add `includeDeleted` filter option

2. **Task-conversation junction table**
   ```sql
   CREATE TABLE IF NOT EXISTS task_conversations (
     task_id TEXT NOT NULL,
     conversation_id TEXT NOT NULL,
     linked_at TEXT NOT NULL,
     PRIMARY KEY (task_id, conversation_id)
   );
   ```

3. **Linking methods** (`packages/core/src/tasks/task-manager.ts`)
   - `linkTaskToConversation(taskId, conversationId)` — create link
   - `getConversationsForTask(taskId)` — get all linked conversations
   - `getTasksForConversation(conversationId)` — get all linked tasks

### Phase 2: Task REST API

Create `packages/dashboard/src/routes/tasks.ts`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tasks` | GET | List tasks with filter support |
| `/api/tasks/:id` | GET | Get single task by ID |
| `/api/tasks/:id/conversations` | GET | Get conversations linked to task |
| `/api/conversations/:id/tasks` | GET | Get tasks linked to conversation |
| `/api/tasks` | POST | Create task (optional conversationId → auto-link) |
| `/api/tasks/:id` | PATCH | Update task (optional conversationId → auto-link) |
| `/api/tasks/:id/complete` | POST | Mark task complete (optional conversationId → auto-link) |
| `/api/tasks/:id` | DELETE | Soft delete task (optional conversationId → auto-link) |

**API behavior:**
- Only write operations (POST, PATCH, DELETE) create links
- Read operations (GET) do not create links
- `conversationId` is optional in request body
- Register routes in server.ts
- Add endpoints to `/api/debug/api-spec`

### Phase 3: ConversationId Injection

Update brain context assembly to inject conversation ID:

```
Current conversation ID: conv-{id}
```

- Location: `packages/core/src/session-manager.ts` or context assembly
- Only inject when conversationId is known
- Brain uses this to include conversationId in task API calls

### Phase 4: Brain Documentation

Update brain skills/operating-rules to document task API usage:

1. **New skill file:** `.my_agent/brain/skills/task-api.md`
   - Document all REST endpoints
   - Show curl examples for each operation
   - Explain when to include conversationId

2. **Integration guidance:**
   - Brain uses curl to call task endpoints
   - Include conversationId when task action originates from or is relevant to current conversation
   - Examples: user requests task creation, user asks about task status, user completes a task

## Technical Approach

### Soft Delete Flow

```
TaskManager.delete(taskId)
  → Set status = 'deleted'
  → Set deleted_at = now()
  → Task remains in database (audit trail)

TaskManager.list({ includeDeleted: false })  // default
  → SELECT ... WHERE status != 'deleted'

TaskManager.list({ includeDeleted: true })
  → SELECT ... (no status filter for deleted)
```

### Link Creation Pattern

```
POST /api/tasks
  body: { title, instructions, conversationId? }
  → TaskManager.create(...)
  → If conversationId: linkTaskToConversation(taskId, conversationId)
  → Return task

PATCH /api/tasks/:id
  body: { status?, conversationId? }
  → TaskManager.update(...)
  → If conversationId: linkTaskToConversation(taskId, conversationId)
  → Return updated task
```

### Brain Context Injection

```typescript
// session-manager.ts or prompt assembly
if (conversationId) {
  systemPrompt += `\n\nCurrent conversation ID: ${conversationId}`;
}
```

### No FK Constraints (Design Decision)

- Junction table uses soft references, not foreign keys
- Graceful degradation: if task or conversation deleted, link remains but queries handle missing entities
- Simplifies migration and avoids constraint conflicts

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Backend Dev | Sonnet | Schema changes, TaskManager methods, REST API |
| Frontend Dev | Sonnet | API integration (if dashboard updates needed) |
| Reviewer | Opus | API design review, security check |

## Success Criteria

- [ ] TaskStatus includes 'deleted', Task has deletedAt field
- [ ] task_conversations table created with migration
- [ ] Soft delete works: deleted tasks excluded from default list
- [ ] All 8 REST endpoints functional
- [ ] Link creation works on write operations
- [ ] conversationId injected into brain system prompt
- [ ] Brain documentation updated with curl examples
- [ ] Endpoints registered in /api/debug/api-spec

## Risks

| Risk | Mitigation |
|------|------------|
| Circular dependency: brain calls API, API uses brain | API is stateless, no brain import needed |
| Orphaned links after hard delete | Only soft delete implemented; links preserved |
| conversationId missing in brain context | Clear documentation; brain checks before using |

## Dependencies

- S1: Task entity, TaskManager (foundation)
- S2: TaskExecutor (status transitions)
- S4: Notification routing (optional integration)
- M2: REST API patterns, server.ts structure

---

*Created: 2026-02-20*
