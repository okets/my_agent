# Two-Agent Architecture: Conversation Nina + Working Agents

> **Status:** Approved — Detailed planning complete, see transition-plan.md
> **Created:** 2026-03-02
> **Updated:** 2026-03-03 — Mental model, orchestrator, templates, autonomy, UI, custom tools
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
| **Working Agent** | Does work for the user | Orchestrator spawn (scheduled, immediate, recurring) | Lean execution prompt, memory tools, task folder context |

### Mental Model

**Conversation Nina is a meeting room.** Everything immediate, everything that can be resolved in 1-3 turns within the conversation session, stays in the meeting room. But actual work — anything that requires leaving the conversation — is managed outside.

**Task folders are autonomous domains.** Each folder is a working agent's world. The working agent owns it, operates within it, and is governed by clear rules (its template). The folder contains everything the agent needs: what to do (`plan.md`), metadata (`task.json`), communication with the user (`notes.md`), and output (`deliverables/`).

### Key Principles

- **Same tools, different contexts.** Both agents have access to the same capabilities. The difference is what's in the system prompt and what triggered the session.
- **Conversation Nina is the meeting room.** Trivial = anything she can handle in 1-3 turns within a single session. If it requires leaving the conversation to do work, it becomes a task. She replies where the conversation is happening — WhatsApp message → WhatsApp reply, dashboard → dashboard.
- **Working agent delivers to specified channel.** `task.json.delivery.channel` is set at creation time by Conversation Nina (who knows the originating channel). Falls back to `defaultDeliveryChannel` from config.
- **Handoff via task folders.** Conversation Nina creates task folders. The orchestrator spawns working agents. The task folder is the contract between them.
- **Fleet of working agents.** Not one background worker — many. Each task gets its own working agent. A restaurant booking agent keeps its context. A daily news summarizer accumulates learning over time.
- **One spawn path.** The orchestrator spawns ALL working agents — scheduled, immediate, recurring. Conversation Nina never spawns agents directly; she creates folders, the orchestrator handles the rest.
- **Fresh spawns by default, resumable when needed.** Working agents read the task folder's living documents each spawn. Ongoing tasks can opt into session resumption via `task.json.sessionPolicy: "resume"` for accumulated context (e.g., daily news summarizer, long-running bookings). Default is `"fresh"`.
- **Tools enforce folder state.** Every working agent tool (`write_deliverable()`, `update_task_plan()`, `deliver()`) writes to the folder as a side effect. The folder is always current — no "dump state at exit" needed. A `Stop` hook serves as safety net for interrupted sessions.

---

## Orchestrator

A single global background worker responsible for logistics — never does actual work.

### Responsibilities

- **Watches** all task folders for `task.json` changes (file watcher, not polling)
- **Schedules** — reads `task.json.schedule`, computes next due time via `ical-expander` (RRULE), fires when ready
- **Spawns** working agents when tasks are due (one spawn path for all triggers)
- **Monitors health** — detects stuck/crashed agents, marks tasks interrupted, retries if appropriate
- **Manages lifecycle** — archives completed tasks, enforces timeouts

### Properties

- **Stateless.** All state lives in task folders. If it crashes, it restarts, re-scans folders, rebuilds timers. Zero lost state.
- **Replaces** CalendarScheduler + EventHandler + TaskScheduler — three separate components unified into one.
- **No fast path needed.** Anything truly immediate is trivial (Conversation Nina handles it inline in the meeting room). Anything warranting a folder goes through the orchestrator. File watcher latency (sub-second) is acceptable.

---

## Task Folders as Source of Truth

Revives the original design doc vision: "folders as sessions."

### Structure

```
.my_agent/tasks/
├── ad_hoc/
│   └── 2026-03-02-send-joke/
│       ├── task.json          # Metadata: schedule, status, delivery, autonomy
│       ├── plan.md            # Living plan — what to do, updated by either agent
│       ├── notes.md           # Async comms between Conversation Nina ↔ working agent
│       └── deliverables/      # Output files
│
├── projects/                  # (name TBD — "projects" may be too vague)
│   └── 2026-03-02-restaurant-booking/
│       ├── task.json
│       ├── plan.md
│       ├── notes.md
│       ├── deliverables/
│       └── context/           # Reference material, prior research
│
├── ongoing_responsibilities/
│   └── daily-news-summary/    # No date prefix — these are permanent
│       ├── task.json
│       ├── plan.md
│       ├── notes.md
│       ├── deliverables/
│       │   ├── 2026-03-01.md
│       │   └── 2026-03-02.md
│       └── logs/              # Per-run execution logs
│
└── custom_tools/
    └── taxi-booking/          # Tool-building tasks
        ├── task.json
        ├── plan.md
        ├── notes.md
        └── deliverables/
```

