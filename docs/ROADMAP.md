# my_agent — Roadmap

> **Source of truth** for project planning, milestones, and work breakdown.
> **Updated:** 2026-04-16 (M9.6 re-opened — CTO course-correct after handoff flagged STT-only coverage gap; universal-coverage plan adds S9–S18)

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
| **M6.6: Agentic Lifecycle**  | Complete | 6/6 sprints, 265 tests (2 skipped SDK-only) |
| **M6.9: Knowledge Lifecycle**| Complete | 7/7 sprints (S1-S5 incl. S2.5, S3.5), 593 tests |
| **M6.8: Skills Architecture**| Complete | 6/6 sprints, 548 tests |
| **M6.10: Headless App**     | **Complete** | 4/4 sprints, 682 tests, headless App + debug service + mock sessions |
| **M7: Spaces, Automations & Jobs** | **Complete** | 9/9 sprints (S1-S9), 757 tests |
| **M8: Visual & Desktop Automation** | Complete | 8/8 sprints (S1-S5.1), 884 tests |
| **M9: Capability System** | Complete | 8/8 sprints (S1-S3.1, S5-S8), S4 failed/absorbed. Voice E2E working. Paper trail v2 done. |
| **M9.1: Agentic Flow Overhaul** | **Done + S9 corrective** | 9 sprints — original 8 + S9 (heartbeat false-positive fix, 2026-04-18 addendum). Todo system, heartbeat, hooks, restart recovery — validated with real LLM. Voice sprint unblocked. |
| **M9.2: Worker Todo Coverage** | **Done** | 11 sprints (S1-S10 incl. S5.1). Worker infrastructure fully working. Delegation behavior deferred to M9.3. 1345 tests. |
| **M9.3: Delegation Compliance** | **Done** | 4 sprints (S1-S3 + S2.5). Research delegation 0/3 → 2/3 (75%). S3.5 routing issues → M9.4. |
| **M9.4: Conversation UX/UI** | **In Progress** | 6 done (S1-S5 + S2.5) + S6 spec'd. S5 closed UX-1 (handoff continuity); S6 addresses UX-2 (progress counter cadence via methodical-worker prompting). |
| **M9.5: Capability Framework v2** | **Done** | 7 sprints done. S7 shipped browser-control as the framework's first multi-instance capability type. |
| **M9.6: Capability Resilience & Recovery** | **In Progress** | Phase 1 (S1-S8) + Phase 2 (S9-S14 done, S15 in progress). 5 Phase 3 sprints planned (S16-S20). M10 blocked until M9.6 closes at S20. |
| **M10: Channel SDK** | Planned | S0 merged. S1-S7 planned (8 sprints). WA migrated + Telegram + Discord + Line + agent-authored channel proof. |
| **M11: External Communications** | Planned | 3 sprints (email capability, contact routing, ruleset + approval) |
| **M12: iOS App**             | Planned | 3 sprints (foundation, full chat, native features) |
| **M13: Platform Hardening**  | Planned | 3 sprints (auth, backup/restore, update) — S4/S5 absorbed by M9.5 |
| **M14: Release**             | Planned | 2 sprints (security audit, documentation + launch) |

---

## Visual Timeline

