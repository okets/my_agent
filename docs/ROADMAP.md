# my_agent — Roadmap

> **Source of truth** for project planning, milestones, and work breakdown.
> **Updated:** 2026-02-22

---

## Quick Status

| Milestone                    | Status   | Progress                     |
| ---------------------------- | -------- | ---------------------------- |
| **M1: Foundation**           | Complete | 4/4 sprints                  |
| **M2: Web UI**               | Complete | 6/6 sprints                  |
| **M3: WhatsApp Channel**     | Complete | 3/3 sprints                  |
| **M4: Notebook System**      | Complete | 2/2 sprints                  |
| **M4.5: Calendar System**    | Complete | 5/5 sprints                  |
| **M5: Task System**          | Active   | 8/9 sprints                  |
| **M5.5: Live Dashboard**     | Planned  | Design complete, 3 sprints   |
| **M6: Memory**               | Planned  | Design complete, sprints TBD |
| **M7: Coding Projects**      | Planned  | Design complete, sprints TBD |
| **M8: Operations Dashboard** | Planned  | Design complete, sprints TBD |
| **M9: Email Channel**        | Planned  | Design complete, sprints TBD |
| **M10: External Comms**      | Planned  | Deferred from M3/M4          |

---

## Visual Timeline

```
2026-02                                          2026-03+
├─────────────────────────────────────────────────────────────────────►

M1 Foundation    M2 Web UI       M3 WhatsApp    M4 Notebook   M4.5 Calendar   M5 Tasks      M5.5 Live    M6+ Future
[████████████]   [████████████]   [████████████]  [████████████]  [████████████]   [████████░░]   [░░░░░░░░]   [░░░░░░░░░░]
   COMPLETE         COMPLETE         COMPLETE        COMPLETE        COMPLETE         ACTIVE        PLANNED       PLANNED

                                                                                                                M6 Memory
                                                                                                                M7 Coding Projects
                                                                                                                M8 Ops Dashboard
                                                                                                                M9 Email
                                                                                                                M10 External Comms
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

### M5: Task System — ACTIVE

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
| S9     | Work + Deliverable        | Active   | [plan](sprints/m5-s9-task-steps/plan.md)                | —                                                           |

**Deliverables:**

- _(S1)_ Task entity in agent.db (renamed from conversations.db), TaskStorage, migration
- _(S2)_ TaskExecutor with session continuity, CalDAV integration (scheduled tasks create Task entities)
- _(S3)_ `notebook_edit` tool for section-based file editing (standing orders, preferences)
- _(S4)_ NotificationService (notify, request_input, escalate), notification routing, dashboard UI
- _(S5)_ Soft delete for tasks, task_conversations junction table, full Task REST API (CRUD + link queries), conversationId in brain system prompt, brain documentation for task API
- _(S6)_ Task list screen, task detail tab, shared components (StatusBadge, DetailHeader, etc.), entity tags in chat, create task form
- _(S7)_ _(Deferred)_ Request/input blocking for interactive task execution
- _(S8)_ Brain skill loading fix, TaskProcessor (immediate), TaskScheduler (scheduled), result delivery to conversation, E2E tests
- _(S9)_ Work + Deliverable architecture: typed WorkPlan with `<deliverable>` XML tags, DeliveryExecutor, channel-aware constraints, validation gate. Clean channel delivery — work output stays internal, only validated deliverables reach recipients.

**Philosophy:**

- **High autonomy:** Act, don't ask. If Nina can solve it, she solves it.
- **Real-time summaries:** Notify on task completion. User sees what got done.
- **Proportional effort:** Don't over-engineer for minor issues. If fix > problem, escalate.
- **Escalate rarely:** Only interrupt for things that truly need user judgment.
- **Learnable:** User feedback ("stop notifying about X") → standing order → behavior adapts.

**Dependencies:** M2 (dashboard), M4.5 (calendar scheduler)

---

### M5.5: Live Dashboard — PLANNED

Real-time state binding for kiosk displays. Backend pushes state, frontend auto-renders.

**Design spec:** [live-dashboard.md](design/live-dashboard.md)

| Sprint | Name                     | Status  | Plan | Review |
| ------ | ------------------------ | ------- | ---- | ------ |
| S1     | Core Infrastructure      | Planned | —    | —      |
| S2     | Calendar + Conversations | Planned | —    | —      |
| S3     | Polish + Documentation   | Planned | —    | —      |

**Deliverables:**

- _(S1)_ StatePublisher service, Alpine stores for tasks, connection indicator
- _(S2)_ Calendar and conversation state binding, multi-tab sync
- _(S3)_ Reconnection handling, TypeScript types, documentation

**Key Design Decisions:**

- Data binding (full state push) over event-based updates
- Alpine stores replace monolithic data() object
- All CRUD operations trigger state publish

**Dependencies:** M5 (Task System complete)

---

### M6: Memory — PLANNED

Notebook memory with flexible user-defined lists, daily summaries, semantic search.

**Design spec:** [memory-system.md](design/memory-system.md)

**Deliverables:**

- SQLite notebook with user-defined lists (contacts, shopping, preferences, etc.)
- MCP tools: list_create, entry_add, entry_search, entry_update, entry_delete
- Prompted additions ("Should I remember this?")
- Recall priority: Notebook → Conversation search → Ask user
- Daily summary generation (Haiku)

**Embedding Architecture:**

| Component | Choice | Notes |
|-----------|--------|-------|
| Embedding runtime | node-llama-cpp | GPU support (CUDA/Metal/Vulkan), no PyTorch needed |
| Default model | embeddinggemma-300M or nomic-embed | Small, fast on CPU, auto-download GGUF |
| Vector storage | sqlite-vec | In-DB vector queries, no JS loop |
| Search strategy | Hybrid (FTS5 + vector) | BM25 for exact tokens, vector for semantic |

**Constraint:** Local models only — no external API subscriptions beyond Anthropic.

**Dependencies:** M2 (conversation search as fallback)

---

### M7: Coding Projects — PLANNED

Autonomous coding: internal self-development projects + user code session relay.

**Design spec:** [coding-projects.md](design/coding-projects.md)

**Deliverables:**

- Internal Projects: folder templates, efficiency principles, autonomous Claude Code sessions
- User's Code Projects: dashboard spawns session on user's repo, streams to tab, summarize + "what next?"
- Active session streaming (stream-json via WebSocket, 100-event rolling buffer)
- Process supervision (non-LLM): alive/dead/blocked checks, crash recovery
- systemd watchdog with exponential backoff for internet/API recovery
- /whats-next deterministic self-sync skill
- NotificationService integration for escalation routing

**Dependencies:** M5 (task system, NotificationService)

**Note:** Sprint 1 must validate prototype checklist (folder-scoped --continue, stream-json format, concurrent sessions, SIGINT behavior, NotificationService). Results shape the architecture.

---

### M8: Operations Dashboard — PLANNED

Expand web UI with task management and memory viewer.

**Design spec:** [operations-dashboard.md](design/operations-dashboard.md)

**Deliverables:**

- Task browser: inbox/projects/ongoing
- Project detail view with approve/reject
- Memory viewer (notebook lists, entries, search)
- Settings: auth, models, channels
- "Open in VS Code" deep links

**Dependencies:** M5 (task system), M6 (memory)

---

### M9: Email Channel — PLANNED

Email plugin with both dedicated and personal roles.

**Design reference:** [channels.md](design/channels.md) (complete design)

**Deliverables:**

- Microsoft Graph MCP plugin
- Dedicated role: agent's email (info@company.com)
- Personal role: user's email (on-demand only)
- OAuth 2.0 auth flow
- Thread management

**Includes:**

- Channel-specific conversation naming (subject line + thread context). See `docs/design/conversation-system.md` §Conversation Naming.

**Dependencies:** M3 (channel pattern established), M5 (for email-triggered projects)

---

### M10: External Communications — PLANNED

Cross-channel external communications: personal channel role, ruleset model, approval flows.

**Design references:**

- [channels.md](design/channels.md) — identity-based routing, ruleset model, personal channel role
- [conversation-system.md](design/conversation-system.md) — external communications concept

**Deliverables:**

- Personal channel role (agent monitors user's accounts, on-demand only)
- Ruleset model with rule evolution via conversation
- External communications UI with approval flow for drafts

**Dependencies:** M5 (task system, notebook_edit tool)

**Note:** This milestone consolidates deferred work from M3-S4 and M4-S3/S4. Requires solid agentic flow from M5 before implementation.

**⚠️ Stashed Code:**
M3-S4 external communications implementation is stashed. To recover when ready:

```bash
git stash list   # Find stash@{0} and stash@{1}
# stash@{0}: M3-S4 untracked files (monitoring-config.ts, rules-loader.ts, external.ts)
# stash@{1}: M3-S4 external communications implementation (all package/ modifications)

