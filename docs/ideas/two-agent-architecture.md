# Two-Agent Architecture: Conversation Nina + Working Agents

> **Status:** Approved — Detailed planning complete, see transition-plan.md
> **Created:** 2026-03-02
> **Origin:** Delivery gap in scheduled task execution exposed fundamental flow issues

---

## Problem Statement

During M6.5-S4 live testing, a user asked Nina via WhatsApp to "send me a joke every 5 minutes, 3 times." The brain created CalDAV events, they fired correctly, TaskExecutor ran successfully — but the jokes were never delivered back to WhatsApp. The results were logged to an internal "Scheduled Events" conversation that the user never sees.

Root cause: the system has multiple disconnected execution paths (conversation brain, TaskScheduler, EventHandler) with no unified concept of output routing. Fixing this specific bug led to a broader rethinking of the entire agentic flow.

---

## Core Idea

Split the agent into two roles:

| Role | Purpose | Trigger | Context |
|------|---------|---------|---------|
| **Conversation Nina** | Talks to the user | User messages (dashboard, WhatsApp, any channel) | Full personality, memory, notebook, conversation history |
| **Working Agent** | Does work for the user | Task schedule, subagent spawn, heartbeat, background triggers | Lean execution prompt, memory tools, task folder context |

### Key Principles

- **Same tools, different contexts.** Both agents have access to the same capabilities. The difference is what's in the system prompt and what triggered the session.
- **Conversation Nina replies in-channel.** WhatsApp message → WhatsApp reply. Dashboard → dashboard. Always.
- **Working agent delivers to default channel.** Unless the task specifies a target channel, use the user's configured default communication channel.
- **Handoff via tasks.** Conversation Nina creates task folders. Working agents execute them. The task folder is the contract between the two.
- **Fleet of working agents.** Not one background worker — many. Each task gets its own working agent. A restaurant booking agent keeps its context. A daily news summarizer accumulates learning over time.
- **Fresh spawns by default, resumable when needed.** Working agents read the task folder's living documents each spawn. Ongoing tasks can opt into session resumption via `task.json.sessionPolicy: "resume"` for accumulated context (e.g., daily news summarizer, long-running bookings). Default is `"fresh"`.
- **Tools enforce folder state.** Every working agent tool (`write_deliverable()`, `update_task_plan()`, `deliver()`) writes to the folder as a side effect. The folder is always current — no "dump state at exit" needed. A `Stop` hook serves as safety net for interrupted sessions.

---

## Task Folders as Source of Truth

Revives the original design doc vision: "folders as sessions."

### Structure

```
.my_agent/tasks/
├── inbox/
│   └── 2026-03-02-send-joke/
│       ├── task.json          # Metadata: schedule, status, delivery, created, etc.
│       ├── plan.md            # Living plan — what to do, updated by either agent
│       ├── deliverables/      # Output files
│       └── notes.md           # Conversation Nina can add context, feedback
├── projects/
│   └── 2026-03-02-restaurant-booking/
│       ├── task.json
│       ├── plan.md
│       ├── deliverables/
│       ├── notes.md
│       └── context/           # Reference material, prior research
└── ongoing/
    └── daily-news-summary/
        ├── task.json
        ├── plan.md
        ├── deliverables/
        │   ├── 2026-03-01.md
        │   └── 2026-03-02.md
        └── notes.md
```

### task.json

```json
{
  "id": "task-...",
  "title": "Send Hanan a joke",
  "type": "ad-hoc",
  "status": "pending",
  "createdAt": "2026-03-02T10:00:00Z",
  "createdBy": "conversation:conv-123",
  "schedule": {
    "type": "one-shot",
    "scheduledFor": "2026-03-02T10:05:00Z"
  },
  "delivery": {
    "channel": "default"
  },
  "recurrence": null,
  "sessionPolicy": "fresh"
}
```

### Both Agents Read/Write

- **Conversation Nina** can read any task folder to answer questions ("how's the booking going?"), update plans, add notes, or even execute work herself.
- **Working agent** reads the folder on spawn, does the work, updates deliverables and status.
- **No session coupling.** The folder is the shared state, not an SDK session.

---

## Derived Data Stores (Disposable)

### SQLite DB — Lightweight Index

- Rebuilt from folder scans
- Provides fast queries for UI (list tasks, filter by status, search)
- Stores scheduling metadata indexed for TaskScheduler
- If corrupted, regenerate from folders

**Flow:** Folder → DB (one-way)

### Calendar View — FullCalendar via REST API

- Radicale eliminated as dependency
- FullCalendar reads from `/api/calendar/events` backed by our DB
- Task creation from calendar UI → `POST /api/tasks` → creates folder → DB indexes
- Drag/drop rescheduling → `PUT /api/tasks/:id` → updates folder → DB re-indexes
- Recurrence rules stored in `task.json`, expanded by our scheduler

