# my_agent — Roadmap

> **Source of truth** for project planning, milestones, and work breakdown.
> **Updated:** 2026-02-18

---

## Quick Status

| Milestone                    | Status   | Progress                     |
| ---------------------------- | -------- | ---------------------------- |
| **M1: Foundation**           | Complete | 4/4 sprints                  |
| **M2: Web UI**               | Complete | 6/6 sprints                  |
| **M3: WhatsApp Channel**     | Active   | S1-S3 done, S4 stashed       |
| **M4: Notebook System**      | Active   | S1-S2 done, S3-S4 planned    |
| **M4.5: Calendar System**    | Active   | S1 done, S2-S3 planned              |
| **M5: Task System**          | Planned  | Design complete, sprints TBD |
| **M6: Memory**               | Planned  | Design complete, sprints TBD |
| **M7: Operations Dashboard** | Planned  | Design complete, sprints TBD |
| **M8: Email Channel**        | Planned  | Design complete, sprints TBD |

---

## Visual Timeline

```
2026-02                                          2026-03+
├─────────────────────────────────────────────────────────────────────►

M1 Foundation     M2 Web UI        M3 WhatsApp     M4 Notebook    M5-M8 Future
[████████████]    [████████████]    [████░░░░░░]    [██░░░░░░░░]   [░░░░░░░░░░]
   COMPLETE          COMPLETE         ACTIVE          ACTIVE          PLANNED

                  S1 ██ Server + Chat (done)
                  S2 ██ Streaming (done)        S1 ██ Channel Infra (done)
                  S3 ██ Hatching Wizard (done)  S2 ██ WhatsApp Plugin (done)
                  S4 ██ Conversations (done)    S3 ██ Slash Commands (done)
                  S5 ██ Naming (done)           S4 ░░ External Comms (stashed)
                  S6 ██ Advanced Chat (done)
                                                                        S1 ██ Infrastructure (done)
                                                                        S2 ░░ Dashboard Evolution
                                                                        S3 ░░ Notebook Editing Tool
                                                        M4 Notebook ──► Nina edits config files
                                                        M5 Tasks ────┐
                                                        M6 Memory ───┼─► Agent can develop itself
                                                        M7 Ops Dash ─┘
                                                        M8 Email
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

### M3: WhatsApp Channel — IN PROGRESS

First external channel. Agent owns a phone number, responds immediately. Introduces identity-based routing (conversations vs external communications).

| Sprint | Name                      | Status   | Plan                                                 | Review                                            |
| ------ | ------------------------- | -------- | ---------------------------------------------------- | ------------------------------------------------- |
| S1     | Channel Infrastructure    | Complete | [plan](sprints/m3-s1-channel-infrastructure/plan.md) | —                                                 |
| S2     | WhatsApp Plugin + Routing | Complete | [plan](sprints/m3-s2-whatsapp-plugin/plan.md)        | [review](sprints/m3-s2-whatsapp-plugin/review.md) |
| S3     | Slash Commands            | Complete | [plan](sprints/m3-s3-slash-commands/plan.md)         | [review](sprints/m3-s3-slash-commands/review.md)  |
| S4     | External Comms & Personal | Stashed  | [plan](sprints/m3-s4-external-personal/plan.md)      | —                                                 |

**Design references:**

- [channels.md](design/channels.md) — channel architecture, identity-based routing, ruleset model
- [conversation-system.md](design/conversation-system.md) — conversation persistence, external communications concept

**Deliverables:**

- _(S1)_ Channel plugin interface, manager with resilience (reconnection, dedup, debounce, watchdog), mock plugin
- _(S2)_ Baileys WhatsApp plugin, QR pairing, identity-based routing, owner conversations, settings view
- _(S3)_ Slash commands: `/new` (conversation reset with pinning), `/model` (model switching) — works on web + WhatsApp
- _(S4)_ External communications UI with ruleset model (including rule evolution via conversation), personal channel role with monitoring gate, approval flow for drafts

**Dependencies:** M2 (chat infra)

**Includes:**

- Channel-specific conversation naming (contact name + topic instead of haiku). `NamingService` needs a channel-aware prompt. See `docs/design/conversation-system.md` §Conversation Naming.

**Note:** M3 ships standalone. Basic WhatsApp ↔ agent works. Project spawning from WhatsApp ("fix this bug") requires M5 — that's a later enhancement, not a blocker.

**⚠️ M3-S4 Implementation Stashed:**
The M3-S4 external communications implementation was stashed to make way for M4 (Notebook System) which provides a better architecture. To recover:

```bash
git stash list   # Find stash@{0} and stash@{1}
# stash@{0}: M3-S4 untracked files (monitoring-config.ts, rules-loader.ts, external.ts)
# stash@{1}: M3-S4 external communications implementation (all package/ modifications)

