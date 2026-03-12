---
name: start-trip-sprint
description: Start an autonomous trip sprint. Stops on major design deviations and waits for CTO input. External reviewer replaces manual code review.
---

# Start Trip Sprint (Mobile CTO Mode)

You are starting a **trip sprint** — autonomous execution while CTO is on mobile. CTO can text but cannot do code reviews or read documents.

**External reviewer procedure:** `docs/procedures/external-reviewer.md`

## Pre-Flight Checklist

Before starting, verify:

- [ ] Design spec exists for the milestone/sprint scope
- [ ] Scope is clear and unambiguous
- [ ] No heavy visual design work requiring CTO visual feedback

If the design spec doesn't exist, **stop and tell the CTO** — trip sprints need at least a design spec to plan from.

## How Trip Mode Differs

| Aspect | Normal | Overnight | Trip |
|--------|--------|-----------|------|
| CTO available | Live at desk | Absent | Mobile, text only |
| Minor decisions | Make and mention | Make and log | Make and log |
| Medium decisions | Present options | Make, log pros/cons | Make, log pros/cons |
| Major design deviations | Stop and discuss | Make, log extensively | **Stop and wait** |
| External reviewer | Standard step | Standard step | **Mandatory, replaces CTO review** |
| Browser verification | Standard step | Standard step | **Mandatory when applicable** |
| Review delivery | CTO reads artifacts + code | CTO reads artifacts + code | **Conversational walkthrough via /trip-review** |

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
| Reviewer | Opus | Independent code review during execution (can fail sprint) |
| QA | Sonnet | Manual testing, write test report |

Add **custom roles** when the sprint benefits. The in-team Reviewer handles code quality (bugs, security, style). The External Reviewer (dispatched after execution) handles spec verification.

## Agent Team Setup

**Use Claude Code's native Teams feature** — same setup as overnight sprints.

1. **Create team** with `TeamCreate`: `sprint-m{N}-s{N}-{name}`
2. **Create shared tasks** with `TaskCreate` — one per sprint task
3. **Spawn teammates** with `Agent` tool using `team_name` and `name`
4. **Agents communicate via `SendMessage`** — DMs for handoffs, `broadcast` for blockers
5. **Task coordination via shared task list** — claim with `TaskUpdate`, mark complete
6. **Shutdown when sprint completes** — `shutdown_request` to all, then `TeamDelete`

### When NOT to use teams

Single-agent execution when: <3 tasks, strictly sequential, or pure research.

## Decision Protocol (Trip Mode)

```
Decision needed?
  ├─ Minor (implementation detail)
  │     → Decide, log briefly in DECISIONS.md, continue
  │
  ├─ Medium (multiple valid approaches)
  │     → Decide, log pros/cons in DECISIONS.md, flag for review, continue
  │
  └─ Major design deviation (spec says X but reality demands Y)
        → STOP
        → Present to CTO:
           - What the spec says (1-2 sentences)
           - Why it doesn't work (1-2 sentences)
           - Options labeled A/B/C
        → Wait for CTO response
        → Continue with chosen option
```

### What Counts as a Major Design Deviation

- A spec requirement can't be implemented as written
- Two spec requirements conflict with each other
- A dependency is missing or behaves differently than the spec assumed
- The implementation would require changing the design spec's architecture
- Something affects other sprints or milestones

### What Does NOT Count

- Choosing between two valid ways to implement a spec requirement
- Adding a helper function not mentioned in the spec
- Adjusting test structure
- Import reorganization or code organization choices

### Timeout Policy

If no CTO response within the current session (CTO closes terminal or session expires):
1. Log the deviation as **BLOCKED** in `DEVIATIONS.md`
2. Skip the affected task
3. Continue with remaining unblocked tasks
4. All blocked items are presented during `/trip-review`

## Sprint Artifacts

All artifacts are created and maintained during execution, not just at the end.

| Artifact | Location | Created when | Updated when |
|----------|----------|-------------|--------------|
| `plan.md` | `docs/sprints/m{N}-s{N}-{name}/` | Before execution (pre-existing) | Not modified (unless critical fix, logged in DEVIATIONS.md) |
| `DECISIONS.md` | `docs/sprints/m{N}-s{N}-{name}/` | First decision is made | Each subsequent decision |
| `DEVIATIONS.md` | `docs/sprints/m{N}-s{N}-{name}/` | First deviation occurs | Each subsequent deviation |
| `review.md` | `docs/sprints/m{N}-s{N}-{name}/` | External reviewer completes verification | Not modified after creation |
| `test-report.md` | `docs/sprints/m{N}-s{N}-{name}/` | External reviewer runs tests + browser checks | Not modified after creation |

These artifacts are the source of truth for `/trip-review`. They must be complete because the CTO will never read them directly.

## Execution Flow

### Phase 1: Planning

1. **Identify sprint** — ask if not specified
2. **Read the design spec** and any prior sprint reviews for context
3. **Plan the sprint** — use brainstorming + writing-plans skills to create `plan.md`
4. **Present briefing conversationally:**
   - Goal in 1-2 sentences
   - Task count and estimated complexity
   - Any risks or ambiguities to resolve now
   - Ask CTO to confirm
5. **On confirmation** — proceed to Phase 2

### Phase 2: Implementation

6. **Create branch** and begin execution
7. **Run autonomously** — minor/medium decisions handled like overnight
8. **Stop on major design deviations** — present options, wait for response
9. **After all tasks complete** — shut down implementation team
10. **Dispatch external reviewer** (see `docs/procedures/external-reviewer.md`):
    - Gather input package: spec, plan, `git diff master...HEAD`, test results, file list
    - Spawn external reviewer agent with `Agent` tool
    - External reviewer runs tests, browser checks, spec gap analysis
    - External reviewer writes `review.md` and `test-report.md`
11. **Notify CTO:** "Sprint complete. Run `/trip-review` when ready."

## Start

1. Confirm which sprint (ask if not specified)
2. Read the design spec and prior sprint context
3. Create sprint plan (brainstorming → writing-plans flow)
4. Present briefing and wait for confirmation:
   - Goal, task count, complexity
   - Team composition
   - Any pre-flight concerns
   - **Ask CTO to confirm before proceeding**
5. On confirmation → create branch, set up team, begin execution