### Published Tools

```
.my_agent/tools/               # "dist/" — compiled, published tools
├── taxi-booking/              # All agents read from here at runtime
└── restaurant-api/
```

Working agents develop tools in their task folder (source). When ready, the tool is published to `.my_agent/tools/` (compilation target). All agents — both Conversation Nina and any working agent — access published tools from the shared location.

### task.json

```json
{
  "id": "task-...",
  "title": "Send a joke every 5 minutes",
  "type": "ad_hoc",
  "status": "pending",
  "autonomy": "autonomous",
  "createdAt": "2026-03-02T10:00:00Z",
  "createdBy": {
    "conversationId": "conv-123",
    "channel": "whatsapp"
  },
  "schedule": {
    "type": "recurring",
    "scheduledFor": "2026-03-02T10:05:00Z"
  },
  "recurrence": "FREQ=MINUTELY;INTERVAL=5;COUNT=3",
  "delivery": {
    "channel": "ninas_watsapp"
  },
  "sessionPolicy": "fresh"
}
```

**Autonomy is mandated in `task.json`.** No cascading defaults from config. Conversation Nina sets it at creation time based on task type and user preference. Three modes (unchanged from M5 design):

| Mode | Behavior |
|------|----------|
| **Supervised** | Ask before every significant action |
| **Smart** | Act freely within folder, ask for external/destructive/scope actions |
| **Autonomous** | Act freely, only flag cost-benefit issues |

If the user wants to change autonomy on a running task, they tell Conversation Nina, she updates `task.json`.

### Both Agents Read/Write

- **Conversation Nina** can read any task folder to answer questions ("how's the booking going?"), update plans, add notes, or even execute work herself.
- **Working agent** reads the folder on spawn, does the work, updates deliverables and status.
- **No session coupling.** The folder is the shared state, not an SDK session.

### Working Agent Escalation Ladder

When a working agent encounters a problem:

```
Check live docs (plan.md, notes.md)
  → Check related conversations (task.json.createdBy.conversationId)
  → Check memory (recall)
  → Autonomy check: can I decide this myself?
    → Yes (autonomous/smart within scope): decide, log in notes.md
    → No (supervised, or out of scope): escalate to user via delivery channel
```

---

## Task Templates

Templates are **framework code** — they ship with the repo, not per-installation.

```
my_agent/
├── task_templates/                    # Framework: how working agents operate
│   ├── ad_hoc.md                      # "Execute and deliver"
│   ├── project.md                     # "Investigate, plan, execute, deliver" (name TBD)
│   ├── ongoing_responsibility.md      # "Run procedure, log, repeat"
│   └── custom_tool.md                 # "Build/maintain a tool" (internal workings TBD)
```

**Template = HOW to operate. Folder = WHAT to do.**

The orchestrator loads the appropriate template based on `task.json.type` when spawning a working agent. The working agent's system prompt is assembled from: `template (by type)` + `task.json (metadata)` + `plan.md (the work)`.

### Template Definitions

**ad_hoc** — "Execute and deliver"
- Single phase: read plan → do the work → deliver → done
- No review gates, no phases
- Covers: "send a joke," "draft an email," "check server health"
- Same template whether immediate or scheduled — timing is the orchestrator's concern

**project** (name TBD) — "Investigate, plan, execute, deliver"
- Multi-phase with review gates
- Investigate → update plan.md → plan → request review if autonomy requires → execute → deliver
- Can pause between phases; Conversation Nina steers via notes.md
- Covers: "fix the login bug," "build a feature," "book a restaurant"

**ongoing_responsibility** — "Run procedure, log, repeat"
- Procedure-based: plan.md IS the procedure
- Each run: read procedure → check what changed since last run → do work → log → deliver if needed
- Accumulates context across runs (deliverables/, logs/)
- Never auto-completes — runs until stopped
- Covers: "manage my email," "daily news summary," "monitor server health"

