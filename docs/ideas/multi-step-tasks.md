# Multi-Step Tasks

> **Status:** Promoted to Design
> **Design Doc:** [task-steps.md](../design/task-steps.md)
> **Raised by:** CTO feedback during E2E testing
> **Date:** 2026-02-20

## Problem Statement

User request:
> "Research kid-friendly Bangkok attractions... send me the list on whatsapp"

Current behavior: Brain creates single task with combined instructions.

Expected behavior: Brain should extract and execute multiple steps:
1. Research Bangkok attractions (research step)
2. Send results to Hanan on WhatsApp (delivery step)
3. Report success to source conversation (completion step)

## Current Limitations

1. **Task model is single-instruction** — No `steps` array, no step sequencing
2. **No contact resolution** — Brain hardcodes identities instead of looking up "Hanan" → WhatsApp JID
3. **No cross-channel delivery** — Task result goes to linked conversation only, can't route to different channel

## Design Options

### Option A: Steps Array in Task

```typescript
interface Task {
  // ... existing fields
  steps: TaskStep[];
  currentStep: number;
}

interface TaskStep {
  id: string;
  type: 'research' | 'send' | 'notify' | 'custom';
  instructions: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  target?: {
    channel: string;
    recipient: string; // resolved JID or conversation ID
  };
}
```

**Pros:** Single task entity, clear step progression
**Cons:** Complex execution logic, step dependencies

### Option B: Linked Tasks (Dependency Graph)

```typescript
interface Task {
  // ... existing fields
  dependsOn?: string; // task ID that must complete first
  deliverTo?: {
    type: 'conversation' | 'channel';
    target: string;
  };
}
```

Brain creates:
- Task 1: "Research Bangkok attractions" (no dependencies)
- Task 2: "Send research to Hanan on WhatsApp" (depends on Task 1)

**Pros:** Simple model, each task is independent
**Cons:** Brain must coordinate, harder to track as unit

### Option C: Task Templates / Workflows

Define common patterns:
```yaml
workflows:
  research-and-send:
    steps:
      - type: research
        store_as: result
      - type: resolve_contact
        input: "{{recipient}}"
        store_as: contact
      - type: send
        channel: "{{contact.channel}}"
        to: "{{contact.jid}}"
        content: "{{result}}"
      - type: notify_source
        content: "Sent research to {{recipient}}"
```

**Pros:** Reusable, declarative
**Cons:** Requires workflow engine, less flexible

## Contact Resolution

Brain needs a way to resolve "Hanan" → `41433650172129@lid`:

1. **Config-based** — `owner_identities` in channel config with names
2. **Memory/Contacts notebook** — `.my_agent/brain/memory/contacts.md`
3. **Conversation context** — Look up who started the conversation
4. **API** — `GET /api/contacts?name=Hanan` returns channel + JID

### Recommendation

Add contacts to config or notebook:
```yaml
# .my_agent/config.yaml
contacts:
  hanan:
    name: Hanan
    channels:
      ninas_whatsapp: "41433650172129@lid"
      email: "hanan@example.com"
    role: owner
```

Then brain skill includes: "To send to a person, use `/api/contacts?name=X` to resolve their channel address."

## Completion Reporting

After task completes:
1. Deliver result to target (WhatsApp, email, etc.)
2. Report success to source conversation: "Done! Sent the Bangkok list to your WhatsApp."

This is already partially implemented (result delivery to linked conversation) but needs:
- Different message format for "delivery confirmation" vs "result"
- Routing to different channel than source

## Recommended Approach

**Phase 1 (Quick Win):**
- Add contacts to config.yaml
- Update task-api.md skill to explain contact resolution
- Brain includes delivery target in task instructions

**Phase 2 (Proper Solution):**
- Implement linked tasks (Option B)
- Add `deliverTo` field to Task entity
- TaskProcessor handles cross-channel delivery

## E2E Test Update

```
User: "Research Bangkok attractions... send me on whatsapp"

Expected:
1. Brain creates Task 1: Research (immediate)
2. Brain creates Task 2: Send to WhatsApp (depends on Task 1)
3. Task 1 executes → stores result
4. Task 2 executes → sends to WhatsApp
5. Both tasks report completion to source conversation
```

---

*Created: 2026-02-20*
