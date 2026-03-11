# my_agent — Roadmap

> **Source of truth** for project planning, milestones, and work breakdown.
> **Updated:** 2026-03-11

---

## Quick Status

| Milestone                    | Status   | Progress                     |
| ---------------------------- | -------- | ---------------------------- |
| **M1: Foundation**           | Complete | 4/4 sprints                  |
| **M2: Web UI**               | Complete | 7/7 sprints                  |
| **M3: WhatsApp Channel**     | Complete | 3/3 sprints                  |
| **M4: Notebook System**      | Complete | 2/2 sprints                  |
| **M4.5: Calendar System**    | Complete | 5/5 sprints                  |
| **M5: Task System**          | Complete | 10/10 sprints                |
| ~~**M5.5: Live Dashboard**~~ | Absorbed | → M5-S10                     |
| **M6: Memory**               | Complete | 9/9 sprints                |
| **M6.5: Agent SDK Alignment**| Complete | 4/4 sprints, 10 pass, 2 N/A           |
| **M6.7: Two-Agent Refactor** | Complete | 6/6 sprints, 28 E2E tests, pending CTO walkthrough |
| **M6.6: Agentic Lifecycle**  | Active   | S1 complete, 3 sprints remaining |
| **M6.8: Skills Architecture**| Planned  | Idea complete, design spec TBD, 3 sprints |
| **M7: Coding Projects**      | Redesign | Reframe as Working Agent pattern post-M6.7 |
| ~~**M8: Operations Dashboard**~~ | Absorbed | → M6.6 (UI work folded into lifecycle sprints) |
| **M9: Email Integration**    | Redesign | Redesign post-M6.7 (Working Agent routing) |
| **M10: External Comms**      | Redesign | Redesign post-M6.7 (Working Agent for external contacts) |

---

## Visual Timeline

```
2026-02                                          2026-03+
├─────────────────────────────────────────────────────────────────────►

M1 Foundation    M2 Web UI       M3 WhatsApp    M4 Notebook   M4.5 Calendar   M5 Tasks         M6 Memory        M6.5 SDK
[████████████]   [████████████]   [████████████]  [████████████]  [████████████]   [████████████]   [████████████]   [████████████]
   COMPLETE         COMPLETE         COMPLETE        COMPLETE        COMPLETE         COMPLETE         COMPLETE         COMPLETE
                                                                                                    M6.7 Two-Agent   M6.6 Lifecycle   M6.8 Skills
                                                                                                    [████████████]   [░░░░░░░░░░░░]  [░░░░░░░░░░]
                                                                                                       COMPLETE         NEXT            PLANNED
                                                                                                                          │
                                                                                                                    ┌─────┴─────┐
                                                                                                                    ▼           ▼
                                                                                                              M7 (redesign)  M9 (redesign)
                                                                                                                                │
                                                                                                                             M10 (redesign)
```

---

## Milestones

### M1: Foundation (CLI) — COMPLETE

The agent's core brain running in `.my_agent/`. CLI REPL for development/testing.

| Sprint | Name        | Status   | Plan                                      | Review                                        |
| ------ | ----------- | -------- | ----------------------------------------- | --------------------------------------------- |
| S1     | Foundation  | Complete | [plan](sprints/m1-s1-foundation/plan.md)  | [review](sprints/m1-s1-foundation/review.md)  |
| S2     | Personality | Complete | [plan](sprints/m1-s2-personality/plan.md) | [review](sprints/m1-s2-personality/review.md) |
| S3     | Hatching    | Complete | [plan](sprints/m1-s3-hatching/plan.md)    | [review](sprints/m1-s3-hatching/review.md)    |
| S4     | Auth        | Complete | [plan](sprints/m1-s4-auth/plan.md)        | [review](sprints/m1-s4-auth/review.md)        |

**Deliverables:**

- Agent SDK brain with personality from `brain/CLAUDE.md`
- Modular hatching flow (`HatchingStep` interface)
- Auth system (API keys + subscriptions, env var override)
- System prompt assembly from brain files + skills
- `/my-agent:*` commands for reconfiguration

---

### M2: Web UI — COMPLETE

Browser-based interface replacing CLI. Chat + hatching wizard.

| Sprint | Name                   | Status   | Plan                                            | Review                                              |
| ------ | ---------------------- | -------- | ----------------------------------------------- | --------------------------------------------------- |
| S1     | Server Foundation      | Complete | [plan](sprints/m2-s1-server-foundation/plan.md) | [review](sprints/m2-s1-server-foundation/review.md) |
| S2     | Streaming              | Complete | [plan](sprints/m2-s2-streaming/plan.md)         | [review](sprints/m2-s2-streaming/review.md)         |
| S3     | Hatching Wizard        | Complete | [plan](sprints/m2-s3-hatching-wizard/plan.md)   | [review](sprints/m2-s3-hatching-wizard/review.md)   |
| S4     | Conversations          | Complete | [plan](sprints/m2-s4-conversations/plan.md)     | [review](sprints/m2-s4-conversations/review.md)     |
| S5     | Naming                 | Complete | [plan](sprints/m2-s5-naming/plan.md)            | [review](sprints/m2-s5-naming/review.md)            |
| S6     | Advanced Chat Features | Complete | [plan](sprints/m2-s6-advanced-features/plan.md) | [review](sprints/m2-s6-advanced-features/review.md) |
| S7     | Responsive Mobile      | Complete | [plan](sprints/m2-s7-responsive-mobile/plan.md) | [review](sprints/m2-s7-responsive-mobile/review.md) |

**Design specs:**

- [conversation-system.md](design/conversation-system.md) — Persistence, search, naming, lifecycle

**Deliverables:**

- Fastify server + Alpine.js SPA (`packages/dashboard/`)
- WebSocket chat with streaming, thinking blocks, markdown
- Web-based hatching wizard
- Conversation persistence (SQLite + JSONL transcripts)
- Auto-naming at turn 5 + periodic re-naming on idle
- _(S6)_ Conversation deletion, per-conversation model selection
- _(S6)_ Extended thinking toggle, file attachments (images + text)
- _(S7)_ Responsive mobile layout: breakpoint system, Alpine mobile store, swipe-dismissable popovers (task detail, calendar, settings, notebook, notifications), mini calendar with day agenda, inline task actions

---

### M3: WhatsApp Channel — COMPLETE

First external channel. Agent owns a phone number, responds immediately.

| Sprint | Name                      | Status   | Plan                                                 | Review                                            |
| ------ | ------------------------- | -------- | ---------------------------------------------------- | ------------------------------------------------- |
| S1     | Channel Infrastructure    | Complete | [plan](sprints/m3-s1-channel-infrastructure/plan.md) | —                                                 |
| S2     | WhatsApp Plugin + Routing | Complete | [plan](sprints/m3-s2-whatsapp-plugin/plan.md)        | [review](sprints/m3-s2-whatsapp-plugin/review.md) |
| S3     | Slash Commands            | Complete | [plan](sprints/m3-s3-slash-commands/plan.md)         | [review](sprints/m3-s3-slash-commands/review.md)  |