**custom_tool** — "Build/maintain a tool" (internal workings TBD)
- Tool development and maintenance tasks
- Source developed in `custom_tools/{tool-name}/` task folder
- Published to `.my_agent/tools/` when ready
- Internal workings defined later in roadmap

---

## Derived Data Stores (Disposable)

### SQLite DB — Lightweight Index

- Rebuilt from folder scans
- Provides fast queries for UI (list tasks, filter by status, search)
- Stores scheduling metadata indexed for orchestrator
- If corrupted, regenerate from folders

**Flow:** Folder → DB (one-way)

### Calendar View — FullCalendar via REST API

- Radicale eliminated as dependency
- FullCalendar reads from `/api/calendar/events` backed by our DB
- Task creation from calendar UI → `POST /api/tasks` → creates folder → DB indexes
- Drag/drop rescheduling → `PUT /api/tasks/:id` → updates folder → DB re-indexes
- Recurrence rules stored in `task.json`, expanded by orchestrator via `ical-expander`

**Flow:** Folder → DB → REST API → FullCalendar

---

## Task Classification

| Signal | Type | Handling |
|--------|------|----------|
| Anything resolvable in 1-3 turns | **Trivial** | Conversation Nina handles in the meeting room, no folder |
| "Check", "summarize", "draft" | **Ad-hoc** | Folder in `ad_hoc/`, single execution |
| "Fix", "implement", "build" | **Project** | Folder in `projects/`, multi-phase |
| "Every day", "regularly" | **Ongoing** | Folder in `ongoing_responsibilities/`, recurring schedule |
| "Build me a tool for X" | **Custom tool** | Folder in `custom_tools/`, publishes to `.my_agent/tools/` |

The dividing line is not complexity — it's **does it require leaving the conversation to do it?** If yes, it's a task. If Conversation Nina can resolve it in the meeting room, it stays there.

---

## Execution Flow

### User asks a question (trivial — meeting room)
```
User (WhatsApp) → Conversation Nina → replies on WhatsApp
No folder, no working agent. Resolved in 1-3 turns.
```

### User requests work (ad-hoc)
```
User → Conversation Nina → creates task folder in ad_hoc/ → orchestrator detects → spawns working agent
Working agent reads folder → does work → updates deliverables → delivers to channel
```

### User schedules work
```
User → Conversation Nina → creates task folder with schedule in task.json
Orchestrator detects schedule → fires when due → spawns working agent
Working agent reads folder → does work → delivers to specified channel
```

### User asks about a task (meeting room)
```
User → Conversation Nina → reads task folder → answers from folder contents
```

### User modifies a running task (meeting room)
```
User → Conversation Nina → updates plan.md or adds to notes.md
Next working agent spawn reads updated folder
```

### Recurring task
```
Ongoing responsibility folder with recurrence in task.json
Orchestrator expands RRULE → fires on schedule → spawns working agent
Working agent reads folder (accumulated context from prior runs) → does work → writes deliverable
Same folder, same agent lineage, growing context over time
```

---

## Working Agent Unique Tools

Tools that working agents need but Conversation Nina doesn't:

- **Escalate** — "I need user approval for this"
- **Request input** — "I need the user to answer a question"
- **Notify** — "Here's a status update"
- **Deliver** — "Send this result to the user"

These route through the delivery channel specified in `task.json.delivery` to reach the user.

Conversation Nina doesn't need these because she's already in a direct conversation.

---

## Dashboard UI Impact

**Stays the same:**
- Chat interface (that IS Conversation Nina)
- Conversation list/sidebar
- Memory view
- Channel settings
- Calendar view (same FullCalendar, new REST backend)

**Changes:**
- **Task tab** — the main visual change:
  - **Tree view** — browse tasks by type (ad_hoc/, projects/, ongoing_responsibilities/, custom_tools/)
  - **Detail view** — click into a task to see folder contents: plan.md rendered, deliverables listed, notes.md, autonomy level, status, schedule, working agent status
  - Both timeline and tree views into the same data, different lenses
- Most visual change is in task tabs (popovers on mobile)

---

## Spike Validation

Before investing in the full 5-sprint build, validate the core thesis in 2-3 days:

**Layer 1: Can a working agent deliver?**
Create a task folder by hand. Write a minimal `spawnWorkingAgent()`. Run it. Did the joke arrive on WhatsApp?

