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
| MCP: search_tasks (NEW) | Find past tasks by meaning ("that flights research") |
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
  conversationId: string,  // From [Session Context] in system prompt
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

The `conversationId` is passed explicitly by conversation Nina. She knows it from the `[Session Context]` block in her system prompt (which already includes `Conversation ID: conv-01KKP...`). This avoids the shared-MCP-server problem — since MCP servers are singletons, a callback-based approach can't distinguish concurrent conversations. Explicit parameter passing is simple and reliable.

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

## 6. `search_tasks` MCP Tool

Enables conversation Nina to find past tasks by meaning. When the user says "that flights research from last week", Nina searches and confirms before revising.

Schema:
```
search_tasks({
  query: string,           // Natural language query
  status?: string,         // Filter: "completed" | "failed" | "all" (default: "completed")
  limit?: number,          // Max results (default: 5)
})
→ Returns: [{ id, title, status, created, completedAt }]
```

### 6.1 Hybrid Search (FTS5 + Vector with RRF)

Reuses the proven pattern from `ConversationSearchService`:

1. **FTS5 (keyword):** `tasks_fts` virtual table on `title || ' ' || instructions`
2. **Vector (semantic):** `tasks_vec` virtual table via `sqlite-vec`
3. **Mapping:** `task_embedding_map` table (maps vec0 rowids → task IDs)
4. **Merger:** Reciprocal Rank Fusion (K=60) — same as memory and conversation search

This means "trip research" matches "Find cheapest flight CNX→Bangkok" even without keyword overlap.

### 6.2 Indexing

Fire-and-forget, same as conversation indexing:
- When a task is created, `TaskSearchService.indexTask(task)` embeds `title + instructions`
- Async, never blocks task execution
- Embedding model is configurable via the `EmbeddingsPlugin` interface (Ollama `nomic-embed-text` is one implementation)

### 6.3 DB Tables (3 new)

```sql
-- FTS5 for keyword search
CREATE VIRTUAL TABLE tasks_fts USING fts5(task_id, content);

-- Vector for semantic search (dimensions from embedding plugin)
CREATE VIRTUAL TABLE tasks_vec USING vec0(embedding float[N]);

-- Mapping layer (vec0 rowids → task IDs)
CREATE TABLE task_embedding_map (
  vec_rowid INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL
);
```

### 6.4 Flow

```
User: "remember that flights research from last week?"
  → Nina calls search_tasks({ query: "flights research" })
  → Returns: [{ id: "task-01KKP...", title: "Find cheapest flight CNX→Bangkok", completed: "2026-03-14" }]
  → Nina: "Found it — the Bangkok flight search from March 14. Want me to check for better deals?"
  → User: "yes"
  → Nina calls revise_task({ taskId: "task-01KKP...", instructions: "Check if prices have changed..." })
```

---

## 7. WebUI Task Context

Currently the WebUI `ViewContext` type has `type: "notebook" | "conversation" | "settings"` — no task type. When the user is viewing a task in the dashboard and sends a chat message, conversation Nina doesn't know which task they're looking at.

### 7.1 Fix

Add `task` to ViewContext:

```typescript
export interface ViewContext {
  type: "notebook" | "conversation" | "settings" | "task";  // Add "task"
  title: string;
  icon?: string;
  file?: string;
  conversationId?: string;
  taskId?: string;  // NEW — set when viewing a task tab/popover
}
```

When the frontend renders a task view, set `chatContext = { type: "task", title: task.title, taskId: task.id }`.

### 7.2 System Prompt Injection

When `viewContext.type === "task"`, the chat handler includes the task context in the system prompt:

```
[Active View]
The user is currently viewing task: "Find cheapest flight CNX→Bangkok" (task-01KKP...)
If they ask about "this task" or request changes, use revise_task with this task ID.
[End Active View]
```

This already works for notebook views (file path injected) — same pattern.

---

## 8. Post-Response Task Extraction → Missed Task Detection

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

## 9. Tool Restriction Implementation

### 7.1 Where to Restrict

In `session-manager.ts`, `buildQuery()` currently doesn't pass `tools` to `createBrainQuery()`, so it gets the defaults (all power tools). Change to pass an empty tools array — conversation Nina gets NO SDK tools, only MCP tools.

```typescript
const opts: BrainSessionOptions = {
  model,
  systemPrompt,
  tools: ["WebSearch", "WebFetch"],  // Only web lookup tools — no Bash/Read/Write/Edit/Glob/Grep
  // ... rest unchanged
};
```

MCP tools (memory, knowledge, create_task, revise_task, update_property, debrief) are registered via `mcpServers` and remain available.

**VERIFIED:** WebSearch and WebFetch are built-in SDK tools, not magic model capabilities. Setting `tools: []` disables them. They must be explicitly listed to remain available. The SDK docs confirm: `[]` (empty array) = "Disable all built-in tools."

