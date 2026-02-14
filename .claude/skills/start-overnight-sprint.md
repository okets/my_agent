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

**Templates:** `docs/procedures/templates/`

## Verification Before Completion

Must pass:
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx prettier --check` — formatted
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
3. Create the branch
4. Copy artifact templates
5. Break down tasks for parallel execution
6. Begin implementation
7. Log decisions as they happen
8. Reviewer operates independently
9. QA tests at end
10. Commit final state to branch

**Go.**
