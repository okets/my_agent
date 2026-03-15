# Conversation Nina Tool Separation

**Status:** Design approved
**Parent:** M6.9 Knowledge Lifecycle (S4 continuation)
**Builds on:** M6.9-S4 Agentic Task Executor

---

## 1. Goal

Enforce a clean separation between conversation Nina (talks, clarifies, delegates) and working Nina (researches, scripts, browses). Remove power tools from conversation Nina so she cannot answer research questions herself — she must delegate to working Nina via an explicit `create_task` MCP tool. This makes task delegation structural, not prompt-dependent.

---

## 2. The Problem

Currently conversation Nina has full tool access (Bash, Read, Write, Edit, Glob, Grep, Playwright). When a user asks for research, she answers from her own tools instead of delegating to working Nina. Task extraction happens post-response as a fire-and-forget hook — by then she's already sent a half-baked answer. The user gets both Nina's guess AND working Nina's thorough research later as a "side note."

---

## 3. Conversation Nina's New Tool Set

Remove all power tools. Keep only:

| Tool | Purpose |
|------|---------|
| WebSearch | Quick factual lookups ("what time is it in Bangkok?") |
| MCP: memory | remember, recall, daily_log, notebook_read, notebook_write |
| MCP: knowledge | manage_staged_knowledge |
| MCP: create_task (NEW) | Delegate work to working Nina |
| MCP: revise_task | Correct completed tasks |
| MCP: update_property (NEW) | Update location/timezone/availability immediately |
| MCP: debrief | Request debrief |

Working Nina's tools are UNCHANGED: Bash, Read, Write, Edit, Glob, Grep + all MCP servers (memory, knowledge, Playwright).

### 3.1 WebSearch Guidance

WebSearch is for quick facts that don't warrant a task:
- "What time is it in Bangkok?" → WebSearch
- "What's the capital of Thailand?" → WebSearch
- "Compare 5 co-working spaces with prices" → create_task
- "Find the cheapest flight to Bangkok" → create_task

The line: if you can answer it in one WebSearch call, do it. If it needs multiple steps, tools, file output, or browser automation → create_task.

---

## 4. `create_task` MCP Tool

Conversation Nina creates tasks explicitly. She can ask clarifying questions first. She decides when to delegate.

Schema:
```
create_task({
  title: string,           // Short descriptive title
  instructions: string,    // Self-contained instructions (working Nina has no conversation context)
  work: [{ description }], // Work items
  type: "immediate" | "scheduled",
  scheduledFor?: string,   // ISO datetime (UTC) for scheduled tasks
  notifyOnCompletion?: "immediate" | "debrief" | "none",
  model?: string,          // Override model (e.g. "claude-opus-4-6")
})
```

The tool handler:
1. Creates task via `taskManager.create()` with `sourceType: "conversation"` and `createdBy: "agent"`
2. Links task to the current conversation via `taskManager.linkTaskToConversation()`
3. For immediate tasks: triggers `taskProcessor.onTaskCreated()`
4. Returns task ID to conversation Nina so she can reference it

The `conversationId` is NOT a parameter — it's injected by the tool handler from the session context. Conversation Nina doesn't need to know or pass it.

### 4.1 Instructions Must Be Self-Contained

Standing orders must emphasize: working Nina has NO access to the conversation transcript. The `instructions` field must contain everything the working agent needs to do the job. Include any context the user just shared (location, preferences, constraints) that may not be in properties yet.

### 4.2 Time Resolution

When the user says "at 2pm" or "in 30 minutes", conversation Nina must convert to absolute UTC before passing to `scheduledFor`. She knows the user's timezone from properties or from the conversation context.

---

## 5. `update_property` MCP Tool

Updates dynamic properties (location, timezone, availability) in `notebook/properties/status.yaml`.

Schema:
```
update_property({
  key: string,        // "location" | "timezone" | "availability"
  value: string,      // The new value
  confidence: "high" | "medium" | "low",
  source: string,     // "conversation" — how we learned this
})
```

Standing orders instruct Nina: "When the user shares a change in location, timezone, or availability, call `update_property` immediately."

### 5.1 Why This Matters

Properties feed into:
- Working Nina's system prompt (temporal context, dynamic status)
- Task scheduler timezone resolution
- Debrief scheduling

If the user says "I just landed in New York" and later creates a scheduled task, properties must be fresh. The abbreviation service catches this post-conversation, but `update_property` makes it immediate.

### 5.2 Ordering Doesn't Matter

`update_property` doesn't need to be called before `create_task`. Properties are read at task execution time (not creation time). Even for immediate tasks, the property file is updated within the same second. The risk is Nina forgetting to call it at all — mitigated by standing orders + abbreviation service as safety net.

---

## 6. Post-Response Task Extraction → Missed Task Detection

The current post-response hook auto-extracts and auto-creates tasks. This changes:

**Before:** Hook extracts tasks from conversation, creates them automatically.
**After:** Hook scans for potential missed tasks and logs/notifies — but does NOT create them.