**Flow:** Folder → DB → REST API → FullCalendar

---

## Task Classification (Existing, Unchanged)

| Signal | Type | Handling |
|--------|------|----------|
| Single question, quick answer | **Trivial** | Conversation Nina handles inline, no folder |
| "Check", "summarize", "draft" | **Ad-hoc** | Folder in inbox/, single execution |
| "Fix", "implement", "build" | **Project** | Folder in projects/, multi-phase |
| "Every day", "regularly" | **Ongoing** | Folder in ongoing/, recurring schedule |

---

## Execution Flow

### User asks a question (trivial)
```
User (WhatsApp) → Conversation Nina → replies on WhatsApp
No folder, no working agent.
```

### User requests work (ad-hoc, immediate)
```
User → Conversation Nina → creates task folder → spawns working agent as subagent
Working agent reads folder → does work → updates deliverables → delivers to channel
```

### User schedules work
```
User → Conversation Nina → creates task folder with schedule
TaskScheduler detects due task → spawns working agent
Working agent reads folder → does work → delivers to default channel (or specified)
```

### User asks about a task
```
User → Conversation Nina → reads task folder → answers from folder contents
```

### User modifies a running task
```
User → Conversation Nina → updates plan.md or adds to notes.md
Next working agent spawn reads updated folder
```

### Recurring task
```
Ongoing task folder with recurrence rule in task.json
TaskScheduler fires on schedule → spawns working agent
Working agent reads folder (accumulated context from prior runs) → does work → writes deliverable
Same folder, same agent lineage, growing context over time
```

---

## Working Agent Unique Tools

Tools that working agents need but Conversation Nina doesn't:

- **Escalate** — "I need user approval for this"
- **Request input** — "I need the user to answer a question"
- **Notify** — "Here's a status update"

These route through NotificationService to reach the user on their preferred channel.

Conversation Nina doesn't need these because she's already in a direct conversation.

---

## Resolved Questions

All questions answered in companion documents. Summary:

1. **Memory system integration** — Same MCP tools (`recall`, `remember`, etc.). Working agents get `sharedMcpServers`. See [codebase audit](two-agent-codebase-audit.md) §5.
2. **Conversation linking** — `task.json.createdBy.conversationId` replaces `task_conversations` junction table.
3. **UI impact** — Task views read from folders via DB index. FullCalendar stays, backed by folder API. See [codebase audit](two-agent-codebase-audit.md) §8.
4. **Current codebase mapping** — Full audit in [codebase audit](two-agent-codebase-audit.md).
5. **M6.6 Agentic Lifecycle** — WorkLoopScheduler eliminated (absorbed). Morning prep, heartbeat, daily summary become `ongoing/` task folders. See [roadmap impact](two-agent-roadmap-impact.md) §M6.6.
6. **M7 Coding Projects** — Significantly simplified. Working agent IS the coding executor. See [roadmap impact](two-agent-roadmap-impact.md) §M7.
7. **Recurrence without Radicale** — RRULE strings in `task.json.recurrence`, expanded by `ical-expander` library (kept without CalDAV layer).
8. **Migration path** — Adapter layer: old DB tasks run to completion, new tasks use folders. No big bang. See [transition plan](two-agent-transition-plan.md).
9. **Tool definitions** — Central reference: [tools.md](../design/tools.md). Task MCP tools detailed in [transition plan](two-agent-transition-plan.md) §S2.
10. **Default channel setting** — `.my_agent/config.yaml` → `defaultDeliveryChannel`.

## Key Decisions

| Decision | Resolution |
|----------|-----------|
| Session resumption | Fresh spawns by default. `sessionPolicy: "resume"` opt-in for ongoing tasks. |
| Folder state enforcement | Tools write to folder as side effect (primary). `Stop` hook as safety net. |
| Radicale | Eliminated. Bidirectional sync defeats single source of truth. |
| Migration strategy | Adapter layer — old and new coexist, gradual cutover. |
| Fleet cost | Stagger by design, lean prompts. Batching deferred until 30-day production data. |
| Working agent spawn model | Independent sessions (not SDK subagents). Conversation Nina triggers via MCP tools. |

---

## Relationship to Roadmap

This is a foundational change. Full analysis in companion documents:
- **[Roadmap Impact](two-agent-roadmap-impact.md)** — per-milestone impact analysis
- **[Codebase Audit](two-agent-codebase-audit.md)** — what changes at the code level
- **[Transition Plan](two-agent-transition-plan.md)** — ordered, gradual implementation plan

**New milestone ordering:**
```
M6.5 (done) → M6.7 (NEW, 5 sprints) → M6.6 (refocused) → M7 (reduced) → M8 → M9 → M10
```

---

*Created: 2026-03-02*