# Pop in reverse order when ready:
git stash pop stash@{1}  # Modified files first
git stash pop stash@{0}  # Then untracked files
```

The M4-S4 sprint plan documents how to refactor this stashed code to use the Notebook system.

---

### M4: Notebook System — IN PROGRESS

Notebook is Nina's persistent memory — markdown files she can read always and write when talking to her owner. This enables conversational configuration instead of brittle middleware pattern matching.

| Sprint | Name                    | Status   | Plan                                                  | Review |
| ------ | ----------------------- | -------- | ----------------------------------------------------- | ------ |
| S1     | Notebook Infrastructure | Complete | [plan](sprints/m4-s1-notebook-infrastructure/plan.md) | [review](sprints/m4-s1-notebook-infrastructure/review.md) |
| S2     | Dashboard Evolution     | Complete | [plan](sprints/m4-s2-dashboard-evolution/plan.md)     | —      |
| S3     | Notebook Editing Tool   | Planned  | [plan](sprints/m4-s3-notebook-editing-tool/plan.md)   | —      |
| S4     | External Communications | Planned  | [plan](sprints/m4-s4-external-communications/plan.md) | —      |

**Note:** M4-S5 (Reminders & Tasks) and M4-S6 (Dashboard Integration) have been superseded by M4.5 Calendar System.

**Architecture:**

| Layer       | Purpose                   | Location             | Nina Access                   |
| ----------- | ------------------------- | -------------------- | ----------------------------- |
| **System**  | HOW to use Notebook files | `brain/CLAUDE.md`    | Read-only                     |
| **Runtime** | Actual rules/data         | `.my_agent/runtime/` | Read always, Write with owner |

**Deliverables:**

- _(S1)_ Notebook file templates, prompt assembly with size limits, system directives
- _(S2)_ Dashboard workspace layout: tabs on left, permanent chat on right, context awareness
- _(S3)_ `notebook_edit` tool for section-based file editing, access control, dashboard refresh
- _(S4)_ Refactor M3-S4 external communications to use Notebook (pop stash, remove middleware)

**Dependencies:** M3-S3 (channels working)

**Note:** M4 enables conversational configuration. "Block Sarah" or "I had a fight with Sarah, ignore her" both work because Nina understands intent and uses `notebook_edit` tool — no regex pattern matching.

---

### M4.5: Calendar System — PLANNED

Unified calendar replaces scattered time-aware concepts (reminders.md, cron schedules, task deadlines). Everything with a time dimension becomes a calendar event.

**Design spec:** [calendar-system.md](design/calendar-system.md)

| Sprint | Name                    | Status   | Plan                                              | Review                                              |
| ------ | ----------------------- | -------- | ------------------------------------------------- | --------------------------------------------------- |
| S1     | CalDAV Infrastructure   | Complete | [plan](sprints/m4.5-s1-caldav-infrastructure/plan.md) | [review](sprints/m4.5-s1-caldav-infrastructure/review.md) |
| S2     | Calendar Dashboard      | Planned  | —                                                 | —                                                   |
| S3     | MCP Tools + Scheduler   | Planned  | —                                                 | —                                                   |

**Deliverables:**

- _(S1)_ Radicale setup, CalendarRepository interface, tsdav client, health checks
- _(S2)_ FullCalendar tab in dashboard, multi-calendar display, event CRUD UI
- _(S3)_ calendar_* MCP tools for Nina, CalendarScheduler for event triggers, prompt context

**Tech Stack:**

| Component | Choice |
|-----------|--------|
| CalDAV server | Radicale (self-hosted) |
| CalDAV client | tsdav (cal.com maintained) |
| RRULE expansion | ical-expander |
| Frontend | FullCalendar v6 (MIT, CDN) |

**Key Design Decisions:**

- Everything time-based is a calendar event (reminders, deadlines, recurring tasks)
- Multi-calendar from day one (agent calendar + subscribed calendars)
- External calendars modeled as channel plugins (Google, Apple, Outlook)
- `reminders.md` retired; `external-communications.md` and `standing-orders.md` remain as Notebook files

**Dependencies:** M4-S2 (dashboard workspace layout)

**Prototype:** Validated 2026-02-18. Radicale + tsdav + ical-expander + FullCalendar stack works. See `prototypes/calendar/`.

---

### M5: Task System — PLANNED

Folder-based tasks, Claude Code spawning, scheduled tasks.

**Design spec:** [task-system.md](design/task-system.md)

**Deliverables:**

- Task classification (ad-hoc / project / ongoing)
- Folder creation with CLAUDE.md + task.md
- Claude Code session spawning (`claude` CLI)
- Comms MCP server (notify, request_review, escalate)
- Resume flow (`claude --continue`)
- Scheduled tasks (cron-based)

**Dependencies:** M2 (dashboard for approvals)

**After M5:** The agent can develop itself. M6, M7, M8 become agent projects with human review.

---

### M6: Memory — PLANNED

Notebook memory with flexible user-defined lists, daily summaries.

**Design spec:** [memory-system.md](design/memory-system.md)

**Deliverables:**

- SQLite notebook with user-defined lists (contacts, shopping, preferences, etc.)
- MCP tools: list_create, entry_add, entry_search, entry_update, entry_delete
- Prompted additions ("Should I remember this?")
- Recall priority: Notebook → Conversation search → Ask user
- Daily summary generation (Haiku)

**Dependencies:** M2 (conversation search as fallback)

**Note:** M6 could be the agent's first self-development project after M5 unlocks.

---

### M7: Operations Dashboard — PLANNED

Expand web UI with task management and memory viewer.

**Design spec:** [operations-dashboard.md](design/operations-dashboard.md)

**Deliverables:**

- Task browser: inbox/projects/ongoing
- Project detail view with approve/reject
- Memory viewer (notebook lists, entries, search)
- Settings: auth, models, channels
- "Open in VS Code" deep links

**Dependencies:** M5 (task system), M6 (memory)

**Note:** Agent builds this itself with review.

---

### M8: Email Channel — PLANNED

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

## Design Specs

Design specs define architecture before implementation. Each spec should be complete before sprints begin.

| Spec                 | Status   | Milestones | Path                                                             |
| -------------------- | -------- | ---------- | ---------------------------------------------------------------- |
| Channels             | Complete | M3, M8     | [design/channels.md](design/channels.md)                         |
| Conversations        | Complete | M2         | [design/conversation-system.md](design/conversation-system.md)   |
| Notebook             | Complete | M4         | [design/notebook.md](design/notebook.md)                         |
| Calendar System      | Complete | M4.5       | [design/calendar-system.md](design/calendar-system.md)           |
| Task System          | Complete | M5         | [design/task-system.md](design/task-system.md)                   |
| Memory               | Complete | M6         | [design/memory-system.md](design/memory-system.md)               |
| Operations Dashboard | Complete | M7         | [design/operations-dashboard.md](design/operations-dashboard.md) |

**Note:** M3 (WhatsApp) and M8 (Email) are covered by `channels.md`. No separate specs needed.

---

## Dependencies

```
M1 Foundation ───► M2 Web UI ───┬──► M3 WhatsApp ───► M4 Notebook ───► M4.5 Calendar
                                │                                            │
                                │                                            ▼
                                └────────────────────────────────────► M5 Tasks
                                                                          │
                                                                          ├──► M6 Memory
                                                                          │
                                                                          ├──► M7 Ops Dashboard
                                                                          │
                                                                          └──► M8 Email
