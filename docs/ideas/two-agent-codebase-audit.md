# Two-Agent Architecture: Codebase Audit

> **Status:** Analysis — supporting detailed planning for the two-agent transition
> **Created:** 2026-03-02 | **Updated:** 2026-03-03
> **Based on:** `docs/ideas/two-agent-architecture.md`
> **Method:** Actual source file inspection — not guesses from names

---

## Executive Summary

The current codebase has a DB-centric, single-agent architecture. Every task is a row in SQLite. Execution is triggered through two parallel paths (conversation brain and calendar scheduler) that don't share delivery logic. The two-agent architecture replaces this with folder-centric state, a unified working agent pattern, and Radicale eliminated in favor of a folder-backed calendar.

The transition affects every system. Nothing is untouched, but several layers can be preserved with modifications rather than replaced outright.

---

## 1. Task System

### What it does today

Six files form the task pipeline:

| File                | Role                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `task-manager.ts`   | CRUD: SQLite reads/writes for task records                                                    |
| `log-storage.ts`    | JSONL execution logs per task (in `.my_agent/tasks/logs/`)                                    |
| `task-executor.ts`  | Spawns `createBrainQuery()` sessions, extracts `<deliverable>` tags                           |
| `task-processor.ts` | Orchestrates: immediate execution, delivery routing, result injection back into conversations |
| `task-scheduler.ts` | Polls SQLite for overdue `scheduled` tasks every 30s                                          |
| `task-extractor.ts` | Haiku call after every brain response to decide if a task should be created                   |

### Key files and their roles

**`TaskManager`** (`task-manager.ts`): The source of truth today. Tasks live in `agent.db`, not folders. Fields include: `id`, `type` (`immediate`/`scheduled`), `sourceType`, `instructions`, `work` (JSON array of `WorkItem`), `delivery` (JSON array of `DeliveryAction`), `status`, `sessionId`, `recurrenceId`, `logPath`. Also manages the `task_conversations` junction table (soft link between a task and the conversation that spawned it).

**`TaskExecutor`** (`task-executor.ts`): Builds the user message from `task.work` and `task.delivery`, calls `createBrainQuery()`, extracts `<deliverable>` XML tags from response, supports SDK session resumption (via `db.getTaskSdkSessionId()`). Loads a full system prompt including calendar context for each fresh session.

**`TaskProcessor`** (`task-processor.ts`): The entry point for both immediate execution and scheduled delivery. After `TaskExecutor.run()`, it sends results back: (a) via `DeliveryExecutor` to channel (WhatsApp/email), (b) via `ConversationManager.appendTurn()` to the source conversation transcript, (c) via WebSocket to dashboard clients. Includes a `onTaskMutated` callback for live state publishing.

**`DeliveryExecutor`** (`delivery-executor.ts`): Iterates `DeliveryAction[]`, sends to channel via `ChannelManager.send()`. Currently supports `whatsapp` (finds first Baileys channel, uses `ownerJid`) and `email` (stub only). Records outbound messages in the channel's active conversation transcript.

**`TaskExtractor`** (`task-extractor.ts`): A Haiku call that runs after each brain response in the conversation flow. Detects task-worthy requests, returns structured JSON with `title`, `instructions`, `work[]`, `delivery[]`, `type`, `scheduledFor`. This is the bridge between conversation and task creation — the brain doesn't create tasks directly via MCP tool.

**`TaskScheduler`** (`task-scheduler.ts`): Simple polling loop (30s) that calls `TaskManager.getPendingDueTasks()` and passes them to `TaskProcessor.executeAndDeliver()`. Only handles `type === "scheduled"` tasks — immediate tasks are handled synchronously by `TaskProcessor.onTaskCreated()`.

**`TaskLogStorage`** (`log-storage.ts`): JSONL files in `.my_agent/tasks/logs/{taskId}.jsonl`. Format is the same `TranscriptTurn` schema used for conversations. Supports pagination and recent-N-turns queries (used to inject prior context for recurring tasks).

### Dependencies

- **Uses:** `ConversationManager`, `ChannelManager`, `ConnectionRegistry`, `createBrainQuery`, `assembleSystemPrompt`, CalDAV client, `ConversationDatabase` (for SDK session IDs)
- **Used by:** `chat-handler.ts` (task extraction after brain response), `event-handler.ts` (CalDAV events → tasks), `index.ts` (initialization)
- **Task-conversation link:** `task_conversations` table (many-to-many, soft FK). TaskProcessor uses this to find where to deliver results.