**Design references:**

- [channels.md](design/channels.md) — channel architecture, identity-based routing, ruleset model

**Deliverables:**

- _(S1)_ Channel plugin interface, manager with resilience (reconnection, dedup, debounce, watchdog), mock plugin
- _(S2)_ Baileys WhatsApp plugin, QR pairing, identity-based routing, owner conversations, settings view
- _(S3)_ Slash commands: `/new` (conversation reset with pinning), `/model` (model switching) — works on web + WhatsApp

**Dependencies:** M2 (chat infra)

**Note:** External communications (personal channel role, ruleset model, approval flow) deferred to M10.

---

### M4: Notebook System — COMPLETE

Notebook is Nina's persistent memory — markdown files she can read always and write when talking to her owner.

| Sprint | Name                    | Status   | Plan                                                  | Review                                                    |
| ------ | ----------------------- | -------- | ----------------------------------------------------- | --------------------------------------------------------- |
| S1     | Notebook Infrastructure | Complete | [plan](sprints/m4-s1-notebook-infrastructure/plan.md) | [review](sprints/m4-s1-notebook-infrastructure/review.md) |
| S2     | Dashboard Evolution     | Complete | [plan](sprints/m4-s2-dashboard-evolution/plan.md)     | [review](sprints/m4-s2-dashboard-evolution/review.md)     |

**Architecture:**

| Layer       | Purpose                   | Location             | Nina Access                   |
| ----------- | ------------------------- | -------------------- | ----------------------------- |
| **System**  | HOW to use Notebook files | `brain/CLAUDE.md`    | Read-only                     |
| **Runtime** | Actual rules/data         | `.my_agent/runtime/` | Read always, Write with owner |

**Deliverables:**

- _(S1)_ Notebook file templates, prompt assembly with size limits, system directives
- _(S2)_ Dashboard workspace layout: tabs on left, permanent chat on right, context awareness

**Dependencies:** M3-S3 (channels working)

**Note:** `notebook_edit` tool moved to M5 (needed for standing orders). External communications deferred to M10. M4-S5/S6 superseded by M4.5 Calendar System.

---

### M4.5: Calendar System — COMPLETE

Unified calendar replaces scattered time-aware concepts (reminders.md, cron schedules, task deadlines). Everything with a time dimension becomes a scheduled task.

**Design spec:** [calendar-system.md](design/calendar-system.md)

| Sprint | Name                      | Status   | Plan                                                  | Review                                                    |
| ------ | ------------------------- | -------- | ----------------------------------------------------- | --------------------------------------------------------- |
| S1     | CalDAV Infrastructure     | Complete | [plan](sprints/m4.5-s1-caldav-infrastructure/plan.md) | [review](sprints/m4.5-s1-caldav-infrastructure/review.md) |
| S2     | Calendar Dashboard        | Complete | [plan](sprints/m4.5-s2-calendar-dashboard/plan.md)    | [review](sprints/m4.5-s2-calendar-dashboard/review.md)    |
| S3     | API Discovery + Scheduler | Complete | [plan](sprints/m4.5-s3-scheduler/plan.md)             | [review](sprints/m4.5-s3-scheduler/review.md)             |
| S4     | Event Dispatch            | Complete | [plan](sprints/m4.5-s4-event-dispatch/plan.md)        | [review](sprints/m4.5-s4-event-dispatch/review.md)        |
| S5     | Terminology Refactor      | Complete | —                                                     | —                                                         |

**Deliverables:**

- _(S1)_ Radicale setup, CalendarRepository interface, tsdav client, health checks
- _(S2)_ FullCalendar tab in dashboard, multi-calendar display, event CRUD UI
- _(S3)_ API discovery endpoint, CalendarScheduler for polling, prompt context with Quick Actions
- _(S4)_ Event dispatch: scheduler fires → spawn brain query → Nina responds
- _(S5)_ "Scheduled task" terminology throughout code and docs

**Tech Stack:**

| Component       | Choice                     |
| --------------- | -------------------------- |
| CalDAV server   | Radicale (self-hosted)     |
| CalDAV client   | tsdav (cal.com maintained) |
| RRULE expansion | ical-expander              |
| Frontend        | FullCalendar v6 (MIT, CDN) |

**Key Design Decisions:**

- Everything time-based is a "scheduled task" (reminders, deadlines, recurring tasks)
- Multi-calendar from day one (agent calendar + subscribed calendars)
- External calendars modeled as channel plugins (Google, Apple, Outlook)
- `reminders.md` retired; `external-communications.md` and `standing-orders.md` remain as Notebook files
- Scheduler fires → brain query spawned → response logged to "Scheduled Events" conversation

**Future Work (M5 integration):**

- Show task execution history in calendar detail view (conversation at bottom of task panel)
- Unified task visibility across scheduled tasks, inbox, and projects

**Dependencies:** M4-S2 (dashboard workspace layout)

**Prototype:** Validated 2026-02-18. Radicale + tsdav + ical-expander + FullCalendar stack works. See `prototypes/calendar/`.

---

### M5: Task System — COMPLETE

Tasks as first-class entities with execution logs, autonomous work alongside interactive conversations. Includes `notebook_edit` tool for Nina to manage her own standing orders.

**Design specs:**

- [task-system.md](design/task-system.md) — Architecture, folder structure, NotificationService, autonomy modes
- [Task System Design (approved)](plans/2026-02-19-task-system-design.md) — Task entity, agent.db, session continuity

| Sprint | Name                      | Status   | Plan                                                    | Review                                                      |
| ------ | ------------------------- | -------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| S1     | Task Foundation           | Complete | [plan](sprints/m5-s1-task-foundation/plan.md)           | [review](sprints/m5-s1-task-foundation/review.md)           |
| S2     | Task Execution            | Complete | [plan](sprints/m5-s2-task-execution/plan.md)            | [review](sprints/m5-s2-task-execution/review.md)            |
| S3     | Notebook Tools            | Complete | [plan](sprints/m5-s3-notebook-tools/plan.md)            | [review](sprints/m5-s3-notebook-tools/review.md)            |
| S4     | Notification System       | Complete | [plan](sprints/m5-s4-notifications-ui/plan.md)          | [review](sprints/m5-s4-notifications-ui/review.md)          |
| S5     | Task-Conversation Linking | Complete | [plan](sprints/m5-s5-task-conversation-linking/plan.md) | [review](sprints/m5-s5-task-conversation-linking/review.md) |
| S6     | Task UI                   | Complete | [plan](sprints/m5-s6-task-ui/plan.md)                   | [review](sprints/m5-s6-task-ui/review.md)                   |
| S7     | Request/Input Blocking    | Deferred | [plan](sprints/m5-s7-request-blocking/plan.md)          | —                                                           |
| S8     | E2E Task Flow             | Complete | [plan](sprints/m5-s8-e2e-task-flow/plan.md)             | —                                                           |
| S9     | Work + Deliverable        | Complete | [plan](sprints/m5-s9-task-steps/plan.md)                | [review](sprints/m5-s9-task-steps/review.md)                |
| S10    | Live Dashboard            | Complete | [plan](sprints/m5-s10-live-dashboard/plan.md)           | [review](sprints/m5-s10-live-dashboard/review.md)           |

