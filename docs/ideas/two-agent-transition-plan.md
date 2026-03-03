# Two-Agent Architecture: Gap Analysis + Consolidated Transition Plan

> **Status:** Planning — synthesizes idea doc, codebase audit, and roadmap analysis
> **Created:** 2026-03-02 | **Updated:** 2026-03-03
> **Author:** Coverage Agent (team synthesis)
> **Source documents:**
>
> - `docs/ideas/two-agent-architecture.md` — the original idea
> - `docs/ideas/two-agent-codebase-audit.md` — codebase expert's audit
> - `docs/ideas/two-agent-roadmap-impact.md` — roadmap expert's analysis
>   **CTO discussion:** 14 required discussion points (a–n) + 4 CTO-level concerns (o–r)

---

## Part 1: Gap Analysis

Cross-check of all 14 CTO discussion points and 4 CTO-level concerns against the two audits. Each item is rated: **Covered** (fully addressed), **Partial** (mentioned but needs elaboration), or **Gap** (not addressed or left unresolved).

---

### Discussion Points (Required Coverage)

#### a. Two agent types: Conversation Nina (reactive, in-channel replies, full personality) vs. Working Agent (proactive, task-bound, lean prompt, fleet model)

**Status: Covered**

Both audits address this clearly. The idea doc defines the two roles with a comparison table. The codebase audit maps the split to concrete code: `SessionManager` stays for Conversation Nina, a new `WorkingAgentSession` is created for working agents. The roadmap audit confirms the split throughout every milestone analysis.

**Gap:** Neither audit addresses the "fleet model" cost implications explicitly. The fact that N ongoing tasks = N separate agent sessions with N system prompts is mentioned implicitly but not analyzed for cost or batching. See concern (r) below.

---

#### b. Folder as source of truth: task.json + plan.md + deliverables/ + notes.md. Both agents read/write the same folder.

**Status: Covered**

The idea doc defines the folder structure in detail. The codebase audit confirms both agents read/write the same folder (section 1: "Task System"). The `task.json` schema is fully defined in the idea doc. The roadmap audit confirms this is the "return to original design doc vision."

---

#### c. DB as disposable index: Rebuilt from folder scans. Fast queries for UI. One-way: folder → DB.

**Status: Covered**

All three documents address this. The idea doc states the flow explicitly ("Folder → DB (one-way)"). The codebase audit identifies the specific DB changes needed (`tasks` table becomes derived index). The roadmap audit notes the folder scan + DB index as a critical path item in M6.7-S4.

**Minor gap:** Neither audit specifies the trigger for DB re-indexing. Is it a file watcher (like `SyncService` for the notebook), a post-write hook, or a periodic scan? The codebase audit mentions "task folder watcher" as a new component in section 7 but doesn't specify its mechanism. This needs to be decided in M6.7-S1.

---

#### d. CalDAV/Radicale elimination: Calendar view via FullCalendar backed by our REST API reading from DB. No Radicale dependency. Drag/drop via our API → folder → DB.

**Status: Covered**

The codebase audit dedicates an entire section (section 2) to the calendar system with a clear disposition table: CalDAVClient eliminated, CalendarScheduler refactored, EventHandler eliminated, `calendar.ts` routes rewritten. The roadmap audit quantifies the impact (5 sprints of M4.5 work) and confirms FullCalendar UI is preserved with the same API contract.

**Gap:** Drag-and-drop rescheduling specifically is mentioned in the idea doc but not addressed in either audit. The current FullCalendar drag-and-drop updates CalDAV via `PATCH /api/calendar/events`. The new flow (drag → `PUT /api/tasks/:id` → updates `task.json.schedule.scheduledFor` → DB re-indexes) is not explicitly mapped. The API contract change needs specification.

---

#### e. Recurrence handling: RRULE or equivalent stored in task.json, expanded by our scheduler.

**Status: Covered**

The codebase audit addresses this directly: "RRULE expansion must be implemented in-process (was handled by `ical-expander` via CalDAV). Consider keeping `ical-expander` as a library dependency for this." The idea doc's `task.json` schema includes a `recurrence` field (currently `null`). The roadmap audit includes "RRULE expansion from task.json recurrence field" as a deliverable in M6.7-S3.

**Minor gap:** The `recurrence` field schema is not defined. What format? Full RRULE string (`RRULE:FREQ=DAILY;COUNT=3`)? A simplified JSON structure? This needs definition in M6.7-S1 when `task.json` schema is finalized.

---

#### f. Fresh spawns with living documents: Working agents don't resume sessions. Hooks force document updates. Next spawn reads fresh state.

**Status: Partial**

The idea doc states this as a key principle. The codebase audit confirms: "working agents are fresh spawns" and that `sdk_session_id` on tasks can be dropped. The roadmap audit confirms this replaces the `resume: sessionId` pattern added in M6.5-S2.

**Gap resolved (CTO decision):** The primary mechanism is **tool-based enforcement**, not exit hooks. Every working agent MCP tool (`write_deliverable()`, `update_task_plan()`, `deliver()`, `update_task_status()`) writes to the task folder as a side effect of execution. The folder is always current — reflecting everything up to the last successful tool call. A `Stop` hook serves as a **safety net only** — on interrupted sessions, it writes a brief "interrupted, last known state" note to `notes.md`. This flips the model: instead of "work in session, dump to files at exit," it's "files are updated continuously through tools, session is just the reasoning between tool calls."

---

#### g. Long-lived tasks: Restaurant booking example — same folder, working agent wakes up when subtasks added. Context persists in files, not sessions.

**Status: Partial**

The idea doc introduces the restaurant booking example. The codebase audit mentions long-lived tasks briefly in the context of session resumption (section 6, migration notes). The roadmap audit does not address the restaurant booking pattern specifically.

**Gap:** How does a working agent "wake up when subtasks are added"? The trigger mechanism is undefined. Does Conversation Nina add a subtask to `plan.md` and then explicitly spawn the working agent? Or does the orchestrator watch `plan.md` for changes? This is a fundamental interaction pattern that neither audit addresses. The long-lived task lifecycle (create → block on external input → receive input → continue) needs a concrete flow.

---

#### h. Conversation Nina as task manager: Can read task folders, answer questions about tasks, update plans, add notes, spawn working agents as subagents.

