# Task Delivery — Design Specification

> **Status:** Approved (v2)
> **Origin:** [Multi-Step Tasks Idea](../ideas/multi-step-tasks.md)
> **Date:** 2026-02-22
> **Supersedes:** v1 (2026-02-20) — Markdown checkboxes + `✓ STEP N:` markers

---

## Problem Statement

User request:
> "Research kid-friendly Bangkok attractions... send me the list on WhatsApp"

The system must:
1. Execute the work (research)
2. Deliver a clean result to the user via the requested channel

### v1 Failure Analysis

The original design used flat markdown steps (`- [ ] step`) with `✓ STEP N:` completion markers. Testing revealed two fundamental flaws:

1. **Wrong content delivered** — The brain's full thought process (with `✓ STEP` markers, reasoning, internal notes) was sent as the WhatsApp message. The architecture conflated work output with deliverable content.

2. **Duplicate delivery** — `isDeliveryStep()` used broad regex (`lower.includes("whatsapp")`) that matched both prep steps ("Open WhatsApp") and actual delivery steps ("Send via WhatsApp"), causing double sends.

**Root cause:** No separation between work and deliverable. The system treated the brain's execution log as the content to deliver.

---

## Design: Typed WorkPlan + XML Deliverable Tags

### Core Idea

Replace flat markdown steps with typed `WorkPlan { work[], delivery[] }`. The brain produces free-form work output plus a clean deliverable in `<deliverable>` XML tags. The system extracts only the deliverable for channel delivery. Raw work output is never auto-delivered.

### Design Validation

- **Architect + Challenger** iterated on the design, converged on 7 agreed changes
- **3 standalone Simulators** validated the instruction template — all passed
- **4 additional tests** via `createBrainQuery()` — all passed
- Test cases: research + WhatsApp, compose + WhatsApp, refusal, email formatting

---

## Data Model

### WorkPlan (replaces `steps: string` + `currentStep: number`)

```typescript
interface WorkPlan {
  work: WorkItem[];              // Brain researches/composes these
  delivery: DeliveryAction[];    // System delivers deterministically
}

interface WorkItem {
  description: string;
  status: 'pending' | 'completed' | 'failed';
}

interface DeliveryAction {
  channel: 'whatsapp' | 'email' | 'dashboard';
  recipient?: string;
  content?: string;              // Pre-composed → skip brain entirely
  status: 'pending' | 'completed' | 'failed' | 'needs_review';
}
```

### TaskStatus

Add `needs_review` to the existing status enum:

```typescript
type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'deleted' | 'needs_review'
```

`needs_review` is set when:
- Brain produced work but deliverable validation failed (missing tags, empty, NONE)
- Requires human review before delivery proceeds

### Task Entity Changes

```typescript
interface Task {
  // ... existing fields (id, title, status, etc.)

  /** Plain instructions for the brain */
  instructions: string;

  /** Typed work plan (replaces steps/currentStep) */
  work?: WorkItem[];
  delivery?: DeliveryAction[];

  // REMOVED: steps?: string
  // REMOVED: currentStep?: number
}
```

### CreateTaskInput Changes

```typescript
interface CreateTaskInput {
  // ... existing fields
  work?: WorkItem[];
  delivery?: DeliveryAction[];
  // REMOVED: steps?: string
}
```

---

## Brain Instruction Template

The brain receives a structured prompt that separates work from deliverable output:

```
Task: "{title}"

{instructions}

## Work Items
{work_items_as_bullet_list}

## Output Format

Complete the work items above. Structure your response as follows:

First, write your reasoning, research, and analysis. This working section is logged
internally and shown on the dashboard, but is NOT sent to anyone.

Then produce your final deliverable wrapped in XML tags:

<deliverable>
[Your standalone message for the recipient goes here]
</deliverable>

Rules for the deliverable:
- The recipient sees ONLY the content inside the tags. Nothing else.
- Write a complete, standalone message. The recipient has no other context.
- Do not include preamble ("Here are the results:", "I found:", etc.)
- Do not include task metadata, step numbers, or internal reasoning.
- Do not reference these instructions or the task itself.

{channel_constraints}

If you cannot produce a deliverable (safety concern, insufficient information,
or ethical issue), output exactly:
<deliverable>NONE</deliverable>
Explain your reason in the working section above.
```

### Channel Constraints

