# M5-S9: Task Steps

> **Milestone:** M5 — Task System
> **Sprint:** S9 of 9
> **Status:** Planned
> **Goal:** Tasks have markdown steps that execute sequentially with real-time progress
> **Design Spec:** [task-steps.md](../../design/task-steps.md)

---

## Overview

User requests can contain multiple actions ("research X and send to Y"). This sprint adds step extraction to task creation and step-by-step execution with live progress tracking.

**Key requirement:** Nina must NEVER ignore any input point from the user. If the user mentions a delivery channel, reminder, or any other action — it becomes a step.

---

## User Story

**Given:** User sends "Research Bangkok attractions and send me the list on WhatsApp"

**Expected:**
1. Brain extracts 2 steps:
   ```markdown
   - [ ] Research family-friendly attractions in Bangkok
   - [ ] Send the list to Hanan on WhatsApp
   ```
2. Task executes step 1, outputs: `✓ STEP 1: Research family-friendly attractions`
3. Task card updates: `- [x] Research...`
4. Task executes step 2, outputs: `✓ STEP 2: Send the list to Hanan on WhatsApp`
5. Task card updates: `- [x] Send...`
6. User sees checkboxes update in real-time

---

## Data Model Changes

### Task Entity

```typescript
interface Task {
  // ... existing fields

  /** Markdown checklist of steps (new) */
  steps?: string;

  /** Current step being executed, 1-indexed (new) */
  currentStep?: number;
}
```

### CreateTaskInput

```typescript
interface CreateTaskInput {
  // ... existing fields

  /** Markdown steps (preferred over instructions) */
  steps?: string;
}
```

---

## Implementation Tasks

### 1. Update Task Types

**File:** `packages/core/src/tasks/types.ts`

Add `steps?: string` and `currentStep?: number` to Task interface and CreateTaskInput.

### 2. Update Task Storage

**File:** `packages/dashboard/src/tasks/task-manager.ts`

- Add `steps` and `current_step` columns to tasks table
- Update `rowToTask` and `taskToRow` mappings
- Migration script if needed

### 3. Update Brain Extraction Prompt

**File:** `.my_agent/brain/skills/task-api.md`

Add step extraction rules:
```markdown
## Step Extraction

When creating a task, break the request into steps (2-5 steps).
Write each as a markdown checkbox: `- [ ] step description`

Rules:
1. Capture EVERY action the user requests — never skip or combine
2. If user says "send to X" or "message me on Y" — that's ALWAYS a separate step
3. Research can be broken into logical sub-parts if needed
```

### 4. Update Brain Execution Prompt

**File:** `packages/dashboard/src/tasks/task-executor.ts`

Add step execution instructions to task prompt:
```markdown
## Task Execution

You have these steps to complete:
{steps}

Rules:
1. Work through steps in order
2. When you complete a step, output on its own line:
   ✓ STEP N: [description]
3. Never skip steps. If blocked, explain why.
4. After the final step, summarize the overall result.
```

### 5. Add Step Progress Parsing

**File:** `packages/dashboard/src/tasks/task-processor.ts`

Parse streaming output for step completion markers:

```typescript
const stepPattern = /^✓ STEP (\d+):/m;

// On each stream chunk:
const match = chunk.match(stepPattern);
if (match) {
  const stepNumber = parseInt(match[1], 10);
  await this.markStepComplete(task.id, stepNumber);
}
```

### 6. Add markStepComplete Method

**File:** `packages/dashboard/src/tasks/task-manager.ts`

```typescript
async markStepComplete(taskId: string, stepNumber: number): Promise<void> {
  const task = await this.get(taskId);
  if (!task.steps) return;

  const lines = task.steps.split('\n');
  let currentStep = 0;

  const updated = lines.map(line => {
    const match = line.match(/^- \[ \] (.+)$/);
    if (match) {
      currentStep++;
      if (currentStep === stepNumber) {
        return `- [x] ${match[1]}`;
      }
    }
    return line;
  }).join('\n');

  await this.update(taskId, {
    steps: updated,
    currentStep: stepNumber
  });
}
```

### 7. Add Channel Context to Brain

**File:** `.my_agent/brain/CLAUDE.md` or system prompt

Add available channels so Nina knows how to execute delivery steps:
```markdown
## Available Channels

You have access to these communication channels:
- **ninas_whatsapp** (WhatsApp) — dedicated channel, owner: Hanan
```

### 8. Update Task UI

**File:** `packages/dashboard/src/public/js/app.js`

Render `task.steps` as markdown in task detail view. Steps already render as checkboxes via markdown.

### 9. Add Real-Time Step Updates

**File:** `packages/dashboard/src/routes/tasks.ts`

Broadcast `task:step_complete` WebSocket event when step completes:
```typescript
{
  type: 'task:step_complete',
  taskId: string,
  stepNumber: number,
  steps: string  // Updated markdown
}
```

Dashboard listens and re-renders task card.

### 10. E2E Test

**File:** `packages/dashboard/src/tests/e2e-multi-step-task.ts`

Test:
1. Send message: "Research Bangkok attractions and send me the list on WhatsApp"
2. Verify task has 2 steps
3. Verify step 1 completes (checkbox updates)
4. Verify step 2 completes (WhatsApp sent)
5. Verify both steps marked `[x]`

---

## File Changes Summary

| File | Change |
|------|--------|
| `packages/core/src/tasks/types.ts` | Add `steps`, `currentStep` fields |
| `packages/dashboard/src/tasks/task-manager.ts` | Add columns, `markStepComplete()` |
| `packages/dashboard/src/tasks/task-processor.ts` | Parse step markers, call `markStepComplete` |
| `packages/dashboard/src/tasks/task-executor.ts` | Add step execution prompt |
| `.my_agent/brain/skills/task-api.md` | Add step extraction rules |
| `.my_agent/brain/CLAUDE.md` | Add channel context |
| `packages/dashboard/src/public/js/app.js` | Render steps markdown |
| `packages/dashboard/src/routes/tasks.ts` | Broadcast step updates |
| `packages/dashboard/src/tests/e2e-multi-step-task.ts` | NEW: Multi-step E2E test |

---

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Backend Dev | Sonnet | Types, storage, processor, executor |
| Frontend Dev | Sonnet | Task UI, WebSocket handling |
| Reviewer | Opus | Code review, E2E test verification |

---

## Success Criteria

- [ ] Task model supports `steps` field (markdown)
- [ ] Brain extracts ALL user requirements as separate steps
- [ ] Brain outputs `✓ STEP N:` markers during execution
- [ ] TaskProcessor updates steps in real-time
- [ ] UI shows checkboxes updating live
- [ ] E2E test passes: multi-step task with WhatsApp delivery

---

## Risks

| Risk | Mitigation |
|------|------------|
| Brain doesn't extract delivery as separate step | Explicit extraction rules + tested prompts (10/10 passed) |
| Step markers not parsed correctly | Strict regex, log parsing for debugging |
| UI doesn't update in real-time | WebSocket event + explicit re-render |

---

## Dependencies

- S8: E2E Task Flow (complete — basic task execution works)
- Design spec: [task-steps.md](../../design/task-steps.md)

---

*Created: 2026-02-20*