# Pop in reverse order:
git stash pop stash@{1}  # Modified files first
git stash pop stash@{0}  # Then untracked files
```

---

## Design Specs

Design specs define architecture before implementation. Each spec should be complete before sprints begin.

| Spec                 | Status   | Milestones  | Path                                                             |
| -------------------- | -------- | ----------- | ---------------------------------------------------------------- |
| Channels             | Complete | M3, M9, M10 | [design/channels.md](design/channels.md)                         |
| Conversations        | Complete | M2          | [design/conversation-system.md](design/conversation-system.md)   |
| Notebook             | Complete | M4, M5, M10 | [design/notebook.md](design/notebook.md)                         |
| Calendar System      | Complete | M4.5        | [design/calendar-system.md](design/calendar-system.md)           |
| Task System          | Complete | M5          | [design/task-system.md](design/task-system.md)                   |
| Task Delivery (v2)   | Approved | M5          | [design/task-steps.md](design/task-steps.md)                     |
| Live Dashboard       | Complete | M5.5        | [design/live-dashboard.md](design/live-dashboard.md)             |
| Memory               | Complete | M6          | [design/memory-system.md](design/memory-system.md)               |
| Coding Projects      | Complete | M7          | [design/coding-projects.md](design/coding-projects.md)           |
| Operations Dashboard | Complete | M8          | [design/operations-dashboard.md](design/operations-dashboard.md) |

**Note:** M3 (WhatsApp), M9 (Email), and M10 (External Comms) are covered by `channels.md`. No separate specs needed.

---

## Dependencies

```
M1 Foundation ───► M2 Web UI ───► M3 WhatsApp ───► M4 Notebook ───► M4.5 Calendar
      (done)          (done)         (done)           (done)            (done)
                                                                          │
                                                                          ▼
                                                                      M5 Tasks
                                                                          │
                                                                          ▼
                                                                  M5.5 Live Dashboard
                                                                          │
                                                   ┌──────────────────────┼──────────────────────┐
                                                   │                      │                      │
                                                   ▼                      ▼                      ▼
                                               M6 Memory          M7 Coding Projects      M8 Ops Dashboard
                                                                                                 │
                                                   │                      │                      │
                                                   └──────────────────────┼──────────────────────┘
                                                                          │
                                                                          ▼
                                                                      M9 Email
                                                                          │
                                                                          ▼
                                                                 M10 External Comms