**Deliverables:**

- _(S1)_ Task entity in agent.db (renamed from conversations.db), TaskStorage, migration
- _(S2)_ TaskExecutor with session continuity, CalDAV integration (scheduled tasks create Task entities)
- _(S3)_ `notebook_edit` tool for section-based file editing (standing orders, preferences)
- _(S4)_ NotificationService (notify, request_input, escalate), notification routing, dashboard UI
- _(S5)_ Soft delete for tasks, task_conversations junction table, full Task REST API (CRUD + link queries), conversationId in brain system prompt, brain documentation for task API
- _(S6)_ Task list screen, task detail tab, shared components (StatusBadge, DetailHeader, etc.), entity tags in chat, create task form
- _(S7)_ _(Deferred)_ Request/input blocking for interactive task execution
- _(S8)_ Brain skill loading fix, TaskProcessor (immediate), TaskScheduler (scheduled), result delivery to conversation, E2E tests
- _(S9)_ Work + Deliverable architecture: typed WorkPlan with `<deliverable>` XML tags, DeliveryExecutor, channel-aware constraints, validation gate. Clean channel delivery — work output stays internal, only validated deliverables reach recipients. **Plus:** Unified homepage timeline (Active Now + Timeline), past 24h visibility, bidirectional Task↔CalendarEvent linking. Design spec for full navigable timeline (M5-S10).
- _(S10)_ Live Dashboard: State push via WebSocket, Alpine stores for reactive UI, connection status indicator, task results appear without refresh. Homepage polish: timeline connecting line, time-left-of-bullets layout, trigger type badges, Active Now merged into timeline at NOW cluster. See [design/live-dashboard.md](design/live-dashboard.md).

**Philosophy:**

- **High autonomy:** Act, don't ask. If Nina can solve it, she solves it.
- **Real-time summaries:** Notify on task completion. User sees what got done.
- **Proportional effort:** Don't over-engineer for minor issues. If fix > problem, escalate.
- **Escalate rarely:** Only interrupt for things that truly need user judgment.
- **Learnable:** User feedback ("stop notifying about X") → standing order → behavior adapts.

**Dependencies:** M2 (dashboard), M4.5 (calendar scheduler)

---

### ~~M5.5: Live Dashboard~~ — ABSORBED INTO M5-S10

> **Note:** Live Dashboard work has been absorbed into M5-S10 to fix the immediate UX issue (task results not appearing without refresh). See [M5-S10 plan](sprints/m5-s10-live-dashboard/plan.md).
>
> Future enhancements (hero timeline, infinite scroll, search) deferred to post-M5 work. See [navigable-timeline.md](design/navigable-timeline.md).

---

### M6: Memory — COMPLETE

Markdown-first notebook memory: files are the source of truth, SQLite is a derived search index. Hybrid BM25 + vector search. Local embeddings via plugin system.

**Design specs:**

- [memory-system.md](design/memory-system.md) — Full architecture, tools, schema, migration plan
- [embeddings-plugin.md](design/embeddings-plugin.md) — Embeddings plugin interface and registry

| Sprint | Name                               | Status   | Plan                                                | Review                                                  |
| ------ | ---------------------------------- | -------- | --------------------------------------------------- | ------------------------------------------------------- |
| S1     | Infrastructure + Notebook Indexing | Complete | [plan](sprints/m6-s1-memory-infrastructure/plan.md) | [review](sprints/m6-s1-memory-infrastructure/review.md) |
| S2     | Memory Tools + Prompt Integration  | Complete | [plan](sprints/m6-s2-memory-tools/plan.md)          | [review](sprints/m6-s2-memory-tools/review.md)          |
| S3     | Memory Validation (Final)          | Complete | [plan](sprints/m6-s3-memory-validation/plan.md)     | [review](sprints/m6-s3-memory-validation/review.md)     |
| S4     | Memory File Watcher Events         | Complete | [plan](sprints/m6-s4-memory-events/plan.md)         | [review](sprints/m6-s4-memory-events/review.md)         |
| S5     | Embeddings Validation (E2E)        | Complete | —                                                   | [review](sprints/m6-s5-embeddings-validation/review.md) |
| S6     | Embeddings Degraded Mode           | Complete | [plan](sprints/m6-s6-embeddings-degraded-mode/plan.md) | [review](sprints/m6-s6-embeddings-degraded-mode/review.md) |
| S7     | Unified Plugin Interface           | Complete | [plan](sprints/m6-s7-unified-plugin-interface/plan.md) | [review](sprints/m6-s7-unified-plugin-interface/review.md) |
| S8     | Configurable Health Monitor        | Complete | [plan](sprints/m6-s8-health-monitor/plan.md) | [review](sprints/m6-s8-health-monitor/review.md) |
| S9     | Ollama Settings & Health UX        | Complete | [plan](sprints/m6-s9-ollama-settings-ux/plan.md) | [review](sprints/m6-s9-ollama-settings-ux/review.md) |

**Architecture:**

| Layer              | Technology                           | Purpose                                   |
| ------------------ | ------------------------------------ | ----------------------------------------- |
| Source of truth    | Markdown files in `notebook/`        | Human-editable, git-friendly, recoverable |
| Search index       | SQLite (`memory.db`)                 | Derived, rebuildable from markdown        |
| Keyword search     | FTS5 (BM25)                          | Fast exact + keyword matching             |
| Semantic search    | sqlite-vec + embeddings plugin       | Cosine similarity                         |
| Default embeddings | node-llama-cpp + embeddinggemma-300M | Local, ~600MB, no API cost                |
| SQLite binding     | better-sqlite3                       | Consistent with agent.db, battle-tested   |

**Notebook structure:** `lists/` (high-churn) + `reference/` (always in prompt) + `knowledge/` (learned facts) + `daily/` (temporal logs)

**Agent tools:**

- Intent-based: `remember()`, `recall()`, `daily_log()` — Nina thinks in concepts, not files
- File-based escape hatch: `notebook_read()`, `notebook_write()` — for precise control
- Separate: `conversation_search()` — keeps transcript search isolated from notebook results

**Deliverables:**