### Impact under new architecture

**Major refactor.** The DB-centric model is replaced by folder-centric model.

| Component          | Disposition                                                                                                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskManager`      | **Replace.** Folder creation replaces DB insert. DB becomes derived index rebuilt from folders.                                                                                                                                                                                                           |
| `log-storage.ts`   | **Evolve.** The JSONL log pattern (`deliverables/`, `notes.md`) maps to the folder structure. Rename and move.                                                                                                                                                                                            |
| `TaskExecutor`     | **Replace.** Working agent reads `task.json` + `plan.md` from folder, not DB fields. Spawn pattern changes from `createBrainQuery` to independent Agent SDK session with folder context (NOT a subagent of Conversation Nina).                                                                            |
| `TaskProcessor`    | **Partially keep.** Delivery routing logic (DeliveryExecutor, channel sending) is reusable. The "deliver back to source conversation" logic needs updating to use folder's `task.json.delivery.channel`.                                                                                                  |
| `TaskScheduler`    | **Replace.** Replaced by Orchestrator — single stateless background worker handling scheduling, spawning, health monitoring.                                                                                                                                                                              |
| `TaskExtractor`    | **Redesign.** Current design runs a separate Haiku call after each brain turn. Under new architecture, Conversation Nina creates task folders directly (via MCP tool or file write). The extractor may become a lighter "should I create a folder?" classifier, or the brain writes `task.json` directly. |
| `DeliveryExecutor` | **Keep.** Channel delivery logic is independent of task storage model.                                                                                                                                                                                                                                    |

### Migration notes

1. All existing task rows in SQLite need folder creation (or can be abandoned — tasks are ephemeral).
2. The `task_conversations` junction table → replaced by `task.json`'s `createdBy.conversationId` field.
3. SDK session IDs in `tasks.sdk_session_id` → no longer needed (working agents are fresh spawns, not resumed sessions).
4. The `sessionId` field concept (shared across recurrence occurrences) maps to the shared folder — all occurrences write to the same `ongoing_responsibilities/` folder.

---

## 2. Calendar / Scheduling System

### What it does today

Three layers:

| Layer             | Location                                            | Role                                                     |
| ----------------- | --------------------------------------------------- | -------------------------------------------------------- |
| CalDAV client     | `packages/core/src/calendar/caldav-client.ts`       | Speaks CalDAV to Radicale server                         |
| CalendarScheduler | `packages/core/src/calendar/scheduler.ts`           | Polls for upcoming events, fires `onEventFired` callback |
| EventHandler      | `packages/dashboard/src/scheduler/event-handler.ts` | Creates Task entities from fired events                  |

**`CalDAVClient`** (`caldav-client.ts`): Full CalDAV implementation using `tsdav` + `ical-expander`. Handles recurring event expansion (RRULE), all-day events, X-MYAGENT-\* custom properties (`X-MYAGENT-TASK-ID`, `X-MYAGENT-TASK-TYPE`, `X-MYAGENT-ACTION`). Also does create/update/delete.

**`CalendarScheduler`** (`scheduler.ts`): Polls Radicale every 60s with a 5-minute look-ahead window. Tracks fired events in a JSON file (`runtime/fired-events.json`) to survive restarts. Key limitation: fires events once, tracks by `uid:isoTimestamp` key. Does NOT have a concept of "this CalDAV event was spawned from a task folder."

**`EventHandler`** (`event-handler.ts`): When an event fires, checks if `event.taskId` is set (linked task from conversation). If so, finds and executes that task. Otherwise, creates a new Task entity in SQLite from the event fields. Logs execution to the "Scheduled Events" internal conversation. This is the **root of the delivery bug** — the EventHandler never routes results back to the user's channel.

**`calendar.ts` (routes)**: REST API backed by CalDAVClient directly. FullCalendar on the frontend reads from `/api/calendar/events`. Write operations (create/update/delete) go through CalDAV.

**`CalendarContext`** (`context.ts`): Formats upcoming events as a text block injected into brain system prompts.

### Dependencies

- **Uses:** Radicale server (external dependency), `tsdav`, `ical-expander`, `TaskManager`, `ConversationManager`
- **Used by:** `index.ts` (scheduler startup), `session-manager.ts` (calendar context in brain prompt), `task-executor.ts` (calendar context for task brain prompt), StatePublisher (live calendar events)
- **Frontend:** FullCalendar reads `/api/calendar/events` and `/api/calendar/configs`

### Impact under new architecture

**Radicale eliminated.** Calendar view backed by folder-derived SQLite index.

| Component            | Disposition                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CalDAVClient`       | **Eliminate.** No more external CalDAV server dependency.                                                                                                                                                                                                                                                                                                                                           |
| `CalendarScheduler`  | **Replace.** CalendarScheduler and EventHandler are unified into a single **Orchestrator** — a stateless background worker that watches task folders, handles scheduling, spawns working agents, and monitors health. Instead of polling Radicale, it polls the SQLite index built from task folders. Triggered by `task.json.schedule.scheduledFor`. Recurrence handled by our own RRULE expander. |
| `EventHandler`       | **Eliminate.** Unified into the Orchestrator (see above). Its job (fire event → create task → execute) becomes: Orchestrator fires → working agent spawned directly from folder.                                                                                                                                                                                                                    |
| `calendar.ts` routes | **Rewrite.** `GET /api/calendar/events` reads from SQLite task index. `POST /api/calendar/events` creates task folders. `PATCH` updates `task.json`.                                                                                                                                                                                                                                                |
| `CalendarContext`    | **Keep shape.** Format changes (reads from SQLite instead of CalDAV), but the concept of injecting upcoming context into brain prompt is preserved.                                                                                                                                                                                                                                                 |
| `fired-events.json`  | **Eliminate.** Scheduler tracks execution in `task.json.status` instead.                                                                                                                                                                                                                                                                                                                            |

