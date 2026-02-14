# Task System — Design Specification

> **Status:** Design In Progress
> **Date:** 2026-02-14
> **Scope:** Folder-based tasks, Claude Code spawning, scheduled tasks
> **Milestone:** M4a

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Task Types](#task-types)
3. [Task Lifecycle](#task-lifecycle)
4. [Folder Structure](#folder-structure)
5. [Claude Code Integration](#claude-code-integration)
6. [Comms MCP Server](#comms-mcp-server)
7. [Scheduled Tasks](#scheduled-tasks)
8. [Triage Logic](#triage-logic)
9. [Configuration](#configuration)
10. [Implementation Notes](#implementation-notes)

---

## Core Concepts

### What Is a Task?

A task is a **unit of work** the agent performs. Tasks range from trivial (single response) to complex (multi-day projects).

| Property | Description |
|----------|-------------|
| **Trigger** | Channel message, scheduled cron, heartbeat, or user request |
| **Classification** | Trivial, ad-hoc, project, or ongoing |
| **Persistence** | Folder-based for anything non-trivial |
| **Execution** | Inline (brain handles) or spawned (Claude Code session) |
| **Resumability** | Folders are resumable by anyone (agent or user) |

### Folders as Sessions

Every non-trivial task gets a folder. The folder IS the session state:

```
.my_agent/projects/2026-02-14-login-bug/
├── CLAUDE.md      # Task context, constraints, who requested
├── task.md        # Current status, phase, blockers
├── plan.md        # Approved implementation plan (if project)
├── .claude/       # Claude Code settings for this task
│   ├── settings.json
│   └── skills/    # Task-specific skills
└── src/           # Working files (code, docs, etc.)
```

Anyone can open this folder:
- **Agent:** `claude --cwd /path/to/folder/ -p "Continue from task.md"`
- **User:** Open in VS Code, interact directly with Claude Code
- **Dashboard:** View status, approve/reject, provide feedback

---

## Task Types

### Trivial

Single-exchange responses. No folder needed.

```
User: "What time is it?"
Agent: "It's 3:45 PM."
```

- Handled inline by brain
- No persistence beyond conversation transcript
- No Claude Code spawning

### Ad-hoc (inbox/)

Short-lived tasks that need some work but not multi-phase planning.

```
User: "Check if the production server is healthy"
Agent: → Creates inbox/2026-02-14-server-health-check/
       → Runs checks, gathers metrics
       → Reports back: "Server healthy, 230ms response"
       → Task marked complete
```

**Characteristics:**
- Single-phase execution
- No plan/review cycle
- Folder archived after completion
- Typical duration: minutes to hours

### Project (projects/)

Multi-phase work requiring planning, review, and iteration.

```
User: "Fix the login bug that Sarah reported"
Agent: → Creates projects/2026-02-14-login-bug/
       → Phase 1: Investigate → writes findings
       → Phase 2: Plan → requests review
       → Phase 3: Execute → implements fix
       → Phase 4: Complete → PR ready
```

**Characteristics:**
- Multi-phase: ideate → plan → execute → complete
- Review gates between phases
- Claude Code sessions (resumable)
- User can intervene at any point
- Typical duration: hours to days

### Ongoing (ongoing/)

Recurring routines with procedures and logs.

```
User: "Take over email management"
Agent: → Creates project first (to define procedure)
       → Creates ongoing/email-management/
       → Runs every 2 hours per schedule
       → Logs each execution
```

**Characteristics:**
- Procedure defined via a project first
- Scheduled execution (cron)
- Each run creates a log entry
- Continues indefinitely until stopped

---

## Task Lifecycle

### States

| State | Description |
|-------|-------------|
| **Created** | Folder initialized, CLAUDE.md written |
| **Investigating** | Agent gathering information (ad-hoc, project ideation) |
| **Planning** | Agent drafting approach (projects only) |
| **Awaiting Review** | Blocked on user approval |
| **Executing** | Active work in progress |
| **Complete** | Work finished, results delivered |
| **Archived** | Moved to archive (optional cleanup) |

### State Transitions

```
CREATE ──► INVESTIGATING ──► PLANNING ──► AWAITING_REVIEW
                │                              │
                │ (ad-hoc)                     │ (approved)
                ▼                              ▼
            EXECUTING ◄────────────────────────┘
                │
                │ (done)
                ▼
            COMPLETE ──► ARCHIVED
```

### task.md Format

```markdown
# Task: Login Bug Fix

**Status:** executing
**Phase:** 2 of 3 (implementation)
**Created:** 2026-02-14T09:00:00Z
**Updated:** 2026-02-14T14:30:00Z
**Requested by:** user (via WhatsApp)

## Current State

Implementing the auth module refactor. SSO code untouched per constraint.

## Blockers

None.

## Next Steps

1. Complete unit tests
2. Create PR
3. Request final review

## History

- 2026-02-14 09:00 — Created from WhatsApp request
- 2026-02-14 10:30 — Investigation complete, root cause identified
- 2026-02-14 11:00 — Plan approved by user
- 2026-02-14 14:30 — Implementation 80% complete
```

---

## Folder Structure

### Location

All task folders live in `.my_agent/`:

```
.my_agent/
├── inbox/                    # Ad-hoc tasks
│   ├── 2026-02-14-server-check/
│   └── 2026-02-14-email-draft/
├── projects/                 # Multi-phase projects
│   ├── 2026-02-14-login-bug/
│   └── 2026-02-13-feature-x/
├── ongoing/                  # Recurring routines
│   ├── email-management/
│   └── daily-standup/
└── archive/                  # Completed tasks (optional)
    └── 2026-02-13-server-migration/
```

### Naming Convention

```
{date}-{slug}/

Examples:
  2026-02-14-login-bug/
  2026-02-14-check-server-health/
  2026-02-14-sarah-pricing-email/
```

- Date prefix for chronological sorting
- Slug derived from task description (kebab-case)
- Agent generates slug, user can rename

### CLAUDE.md Template

```markdown
# {Task Title}

> Created: {timestamp}
> Type: {ad-hoc | project | ongoing}
> Requested by: {source} via {channel}

## Context

{Why this task exists, who requested it, relevant background}

## Constraints

{Any boundaries, things to avoid, specific requirements}

## Resources

{Links to relevant code, docs, conversations, contacts}

## Skills

{Skills to load for this task, if any}
```

---

## Claude Code Integration

### Spawning Sessions

The brain spawns Claude Code sessions for project work:

```bash
# Initial spawn
claude --cwd .my_agent/projects/2026-02-14-login-bug/ \
  -p "Investigate the login bug. Context in CLAUDE.md."

# Resume after approval
claude --continue \
  --cwd .my_agent/projects/2026-02-14-login-bug/ \
  -p "Approved with feedback: don't touch SSO module."
```

### Session Lifecycle

1. **Spawn:** Brain creates folder, writes CLAUDE.md, spawns `claude`
2. **Work:** Claude Code investigates, plans, implements
3. **Communicate:** Session uses Comms MCP tools to notify/escalate
4. **Exit:** Session exits cleanly, state saved in task.md
5. **Resume:** On approval, brain spawns `claude --continue`

### Folder as Handoff

The folder is the complete handoff mechanism:
- Agent can resume: `claude --continue --cwd /folder/`
- User can intervene: Open in VS Code, interact directly
- Both work: Folder contains all state

---

## Comms MCP Server

An MCP server available to Claude Code sessions for communicating with the brain.

### Tools

| Tool | Purpose | Behavior |
|------|---------|----------|
| `notify(message)` | Status update | Fire-and-forget. Session continues. |
| `request_review(plan, options?)` | Block for approval | Saves state, notifies user, exits cleanly. |
| `escalate(problem)` | Urgent notification | Saves state, notifies user immediately, exits. |
| `ask_quick(question, timeout?)` | Quick decision | Blocks briefly (default 30min). For simple yes/no. |

### notify

```typescript
notify({
  message: "Found the root cause. Auth token not refreshing.",
  importance: "info"  // "info" | "warning" | "success"
})
```

- Non-blocking
- Appears in dashboard, optionally forwarded to WhatsApp
- Session continues working

### request_review

```typescript
request_review({
  plan: "Refactor the auth module to fix token refresh...",
  summary: "Auth module refactor",
  files_affected: ["src/auth.ts", "src/token.ts"],
  estimated_effort: "2 hours"
})
```

- Updates task.md with plan
- Sets status to `awaiting_review`
- Notifies user (dashboard + WhatsApp)
- Session exits cleanly
- On approval: brain spawns `claude --continue`

### escalate

```typescript
escalate({
  problem: "Found security vulnerability in production",
  severity: "high",  // "low" | "medium" | "high" | "critical"
  action_needed: "Review immediately before proceeding"
})
```

- Immediate notification (all channels)
- Task paused until user responds
- Session exits

### ask_quick

```typescript
const answer = await ask_quick({
  question: "Should I also update the tests?",
  options: ["Yes", "No", "Skip for now"],
  timeout: 30 * 60 * 1000  // 30 minutes
})
```

- Blocks session briefly
- User responds via dashboard/WhatsApp
- If timeout: returns default or escalates
- For simple decisions that don't warrant full review cycle

---

## Scheduled Tasks

### Cron-Based Execution

Scheduled tasks are triggered by cron and run in the brain's context:

```yaml
# .my_agent/config.yaml
schedule:
  - name: email-management
    cron: "0 */2 * * *"  # Every 2 hours
    task: ongoing/email-management

  - name: daily-standup
    cron: "0 8 * * 1-5"  # 8am weekdays
    task: ongoing/daily-standup

  - name: inbox-summary
    cron: "0 8 * * *"    # 8am daily
    action: "Summarize my inbox and send to WhatsApp"
```

### Execution Flow

```
Cron fires
  → Event loop receives schedule event
  → Brain loads task folder (ongoing/{name}/)
  → Brain reads CLAUDE.md (procedure)
  → Brain executes (inline or spawns Claude Code)
  → Brain writes log to logs/{timestamp}.md
  → Brain sends notification if configured
```

### Log Format

```
ongoing/email-management/logs/
├── 2026-02-14-08h.md
├── 2026-02-14-10h.md
└── 2026-02-14-12h.md
```

Each log:
```markdown
# Email Management — 2026-02-14 08:00

**Duration:** 3 minutes
**Emails processed:** 7
**Actions taken:**
- Flagged 2 urgent (from VIP contacts)
- Drafted 1 reply (awaiting approval)
- Archived 4 newsletters

**Escalations:** None
```

---

## Triage Logic

When the brain receives a request, it classifies:

```
Brain receives request
    │
    ├── Trivial? (< 1 exchange, no side effects)
    │   → Handle inline, no folder
    │
    ├── Ad-hoc? (short-lived, no multi-phase)
    │   → Create inbox/ folder
    │   → Execute (inline or spawn)
    │   → Complete
    │
    ├── Project? (complex, needs planning)
    │   → Create projects/ folder
    │   → Begin ideation phase
    │   → Follow phase lifecycle
    │
    └── Ongoing? (recurring)
        → Create project to define procedure
        → Create ongoing/ folder
        → Register schedule
```

### Classification Signals

| Signal | Suggests |
|--------|----------|
| Single question, quick answer | Trivial |
| "Check", "summarize", "draft" | Ad-hoc |
| "Fix", "implement", "build", "refactor" | Project |
| "Every day", "regularly", "take over" | Ongoing |
| Multi-step, needs approval | Project |
| Short-lived, single execution | Ad-hoc |

The brain uses judgment. Ambiguous cases default to ad-hoc (can escalate to project if needed).

---

## Configuration

```yaml
# .my_agent/config.yaml

tasks:
  inbox: ./inbox/
  projects: ./projects/
  ongoing: ./ongoing/
  archive: ./archive/

  # Auto-archive completed tasks after N days
  archive_after_days: 30

  # Default autonomy level for new tasks
  default_autonomy: 5  # 1-10 scale

  # Notification preferences
  notify:
    on_complete: true
    on_review_needed: true
    channel: whatsapp  # or "dashboard" or "both"

schedule:
  # Scheduled tasks defined here
  - name: email-management
    cron: "0 */2 * * *"
    task: ongoing/email-management

comms:
  # Comms MCP server settings
  ask_quick_timeout: 30m
  escalation_channels: [whatsapp, dashboard]
```

---

## Implementation Notes

### M4a Scope

| Feature | Included |
|---------|----------|
| Task classification (trivial/ad-hoc/project/ongoing) | Yes |
| Folder creation with CLAUDE.md + task.md | Yes |
| Claude Code session spawning | Yes |
| Comms MCP server (notify, request_review, escalate, ask_quick) | Yes |
| Resume flow (`claude --continue`) | Yes |
| Scheduled tasks (cron) | Yes |
| Dashboard task browser | Partial (basic view) |
| Task archiving | Yes |

### Out of Scope (Future)

| Feature | Milestone |
|---------|-----------|
| Agent Teams for ad-hoc tasks | Deferred (evaluate during M4a) |
| Full task browser UI | M5 |
| Task search | M5 |
| Memory enrichment on task events | M4b |

### After M4a

Once M4a is complete, the agent can develop itself:
- M4b (Memory) becomes an agent project
- M5 (Ops Dashboard) becomes an agent project
- M6 (Email) becomes an agent project

Human review remains required for production changes.

---

## Open Questions

1. **Agent Teams:** Should ad-hoc tasks spawn agent teammates instead of running inline? Deferred to M4a implementation — see [ideas/agent-teams-for-adhoc-tasks.md](../ideas/agent-teams-for-adhoc-tasks.md).

2. **Autonomy Levels:** How granular should autonomy settings be? Per-task? Per-action-type? Start simple (global default), add granularity if needed.

3. **Task Limits:** Should there be limits on concurrent tasks? Start without limits, add if resource issues emerge.

---

_Design specification created: 2026-02-14_