- Markdown notebook (`notebook/`) with folder organization
- SQLite index (`memory.db`) with FTS5 + sqlite-vec for hybrid search
- Embeddings plugin system with `embeddings-local` as default
- Five agent tools: `remember`, `recall`, `daily_log`, `notebook_read`, `notebook_write`
- `conversation_search` tool (separate from notebook recall)
- Auto-load `reference/*` + today/yesterday daily logs in every prompt
- Pre-compaction flush: silent prompt to save memories before context compression
- Dashboard: notebook browser, memory search UI, "Rebuild Memory Index" button
- Debug API: memory status, search, file listing, rebuild, notebook CRUD, simulation endpoints
- Migration from existing `runtime/` files into `notebook/reference/`
- _(S4)_ SyncService EventEmitter for file change notifications, WSL2 file watcher fix, dashboard live updates for memory
- _(S5)_ E2E validation of both embeddings plugins (local + Ollama), `resetVectorIndex()` for safe plugin switching, plugin persistence across restarts, `OLLAMA_HOST` env var, Delete Local Model UI button
- _(S6)_ Degraded mode: plugin stays selected but unhealthy when Ollama goes down, 60s liveness timer with runtime detection + auto-recovery, home tab status icons (WhatsApp + Memory), degraded badge in settings (desktop + mobile), `healthCheck()` on ChannelPlugin, `isReady()` now probes the actual server
- _(S7)_ Unified `Plugin` base interface (id, name, type, icon, healthCheck, status) that both `ChannelPlugin` and `EmbeddingsPlugin` extend. Standardizes `HealthResult` and `PluginStatus` across all plugin types. Removes `PluginDegradedState` in favor of structured `HealthResult`.
- _(S8)_ Configurable `HealthMonitor` service — polls all plugins at per-plugin intervals, emits `health_changed` events. Replaces hardcoded 60s liveness loop. `config.yaml` health section for interval overrides.

**Key decisions (2026-02-24):**

1. `better-sqlite3` binding — consistent with existing `agent.db`, 10-67% faster than `node:sqlite`
2. Hybrid tools — intent-based primary (`remember`, `recall`) + file-based escape hatch
3. Separate `conversation_search()` — keeps noisy transcripts isolated from curated notebook
4. Manual `daily_log()` only — no automated Haiku summary ("explicit over automatic")
5. Embeddings plugin system — `embeddings-local` default, extensible to OpenAI/Ollama/Voyage

**Dependencies:** M5 (task system complete), better-sqlite3 (existing)

**Risk mitigations:**

- Graceful fallback to FTS5-only if embeddings plugin not ready
- Session transcript indexing deferred to S3 (complexity shield)
- Prompt assembly changes tested thoroughly (regression risk for all brain queries)

---

### M6.5: Agent SDK Alignment — COMPLETE

Retrofit the codebase to properly use Agent SDK features. Replaces prompt-injection session management with native SDK sessions, adds MCP tools, subagents, programmatic hooks, and enables server-side compaction.

**Motivation:** Expert review revealed 6 critical gaps between the design doc and actual SDK usage. The brain uses only file system tools (no MCP), has no subagents, no SDK hooks, and manages sessions via text injection instead of SDK resumption. This milestone aligns the implementation with SDK best practices before building more features on a flawed foundation.

| Sprint | Name              | Status   | Plan                                                   | Review                                                     |
| ------ | ----------------- | -------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| S1     | SDK Enhancement   | Complete | [plan](sprints/m6.5-s1-sdk-enhancement/plan.md)       | [review](sprints/m6.5-s1-sdk-enhancement/review.md)       |
| S2     | Session Rewrite   | Complete | [plan](sprints/m6.5-s2-session-rewrite/plan.md)       | [review](sprints/m6.5-s2-session-rewrite/review.md)       |
| S3     | E2E Validation    | Complete | [plan](sprints/m6.5-s3-e2e-validation/plan.md)        | [review](sprints/m6.5-s3-e2e-validation/review.md)        |
| S4     | Live Validation   | Complete | [plan](sprints/m6.5-s4-live-validation/plan.md)     | [review](sprints/m6.5-s4-live-validation/review.md)        |

**Sprint structure:**

- **S1 (Additive):** MCP tool infrastructure (memory server live, channel/task stubs), subagent definitions (researcher, executor, reviewer), trust-tiered hook factory (audit + safety), `settingSources` evaluation, CLAUDE.md SDK rule
- **S2 (Destructive):** Full session management rewrite — `SessionManager` and `TaskExecutor` switch from prompt injection to `resume: sessionId`. Database schema adds `sdk_session_id`. Server-side compaction enabled via beta flag.
- **S3 (Validation):** 61 E2E tests across 9 phases (smoke → session resumption → MCP tools → hooks → tasks → memory → compaction → edge cases → semantic search). Fix-as-you-go protocol. Run 1 found 8 bugs, all fixed. Run 2: 48 pass, 7 partial, 0 fail.
- **S4 (Live Validation):** 11 remaining tests requiring real timer waits, WhatsApp delivery, and sustained conversations for compaction. No code-verification shortcuts.

**Deliverables:**

- _(S1)_ Domain-separated MCP servers (memory live, channels/tasks as stubs)
- _(S1)_ 3 core subagent definitions (researcher, executor, reviewer)
- _(S1)_ Trust-tiered hook factory (brain/task/subagent levels) with audit logging + safety blocks
- _(S1)_ `settingSources` evaluation document
- _(S1)_ CLAUDE.md rule: Agent SDK skill required for SDK-touching work
- _(S2)_ `brain.ts` extended with `resume` + `compaction` options
- _(S2)_ `SessionManager` rewritten — no more `buildPromptWithHistory()`, uses `resume: sessionId`
- _(S2)_ `TaskExecutor` rewritten — no more `loadPriorContext()` text injection, uses `resume: sessionId`
- _(S2)_ `sdk_session_id` column in conversations + tasks tables
- _(S2)_ Compaction handled by Claude Code's built-in auto-compact (no beta needed)
- _(S3)_ E2E validation: 48 pass, 7 partial, 0 fail across 61 tests. All Run 1 bugs fixed.
- _(S4)_ Live validation: 5 pass, 2 N/A, 2 TODO. Bug fixes: Alpine notification panel crash, TaskExtractor multi-task extraction, compaction beta removal (dead code — auto-compact is built-in), unhandledRejection crash guard. DB schema doc created. WhatsApp tests (5.6/8.6) are next task.

**Key files affected:**

| File | Sprint | Change |
|------|--------|--------|
| `packages/core/src/brain.ts` | S1, S2, S4 | MCP servers, agents, hooks, resume, stderr capture |
| `packages/core/src/mcp/` | S1 | New directory — memory, channel, task MCP servers |
| `packages/core/src/agents/` | S1 | New directory — subagent definitions |
| `packages/core/src/hooks/` | S1 | New directory — hook factory, audit, safety |
| `packages/dashboard/src/agent/session-manager.ts` | S2 | Full rewrite — prompt injection → SDK sessions |
| `packages/dashboard/src/tasks/task-executor.ts` | S2 | Full rewrite — text injection → SDK sessions |
| `packages/dashboard/src/conversations/storage.ts` | S2 | Schema migration — `sdk_session_id` column |

**Dependencies:** M6 (memory system — MCP wraps existing memory tools)

**Risk:** S2 is a destructive rewrite of session management. Mitigated by: S1 is purely additive (no breakage), S2 has task-by-task testing, S3 validates everything end-to-end.

---

