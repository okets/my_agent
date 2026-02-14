# my_agent — Roadmap

> **Source of truth** for project planning, milestones, and work breakdown.
> **Updated:** 2026-02-14

---

## Quick Status

| Milestone | Status | Progress |
|-----------|--------|----------|
| **M1: Foundation** | Complete | 4/4 sprints |
| **M2: Web UI** | In Progress | 2/5 sprints |
| **M3: WhatsApp Channel** | Planned | Design complete, sprints TBD |
| **M4a: Task System** | Planned | Design complete, sprints TBD |
| **M4b: Memory** | Planned | Design complete, sprints TBD |
| **M5: Operations Dashboard** | Planned | Design complete, sprints TBD |
| **M6: Email Channel** | Planned | Design complete, sprints TBD |

---

## Visual Timeline

```
2026-02                                          2026-03+
├─────────────────────────────────────────────────────────────────────►

M1 Foundation     M2 Web UI                      M3-M6 Future
[████████████]    [██░░░░░░░░]                   [░░░░░░░░░░]
   COMPLETE         IN PROGRESS                     PLANNED

                  S1 ██ Server + Chat (done)
                  S2 ██ Streaming (done)
                  S3 ░░ Hatching Wizard
                  S4 ░░ Conversations
                  S5 ░░ Naming

                                                 M3 WhatsApp ─┐
                                                 M4a Tasks ───┼─► Agent can develop itself
                                                 M4b Memory ──┘
                                                 M5 Ops Dashboard
                                                 M6 Email
```

---

## Milestones

### M1: Foundation (CLI) — COMPLETE

The agent's core brain running in `.my_agent/`. CLI REPL for development/testing.

| Sprint | Name | Status | Plan | Review |
|--------|------|--------|------|--------|
| S1 | Foundation | Complete | [plan](sprints/m1-s1-foundation/plan.md) | [review](sprints/m1-s1-foundation/review.md) |
| S2 | Personality | Complete | [plan](sprints/m1-s2-personality/plan.md) | [review](sprints/m1-s2-personality/review.md) |
| S3 | Hatching | Complete | [plan](sprints/m1-s3-hatching/plan.md) | [review](sprints/m1-s3-hatching/review.md) |
| S4 | Auth | Complete | [plan](sprints/m1-s4-auth/plan.md) | [review](sprints/m1-s4-auth/review.md) |

**Deliverables:**
- Agent SDK brain with personality from `brain/CLAUDE.md`
- Modular hatching flow (`HatchingStep` interface)
- Auth system (API keys + subscriptions, env var override)
- System prompt assembly from brain files + skills
- `/my-agent:*` commands for reconfiguration

---

### M2: Web UI — IN PROGRESS

Browser-based interface replacing CLI. Chat + hatching wizard.

| Sprint | Name | Status | Plan | Review |
|--------|------|--------|------|--------|
| S1 | Server Foundation | Complete | [plan](sprints/m2-s1-server-foundation/plan.md) | [review](sprints/m2-s1-server-foundation/review.md) |
| S2 | Streaming | Complete | [plan](sprints/m2-s2-streaming/plan.md) | [review](sprints/m2-s2-streaming/review.md) |
| S3 | Hatching Wizard | Pending | [plan](sprints/m2-s3-hatching-wizard/plan.md) | — |
| S4 | Conversations | Pending | [plan](sprints/m2-s4-conversations/plan.md) | — |
| S5 | Naming | Pending | [plan](sprints/m2-s5-naming/plan.md) | — |

**Design specs:**
- [conversation-system.md](design/conversation-system.md) — Persistence, search, naming, lifecycle

**Deliverables:**
- Fastify server + Alpine.js SPA (`packages/dashboard/`)
- WebSocket chat with streaming, thinking blocks, markdown
- Web-based hatching wizard
- Conversation persistence (SQLite + JSONL transcripts)
- Haiku naming at turn 5

---

### M3: WhatsApp Channel — PLANNED

