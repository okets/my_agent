# Coding Projects — Design Specification

> **Status:** Design Complete
> **Date:** 2026-02-19
> **Scope:** Autonomous coding projects, session streaming, supervision
> **Milestone:** M7

---

## Table of Contents

1. [Overview](#overview)
2. [Two Types of Coding Work](#two-types-of-coding-work)
3. [Internal Projects](#internal-projects)
4. [User's Code Projects](#users-code-projects)
5. [Work Split: Nina vs Claude Code](#work-split-nina-vs-claude-code)
6. [Efficiency Principles](#efficiency-principles)
7. [Supervision Architecture](#supervision-architecture)
8. [Active Session Streaming](#active-session-streaming)
9. [Crash Recovery](#crash-recovery)
10. [NotificationService Integration](#notificationservice-integration)
11. [Prototype Checklist](#prototype-checklist)
12. [Risks and Mitigations](#risks-and-mitigations)
13. [Implementation Notes](#implementation-notes)

---

## Overview

Coding Projects enable Nina to autonomously write code — both on her own codebase (self-development) and as a relay for user coding sessions.

**Core philosophy:** Claude Code is a capable executor. Given clear instructions and the right workflows, it can work autonomously. Nina's role is supervision (process-level, not LLM-level) and communication routing.

**Design reference:** OpenClaw's autonomous coding system was analyzed. Key patterns adapted:
- Folder-scoped session persistence (Claude Code native)
- Event-driven streaming (`--output-format stream-json`)
- Process-level supervision (no LLM tokens for monitoring)
- Decision logging (DECISIONS.md pattern from overnight sprints)

---

## Two Types of Coding Work

| Type | Description | Nina's Role | Automation Level |
|------|-------------|-------------|------------------|
| **Internal Projects** | Nina develops her own codebase | Full automation: spawn, monitor, resume | High |
| **User's Code Projects** | User runs coding sessions on their repos | Relay: stream to dashboard, summarize, prompt for next | Minimal |

### Why Two Types?

Internal Projects have a controlled environment — Nina owns the repo, knows the structure, has templates and skills. Full automation is safe and efficient.

User's Code Projects are different — Nina doesn't know the codebase, can't make architectural decisions, and shouldn't take ownership. She's an "agent in the middle" keeping the user's work flowing when they're away from the computer.

---

## Internal Projects

Nina develops herself. Full automation with templates, streaming, and dashboard visibility.

### Project Templates

Every internal project gets a folder:

```
.my_agent/projects/{date}-{slug}/
├── CLAUDE.md           # Task context, constraints, efficiency principles
├── task.md             # Status, current sprint, progress, blockers
├── DECISIONS.md        # Decision log (created on first decision)
├── DEVIATIONS.md       # Plan deviations (created if needed)
├── WISHLIST.md         # Missing capabilities (self-evolving infra)
├── docs/
│   └── sprints/        # Sprint plans and reviews
│       ├── s1-{name}/
│       │   ├── plan.md
│       │   └── review.md
│       └── s2-{name}/
│           ├── plan.md
│           └── review.md
└── .claude/
    └── settings.json   # Project-specific Claude Code settings
```

### CLAUDE.md Template

```markdown
# {Task Title}

> Created: {timestamp}
> Type: internal-project
> Source: {scheduled task / conversation / agent-initiated}

## Objective

{Clear, measurable goal}

## Context

{Why this task exists, relevant background}

## Efficiency Principles

1. Read before code — study this file, task.md, and relevant docs first
2. Track as you go — update task.md after each significant step
3. Verify before claiming done — run tests, lint, build
4. Use available tools — check for relevant skills before implementing from scratch
5. Incremental commits — small, focused changes with clear messages
6. Document decisions — non-obvious choices go in DECISIONS.md
7. Right model for task — use Haiku for quick lookups, Sonnet for implementation, Opus for reasoning/review
8. Delegate with clear roles — spawn subagents with specific responsibilities
9. Self-evolving infrastructure — hit a capability gap? Document in WISHLIST.md, implement it, continue

## Constraints

- {Boundaries, things to avoid}
- {Specific requirements}

## Resources

- Roadmap: docs/ROADMAP.md
- Design: docs/design/{relevant}.md
- Related code: {paths}

## Success Criteria

- [ ] {Measurable outcome 1}
- [ ] {Measurable outcome 2}
```

### task.md Template

```markdown
# Task: {Title}

**Status:** planning | executing | blocked | complete
**Current Sprint:** s{N}-{name}
**Updated:** {timestamp}

## Current State

{What's happening now}

## Sprint Progress

### s1-{name} — {complete | in-progress}
- [x] {Completed step}
- [ ] {Next step}

## Blockers

{None or description}

## History

- {timestamp} — Created
- {timestamp} — Sprint 1 started
- {timestamp} — Sprint 1 complete (see docs/sprints/s1-{name}/review.md)
- {timestamp} — Sprint 2 started
```

### Project Lifecycle: Sprint-as-Context

Projects are executed as a series of sprints. Each sprint is a Claude Code session with a fresh context. Within a sprint, `--continue` preserves context. Between sprints, sprint docs carry the knowledge.

**Why sprint boundaries?**
- Natural context limits — no infinite accumulation
- Sprint docs ARE the handoff (plan.md → review.md)
- Matches proven human-agent workflow
- review.md from sprint N feeds plan.md of sprint N+1
- Each sprint starts clean, reads its plan, executes, writes review

```
Nina decides work is needed
  │
  ▼
/start-sprint
  → Read project CLAUDE.md + roadmap + design docs
  → Create sprint folder: docs/sprints/m{N}-s{N}-{name}/
  → Write plan.md (tasks, team, success criteria)
  → Spawn: claude --cwd .my_agent/projects/{slug}/ -p "Execute sprint per plan.md"
  → Stream output to dashboard
  │
  ├── Session interrupted (crash, limit, SIGINT)
  │   → /resume-sprint
  │   → claude --continue --cwd {folder}  (preserves full context)
  │   → Runs /whats-next to self-sync
  │   → Continues execution
  │
  ├── Session completes sprint
  │   → Write review.md (what was done, what wasn't, decisions made)
  │   → Update task.md + roadmap
  │   → Notify user
  │   → Nina evaluates: more sprints needed?
  │       → Yes: /start-sprint (fresh context, reads previous review.md)
  │       → No: project complete
  │
  └── Escalation needed
      → NotificationService: escalate() → Nina routes to user
      → Session pauses
      → User responds → /resume-sprint with response
```

**Key distinction:**
| Boundary | Action | Context |
|----------|--------|---------|
| **Within sprint** | `--continue` | Preserved (cheap, no token waste) |
| **Between sprints** | Fresh session | Clean (sprint docs carry knowledge) |

**Sprint folder structure:**
```
docs/sprints/m7-s1-prototype-validation/
├── plan.md           # What to do, success criteria
└── review.md         # What happened, decisions, outcomes
```

---

## User's Code Projects

Dashboard spawns Claude Code on user's repo. Agent is a relay, not a manager.

**Purpose:** Keep user's work going when they're away from the computer (mobile, on the go).

### Flow

```
User opens dashboard → selects repo path → provides initial prompt
  → Dashboard spawns: claude --cwd /user/repo/ -p "{prompt}"
  → Output streams to dashboard tab (RDP view)
  → When session stops:
    → Nina summarizes what happened
    → Asks user "what next?"
    → User provides next prompt (from phone, etc.)
    → Dashboard spawns new session with --continue
```

### Boundaries

- **No consulting.** Nina doesn't review or advise on user's code.
- **No task management.** No CLAUDE.md templates for user repos.
- **No ownership.** User's repo, user's decisions.
- **Start minimal.** Add autonomy incrementally in future milestones.

### What Nina Does

| Action | Method |
|--------|--------|
| Spawn session | `child_process.spawn('claude', ['--cwd', path, '-p', prompt, '--output-format', 'stream-json'])` |
| Stream to dashboard | Pipe stdout through WebSocket |
| Detect stop | Process exit event |
| Summarize | Read last N stream events, generate summary |
| Prompt for next | Send summary + "what next?" to user |
| Continue | `claude --continue --cwd {path}` |

---

## Work Split: Nina vs Claude Code

| Actor | Role | Cost |
|-------|------|------|
| **Claude Code** | Does the work. Fully autonomous within project scope. Self-documents. Runs verification loops. | LLM tokens (productive work) |
| **Nina** | Process-level supervisor. Watches for crashes/blocks. Routes communications. | Zero LLM tokens for supervision |
| **systemd watchdog** | Recovers from internet/API outages. Restarts Nina. | Zero tokens |
| **/whats-next skill** | Deterministic self-sync on resume. File checks, not LLM calls. | Zero tokens |

**Key principle:** Nina doesn't approve phases. She watches for failures and routes messages. Intelligence is in the skill design, not runtime LLM supervision.

---

## Efficiency Principles

Nine principles injected into every Internal Project's CLAUDE.md. These encode the development philosophy that makes autonomous work efficient and maintainable.

| # | Principle | Why |
|---|-----------|-----|
| 1 | **Read before code** | Understand context, avoid rework |
| 2 | **Track as you go** | Resumable state, always current |
| 3 | **Verify before claiming done** | Catch issues early, evidence over assertion |
| 4 | **Use available tools** | Skills and subagents exist for a reason |
| 5 | **Incremental commits** | Reviewable, debuggable, reversible |
| 6 | **Document decisions** | Future context for humans and agents |
| 7 | **Right model for task** | Haiku for lookups, Sonnet for code, Opus for reasoning |
| 8 | **Delegate with clear roles** | Explore for research, Plan for architecture, general-purpose for implementation |
| 9 | **Self-evolving infrastructure** | Hit a gap → document → implement → continue |

**Why not just a ralph loop?** Any agent can verify code. But without these principles, it wastes tokens re-reading files, makes monolithic commits, doesn't document decisions, and loses context on resume. Efficient workflows reduce token spend and improve output quality.

---

## Supervision Architecture

Three layers. Zero LLM tokens for supervision.

### Layer 1: systemd Watchdog (External)

Non-LLM bash script + systemd timer. Handles internet/API outages where Nina herself is down.

```
Every N seconds (exponential backoff when failing):
  1. Internet up? (curl, no LLM)
  2. API responding? (lightweight auth check)
  3. Both down → back off: 1m → 2m → 4m → 8m ... cap 30m
  4. Both up → restart Nina service
```

### Layer 2: Nina Startup Resume

When Nina starts (or restarts after outage):

```
Scan .my_agent/projects/ for active projects:
  - task.md exists AND status ≠ complete → interrupted project
  - For each: claude --continue --cwd {folder}
  - Resumed sessions run /whats-next to self-sync
```

### Layer 3: /whats-next Skill (Deterministic)

Claude Code runs this on resume. No LLM calls — pure file checks:

```
Checks performed:
  - plan.md says 5 tasks → only 3 have artifacts → 2 remaining
  - DECISIONS.md has choice → plan.md not updated → sync needed
  - Last commit says "done X" → roadmap says pending → update roadmap
  - No review.md → sprint not closed → write review
  - task.md says "complete" → success criteria unchecked → not actually done
```

### Nina's Runtime Checks (Per Active Project)

```
Process alive?
  ├── yes + not completed + not blocked → leave alone
  ├── yes + blocked (escalation pending) → route to user
  ├── no + task.md says complete → done, log, notify
  └── no + task.md not complete → restart with --continue
```

---

## Active Session Streaming

Read-only "RDP" view into active Claude Code sessions.

### Architecture

```
Claude Code (--output-format stream-json)
  → stdout piped by spawner
  → forwarded via WebSocket to dashboard
  → rendered in session tab
```

### Buffer

- Rolling 100-event in-memory buffer per session
- No disk persistence
- Dashboard connects → receives last 100 events → then live tail
- Dashboard disconnects → buffer continues rolling
- Session ends → buffer cleared

### What the View Shows

- Assistant text output (streaming)
- Tool calls (file reads, edits, bash commands)
- Tool results (abbreviated)
- Thinking blocks (if available)

### What It Doesn't Do (For Now)

- No sending input mid-session
- No editing mid-stream
- Pure observation — user intervention is SIGINT → resume

---

## Crash Recovery

### Failure Modes and Recovery

| Failure | Signal | Recovery |
|---------|--------|----------|
| **Claude Code crashes** | Process exit ≠ 0, task.md not complete | `claude --continue --cwd {folder}` |
| **API spending limit** | Process exits, API error in output | Notify user, wait for budget reset |
| **Internet down** | Nina also down (shared connectivity) | systemd watchdog recovers both |
| **Machine restart** | Nina service starts on boot | Startup resume scans for active projects |
| **Stale progress** | task.md not updated before crash | /whats-next self-syncs from artifacts |

### Session Resume: Folder-Scoped

**Critical finding:** Claude Code sessions ARE folder-scoped.

- `claude --continue` resumes the most recent session **in the current directory**
- `claude --resume <id>` picks a specific session **in the current directory**
- Sessions stored in `~/.claude/projects/{encoded-cwd}/` — fully isolated per folder
- Multiple concurrent projects resume independently — no cross-contamination

This means:
- No session ID tracking needed
- No context injection on resume
- `claude --continue --cwd {folder}` is all that's needed
- Full session history preserved (no token waste rebuilding context)

**Must be prototyped before implementation** — see [Prototype Checklist](#prototype-checklist).

---

## NotificationService Integration

Claude Code sessions communicate back to Nina via NotificationService.

### Tools

| Tool | Purpose | Behavior |
|------|---------|----------|
| `notify(message)` | Status update | Fire-and-forget. Session continues. |
| `request_review(plan)` | Block for approval | Saves state, notifies user, exits cleanly. |
| `escalate(problem, severity)` | Urgent notification | Saves state, notifies user immediately, exits. |
| `ask_quick(question, timeout?)` | Quick decision | Blocks briefly (default 30min). For simple yes/no. |

### Routing

```
Claude Code calls escalate()
  → NotificationService receives call
  → Nina routes to user's preferred channel (dashboard/WhatsApp/etc.)
  → User responds
  → Nina resumes session with response
```

**Note:** NotificationService is defined in [task-system.md](task-system.md) §NotificationService. Same methods, same behavior. Coding Projects is a consumer, not a separate implementation.

---

## Prototype Checklist

**Sprint 1 must validate these assumptions before committing to full implementation:**

| # | Prototype | What to Validate | If Fails |
|---|-----------|-------------------|----------|
| 1 | **Folder-scoped `--continue`** | Spawn in folder, kill, `--continue` from same folder. Correct resume? | Fall back to fresh start + context injection |
| 2 | **`--output-format stream-json`** | Capture stdout, verify format, parse event types | Build custom output parser or use SDK directly |
| 3 | **Concurrent sessions** | Two folders simultaneously, no cross-contamination | Add session isolation layer |
| 4 | **SIGINT behavior** | Send SIGINT at 1, 5, 15 min. When does it stop responding? | Use `--max-turns` or interrupt flag |
| 5 | **NotificationService** | Spawned Claude Code calls notification service, Nina receives | File-based signaling as fallback |

**Prototype results feed directly into the design. Failures alter the architecture, not the goals.**

---

## Risks and Mitigations

| Risk | Rating | Mitigation |
|------|--------|------------|
| **SIGINT ignored after ~10 min** | Important | Use `--max-turns N` for bounded execution. Prototype will verify. |
| **stream-json format changes** | Important | Prototype validates format. Thin parser layer isolates changes. |
| **No process spawning infra** | Important | Codebase is 100% SDK. Need child_process patterns. Sprint 1 work. |
| **NotificationService doesn't exist yet** | Blocker | Must be implemented in M5-S4. Pattern exists (hatching-tools.ts). |
| **Memory at scale** | Low | Each Claude Code process uses significant RAM. Monitor on WSL2. |

---

## Implementation Notes

### M6 Scope

| Feature | Sprint |
|---------|--------|
| Prototype validation (5 items above) | S1 |
| NotificationService integration | S1 |
| Process spawning + monitoring | S1 |
| Internal Project templates + lifecycle | S2 |
| Active session streaming (WebSocket) | S2 |
| Dashboard: session list + RDP view | S3 |
| User's Code Projects (relay) | S3 |
| /whats-next self-sync skill | S3 |
| systemd watchdog + startup resume | S4 |

### Dependencies

- **M5 (Task System):** Task entity, agent.db, execution logs, NotificationService
- **M4.5 (Calendar):** Scheduled tasks trigger projects
- **M2 (Dashboard):** WebSocket infrastructure, UI framework

### Out of Scope (Future)

| Feature | When |
|---------|------|
| Mid-session message injection (steer) | When Claude Code supports it |
| User code project consulting/review | Future milestone |
| Multi-repo project orchestration | Future milestone |
| Notification preferences system | M5 or M7 |

---

## Related Documents

- [Task System](task-system.md) — M5 design (tasks, execution, NotificationService)
- [Self-Evolving Infrastructure](self-evolving-infrastructure.md) — Philosophy: agents extend their own tools
- [Operations Dashboard](operations-dashboard.md) — Dashboard UI patterns
- [Debug API](debug-api.md) — Introspection endpoints

---

*Created: 2026-02-19*