### M6.7: Two-Agent Refactor — IN PROGRESS

Conversation Nina becomes a resumable long-lived session with a system prompt rebuilt on every query. This eliminates context staleness, removes cold-start injection, and enables seamless channel switching. Working Agents retain the folder-as-context model.

**Key technical change:** Agent SDK accepts `resume` + `systemPrompt` together — a resumed session applies the new system prompt while preserving full history. Validated via CLI test.

**Design spec:** [conversation-nina-design.md](plans/2026-03-04-conversation-nina-design.md) — Approved

**Implementation plan:** [conversation-nina-plan.md](plans/2026-03-04-conversation-nina-plan.md) — 10 tasks across 6 sprints (S1-S3 original, S4-S6 restructured after recovery)

**Idea docs:**

- [two-agent-architecture.md](ideas/two-agent-architecture.md) — Architecture design
- [two-agent-codebase-audit.md](ideas/two-agent-codebase-audit.md) — Codebase audit
- [two-agent-transition-plan.md](ideas/two-agent-transition-plan.md) — Transition plan
- [two-agent-roadmap-impact.md](ideas/two-agent-roadmap-impact.md) — Roadmap impact analysis

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | Core Architecture | **Complete (on master).** SystemPromptBuilder (6-layer prompt with caching), unified `buildQuery()` (always resume+systemPrompt), context-builder.ts removed. Review: [review.md](sprints/m6.7-s1-core-architecture/review.md) |
| S2 | Conversation Lifecycle | **Complete (on master).** Conversation status model (current/inactive with atomic swap), ConversationRouter (owner/external routing, Web→WhatsApp switch detection), wired into chat-handler + message-handler. Review: [review.md](sprints/m6.7-s2-conversation-lifecycle/review.md) |
| S3 | Conversation Lifecycle UI | **Complete (on master).** Current/inactive indicators in conversation sidebar (green dot + bold/muted styling, desktop + mobile), channel badges on transcript messages (icon + name for non-web channels). Review: [review.md](sprints/m6.7-s3-conversation-lifecycle-ui/review.md) |
| S4 | Search Infrastructure | **Complete (on master).** Backend search: FTS5 + sqlite-vec tables, ConversationSearchDB + ConversationSearchService with hybrid RRF (K=60), REST API (`/api/conversations/{search,:id,list}`), MCP tools (`conversation_search`, `conversation_read`), fire-and-forget indexing wired into chat flow. 38 tests. Review: [review.md](sprints/m6.7-s4-search-infrastructure/review.md) |
| S5 | Conversation Home Widget | **Complete (on master).** UI overhaul: removed dropdown/switcher, simplified chat header, Home widget (browse/search/resume), read-only preview (desktop tab + mobile popover), empty conversation auto-cleanup. 15 commits, 30/32 review criteria pass. Review: [review.md](sprints/m6.7-s5-conversation-home-widget/review.md) |
| S6 | E2E Validation + Semantic Search | **Complete (on master).** 28 automated E2E tests (Vitest), semantic search verified (80ms latency, Ollama + nomic-embed-text), 5 human-in-the-loop scenarios prepared for CTO walkthrough. Review: [review.md](sprints/m6.7-s6-e2e-validation/review.md) |

**Recovery notes:** S4-S7 were originally completed but lost due to unpushed branches during machine migration. Restructured as S4-S6 (original S4 tab bar rejected, S7 merged into S6). S4-S5 reconstructed and merged to master. S6 validates the complete milestone. Recovery transcripts and analysis: [recovery/m6.7-conversations/](recovery/m6.7-conversations/).

**What this delivers:**

- Single `buildQuery()` path — always `resume` + `systemPrompt` (removes two-branch bug)
- 6-layer system prompt rebuilt every query (identity, skills, state, memory, metadata, session)
- Prompt caching on layers 1-2 (~90% cost reduction after first message)
- One current conversation per owner, all others inactive but resumable
- Asymmetric channel switching: Web→WhatsApp = new conversation; WhatsApp→Web = continues
- External contacts → Working Agents (never reach Conversation Nina)
- `context-builder.ts` removed (cold-start injection no longer needed)
- Conversations Home widget (browse, search, resume past conversations)
- Read-only conversation preview (desktop tab + mobile popover)
- Conversation search (FTS5 + hybrid with RRF, MCP tools)
- Empty conversation auto-cleanup
- Simplified chat header

**What this does NOT change:**

- Working Agents keep folder-as-context model
- Task system, memory system, calendar — unchanged
- Skills loading — unchanged (deferred to M6.8)

**Dependencies:** M6.5 (SDK alignment)

---

### M6.8: Skills Architecture — PLANNED

Adopt the Agent Skills Standard and SDK native skill discovery. Skills become the primary mechanism for extending Nina's capabilities — conversation skills for the brain, worker skills for task agents.

**Idea docs:**

- [skills-architecture-gaps.md](ideas/skills-architecture-gaps.md) — 14 gaps, 8 risks, decision matrix
- [skills-roadmap-integration.md](ideas/skills-roadmap-integration.md) — Roadmap integration proposal
- [bmad-skills-integration.md](ideas/bmad-skills-integration.md) — BMAD compatibility analysis

**Design spec:** TBD at `design/skills-architecture.md` — required before sprints begin

**Pre-sprint validation tasks:**

- [ ] Validate `settingSources: ['project']` behavior with custom `systemPrompt` string — does SDK load CLAUDE.md? Does it walk up parent directories? Are skills discovered correctly?
- [ ] Verify hatching process creates proper personality files aligned with OpenAI's approach — personality defines HOW (tone, style), not WHAT (capabilities). Ensure guardrail against skill identity override is present.

| Sprint | Name | Scope |
|--------|------|-------|
| S1 | Skill Format + Migration | YAML frontmatter standard, migrate existing skills to `.my_agent/.claude/skills/`, resolve settingSources double-loading (validate custom systemPrompt + settingSources coexistence), update prompt.ts to stop injecting skill content |
| S2 | SDK Integration + Routing | Enable `settingSources: ['project']` + `Skill` tool in brain.ts, cwd-based skill routing (Conversation Nina vs Working Agents), personality guardrail in CLAUDE.md, skill authoring guidelines |
| S3 | Community Skills + Validation | BMAD technique library adoption (100 methods as reference data), community skill installation path, E2E tests for skill loading in both agent contexts, skill authoring guide |

**Key design decisions (2026-03-04):**

