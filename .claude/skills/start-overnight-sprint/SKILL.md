---
name: start-overnight-sprint
description: Start an autonomous overnight sprint. Team works on a branch, logs all decisions, delivers verified sprint for morning review.
---

# Start Overnight Sprint (Autonomous Mode)

You are starting an **overnight sprint** — autonomous execution while CTO is unavailable.

**Full procedure:** `docs/procedures/overnight-sprint.md`

## Pre-Flight Checklist

Before starting, verify:

- [ ] Sprint plan exists and is complete
- [ ] Risk review done (check `docs/sprints/m2-planning.md`)
- [ ] Scope is clear (no ambiguous requirements — those block overnight work)
- [ ] Branch will be created

If any pre-flight item fails, **stop and ask now** — overnight sprints cannot block on questions.

## Branch Setup

```bash
git checkout -b sprint/m{N}-s{N}-{name}
```

All work happens on this branch. Never touch master.

## Team Composition

| Role | Model | Responsibility |
|------|-------|----------------|
| Tech Lead | Opus | Orchestrate, decide, integrate, write decision log |
| Frontend Dev | Sonnet | UI implementation |
| Backend Dev | Sonnet | Server implementation |
| Reviewer | Opus | Independent code review (can fail sprint) |
| QA | Sonnet | Manual testing, write test report |

Add **custom roles** when the sprint benefits (e.g., Recovery Analyst for reconstruction sprints, API Specialist for integration work). Custom roles can be `Explore` agents (read-only research) or `general-purpose` (full implementation).

## Agent Team Setup

**Use Claude Code's native Teams feature** to run the sprint as a real agent team where agents communicate directly with each other.

### How to set up the team

1. **Create the team** with `TeamCreate`:
   - `team_name`: `sprint-m{N}-s{N}-{name}`
   - `description`: Sprint goal from the plan

2. **Create shared tasks** with `TaskCreate` — one per sprint task, with dependencies noted

3. **Spawn teammates** with the `Agent` tool using `team_name` and `name` parameters:

| Sprint Role | Agent `name` | `subagent_type` | `mode` |
|---|---|---|---|
| Backend Dev | `backend-dev` | `general-purpose` | `acceptEdits` |
| Frontend Dev | `frontend-dev` | `general-purpose` | `acceptEdits` |
| Reviewer | `reviewer` | `general-purpose` | `plan` |
| QA | `qa` | `general-purpose` | `acceptEdits` |
| Custom (research) | user-defined | `Explore` | default |

   The Tech Lead (you) is the team creator — no need to spawn yourself.

4. **Agents communicate via `SendMessage`:**
   - Backend Dev finishes Task 2 → DMs Reviewer: "Task 2 ready for review"
   - Reviewer finds issue → DMs Backend Dev: "Fix the error handling in search-service.ts"
   - QA needs clarification → DMs Tech Lead
   - Use `broadcast` only for critical blockers

5. **Task coordination via shared task list:**
   - Agents check `TaskList` after completing each task
   - Claim unassigned tasks with `TaskUpdate` (set `owner`)
   - Mark tasks `completed` when done

6. **Shutdown when sprint completes:**
   - Tech Lead sends `shutdown_request` to all teammates
   - Clean up with `TeamDelete`

### Agent prompt guidelines

When spawning each agent, include in the prompt:
- Their **role and responsibility** from the team table
- The **sprint plan** (full task text, not a file path)
- **Sprint rules** (branch only, log decisions, push after every commit)
- **Communication expectations** (DM the reviewer when ready, DM tech lead on blockers)
- For the Reviewer: "You are independent. You can fail the sprint."

### When NOT to use teams

Use single-agent execution (subagent-driven-development) instead when:
- Sprint has fewer than 3 tasks
- All tasks are strictly sequential with no parallelism
- Sprint is pure research/planning (no implementation)

## Execution Rules (Overnight Mode)

1. **Never block on decisions** — Make the call, log it, continue
2. **Log everything** — All decisions go in DECISIONS.md
3. **Log deviations** — Any departure from plan goes in DEVIATIONS.md
4. **Reviewer is independent** — Can fail the sprint if quality issues found
5. **Branch only** — Never merge to master

## Decision Protocol (Overnight Mode)

```
Decision needed?
  ├─ Minor → Decide, log briefly, continue
  ├─ Medium → Decide, log pros/cons, flag for review, continue
  └─ Major → Decide, document extensively, may recommend reverting, continue
```

**Principles:**
- Prefer reversible choices
- Prefer plan alignment
- Prefer minimal scope
- Document uncertainty

## Required Artifacts

Create these files in `docs/sprints/m{N}-s{N}-{name}/`:

| File | Content |
|------|---------|
| `DECISIONS.md` | All decisions with severity, rationale, risks |
| `DEVIATIONS.md` | All departures from original plan |
| `review.md` | Opus verdict, plan adherence, flagged items |
| `test-report.md` | QA verification results |

## Verification Before Completion

Must pass:
- [ ] `npx tsc --noEmit` passes
- [ ] `npx prettier --check` formatted
- [ ] All user stories manually tested
- [ ] No console errors in browser
- [ ] No unhandled rejections in server

Should pass:
- [ ] Works after server restart
- [ ] Works after page refresh
- [ ] Error states handled

## Failure Protocol

If sprint cannot complete:
1. Document what was done
2. Document what blocked
3. Set verdict to FAIL
4. Leave branch in best working state
5. Recommend: continue tomorrow / abandon / redesign

## Start

1. Confirm which sprint (ask if not specified)
2. Read the sprint plan thoroughly
3. **Present briefing and wait for confirmation:**
   - Team composition (which roles are needed for this sprint's tasks)
   - Executive summary: goal, task count, key risks/pitfalls, scope boundaries
   - Parallel vs sequential task breakdown
   - Any pre-flight concerns or ambiguities that should be resolved now
   - **Ask CTO to confirm before proceeding** — do NOT create branch or begin work until confirmed
4. On confirmation → create the branch
5. Copy artifact templates
6. **Set up agent team** (TeamCreate → TaskCreate for each task → spawn teammates)
7. Assign initial tasks to teammates
8. Orchestrate: relay context, unblock agents, log decisions
9. Reviewer operates independently (DMs findings to implementers)
10. QA tests at end (spawned after implementation tasks complete)
11. Shut down teammates, commit final state to branch