```
COMPLETED (M1–M7)
═════════════════
M1 Foundation ► M2 Web UI ► M3 WhatsApp ► M4 Notebook ► M4.5 Calendar ► M5 Tasks ► M6 Memory
► M6.5 SDK ► M6.7 Two-Agent ► M6.6 Lifecycle ► M6.9 Knowledge ► M6.8 Skills ► M6.10 Headless
► M7 Spaces & Automations — 757 tests

COMPLETED (M8)
══════════════
M8 Visual & Desktop Automation — 884 tests

COMPLETED (M9)
══════════════
M9 Capability System — 8 sprints, Voice E2E, paper trail v2

COMPLETED (M9.1–M9.3)
═════════════════════
M9.1 Agentic Flow Overhaul — todo system, heartbeat, enforcement, restart recovery
M9.2 Worker Todo Coverage — 11 sprints, worker isolation, skill filter, 1345 tests
M9.3 Delegation Compliance — 4 sprints, 75% compliance, prompt + hook + auto-fire + progress

IN PROGRESS (M9.4)
══════════════════
M9.4 Conversation UX/UI — 7 sprints done (S6 = progress cadence prompt fix + progress card UX redesign)

M9.6 RE-OPENED (2026-04-16 — Universal Coverage Phase)
═══════════════════════════════════════════════════════
Phase 1 (S1-S8) shipped STT-only. CTO handoff flagged class failure: every other plug type (TTS, image-to-text, text-to-image, desktop-control, browser-control) still fails silently; automation-origin failures were never in scope. Phase 2 plan: [plan-universal-coverage.md](sprints/m9.6-capability-resilience/plan-universal-coverage.md) v2.3 (two red-team passes). Ten sprints (S9 origin types, S10 invoker, S11 smoke.sh templates, S12 PostToolUseFailure + origin wiring, S13 reflect collapse, S14 reverify dispatcher, S15 ack coalescing, S16 fix-engine swap, S17 TTS collapse, S18 exit gate). Exit gate = two definitive smoke tests: (1) automation Nina takes a website screenshot after browser plug is broken; (2) conversation Nina understands a voice message after STT plug is broken.

BLOCKED UNTIL M9.6 CLOSES
═════════════════════════
M10 Channel SDK — S0 merged. S1-S7 planned (8 sprints). WA migrated + Telegram + Discord + Line + agent-authored channel proof.

FUTURE (M10–M14) — ~18 sprints to release
══════════════════════════════════════════
M10 Channel SDK ──► M11 External Comms ──► M12 iOS ──► M13 Hardening ──► M14 Release
  (7 sprints)          (3 sprints)           (3 sprints)   (3 sprints)       (2 sprints)
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

| Sprint | Name                      | Status   | Plan                                                           | Review                                            |
| ------ | ------------------------- | -------- | -------------------------------------------------------------- | ------------------------------------------------- |
| S1     | Channel Infrastructure    | Complete | [plan](sprints/m3-s1-channel-infrastructure/plan.md)           | —                                                 |
| S2     | WhatsApp Plugin + Routing | Complete | [plan](sprints/m3-s2-whatsapp-plugin/plan.md)                  | [review](sprints/m3-s2-whatsapp-plugin/review.md) |
| S3     | Slash Commands            | Complete | [plan](sprints/m3-s3-slash-commands/plan.md)                   | [review](sprints/m3-s3-slash-commands/review.md)  |
| S5     | Connection Stability      | Complete | [plan](sprints/m3-s5-connection-stability/plan.md)             | —                                                 |
| S6     | Transport / Channel Split | Complete | [plan](sprints/m3-s6-transport-channel-split/plan.md)          | —                                                 |

**Design references:**

- [channels.md](design/channels.md) — channel architecture, identity-based routing, ruleset model
- [transport-channel-split.md](design/transport-channel-split.md) — transport/channel separation, authorization flow

**Deliverables:**

- _(S1)_ Channel plugin interface, manager with resilience (reconnection, dedup, debounce, watchdog), mock plugin
- _(S2)_ Baileys WhatsApp plugin, QR pairing, identity-based routing, owner conversations, settings view
- _(S3)_ Slash commands: `/new` (conversation reset with pinning), `/model` (model switching) — works on web + WhatsApp
- _(S5)_ Correction sprint: watchdog death loop fix, credential flush on shutdown, reconnect guard. Full investigation and diagnostics in [sprint docs](sprints/m3-s5-connection-stability/).
- _(S6)_ Refactor: split Channel into Transport (infrastructure) + Channel (owner binding). Token-based authorization with persistence, config migration, serialized config writes.

**Dependencies:** M2 (chat infra)

**Note:** External communications (personal channel role, ruleset model, approval flow) deferred to M10.

**Troubleshooting:** For future WhatsApp connectivity issues, see the [M3-S5 sprint docs](sprints/m3-s5-connection-stability/) — contains root cause analysis, log evidence, Baileys internals investigation, and the full fix rationale.

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
| S8     | E2E Task Flow             | Complete | [plan](sprints/m5-s8-e2e-task-flow/plan.md)             | [review](sprints/m5-s8-e2e-task-flow/review.md)             |
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
| S9     | Ollama Settings & Health UX        | Complete | — | [review](sprints/m6-s9-ollama-settings-ux/review.md) |

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

### M6.7: Two-Agent Refactor — COMPLETE

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

### M6.8: Skills Architecture — COMPLETE

Adopt the Agent Skills Standard and SDK native skill discovery. Skills become the primary mechanism for extending Nina's capabilities — conversation skills for the brain, worker skills for task agents.

**Idea docs:**

- [skills-architecture-gaps.md](ideas/skills-architecture-gaps.md) — 14 gaps, 8 risks, decision matrix
- [skills-roadmap-integration.md](ideas/skills-roadmap-integration.md) — Roadmap integration proposal
- [bmad-skills-integration.md](ideas/bmad-skills-integration.md) — BMAD compatibility analysis

**Design spec:** [skills-architecture-design.md](superpowers/specs/2026-03-15-skills-architecture-design.md)

**Pre-sprint validation tasks:**

- [x] Validate `settingSources: ['project']` behavior with custom `systemPrompt` string — validated 2026-03-15
- [x] Verify hatching process creates proper personality files aligned with OpenAI's approach — personality defines HOW (tone, style), not WHAT (capabilities). Ensure guardrail against skill identity override is present. — validated 2026-03-18 (S5 implements identity-override detection in skill-validation.ts)

| Sprint | Name | Scope | Status |
|--------|------|-------|--------|
| S1 | AGENTS.md Rename | Rename `brain/CLAUDE.md` → `brain/AGENTS.md`, update all references, fallback for transition, `.claude/skills/` directory structure | Complete — [plan](sprints/m6.8-s1-agents-md-rename/plan.md) [review](sprints/m6.8-s1-agents-md-rename/review.md) |
| S2 | SDK Skill Discovery | Enable `settingSources: ['project']`, `claudeMdExcludes`, `Skill` tool, `additionalDirectories`, migrate skills, startup health check, skill-tool filtering | Complete — [plan](sprints/m6.8-s2-sdk-skill-discovery/plan.md) [review](sprints/m6.8-s2-sdk-skill-discovery/review.md) |
| S3 | Seed Skills | Extract task-triage and knowledge-curation into SKILL.md files, ALWAYS_ON_SKILLS loading in assembleSystemPrompt(), three-level validation suite | Complete — [plan](sprints/m6.8-s3-seed-skills/plan.md) [review](sprints/m6.8-s3-seed-skills/review.md) |
| S4 | Curated Library | Adapt Superpowers + BMAD skills, strip personas, keep procedures, `origin: curated` tier, hatching copies skills | Complete — [plan](sprints/m6.8-s4-curated-library/plan.md) [review](sprints/m6.8-s4-curated-library/review.md) |
| S5 | Skill Management Tools | MCP tools (create/update/delete/list/get), validation (collisions, identity overrides, frontmatter), skill-filter re-run, description guidance, triage update + browser E2E | Complete — [plan](sprints/m6.8-s5-skill-management-tools/plan.md) [review](sprints/m6.8-s5-skill-management-tools/review.md) |
| S6 | Dashboard UI + Validation | Notebook skills section (browse, view, edit, delete, toggle), full E2E validation of complete M6.8 system | Complete — [plan](sprints/m6.8-s6-dashboard-ui-validation/plan.md) [review](sprints/m6.8-s6-dashboard-ui-validation/review.md) |

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

**M6.9 migration items:**

- **Knowledge curation skill** — wraps `manage_staged_knowledge` MCP tool from M6.9-S2. Tool handles approve/reject/skip mechanics. Skill adds behavioral layer: when to propose facts, how to phrase proposals, enrichment questions, conversation awareness. This replaces the knowledge enrichment standing order that was originally planned for S2 but deferred to M6.8.
- **Morning sequence skill** — may absorb morning brief behavioral guidance currently embedded in the morning-prep prompt template.

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

### M6.10: Headless App — COMPLETE

Extract a headless `App` class from the dashboard so the application can be driven programmatically — by agents, tests, or future interfaces (mobile) — without HTTP or WebSocket transport. The web dashboard becomes a thin adapter. Business behavior gets integration tests for the first time.

**Design spec:** [headless-app-design.md](superpowers/specs/2026-03-16-headless-app-design.md)

| Sprint | Name | Scope | Status |
|--------|------|-------|--------|
| S1 | Business Layer Integration Tests | `AppHarness` + integration tests for core flows (conversation, task, channel, memory, state publishing). Capture behavior before extraction. | Complete — [plan](sprints/m6.10-s1-business-layer-integration-tests/plan.md) [review](sprints/m6.10-s1-business-layer-integration-tests/review.md) |
| S2 | Extract App Class + Live Update Guarantee | Move service ownership from Fastify decorators to `App.create()`. All mutations emit events — live updates become structural, not opt-in. StatePublisher subscribes to App events. `index.ts` becomes ~50 lines. | Complete — [plan](sprints/m6.10-s2-extract-app-class/plan.md) [review](sprints/m6.10-s2-extract-app-class/review.md) |
| S3 | Chat Handler Decomposition | Split 900-line `chat-handler.ts` into App-owned `ChatService` + thin WS adapter. Streaming state machine extraction. | Complete — [plan](sprints/m6.10-s3-chat-handler-decomposition/plan.md) [review](sprints/m6.10-s3-chat-handler-decomposition/review.md) |
| S4 | Agent-Driven Verification | Agent-style test scenarios driving App directly. Prove QA agents can operate headlessly. Document headless API. | Complete — [plan](sprints/m6.10-s4-agent-driven-verification/plan.md) [review](sprints/m6.10-s4-agent-driven-verification/review.md) |

**Key design decisions:**

1. **App class in existing package** — no new `packages/app/`. A new package is warranted only when there's a real second consumer.
2. **Tests first, extract second** — S1 writes integration tests against current code. S2-S3 refactor. Tests prove zero degradation.
3. **EventEmitter for all output** — App emits events, adapters subscribe. No direct `broadcastToAll()` calls inside business logic.
4. **Module singletons → App-owned** — `sessionRegistry` moves to App. `connectionRegistry` stays in WS adapter (transport-specific).
5. **No behavior changes** — purely structural. REST, WebSocket, and frontend are identical after extraction.
6. **`app.conversations.active()`** — ConversationService must expose a simple accessor for the currently active conversation. External consumers (Claude Code, agents, tests) should not need raw DB queries to find it.
7. **Live updates are structural** — every App mutation method emits an event. Adapters subscribe. No manual `publishX()` calls. New features get live updates by default. Solves recurring stale-UI bugs.

**Baseline:** 67 test files, 608 tests (2 skipped) as of 2026-03-19 (post-S1).

**Dependencies:** M6.8 (skills architecture — completes before this starts)

---

### M6.6: Agentic Lifecycle — COMPLETE

The agent gets a life outside of conversations. Background work loop maintains context, learns from conversations passively. Perfect memory: pre-loaded context eliminates most `recall()` needs, passive fact extraction catches what the agent misses, weekly review promotes recurring facts.

**Design spec:** [memory-perfection-design.md](superpowers/specs/2026-03-11-memory-perfection-design.md)
**Original design:** [memory-first-agent-design.md](plans/2026-03-01-memory-first-agent-design.md)

| Sprint | Name | Status | Plan | Review |
|--------|------|--------|------|--------|
| S1 | Context Foundation | Complete | [plan](sprints/m6.6-s1-context-foundation/plan.md) | [review](sprints/m6.6-s1-context-foundation/review.md) |
| S2 | Work Loop Scheduler + System Calendar | Complete | [plan](sprints/m6.6-s2-work-loop-scheduler/plan.md) | [review](sprints/m6.6-s2-work-loop-scheduler/review.md) |
| S2.5 | Work Loop UX Polish | Complete | [plan](sprints/m6.6-s2.5-work-loop-ux/plan.md) | [review](sprints/m6.6-s2.5-work-loop-ux/review.md) |
| S3 | Passive Learning | Complete | [plan](sprints/m6.6-s3-passive-learning/plan.md) | [review](sprints/m6.6-s3-passive-learning/review.md) |
| S4 | E2E Validation | Complete | [plan](sprints/m6.6-s4-e2e-validation/plan.md) | [review](sprints/m6.6-s4-e2e-validation/review.md) |
| S5 | Corrections | Complete | [plan](sprints/m6.6-s5-corrections/plan.md) | [review](sprints/m6.6-s5-corrections/review.md) |

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

### M6.9: Knowledge Lifecycle — COMPLETE

The knowledge system gets a lifecycle. Facts are classified at extraction (permanent vs temporal), routed to appropriate stores, and curated through a daily morning brief. Permanent knowledge is user-approved. Temporal context lives in summaries that age out naturally. Dynamic properties (location, availability) are updated in real-time by Nina during conversation.

**Design spec:** [knowledge-lifecycle-design.md](sprints/m6.6-s6-knowledge-lifecycle/design.md)
**Depends on:** M6.6 (complete)

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Data Model + Pipeline | Complete | Classification prompt, routing, staging, summaries, properties, `queryModel()`, migration — [plan](sprints/m6.9-s1-data-model-pipeline/plan.md) · [review](sprints/m6.9-s1-data-model-pipeline/review.md) |
| S2 | Behavioral Layer | Complete | Morning brief upgrade, approval flow MCP tool, property staleness, settings UI — [plan](../superpowers/plans/2026-03-12-m6.9-s2-behavioral-layer.md) · [review](sprints/m6.9-s2-behavioral-layer/review.md) |
| S2.5 | Normalized Metadata & Timezone Scheduling | Complete | YAML frontmatter standard, timezone-aware `isDue()`, metadata validation + haiku repair, centralized model IDs, model selector UI — [plan](sprints/m6.9-s2.5-normalized-metadata/plan.md) · [review](sprints/m6.9-s2.5-normalized-metadata/review.md) |
| S3 | Conversation Initiation | Complete | ConversationInitiator service (`alert()`/`initiate()`), active conversation detection, outbound channel preference, morning brief integration, settings UI — [spec](../superpowers/specs/2026-03-13-conversation-initiation-design.md) · [review](sprints/m6.9-s3-conversation-initiation/review.md) |
| S3.5 | Working Nina / Conversation Nina Refactor | Complete | Task completion notifications (`notifyOnCompletion`), debrief rename, `request_debrief` MCP tool, ResponseTimer (interim messages), alert() channel fix — [spec](../superpowers/specs/2026-03-13-s3.5-conversation-refactor-design.md) · [plan](../superpowers/plans/2026-03-13-s3.5-conversation-refactor.md) · [review](sprints/m6.9-s3.5-conversation-refactor/review.md) |
| S4 | Agentic Task Executor | Complete | Full Agent SDK session with tools, bash, MCP; infrastructure guard hook; extended bash blocker; per-task model override; TaskLogStorage migration; 162 tests — [plan](sprints/m6.9-s4-agentic-task-executor/plan.md) · [review](sprints/m6.9-s4-agentic-task-executor/review.md) · [test-report](sprints/m6.9-s4-agentic-task-executor/test-report.md) |
| S5 | Tool Separation | Complete | Restrict conversation Nina to WebSearch+WebFetch, add create_task/search_tasks/update_property MCP tools, WebUI task context, missed task detector hook — [spec](../superpowers/specs/2026-03-15-conversation-tool-separation-design.md) · [plan](sprints/m6.9-s5-tool-separation/plan.md) · [review](sprints/m6.9-s5-tool-separation/review.md) · [test-report](sprints/m6.9-s5-tool-separation/test-report.md) |

**Key design decisions:**

- **Permanent vs temporal separation.** Permanent facts (family, contacts, preferences) route to `reference/` with user approval. Temporal facts (events, travel, meetings) flow to daily logs and age out through the summary rollup chain.
- **Summaries are the decay mechanism.** No per-fact confidence scores. Daily → weekly → monthly summaries compress naturally. Older context is searchable but not injected.
- **Morning sequence replaces morning prep.** Daily summary (Haiku) runs first, then morning brief (Sonnet/Opus) synthesizes past + future temporal context, proposes permanent knowledge, and (S3) starts a conversation.
- **Properties in YAML.** `properties/status.yaml` — machine-writable, real-time updates by Nina during conversation. Haiku extraction as backup. Future-proofed for mobile app, calendar sync.
- **Nina is the intelligence layer.** No per-turn extraction or heuristic classifiers. Nina asks for clarification naturally during conversation, enriching transcripts for downstream extraction.
- **Contacts are searchable, never injected.** Looked up on demand via `recall()`, not carried in the system prompt.
- **Extraction replaces S3 pipeline.** New classification categories and routing supersede `parseFacts`/`persistFacts`. Equivalent test coverage required (extraction failure resilience, concurrent write safety).
- **Staging is a work queue.** `knowledge/extracted/` is excluded from search/embeddings. Deleted after processing.

**Prerequisites:**
- Green test suite via M6.6-S5 (D1, D4, D5, D6)

**M6.9-S1 internal prerequisites (first tasks in S1):**
- `loadNotebookReference()` recursive subdirectory support
- `loadProperties()` YAML injection function
- SyncService path-pattern exclusion support

**Tech debt notes:**
- Knowledge enrichment standing order → skip in S2, implement as skill in M6.8 (decision: tools for mechanics, skills for behavior)
- `manage_staged_knowledge` MCP tool (S2) → wrap in a "knowledge curation" skill in M6.8 (skill adds judgment: when to propose, how to phrase, enrichment questions; tool provides safe approve/reject/skip mechanics)
- Hardcoded morning sequence jobs → migrate to responsibility framework in M7/M9

---

### M7: Spaces, Automations & Jobs — COMPLETE

Persistent file-backed entities: Spaces (managed folders), Automations (standing instructions with triggers), Jobs (discrete execution units).

**Design spec:** [m7-spaces-automations-jobs.md](superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md)

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Space Entity | **Done** | Space types, FileWatcher utility, agent.db `spaces` table, SpaceSyncService, MCP tools (create_space, list_spaces), App integration, StatePublisher, dashboard UI (home widget, browser tab, detail tab with tree view + property view + editing) |
| S2 | Tool Spaces | **Done** | isToolSpace predicate, tool field sync, DECISIONS.md utilities, tool invocation helper + error detection, tool creation guide in worker prompt, inline repair protocol, I/O contract display, maintenance toggle pills, DECISIONS.md preview (Run button dropped — tools invoke through agent) |
| S3 | Automations Core | **Done** | Automation + Job types, agent.db schema, AutomationJobService (JSONL), AutomationManager, AutomationSyncService, AutomationExecutor, AutomationProcessor (concurrency + delivery), AutomationScheduler (cron), MCP tools (create/fire/list/resume), brain prompt hints, App integration, StatePublisher, REST API (8 endpoints), dashboard UI (widget, browser, detail tab, timeline redesign, chat tag injection) |
| S4 | Triggers + HITL | **Done** | WatchTriggerService (chokidar polling, sync, debounce, mount retry), channel triggers (Haiku extraction + PostResponseHooks), media staging, needs_review → ConversationInitiator, SDK session resumption for HITL, timeline redesign (status dots, trigger badges, NOW marker, pagination), App wiring + lifecycle cleanup |
| S5 | Cleanup + Integration | **Done** | Old task system removed (-7,147 lines), mobile layout fix, run dir retention cleanup, design coverage audit (98 requirements), 4 coverage gaps closed, spec deviations documented, granular job events, session sidecar files |
| S6 | System Automations + Calendar | **Done** | Built-in handler registry, 5 work-loop jobs → automation manifests (system + user), WorkLoopScheduler removed (-3,000 lines), calendar rewired to timeline API, automation schedule editor in settings, system automation protection, startup migration from work-patterns, debrief automation adapter for MCP tool. [plan](../sprints/m7-s6-system-automations/plan.md) · [review](../sprints/m7-s6-system-automations/review.md) · [test-report](../sprints/m7-s6-system-automations/test-report.md) |
| S6.5 | Repairs + Polish | **Done** | Design review fixes: wire openTimelineItem(), drop dead delivery field, desktop Home 2x2 grid, unify chat context (generic activeViewContext), dead code sweep (task-server, task remnants), referenced automations on space detail, space property view polish, shared parseFrontmatterContent in core, timeline polish. [plan](../sprints/m7-s6.5-repairs/plan.md) · [review](../sprints/m7-s6.5-repairs/review.md) · [test-report](../sprints/m7-s6.5-repairs/test-report.md) |
| S7 | E2E Verification | **Superseded** | Original plan: 14 scripted test tasks. Real-world usage testing (S8) proved more effective — found 8 integration gaps that scripted tests wouldn't catch. Remaining E2E tests moved to S9. [plan](../sprints/m7-s7-e2e-verification/plan.md) |
| S8 | Debrief Worker Architecture | **Done** | Fix 8 gaps found during real usage: WhatsApp message split, brain mediator framing, worker web access, manifest persistence, debrief worker pipeline (`notify: debrief` collector), debrief reporter system job, conversation voice (no tool narration). Validation: recreate user automations naturally through conversation. [plan](../sprints/m7-s8-debrief-workers/plan.md) · [review](../sprints/m7-s8-debrief-workers/review.md) · [test-report](../sprints/m7-s8-debrief-workers/test-report.md) |
| S9 | E2E Test Suite | **Done** | Real-system E2E tests: AppHarness extended with automation support, 14 headless tests (lifecycle, protection, triggers, HITL, debrief pipeline), 3 Playwright browser tests (calendar, settings, detail UI), 6 live LLM tests (Haiku handlers, SDK session, HITL resume). 23 new tests, 757 total passing. [plan](../sprints/m7-s9-e2e-test-suite/plan.md) · [review](../sprints/m7-s9-e2e-test-suite/review.md) |

**Core principle:** Space = a folder with a SPACE.md manifest. The folder IS the space. agent.db indexes for search/listing but is derived and rebuildable.

**Dependencies:** M6.10 (headless App — workspace management via App API)

**Supersedes:** Old M7 (Coding Projects/Persistent Workspaces). Spaces subsume the workspace concept.

---

### M8: Visual & Desktop Automation — COMPLETE

Nina can see and interact with GUI applications. All visual actions (desktop control, Playwright, rich output) flow through a shared pipeline: capture → store → serve → render in dashboard. Merges the old M8 (Desktop Automation) and M9 (Multimodal) milestones, reordered by dependency.

**Design spec:** [m8-desktop-automation-design.md](superpowers/specs/2026-03-29-m8-desktop-automation-design.md)

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Visual Action Pipeline | **Done** | VisualActionService (capture/store/serve), screenshot tagging (agent tags keep/skip, pixel diff fallback), retention policy, asset serving route, dashboard screenshot rendering (timeline + inline), StatePublisher events. 29 new tests. [plan](../sprints/m8-s1-visual-action-pipeline/plan.md) · [review](../sprints/m8-s1-visual-action-pipeline/review.md) · [test-report](../sprints/m8-s1-visual-action-pipeline/test-report.md) |
| S2 | Desktop Control — Linux X11 | **Done** | DesktopBackend interface, X11Backend (xdotool + maim + wmctrl), ComputerUseService (Claude native computer use API bridge), MCP tools (desktop_task, desktop_screenshot, desktop_info) for both Conversation + Working Nina, safety hooks + rate limiter + audit logger, desktop skill, environment detection, hatching step, settings UI with enable/disable toggle + install button, setup script. 55 new tests. [plan](../sprints/m8-s2-desktop-control-linux/plan.md) · [review](../sprints/m8-s2-desktop-control-linux/review.md) · [test-report](../sprints/m8-s2-desktop-control-linux/test-report.md) |
| S3 | Playwright Integration | **Done** | PlaywrightScreenshotBridge (wrapper MCP tool + VAS storage), browser pooling, Playwright status detection, API routes (status/toggle/install), hatching step 8, Settings UI panel. 19 new tests, 863 total. [plan](../sprints/m8-s3-playwright-integration/plan.md) · [review](../sprints/m8-s3-playwright-integration/review.md) · [test-report](../sprints/m8-s3-playwright-integration/test-report.md) |
| S3.5 | Centralized Screenshot Storage | **Done** | VAS rewrite: single `screenshots/` folder, ref-based lifecycle, batch addRefs, 7-day unreferenced expiry. Removed AssetContext/ScreenshotTag/pixel-diff. Context-free producers, ref wiring on turn append + job completion + context deletion. 855 tests. [plan](../sprints/m8-s3.5-centralized-screenshots/plan.md) · [review](../sprints/m8-s3.5-centralized-screenshots/review.md) · [test-report](../sprints/m8-s3.5-centralized-screenshots/test-report.md) |
| S4 | Rich I/O | **Done** | Deliverable pipeline (full deliverable.md to disk), dashboard image rendering (DOMPurify, lightbox, job detail), WhatsApp outbound images, job timeline thumbnails, model selector persistence. [plan](../sprints/m8-s4-rich-io/plan.md) · [review](../sprints/m8-s4-rich-io/review.md) · [test-report](../sprints/m8-s4-rich-io/test-report.md) |
| S4.1 | Tool Redesign | **Done** | Split store_image into `create_chart` + `fetch_image` (purpose-built tools), visual presenter skill updated, standing order for visual communication, augmentation hook (Haiku safety net), SVG sanitization, WhatsApp agentDir fix. [plan](../sprints/m8-s4.1-tool-redesign/plan.md) · [review](../sprints/m8-s4.1-tool-redesign/review.md) · [test-report](../sprints/m8-s4.1-tool-redesign/test-report.md) |
| S4.2 | Visual Working Ninas | **Done** | chart-tools + image-fetch-tools MCP wired to workers, post-execution deliverable augmentation hook, deliverable.md written for all jobs (not just tagged). 884 tests. |
| ~~S5~~ | ~~Voice~~ | Absorbed | → M9 Capability System (voice is the first capability, not a standalone sprint) |
| S5 | Computer Use OAuth Fix | **Done** | Correction sprint: replace raw Anthropic API (`computer_20251124` beta) with Agent SDK `query()` + custom MCP tools. Required for Max subscription (OAuth only). [plan](../sprints/m8-s5-computer-use-oauth/plan.md) · [review](../sprints/m8-s5-computer-use-oauth/review.md) · [spec](../superpowers/specs/2026-04-02-agent-sdk-computer-use-design.md) |

**Key design decisions (resolved in spec):**
- No dedicated Computer Use Agent — tools on Working Nina directly, safety via hooks + autonomy
- Trust rule: user-initiated = proceed, agent-initiated = state app + reason, wait for approval
- ~~Native Claude computer use API (`computer_20251124` beta) for accuracy, bridged via MCP tool~~ → **Corrected M8-S5:** Agent SDK `query()` with custom MCP tools (raw API incompatible with OAuth/Max subscription)
- Backend abstraction from day one for cross-platform (macOS + Wayland deferred to M13)
- Dependencies managed via hatching + settings (auto-detect, guided install, graceful degradation)

**Dependencies:** M7 (automations — desktop tasks run as automations/jobs)

**Deferred to M13 (Platform Hardening):** macOS backend, Wayland backend — blocked on hardware availability and KDE X11 sunset timeline (Plasma 6.8, October 2026)

---

### M9: Capability System — COMPLETE

Self-extending agent capabilities. The agent itself can research, build, and install new capabilities (voice, image generation, custom tools) — using Claude's coding ability. The framework provides conventions and a registry; the agent does the rest. Voice (STT/TTS) is the proving ground.

**Design spec:** [capability-system.md](design/capability-system.md)
**Implementation plan:** [2026-04-01-capability-system.md](plans/2026-04-01-capability-system.md)

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Registry + Dummies | **Done** | Capability types, CapabilityRegistry, CapabilityScanner, FileWatcher, `capability:changed` event, system prompt injection, dummy STT + TTS, `.env` path unification — [plan](sprints/m9-s1-registry-dummies/plan.md) · [review](sprints/m9-s1-registry-dummies/review.md) · [code-review](sprints/m9-s1-registry-dummies/code-review.md) |
| S2 | Dashboard Voice + Secrets | **Done** | WebSocket capabilities protocol, record button (desktop + mobile), audio playback, TTS post-processing, model indicator, Secrets API + UI, re-scan trigger — [plan](sprints/m9-s2-dashboard-secrets/plan.md) · [review](sprints/m9-s2-dashboard-secrets/review.md) · [code-review](sprints/m9-s2-dashboard-secrets/code-review.md) |
| S3 | WhatsApp Voice + Skill Generation | **Done** | WhatsApp voice notes (download + transcribe + voice replies), `onAudioMessage` callback, medium mirroring, error handling, capability-builder `AgentDefinition` (Opus), brainstorming skill, model switch UX — [plan](sprints/m9-s3-whatsapp-skillgen/plan.md) · [review](sprints/m9-s3-whatsapp-skillgen/review.md) |
| S3.1 | Heartbeat & Error Recovery | **Done** | Conversation watchdog (garbled response, tool-heavy silence, missing deliverable), working agent watchdog (empty deliverable, failed job alerting, stale job, notification retry), collision guards — [plan](sprints/m9-s3.1-heartbeat-error-recovery/plan.md) · [review](sprints/m9-s3.1-heartbeat-error-recovery/review.md) |
| S4 | The Real Test | **Failed** | Agent lacked awareness of extension framework — gave generic LLM advice instead of using capability system. Root causes: brainstorming skill didn't fire, no persistent brain awareness, no measurable contract for builder output — [plan](sprints/m9-s4-real-test/plan.md) |
| S5 | Capability Templates + Test Harness | **Done** | Fixed brainstorming skill triggering, notebook reference (permanent brain awareness), 3 framework-authored templates with TDD-like test contracts, test harness in registry (`registry.test()`, health field, non-blocking validation-on-activation/startup, debug API), builder/brainstorming updates (template precedence, composites, self-healing), 45 tests — [plan](sprints/m9-s5-capability-templates/plan.md) · [review](sprints/m9-s5-capability-templates/review.md) |
| S6 | The Real Test (Retry) | **Done** | Nina created Deepgram STT + Edge TTS from scratch via tracked jobs. Voice E2E on dashboard + WhatsApp. Also fixed: MCP transport collision, job monitoring (3-layer), WhatsApp bleed #3, voice UX (autoplay queue, voice mode hint, prepareForSpeech, transcript display, split-turn TTS) — [plan](sprints/m9-s6-real-test-retry/plan.md) · [lessons](sprints/m9-s6-real-test-retry/lessons-learned.md) |
| S7 | Universal Paper Trail | **Done** | Paper trail v2: guaranteed writes via regex extraction, executor post-completion DECISIONS.md, session resumption support, brainstorming modify flow — [plan](sprints/m9-s7-paper-trail/plan.md) · [review](sprints/m9-s7-paper-trail/review.md) |
| S8 | Paper Trail + Infra Fixes | **Done (PASS WITH CONCERNS)** | Validated paper trail on real builds, found 9 systemic issues + 3 dev issues. Paper trail works but agentic flow unreliable. Systemic analysis → M9.1 — [plan](sprints/m9-s8-modify-test/plan.md) · [review](sprints/m9-s8-modify-test/review.md) · [systemic issues](design/m9-systemic-issues.md) |

**Key design decisions (resolved in spec):**
- Capabilities are files (CAPABILITY.md + scripts), not code registrations — auto-discovered from `.my_agent/capabilities/`
- Well-known types (`audio-to-text`, `text-to-audio`, `text-to-image`) trigger framework reactions (UI, channels); custom types are brain-directed
- Scripts are the universal adapter (wrap APIs, binaries, Python, MCP servers)
- Builder is an Opus `AgentDefinition` subagent — avoids model switching mid-session
- Secrets in `.env`, managed via Settings UI — credential vault deferred to M13
- No marketplace — sharing is copy-paste, deliberate rejection for security
- Registry is the contract between capabilities and UI/channels/brain
- Universal paper trail: DECISIONS.md at every artifact, written by brainstorming (strategic) + framework (structured metadata), linked to job artifacts in `.runs/`
- Session resumption: try resume for recent modifies, fall back to DECISIONS.md as durable context

**Absorbs:**
- M8-S5 (Voice) — STT/TTS engine selection, dashboard audio, WhatsApp voice notes
- Old M12-S6 (Self-Service MCP Integration) — capability system supersedes the MCP-specific approach

**Dependencies:** M8 (rich I/O — capabilities build on the visual pipeline and asset serving). M8 complete.

---

### M9.1: Agentic Flow Overhaul — DONE

Fix Nina's agentic flow so she follows orders, delegates reliably, and communicates status. Addresses all systemic issues identified in M9-S8.

**Design spec:** [agentic-flow-overhaul.md](design/agentic-flow-overhaul.md)
**Implementation plan:** [2026-04-05-agentic-flow-overhaul.md](plans/2026-04-05-agentic-flow-overhaul.md)
**Systemic analysis:** [m9-systemic-issues.md](design/m9-systemic-issues.md)

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Todo System + MCP Server | Done | `todo-server` MCP (4 tools), `TodoItem` type, JSON storage per session, wired to all agent sessions. [Review](../sprints/m9.1-s1-todo-system/review.md) |
| S2 | Todo Templates + Validation | Done | Static templates (`capability_build`, `capability_modify`), validation registry, `create_automation` gets `todos` + `job_type` fields, 3-layer assembly in executor, job completion gating. [Review](../sprints/m9.1-s2-todo-templates/review.md) |
| S3 | Heartbeat Jobs Service | Done | 30s interval loop, stale job detection (5min threshold via todo activity), persistent notification queue (`pending/` → `delivered/`), capability health checks (hourly), notification delivery unification. [Review](../sprints/m9.1-s3-heartbeat/review.md) |
| S4 | Enforcement Hooks | Done | Source code protection (all Ninas), capability routing (Conversation Nina), todo completion check (Working Nina), updated trust model. [Review](../sprints/m9.1-s4-enforcement-hooks/review.md) |
| S5 | Status Communication + System Prompt | Done | Enhanced `check_job_status` with todo progress, `[Pending Briefing]` section in system prompt, `[Your Pending Tasks]` for Conversation Nina, 3-channel delivery (pull/push/briefing). [Review](../sprints/m9.1-s5-status-communication/review.md) |
| S6 | Restart Recovery | Done | Startup recovery sequence (mark interrupted → notify → clean stale → re-scan → start heartbeat), resume_job for interrupted jobs with todo-aware prompt, session ID mismatch detection. [Review](../sprints/m9.1-s6-restart-recovery/review.md) |
| S7 | Infrastructure Fixes + Integration Test | Done | Scanner loudness (invalid caps reported), target_path from manifest (regex removed), E2E integration test (5 tests: todo assembly, completion gating, notification delivery, stale detection). [Review](../sprints/m9.1-s7-infra-fixes/review.md) |
| S8 | The Real Test | Done (PASS) | Live validation with real LLM sessions. 8 tests: order following, todo execution, validators, progress reporting, notifications, restart recovery, paper trail, source code protection. 4 bugs found and fixed (worker prompt, deliverable preservation, template text, retry instructions). All 8 pass. [Plan](../sprints/m9.1-s8-real-test/plan.md) · [Review](../sprints/m9.1-s8-real-test/review.md) · [Test Report](../sprints/m9.1-s8-real-test/test-report.md) |
| S9 | Heartbeat Liveness Fix | Done (late addendum) | Four-layer false-positive fix: audit-log liveness, lazy run-dir mtime, 60s min-age gate+recheck, per-automation threshold. 15 new tests. Live smoke: recheck path confirmed. [Plan](../sprints/m9.1-s9-heartbeat-liveness-fix/plan.md) · [Review](../sprints/m9.1-s9-heartbeat-liveness-fix/review.md) |

**Key design decisions:**
- Todo system is an MCP server, not reused from Claude Code (needs persistence, mandatory items, validation)
- Conversation Nina defines the todo list when delegating — she's the project manager
- Static templates for known job types add mandatory process items
- Heartbeat detects stale jobs through todo file activity, not worker-sent heartbeats
- Persistent notification queue on disk replaces in-memory queue
- Source code protection prevents Nina from modifying framework code (self-harm prevention)
- Capability routing forces Conversation Nina through automation flow (no inline edits)

**Absorbs:**
- M9-S7 (Paper Trail) — paper trail reliability now handled by todo templates + validation
- M9-S8 (Modify Test) — retry after agentic flow is solid

**Dependencies:** M9 (capability system complete), M7 (automation infrastructure)

**Follow-up:** Voice sprint after M9.1 passes — concurrent message handling, voice UX, E2E voice testing with working agentic flow underneath.

---

### M9.2: Worker Todo Coverage — COMPLETE

Extend M9.1's code-enforced Todo system to all worker job types. Every Working Nina gets a baseline checklist with validators. Also: smart visual hook that filters dumb charts.

**Implementation plan:** [2026-04-06-m9.2-worker-todo-coverage.md](plans/2026-04-06-m9.2-worker-todo-coverage.md)
**Origin:** [Cognitive Todo Boost proposal](superpowers/plans/2026-04-06-cognitive-todo-boost-proposal.md) (filtered — 4 of 10 tasks kept)

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Generic & Research Templates | Done | `research` added to job_type union, `generic` + `research` todo templates, `status_report` validator, generic fallback in `assembleJobTodos`. Real LLM smoke tests for both. [Review](../sprints/m9.2-s1-generic-research-templates/review.md) |
| S2 | S1 Gap Fixes | Done | `status_report` validator unit tests, consolidate duplicate test files, debrief pipeline includes `needs_review` jobs with warning flag (G4), handler bypass invariant comment (G5), monorepo build order docs. [Review](../sprints/m9.2-s2-gap-fixes/review.md) |
| S3 | Working Nina Self-Check | Done | Replace prose "Principles" with structured pre-completion self-check referencing `todo_list`. Behavioral smoke test. [Review](../sprints/m9.2-s3-self-check/review.md) |
| S4 | Delegation Todo Enforcement | Done | `todos` required in `create_automation` Zod schema (`.min(1)`). AutomationManifest stays optional (disk/handler paths unaffected). Framework delegation-checklist skill for other 7 fields. 3 smoke tests: simple, complex, retry. [Review](../sprints/m9.2-s4-delegation-enforcement/review.md) |
| S5 | Visual System Upgrade | Done | Skill rewrite as decision tree + smart hook (Haiku pre-check gate filters non-chart-worthy data, prevents dumb charts) + `description` required on `create_chart`/`fetch_image` for meaningful alt text. Smoke tests for all. [Review](../sprints/m9.2-s5-visual-upgrade/review.md) |
| S5.1 | Remove Haiku Fallback | Done | Experiment succeeded: brain generates charts proactively after S5 skill rewrite. Full cleanup — visual-augmentation.ts deleted, image counter removed, post-response hooks simplified. 277 lines removed, zero orphaned references. [Review](../sprints/m9.2-s5.1-remove-haiku-fallback/review.md) |
| S6 | Integration Verification | Done | Delegation gap discovered: brain never calls `create_automation` — stale `create_task` references in instance skills + `delegation-checklist` in wrong directory. Code-enforced items (templates, validators, charts) all pass. Delegation behavior deferred to M9.3. [Gap Report](../sprints/m9.2-s6-integration/delegation-gap-report.md) |
| S7 | Framework/Instance Split + Audit Fixes | Done | Move agentic behavior from `.my_agent/` to `skills/`. Fix all audit findings: stuck skill filter flags, stale test assertions, duplicate prompt loading, stale capability-brainstorming copy. [Review](../sprints/m9.2-s7-framework-instance-split/review.md) |
| S8 | Worker Prompt Isolation + Skill Filter Safety | Done | Workers get worker-specific prompt (no brain identity/"do not do work yourself"). Skill filter refactored to runtime filtering (no disk writes, no crash-stuck flags). [Review](../sprints/m9.2-s8-worker-prompt-isolation/review.md) |
| S9 | Skill Filter Wiring | Done | Wire `filterSkillsByTools()` return value into `assembleSystemPrompt()` via `excludeSkills` parameter. Completes S8 refactor. [Review](../sprints/m9.2-s9-skill-filter-wiring/review.md) |
| S10 | Final Integration Verification | Done | Full E2E: rerun all failed S6 tests, all deferred S7/S8 smoke tests, skill filter wiring verification, delegation, worker isolation, crash safety. M9.2 completion gate. [Test Report](../sprints/m9.2-s10-final-verification/test-report.md) |

**Key decisions:**
- Working Nina = todo-oriented (code enforcement). Conversation Nina = conversational (no todos).
- Visual hook upgraded from dumb heuristic to Haiku-evaluated pre-check (two-step flow)
- `research` is a first-class job type with its own template (sources, cross-check, chart)
- All smoke tests use M9.1's proven disk-write pattern (not REST creation)
- Delegation behavior gap (brain ignores `create_automation`) identified in S6, deferred to M9.3

**Results:** 1345 tests (264 core + 1081 dashboard), 0 failures. Worker infrastructure fully working (96% prompt reduction, 3-layer todo assembly, isolated execution). Delegation compliance is the remaining gap — addressed in M9.3.

**Dependencies:** M9.1 (todo infrastructure complete)

---

### M9.3: Delegation Compliance — DONE

Fix Conversation Nina's delegation compliance — she must delegate research/analysis to workers via `create_automation` instead of handling everything inline with WebSearch. Three-layer fix: prompt corrections, code enforcement (budget hook), delegation UX (auto-fire + inline progress).

**Implementation plan:** [2026-04-07-m9.3-delegation-compliance.md](plans/2026-04-07-m9.3-delegation-compliance.md)
**Issue report:** [delegation-compliance.md](issues/2026-04-07-delegation-compliance.md)

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Prompt Corrections | Done | Remove "your call" contradiction from operational-rules.md, add delegation motivation to conversation-role.md, exhaustive WebSearch scope rules in task-triage.md, reframe `create_automation` tool description. [Review](../sprints/m9.3-s1-prompt-corrections/review.md) |
| S2 | WebSearch Budget Hook | Done | PreToolUse hook limits WebSearch to 2 calls per turn. Blocks with systemMessage directing brain to `create_automation`. Reset per user message. [Review](../sprints/m9.3-s2-websearch-budget-hook/review.md) |
| S2.5 | Delegation UX | Done | Auto-fire `once:true` manual automations, optimized hook message, inline progress bar (onProgress callback → WebSocket → Alpine). Two bugs found in S3 and fixed (tool result text matching, state change emission). [Review](../sprints/m9.3-s2.5-delegation-ux/review.md) |
| S3 | E2E Verification | Done | 3/4 compliance (75%, up from 25%). Tests B+C delegated, D direct (all correct). Test A (scheduling) inline but no hallucination. Progress bar verified working. [Review](../sprints/m9.3-s3-verification/review.md) |
| S3.5 | — | Absorbed | Routing issues discovered during S3.5 testing → broadened into M9.4 (Conversation UX/UI). |
| S4 | Structural Enforcement | Not needed | Target met without it. Research compliance 2/2 (100%). |

**Key decisions:**
- Primary root cause: `operational-rules.md` said "your call" contradicting other skills — fixed in S1
- Budget hook uses observed behavior (search count) not prediction (Haiku classifier) — more reliable, zero cost
- Ad-hoc automations auto-fire at creation — eliminates tool round trip, ~3-5s saved
- Inline progress bar only for `once:true` jobs — recurring automations stay in side panel
- S3.5 routing/delivery issues were architectural (alert() bypasses Headless App) — warranted own milestone

**Results:** 75% delegation compliance (up from 25%). Delegation works for research tasks. Routing/delivery issues escalated to M9.4.

**Dependencies:** M9.2 (worker infrastructure, todo system)

---

### M9.4: Conversation UX/UI — DONE

Fix real-time notification delivery, unify all message paths through the Headless App, and replace the broken inline progress bar with a proper job progress card.

**Design spec:** [conversation-ux-ui-design.md](superpowers/specs/2026-04-08-conversation-ux-ui-design.md)
**Origin:** M9.3-S3.5 testing revealed `alert()` bypasses M6.10 Headless App — responses saved to DB but never broadcast to WebSocket clients. CTO architect review broadened scope from "missing broadcast" to architectural model correction.

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Real-Time Notification Delivery | Done | Route `alert()`, `initiate()`, and ResponseWatchdog through `app.chat`. Correct channel decision: `getCurrent()` (no threshold) + web recency for channel choice. Deprecate `getActiveConversation()`. Simplify heartbeat. E2E smoke test. [Plan](../sprints/m9.4-s1-notification-delivery/plan.md) |
| S2 | Channel Message Unification | Done | Route inbound channel messages (WhatsApp) through `app.chat` for brain interaction. New `app.chat.injectTurn()` for admin inject + scheduler (write-only, no brain). Extend `ChatMessageOptions` with channel metadata + source field. STT unified: transports pass raw audio, `sendMessage()` transcribes. [Plan](../sprints/m9.4-s2-channel-unification/plan.md) · [Review](../sprints/m9.4-s2-channel-unification/review.md) |
| S2.5 | Streaming Broadcast | Done | All streaming events (text_delta, done, thinking, error) flow through App events → WS broadcast. All callers auto-broadcast. Removed `conversation_ready`. Swept 6 bypassed mutation paths (unpin, setModel, abbreviation rename, job:started, external messages) through App events. Audio players on incoming voice notes + persisted TTS audioUrl on outgoing. [Plan](../sprints/m9.4-s2.5-streaming-broadcast/plan.md) · [Review](../sprints/m9.4-s2.5-streaming-broadcast/review.md) |
| S3 | Job Progress Card | Done | Replace inline progress bar with sticky card above compose box. Collapsed (default): current step + done/total. Expanded (click/tap): full step list, 5-row max with scrollbar, ✕ to close. Max 2 cards. StatePublisher includes todo items in snapshot. [Plan](../sprints/m9.4-s3-job-progress-card/plan.md) · [Review](../sprints/m9.4-s3-job-progress-card/review.md) |
| S4 | Brief Delivery Pipeline Fix | Done | Remove `.slice(0, 500)` truncation, read worker artifacts from disk instead of raw stream, mandatory deliverable todo with validator, Haiku fallback for missing artifacts, verbatim framing in both delivery paths, debrief-reporter becomes assembler (no Haiku re-digest). [Plan](../sprints/m9.4-s4-brief-delivery-fix/plan.md) · [Review](../sprints/m9.4-s4-brief-delivery-fix/architect-review.md) · [Bug](../bugs/2026-04-08-brief-delivery-broken.md) |
| S5 | Job Card Handoff Continuity | Done | Closed the ~30 s silent gap between job completion and Nina's reply. (A) event-triggered notification drain — `HeartbeatService.drainNow()` invoked by `AutomationProcessor` after enqueue. (B) progress card three-phase state (running → handing-off → fading) with sibling-aware 10 s safety net and mandatory `handoff_pending` WS broadcast. [Spec](../sprints/m9.4-s5-job-card-handoff/spec.md) · [Plan](../sprints/m9.4-s5-job-card-handoff/plan.md) · [Review](../sprints/m9.4-s5-job-card-handoff/review.md) · 474 unit + 16 browser tests passing. Origin: M9.5-S6 [FOLLOW-UPS UX-1](../sprints/m9.5-s6-screenshot-pipeline/FOLLOW-UPS.md) |
| S6 | Progress Cadence — Methodical Worker Rhythm | Done | Prompt-sprint core: `## Progress Cadence` appended as the tail section of the worker system prompt, with the worker's todos inlined as `- [id: X] text` bullets. Worker now narrates step-by-step instead of batching at the end. α-gate (live CNN run via `/pair-browse`) confirmed cadence. Scope expanded mid-sprint to redesign the progress card (DEV-1): counter pill `● K/N Done` / `✓ N/N Done` / `✗ Task K failed` floats over the top border; row shows bullet + task number + step text with only the in-progress `→` pulsing. [Spec](../sprints/m9.4-s6-progress-cadence/spec.md) · [Plan](../sprints/m9.4-s6-progress-cadence/plan.md) · [Deviations](../sprints/m9.4-s6-progress-cadence/DEVIATIONS.md) · [Review](../sprints/m9.4-s6-progress-cadence/review.md) · [Test report](../sprints/m9.4-s6-progress-cadence/test-report.md) · Origin: M9.4-S5 [FOLLOW-UPS UX-2](../sprints/m9.4-s5-job-card-handoff/FOLLOW-UPS.md) |