**Status: Covered**

The idea doc covers all five capabilities. The codebase audit confirms: "Conversation Nina creates task folders directly (via MCP tool or file write)" and "task-server.ts stub is the natural home for new MCP tools that Conversation Nina uses to create task folders." The codebase audit also notes Conversation Nina needs `create_task_folder()` and `read_task_status()` tools.

**Minor gap:** "Spawn working agents as subagents" is mentioned in the idea doc but the mechanism is not detailed in either audit. Does Conversation Nina use an Agent SDK subagent call? A task folder creation that triggers immediate spawn? A direct API call to a working agent endpoint? The codebase audit says "working agents run in their own sessions, not as subagents of Conversation Nina" (section 6) — which contradicts the idea doc's "spawns working agents as subagents." This contradiction needs resolution.

---

#### i. Default channel setting: Working agent delivers to user's configured default unless task specifies otherwise.

**Status: Covered**

The codebase audit addresses this directly in section 4: "`task.json.delivery.channel = 'default'` must resolve to the actual channel + JID" and "The 'default channel' setting (open question #10 in the design doc) could live in `.my_agent/config.yaml` as `defaultDeliveryChannel`." The idea doc's `task.json` schema includes the `delivery.channel` field.

---

#### j. Task classification unchanged: Trivial (inline, no folder), ad-hoc (ad_hoc/), project (projects/), ongoing (ongoing_responsibilities/)

**Status: Covered**

The idea doc preserves the four-type classification. Both audits confirm it. The codebase audit maps the `ad_hoc/`, `projects/`, `ongoing_responsibilities/` directories directly to the folder structure. The roadmap audit notes the original design doc had the same classification.

---

#### k. Working agent unique tools: Escalate, request_input, notify — routes through NotificationService.

**Status: Covered**

The idea doc names these three tools. The codebase audit references them (section 6, disposition table: "task-server.ts MCP — Implement"). The roadmap audit lists them as a deliverable in M6.7-S2. The codebase audit confirms NotificationService is reused (M5 component, kept).

**Minor gap:** The routing mechanism is not detailed. When a working agent calls `Escalate`, what exactly happens? Does it: (a) send a WhatsApp message to the user immediately and pause, (b) write to `notes.md` and wait for Conversation Nina to relay, or (c) something else? The NotificationService is identified as the routing layer but its integration with working agents is not specified.

---

#### l. M6.6 integration: Morning prep, heartbeat, daily summary, fact extraction — how do these map to ongoing task folders?

**Status: Covered**

The roadmap audit has a dedicated section on M6.6 with a clear mapping table: morning-prep → `ongoing_responsibilities/morning-prep/`, daily-summary → `ongoing_responsibilities/daily-summary/`, heartbeat → `ongoing_responsibilities/heartbeat/`. Fact extraction stays in `AbbreviationQueue` (unchanged, conversation-idle trigger not a scheduled task). The WorkLoopScheduler is absorbed into the orchestrator.

**Minor gap:** The heartbeat's specific responsibility (scan ongoing folders for due responsibilities) implies the heartbeat working agent reads other task folders. The audit doesn't address what happens if the heartbeat agent's folder scan conflicts with ongoing tasks being modified simultaneously (file system locking, consistency concerns).

---

#### m. Output routing solved: The delivery gap that started this whole discussion. Working agent knows where to deliver because task.json has delivery config + default channel fallback.

**Status: Covered**

This is the origin issue and is addressed throughout all three documents. The codebase audit identifies the exact bug location (`EventHandler.spawnEventQuery()` at line 193 calls `executor.run()` but never calls `TaskProcessor.executeAndDeliver()`). The short-term fix is identified. The long-term fix (working agent reads `task.json.delivery.channel` and delivers directly) is the architecture's core purpose.

---

#### n. The "why" behind the change: Current flow doesn't work. Multiple disconnected execution paths. No unified output routing. DB-based tasks were a shortcut because we never built Claude Code spawning. This returns to the original "folders as sessions" vision.

**Status: Covered**

All three documents address the "why." The roadmap audit has a dedicated section ("Original Design Doc vs. Current Implementation vs. New Architecture") that explicitly shows the deviation table — where M5 implementation diverged from the original folder-based vision. The codebase audit explains the current parallel execution paths (conversation brain vs. CalendarScheduler → EventHandler).

---

### CTO-Level Concerns

#### o. Fresh spawn vs. session resumption tension: Long-lived tasks benefit from accumulated context. Hooks can't reliably extract everything into files. Is session resumption optional for long-lived tasks?

**Status: Gap**

This concern is the most significant unresolved issue in the current audits. The idea doc acknowledges it as an open question. The codebase audit states "working agents are fresh spawns" as a principle but then notes in section 6 migration: "working agents: no session resumption needed — folder is the state." The roadmap audit doesn't address the tension at all.

**What's missing:** A decision on whether session resumption is available as an opt-in for long-lived tasks. Specific scenarios where session context exceeds what can be written to files need to be identified. A concrete policy is needed:

- Option A: All working agents are always fresh spawns. Period. Hooks must capture sufficient state.
- Option B: Ongoing tasks can opt into session resumption via `task.json.sessionPolicy: "resume"`.
- Option C: Hybrid — first spawn is fresh, subsequent spawns resume if session is recent (e.g., < 1 hour old), otherwise fresh.

This decision directly affects the architecture. If Option B or C is chosen, the DB needs to store session IDs for ongoing tasks, which complicates "DB as disposable index."

---

#### p. Radicale rebuild cost: 5 sprints of calendar work being replaced. Is the purity worth the cost? Can Radicale stay as derived projection?

**Status: Partial**

The roadmap audit acknowledges the cost ("5 sprints of CalDAV work... produced infrastructure that is now being replaced") but concludes elimination is correct without fully arguing the case. The audit notes "the FullCalendar UI is preserved" and "RRULE concepts" survive.

**What's missing:** A clear cost-benefit analysis comparing:

- **Keep Radicale as derived projection:** Task folder creation triggers a CalDAV write. Orchestrator reads from CalDAV (preserved). Frontend unchanged. Cost: bidirectional sync complexity, continued Radicale dependency.
- **Eliminate Radicale:** Implement new `/api/calendar/events` endpoint, rewrite `CalendarScheduler`. Cost: ~1 sprint. Benefit: no external dependency, no sync complexity, folder is the single source of truth.