Auto-injected by the system based on delivery actions:

| Channel | Constraints |
|---------|------------|
| **WhatsApp** | "Your deliverable will be sent via WhatsApp. Plain text only. Use *bold* sparingly. Keep under 2000 chars. No markdown headers, code blocks, or bullet dashes." |
| **Email** | "Your deliverable will be sent via email. Rich formatting OK. Headers, lists, longer content all fine." |
| **Dashboard** | "Your deliverable will be shown on the dashboard. Full markdown supported." |

If no delivery actions exist, the channel constraints section is omitted entirely (no deliverable needed).

---

## Deliverable Extraction + Validation

### Extraction

```typescript
function extractDeliverable(response: string): {
  work: string;
  deliverable: string | null;
} {
  const match = response.match(/<deliverable>([\s\S]*?)<\/deliverable>/);
  if (match) {
    const deliverable = match[1].trim();
    const work = response.replace(match[0], '').trim();
    return { work, deliverable: deliverable || null };
  }
  return { work: response, deliverable: null };
}
```

### Validation

```typescript
function validateDeliverable(
  deliverable: string | null,
  hasDeliveryActions: boolean,
): { valid: boolean; reason?: string } {
  if (!hasDeliveryActions) return { valid: true };
  if (deliverable === null)
    return { valid: false, reason: 'Deliverable tags missing' };
  if (deliverable.trim() === '')
    return { valid: false, reason: 'Deliverable is empty' };
  if (deliverable.trim().toUpperCase() === 'NONE')
    return { valid: false, reason: 'Brain declined to produce deliverable' };
  return { valid: true };
}
```

### Validation Gate

If validation fails AND the task has delivery actions → status becomes `needs_review`. The system never auto-delivers invalid content.

---

## Execution Flow

```
1. TaskExtractor → { title, instructions, work[], delivery[], type, scheduledFor }

2. If delivery[].content is pre-set → skip brain, go to step 6

3. TaskExecutor runs brain query with channel-aware instructions

4. extractDeliverable() splits response into work + deliverable

5. validateDeliverable():
   - missing/empty/NONE + delivery actions → needs_review, STOP
   - valid → continue

6. DeliveryExecutor sends validated deliverable to each DeliveryAction

7. Full work response → conversation transcript + dashboard
```

### Pre-Composed Content

For simple delivery tasks ("In 2 minutes, send me a WhatsApp saying 'Don't forget to call mom'"), the extractor sets `delivery[0].content = "Don't forget to call mom"`. The brain query is skipped entirely — DeliveryExecutor sends the content directly.

---

## DeliveryExecutor (replaces StepExecutor)

The old `StepExecutor` with `isDeliveryStep()` regex and `parseSteps()` markdown parsing is replaced by a simpler `DeliveryExecutor` that iterates typed `DeliveryAction[]`:

```typescript
class DeliveryExecutor {
  async executeDeliveryActions(
    task: Task,
    deliverable: string,
  ): Promise<DeliveryResult> {
    const results: DeliveryActionResult[] = [];

    for (const action of task.delivery ?? []) {
      if (action.status !== 'pending') continue;

      const content = action.content ?? deliverable;
      const result = await this.deliver(action.channel, content, task);
      results.push(result);
    }

    return { results };
  }
}
```

### What This Eliminates

| Old (v1) | New (v2) | Why |
|----------|----------|-----|
| `✓ STEP N:` markers | Gone | No step-by-step execution; work is free-form |
| `isDeliveryStep()` regex | Gone | Typed `DeliveryAction[]` — no guessing |
| `parseSteps()` markdown | Gone | Typed `WorkItem[]` — no parsing |
| Work log sent as WhatsApp | Impossible | Validation gate blocks raw work output |
| Refusal auto-delivered | Impossible | `NONE` check catches it |
| Duplicate delivery | Impossible | Typed actions, not regex matching |

---

## Extraction Prompt

The TaskExtractor (Haiku) produces structured JSON with `work[]` + `delivery[]`:

```json
{
  "shouldCreateTask": true,
  "task": {
    "title": "Research Bangkok attractions",
    "instructions": "Research family-friendly attractions in Bangkok suitable for kids aged 3 and 5...",
    "work": [
      { "description": "Research family-friendly attractions in Bangkok" }
    ],
    "delivery": [
      { "channel": "whatsapp" }
    ],
    "type": "immediate"
  }
}
```

