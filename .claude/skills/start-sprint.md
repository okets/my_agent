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

Recommend a team based on the sprint's tasks.

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
2. Assign to team members (parallel where possible)
3. Execute task by task
4. Reviewer checks each major piece
5. Integration + verification
6. Present user stories for CTO testing

## Verification Checklist

Before declaring done:
- [ ] `npx tsc --noEmit` passes
- [ ] `npx prettier --write` applied
- [ ] All planned tasks complete
- [ ] User stories documented
- [ ] No console/server errors

## Start

Ask the user which sprint to start, then:
1. Read the sprint plan
2. Propose team composition
3. Break down parallel vs sequential tasks
4. Begin execution