**Key decisions:**
- The 15-minute threshold is correct in purpose (channel decision) but was wrong in implementation (combined with "which conversation"). Split into `getCurrent()` + `getLastWebMessageAge()`.
- Message-handler retains channel-specific logic (conversation resolution, outbound delivery, typing, voice). Only brain invocation routes through `app.chat`.
- `injectTurn()` is a new `app.chat` method for transcript writes without brain invocation (admin, scheduler).
- Progress card is a standalone widget, not attached to messages. Jobs with many steps scroll within a 5-row container.
- Brief delivery: workers summarize their own work (one summarization), reporter assembles (no LLM), Conversation Nina presents. Three-layer fallback: disk artifact → short stream as-is → Haiku summarize. No truncation at any level.

**Results:** All message paths route through Headless App. Notifications delivered in real-time. WhatsApp messages unified through `app.chat`. Streaming events broadcast via App events. Job progress cards replace inline progress bar. Brief delivery fixed — workers summarize, reporter assembles, no truncation.

**Dependencies:** M6.10 (Headless App), M9.3 (Delegation Compliance — auto-fire + progress infrastructure)

---

### M9.5: Capability Framework v2 — DONE

Extend the capability framework to support MCP-based capabilities alongside script-based ones. Extract desktop control from hardwired framework code into a pluggable capability. Add unified settings UI for capability toggles.