### Migration notes

1. Existing Radicale events can't be auto-migrated — they live in a separate CalDAV store without folder equivalents.
2. All new event creation goes through `POST /api/tasks` (which creates the folder) rather than `POST /api/calendar/events` (which wrote to Radicale).
3. RRULE expansion must be implemented in-process (was handled by `ical-expander` via CalDAV). Consider keeping `ical-expander` as a library dependency for this.
4. The `X-MYAGENT-*` custom properties that linked CalDAV events to task IDs are no longer needed — the folder IS the task.

---

## 3. Conversation System

### What it does today

| File              | Role                                                                       |
| ----------------- | -------------------------------------------------------------------------- |
| `manager.ts`      | High-level API: create, append, list, get, search                          |
| `db.ts`           | SQLite schema: `conversations`, `turns_fts`, `tasks`, `task_conversations` |
| `transcript.ts`   | JSONL transcript files in `.my_agent/conversations/{id}.jsonl`             |
| `types.ts`        | `Conversation`, `TranscriptTurn`, `TranscriptEvent`, etc.                  |
| `idle-timer.ts`   | Triggers abbreviation after 10-min idle                                    |
| `abbreviation.ts` | Compresses old conversations into ~200-token summaries                     |
| `naming.ts`       | Auto-names conversations using Haiku after turn 5                          |
| `attachments.ts`  | Saves image/file attachments                                               |

**`ConversationManager`**: The main API. Coordinates: transcript write (JSONL), FTS index (SQLite), metadata (SQLite). Every conversation has a stable `conv-{ulid}` ID.

**`db.ts`** (`ConversationDatabase`): The combined agent database — contains both `conversations` and `tasks` tables in the same SQLite file (`agent.db`). Also has `task_conversations` junction. Stores SDK session IDs for both conversations (`sdk_session_id`) and tasks.

**`agent.db`** structure (current): conversations, turns_fts, tasks, task_conversations, plus indexes.

**Session Manager** (`session-manager.ts`): One `SessionManager` instance per active conversation. Holds SDK session state, handles resume vs. fresh start, injects calendar context and conversation ID into system prompt. Memory MCP server is wired here (`sharedMcpServers`). Hooks (safety + audit) are also wired per session.

**`chat-handler.ts`**: WebSocket handler — the brain's conversation entry point. Handles: message routing, streaming brain responses, task extraction after each turn, conversation CRUD, attachment handling, model selection, slash commands (`/new`, `/model`, `/my-agent:*`), session management.

### Dependencies

- **Uses:** `TranscriptManager`, `ConversationDatabase`, `SessionManager`, `TaskExtractor`, `TaskProcessor`
- **Used by:** `ChannelMessageHandler` (external channel messages), `TaskProcessor` (delivery back to conversations), `EventHandler` (scheduler conversation logging)
- **Database shared with tasks:** Same `agent.db` via `conversationManager.getDb()`