```

**Critical path:** M1 → M2 → M3 → M4 → M4.5 → M5 → M5.5 (all complete through M4.5, M5 active)

**M5.5 enables live UI:** All future milestones benefit from real-time state binding. Required for kiosk displays.

**M10 requires M5:** External communications needs solid agentic flow (NotificationService) before implementation.

**M7 requires prototyping:** Coding Projects Sprint 1 validates key assumptions (folder-scoped resume, stream-json, concurrent sessions). Results shape the architecture.

---

## Pre-Release Checklist

Requirements that must be complete before public release, regardless of milestone.

| Item                         | Status  | Notes                                                    |
| ---------------------------- | ------- | -------------------------------------------------------- |
| **Dashboard authentication** | Pending | Session-based auth for web UI. Currently localhost-only. |
| **Security audit**           | Pending | Review hooks, guardrails, and trust tier enforcement     |
| **Documentation**            | Pending | User-facing README, setup guide, examples                |

---

## Ideas Backlog

Ideas that haven't been promoted to design specs yet.

| Idea                         | Status              | Path                                                                         |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Agent Teams for Ad-hoc Tasks | Deferred to M5      | [ideas/agent-teams-for-adhoc-tasks.md](ideas/agent-teams-for-adhoc-tasks.md) |
| Multi-Step Tasks             | Evolved → M5-S9 (v2: Work + Deliverable) | [ideas/multi-step-tasks.md](ideas/multi-step-tasks.md)                       |

---

## Future Wishlist

Long-term features beyond the current milestone plan. Not scheduled, not designed — just captured for future consideration.

| Feature                        | Description                                               | Notes                                                               |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------- |
| **External Calendar Channels** | Google Calendar, Apple iCloud, Outlook as channel plugins | Each with own OAuth/auth flow, modeled like WhatsApp/Email channels |
| **Mobile Dashboard**           | Responsive web UI optimized for mobile browsers           | Calendar list view, chat interface, quick actions                   |
| **iOS App**                    | Native iOS app for Nina                                   | Push notifications, Siri integration, widget support                |
| **Mid-session Intervention**   | Send input to running Claude Code sessions                | Depends on Claude Code supporting message injection (steer)         |
| **Voice Output (TTS)**         | Give Nina a voice using text-to-speech                    | Evaluate Qwen 3 TTS — open, sounds good, need to test near real-time latency |
| **Voice Input (STT)**          | Let Nina understand voice via speech-to-text              | Web UI + WhatsApp channels; STT model for voice message transcription |

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

---

## How to Use This Document

1. **Check status:** Look at Quick Status table
2. **Find current work:** Look for "IN PROGRESS" milestone
3. **Understand scope:** Read milestone's design spec first
4. **Track sprints:** Use sprint plan/review links
5. **Plan ahead:** Review PLANNED milestones and dependencies

---

_Updated: 2026-02-22_