**Design spec:** [capability-framework-v2.md](design/capability-framework-v2.md)
**Origin:** Desktop control (M8) is hardwired into the dashboard. Voice (M9) is pluggable. This milestone makes both follow the same capability pattern, proving the framework handles diverse socket shapes.

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Framework Extension | Done | Extend registry for `mcp` interface: `entrypoint`, `requires.system`, `.enabled` toggle, three-tier tool contract types. Extend scanner for system tool probing. Extend test harness for MCP capabilities (spawn, connect, validate tools, functional screenshot test). Smoke-test MCP capability validates the harness. [Plan](../sprints/m9.5-s1-framework-extension/plan.md) · [Review](../sprints/m9.5-s1-framework-extension/review.md) · [Architect Review](../sprints/m9.5-s1-framework-extension/architect-review.md) |
| S2 | Settings UI | Done | Capabilities section in settings. All well-known types rendered (installed/disabled/not-installed states). Toggle on/off. Health indicators. Disabled hint: "Ask {agent_name} to add {type}". New `GET /api/settings/capabilities` and `POST /api/settings/capabilities/:type/toggle` endpoints. Browser-tested. [Plan](../sprints/m9.5-s2-settings-ui/plan.md) · [Review](../sprints/m9.5-s2-settings-ui/review.md) · [Architect Review](../sprints/m9.5-s2-settings-ui/architect-review.md) |
| S3 | Desktop Extraction | Done | Standalone desktop-x11 capability, registry-based wiring, dual-path migration, all legacy code deleted (7 files), middleware wired (PreToolUse rate limiter, PostToolUse audit + screenshot), S1/S2 deferred items resolved. 321 tests. [Plan](../sprints/m9.5-s3-desktop-extraction/plan.md) · [Architect Review](../sprints/m9.5-s3-desktop-extraction/architect-review.md) |
| S4 | Template & Agent Verification | Done | Template written, harness extended (schema validation + functional screenshot), agent single-shot built capability from scratch, Nina read KWrite text via desktop tools. S3 deferred items resolved (dead crash code, enabled-gate, 7-tool fixture). [Plan](../sprints/m9.5-s4-template-verification/plan.md) · [Architect Review](../sprints/m9.5-s4-template-verification/architect-review.md) |
| S5 | Test Cleanup + UX Fixes | Done | Delete 5 orphaned test files, fix 2 stale tests. Auto-create `.enabled` on build. **Nina's UX feedback:** add `desktop_focus_window` as 8th required tool, include `scaleFactor` in screenshot metadata. All tests green. [Plan](../sprints/m9.5-s5-test-cleanup/plan.md) · [Review](../sprints/m9.5-s5-test-cleanup/review.md) |
| S6 | Screenshot Pipeline | Done | Generic `storeAndInject()` middleware: any MCP tool that returns an image gets stored in VAS, URL injected into tool result, brain curates which to show the user. Framework-level curation directive in system prompt. Playwright MCP added to automation workers. Both smoke tests passed (KWrite conversation + CNN scheduled automation). Four SDK integration bugs found and fixed via smoke testing. [Spec](../sprints/m9.5-s6-screenshot-pipeline/spec.md) · [Plan](../sprints/m9.5-s6-screenshot-pipeline/plan.md) · [Decisions](../sprints/m9.5-s6-screenshot-pipeline/DECISIONS.md) · [Follow-ups](../sprints/m9.5-s6-screenshot-pipeline/FOLLOW-UPS.md) |
| S7 | Browser Capability | Done | First multi-instance capability type. `@playwright/mcp` migrated from hardcoded into `browser-control` capability. Each browser (Chrome, Edge, Firefox, …) is its own folder with its own `user-data-dir`. Settings UI shows per-instance toggle + delete + persistent "Add another" hint. Hardcoded fallback removed (registry-only path). Phase F PASS: Nina built browser-chrome from scratch in iteration 2 (real-world artifact: Polish cookie modal proved fresh-profile navigation). All 4 follow-ups closed in-branch — discoverability gap (FU4), `.enabled` auto-create + no-self-restart (FU3), folder-slug rule (FU2), legacy install card removed (FU1). 18 commits. New design note: [Adding a Multi-Instance Capability Type](design/adding-a-multi-instance-capability-type.md). [Plan](../sprints/m9.5-s7-browser-capability/plan.md) · [Review](../sprints/m9.5-s7-browser-capability/review.md) · [Test Report](../sprints/m9.5-s7-browser-capability/test-report.md) · [Decisions](../sprints/m9.5-s7-browser-capability/DECISIONS.md) · [Follow-ups](../sprints/m9.5-s7-browser-capability/FOLLOW-UPS.md) |