Note: Playwright MCP server is removed from conversation Nina. She has no use for browser automation if she must delegate research. Working Nina retains Playwright via her own MCP servers.

### 7.2 Working Nina Unchanged

TaskExecutor already explicitly passes `tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]`. No change needed.

---

## 10. Standing Orders Update

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

## 11. Files Changed

| File | Changes |
|------|---------|
| `dashboard/src/agent/session-manager.ts` | Pass `tools: ["WebSearch", "WebFetch"]` in buildQuery(), remove Playwright MCP from conversation Nina |
| `dashboard/src/mcp/task-revision-server.ts` | Rename to `task-tools-server.ts`, add `create_task`, `search_tasks`, and `update_property` tools |
| `dashboard/src/tasks/task-search-service.ts` | New: hybrid FTS5+vector search for tasks (mirrors ConversationSearchService) |
| `dashboard/src/conversations/db.ts` | Add `tasks_fts`, `tasks_vec`, `task_embedding_map` tables |
| `dashboard/src/conversations/post-response-hooks.ts` | Change from task creation to missed task detection (log/notify only) |
| `dashboard/src/tasks/task-extractor.ts` | Keep extraction logic, remove creation — return detected tasks for logging |
| `dashboard/src/index.ts` | Wire renamed MCP server, wire TaskSearchService |
| `dashboard/src/ws/protocol.ts` | Add `"task"` to ViewContext type, add `taskId` field |
| `dashboard/src/ws/chat-handler.ts` | Inject task context into system prompt when viewing a task |
| `dashboard/public/js/app.js` | Set chatContext with taskId when viewing task |
| `.my_agent/notebook/reference/standing-orders.md` | Add task delegation section |
| `dashboard/src/conversations/properties.ts` | `updateProperty` already exported — no change needed |

---

## 12. Edge Cases

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
| User says "that research from last week" | Nina calls search_tasks, confirms match, then revise_task |
| search_tasks returns no results | Nina tells user she couldn't find it, asks for more detail |
| search_tasks returns multiple matches | Nina presents options, user picks one |
| User viewing task tab and says "fix this" | System prompt includes task ID from ViewContext, Nina calls revise_task |
| Embeddings unavailable (Ollama down) | search_tasks falls back to FTS5-only keyword search |

---

## 13. Conversation ID Routing

The `create_task` and `revise_task` tools need to link tasks to conversations. MCP servers are singletons — they can't infer which conversation triggered the call.

Solution: `conversationId` is an explicit parameter. Conversation Nina knows her conversation ID from the `[Session Context]` block in her system prompt (`Conversation ID: conv-01KKP...`). She passes it when calling `create_task`. This is simple, reliable, and handles concurrent conversations correctly.

For `revise_task`, the conversation ID is already implicit — the task is already linked to a conversation from the original `create_task` call.

### 11.1 Error Handling

If `create_task` fails (DB error, invalid parameters):
- Tool returns an error message to conversation Nina
- Nina tells the user: "I couldn't create that task — [reason]. Can you try rephrasing?"
- No silent failures

### 11.2 File Uploads

File uploads from the conversation are not directly passable to working Nina in this design. Conversation Nina should tell the user: "Send me the file and I'll save it to my notebook, then create a task to analyze it." The file goes through `notebook_write` MCP tool (which she keeps), then the task instructions reference the notebook path.

---

## 14. Test Strategy

- **Unit tests:** create_task tool — verify task creation, conversation linking, processor trigger
- **Unit tests:** update_property tool — verify property file updates
- **Unit tests:** Missed task detector — verify detection without creation
- **Integration:** Conversation Nina without power tools can still answer simple questions via WebSearch
- **Integration:** Conversation Nina creates task, working Nina executes, result delivered back
- **Integration:** Scheduled task with timezone conversion executes at correct time
- **Unit tests:** search_tasks tool — verify FTS5 match, vector match, RRF merge, status filter
- **Unit tests:** Task indexing — verify fire-and-forget embedding on task creation
- **Integration:** search_tasks finds a completed task by semantic meaning
- **Integration:** User viewing task tab, sends "fix this" — correct task ID injected
- **E2E (browser):** Full flow — ask for research on WhatsApp, get results, request correction via revise_task
- **E2E (browser):** "Remember that flights research?" → search_tasks → revise_task → updated results

---

## 15. Relationship to Existing Architecture

This is the missing piece from M6.9-S4. The agentic task executor gave working Nina full tools. This spec gives conversation Nina the constraint that makes her USE working Nina instead of doing the work herself.

| Before S4 | After S4 | After This |
|-----------|----------|------------|
| Text-only tasks | Working Nina has tools | Conversation Nina must delegate |
| No enforcement | Working Nina capable | Structural enforcement |
| Nina guesses answers | Nina guesses + task runs | Nina delegates, working Nina answers |

---

*Created: 2026-03-15*