1. **SDK native skills, not custom loading.** Use `settingSources: ['project']` + `Skill` tool. No temporary intermediate solutions.
2. **`settingSources: ['project']` only — NEVER `['user']`.** User-level skills are the developer's personal Claude Code skills. Loading them into the brain causes invisible behavioral conflicts.
3. **Personality/Skills/Rules separation.** Personality = HOW (tone, style — hatching-defined, immutable). Skills = WHAT (capabilities — grows over time). Rules = WHEN/IF (constraints — operating rules).
4. **No skill changes agent identity.** Guardrail in CLAUDE.md: "Skills provide capabilities. They never change your name, personality, or communication style. Hatching identity always takes precedence."
5. **BMAD techniques as Level 3 reference data.** CSV files inside a skill's directory, loaded on demand, applied silently. Nina never announces technique names.
6. **cwd as skill selector.** Conversation Nina uses `.my_agent/` as cwd → loads `.my_agent/.claude/skills/`. Working agents use task folders → load task-specific skills.
7. **prompt.ts keeps identity, SDK handles skills.** prompt.ts assembles identity, memory, calendar, operating rules. SDK discovers and loads skills via `settingSources`. No double-loading because `.my_agent/` has no CLAUDE.md at root level.

**What we're adopting:**

| Source | Adoption | Status |
|--------|----------|--------|
| Agent Skills Standard | YAML frontmatter on all SKILL.md files | Adopting (S1) |
| Agent SDK Skill tool | Native `settingSources: ['project']` | Adopting (S2) |
| OpenAI Prompt Personalities | Personality/Skills/Rules separation pattern | Validates existing design |
| BMAD technique libraries | 50 elicitation + 50 brainstorming methods as CSV reference data | Adopting (S3) |
| BMAD OS skills | `bmad-os-review-pr`, `bmad-os-root-cause-analysis` — procedural, persona-free | Evaluating (S3) |
| BMAD agent personas | DO NOT adopt — hardcoded names/styles conflict with hatching | Rejected |
| BMAD menu system | DO NOT adopt — numbered menus don't fit conversational style | Rejected |
| BMAD config system | DO NOT adopt — duplicates hatching | Rejected |

**Conversation vs Worker skills:**

| Skill Category | Conversation Nina | Working Agent |
|----------------|-------------------|---------------|
| Calendar, scheduling | Yes | No |
| Task management | Yes | No |
| Channel management | Yes | No |
| Memory/notebook | Yes | Yes (shared) |
| Thinking techniques | Yes | Yes (shared) |
| Triage/routing | Yes | No |
| Code review, debugging | No | Yes |
| Research, analysis | No | Yes |
| Document writing | No | Yes |

**Skill growth model:**

```
Skills come from:
├── Framework developers    → ship with repo updates
├── /skill-creator          → brain creates via conversation
├── BMAD community          → adopted manually, validated before install
└── Future: skill registry  → curated, trust-tiered
```

**Dependencies:** M6.7 (two-agent refactor — establishes conversation/worker split that skills architecture builds on)

**⚠️ Pre-sprint validation (before S1):**
- Validate that `settingSources: ['project']` works alongside a custom `systemPrompt` string in the Agent SDK. M6.7's SystemPromptBuilder assembles layer 2 (Skills) — if `settingSources` injects skills separately, they may conflict or double-load.
- S1 scope must be trimmed: M6.7's SystemPromptBuilder already handles prompt assembly. S1 should focus on skill file structure, cwd-based routing, and SDK integration — NOT on "update prompt.ts to stop injecting skill content" (M6.7 removes prompt.ts).

**References:**
- [settings-sources-evaluation.md](design/settings-sources-evaluation.md) — Updated with M6.8 resolution
- Agent Skills Standard: `agentskills.io/specification`
- Agent SDK Skills: `platform.claude.com/docs/en/agent-sdk/skills`
- BMAD Method: `github.com/bmad-code-org/BMAD-METHOD`
- OpenAI Prompt Personalities: `developers.openai.com/cookbook/examples/gpt-5/prompt_personalities`

---

### M6.6: Agentic Lifecycle — NEXT

The agent gets a life outside of conversations. Background work loop maintains context, learns from conversations passively. Perfect memory: pre-loaded context eliminates most `recall()` needs, passive fact extraction catches what the agent misses, weekly review promotes recurring facts.

**Design spec:** [memory-perfection-design.md](superpowers/specs/2026-03-11-memory-perfection-design.md)
**Original design:** [memory-first-agent-design.md](plans/2026-03-01-memory-first-agent-design.md)

| Sprint | Name | Status | Plan | Review |
|--------|------|--------|------|--------|
| S1 | Context Foundation | Complete | — | [review](sprints/m6.6-s1-context-foundation/review.md) |
| S2 | Work Loop Scheduler + System Calendar | Planned | — | — |
| S3 | Passive Learning | Planned | — | — |
| S4 | E2E Validation | Planned | — | — |

**Core principle:** Markdown is source of truth. SQLite is derived — deletable, rebuildable.

**Key design decisions:**

- **No context refresher needed.** M6.7 rebuilds the system prompt every query. SyncService triggers cache invalidation when `operations/*` or `reference/*` change.
- **Heartbeat as retry.** Failed jobs stay due until they succeed. No per-job retry logic.
- **Haiku for all background work.** Pre-assembled context, no MCP tools. Main model reserved for conversations.
- **Fact extraction on original transcript.** Not chained after summarization — different goals, run in parallel via `Promise.allSettled`.
- **No pre-compaction flush.** Fact extraction reads from DB (full JSONL transcript), not SDK context. Compaction doesn't lose data.
- **`work-patterns.md` in `notebook/config/`** (not `operations/`). Machine config should not be prompt-injected.
- **Responsibility framework deferred.** Three hardcoded jobs (morning prep, daily summary, weekly review) deliver core value. General-purpose responsibility system needed by M7/M9, not M6.6.

**Architecture:**

```
DAILY CYCLE (repeats)
├── Morning Prep (scheduled, Haiku) → writes current-state.md
├── Conversations (reactive) → system prompt rebuilt every query (M6.7), always fresh context
├── Post-Conversation (idle OR inactive trigger) → fact extraction parallel with abbreviation
├── Daily Summary (scheduled, Haiku) → consolidate, spot patterns, seed next morning
└── Weekly Review (scheduled, Haiku) → promote facts, resolve conflicts, archive stale
```

**Dependencies:** M6.7 only (two-agent refactor — SystemPromptBuilder, conversation lifecycle). M6.8 is independent.

**Note:** M8 (Operations Dashboard) absorbed into M6.6. System calendar provides work loop visibility.

**Risk mitigations:**

- Token budget for `current-state.md` capped at 500–1000 chars
- Heartbeat retries failed jobs automatically
- `Promise.allSettled` isolates extraction from abbreviation failures
- Dedup falls back to substring matching when embeddings unavailable
- File lock prevents concurrent writes between extraction and weekly review

---

### M7: Coding Projects — NEEDS REDESIGN

Autonomous coding projects. Original design predates M6.7's two-agent architecture.

**Design spec:** [coding-projects.md](design/coding-projects.md) — needs update

**Redesign notes:**
- "User's Code Projects" should be reframed as a Working Agent with the user's repo as cwd, not a separate concept
- Process supervision may be overscoped — evaluate after M6.6 work loop is running
- Internal self-development projects are Working Agents spawned by the work loop
- Session streaming and `/whats-next` deliverables are still valid

**Dependencies:** M6.6 (agentic lifecycle — work loop powers autonomous project spawning)

---