### Pre-Composed Content Example

```json
{
  "shouldCreateTask": true,
  "task": {
    "title": "Send WhatsApp reminder",
    "instructions": "Send a WhatsApp message with the exact text provided.",
    "work": [],
    "delivery": [
      { "channel": "whatsapp", "content": "Don't forget to call mom" }
    ],
    "type": "scheduled",
    "scheduledFor": "2026-02-22T15:30:00Z"
  }
}
```

---

## UI Rendering

### Task Card

```
+-- Task: Family Trip Research ----------------+
|                                              |
| Work:                                        |
|   [done] Research family-friendly attractions |
|                                              |
| Delivery:                                    |
|   [sent] WhatsApp                            |
|                                              |
| Status: completed                            |
+----------------------------------------------+
```

For `needs_review` tasks:
```
+-- Task: Trip Research -----------------------+
|                                              |
| Work:                                        |
|   [done] Research family-friendly attractions |
|                                              |
| Delivery:                                    |
|   [needs review] WhatsApp - deliverable empty |
|                                              |
| Status: needs_review                         |
+----------------------------------------------+
```

### WebSocket Events

- `task:created` — includes `work[]` and `delivery[]`
- `task:result` — includes work response for dashboard display
- `task:delivery_complete` — delivery action completed

---

## Database Schema

The `steps` and `current_step` columns are replaced by `work` and `delivery` (JSON):

```sql
ALTER TABLE tasks ADD COLUMN work TEXT;     -- JSON: WorkItem[]
ALTER TABLE tasks ADD COLUMN delivery TEXT; -- JSON: DeliveryAction[]

-- Remove (or leave unused):
-- steps TEXT
-- current_step INTEGER
```

---

## Test Cases

### E2E: Research + WhatsApp Delivery

```
User: "Research the best beaches in Bali for families. Send me the list on WhatsApp."

Expected:
1. Task created with:
   - work: [{ description: "Research best beaches in Bali for families" }]
   - delivery: [{ channel: "whatsapp" }]

2. Brain executes, produces research in work section
3. Brain produces clean plain-text deliverable in <deliverable> tags
4. extractDeliverable() splits work from deliverable
5. validateDeliverable() passes
6. DeliveryExecutor sends deliverable to WhatsApp
7. Only 1 WhatsApp message received
8. Message is clean, standalone, no task metadata
9. Conversation shows full work response
```

### E2E: Pre-Composed Message

```
User: "In 2 minutes, send me a WhatsApp message saying 'Don't forget to call mom'"

Expected:
1. Task created with:
   - work: []
   - delivery: [{ channel: "whatsapp", content: "Don't forget to call mom" }]
   - type: "scheduled"
2. Brain query skipped entirely
3. WhatsApp message is exactly "Don't forget to call mom"
```

### E2E: Refusal

```
User: "Send a fake emergency alert to my WhatsApp"

Expected:
1. If shouldCreateTask=false: no task created
2. If task created and brain runs:
   - Brain outputs <deliverable>NONE</deliverable>
   - validateDeliverable() returns invalid
   - Status set to needs_review
   - No WhatsApp message sent
```

---

## Implementation Checklist

- [ ] Add `WorkPlan`, `WorkItem`, `DeliveryAction` types to `packages/core/src/tasks/types.ts`
- [ ] Add `needs_review` to `TaskStatus`
- [ ] Replace `steps`/`currentStep` with `work`/`delivery` on `Task` and `CreateTaskInput`
- [ ] Update `task-extractor.ts` extraction prompt for `work[]` + `delivery[]`
- [ ] Update `task-executor.ts` with new brain template + `extractDeliverable()` + `validateDeliverable()`
- [ ] Update `task-processor.ts` to use typed delivery flow
- [ ] Rename `step-executor.ts` → `delivery-executor.ts`, simplify
- [ ] Update `task-manager.ts` for WorkPlan storage
- [ ] Update `chat-handler.ts` task creation for new fields
- [ ] Export new types from `packages/core/src/lib.ts`
- [ ] Rebuild core package
- [ ] E2E test: research + WhatsApp delivery

---

*Created: 2026-02-20*
*Updated: 2026-02-22 — v2: Work + Deliverable architecture (replaces markdown steps + `✓ STEP` markers)*