**Key decisions:**
- Two socket shapes: `script` (framework calls, stateless) and `mcp` (brain calls, stateful). Determined by who invokes the capability.
- Capabilities are pure abilities only — not transport, not channel. Email/calendar stay as plugins/transports.
- `computer-use-service.ts` (Claude beta API) dropped — not MCP-based.
- Three-tier tool contracts: required (must pass), optional (validated if present), custom (ignored by harness).
- Platform code is never in framework. macOS/Wayland = different capability folders, same socket.

**Absorbs:** M13-S4 (macOS backend) and M13-S5 (Wayland backend) — each platform becomes an agent-built capability against the `desktop-control` template.

**Dependencies:** M9 (capability system), M8 (desktop automation)

---

### M9.6: Capability Resilience & Recovery — RE-OPENED (2026-04-16, Phase 2: Universal Coverage)

Make capability failures recoverable at runtime — for **any plug type, from any origin (conversation, automation, system)**. Phase 1 shipped STT-only. Phase 2 makes coverage systemic so new plug types inherit recovery without per-type CFR code.

**Phase 2 design:** [plan-universal-coverage.md](sprints/m9.6-capability-resilience/plan-universal-coverage.md) v2.2 · [HANDOFF](sprints/m9.6-capability-resilience/HANDOFF-cfr-coverage-gap.md) (the class failure Phase 1 left)