The hook runs when a conversation becomes inactive (user leaves, WebSocket disconnects). It:
1. Scans the conversation for task-worthy requests
2. Checks if Nina already created tasks for them (via `getTasksForConversation`)
3. If unhandled requests exist, logs a warning: `[MissedTaskDetector] Potential missed task: "user asked for X"`
4. Optionally creates a notification for the CTO

This is a safety net, not a primary path. Nina is the only one who creates tasks.

---

## 7. Tool Restriction Implementation

### 7.1 Where to Restrict

In `session-manager.ts`, `buildQuery()` currently doesn't pass `tools` to `createBrainQuery()`, so it gets the defaults (all power tools). Change to pass an empty tools array — conversation Nina gets NO SDK tools, only MCP tools.

```typescript
const opts: BrainSessionOptions = {
  model,
  systemPrompt,
  tools: [],  // No power tools — only MCP tools available
  // ... rest unchanged
};
```

MCP tools (memory, knowledge, create_task, revise_task, update_property, debrief) are registered via `mcpServers` and remain available.

WebSearch is a built-in Claude capability, not an SDK tool — it remains available regardless of the `tools` setting. (VERIFY THIS ASSUMPTION — check if WebSearch needs to be in the tools array or if it's always available.)

### 7.2 Working Nina Unchanged

TaskExecutor already explicitly passes `tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]`. No change needed.

---

## 8. Standing Orders Update

Add to `.my_agent/notebook/reference/standing-orders.md`:

```markdown
## Task Delegation

You do not have Bash, file editing, or browser tools. For anything beyond a quick WebSearch:
- Use `create_task` to delegate to a working agent
- Include ALL relevant context in the instructions — the working agent cannot see this conversation
- You can ask clarifying questions before creating a task
- Convert relative times ("in 30 minutes", "at 2pm") to absolute UTC in scheduledFor
- When the user mentions a location, timezone, or availability change, call `update_property` immediately

### When to use WebSearch vs create_task
- WebSearch: single factual question, one search, instant answer
- create_task: research, comparison, multi-step work, file creation, browser automation, scripting
```

---

## 9. Files Changed

| File | Changes |
|------|---------|
| `dashboard/src/agent/session-manager.ts` | Pass `tools: []` in buildQuery() |
| `dashboard/src/mcp/task-revision-server.ts` | Rename to `task-tools-server.ts`, add `create_task` and `update_property` tools |
| `dashboard/src/conversations/post-response-hooks.ts` | Change from task creation to missed task detection (log/notify only) |
| `dashboard/src/tasks/task-extractor.ts` | Keep extraction logic, remove creation — return detected tasks for logging |
| `dashboard/src/index.ts` | Wire renamed MCP server, pass conversationId context |
| `.my_agent/notebook/reference/standing-orders.md` | Add task delegation section |
| `dashboard/src/conversations/properties.ts` | Export `updateProperty` for MCP tool handler |

---

## 10. Edge Cases

| Scenario | Behavior |
|----------|----------|
| User asks simple question ("what time is it?") | Nina uses WebSearch, answers directly |
| User asks for research | Nina calls create_task, says "On it!" |
| User asks Nina to clarify before researching | Nina asks questions, then calls create_task with refined instructions |
| User says "I'm in New York" | Nina calls update_property immediately |
| User says "at 2pm check traffic" | Nina converts to UTC, calls create_task with scheduledFor |
| Nina forgets to create a task | Missed task detector logs warning when conversation goes inactive |
| Nina forgets to update_property | Abbreviation service catches it post-conversation |
| User says "restart the dashboard" | Nina explains she can't do system operations and suggests the API/manual approach |
| User uploads file for analysis | Nina creates task — working Nina has Read tool |
| Multiple tasks in one message | Nina calls create_task multiple times |

---

## 11. What About the Conversation ID?

The `create_task` tool needs to link tasks to the current conversation. But MCP tools don't inherently know which conversation they're serving.

Solution: The MCP server factory receives a `getActiveConversationId` callback from index.ts. When conversation Nina calls `create_task`, the handler calls this function to get the current conversation ID. This avoids exposing internal IDs to the model.

---

## 12. Test Strategy

- **Unit tests:** create_task tool — verify task creation, conversation linking, processor trigger
- **Unit tests:** update_property tool — verify property file updates
- **Unit tests:** Missed task detector — verify detection without creation
- **Integration:** Conversation Nina without power tools can still answer simple questions via WebSearch
- **Integration:** Conversation Nina creates task, working Nina executes, result delivered back
- **Integration:** Scheduled task with timezone conversion executes at correct time
- **E2E (browser):** Full flow — ask for research on WhatsApp, get results, request correction via revise_task

---

## 13. Relationship to Existing Architecture

This is the missing piece from M6.9-S4. The agentic task executor gave working Nina full tools. This spec gives conversation Nina the constraint that makes her USE working Nina instead of doing the work herself.

| Before S4 | After S4 | After This |
|-----------|----------|------------|
| Text-only tasks | Working Nina has tools | Conversation Nina must delegate |
| No enforcement | Working Nina capable | Structural enforcement |
| Nina guesses answers | Nina guesses + task runs | Nina delegates, working Nina answers |

---

*Created: 2026-03-15*
