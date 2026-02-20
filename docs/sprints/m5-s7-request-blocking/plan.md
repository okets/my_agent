# M5-S7: Request/Input Blocking (D2 Fix)

> **Milestone:** M5 — Task System
> **Sprint:** S7 of 7
> **Status:** Planned
> **Goal:** TaskExecutor can pause for user input via NotificationService

---

## Overview

Fix the D2 deviation from S4: `request_input()` is currently non-blocking. The TaskExecutor needs to actually pause execution, wait for user response, and then continue. This enables true interactive task execution.

## Problem Statement

Current flow (broken):

```
TaskExecutor.run()
  → Brain calls request_input()
  → Notification created
  → Brain continues immediately (doesn't wait)
  → Task completes without user input
```

Desired flow:

```
TaskExecutor.run()
  → Brain calls request_input()
  → Notification created
  → Task status → 'paused'
  → Executor waits for response
  → User responds via dashboard
  → Response delivered to brain
  → Task status → 'running'
  → Brain continues with user's answer
  → Task completes
```

## Deliverables

### 1. Blocking Request/Input Pattern

NotificationService needs a blocking variant:

```typescript
// Non-blocking (current)
service.requestInput({ question, options });  // returns immediately

// Blocking (new)
const response = await service.requestInputAndWait({
  question,
  options,
  taskId,
  timeout?: 300000,  // 5 min default
});
// Returns user's response or throws on timeout
```

### 2. TaskExecutor Integration

Executor needs to detect when brain requests input:

```typescript
// Option A: Brain tool that triggers pause
// Brain calls: POST /api/tasks/:id/request-input
// Executor detects this and pauses

// Option B: Special message pattern
// Brain outputs: [REQUEST_INPUT: question | opt1 | opt2]
// Executor parses and pauses
```

Recommend **Option A** — cleaner, explicit.

### 3. Pause/Resume Flow

```
POST /api/tasks/:id/request-input
  body: { question, options }
  → TaskManager.update(id, { status: 'paused' })
  → NotificationService.requestInput({ taskId, question, options })
  → Return { notificationId }

POST /api/notifications/:id/respond
  body: { response }
  → NotificationService.respond(id, response)
  → Find associated task
  → TaskManager.update(taskId, { status: 'running' })
  → Resume executor with response
```

### 4. Response Delivery to Brain

The tricky part: how does the response get back to the brain?

**Approach: Continuation prompt**

When user responds:

1. Store response in notification
2. Resume TaskExecutor
3. Executor sends new message to brain: "User responded: {response}"
4. Brain continues based on response

```typescript
// task-executor.ts
async resumeWithResponse(taskId: string, response: string) {
  const task = this.taskManager.findById(taskId);

  // Send continuation message
  const query = createBrainQuery(
    `User responded to your question: "${response}"`,
    { systemPrompt, continue: true }
  );
  // ... continue execution
}
```

### 5. Timeout Handling

If user doesn't respond within timeout:

| Strategy | Behavior                            |
| -------- | ----------------------------------- |
| Fail     | Task status → 'failed', log timeout |
| Skip     | Continue without input, log warning |
| Escalate | Create escalation notification      |

Default: **Fail** with clear error message.

## Technical Approach

### New API Endpoint

```typescript
// POST /api/tasks/:id/request-input
fastify.post("/api/tasks/:id/request-input", async (req, reply) => {
  const { id } = req.params;
  const { question, options, timeout } = req.body;

  // 1. Update task status
  taskManager.update(id, { status: "paused" });

  // 2. Create notification
  const notification = notificationService.requestInput({
    taskId: id,
    question,
    options,
  });

  // 3. Store pending request
  pendingRequests.set(notification.id, { taskId: id, timeout });

  return { notificationId: notification.id };
});
```

### Response Handler Enhancement

```typescript
// When user responds to notification
service.on("response", async (event) => {
  const { notificationId, response } = event;
  const pending = pendingRequests.get(notificationId);

  if (pending) {
    // Resume the task
    await taskExecutor.resumeWithResponse(pending.taskId, response);
    pendingRequests.delete(notificationId);
  }
});
```

### Brain Skill Update

Update `.my_agent/brain/skills/task-api.md`:

```markdown
## Requesting User Input

When you need user input during task execution:

\`\`\`bash
curl -X POST http://localhost:4321/api/tasks/TASK_ID/request-input \
 -H "Content-Type: application/json" \
 -d '{"question": "Which option?", "options": ["A", "B", "C"]}'
\`\`\`

The task will pause until the user responds. You'll receive their
response as a follow-up message.
```

## Team

| Role        | Model  | Responsibility                       |
| ----------- | ------ | ------------------------------------ |
| Backend Dev | Sonnet | API endpoint, executor integration   |
| Backend Dev | Sonnet | NotificationService blocking pattern |
| Reviewer    | Opus   | Flow correctness, edge cases         |

## Success Criteria

- [ ] `POST /api/tasks/:id/request-input` endpoint works
- [ ] Task status transitions: running → paused → running
- [ ] User response flows back to brain
- [ ] Timeout handling works
- [ ] Brain can request input during task execution
- [ ] Task completes successfully after receiving input

## Risks

| Risk                             | Mitigation                |
| -------------------------------- | ------------------------- |
| Brain doesn't wait for response  | Clear skill documentation |
| Lost responses on server restart | Persist pending requests  |
| Infinite pause (no timeout)      | Enforce minimum timeout   |

## Dependencies

- S4: NotificationService (complete)
- S5: Task REST API (complete)
- S6: Task UI (for testing)

---

_Created: 2026-02-20_