The case for elimination is sound (no external dependency, no sync bugs, folders ARE the state) but should be stated explicitly in the plan for stakeholder clarity.

---

#### q. Migration gradualness: Big-bang rewrite vs. task-type-by-task-type migration vs. adapter layer?

**Status: Partial**

The roadmap audit proposes a 5-sprint M6.7 with a logical sequence. The codebase audit identifies migration notes per system. But neither audit explicitly frames the migration strategy in terms of the three options the CTO raised.

**What's missing:** An explicit decision between:

- **Big-bang:** Cut over all task execution to the new model in one sprint. High risk, fast.
- **Task-type-by-task-type:** First migrate `ongoing_responsibilities/` tasks, then `ad_hoc/`, then `projects/`. Calendar stays on Radicale until the last task type is migrated. Gradual.
- **Adapter layer:** Keep existing `TaskExecutor` running. New `WorkingAgentSession` added alongside. New tasks use folders. Old tasks use DB. Maintained in parallel until old tasks expire.

The M6.7 sprint plan in the roadmap audit is closest to task-type-by-task-type but doesn't commit to that framing or address what happens to in-flight tasks during the transition. The transition plan below adopts a clear strategy.

---

#### r. Fleet cost model: 20 ongoing tasks = 20 separate API calls with 20 system prompts. Is batching needed?

**Status: Gap**

This concern is not addressed in either audit. The idea doc mentions "a fleet of working agents" and "not one background worker — many" but does not analyze cost implications.

**What's missing:** An analysis of:

1. How many ongoing tasks are expected in practice (the 20-task scenario is a real question)
2. Whether batching is architecturally feasible (can one agent handle multiple task folders per invocation?)
3. Whether lean system prompts mitigate the cost (each working agent has a lean prompt — less context = lower cost than Conversation Nina)
4. Whether staggered scheduling is sufficient (20 tasks scheduled at different times means they don't all run simultaneously)

This needs a position. The plan below recommends a staggered-first approach with batching deferred.

---

### Gap Summary

| Point                                | Status      | Action Required                                                                                                    |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| a. Two agent types                   | Covered     | None                                                                                                               |
| b. Folder as source of truth         | Covered     | None                                                                                                               |
| c. DB as disposable index            | Covered     | Define re-indexing trigger in M6.7-S1                                                                              |
| d. CalDAV/Radicale elimination       | Covered     | Specify drag-and-drop API contract change                                                                          |
| e. Recurrence handling               | Covered     | Define `recurrence` field schema in M6.7-S1                                                                        |
| f. Fresh spawns + hooks              | **Partial** | Spec the "hooks force document update" mechanism                                                                   |
| g. Long-lived task wakeup            | **Partial** | Define trigger for working agent re-spawn on subtask add                                                           |
| h. Conversation Nina as task manager | Covered     | ~~Resolve "subagent vs. separate session" contradiction~~ → Resolved: separate sessions, not subagents (S2 item 7) |
| i. Default channel setting           | Covered     | None                                                                                                               |
| j. Task classification unchanged     | Covered     | None                                                                                                               |
| k. Working agent tools               | Covered     | Spec Escalate routing flow in detail                                                                               |
| l. M6.6 integration                  | Covered     | Address heartbeat-reads-other-folders consistency                                                                  |
| m. Output routing solved             | Covered     | None                                                                                                               |
| n. The "why"                         | Covered     | None                                                                                                               |
| o. Fresh spawn vs. resumption        | **Gap**     | Decision needed — see three options                                                                                |
| p. Radicale rebuild cost             | Partial     | State the case explicitly in plan                                                                                  |
| q. Migration gradualness             | Partial     | Commit to a strategy                                                                                               |
| r. Fleet cost model                  | **Gap**     | Analysis needed, position needed                                                                                   |

---

## Part 2: Consolidated Transition Plan

### Guiding Principles

1. **Gradual, not big-bang.** At every phase, the system must remain functional. No phase leaves the agent unable to converse or execute tasks.
2. **Ordered by blockers.** Each phase delivers exactly what the next phase requires. No phase starts work that depends on an unfinished prior phase.
3. **Short-circuit fix first.** The delivery bug that triggered this discussion is fixed immediately, before the architecture transition begins.
4. **Folders before workers.** The folder infrastructure (schema, creation, scanning) must exist before working agents can use it.
5. **Calendar last.** Radicale stays alive until the folder-based calendar API is fully validated. FullCalendar never breaks.

---

### Positions on Open Concerns

Before detailing the phases, three explicit decisions are needed:

**On (o) Fresh spawn vs. session resumption:**

> **Decision: Fresh spawns for all task types, with exception for ongoing tasks via opt-in.**
> Default: all working agents are stateless, reading folder for context. Ongoing tasks may specify `sessionPolicy: "resume"` in `task.json` to enable SDK session resumption. If chosen, the DB index stores the session ID for that task only. This keeps the "DB as disposable" principle mostly intact while allowing the restaurant-booking and daily-news-summarizer patterns to accumulate richer context over time. This is revisited in M6.7-S5 after observing real working agent behavior.

**On (p) Radicale rebuild cost:**

> **Decision: Eliminate Radicale. The cost is one sprint, the benefit is permanent.**
> Radicale as a derived projection requires bidirectional sync: every folder change must write to CalDAV, every CalDAV query must stay consistent with folders. This sync complexity negates the "folder as source of truth" principle and reintroduces the exact class of routing bugs we're fixing. One sprint to replace the backend is worth avoiding this indefinitely. FullCalendar's API contract is preserved — only the backend changes.

**On (q) Migration gradualness:**

> **Decision: Adapter layer approach — old and new run in parallel, new tasks use folders, old tasks stay in DB until they expire.**
>
> - Phase 0: Fix the delivery bug in the current architecture (hours, not days).
> - Phase 1 (M6.7-S1–S2): Build folder infrastructure + working agent spawn. New tasks from this point use folders. Old DB tasks continue executing via the old TaskExecutor until they complete.
> - Phase 2 (M6.7-S3): Build orchestrator to handle both DB tasks (legacy) and folder tasks (new).
> - Phase 3 (M6.7-S4): Calendar replacement. Radicale decommissioned.
> - Phase 4 (M6.7-S5): Old DB task infrastructure removed. Full cutover.
>   No big-bang. Old task executor stays alive through Phase 3.

**On (r) Fleet cost model:**

> **Decision: Stagger by design, batch deferred.**
> Working agents have lean system prompts (task context only, no full personality). Each invocation is shorter and cheaper than a Conversation Nina session. For ongoing tasks, natural schedule staggering (morning-prep at 6am, heartbeat every 2h, daily-summary at 11pm) means they don't run simultaneously. Explicit batching (one agent, multiple task folders) is architecturally complex and deferred until observed cost data justifies it. Revisit after 30 days of production data.

---

### Phase 0: Immediate Bug Fix (Before M6.7 Begins)

**Scope:** Fix the delivery bug without any architectural change.

**Duration:** 1–2 hours.

**Change:** `packages/dashboard/src/scheduler/event-handler.ts` — in `spawnEventQuery()`, replace `executor.run()` with `TaskProcessor.executeAndDeliver()`. This routes the CalDAV-fired task result through the same delivery path as conversation-spawned tasks (DeliveryExecutor → WhatsApp).

**Files changed:**

- `packages/dashboard/src/scheduler/event-handler.ts` (line ~193)

**Risk:** Low. This is a targeted fix using existing, tested code paths. DeliveryExecutor and TaskProcessor are already production-tested. No schema changes, no new infrastructure.

**Why before M6.7:** The architecture transition will take multiple sprints. Users experience the delivery bug today. Fix it now, then fix it properly in M6.7.

---

### Phase 0.5: Spike Validation (Between Phase 0 and M6.7)

**Scope:** Validate the three critical integration layers with real code before committing to the full M6.7 sprint plan.

**Duration:** 2–3 days. Real code that becomes the M6.7 foundation — not throwaway prototypes.

**3-Layer Validation Approach:**

1. **Layer 1: Can a working agent read a task folder and deliver to WhatsApp?**
   - Create a minimal `WorkingAgentSession` that reads a hardcoded task folder (`task.json` + `plan.md`)
   - Execute the task and deliver the result to WhatsApp via `ChannelManager.send()`
   - Validates: folder reading, lean prompt assembly, channel delivery end-to-end

2. **Layer 2: Can Conversation Nina create the task folder via MCP tool?**
   - Implement a minimal `create_task_folder()` MCP tool wired to Conversation Nina
   - User says "remind me to X in 5 minutes" → Nina creates task folder with `task.json`
   - Validates: MCP tool wiring, folder creation, `task.json` schema in practice

3. **Layer 3: Can the orchestrator trigger a scheduled task?**
   - Implement a minimal file watcher + scheduler loop that detects task folders with `scheduledFor <= now`
   - Triggers `spawnWorkingAgent()` from Layer 1
   - Validates: file watcher reliability (WSL2 inotify), scheduling logic, spawn lifecycle

**Success Criteria (Measurable):**

| Metric                                         | Target                                               | Failure Action                                       |
| ---------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| File watcher detection latency                 | <1 second                                            | Investigate WSL2 inotify; add polling fallback       |
| Working agent spawn time                       | <5 seconds                                           | Profile prompt assembly; reduce context size         |
| End-to-end delivery (folder create → WhatsApp) | <15 seconds                                          | Identify bottleneck; optimize critical path          |
| Restart recovery                               | Orchestrator resumes all pending tasks after restart | Fix state persistence; ensure folder scan on startup |
| Concurrent spawn (2 tasks due simultaneously)  | Both execute without conflict                        | Add spawn queue or mutex                             |

**Pass/Fail Gate:** All five metrics must pass. If any fails, diagnose root cause and adjust M6.7 plan before proceeding. Spike code becomes M6.7 foundation — not throwaway.

---

### M6.7 Sprint Plan: Two-Agent Refactor

**Milestone:** M6.7 — Two-Agent Refactor
**Position in roadmap:** After M6.5 (complete), before M6.6 (to be refocused)
**Goal:** Replace the DB-centric, single-agent task model with a folder-centric, two-agent model. Deliver all infrastructure needed by M6.6 (ongoing task folders), M7 (working agent as coding executor), and M8 (folder-backed dashboard).

---

#### S1: Task Folder Infrastructure

**Goal:** Folders exist and are the source of truth. DB is a derived index. New tasks use folders.

**Deliverables:**

1. **`task.json` schema finalized** (docs/design/task-schema.md)
   - Fields: `id`, `title`, `type` (trivial/ad-hoc/project/ongoing/custom_tool), `status`, `createdAt`, `createdBy`, `schedule`, `delivery`, `recurrence`, `sessionPolicy`, `autonomy`, `schemaVersion`
   - `schedule.type`: `one-shot | recurring | none`
   - `schedule.scheduledFor`: ISO timestamp
   - `delivery.channel`: channel ID or `"default"`
   - `sessionPolicy`: `"fresh"` (default) | `"resume"` (ongoing tasks only)
   - `autonomy`: `"autonomous"` | `"smart"` | `"supervised"` (matches existing M5 design)
   - `schemaVersion`: integer, starts at `1` — enables future migrations
   - **Note:** Autonomy is mandated in `task.json` only — no cascading defaults from `config.yaml`

   **Recurrence Field Schema:**

   ```json
   {
     "recurrence": "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=0", // Full RFC 5545 RRULE string
     "recurrenceEnd": "2026-12-31T23:59:59Z" // Optional: when recurrence stops (null = forever)
   }
   ```

   - Uses standard RRULE format for `ical-expander` compatibility
   - Examples: `RRULE:FREQ=MINUTELY;INTERVAL=5;COUNT=3` (3 times, 5 min apart), `RRULE:FREQ=DAILY;BYHOUR=7` (daily at 7am)
   - `recurrenceEnd` is optional; omit for indefinite recurrence

   **Schema Versioning Strategy:**
   - `schemaVersion: 1` in every `task.json` from day one
   - Folder scanner checks version; if < current, runs migration function
   - Migration functions in `packages/core/src/tasks/migrations/v{N}.ts`
   - Migrations are idempotent and logged to `notes.md`

2. **Folder conventions** (`.my_agent/tasks/ad_hoc/`, `projects/`, `ongoing_responsibilities/`, `custom_tools/`)
   - Enforced by folder creation API, not by working agents
   - `.my_agent/tools/` as published tools runtime location (custom_tools build here)

3. **`task_templates/` directory** (repo root: `task_templates/`)
   - `ad_hoc.md` — template for ad-hoc tasks
   - `project.md` — template for multi-phase projects
   - `ongoing_responsibility.md` — template for recurring responsibilities
   - `custom_tool.md` — template for custom tool tasks (internal workings TBD)

4. **Folder creation API** (`POST /api/tasks`)
   - Creates folder with `task.json`, empty `plan.md`, empty `notes.md`, empty `deliverables/`
   - Writes to DB index atomically (folder creation + DB insert in one operation)
   - Returns task ID and folder path

5. **Folder scanner** (`packages/core/src/tasks/folder-scanner.ts`)
   - Reads all `task.json` files from all task subdirectories
   - Builds/rebuilds the SQLite task index table
   - DB index schema: `id`, `title`, `type`, `status`, `scheduledFor`, `folderPath`, `updatedAt`

   **DB Re-indexing Trigger Mechanism:**

   | Trigger                    | When                         | Action                                                         |
   | -------------------------- | ---------------------------- | -------------------------------------------------------------- |
   | **File watcher** (primary) | `task.json` created/modified | Re-index single task                                           |
   | **Startup scan**           | Server starts                | Full scan, rebuild entire index                                |
   | **Periodic fallback**      | Every 5 minutes              | Full scan (handles missed watcher events, WSL2 inotify limits) |
   | **Explicit API call**      | `POST /api/tasks/reindex`    | Full scan (admin/debug use)                                    |
   - File watcher uses existing `SyncService` pattern (chokidar)
   - Watcher path: `.my_agent/tasks/**/*.json` (only task.json files)
   - Single-task re-index is debounced (100ms) to handle rapid writes

6. **task-server.ts MCP implementation** (partial — folder tools for Conversation Nina)
   - `create_task_folder(title, type, plan, schedule?, delivery?)` — creates folder + returns ID
   - `read_task_folder(taskId)` — reads `task.json` + `plan.md` + `notes.md`
   - `update_task_plan(taskId, planContent)` — writes `plan.md`
   - `add_task_note(taskId, note)` — appends to `notes.md`

7. **Conversation Nina wiring update** (replaces `TaskExtractor` Haiku call)
   - Remove post-turn Haiku extraction call from `chat-handler.ts` (~L1255–1330)
   - Conversation Nina uses `create_task_folder()` MCP tool directly when she decides a task is needed
   - `task_conversations` junction table dropped; `task.json.createdBy.conversationId` is the link

**Adapter layer:** Old `TaskManager` + `TaskExecutor` still active for existing DB tasks. New tasks go to folders. Both coexist.

**Test expectations:**

- Unit: `task.json` schema validation, folder scanner parses all task types, RRULE string validation
- Integration: `POST /api/tasks` creates folder + DB index entry, file watcher triggers re-index within 1s
- Manual: Create task via Conversation Nina MCP tool, verify folder structure, verify appears in dashboard

**Blockers resolved for S2:** Folder structure exists. Folder creation API works. DB index is populated. Conversation Nina can create task folders.

---

#### S2: Working Agent Spawn

**Goal:** Working agents can run. They read task folders, execute work, deliver results to channels.

**Deliverables:**

1. **`WorkingAgentSession`** (`packages/dashboard/src/agent/working-agent-session.ts`)
   - New file. Builds a lean system prompt from: working agent role + `task.json` contents + `plan.md` + `notes.md` + `notes` from prior deliverables
   - Wires same `sharedMcpServers` as `SessionManager` (memory tools available)
   - Wires additional task folder MCP tools (read/write deliverables, update status)
   - NO SDK session resumption by default (`sessionPolicy: "fresh"`)
   - If `task.json.sessionPolicy === "resume"` and a stored session ID exists in DB index, uses `resume: sessionId`
   - Hooks: same `createHooks()` factory as Conversation Nina — safety is non-negotiable

2. **`assembleWorkingAgentPrompt()`** (`packages/core/src/prompts/working-agent-prompt.ts`)
   - Lean prompt: task context only. No full personality. No conversation history.
   - Includes: task objective, current plan, prior deliverables summary, memory recall instruction, delivery target, available tools list

3. **Working agent MCP tools** (task-server.ts — working agent tools)
   - `update_task_status(taskId, status)` — updates `task.json.status`
   - `write_deliverable(taskId, filename, content)` — writes to `deliverables/`
   - `read_prior_deliverables(taskId, recent?)` — reads `deliverables/` listing + file contents
   - `escalate(taskId, message)` — routes through NotificationService → user's default channel, pauses task
   - `request_input(taskId, question)` — routes through NotificationService, sets task status to `blocked`
   - `notify(taskId, message, channel?)` — sends status update to channel (or default)
   - `deliver(taskId, content, channel?)` — the primary delivery tool. Reads `task.json.delivery.channel`, resolves "default" from `config.yaml:defaultDeliveryChannel`, calls `ChannelManager.send()`

   **Escalate/Notify Routing Spec:**

   | Tool              | Writes to             | Sends to                     | Pauses Agent? | Sets Status                         |
   | ----------------- | --------------------- | ---------------------------- | ------------- | ----------------------------------- |
   | `escalate()`      | `notes.md` (reason)   | delivery channel             | Yes           | `blocked`                           |
   | `request_input()` | `notes.md` (question) | delivery channel             | Yes           | `blocked`                           |
   | `notify()`        | `notes.md` (update)   | specified or default channel | No            | unchanged                           |
   | `deliver()`       | `deliverables/`       | delivery channel             | No            | unchanged (caller sets `completed`) |

   **Pause behavior:** When paused, the working agent session ends gracefully. Conversation Nina (or orchestrator on user reply) must call `spawn_working_agent(taskId)` to resume. The agent reads `notes.md` for the question/escalation context.

4. **Autonomy enforcement** (`packages/core/src/tasks/autonomy-check.ts`)
   - Working agent system prompt includes autonomy level from `task.json.autonomy`
   - Enforcement logic in MCP tool handlers:

   | Autonomy     | External Actions     | Destructive Actions  | Scope Changes        |
   | ------------ | -------------------- | -------------------- | -------------------- |
   | `autonomous` | Allow                | Allow                | Allow                |
   | `smart`      | Allow                | Ask via `escalate()` | Ask via `escalate()` |
   | `supervised` | Ask via `escalate()` | Ask via `escalate()` | Ask via `escalate()` |
   - External actions: sending messages, making API calls, writing outside task folder
   - Destructive actions: deleting files, modifying production data
   - Scope changes: expanding task scope beyond original `plan.md`
   - Enforcement via MCP tool wrappers that check `task.json.autonomy` before proceeding

5. **Working agent spawn function** (`packages/dashboard/src/agent/spawn-working-agent.ts`)
   - `spawnWorkingAgent(taskId)` → reads folder → builds session → runs query → folder is already current on completion
   - **Tool-based enforcement (primary):** Every MCP tool (`write_deliverable()`, `update_task_plan()`, `deliver()`, `update_task_status()`) writes to the task folder as a side effect. The folder reflects all work up to the last successful tool call. No end-of-session dump needed.
   - **`Stop` hook (safety net):** Agent SDK `Stop` hook fires on session end (including crashes, token limits). Reads last session state → writes `task.json.status = "interrupted"` if not already completed → appends brief summary to `notes.md`. This handles the edge case where the agent did reasoning but hadn't called a tool yet.
   - On normal exit: spawner function sets `task.json.status = "completed"` (or `"failed"` on error)

6. **Immediate working agent spawn** (for ad-hoc tasks with `schedule.type: "none"`)
   - `TaskProcessor.onTaskCreated()` detects folder-based tasks and calls `spawnWorkingAgent(taskId)` instead of old `TaskExecutor.run()`
   - Adapter: old DB-based tasks still use old path

7. **Long-lived task wakeup** (for the restaurant booking pattern)
   - Conversation Nina can call `spawn_working_agent(taskId)` MCP tool to explicitly re-spawn
   - Working agent reads `plan.md` + `notes.md` for accumulated context
   - Future: file system watcher on `plan.md` changes can auto-trigger spawn (deferred to M6.7-S4)

8. **Contradiction resolved: Conversation Nina + working agents are separate sessions, not subagents**
   - Working agents are NOT Agent SDK subagents of Conversation Nina. They are independent sessions spawned by the orchestrator (via `spawnWorkingAgent()`).
   - Conversation Nina creates task folders via `create_task_folder()` MCP tool. The orchestrator detects the new folder and spawns the working agent — the actual Agent SDK session is created by the orchestrator, not within Nina's session context.
   - This is cleaner: working agents can outlive Conversation Nina's session, run on a schedule, and are fully independent.

**Test expectations:**

- Unit: `assembleWorkingAgentPrompt()` produces valid prompt, autonomy check logic, escalate routing
- Integration: `spawnWorkingAgent()` reads folder and delivers to WhatsApp, `Stop` hook writes interrupted status
- Manual: Working agent escalation appears in WhatsApp, task status updates in dashboard

**Blockers resolved for S3:** Working agents can be spawned. They can deliver to channels. Autonomy enforcement works. The immediate-task path is upgraded.

---

#### S3: Orchestrator + Calendar Replacement

**Goal:** Scheduled tasks run via working agents. Radicale is eliminated. FullCalendar still works.

**Deliverables:**

1. **Orchestrator** (`packages/dashboard/src/tasks/orchestrator.ts`)
   - Replaces `CalendarScheduler` + `EventHandler` + `TaskScheduler` as a single stateless background worker
   - File watcher (not polling) on `.my_agent/tasks/` detects new/changed task folders
   - Scheduling via `ical-expander` for RRULE expansion — computes next `scheduledFor` for recurring tasks
   - Spawns working agents for due tasks (`scheduledFor <= now AND status = "pending"`)
   - Health monitoring: tracks running working agents, detects timeouts, marks stale tasks as `"interrupted"`
   - Lifecycle management: updates `task.json.status = "running"` before spawn to prevent double-execution; on completion, computes next occurrence for recurring tasks
   - **Adapter layer:** Also queries old `tasks` table for legacy DB tasks. Old path (TaskExecutor) still runs for them.

2. **RRULE expansion utility** (`packages/core/src/tasks/rrule-expander.ts`)
   - Wraps `ical-expander` for in-process use (no CalDAV layer)
   - `nextOccurrence(rruleString, after?)` → ISO timestamp
   - Used by orchestrator for ongoing tasks

3. **`/api/calendar/events` endpoint rewrite** (`packages/dashboard/src/routes/calendar.ts`)

   **Calendar API Mapping (Old → New):**

   | Endpoint                             | Old (CalDAV)               | New (Folder-backed)                                               | Frontend Change                     |
   | ------------------------------------ | -------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
   | `GET /api/calendar/events?from=&to=` | CalDAVClient.getEvents()   | DB index query → FullCalendar format                              | None                                |
   | `POST /api/calendar/events`          | CalDAVClient.createEvent() | Redirect to `POST /api/tasks` → folder creation                   | None (redirect handled server-side) |
   | `PATCH /api/calendar/events/:id`     | CalDAVClient.updateEvent() | Read folder → update `task.json.schedule.scheduledFor` → re-index | None                                |
   | `DELETE /api/calendar/events/:id`    | CalDAVClient.deleteEvent() | Update `task.json.status = "cancelled"`                           | None                                |
   - FullCalendar frontend code unchanged — same API contract, different backend
   - Drag-and-drop rescheduling: `eventDrop` callback calls `PATCH`, which now updates `task.json` instead of CalDAV

4. **`CalendarContext` update** (`packages/core/src/calendar/context.ts`)
   - Change data source from CalDAV to DB index query
   - Format unchanged (injected into brain system prompts)

5. **Radicale decommission**
   - Remove `CalendarScheduler` startup from `index.ts`
   - Remove `CalDAVClient` import and usage
   - Remove `EventHandler` (replaced by folder-based path)
   - Remove `tsdav` dependency from `package.json`
   - Stop Radicale systemd service
   - Archive existing CalDAV events as reference (no auto-migration needed — existing tasks are test data)
   - Remove `CalendarRepository` interface (CalDAV-specific)

6. **`fired-events.json` elimination**
   - Scheduler tracks execution via `task.json.status` (no separate tracking file)
   - Remove `runtime/fired-events.json` and its management code

**Test expectations:**

- Unit: RRULE expansion returns correct next occurrence, orchestrator spawn logic, calendar API format mapping
- Integration: Scheduled task fires at correct time, drag-and-drop updates `task.json`, Radicale removal doesn't break UI
- Manual: Create task via dashboard calendar, verify it appears in FullCalendar, drag to reschedule, verify execution at new time

**Blockers resolved for S4:** All task scheduling flows through the folder-based path. Calendar API is live and tested. Radicale is gone.

---

#### S4: DB Index + Dashboard + Live Updates

**Goal:** Dashboard reads from folder index. Task detail views show folder contents. Live updates work for working agent activity.

**Deliverables:**

1. **DB index schema finalized** (`agent.db` tasks table, new structure)
   - Columns: `id TEXT PK`, `title TEXT`, `type TEXT`, `status TEXT`, `folder_path TEXT`, `scheduled_for INTEGER`, `updated_at INTEGER`, `session_id TEXT NULL` (for resume-policy tasks)
   - `tasks_fts` virtual table for fast title/content search
   - Remove old task columns: `work`, `delivery`, `instructions`, `source_type` (these are now in `task.json`)

2. **`StatePublisher` update** (`packages/dashboard/src/ws/state-publisher.ts`)
   - `publishTasks()` reads from DB index (fast) + optionally fetches `task.json` for status
   - Triggered by folder watcher events (new folder, `task.json` status change)
   - WebSocket message `state:tasks` format updated to include `folderPath` (enables "Open in VS Code" links)

3. **Task browser API update** (`GET /api/tasks`, `GET /api/tasks/:id`)
   - List endpoint reads from DB index
   - Detail endpoint reads `task.json` + `plan.md` + `notes.md` from folder
   - New endpoints: `GET /api/tasks/:id/deliverables` (lists `deliverables/`), `GET /api/tasks/:id/deliverable/:filename` (serves file)

4. **Frontend task detail view update** (`packages/dashboard/public/app.js`)
   - Tree view for task browser: browse tasks by type (`ad_hoc/`, `projects/`, `ongoing_responsibilities/`, `custom_tools/`)
   - Detail view showing folder contents: `plan.md` (markdown rendered), `deliverables/` listing, `notes.md` content
   - "Open in VS Code" link using `folderPath` from API response
   - Data source: folder API endpoints, not DB fields

5. **`task_conversations` junction table removal**
   - Conversation-to-task link now in `task.json.createdBy.conversationId`
   - Remove junction table from `agent.db`
   - Remove related queries from `ConversationDatabase`

6. **Migration cleanup**
   - Remove old `TaskManager` CRUD methods (DB-as-source-of-truth)
   - Remove `TaskExtractor` (Haiku extraction call)
   - Remove `tasks.sdk_session_id` column (old task session resumption)
   - Archive old DB-based task records that have completed

7. **Working agent progress streaming** (basic)
   - Working agent session emits intermediate `state:tasks` update with `status: "running"`
   - No full streaming (deferred to M7 for coding projects)

8. **Task folder RAG indexing** (extends existing memory system)
   - Task folder living documents (`plan.md`, `notes.md`, `deliverables/*.md`) indexed into memory search (`memory.db`)
   - Uses existing `SyncService` file watcher pattern — watches `.my_agent/tasks/` alongside `notebook/`
   - Same hybrid search (FTS5 + vector embeddings) already built in M6
   - Enables: `recall("restaurant booking status")` returns content from task folders
   - Chunking follows existing `chunker.ts` pattern (~400-token chunks per document)
   - **Rationale for S4 placement:** RAG indexing depends on stable folder structure and is non-blocking for core functionality

**Test expectations:**

- Unit: DB index schema migration test, folder watcher trigger test
- Integration: Task browser API returns folder contents, StatePublisher broadcasts on folder change
- Manual: Dashboard task detail view renders `plan.md` correctly

**Blockers resolved for S5:** Dashboard fully reads from folder model. Old DB-task infrastructure removed. Task folders searchable via `recall()`. System is clean.

---

#### S5: E2E Validation + Ongoing Task Folders

**Goal:** Full end-to-end test of the two-agent architecture. M6.6 ongoing task folders created and validated.

**Deliverables:**

1. **E2E test suite** (`packages/dashboard/tests/two-agent-e2e.ts`)
   - Scenario A: User asks Conversation Nina to "send me a joke in 1 minute" → folder created → orchestrator fires → working agent runs → joke delivered to WhatsApp
   - Scenario B: User asks about a task status → Conversation Nina reads folder → accurate answer
   - Scenario C: Working agent uses `escalate` tool → message appears in WhatsApp → task paused
   - Scenario D: Recurring task → runs 3 times → each run writes deliverable → accumulated context
   - Scenario E: User modifies a task via calendar drag-and-drop → `task.json` updated → orchestrator picks up new time

2. **Ongoing task folder templates** (`.my_agent/tasks/ongoing_responsibilities/`)
   - `morning-prep/task.json` (recurrence: `RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=0`)
   - `daily-summary/task.json` (recurrence: `RRULE:FREQ=DAILY;BYHOUR=23;BYMINUTE=0`)
   - `heartbeat/task.json` (recurrence: `RRULE:FREQ=HOURLY;INTERVAL=2`)
   - Each includes `plan.md` with the job description

3. **Session resumption validation** (for `sessionPolicy: "resume"`)
   - Create an ongoing task with `sessionPolicy: "resume"`
   - Verify first spawn creates session, stores `session_id` in DB index
   - Verify second spawn resumes that session
   - Verify fallback to fresh spawn if session is stale

4. **Fleet cost observation + alerting**
   - Log: working agent spawn time, token counts, per-task cost estimates
   - Enable informed decision on batching (deferred until data exists)
   - If 3+ ongoing tasks run simultaneously, measure actual API call overlap
   - **Alerting threshold:** Daily API call count logged to `runtime/fleet-metrics.json`. If >100 calls/day for 3 consecutive days, log warning and create `WISHLIST.md` entry for batching design review.

5. **Human-in-the-loop validation**
   - User tests all scenarios from the test plan
   - Sign-off: jokes delivered, task status accurate, calendar works, working agents escalate correctly

---

### Refocused M6.6 Scope (After M6.7)

With M6.7 complete, M6.6 no longer needs to build scheduling infrastructure. Its scope is refocused:

| M6.6 Feature                       | Status           | Notes                                                              |
| ---------------------------------- | ---------------- | ------------------------------------------------------------------ |
| `current-state.md` mechanism       | Keep — unchanged | Conversation Nina reads this on every new session                  |
| Context refresher on resume        | Keep — unchanged | Conversation Nina context refresh after notebook changes           |
| Fact extraction pipeline           | Keep — unchanged | Triggered by conversation idle, not scheduled. Unchanged.          |
| `work-patterns.md` + hatching step | Keep — unchanged | Both agents read this                                              |
| WorkLoopScheduler                  | **Eliminated**   | Absorbed by M6.7's orchestrator                                    |
| Heartbeat-as-code                  | **Eliminated**   | Heartbeat is now `ongoing_responsibilities/heartbeat/` task folder |
| Background query utility           | **Eliminated**   | Working agents handle this natively                                |

M6.6 becomes a focused sprint on the Nina self-awareness layer: temporal context, context refresher, fact extraction, work patterns.

---

### Reduced M7 Scope (After M6.7)

With working agents as the execution mechanism, M7's scope is significantly reduced:

| M7 Feature                          | Status                 | Notes                                               |
| ----------------------------------- | ---------------------- | --------------------------------------------------- |
| Task folder templates               | **Absorbed by M6.7**   | Standard structure established                      |
| Working agent executor              | **Absorbed by M6.7**   | That IS M6.7                                        |
| Process supervision (PID, watchdog) | **Eliminated**         | Working agents run in-process via Agent SDK         |
| `stream-json` subprocess streaming  | **Eliminated**         | SDK streaming is the pattern (already implemented)  |
| DECISIONS.md pattern                | Keep — in task folder  | Convention, not new code                            |
| **User code project relay**         | Keep — unique M7 value | User's external repo → working agent relays to user |
| **Dashboard streaming visibility**  | Keep — M7 value        | Full working agent session streaming to dashboard   |
| M7 prototype checklist              | **Eliminated**         | Claude Code subprocess not used                     |

M7 becomes: (1) user code relay, (2) full streaming visibility for active working agents in dashboard.

---

### Updated Milestone Ordering

```
M1–M6.5 (COMPLETE)
    ↓
[Phase 0: Delivery bug fix — hours]
    ↓
[Phase 0.5: Spike Validation — 2-3 days]
    ↓
M6.7-S1: Task Folder Infrastructure
    ↓
M6.7-S2: Working Agent Spawn
    ↓
M6.7-S3: Orchestrator + Calendar Replacement
    ↓
M6.7-S4: DB Index + Dashboard Update
    ↓
M6.7-S5: E2E Validation + Ongoing Task Folders
    ↓
M6.6: Agentic Lifecycle (refocused — no scheduler work)
    ↓
M7: Coding Projects (reduced — user relay + streaming)
    ↓
M8: Operations Dashboard (simplified — folder-backed views)
    ↓
M9: Email Channel
    ↓
M10: External Communications
```

---

### Risk Register

| Risk                                                     | Likelihood | Impact | Mitigation                                                                                                                                                         |
| -------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent crashes before writing state                       | Low        | Medium | Tool-based enforcement makes this unlikely — folder is always current up to last tool call. `Stop` hook writes `status: "interrupted"` + brief note as safety net. |
| File system watcher misses changes (WSL2 inotify limits) | Medium     | Medium | Periodic fallback scan every 5 minutes as backup to watcher                                                                                                        |
| Radicale data loss for existing events                   | Low        | Low    | Archive CalDAV data before decommission. Existing tasks are test data — no production data at risk yet.                                                            |
| Session resumption complexity introduces bugs            | Medium     | Medium | Default to `fresh` for all tasks. Opt-in `resume` policy tested in M6.7-S5 before any production ongoing tasks use it.                                             |
| Fleet cost exceeds expectations at scale                 | Low        | Medium | Measure in M6.7-S5. Lean prompts reduce cost vs Conversation Nina. Stagger scheduling. Batching available as fallback.                                             |
| `task.json` schema churn requiring migration             | Medium     | Medium | Finalize schema in M6.7-S1 with a design review before writing any code. Schema versioning field (`"schemaVersion": 1`) in `task.json` from day one.               |
| Long-lived task context exceeds file capacity            | Low        | Low    | `notes.md` + `deliverables/` + `plan.md` is sufficient for most tasks. Full context sessions available via `sessionPolicy: "resume"`.                              |

---

### Rollback Plan

If a sprint reveals fundamental issues that cannot be resolved, here is the rollback path:

| Sprint          | Rollback Action                                                                                       | Data at Risk                                  |
| --------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Spike fails** | Adjust M6.7 plan based on learnings. No code to revert.                                               | None — spike code is exploratory              |
| **S1 issues**   | Disable folder creation API. Old `TaskManager` still works.                                           | New folder-based tasks created during testing |
| **S2 issues**   | Disable `spawnWorkingAgent()`. Tasks fall back to old `TaskExecutor`.                                 | None — adapter layer keeps old path working   |
| **S3 issues**   | **Critical — Radicale decommissioned.** Re-enable Radicale from archive. Restore `CalendarScheduler`. | Calendar events created after decommission    |
| **S4 issues**   | Revert dashboard to read from old DB tables. Keep folder system for backend.                          | None — data is in folders                     |
| **S5 issues**   | Ongoing task folders are test data. Delete and recreate.                                              | Test data only                                |

**S3 is the point of no return for calendar.** Before S3, test calendar API replacement thoroughly in staging. Have Radicale backup ready. Only proceed when confident.

**General rollback principle:** The adapter layer means old paths work throughout S1-S2. S3 is the commitment point for calendar. S4-S5 are dashboard changes that don't affect core functionality.

---

_Created: 2026-03-02 | Updated: 2026-03-03_
_Author: Coverage Agent (team synthesis)_
_Based on: two-agent-architecture.md, two-agent-codebase-audit.md, two-agent-roadmap-impact.md_