**Layer 2: Can Conversation Nina create the folder?**
Wire up one MCP tool: `create_task()`. Brain creates a task from WhatsApp. Is the folder correct?

**Layer 3: Can the orchestrator trigger it?**
Basic file watcher + timer. Schedule 1 minute out. Did it fire?

**If all three pass:** build with confidence. **If any fails:** learn exactly WHERE before investing.

This is real code that becomes the foundation for M6.7 S1-S2, not throwaway.

---

## Resolved Questions

All questions answered in companion documents. Summary:

1. **Memory system integration** — Same MCP tools (`recall`, `remember`, etc.). Working agents get `sharedMcpServers`. See [codebase audit](two-agent-codebase-audit.md) §5.
2. **Conversation linking** — `task.json.createdBy.conversationId` replaces `task_conversations` junction table.
3. **UI impact** — Task tab gets tree view + detail view. Calendar stays, backed by folder API. See [codebase audit](two-agent-codebase-audit.md) §8.
4. **Current codebase mapping** — Full audit in [codebase audit](two-agent-codebase-audit.md).
5. **M6.6 Agentic Lifecycle** — WorkLoopScheduler eliminated (absorbed by orchestrator). Morning prep, heartbeat, daily summary become `ongoing_responsibilities/` task folders. See [roadmap impact](two-agent-roadmap-impact.md) §M6.6.
6. **M7 Coding Projects** — Significantly simplified. Working agent IS the coding executor. See [roadmap impact](two-agent-roadmap-impact.md) §M7.
7. **Recurrence without Radicale** — RRULE strings in `task.json.recurrence`, expanded by orchestrator via `ical-expander` library.
8. **Migration path** — Adapter layer: old DB tasks run to completion, new tasks use folders. No big bang. See [transition plan](two-agent-transition-plan.md).
9. **Tool definitions** — Central reference: [tools.md](../design/tools.md). Task MCP tools detailed in [transition plan](two-agent-transition-plan.md) §S2.
10. **Default channel setting** — `.my_agent/config.yaml` → `defaultDeliveryChannel`.
11. **Autonomy enforcement** — Mandated in `task.json`. No cascading defaults from config. Three modes unchanged (supervised/smart/autonomous). See [task-system.md](../design/task-system.md) §Autonomy Modes.

## Key Decisions

| Decision | Resolution |
|----------|-----------|
| Session resumption | Fresh spawns by default. `sessionPolicy: "resume"` opt-in for ongoing tasks. |
| Folder state enforcement | Tools write to folder as side effect (primary). `Stop` hook as safety net. |
| Radicale | Eliminated. Not kept as scheduler — ical-expander as standalone library. |
| Migration strategy | Adapter layer — old and new coexist, gradual cutover. |
| Fleet cost | Stagger by design, lean prompts. Batching deferred until 30-day production data. |
| Working agent spawn model | Orchestrator spawns all. One spawn path. No direct spawning by Conversation Nina. |
| Orchestrator | Single stateless background worker. File watcher. Replaces CalendarScheduler + EventHandler + TaskScheduler. |
| Autonomy | Mandated in `task.json`. No cascading config defaults. Set by Conversation Nina at creation time. |
| Templates | Framework code in `task_templates/`. Four types: ad_hoc, project, ongoing_responsibility, custom_tool. |
| Trivial threshold | Meeting room model: 1-3 turns in session = trivial. Leaving the conversation = task. |
| Custom tools | 4th task type with own template. Source in task folder, published to `.my_agent/tools/`. Internal workings TBD. |
| UI | Tree view + detail view in task tab. Chat/calendar/memory unchanged. |

---

## Relationship to Roadmap

This is a foundational change. Full analysis in companion documents:
- **[Roadmap Impact](two-agent-roadmap-impact.md)** — per-milestone impact analysis
- **[Codebase Audit](two-agent-codebase-audit.md)** — what changes at the code level
- **[Transition Plan](two-agent-transition-plan.md)** — ordered, gradual implementation plan

**New milestone ordering:**
```
M6.5 (done) → Spike (2-3 days) → M6.7 (NEW, 5 sprints) → M6.6 (refocused) → M7 (reduced) → M8 → M9 → M10
```

---

*Created: 2026-03-02*
*Updated: 2026-03-03*