**Origin:** 2026-04-15 voice-message incident (conv-01KP3WPV3KGHWCRHD7VX8XVZFZ). Four distinct bugs compounded into "Nina received three voice messages and silently replied to none":

1. **Registry activation** — `stt-deepgram/.enabled` was missing; capability was configured but inert. Registry skipped it. No user-visible signal.
2. **Deps-on-first-WS wiring** — `AppChatService.setDeps()` is only called inside the WebSocket handler. WhatsApp voice notes processed before any browser connects silently bypass STT (no attachment save, no transcription).
3. **Self-destructive restart** — Brain ran `systemctl --user restart nina-dashboard.service` mid-stream twice to activate its own fix, SIGTERMing itself and killing the in-flight user reply.
4. **No orphaned-turn recovery** — Brain killed mid-stream leaves user's turn in JSONL with no assistant reply. Nothing detects or re-drives it.

**The deeper gap:** The 3-tries rule exists ([m9.5-s7 plan.md:272-273](sprints/m9.5-s7-browser-capability/plan.md), [adding-a-multi-instance-capability-type.md:44](design/adding-a-multi-instance-capability-type.md)) but only as an agent-build acceptance gate. At runtime, the brain has no protocol for "capability failed on this user message." So the user had to say "fix it" instead of Nina auto-triggering the fix automation on voice #1.

**Milestone exit criteria:**
- Voice #1 scenario: transcription fails → Nina acknowledges to user ("voice isn't working, fixing") → fix automation fires → verifies against the actual failing audio → replies transcribed. No "fix it" prompt required.
- Iteration 3 still fails → user sees "I tried 3 fixes, please resend as text" — graceful, not silent.
- Dashboard restart required to activate a capability → deferred until idle, or hot-reload via registry rescan. Never SIGTERMs an active turn.
- Brain killed mid-stream → startup watchdog scans latest conversation, detects unanswered user turns, re-drives them.
- Capability works on WhatsApp voice note even with no browser ever connected.