```

**Critical path:** M1 → M2 → M3 → M4 → M4.5 → M5

**After M5:** Agent self-development. M6, M7, M8 become agent projects with human review.

**M3 is standalone:** Basic WhatsApp works after M2. Full task integration (project spawning) comes after M5.

**M4 enables conversational config:** M3-S4 (External Communications) was stashed and will be refactored in M4-S4 to use Notebook instead of middleware pattern matching.

**M4.5 unifies time concepts:** Reminders, deadlines, scheduled tasks all become calendar events. M5 scheduled tasks depend on M4.5 calendar infrastructure.

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

| Idea                         | Status         | Path                                                                         |
| ---------------------------- | -------------- | ---------------------------------------------------------------------------- |
| Agent Teams for Ad-hoc Tasks | Deferred to M5 | [ideas/agent-teams-for-adhoc-tasks.md](ideas/agent-teams-for-adhoc-tasks.md) |

---

## Future Wishlist

Long-term features beyond the current milestone plan. Not scheduled, not designed — just captured for future consideration.

| Feature | Description | Notes |
|---------|-------------|-------|
| **External Calendar Channels** | Google Calendar, Apple iCloud, Outlook as channel plugins | Each with own OAuth/auth flow, modeled like WhatsApp/Email channels |
| **Mobile Dashboard** | Responsive web UI optimized for mobile browsers | Calendar list view, chat interface, quick actions |
| **iOS App** | Native iOS app for Nina | Push notifications, Siri integration, widget support |
| **Claude Code CLI Streaming** | Stream terminal output from task folders to web UI | Watch agent work in real-time, intervention controls |

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

_Updated: 2026-02-18_
