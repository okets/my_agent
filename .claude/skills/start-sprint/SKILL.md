---
name: start-sprint
description: Start a normal sprint with real-time CTO involvement. Use when you're available to make decisions and review progress.
---

# Start Sprint (Normal Mode)

You are starting a **normal sprint** where the CTO (Hanan) is available for real-time decisions.

## Pre-Flight

1. **Identify the sprint** — Ask which sprint to start if not specified
2. **Read the plan** — `docs/sprints/m{N}-s{N}-{name}/plan.md`
3. **Check dependencies** — Is the previous sprint complete?
4. **Verify risk review** — Has the plan been reviewed? Check `docs/sprints/m2-planning.md`

## Team Selection

Present team composition options based on sprint complexity:

| Role | Model | When Needed |
|------|-------|-------------|
| Tech Lead | You (Opus) | Always |
| Frontend Dev | Sonnet | UI work |
| Backend Dev | Sonnet | Server work |
| Reviewer | Opus | Always (independent) |

Recommend a team based on the sprint's tasks. Add **custom roles** when useful (e.g., Recovery Analyst, API Specialist).

## Agent Team Setup

**Use Claude Code's native Teams feature** to run the sprint as a real agent team.

### Setup steps

1. **Create the team** with `TeamCreate`: `team_name` = `sprint-m{N}-s{N}-{name}`
2. **Create shared tasks** with `TaskCreate` — one per sprint task
3. **Spawn teammates** with the `Agent` tool using `team_name` and `name`:

| Sprint Role | Agent `name` | `subagent_type` | `mode` |
|---|---|---|---|
| Backend Dev | `backend-dev` | `general-purpose` | `acceptEdits` |
| Frontend Dev | `frontend-dev` | `general-purpose` | `acceptEdits` |
| Reviewer | `reviewer` | `general-purpose` | `plan` |

4. **Agents communicate via `SendMessage`** — DMs for task handoffs, `broadcast` only for blockers
5. **Shared task list** — agents check `TaskList`, claim tasks, mark complete
6. **Shutdown** with `shutdown_request` when done, then `TeamDelete`

### Agent prompt guidelines

Include in each agent's prompt:
- Role and responsibility
- Sprint plan (full task text)
- Communication expectations (DM reviewer when ready, DM tech lead on blockers)
- For CTO-present sprints: "Escalate architectural decisions to tech lead, who will ask CTO"

### When NOT to use teams

Use single-agent execution instead when:
- Sprint has fewer than 3 tasks
- All tasks are strictly sequential
- Sprint is pure research/planning

## Execution Rules

1. **Block on decisions** — Escalate architectural choices to CTO
2. **Incremental commits** — Commit only when asked
3. **Real-time review** — Reviewer checks work as it progresses
4. **User stories at end** — Provide test scenarios when sprint is complete

## Decision Protocol (Normal Mode)

```
Decision needed?
  ├─ Minor (implementation detail) → Make it, mention briefly
  ├─ Medium (approach choice) → Present options with pros/cons, recommend one
  └─ Major (architecture) → Stop, discuss, wait for approval
```

## Sprint Flow

1. Break down tasks from plan
2. **Set up agent team** (TeamCreate → TaskCreate → spawn teammates)
3. Assign initial tasks to teammates
4. Orchestrate: relay context, escalate decisions to CTO, unblock agents
5. Reviewer checks each major piece (DMs findings to implementers)
6. Integration + verification
7. Shut down teammates, present user stories for CTO testing

## Verification Checklist

Before declaring done:
- [ ] `npx tsc --noEmit` passes
- [ ] `npx prettier --write` applied
- [ ] All planned tasks complete
- [ ] User stories documented
- [ ] No console/server errors

## Start

1. Identify which sprint (ask if not specified)
2. Read the sprint plan thoroughly
3. **Present briefing and wait for confirmation:**
   - Team composition (which roles are needed and why)
   - Executive summary: goal, task count, key risks, estimated complexity
   - Parallel vs sequential task breakdown
   - **Ask CTO to confirm before proceeding** — do NOT begin implementation until confirmed
4. On confirmation → begin execution