### Impact under new architecture

**Conversation system is largely preserved** — it maps directly to Conversation Nina's role.

| Component                           | Disposition                                                                                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConversationManager`               | **Keep.** Conversation Nina lives in this system.                                                                                            |
| `db.ts` (conversation schema)       | **Keep.** Conversations stay in SQLite. Tasks migrate to folders + index.                                                                    |
| `db.ts` (task schema)               | **Evolve.** `tasks` table becomes a lightweight index of folder contents. Schema changes significantly.                                      |
| `transcript.ts`                     | **Keep.** JSONL transcripts are the conversation history.                                                                                    |
| `session-manager.ts`                | **Keep for Conversation Nina.** Working agents get a different session builder — fresh spawns with folder context, not conversation context. |
| `chat-handler.ts` (task extraction) | **Replace.** Haiku extraction call replaced by Conversation Nina using a folder-creation MCP tool directly.                                  |
| `IdleTimer` / `AbbreviationQueue`   | **Keep.** Conversation lifecycle management stays.                                                                                           |
| `task_conversations` table          | **Eliminate.** Replaced by `task.json.createdBy.conversationId`.                                                                             |

### Migration notes

1. The `chat-handler.ts` task extraction block (~L1255–1330) is the key place where the current architecture creates tasks. This entire block gets replaced by Conversation Nina using a file-writing MCP tool to create task folders.
2. Conversation-to-task linking (currently via `task_conversations` junction table) becomes a field in `task.json`: `createdBy: { type: "conversation", conversationId: "conv-..." }`.
3. The system prompt injection of conversation ID (line 233: `systemPrompt += "Current conversation ID: ${this.conversationId}"`) becomes the mechanism for Conversation Nina to know where she's operating — preserved.

---

## 4. Channel System

### What it does today

| File                 | Role                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `manager.ts`         | Plugin registry, lifecycle (connect/disconnect/reconnect), message dedup+debounce, status tracking |
| `message-handler.ts` | Routes messages: token auth, owner messages → brain, external messages → external store            |
| `external-store.ts`  | Stores non-owner messages for future trust tier system                                             |
| `mock-plugin.ts`     | Test plugin (no real connection)                                                                   |

**`ChannelManager`**: Plugin-based architecture. Each channel (e.g., WhatsApp/Baileys) is a plugin instance. Features: exponential backoff reconnection, watchdog timer (30-min silence → reconnect), message deduplication (`DedupCache`), debouncing for rapid multi-message sequences. Sends typing indicators.

**`ChannelMessageHandler`**: The bridge between channels and the brain. Owner messages → `SessionRegistry.getOrCreate()` → `SessionManager.streamMessage()` → reply back via channel. Also handles `/new` and `/model` slash commands.

### Dependencies

- **Uses:** `ConversationManager`, `SessionRegistry`, `ConnectionRegistry`, `ChannelPlugin` interface
- **Used by:** `DeliveryExecutor` (outbound delivery), `index.ts` (initialization), `chat-handler.ts` (channel status broadcasts)
- **Plugin interface:** Implemented by `channel-whatsapp` package (Baileys)

### Impact under new architecture

**Channel system stays largely intact.** It's the I/O layer, not the storage or execution layer.

| Component               | Disposition                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChannelManager`        | **Keep.** Plugin architecture is correct.                                                                                                                                                 |
| `ChannelMessageHandler` | **Keep for Conversation Nina.** When WhatsApp message arrives → Conversation Nina handles it → creates task folder if needed → working agent runs. The channel message flow is unchanged. |
| `DeliveryExecutor`      | **Keep.** Delivery from working agents to channels stays the same. Needs one change: working agent specifies delivery channel in `task.json.delivery.channel` (or "default").             |
| `ExternalMessageStore`  | **Keep.** S3 trust tier is separate concern.                                                                                                                                              |

### Migration notes

