# M5-S9: Work + Deliverable Architecture

> **Milestone:** M5 — Task System
> **Sprint:** S9 of 9
> **Status:** In Progress
> **Goal:** Clean task delivery — work output stays internal, only validated deliverables reach channels
> **Design Spec:** [task-steps.md](../../design/task-steps.md) (v2)

---

## Overview

Testing revealed two fundamental flaws in the original step-based approach:
1. **Wrong content** — Brain's full thought process (with `✓ STEP` markers) sent as WhatsApp message
2. **Duplicate messages** — `isDeliveryStep()` regex matched prep steps alongside delivery steps

**Root cause:** No separation between work output and deliverable content.

**Solution:** Typed `WorkPlan { work[], delivery[] }` with `<deliverable>` XML tags. A design team (Architect + Challenger + 3 Simulators) validated the approach — all tests passed.

---

## User Story

**Given:** User sends "Research the best beaches in Bali for families. Send me the list on WhatsApp."

**Expected:**
1. Task created with `work: [{ description: "Research best beaches..." }]` and `delivery: [{ channel: "whatsapp" }]`
2. Brain researches beaches, writes analysis in work section
3. Brain produces clean standalone message inside `<deliverable>` tags
4. System extracts deliverable, validates it
5. Exactly 1 WhatsApp message sent — clean plain text, no task metadata
6. Dashboard conversation shows full research output

**Given:** User sends "In 2 minutes, send me a WhatsApp message saying 'Don't forget to call mom'"

**Expected:**
1. Task created with `delivery: [{ channel: "whatsapp", content: "Don't forget to call mom" }]`
2. Brain query skipped entirely (content is pre-composed)
3. WhatsApp message is exactly "Don't forget to call mom"

---

## Data Model Changes

### Core Types (new)

```typescript
interface WorkItem {
  description: string;
  status: 'pending' | 'completed' | 'failed';
}

interface DeliveryAction {
  channel: 'whatsapp' | 'email' | 'dashboard';
  recipient?: string;
  content?: string;  // Pre-composed → skip brain
  status: 'pending' | 'completed' | 'failed' | 'needs_review';
}
```

### Task Entity

```typescript
interface Task {
  // ... existing fields
  work?: WorkItem[];       // NEW (replaces steps)
  delivery?: DeliveryAction[]; // NEW (replaces currentStep)
  // REMOVED: steps?: string
  // REMOVED: currentStep?: number
}
```

### TaskStatus

```typescript
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'deleted' | 'needs_review'
```

---

## Implementation Tasks

### 1. Update Core Types

**File:** `packages/core/src/tasks/types.ts`

- Add `WorkItem`, `DeliveryAction` interfaces
- Add `needs_review` to `TaskStatus`
- Replace `steps`/`currentStep` with `work`/`delivery` on `Task` and `CreateTaskInput`

**File:** `packages/core/src/lib.ts`

- Export new types

### 2. Update Task Extractor

**File:** `packages/dashboard/src/tasks/task-extractor.ts`

- Update `ExtractedTask` interface: `work[]` + `delivery[]` instead of `steps`
- Update `EXTRACTION_PROMPT` with concrete JSON example showing work/delivery split
- Include pre-composed content example in prompt

### 3. Rewrite Task Executor

**File:** `packages/dashboard/src/tasks/task-executor.ts`

- Rewrite `buildUserMessage()` with new template (work items + deliverable XML tags + channel constraints)
- Add `extractDeliverable(response)` function
- Add `validateDeliverable(deliverable, hasDeliveryActions)` function
- Update `ExecutionResult` to return `{ success, work, deliverable, error }`
- Auto-inject channel constraints based on delivery actions

### 4. Create Delivery Executor

**File:** `packages/dashboard/src/tasks/delivery-executor.ts` (new, replaces `step-executor.ts`)

- Iterate typed `DeliveryAction[]`, send deliverable content
- Keep WhatsApp send logic and `recordInChannelConversation()`
- Remove `isDeliveryStep()`, `parseSteps()`, `✓ STEP` marker handling
- Remove `📋 *Task Complete:*` header from messages

### 5. Update Task Processor

**File:** `packages/dashboard/src/tasks/task-processor.ts`

