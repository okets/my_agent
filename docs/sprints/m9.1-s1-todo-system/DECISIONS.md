# Decisions — M9.1-S1: Todo System + MCP Server

> Sprint decisions logged during autonomous execution (trip mode).

## D1: Conversation todo server wired per-session, not in initMcpServers()

**Context:** The plan suggested wiring the todo server in `initMcpServers()`, but that function is called once globally (no conversation ID available). Conversation nina's todo path is `conversations/{id}/todos.json` — per-conversation.

**Decision:** Wire the todo server inline in `SessionManager`'s query-building code (after `buildMcpServersForSession()`), where `this.conversationId` and `this.agentDir` are both available. Merge into `opts.mcpServers["todo"]`.

**Pros:** Clean, per-conversation scoping. No global state. Each conversation gets its own todo file.
**Cons:** Server created per query (not per session). Acceptable since `createTodoServer` is lightweight (no connections).

## D2: Added `job:interrupted` to AppEventMap

**Context:** Adding `interrupted` to `JobStatus` and `JobEventName` caused a type error — `AppEventMap` (the typed event emitter) didn't include `job:interrupted`.

**Decision:** Added `"job:interrupted": [job: Job]` to `app-events.ts`. This is the correct fix — ensures the event system is type-complete for the new status.

