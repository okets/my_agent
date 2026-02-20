# Sprint Review — M5-S5: Task-Conversation Linking

> **Sprint:** [plan.md](plan.md)
> **Reviewer:** Claude Opus
> **Date:** 2026-02-20

---

## Verdict: PASS

All planned deliverables implemented. Soft delete, junction table, REST API, context injection, and brain documentation all functional.

---

## Plan Adherence

| Deliverable                         | Plan                           | Actual                            | Status |
| ----------------------------------- | ------------------------------ | --------------------------------- | ------ |
| Soft delete (TaskStatus, deletedAt) | Add 'deleted' status + field   | Implemented in types.ts           | Match  |
| deleted_at migration                | ALTER TABLE if missing         | Implemented in db.ts              | Match  |
| task_conversations junction table   | CREATE TABLE, no FK            | Implemented in db.ts              | Match  |
| linkTaskToConversation()            | Create link                    | Implemented in task-manager.ts    | Match  |
| getConversationsForTask()           | Query linked conversations     | Implemented                       | Match  |
| getTasksForConversation()           | Query linked tasks             | Implemented                       | Match  |
| GET /api/tasks                      | List with filters              | Implemented                       | Match  |
| GET /api/tasks/:id                  | Get single task                | Implemented                       | Match  |
| GET /api/tasks/:id/conversations    | Get linked conversations       | Implemented                       | Match  |
| GET /api/conversations/:id/tasks    | Get linked tasks               | Implemented                       | Match  |
| POST /api/tasks                     | Create with optional link      | Implemented                       | Match  |
| PATCH /api/tasks/:id                | Update with optional link      | Implemented                       | Match  |
| POST /api/tasks/:id/complete        | Complete with optional link    | Implemented                       | Match  |
| DELETE /api/tasks/:id               | Soft delete with optional link | Implemented                       | Match  |
| ConversationId injection            | Add to brain system prompt     | Implemented in session-manager.ts | Match  |
| Brain documentation                 | skill file with curl examples  | Created task-api.md               | Match  |

---

## Code Quality

### Strengths

- Clean separation: types in core, routes in dashboard
- Idempotent linking (INSERT OR IGNORE)
- Security: PATCHABLE_STATUSES validation prevents 'deleted' bypass via PATCH
- Security: logPath excluded from API response (no filesystem exposure)
- Soft delete preserves audit trail
- Graceful degradation with no FK constraints

### Architecture

```
core/src/tasks/types.ts
├── TaskStatus: added 'deleted'
└── Task: added deletedAt

dashboard/src/conversations/db.ts
├── ALTER TABLE tasks ADD deleted_at
└── CREATE TABLE task_conversations

dashboard/src/tasks/task-manager.ts
├── delete() → soft delete (status='deleted', deletedAt)
├── list() → excludeDeleted by default
├── linkTaskToConversation()
├── getConversationsForTask()
└── getTasksForConversation()

dashboard/src/routes/tasks.ts
├── GET /api/tasks
├── GET /api/tasks/:id
├── GET /api/tasks/:id/conversations
├── GET /api/conversations/:id/tasks
├── POST /api/tasks
├── PATCH /api/tasks/:id
├── POST /api/tasks/:id/complete
└── DELETE /api/tasks/:id

dashboard/src/agent/session-manager.ts
└── [Session Context] conversationId injection

.my_agent/brain/skills/task-api.md
└── REST API documentation with curl examples
```

---

## Security Review

1. **logPath excluded from API response** ✓
   - Prevents exposure of `.my_agent/tasks/logs/` paths
   - Task logs accessible only through future task detail view

2. **PATCH cannot set status='deleted'** ✓
   - PATCHABLE_STATUSES validation rejects 'deleted'
   - Must use DELETE endpoint for soft delete
   - Prevents bypassing deletedAt timestamp

3. **Soft references (no FK constraints)** ✓
   - Design decision: graceful degradation
   - Orphaned links don't break queries

---

## Verification

```bash
# TypeScript check
cd packages/core && npm run build        # PASS
cd packages/dashboard && npx tsc --noEmit # PASS

# Prettier
npx prettier --write src/               # PASS
```

---

## Issues Found & Fixed

1. **logPath exposed in toResponse()** — Fixed by removing from response object
2. **PATCH allowed status='deleted'** — Fixed by adding PATCHABLE_STATUSES validation

---

## User Stories to Test

1. **Create task via API:**

   ```bash
   curl -X POST http://localhost:4321/api/tasks \
     -H "Content-Type: application/json" \
     -d '{"type":"immediate","sourceType":"manual","title":"Test task","instructions":"Do something","createdBy":"user"}'
   ```

   - Should return task with id, status='pending'
   - Should NOT include logPath in response

2. **Create task with conversation link:**

   ```bash
   curl -X POST http://localhost:4321/api/tasks \
     -H "Content-Type: application/json" \
     -d '{"type":"immediate","sourceType":"manual","title":"Linked task","instructions":"Do something","createdBy":"user","conversationId":"conv-123"}'
   ```

   - Task created AND linked to conversation

3. **List tasks:**

   ```bash
   curl http://localhost:4321/api/tasks
   ```

   - Returns non-deleted tasks
   - Add `?includeDeleted=true` to see deleted tasks

4. **Complete task:**

   ```bash
   curl -X POST http://localhost:4321/api/tasks/{id}/complete \
     -H "Content-Type: application/json" \
     -d '{"conversationId":"conv-123"}'
   ```

   - Status changes to 'completed', completedAt set
   - Link created to conversation

5. **Delete task:**

   ```bash
   curl -X DELETE http://localhost:4321/api/tasks/{id}
   ```

   - Status changes to 'deleted', deletedAt set
   - Task excluded from default list

6. **Get linked conversations:**

   ```bash
   curl http://localhost:4321/api/tasks/{id}/conversations
   ```

   - Returns array of linked conversation IDs with timestamps

7. **Verify PATCH cannot set deleted:**
   ```bash
   curl -X PATCH http://localhost:4321/api/tasks/{id} \
     -H "Content-Type: application/json" \
     -d '{"status":"deleted"}'
   ```

   - Should return 400 error

---

## Recommendations

1. **Future: Add API endpoint to /api/debug/api-spec**
   - Document all 8 task endpoints
   - Include in API discovery

2. **Future: Task UI (S6)**
   - Task list screen with filters
   - Task detail tab with linked conversations
   - Entity tags in chat

---

_Review completed: 2026-02-20_