| Sprint | Name | Status | Artifacts |
|--------|------|--------|-----------|
| S1 | Raw-Media Persistence + CFR Detector | Done | 43 tests. `RawMediaStore` persists every inbound buffer before deps check. `failure-detector.ts` emits `CapabilityFailure` events on STT placeholder, deps-missing, execution errors. [Plan](sprints/m9.6-capability-resilience/plan.md) · [Review](sprints/m9.6-capability-resilience/s1-review.md) · [Architect](sprints/m9.6-capability-resilience/s1-architect-review.md) |
| S2 | Deps Wiring on Boot | Done | 6 tests. `AppChatService.setDeps()` moved from first-WS handler to App construction. Voice notes transcribe with no browser connected. [Review](sprints/m9.6-capability-resilience/s2-review.md) · [Architect](sprints/m9.6-capability-resilience/s2-architect-review.md) |
| S3 | Hot-Reload + Restart Gap Closure | Done | 26 tests. `CapabilityWatcher` (chokidar) drives `registry.rescan()` on fs change. Claude Code hook blocks `systemctl restart nina-*` unconditionally. Fix-automation prompts updated. [Review](sprints/m9.6-capability-resilience/s3-review.md) · [Architect](sprints/m9.6-capability-resilience/s3-architect-review.md) |
| S4 | Recovery Orchestrator | Done | 28 tests. `RecoveryOrchestrator` + pure state machine: 3-iteration cap, structured reflection, per-type mutex, cross-conv surrender cooldown, reverify against actual artifact. `emitAck` stub (S6 replaces). [Review](sprints/m9.6-capability-resilience/s4-review.md) · [Architect](sprints/m9.6-capability-resilience/s4-architect-review.md) |
| S5 | Orphaned-Turn Watchdog | Done | 11 tests. Boot-time sweep rescues unanswered user turns (< 30 min), re-transcribes audio orphans via reverify, marks stale turns resolved. Abbreviation queue honors `turn_corrected`. Surrender-marker check forward-compatible for S6. [Review](sprints/m9.6-capability-resilience/s5-review.md) · [Architect](sprints/m9.6-capability-resilience/s5-architect-review.md) |
| S6 | User-Facing Resilience Messaging | Done | `resilience-messages.ts` — ack / status / surrender copy, deterministic delivery on correct channel. Capability confidence contract (`confidence`, `duration_ms` fields). Replaces `emitAck` stub from S4. [Review](sprints/m9.6-capability-resilience/s6-review.md) · [Architect](sprints/m9.6-capability-resilience/s6-architect-review.md) |
| S7 | Phase 1 Exit Gate — STT only | Done | Voice #1 incident replayed end-to-end on STT. Passed. Did **not** cover other plug types. [Review](sprints/m9.6-capability-resilience/s7-review.md) · [Architect](sprints/m9.6-capability-resilience/s7-architect-review.md) |
| S8 | Code-level cleanup | Done | Dashboard ack render, cooldown-hit event noise, elapsedSec cleanup. [Architect](sprints/m9.6-capability-resilience/s8-architect-review.md) |
| — | **— Phase 2: Universal Coverage —** | — | [plan-universal-coverage.md](sprints/m9.6-capability-resilience/plan-universal-coverage.md) §12 has per-sprint detail |
| S9 | TriggeringOrigin type landing | Done | Zero-behavior type widening: `TriggeringInput.origin` discriminated union (conversation/automation/system). Backfills emit + consumer sites with conversation-origin default. Prerequisite for S12. [§12.1](sprints/m9.6-capability-resilience/plan-universal-coverage.md#121-sprint-9--triggeringorigin-type-landing) |
| S10 | CapabilityInvoker + exec-bit validation | Done | Single gate for script-plug invocation. STT + TTS callsites route through it. Exec-bit validator in test-harness. `classifySttError` folded into invoker. [§12.2](sprints/m9.6-capability-resilience/plan-universal-coverage.md#122-sprint-10--capabilityinvoker--exec-bit-validation) |
| S11 | Template smoke fixtures | Done | Every capability template (audio-to-text, text-to-audio, text-to-image, browser-control, desktop-control) ships a `scripts/smoke.sh` contract + `fallback_action` frontmatter. [§12.3](sprints/m9.6-capability-resilience/plan-universal-coverage.md#123-sprint-11--template-smoke-fixtures) |
| S12 | PostToolUseFailure CFR hook + automation-origin wiring | Done | MCP-plug detection via SDK's typed error hook + `processSystemInit()` (Mode 3, spike-confirmed). Registry `findByName`. Brain + automation-executor both attach detector with SessionContext maps. Ack-delivery gains automation/system branches; `CFR_RECOVERY.md` writer; debrief-prep reader extension (runDir wired through). Orchestrator `attachedOrigins` N-aware mutex + 6-step terminal drain + Option A surrender. S10 placeholder origin replaced. 61 S12 tests + 245/35 regression green. [§12.4](sprints/m9.6-capability-resilience/plan-universal-coverage.md#124-sprint-12--posttoolusefailure-cfr-hook--automation-origin-wiring) · [Plan](sprints/m9.6-capability-resilience/s12-plan.md) · [Review](sprints/m9.6-capability-resilience/s12-review.md) |
| S13 | Reverify dispatcher + terminal-on-fix | Done | Per-type reverifiers (TTS, image-to-text, text-to-image) + `runSmokeFixture` default. `dispatchReverify` + REVERIFIERS table. Exit-2 inconclusive handling. `RESTORED_TERMINAL` state + `TERMINAL_ACK` action. Origin-aware terminal routing via S12 drain. 259 tests (2 pre-existing skips). Sprint numbering re-aligned from plan-universal-coverage.md: reflect-collapse moved to S17 (Phase 3, post-S15 fix-engine swap) per [plan-phase2-coverage.md §2.5](sprints/m9.6-capability-resilience/plan-phase2-coverage.md). [Plan](sprints/m9.6-capability-resilience/s13-plan.md) · [Decisions](sprints/m9.6-capability-resilience/s13-DECISIONS.md) · [Deviations](sprints/m9.6-capability-resilience/s13-DEVIATIONS.md) |
| S14 | Friendly names + multi-instance + per-type fallback copy | Done | `createResilienceCopy(registry)` factory replacing `defaultCopy`. `FRIENDLY_NAMES` extended to all 6 types. `instanceSuffix` for multi-instance plugs. `terminalAck` per-type copy. `fallback_action`/`multi_instance` frontmatter fields + scanner + registry helpers (`isMultiInstance`, `getFallbackAction`). `capabilityName` in `InvokeOptions` (FU-4). Fixed `terminal-fixed` + `surrender-cooldown` emitAck branches. 290 tests (2 pre-existing skips). [Plan](sprints/m9.6-capability-resilience/s14-plan.md) · [Decisions](sprints/m9.6-capability-resilience/s14-DECISIONS.md) · [Deviations](sprints/m9.6-capability-resilience/s14-DEVIATIONS.md) · [Test report](sprints/m9.6-capability-resilience/s14-test-report.md) |
| S15 | Phase 2 exit gate — E2E incident replay for all installed plug types | In Progress | TTS CFR detection wired (`synthesizeAudio` → `CapabilityInvoker`). `reverifyTextToAudio` arg contract + MP3 header fix (pre-existing S13 bugs). 4 E2E exit gates: STT real-incident replay (v2 origin, Songkran reprocess), TTS terminal-path (terminal-fixed ack), browser-chrome synthetic (automation-origin, CFR_RECOVERY.md), desktop-x11 synthetic. S7 regression gate passed. 290 core tests (2 pre-existing skips). Architect review in progress. [Plan](sprints/m9.6-capability-resilience/s15-plan.md) · [Review](sprints/m9.6-capability-resilience/s15-review.md) · [Test report](sprints/m9.6-capability-resilience/s15-test-report.md) |
| — | **— Phase 3: Architecture Refinements —** | — | [plan-phase3-refinements.md](sprints/m9.6-capability-resilience/plan-phase3-refinements.md) has per-sprint detail |
| S16 | Fix-engine swap + wall-time measurement | Planned | Orchestrator invokes `capability-brainstorming` skill in fix-mode (Opus, one-shot). `AutomationSpec.targetPath` plumbing. `.my_agent/` write-guard exemption for `capability_modify`. `JOB_TIMEOUT_MS` = 15 min. Wall-time measured; mitigation proposal if >5 min. Ships before S17 so old path stays at full quality during transition. [§2.1](sprints/m9.6-capability-resilience/plan-phase3-refinements.md#21-sprint-16--fix-engine-swap-to-capability-brainstorming-fix-mode) |
| S17 | Reflect-phase collapse (dead-code cleanup) | Planned | Delete REFLECTING state; fix-mode (S16) made it dead code. `MAX_JOBS` 5→4. Remove `reflectJobId` from `FixSession`. Delete `fix-automation.md`. Must ship after S16 green for one sprint. [§2.2](sprints/m9.6-capability-resilience/plan-phase3-refinements.md#22-sprint-17--reflect-phase-collapse-dead-code-cleanup) |
| S18 | Duplicate TTS path collapse | Planned | `chat-service.synthesizeAudio` becomes authoritative. Delete Baileys `onSendVoiceReply` synthesis. `reverifyAudioToText` bash-wrapper removal (S10-FU-2 + S13-FU-1). Finalize `// TODO(S13/S17)` marker. Must ship after S17. [§2.3](sprints/m9.6-capability-resilience/plan-phase3-refinements.md#23-sprint-18--duplicate-tts-path-collapse) |
| S19 | Ack coalescing + assistant-turn orphan + system-origin UI | Planned | Coalesce attempt/status acks into single per-type notification. Orphaned-assistant-turn detection on terminal transitions. System-origin CFRs surfaced in dashboard health page. [§2.4](sprints/m9.6-capability-resilience/plan-phase3-refinements.md#24-sprint-19--ack-coalescing--assistant-turn-orphan--system-origin-ui) |
| S20 | Phase 3 exit gate — two definitive smoke tests | Planned | (1) Working Nina screenshots a website after browser plug deliberately broken. (2) Conversation Nina understands a voice message after STT plug deliberately broken. `AppHarness` + recording mock transport. Abbreviated replays for every other registered plug type. **M9.6 closes here. M10 unblocks.** [§2.5](sprints/m9.6-capability-resilience/plan-phase3-refinements.md#25-sprint-20--phase-3-exit-gate-two-definitive-smoke-tests) |

**Key design decisions:**
- 3-tries is a **conversation-level protocol**, not a build-phase gate. Runtime failures trigger it; the agent-build flow is one special case (build counts as iteration 1).
- Fallback message is **always user-visible**. Silent failure is the bug we're fixing.
- `.enabled` file is not a hidden gate — missing `.enabled` must raise a capability-health warning on registry scan (surfaces in Settings UI).
- Hot-reload > restart. If a capability genuinely requires process restart (rare), surface it to the user rather than self-kill.
- Orphaned-turn watchdog is **startup-only**, not periodic. Periodic re-driving is a loop risk; startup is bounded.

**Dependencies:** M9 (capability system), M9.5 (resilience lives in the capability framework)

**Blocks:** M10 and everything downstream. No new channel work starts until capability failures can no longer dead-drop a conversation — every channel added before M9.6 inherits the same fragility.

**Design spec:** [capability-resilience.md](design/capability-resilience.md) — draft, awaiting red-team review. Incident reference: `conv-01KP3WPV3KGHWCRHD7VX8XVZFZ`.

---

### M10: Channel SDK — PLANNED

Perfect the transport/channels system with clean decoupling and easy extensibility. Ship 4 production channels pre-launch (WhatsApp + Telegram + Discord + Line). End with Nina authoring a channel solo as proof the SDK is usable without us.

**Design spec:** [release-roadmap-design.md](superpowers/specs/2026-03-21-release-roadmap-design.md) §M10

**Core principle:** Transport (wire: connect/send/receive/auth) and Channel (owner-identity binding on top) are separate contracts. A transport without a channel is still useful — future milestones (external communications, email-as-capability) layer on top without forcing every transport through the channel abstraction.

**Non-scope:** email, external communications (working-Nina-to-strangers), per-contact rulesets. Those are M11. M10-S1 designs forward-compat for them without implementing.

**Inspiration:** OpenClaw connector patterns; Anthropic's Claude Code "Channels" MCP model (envelope + sender gating + capability declaration patterns, adapted for our multi-user case).

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S0 | Routing Simplification | Done | **M10 blocker.** Eliminated `sourceChannel` tagging and all routing hardcodes. One presence rule at delivery: last user turn's channel if within 15 min, else preferred channel. Removes the class of WhatsApp-bleed bugs (#2/#3/#4). [Plan](sprints/m10-s0-routing-simplification/plan.md) · [Review](sprints/m10-s0-routing-simplification/review.md) · [Architect review](sprints/m10-s0-routing-simplification/architect-review.md) · [Decisions](sprints/m10-s0-routing-simplification/DECISIONS.md) · [Fix doc](fixes/whatsapp-bleed-issue-4.md) · 32 M10-S0 tests, 0 prod refs to `sourceChannel`. Task 6 (re-deliver lost April-13 research) pending post-merge. |
| S1 | Transport + Channel SDK Design | Planned | **Pure design sprint — no implementation.** Spec deliverable covering: transport/channel decoupling, auth primitives (QR/OAuth/token/custom), sender gating enforcement point, lifecycle hooks, health/status surface, capability declarations (inbound/outbound/richContent/groupChat), protocol-expressibility for future subprocess runtimes, and forward-compat analysis for how M11 external-communications will layer working-Nina-outbound + stranger-inbound on the same transports without coupling to the channel layer. |
| S2 | WhatsApp Migration — Gold Bar | Planned | Refactor `plugins/channel-whatsapp/` onto the new SDK. Becomes the reference implementation every future channel is measured against. |
| S3 | Telegram Channel | Planned | Framework-built. Simplest bot-API-shaped channel. First validation that SDK works for non-WhatsApp. |
| S4 | Discord Channel | Planned | Framework-built. Real-time WebSocket path. Tests SDK's range against event-based transports. |
| S5 | SDK Docs + Scaffold + Skill | Planned | Public SDK docs, `create-channel` scaffold, `channel-brainstorming` skill + `channel-builder` agent, templates in `skills/channel-templates/` for webhook-bot, long-poll-bot, websocket-bot shapes. |
| S6 | Line Channel — Co-Build with Nina | Planned | Nina drives, we pair. Every SDK/docs friction surfaced becomes a contract or instruction fix. Deliverable: Line channel + list of SDK refinements applied. |
| S7 | Agent-Authored Channel — Proof | Planned | Nina builds a new channel solo from a user request (candidate: Slack, Mastodon, Signal, etc.). No pairing with us. Success = she ships it; failure reveals remaining SDK gaps. Either outcome is a valid milestone signal. |

**Key design decisions (locked):**
- **Transport ≠ channel.** Transport is infrastructure (wire). Channel is owner-identity binding on top. External communications + email-as-capability use transports without channel wrapping.
- **Channels list (pre-launch):** WhatsApp + Telegram + Discord + Line. iMessage, Signal, Slack, Mastodon, etc. are community/agent-built candidates.
- **Three tiers of authorship:** framework-shipped (WA/TG/Discord/Line), community-built (via scaffold + docs), agent-authored (via `channel-brainstorming` skill). Manifest declares tier.
- **Sender gating in framework, not plugin.** Plugin reports `fromIdentity`; framework decides channel binding. Keeps prompt-injection surface out of plugin hands.
- **Protocol-expressible contract.** SDK expressed as message protocol (inbound envelope + outbound call schema), not TS-interface-only. Enables future subprocess/multi-language runtimes without retrofit.
- **Post-generation adaptation stays in plugin.** Tone/length shaping stays in brain (task + channel jointly decide).

**Milestone exit criteria:**
- 4 channels shipped (WA migrated + TG + Discord + Line)
- SDK + scaffold + `channel-brainstorming` skill public
- One agent-authored channel exists (S7)
- M11 forward-compat analysis complete in S1 spec

**Dependencies:** M9.6 (capability resilience — hard blocker; every channel built before M9.6 inherits silent-failure fragility), M9 (capability system — channels may use capabilities for media handling)

**Supersedes:** Old M9 (Email Integration) and old M10 (External Communications). Email removed from M10; moves to M11 as a capability, not a channel.

---

### M11: External Communications — PLANNED

The agent communicates with people other than the owner, across all transports, via Working Agents. Adds email as a capability (not a channel) since nobody has conversations with their agent over email — email is a tool the agent *uses*, on the owner's behalf, against external contacts.

**Design spec:** [release-roadmap-design.md](superpowers/specs/2026-03-21-release-roadmap-design.md) §M11

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Email Capability (MS365) | Planned | Email as a capability, not a channel. MS365 via Microsoft Graph API. OAuth flow, inbound polling, outbound sending, attachments, threading. Agent uses it like any other tool. |
| S2 | External Contact Routing | Planned | Working Agent spawned per external contact/conversation on the transports built in M10 (WhatsApp + Discord + Telegram + Line) + email capability. Contact registry (markdown-first). Inbound routing for non-owner senders. |
| S3 | Ruleset + Approval Flow | Planned | Cross-channel ruleset model (auto-reply, queue, block per contact/group). Approval UI in dashboard. Outbound sending on behalf of owner. Notification on escalation. |

**Key design questions (resolve during spec):**
- Contact identity across transports (same person on WhatsApp + email = one contact?)
- Ruleset storage: per-contact YAML or workspace-level config?
- Approval UX: quick-approve vs. full review queue?
- How working Ninas share a transport with conversation-Nina without stepping on each other's auth/rate limits (pre-resolved by M10-S1's forward-compat analysis).

**Dependencies:** M10 (Channel SDK — transports must exist before routing external messages through them; M10-S1 spec pre-designs how working-Nina outbound layers on)

**⚠️ Stashed Code:** M3-S4 stashed code is almost certainly incompatible with M6.7 architecture. Evaluate before attempting recovery — likely discard.

---

### M12: iOS App — PLANNED

Native iOS app for the agent. Push notifications, multimodal support, full assistant experience on mobile.

**Design spec:** [release-roadmap-design.md](superpowers/specs/2026-03-21-release-roadmap-design.md) §M12

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | App Foundation | Planned | Project setup (Swift/SwiftUI), headless App client connection, auth flow, basic chat UI. |
| S2 | Full Chat Experience | Planned | Streaming responses, rich content rendering (images, files, micro-websites), voice input/output, conversation history, conversation switching. |
| S3 | Native Features | Planned | Push notifications (APNs), Siri Shortcuts, home screen widget, background refresh, app store preparation. |

**Key design questions (resolve during spec):**
- Connection model: via dashboard server or direct to headless App?
- SwiftUI vs. React Native vs. WebView wrapper?
- Push notification delivery architecture

**Dependencies:** M11 (external comms — iOS app benefits from all channels + multimodal being complete)

---

### M13: Platform Hardening — PLANNED

Infrastructure that makes the agent safe, recoverable, updatable, and cross-platform.

**Design spec:** [release-roadmap-design.md](superpowers/specs/2026-03-21-release-roadmap-design.md) §M13

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Dashboard Authentication | Planned | Session-based auth for web UI. Login flow, session tokens, secure cookies. Multi-user foundation (owner + guests). |
| S2 | Backup & Restore | Planned | Full/partial backup (`.my_agent/` + DBs + config). Restore with index rebuild. CLI commands. Automated pre-update backup. |
| S3 | Update Mechanism | Planned | Version tracking, `my-agent update`, schema migrations, breaking change detection, rollback via backup. Includes framework skill updates: detect newer versions in `packages/core/skills/`, prompt user to update `.my_agent/.claude/skills/` copies (respect user customizations). |
| ~~S4~~ | ~~Desktop Control — macOS~~ | Absorbed | → M9.5 Capability Framework v2 (macOS becomes an agent-built capability against `desktop-control` template) |
| ~~S5~~ | ~~Desktop Control — Wayland~~ | Absorbed | → M9.5 Capability Framework v2 (Wayland becomes an agent-built capability against `desktop-control` template) |
| ~~S6~~ | ~~Self-Service MCP Integration~~ | Absorbed | → M9 Capability System (capabilities supersede MCP-specific approach) |

**Key design questions (resolve during spec):**
- Auth: password/token or OAuth?
- Backup format: tarball or structured export?
- Update channel: git pull, npm, or custom registry?
- Credential vault: upgrade M9's `.env`-based secrets to encrypted storage

**Dependencies:** M12 (iOS app — hardening happens after all features are built)

---

### M14: Release — PLANNED

Everything is audited, documented, and ready for other people to use.

**Design spec:** [release-roadmap-design.md](superpowers/specs/2026-03-21-release-roadmap-design.md) §M14

| Sprint | Name | Status | Scope |
|--------|------|--------|-------|
| S1 | Security Audit | Planned | Review trust tiers, hooks, guardrails. Pen-test auth. Audit transport SDK auth flows. Review Computer Use safety hooks. Harden permissions. Fix findings. |
| S2 | Documentation + Launch | Planned | User-facing README, getting started guide, hatching walkthrough, transport SDK guide, architecture overview. Examples. Landing page. License. |

**Dependencies:** M13 (hardening — security audit reviews hardened platform)

---

### ~~Old M7: Coding Projects~~ — SUPERSEDED → M7 Persistent Workspaces

"User's Code Projects" reframed as a persistent workspace pointed at a repo. Process supervision deferred. Session streaming and `/whats-next` deliverables remain valid for future enhancement.

**Original design spec:** [coding-projects.md](design/coding-projects.md) — historical reference

---

### ~~Old M8: Operations Dashboard~~ — ABSORBED → M6.6

Most operations UI already exists from M5-S10 (live dashboard) and M6 (memory). Work loop status and responsibility management folded into M6.6 sprints.

**Original design spec:** [operations-dashboard.md](design/operations-dashboard.md) — historical reference

---

## Design Specs

Design specs define architecture before implementation. Each spec should be complete before sprints begin.

| Spec                 | Status   | Milestones  | Path                                                             |
| -------------------- | -------- | ----------- | ---------------------------------------------------------------- |
| Channels             | Complete | M3, M10, M11 | [design/channels.md](design/channels.md)                        |
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
| SDK Alignment        | Complete | M6.5        | Sprint plans in `sprints/m6.5-s*/plan.md`                        |
| settingSources       | Revised  | M6.5, M6.8  | [design/settings-sources-evaluation.md](design/settings-sources-evaluation.md) |
| Two-Agent Refactor   | Approved | M6.7        | [plans/2026-03-04-conversation-nina-design.md](plans/2026-03-04-conversation-nina-design.md) |
| Skills Architecture  | Complete | M6.8        | [superpowers/specs/2026-03-15-skills-architecture-design.md](superpowers/specs/2026-03-15-skills-architecture-design.md) |
| Release Roadmap      | Approved | M8–M13      | [superpowers/specs/2026-03-21-release-roadmap-design.md](superpowers/specs/2026-03-21-release-roadmap-design.md) |
| Visual & Desktop Automation | Complete | M8 | [superpowers/specs/2026-03-29-m8-desktop-automation-design.md](superpowers/specs/2026-03-29-m8-desktop-automation-design.md) |
| Capability System    | Approved | M9          | [design/capability-system.md](design/capability-system.md) |
| Capability Framework v2 | Approved | M9.5      | [design/capability-framework-v2.md](design/capability-framework-v2.md) |
| Capability Resilience | Complete | M9.6 | [design/capability-resilience.md](design/capability-resilience.md) |
| Universal Paper Trail | Approved | M9 (S7-S8)  | [design/paper-trail.md](design/paper-trail.md) |
| ~~Multimodal~~       | Absorbed | ~~M9~~ → M9 Capability System | Voice/audio covered by M9; rich I/O covered by M8-S4 |
| Agentic Lifecycle    | Approved | M6.6        | [superpowers/specs/2026-03-11-memory-perfection-design.md](superpowers/specs/2026-03-11-memory-perfection-design.md) |
| Knowledge Lifecycle  | Approved | M6.9        | [sprints/m6.6-s6-knowledge-lifecycle/design.md](sprints/m6.6-s6-knowledge-lifecycle/design.md) |
| Trip Mode & Verification Pipeline | Complete | Process | [superpowers/specs/2026-03-12-trip-mode-verification-pipeline-design.md](superpowers/specs/2026-03-12-trip-mode-verification-pipeline-design.md) |
| Headless App         | Approved | M6.10       | [superpowers/specs/2026-03-16-headless-app-design.md](superpowers/specs/2026-03-16-headless-app-design.md) |
| Coding Projects      | Superseded | ~~M7~~ → M7 Workspaces | [design/coding-projects.md](design/coding-projects.md) |
| Operations Dashboard | Absorbed | ~~M8~~ → M6.6 | [design/operations-dashboard.md](design/operations-dashboard.md) |

**Note:** M3 (WhatsApp), M10 (Email), and M11 (External Comms) are covered by `channels.md`. M9 (Capability System) has its own spec. M6.7's conversation lifecycle and channel routing are covered by `conversation-nina-design.md`. `conversation-system.md` and `channels.md` need updates to align with M6.7 design.

---

## Dependencies

```
COMPLETED (critical path)
═════════════════════════
M1 ► M2 ► M3 ► M4 ► M4.5 ► M5 ► M6 ► M6.5 ► M6.7 ► M6.6 ► M6.9 ► M6.8 ► M6.10
                                                                                │
COMPLETED (M7–M8)                                                              │
═════════════════                                                               │
M7 Workspaces ◄─────────────────────────────────────────────────────────────────┘
  │
  ▼
M8 Visual & Desktop Automation — 884 tests

FUTURE (linear chain to release)
════════════════════════════════
M9 Capability System
  │
  ▼
M9.6 Capability Resilience & Recovery  ◄── BLOCKS M10+
  │
  ▼
M10 Channel SDK + Transports
  │
  ▼
M11 External Communications
  │
  ▼
M12 iOS App
  │
  ▼
M13 Platform Hardening (+ macOS/Wayland backends)
  │
  ▼
M14 Release
```

**Completed critical path:** M1 → M2 → M3 → M4 → M4.5 → M5 → M6 → M6.5 → M6.7 → M6.6 → M6.9 → M6.8 → M6.10 → M7 → M8. All complete. 935 tests (896 passing, 31 failing, 8 skipped).

**Future path:** M9 → **M9.6 (blocker)** → M10 → M11 → M12 → M13 → M14. ~25 sprints. Each milestone builds on the previous. Minimal rework, natural progression.

**Release definition:** Anyone can hatch their own agent. Self-extending capabilities *and* channels. Full multimodal communication. Owner channels: WhatsApp, Telegram, Discord, Line (+ agent-authored). External contacts on any of them, plus email as a capability. iOS app. Desktop automation. Persistent workspaces. Backup/restore/update. Secure and documented.

**Release roadmap spec:** [superpowers/specs/2026-03-21-release-roadmap-design.md](superpowers/specs/2026-03-21-release-roadmap-design.md)

**Sprint quality gate:** Every future milestone's final sprint includes E2E automated tests + one comprehensive human-in-the-loop test walkthrough.

---

## Ad-Hoc Sprints

Quick fixes and small enhancements outside the milestone structure.

| Sprint | Name | Status | Plan | Review | Notes |
| ------ | ---- | ------ | ---- | ------ | ----- |
| — | WhatsApp Typing Indicator | Planned | [plan](sprints/adhoc-whatsapp-typing-indicator/plan.md) | — | May fold into M10 or M11 |

---

## Pre-Release Checklist

Requirements that must be complete before public release. All tracked in milestones M13–M14.

| Item                         | Status  | Milestone | Notes                                                    |
| ---------------------------- | ------- | --------- | -------------------------------------------------------- |
| **Dashboard authentication** | Planned | M13-S1    | Session-based auth for web UI. Currently Tailscale-only. |
| **Backup & Restore**        | Planned | M13-S2    | Full/partial backup + restore with index rebuild. CLI commands. |
| **Update mechanism**         | Planned | M13-S3    | Version tracking, migrations, rollback via backup. |
| **Update Baileys to stable**  | Planned | M13       | Currently on 7.0.0-rc.9 (pre-release). `fetchProps` throws non-fatal 400 on every connect — known incomplete feature in RC. Update when stable 7.x ships. |
| **Security audit**           | Planned | M14-S1    | Review hooks, guardrails, trust tiers, transport auth, Computer Use safety. |
| **Documentation**            | Planned | M14-S2    | User-facing README, setup guide, hatching walkthrough, transport SDK guide. |

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

## Post-Release Backlog

Features enabled by the architecture but explicitly out of scope for release.

| Feature                        | Description                                                                   | Notes                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Additional Transports**      | Slack, Gmail, Telegram as transport plugins                                   | Community can build via Transport SDK (M10) or as capabilities (M9)          |
| **External Calendar Channels** | Google Calendar, Apple iCloud, Outlook as channel plugins                     | Each with own OAuth/auth flow, modeled like WhatsApp/Email channels          |
| **Mobile Dashboard (Phase 2)** | Advanced mobile features: bottom sheet chat, keyboard handling, accessibility | M2-S7 delivered foundation; remaining: peek/half/full chat, safe areas, a11y |
| **Navigable Timeline**         | Hero timeline, infinite scroll, search                                        | Design exists: [navigable-timeline.md](design/navigable-timeline.md)         |
| **Skill Registry**             | Curated, trust-tiered community skill marketplace                             | Community skill sharing and discovery                                         |
| **Mid-session Intervention**   | Send input to running Claude Code sessions                                    | Unblocked by Claude Code Channels (2026-04). Covered by the Nina CC Channel entry below. |
| **Nina as Claude Code Channel** | Ship Nina as an MCP channel plugin for Claude Code: relay CC sessions running on the owner's machine to the owner via Nina (WhatsApp/dashboard), including tool-approval prompts. | Research preview landed 2026-04. Requires CC v2.1.80+, claude.ai login. Custom channels need `--dangerously-load-development-channels` until the plugin is allowlisted. Revisit once Anthropic starts approving third-party channel plugins. One plugin = all my-agent users benefit. See [Claude Code channels reference](https://code.claude.com/docs/en/channels-reference). |

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

_Updated: 2026-03-21_