1. `DeliveryExecutor` currently finds the "first Baileys channel" and uses `ownerJid` for WhatsApp delivery. The new architecture needs a "default channel" concept: user preference in config or notebook. `task.json.delivery.channel = "default"` must resolve to the actual channel + JID.
2. The "default channel" setting (open question #10 in the design doc) could live in `.my_agent/config.yaml` as `defaultDeliveryChannel`.

---

## 5. Memory / Notebook System

### What it does today

**`packages/core/src/memory/`**:

| File                | Role                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `memory-db.ts`      | SQLite with sqlite-vec: chunks, FTS5, vector embeddings, embedding cache    |
| `search-service.ts` | Hybrid search: FTS5 (BM25) + vector cosine similarity                       |
| `sync-service.ts`   | Watches `notebook/` folder, re-indexes changed files                        |
| `chunker.ts`        | Splits markdown files into ~400-token chunks                                |
| `embeddings/`       | Plugin system for embedding providers (local/Ollama)                        |
| `tools.ts`          | `recall()`, `remember()`, `dailyLog()`, `notebookRead()`, `notebookWrite()` |

**`packages/core/src/mcp/memory-server.ts`**: Wraps memory tools as MCP tools via Agent SDK. Exposes: `recall`, `remember`, `daily_log`, `notebook_read`, `notebook_write`. This is wired into brain sessions via `sharedMcpServers` in `session-manager.ts`.

**`packages/core/src/mcp/task-server.ts`**: **Stub only.** Returns "Not implemented yet" for all tools. Was never built out.

**Notebook structure**: `.my_agent/notebook/` — markdown files organized by category (lists, reference, knowledge). Watched by `SyncService` for real-time indexing.

### Dependencies

- **Uses:** `better-sqlite3`, `sqlite-vec`, `ical-expander`, Ollama (external)
- **Used by:** `session-manager.ts` (MCP memory tools in every brain session), `index.ts` (memory system initialization), StatePublisher (memory stats to dashboard)

### Impact under new architecture

**Memory system is largely preserved and extended.**

| Component                | Disposition                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notebook + memory tools  | **Keep.** Both Conversation Nina and working agents need `recall`/`remember`.                                                                                                                           |
| `memory-server.ts` (MCP) | **Keep for both agents.** Both get the same memory MCP server.                                                                                                                                          |
| `task-server.ts` (MCP)   | **Replace entirely.** Working agents need real task tools: `create_task_folder()`, `update_task_status()`, `read_task_folder()`. Conversation Nina needs: `create_task_folder()`, `read_task_status()`. |
| Memory database          | **Keep.** Still indexes notebook files.                                                                                                                                                                 |
| SyncService              | **Keep.** Notebook file watching is independent.                                                                                                                                                        |

### Migration notes

1. The `task-server.ts` stub is the natural home for new MCP tools that Conversation Nina uses to create task folders. This needs a complete implementation.
2. Open question #1 (how do working agents access memory?): working agents get the same `createMemoryServer()` MCP wiring as conversation sessions. The only difference is their system prompt — lean execution context instead of full personality.
3. Working agents also need a `task_folder` MCP tool set: read `task.json`, update `plan.md`, write to `deliverables/`.

---

## 6. Brain / Agent SDK Integration

### What it does today

**`packages/core/src/brain.ts`**: `createBrainQuery()` wrapper around the Agent SDK `query()` function. Used by: `SessionManager` (conversation brain), `TaskExecutor` (task brain), `TaskExtractor` (Haiku extraction calls), `AbbreviationQueue` (abbreviation generation).

**`packages/core/src/agents/definitions.ts`**: Three `AgentDefinition` entries: `researcher`, `executor`, `reviewer`. These are registered as subagents in brain sessions — the brain can delegate to them via the Task tool. However, these are Claude Code-style subagents (file system access), not the working agent concept in the new architecture.

**`packages/core/src/hooks/`**: Safety + audit hooks. `factory.ts` creates `HookCallbackMatcher[]` for the "brain" trust level. Hooks check file writes against guardrails patterns. Wired via `createHooks()` in `session-manager.ts`.

**`packages/core/src/mcp/`**: Memory server (active), task server (stub), channel server (unread, likely another stub).

### Dependencies

- **Used by:** `SessionManager` (conversation), `TaskExecutor` (task execution), `TaskExtractor` (extraction), `AbbreviationQueue` (abbreviation)
- **Agent SDK version:** Using stable `query()` API, `createSdkMcpServer()`, `AgentDefinition`

### Impact under new architecture

**Split into two distinct brain builders.**

| Component                  | Disposition                                                                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBrainQuery()`       | **Keep.** Still the SDK wrapper.                                                                                                                                                                                                                                                                                      |
| `SessionManager`           | **Keep for Conversation Nina.** Unchanged.                                                                                                                                                                                                                                                                            |
| New: `WorkingAgentSession` | **New file needed.** Spawns a working agent: reads task folder, builds lean system prompt, has task-specific MCP tools. Fresh spawn by default. Ongoing tasks can opt into session resumption via `task.json.sessionPolicy: "resume"`. All MCP tools write to folder as side effect — folder state is always current. |
| `coreAgents` definitions   | **Evolve.** Current definitions are Claude Code tools (Read, Write, etc.). Working agents for scheduling tasks need different tools (channel delivery, task folder access, memory).                                                                                                                                   |
| Hooks                      | **Keep.** Both agent types should have safety + audit hooks.                                                                                                                                                                                                                                                          |
| `task-server.ts` MCP       | **Implement.** Real task folder tools for both agent types (see section 5).                                                                                                                                                                                                                                           |

### Migration notes

1. The new `WorkingAgentSession` builds its system prompt from: lean execution role + task folder contents (`task.json`, `plan.md`, `notes.md`) + memory recall results.
2. Default: fresh spawns (no SDK session resumption). Ongoing tasks can opt in via `task.json.sessionPolicy: "resume"` — DB index stores session ID for those tasks only.
3. **Tool-based folder enforcement:** All working agent MCP tools write to folder as a side effect. `Stop` hook as safety net for interrupted sessions.
4. The `assembleSystemPrompt()` in `packages/core/` assembles the brain's personality prompt. A parallel `assembleWorkingAgentPrompt()` function is needed.
5. Hooks should be wired to both agent types — safety is non-negotiable for working agents too.

---

## 7. Dashboard Wiring (`index.ts`)

### What it does today

`packages/dashboard/src/index.ts` is the composition root. It initializes all systems in order:

1. Find `agentDir`, check hatched/auth
2. `ConversationManager` + `AbbreviationQueue`
3. Fastify server
4. `ChannelManager` + `ChannelMessageHandler` (wired to `SessionRegistry`)
5. `TaskManager` + `TaskLogStorage` + `TaskExecutor` + `TaskProcessor` + `TaskScheduler`
6. `CalendarScheduler` (only if Radicale config exists)
7. `StatePublisher` (live WS state updates)
8. Memory system (`MemoryDb`, `SyncService`, `SearchService`, `PluginRegistry`)
9. `initMcpServers()` (wires memory MCP tools into brain sessions)
10. `HealthMonitor`

All services are attached to the Fastify server instance as properties (e.g., `server.taskManager`, `server.statePublisher`).

### Impact under new architecture

| Change                                          | Impact                                                                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CalendarScheduler + EventHandler → Orchestrator | Initialization step 6 changes from "connect to Radicale" to "start Orchestrator (folder-watching scheduler + agent spawner + health monitor)"                                    |
| TaskManager becomes folder-based                | Step 5 changes — no more `new TaskManager(db, agentDir)` requiring a DB                                                                                                          |
| New: WorkingAgentSession builder                | New initialization: load the working agent prompt template, create MCP server with task folder tools                                                                             |
| New: Orchestrator                               | New initialization: start the Orchestrator that watches task folders, handles scheduling, spawns working agents, and monitors health. Replaces CalendarScheduler + EventHandler. |
| Task folder watcher                             | New component: watches `.my_agent/{ad_hoc,ongoing_responsibilities,projects,custom_tools}/` for new/changed folders, updates SQLite index                                        |

---

## 8. Frontend (`packages/dashboard/public/`)

### What it does today

**Alpine.js stores** (`stores.js`):

- `tasks`: items array + loading flag
- `calendar`: events array + configs array
- `conversations`: items array
- `memory`: stats + loading
- `connection`: WebSocket status

**WebSocket client** (`ws-client.js`): Handles `state:tasks`, `state:calendar`, `state:conversations`, `state:memory` messages → updates stores → reactive UI.

**`app.js`** (4,618 lines): The main Alpine.js component. Key features:

- Tab system: `home`, `calendar`, task tabs (dynamic), conversation tabs (dynamic)
- Timeline (`timelineItems` computed): merges tasks + calendar events sorted by time. Currently reads from both `Alpine.store("tasks")` and `Alpine.store("calendar")`.
- FullCalendar integration: main calendar view (Calendar tab) + mini calendar (Home tab)
- Task detail panels: open as tabs with task data, work plan, delivery status
- Calendar event detail: opens task view if event has `taskId`

**`calendar.js`** (327 lines): Manages the mini calendar on the Home tab. Reads from `/api/calendar/events?from=&to=`.

### Impact under new architecture

**Timeline is the biggest UI change.** Currently shows tasks + calendar events as separate concepts. Under new architecture, all scheduled items are tasks with folders — the timeline shows one unified list.

| Component             | Disposition                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks` store         | **Evolve.** Items now represent folder-backed tasks. Schema changes (status, folder path, etc.).                                                         |
| `calendar` store      | **Evolve.** Calendar events are now just tasks with `scheduledFor` dates. The `calendar` store may merge with `tasks` or become a filtered view.         |
| `conversations` store | **Keep.** Unchanged.                                                                                                                                     |
| `memory` store        | **Keep.** Unchanged.                                                                                                                                     |
| Timeline              | **Keep shape, change data source.** Currently merges two stores; under new arch both come from the same `/api/tasks` endpoint filtered by schedule type. |
| FullCalendar          | **Keep.** Still reads from `/api/calendar/events` (now backed by task folder index). Drag-and-drop → updates `task.json.schedule.scheduledFor`.          |
| Task detail panels    | **Evolve.** Show `plan.md` content, `deliverables/` list, `notes.md`.                                                                                    |
| Calendar event detail | **Keep behavior.** Clicking event opens task folder view.                                                                                                |

### Migration notes

1. The `GET /api/calendar/events` endpoint stays but its backing changes (SQLite task index instead of Radicale).
2. New endpoints needed: `GET /api/tasks/:id/plan` (returns `plan.md`), `GET /api/tasks/:id/deliverables` (lists deliverables folder).
3. The `state:calendar` WebSocket message can be eliminated if calendar events are unified with `state:tasks`.

---

## Cross-Cutting Issues

### The Delivery Bug (origin of this architecture change)

The bug: scheduled events fired by `CalendarScheduler` → `EventHandler` → `TaskExecutor.run()` → result logged to "Scheduled Events" internal conversation only. Never delivered to WhatsApp.

**Root cause in code:** `EventHandler.spawnEventQuery()` (line 193) calls `executor.run()` but never calls `TaskProcessor.executeAndDeliver()`. The delivery path (`DeliveryExecutor` → WhatsApp) is in `TaskProcessor`, not `TaskExecutor`. So CalDAV-spawned tasks bypass delivery entirely.

**Fix in current arch (short-term):** `EventHandler` should use `TaskProcessor.executeAndDeliver()` instead of `executor.run()`.

**Fix in new arch (long-term):** Working agent reads `task.json.delivery.channel`, delivers via MCP tool or direct channel call. No separate path for scheduled vs. conversation-spawned tasks.

### SDK Session IDs

Current: `ConversationDatabase` stores SDK session IDs for both conversations and tasks (fields `sdk_session_id` in both tables). Used for resuming SDK sessions across turns/runs.

**Under new architecture:**

- Conversation Nina: keeps SDK session resumption (unchanged).
- Working agents: no session resumption needed — folder is the state. The `sdk_session_id` on tasks can be dropped.

### The "Scheduled Events" Internal Conversation

`EventHandler` creates/uses a `SCHEDULER_CHANNEL = "system"` conversation titled "Scheduled Events" to log task executions. This was a workaround for the delivery bug — results go somewhere visible.

**Under new architecture:** Working agents log their output to the task folder's `deliverables/`. The "Scheduled Events" conversation can be eliminated. Results are visible in the task folder view in the dashboard.

### Task Creation Flow (current vs. new)

**Current:**

```
User message → Brain responds → chat-handler calls extractTaskFromMessage()
  → Haiku extraction call → Task created in SQLite → TaskProcessor.onTaskCreated()
```

**New:**

```
User message → Conversation Nina responds → Nina calls create_task_folder() MCP tool
  → Folder created in .my_agent/{ad_hoc,ongoing_responsibilities,projects,custom_tools}/{date}-{slug}/
  → task.json written → DB index updated → Working agent spawned (or scheduled)
```

The Haiku extraction step is eliminated. Conversation Nina decides when to create a task folder and writes it directly. This is more reliable (no JSON parsing failures) and gives the brain full control over task structure.

### Memory Access for Working Agents

Open question #1 from the design doc: working agents need memory access.

**Current implementation path:** `initMcpServers()` in `session-manager.ts` creates a shared `createMemoryServer()` instance used by all conversation sessions. The same pattern can apply to working agents — pass `sharedMcpServers` to the `WorkingAgentSession` builder.

The working agent system prompt should include a brief instruction to recall relevant context before starting work.

---

## Impact Summary Table

| System                           | Current State                | Disposition                                                                               | Effort     |
| -------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- | ---------- |
| Task storage (SQLite)            | Source of truth              | → Derived index from folders                                                              | High       |
| Task folders                     | Does not exist               | → Primary task state                                                                      | High (new) |
| TaskManager                      | Full CRUD                    | Refactor to folder + index                                                                | High       |
| TaskExecutor                     | Brain query spawner          | → Working agent spawner                                                                   | High       |
| TaskProcessor                    | Delivery orchestrator        | Partial keep (delivery logic)                                                             | Medium     |
| TaskExtractor (Haiku)            | Post-turn extraction         | → Eliminate, Nina creates directly                                                        | Medium     |
| TaskScheduler                    | SQL poller                   | → Replaced by Orchestrator                                                                | Medium     |
| DeliveryExecutor                 | Channel sender               | Keep                                                                                      | Low        |
| CalDAVClient                     | Radicale client              | Eliminate                                                                                 | Medium     |
| CalendarScheduler + EventHandler | CalDAV poller + event bridge | → Unified into Orchestrator (folder watcher + scheduler + agent spawner + health monitor) | Medium     |
| Calendar routes                  | CalDAV-backed REST           | Rewrite (folder-backed)                                                                   | Medium     |
| ConversationManager              | Full conversation system     | Keep                                                                                      | None       |
| SessionManager (Nina)            | Conversation brain           | Keep                                                                                      | None       |
| WorkingAgentSession              | Does not exist               | New component                                                                             | High (new) |
| ChannelManager                   | Plugin system                | Keep                                                                                      | None       |
| ChannelMessageHandler            | Message router               | Keep                                                                                      | None       |
| Memory MCP tools                 | Active on Nina               | Keep, extend to workers                                                                   | Low        |
| Task MCP tools (stub)            | Not implemented              | Implement for folders                                                                     | High       |
| Frontend stores                  | tasks + calendar split       | Evolve to unified                                                                         | Medium     |
| Frontend timeline                | Merges two stores            | Simplified (one source)                                                                   | Low        |
| Frontend task detail             | DB-backed fields             | Folder-backed (plan.md etc.)                                                              | Medium     |
| agent.db schema                  | Tasks + conversations        | Conversations stay, tasks index                                                           | Medium     |

---

## Open Questions Answered by This Audit

From the design doc's open questions list:

**Q1: Memory system integration for working agents?**
→ Same `createMemoryServer()` MCP pattern. Both agents get the memory MCP server. Working agent system prompt includes "recall relevant context before starting."

**Q2: Conversation linking?**
→ `task.json.createdBy.conversationId` replaces the `task_conversations` junction table. The conversation ID is captured at folder creation time, not inferred later.

**Q4: Current codebase mapping?**
→ This document.

**Q5: M6.6 Agentic Lifecycle as ongoing task folders?**
→ Yes. Morning prep, heartbeat, daily summary become `ongoing_responsibilities/` folders with recurrence rules in `task.json`. The Orchestrator watches for due recurring tasks and spawns working agents.

**Q6: M7 Coding Projects subsumed?**
→ Largely yes. Working agents run in folders with full file system access (tools: Read, Write, Edit, Bash, etc.). The `executor` `AgentDefinition` already defines this kind of agent. The main addition needed for coding projects is: streaming progress to dashboard, multi-phase support (plan → execute → review).

**Q7: Recurrence without Radicale?**
→ `ical-expander` can be kept as a library for RRULE expansion without the CalDAV layer. Or implement simple recurrence rules in-process. The `task.json.recurrence` field holds the rule; the scheduler expands it.

**Q8: Migration path for existing tasks?**
→ Existing tasks in SQLite and CalDAV events are abandoned (they're mostly test data). New system starts fresh. Document the reset procedure.

---

_Created: 2026-03-02 | Updated: 2026-03-03_
_Author: Codebase Expert agent (claude-sonnet-4-6)_
