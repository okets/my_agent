# Task Steps Design

> **Status:** Approved
> **Origin:** [Multi-Step Tasks Idea](../ideas/multi-step-tasks.md)
> **Date:** 2026-02-20

## Problem Statement

User request:
> "Research kid-friendly Bangkok attractions... send me the list on whatsapp"

**Current behavior:** Brain creates single task with combined instructions, dropping delivery requirements.

**Required behavior:** Brain extracts ALL user requirements as discrete steps, executes them in order, and reports progress.

## Design Decisions

### Decision 1: Markdown over JSON

**Chosen:** Markdown checkbox format

```markdown
## Steps
- [ ] Research family-friendly attractions in Phuket/Bangkok for kids 5 & 3 YO
- [ ] Send the list to Hanan on WhatsApp
```

**Rationale:**
- Natural for LLM to generate (closer to how it thinks)
- Lower friction = fewer dropped requirements
- Already renders nicely in UI
- Trivial to parse: `^- \[([ x])\] (.+)$`
- Users can read/edit if needed

**Rejected:** JSON with structured fields
- Forced classification causes cognitive overhead
- LLM may drop requirements while mapping to schema

### Decision 2: Natural Language Steps (No Type Field)

**Chosen:** Steps are plain text objectives

```markdown
- [ ] Send Hanan the list on WhatsApp
```

**Rejected:** Typed steps with structured targets
```typescript
// NOT THIS
{ type: 'send', target: { channel: 'whatsapp', recipient: 'Hanan' } }
```

**Rationale:**
- "Send Hanan the list on WhatsApp" is sufficient
- Nina knows her active channels (WhatsApp = `ninas_whatsapp`)
- Nina knows Hanan is the owner (from `owner_identities`)
- Resolution happens at execution time, not extraction time

### Decision 3: Streaming Progress Markers

**Chosen:** Brain outputs completion markers during execution

```
✓ STEP 1: Research family-friendly attractions in Phuket/Bangkok
[... research output ...]

✓ STEP 2: Send the list to Hanan on WhatsApp
[... sending confirmation ...]
```

**Rationale:**
- Real-time progress in UI
- Simple to parse: `/^✓ STEP (\d+):/`
- Natural for LLM to output
- No tool plumbing required

**Rejected alternatives:**
- Final update only (no real-time progress)
- Tool-based (`markStepComplete(n)`) — requires tool setup

## Data Model

### Task Entity Changes

```typescript
interface Task {
  // ... existing fields (id, title, status, etc.)

  /** Task instructions - DEPRECATED, use steps */
  instructions: string;

  /**
   * Markdown checklist of steps to execute.
   * Format: "- [ ] step" or "- [x] step"
   */
  steps?: string;

  /** Current step being executed (1-indexed) */
  currentStep?: number;
}
```

**Migration:** `instructions` remains for backward compatibility. New tasks use `steps`.

### CreateTaskInput Changes

```typescript
interface CreateTaskInput {
  // ... existing fields

  /** Markdown steps (preferred) */
  steps?: string;

  /** Plain instructions (legacy) */
  instructions?: string;
}
```

## Extraction Prompt

Tested with 10 parallel agents. All 10 successfully extracted delivery steps.

### Brain Prompt (Task Creation)

```markdown
## Task Extraction

When the user requests work that should become a task:

1. Break the request into steps (2-5 steps)
2. Write each as a markdown checkbox: `- [ ] step description`
3. Capture EVERY action the user requests — never skip or combine
4. If user says "send to X" or "message me on Y" — that's ALWAYS a separate step

Example:
User: "Research Bangkok attractions and send me the list on WhatsApp"

Steps:
- [ ] Research family-friendly attractions in Bangkok
- [ ] Send the list to user on WhatsApp
```

### Key Rule

> **Nina must NEVER ignore any input point from the user.**

If the user mentions a delivery channel, reminder, or any other action — it becomes a step.

## Execution Prompt

### Brain Prompt (Task Execution)

```markdown
## Task Execution

You have these steps to complete:

{steps}

Rules:
1. Work through steps in order
2. When you complete a step, output on its own line:
   ✓ STEP N: [description]
3. Never skip steps. If blocked, explain why before continuing.
4. After the final step, summarize the overall result.
```

## TaskProcessor Changes

### Streaming Parser

```typescript
// In TaskProcessor.execute()

const stepPattern = /^✓ STEP (\d+):/m;

// On each stream chunk:
const match = chunk.match(stepPattern);
if (match) {
  const stepNumber = parseInt(match[1], 10);
  await this.markStepComplete(task.id, stepNumber);
}
```

### Step Update

```typescript
async markStepComplete(taskId: string, stepNumber: number): Promise<void> {
  const task = await this.store.get(taskId);
  if (!task.steps) return;

  // Parse markdown, update checkbox
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

  await this.store.update(taskId, {
    steps: updated,
    currentStep: stepNumber
  });
}
```

## UI Rendering

### Task Card

```
┌─ Task: Family Trip Research ─────────────────┐
│                                              │
│ ☑ Research family-friendly attractions...    │
│ ☐ Send the list to Hanan on WhatsApp         │
│                                              │
│ Progress: ████████░░ Step 1/2                │
└──────────────────────────────────────────────┘
```

### Markdown Rendering

The dashboard already renders markdown. Steps display as native checkboxes.

For real-time updates:
1. WebSocket pushes `task:updated` event
2. UI re-renders the steps markdown
3. Checkboxes update live

## Channel Context

Brain needs awareness of available channels for delivery steps.

### Brain System Prompt Addition

```markdown
## Available Channels

You have access to these communication channels:
- **ninas_whatsapp** (WhatsApp) — dedicated channel, owner: Hanan

When a step involves sending to a person:
1. Identify the channel from context ("on WhatsApp" → ninas_whatsapp)
2. Identify the recipient (owner = Hanan)
3. Use the channel API to deliver
```

## Contact Resolution (Future)

For now, Nina knows Hanan = owner of WhatsApp channel.

Future enhancement: Add contacts to config for multi-person resolution.

```yaml
# .my_agent/config.yaml
contacts:
  hanan:
    name: Hanan
    channels:
      ninas_whatsapp: "41433650172129@lid"
    role: owner
```

## Implementation Checklist

- [ ] Update `Task` interface in `packages/core/src/tasks/types.ts`
- [ ] Update `CreateTaskInput` interface
- [ ] Add step parsing to `TaskProcessor`
- [ ] Add `markStepComplete` method
- [ ] Update brain skill `task-api.md` with extraction prompt
- [ ] Update brain system prompt with channel context
- [ ] Update task execution prompt in processor
- [ ] Update dashboard task card to render steps
- [ ] Add WebSocket `task:updated` events for live progress
- [ ] Add E2E test for multi-step task

## Test Cases

### E2E: Multi-Step Task

```
User: "Research Bangkok attractions for kids and send me the list on WhatsApp"

Expected:
1. Task created with 2 steps:
   - [ ] Research Bangkok attractions for kids
   - [ ] Send the list on WhatsApp

2. Step 1 executes:
   - Brain outputs: ✓ STEP 1: Research Bangkok attractions for kids
   - Task updates: - [x] Research...

3. Step 2 executes:
   - Brain sends WhatsApp message
   - Brain outputs: ✓ STEP 2: Send the list on WhatsApp
   - Task updates: - [x] Send...

4. Task completes
5. Source conversation receives: "Done! Sent the Bangkok list to your WhatsApp."
```

---

*Created: 2026-02-20*