First external channel. Agent owns a phone number, responds immediately.

**Design reference:** [channels.md](design/channels.md) (channel architecture is complete)

**Deliverables:**
- WhatsApp MCP plugin (Baileys)
- Dedicated role: agent's phone number
- Immediate processing: webhook → brain → response
- Escalation policies
- Channel conversations (per-contact, per-group)

**Dependencies:** M2 (chat infra)

**Note:** M3 ships standalone. Basic WhatsApp ↔ agent works. Project spawning from WhatsApp ("fix this bug") requires M4a — that's a later enhancement, not a blocker.

---

### M4a: Task System — PLANNED

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

**After M4a:** The agent can develop itself. M4b, M5, M6 become agent projects with human review.

---

### M4b: Memory — PLANNED

Notebook memory with flexible user-defined lists, daily summaries.

**Design spec:** [memory-system.md](design/memory-system.md)

**Deliverables:**
- SQLite notebook with user-defined lists (contacts, shopping, preferences, etc.)
- MCP tools: list_create, entry_add, entry_search, entry_update, entry_delete
- Prompted additions ("Should I remember this?")
- Recall priority: Notebook → Conversation search → Ask user
- Daily summary generation (Haiku)

**Dependencies:** M2 (conversation search as fallback)

**Note:** M4b could be the agent's first self-development project after M4a unlocks.

---

### M5: Operations Dashboard — PLANNED

Expand web UI with task management and memory viewer.

**Design spec:** [operations-dashboard.md](design/operations-dashboard.md)

**Deliverables:**
- Task browser: inbox/projects/ongoing
- Project detail view with approve/reject
- Memory viewer (notebook lists, entries, search)
- Settings: auth, models, channels
- "Open in VS Code" deep links

**Dependencies:** M4a (task system), M4b (memory)

**Note:** Agent builds this itself with review.

---

### M6: Email Channel — PLANNED

Email plugin with both dedicated and personal roles.

**Design reference:** [channels.md](design/channels.md) (complete design)

**Deliverables:**
- Microsoft Graph MCP plugin
- Dedicated role: agent's email (info@company.com)
- Personal role: user's email (on-demand only)
- OAuth 2.0 auth flow
- Thread management

**Dependencies:** M3 (channel pattern established), M4a (for email-triggered projects)

---

## Design Specs

Design specs define architecture before implementation. Each spec should be complete before sprints begin.

| Spec | Status | Milestones | Path |
|------|--------|------------|------|
| Channels | Complete | M3, M6 | [design/channels.md](design/channels.md) |
| Conversations | Complete | M2 | [design/conversation-system.md](design/conversation-system.md) |
| Task System | Complete | M4a | [design/task-system.md](design/task-system.md) |
| Memory | Complete | M4b | [design/memory-system.md](design/memory-system.md) |
| Operations Dashboard | Complete | M5 | [design/operations-dashboard.md](design/operations-dashboard.md) |

**Note:** M3 (WhatsApp) and M6 (Email) are covered by `channels.md`. No separate specs needed.

---

## Dependencies

```
M1 Foundation ───► M2 Web UI ───┬──► M3 WhatsApp (standalone)
                                │
                                └──► M4a Tasks
                                        │
                                        ├──► M4b Memory
                                        │
                                        ├──► M5 Ops Dashboard
                                        │
                                        └──► M6 Email
```

**Critical path:** M1 → M2 → M4a

**After M4a:** Agent self-development. M4b, M5, M6 become agent projects with human review.

**M3 is standalone:** Basic WhatsApp works after M2. Full task integration (project spawning) comes after M4a.

---

## Ideas Backlog

Ideas that haven't been promoted to design specs yet.

| Idea | Status | Path |
|------|--------|------|
| Agent Teams for Ad-hoc Tasks | Deferred to M4a | [ideas/agent-teams-for-adhoc-tasks.md](ideas/agent-teams-for-adhoc-tasks.md) |

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

*Updated: 2026-02-14*