### ~~M8: Operations Dashboard~~ — ABSORBED → M6.6

Most operations UI already exists from M5-S10 (live dashboard) and M6 (memory). Remaining deliverables (work loop status, responsibility management) are folded into M6.6 sprints.

**Original design spec:** [operations-dashboard.md](design/operations-dashboard.md)

**What moved where:**
- Work loop status panel → M6.6 (part of lifecycle UI)
- Responsibility manager → M6.6 (part of lifecycle UI)
- Task browser, memory viewer, settings → Already implemented (M5, M6)

---

### M9: Email Integration — NEEDS REDESIGN

Email as a task submission mechanism routed to Working Agents. Original deliverables are directionally correct but need redesign to align with M6.7's external contact routing and Working Agent model.

**Design reference:** [channels.md](design/channels.md), [conversation-nina-design.md](plans/2026-03-04-conversation-nina-design.md) §2 External Contact Routing

**Redesign notes:**
- Core flow (inbound email → Working Agent) aligns with M6.7, but implementation details need rethinking
- "Personal role" (monitoring user's email) depends on M6.6's responsibility system — could be a separate sprint gate
- "Dedicated role" (agent's email) only needs M6.7's Working Agent routing
- Escalation flow is defined in M6.7 design — M9 implements the email-specific parts
- May overlap with M10 (external contacts) — consider merging

**Dependencies:** M6.7 (external contact routing, escalation queue), M6.6 (email monitoring as responsibility)

---

### M10: External Communications — NEEDS REDESIGN

Cross-channel external communications via Working Agents. Original design predates M6.7 — assumed Nina handled external contacts directly. Post-M6.7, external contacts go to Working Agents.

**Design references:**

- [channels.md](design/channels.md) — identity-based routing, ruleset model
- [conversation-nina-design.md](plans/2026-03-04-conversation-nina-design.md) §2 External Contact Routing

**Redesign notes:**
- "Personal channel role" partially overlaps with M9 (email personal role) — resolve overlap
- Ruleset model is now a Working Agent capability (rules define how a Working Agent handles contacts)
- Approval flow for sensitive external communications is still needed
- What remains: WhatsApp external contacts → Working Agent, multi-channel ruleset layer, approval UI
- Consider merging with M9 into a unified "Working Agent for External Contacts" milestone

**Dependencies:** M6.7 (external contact routing, Working Agent model), M6.6 (responsibility system), M9 (email is the first external channel)

**⚠️ Stashed Code:**
M3-S4 stashed code is almost certainly incompatible with M6.7 architecture (assumed per-contact conversations on Nina). Evaluate before attempting recovery — likely discard.

---

## Design Specs

Design specs define architecture before implementation. Each spec should be complete before sprints begin.

| Spec                 | Status   | Milestones  | Path                                                             |
| -------------------- | -------- | ----------- | ---------------------------------------------------------------- |
| Channels             | Complete | M3, M9, M10 | [design/channels.md](design/channels.md)                         |
| Conversations        | Revised  | M2, M6.7    | [design/conversation-system.md](design/conversation-system.md) + [conversation-nina-design.md](plans/2026-03-04-conversation-nina-design.md) |
| Notebook             | Complete | M4, M5, M10 | [design/notebook.md](design/notebook.md)                         |
| Calendar System      | Complete | M4.5        | [design/calendar-system.md](design/calendar-system.md)           |
| Task System          | Complete | M5          | [design/task-system.md](design/task-system.md)                   |
| Task Delivery (v2)   | Approved | M5          | [design/task-steps.md](design/task-steps.md)                     |
| Live Dashboard       | Complete | M5-S10      | [design/live-dashboard.md](design/live-dashboard.md)             |
| Mobile Layout        | Complete | M2-S7       | [design/mobile-layout-spec.md](design/mobile-layout-spec.md)     |
| Navigable Timeline   | Deferred | Post-M5     | [design/navigable-timeline.md](design/navigable-timeline.md)     |
| Memory               | Complete | M6          | [design/memory-system.md](design/memory-system.md)               |
| Embeddings Plugin    | Complete | M6          | [design/embeddings-plugin.md](design/embeddings-plugin.md)       |
| SDK Alignment        | Planned  | M6.5        | Sprint plans in `sprints/m6.5-s*/plan.md`                        |
| settingSources       | Revised  | M6.5, M6.8  | [design/settings-sources-evaluation.md](design/settings-sources-evaluation.md) |
| Two-Agent Refactor   | Approved | M6.7        | [plans/2026-03-04-conversation-nina-design.md](plans/2026-03-04-conversation-nina-design.md) |
| Skills Architecture  | Idea     | M6.8        | TBD at [design/skills-architecture.md](design/skills-architecture.md) |
| Agentic Lifecycle    | Approved | M6.6        | [superpowers/specs/2026-03-11-memory-perfection-design.md](superpowers/specs/2026-03-11-memory-perfection-design.md) |
| Coding Projects      | Complete | M7          | [design/coding-projects.md](design/coding-projects.md)           |
| Operations Dashboard | Absorbed | ~~M8~~ → M6.6 | [design/operations-dashboard.md](design/operations-dashboard.md) |

**Note:** M3 (WhatsApp), M9 (Email), and M10 (External Comms) are covered by `channels.md`. M6.7's conversation lifecycle and channel routing are covered by `conversation-nina-design.md`. `conversation-system.md` and `channels.md` need updates to align with M6.7 design (scheduled as M6.7-S2 deliverable).

---

## Dependencies

```
M1 Foundation ───► M2 Web UI ───► M3 WhatsApp ───► M4 Notebook ───► M4.5 Calendar
      (done)          (done)         (done)           (done)            (done)
                                                                          │
                                                                          ▼
                                                                  M5 Tasks (S10=Live)
                                                                          │
                                                                          ▼
                                                                      M6 Memory
                                                                          │
                                                                          ▼
                                                                   M6.5 SDK Alignment
                                                                          │
                                                                          ▼
                                                               M6.7 Two-Agent Refactor
                                                                      │       │
                                                                      │       └─────────────────────────┐
                                                                      ▼                                 │
                                                          M6.6 Agentic Lifecycle (+ M8 absorbed)        │
                                                                      │                                 │
                                                               ┌──────┴──────┐                          │
                                                               ▼             ▼                          │
                                                     M7 Coding Projects   M9 Email ◄───────────────────┘
                                                       (needs redesign)     (needs redesign)
                                                                              │
                                                               M6.8 Skills    ▼
                                                              Architecture  M10 External Comms
                                                              (independent)   (needs redesign)
```

**Critical path:** M1 → M2 → M3 → M4 → M4.5 → M5 → M6 → M6.5 → M6.7 → M6.6. All complete through M6.7. M6.6 is next.

**M6.7 delivers conversation architecture.** Unified resume+systemPrompt path, 6-layer system prompt with caching, conversation lifecycle (current/inactive), channel routing (owner → Nina, external → Working Agents), asymmetric channel switching. Removes context-builder.ts and the two-branch buildQuery bug. This is the foundation for all subsequent milestones.

**M6.6 builds on M6.7 only.** `current-state.md` is injected via existing `loadNotebookOperations()`. `work-patterns.md` lives in `notebook/config/` (not prompt-injected). No M6.8 dependency — the responsibility framework is deferred to post-M6.6.

**M6.8 is independent.** Skills architecture can happen before or after M6.6. It provides the general-purpose responsibility loading that M7 and M9 will eventually need.

**M9 builds on M6.7 + M6.6.** Email integration uses M6.7's external contact routing and M6.6's work loop for email monitoring responsibilities.

**M7 requires M6.6:** Autonomous coding projects are triggered by the work loop. M7 will extend the `work-patterns.md` schema to support dynamic responsibility spawning.

**M8 absorbed into M6.6:** System calendar provides work loop visibility. Most dashboard already exists from M5-S10 and M6.

**M9 and M10 need redesign:** Both were designed pre-M6.7. External contacts now route to Working Agents, not to Conversation Nina. May merge into a single "Working Agent for External Contacts" milestone.

**Sprint quality gate:** Every future milestone's final sprint includes E2E automated tests + one comprehensive human-in-the-loop test walkthrough.

---

## Ad-Hoc Sprints

Quick fixes and small enhancements outside the milestone structure.

| Sprint | Name | Status | Plan | Review |
| ------ | ---- | ------ | ---- | ------ |
| — | WhatsApp Typing Indicator | Planned | [plan](sprints/adhoc-whatsapp-typing-indicator/plan.md) | — |

---

## Pre-Release Checklist

Requirements that must be complete before public release, regardless of milestone.

| Item                         | Status  | Notes                                                    |
| ---------------------------- | ------- | -------------------------------------------------------- |
| **Dashboard authentication** | Pending | Session-based auth for web UI. Currently localhost-only. |
| **Backup & Restore**        | Pending | Full backup (`.my_agent/` + DBs) or partial (personality, transcripts, tasks). Discovered need during machine migration — no recovery mechanism exists. |
| **Security audit**           | Pending | Review hooks, guardrails, and trust tier enforcement     |
| **Documentation**            | Pending | User-facing README, setup guide, examples                |

---

## Ideas Backlog

Ideas that haven't been promoted to design specs yet.

| Idea                         | Status                                   | Path                                                                         |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| Agent Teams for Ad-hoc Tasks | Deferred to M5                           | [ideas/agent-teams-for-adhoc-tasks.md](ideas/agent-teams-for-adhoc-tasks.md) |
| Multi-Step Tasks             | Evolved → M5-S9 (v2: Work + Deliverable) | [ideas/multi-step-tasks.md](ideas/multi-step-tasks.md)                       |
| Two-Agent Architecture       | Idea complete → M6.7                     | [ideas/two-agent-architecture.md](ideas/two-agent-architecture.md)           |
| Skills Architecture Gaps     | Analysis complete → M6.8                 | [ideas/skills-architecture-gaps.md](ideas/skills-architecture-gaps.md)       |
| Skills Roadmap Integration   | Proposal complete → M6.8                 | [ideas/skills-roadmap-integration.md](ideas/skills-roadmap-integration.md)   |
| BMAD Skills Integration      | Analysis complete → M6.8                 | [ideas/bmad-skills-integration.md](ideas/bmad-skills-integration.md)         |

---

## Future Wishlist

Long-term features beyond the current milestone plan. Not scheduled, not designed — just captured for future consideration.

| Feature                        | Description                                                                   | Notes                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **External Calendar Channels** | Google Calendar, Apple iCloud, Outlook as channel plugins                     | Each with own OAuth/auth flow, modeled like WhatsApp/Email channels          |
| **Mobile Dashboard (Phase 2)** | Advanced mobile features: bottom sheet chat, keyboard handling, accessibility | M2-S7 delivered foundation; remaining: peek/half/full chat, safe areas, a11y |
| **iOS App**                    | Native iOS app for Nina                                                       | Push notifications, Siri integration, widget support                         |
| **Mid-session Intervention**   | Send input to running Claude Code sessions                                    | Depends on Claude Code supporting message injection (steer)                  |
| **Voice Output (TTS)**         | Give Nina a voice using text-to-speech                                        | Evaluate Qwen 3 TTS — open, sounds good, need to test near real-time latency |
| **Voice Input (STT)**          | Let Nina understand voice via speech-to-text                                  | Web UI + WhatsApp channels; STT model for voice message transcription        |

---

## Documentation Structure

```
docs/
├── ROADMAP.md              ← You are here (source of truth)
├── design.md               ← Architecture overview
├── design/                 ← Detailed design specs
│   ├── channels.md
│   ├── conversation-system.md
│   └── (future specs)
├── sprints/                ← Implementation details
│   ├── m1-s1-foundation/
│   │   ├── plan.md
│   │   └── review.md
│   └── ...
├── ideas/                  ← Pre-design exploration
│   └── *.md
└── plans/                  ← Historical planning docs
    └── *.md
```

**Flow:** Ideas → Design Specs → Sprint Plans → Implementation → Reviews

---

## Sprint Workflow

Every sprint follows this workflow before implementation begins:

### 1. Sprint Breakdown

Tech Lead breaks down the sprint into tasks:

- Read the relevant design spec
- Identify all files to create/modify
- Define task dependencies (what can parallelize)
- Estimate complexity

### 2. Risk & Blocker Review

Opus reviewer analyzes the plan:

- **Gaps:** Missing pieces in the plan
- **Blockers:** Things that could prevent implementation
- **Risks:** Potential issues needing mitigation
- **Recommendations:** Suggested improvements

### 3. Design Approval

CTO reviews and approves:

- Verify plan matches design spec
- Resolve open architectural questions
- Confirm risk mitigations
- Approve team composition

### 4. Implementation

Team executes the approved plan:

- Backend Dev (Sonnet) + Frontend Dev (Sonnet)
- Opus reviewer verifies plan↔execution match
- Escalate only for architectural decisions or blockers

### 5. Sprint Review

After completion:

- Opus reviewer conducts final review
- Generate user stories for testing
- Document in `review.md`
- Update ROADMAP status

### 6. Milestone Final Sprint (E2E + Human Test)

Every milestone's **last sprint** follows a consistent quality gate:

- **Automated E2E tests:** Smoke → integration → cross-component → regression → edge cases
- **Human-in-the-loop test:** User stories with step-by-step flows, covering the happy path + at least one failure/recovery scenario, delivered as a checklist the CTO can walk through
- **Deliverables:** `test-report.md`, `user-stories.md`, `review.md`

---

## How to Use This Document

1. **Check status:** Look at Quick Status table
2. **Find current work:** Look for "IN PROGRESS" milestone
3. **Understand scope:** Read milestone's design spec first
4. **Track sprints:** Use sprint plan/review links
5. **Plan ahead:** Review PLANNED milestones and dependencies

---

_Updated: 2026-03-04_
