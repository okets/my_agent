# Agent Teams for Ad-Hoc Tasks

> **Status:** Parked — revisit when Claude Code teams feature stabilizes
> **Date:** 2026-02-13
> **Origin:** Hanan's observation during M1 development using Claude Code agent teams

---

## Core Insight

Claude Code's agent teams feature maps naturally to my_agent's **ad-hoc task handling**. Instead of Nina's brain handling every small request inline (bloating context), she spawns lightweight agent teammates — one per task, isolated context, parallel execution.

**Projects stay as folders.** They're persistent, multi-phase, resumable. No change needed.

**Ad-hoc tasks become agent teammates.** They're short-lived, isolated, parallel, and governed by Nina as team lead.

---

## How It Works

```
Any Channel (WhatsApp, CLI, Dashboard, Heartbeat)
    → Nina's Brain (triage + coordination)
        → Is this a project? → Create folder, spawn Claude Code session (existing flow)
        → Is this ad-hoc?   → Spawn agent teammate
            → Agent works in isolated context
            → Agent reports result back to Nina
            → Nina responds via originating channel
            → Agent is cleaned up (no folder bloat)
```

### What Changes

| Before (inline) | After (agent teammates) |
|-----------------|------------------------|
| Nina handles ad-hoc in her own context | Nina spawns an agent per task |
| Sequential processing | Parallel processing |
| Context grows with each task | Each task has isolated context |
| Nina's brain does triage + execution | Nina's brain does triage only |
| Results mixed into brain history | Results returned as messages |

### What Stays the Same

| Component | Status |
|-----------|--------|
| Projects (folder-based) | Unchanged |
| Ongoing routines | Unchanged |
| Channel plugins | Unchanged (trigger source doesn't matter) |
| Memory system | Unchanged |
| Dashboard | Unchanged (can show active agents as enhancement) |

---

## Example Flows

### WhatsApp → Ad-Hoc Agent

```
Hanan (WhatsApp): "Check if the server is up"
    → Nina's Brain receives message
    → Triage: ad-hoc, no project needed
    → Spawns agent: "Check production server health"
    → Agent: pings server, gathers metrics
    → Agent → Nina: "Server up, 230ms, all endpoints healthy"
    → Nina → WhatsApp: "Server is up, 230ms response time"
    → Agent cleaned up
```

### Heartbeat → Parallel Agents

```
Cron tick (heartbeat)
    → Nina's Brain: "Run heartbeat check"
    → Spawns 3 agents in parallel:
        → Agent 1: "Check active project statuses"
        → Agent 2: "Check pending reviews"
        → Agent 3: "Check for proactive opportunities"
    → All 3 report back
    → Nina aggregates: "2 items need attention"
    → Nina → WhatsApp: summary
    → Agents cleaned up
```

### CLI → Agent with IDE Navigation

```
Hanan (CLI): npm run brain "Summarize yesterday's emails"
    → Nina's Brain: spawns agent
    → Agent appears in IDE (navigable)
    → Agent: queries email, builds summary
    → Agent → Nina: summary
    → Nina outputs to CLI
    → Agent cleaned up (or kept if Hanan is browsing it)
```

---

## When to Use Each Model

```
Nina receives request
    │
    ├── Trivial? (< 1 exchange) → Handle inline (no agent)
    │   "What time is it?" / "Hi"
    │
    ├── Ad-hoc? (short-lived, no persistence needed) → Spawn agent teammate
    │   "Check server" / "Summarize emails" / "Draft a reply to Sarah"
    │
    ├── Project? (multi-phase, needs persistence) → Create folder + session
    │   "Fix login bug" / "Build new feature" / "Refactor auth"
    │
    └── Ongoing? (recurring) → Folder + cron
        "Manage emails every 2h" / "Daily standup summary"
```

---

## Architecture Impact

### Nina's Brain Role Shift

Nina's brain becomes primarily a **triage and coordination engine**:
- Receives events from all channels
- Classifies: trivial / ad-hoc / project / ongoing
- Spawns appropriate handler (inline / agent / folder / routine)
- Receives results from agents
- Responds via originating channel
- Manages memory (stores insights from agent results)

This keeps Nina's brain context lean and focused on coordination rather than execution.

### Agent Teammate Lifecycle

```
1. SPAWN  — Nina creates agent with task context + system prompt
2. WORK   — Agent executes task in isolated context
3. REPORT — Agent sends result back to Nina via message
4. CLEANUP — Agent is shut down, resources freed
```

Optional: if the result is worth preserving, Nina writes it to inbox/ or memory.

### Inbox Folder Evolution

The inbox/ folder becomes **optional archival** rather than mandatory:
- Simple results: stored in memory, no folder needed
- Notable results: Nina writes to inbox/ for reference
- This reduces folder bloat from trivial tasks

---

## Tradeoffs

| Gain | Cost |
|------|------|
| Parallel ad-hoc execution | Token cost per agent (each gets own context) |
| Isolated context (no brain bloat) | Agent startup latency |
| IDE navigation of active tasks | Ephemeral (no resume if interrupted) |
| Scales with concurrent requests | Complexity in triage logic |

### Accepted Limitations

- Agent teammates can't be resumed if interrupted (acceptable for ad-hoc tasks)
- Non-developer users (WhatsApp) can't navigate agents in IDE (they don't need to — Nina mediates)
- Token cost per agent vs inline handling (worth it for isolation + parallelism)

---

## Implementation Timeline

**M1 (complete):** CLI brain delivered
**M2 (Web UI):** No changes — chat interface, no task system yet
**M3 (WhatsApp):** No changes — channels trigger Nina's brain
**M4a (Project System):** Add ad-hoc agent spawning alongside folder-based projects
**M4b (Memory + Heartbeat):** Heartbeat uses parallel agents for checks
**M5 (Operations Dashboard):** Show active agents in dashboard, agent history
**M6+ (Self-dev):** Nina uses agent teams for her own development work

---

## Relationship to Architect's Full Analysis

The architect analyzed 4 options (A-D). This concept refines the recommendation:
- **Option A (Dashboard Enhancement):** Partially adopted — dashboard shows agents, but agents aren't limited to IDE mode
- **Option C (Replace folders):** Rejected — folders stay for projects
- **Option D (Self-development):** Adopted — Nina uses agents for her own work too
- **New insight:** Ad-hoc tasks are the primary use case, not projects

Full architect analysis available in the sprint discussion (2026-02-13 session).

---

*Concept approved: 2026-02-13*
*Session: Hanan + Claude Code (Opus 4.6)*