- Import `DeliveryExecutor` instead of `StepExecutor`
- Use `delivery[]` from WorkPlan instead of calling with full response
- Pass only validated deliverable to DeliveryExecutor
- Handle `needs_review` status when validation fails
- Remove `updateStepsFromResponse()` (no more `✓ STEP` parsing)

### 6. Update Task Manager + Chat Handler

**File:** `packages/dashboard/src/tasks/task-manager.ts`

- Update `create()` to store `work`/`delivery` as JSON columns
- Update `rowToTask()` to parse JSON
- Remove `markStepComplete()` method
- Update `update()` — remove `steps`/`currentStep` handling, add `work`/`delivery`

**File:** `packages/dashboard/src/ws/chat-handler.ts`

- Update task creation to pass `work`/`delivery` instead of `steps`
- Update `task:created` broadcast with new fields

### 7. Build + Test

- Rebuild core package (`cd packages/core && npm run build`)
- Format all edited files
- Verify TypeScript compilation
- E2E test: research + WhatsApp delivery

---

## File Changes Summary

| File | Change |
|------|--------|
| `packages/core/src/tasks/types.ts` | Add `WorkItem`, `DeliveryAction`, `needs_review` status. Replace `steps`/`currentStep` with `work`/`delivery`. |
| `packages/core/src/lib.ts` | Export new types |
| `packages/dashboard/src/tasks/task-extractor.ts` | New `ExtractedTask` with `work[]` + `delivery[]`. Updated extraction prompt. |
| `packages/dashboard/src/tasks/task-executor.ts` | New brain template, `extractDeliverable()`, `validateDeliverable()`, updated `ExecutionResult`. |
| `packages/dashboard/src/tasks/delivery-executor.ts` | **NEW** — replaces `step-executor.ts`. Simplified typed delivery. |
| `packages/dashboard/src/tasks/step-executor.ts` | **DELETED** — replaced by `delivery-executor.ts`. |
| `packages/dashboard/src/tasks/task-processor.ts` | Use `DeliveryExecutor` + validated deliverable. Remove `✓ STEP` parsing. |
| `packages/dashboard/src/tasks/task-manager.ts` | JSON columns for `work`/`delivery`. Remove `markStepComplete()`. |
| `packages/dashboard/src/ws/chat-handler.ts` | Pass `work`/`delivery` in task creation + broadcast. |

---

## Success Criteria

- [ ] Task model uses typed `work[]` + `delivery[]` (not markdown steps)
- [ ] Brain produces deliverable in `<deliverable>` XML tags
- [ ] Only validated deliverable content is sent to channels
- [ ] Pre-composed content skips brain entirely
- [ ] `needs_review` status set when validation fails (no auto-delivery of invalid content)
- [ ] Exactly 1 WhatsApp message per delivery action (no duplicates)
- [ ] WhatsApp message is clean standalone text (no task metadata, no `✓ STEP` markers)
- [ ] Full work output visible in conversation transcript + dashboard

---

## Risks

| Risk | Mitigation |
|------|------------|
| Brain doesn't produce `<deliverable>` tags | Validated by 7 simulator tests. Fail-safe: `needs_review` status. |
| Deliverable contains work content | Channel constraints in prompt + validation. |
| Pre-composed content edge cases | Simple path: if `content` set, skip brain. No ambiguity. |

---

## Design Validation

| Test | Input | Result |
|------|-------|--------|
| Research + WhatsApp | "Top 5 coffee shops in Tel Aviv" | PASS — clean plain text in tags |
| Compose + WhatsApp | "Stretch break reminder with 3 stretches" | PASS — friendly standalone message |
| Refusal | "Compose fake security alert" | PASS — `<deliverable>NONE</deliverable>` |
| Email format | "Send email summary" | PASS — rich formatting in tags |
| No delivery | "Research topic" (no channel) | PASS — no deliverable expected |
| Pre-composed | "Send 'call mom' on WhatsApp" | PASS — brain skipped, exact content |
| Multi-delivery | "WhatsApp + email" | PASS — keyed by channel |

---

## Dependencies

- S8: E2E Task Flow (complete — basic task execution works)
- Design spec: [task-steps.md](../../design/task-steps.md) (v2)

---

*Created: 2026-02-20*
*Updated: 2026-02-22 — v2: Work + Deliverable architecture*
