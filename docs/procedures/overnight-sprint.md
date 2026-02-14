# Overnight Sprint Procedure

> **Purpose:** Autonomous sprint execution for async review
> **Created:** 2026-02-14

---

## Overview

Overnight sprints run autonomously on a feature branch. The team makes decisions instead of blocking, documents everything, and delivers a verified working sprint ready for morning review.

**Key difference from normal sprints:**
- Normal: Block on decisions → escalate → wait for CTO
- Overnight: Make decision → document rationale → continue

---

## Pre-Flight Checklist

Before kicking off an overnight sprint:

| Item | Required | Notes |
|------|----------|-------|
| Sprint plan exists | Yes | `docs/sprints/m{N}-s{N}-{name}/plan.md` |
| Risk review complete | Yes | All blockers addressed or documented |
| Branch created | Yes | `git checkout -b sprint/m{N}-s{N}-{name}` |
| Scope clear | Yes | Ambiguous requirements → ask NOW, not overnight |
| Test criteria defined | Yes | How do we know it works? |

---

## Team Composition

| Role | Model | Responsibility |
|------|-------|----------------|
| **Tech Lead** | Opus | Orchestrates tasks, makes architectural decisions, writes decision log |
| **Frontend Dev** | Sonnet | UI implementation |
| **Backend Dev** | Sonnet | Server/API implementation |
| **Reviewer** | Opus | Code review, security, quality gate |
| **QA** | Sonnet | Manual testing, writes test report |

Tech Lead runs the sprint. Reviewer operates independently (doesn't just approve everything).

---

## Execution Flow

```
1. Branch Setup
   └─ git checkout -b sprint/m{N}-s{N}-{name}

2. Task Execution (parallel where possible)
   ├─ Frontend Dev: UI tasks
   ├─ Backend Dev: Server tasks
   └─ Tech Lead: Integration, decision-making

3. Decision Points (no blocking)
   └─ Tech Lead makes call → logs to DECISIONS.md → continues

4. Code Review
   └─ Reviewer: security, quality, plan adherence
   └─ If issues found → fix cycle (max 2 rounds)

5. Verification
   ├─ TypeScript: npx tsc --noEmit
   ├─ Prettier: npx prettier --write
   ├─ Manual QA: User stories from plan
   └─ Integration: Full flow test

6. Documentation
   ├─ DECISIONS.md — all choices made
   ├─ DEVIATIONS.md — differences from plan
   ├─ review.md — Opus review with verdict
   └─ test-report.md — QA findings

7. Final Commit
   └─ Squash or structured commits on branch
   └─ DO NOT merge to master
```

---

## Decision Protocol

When a decision point arises:

### 1. Classify Severity

| Level | Description | Action |
|-------|-------------|--------|
| **Minor** | Implementation detail, no architectural impact | Decide and log |
| **Medium** | Multiple valid approaches, some tradeoffs | Decide, log pros/cons, flag for review |
| **Major** | Could affect other sprints or core architecture | Document extensively, may recommend reverting |

### 2. Log Format

```markdown
## Decision: {title}

**Timestamp:** {ISO timestamp}
**Severity:** Minor | Medium | Major
**Context:** What prompted this decision
**Options Considered:**
1. Option A — pros, cons
2. Option B — pros, cons

**Decision:** Option {X}
**Rationale:** Why this choice
**Risk:** What could go wrong
**Reversibility:** Easy | Moderate | Hard
```

### 3. Decision Principles

1. **Prefer reversible** — if unsure, pick the option easier to undo
2. **Prefer plan alignment** — stay close to the original design
3. **Prefer minimal scope** — don't add features not in the plan
4. **Document uncertainty** — "I chose X but Y might be better because..."

---

## Deviation Protocol

A deviation is anything that differs from the sprint plan:

| Type | Example | Required Action |
|------|---------|-----------------|
| **Addition** | Added a feature not in plan | Document why, flag for review |
| **Removal** | Skipped a planned feature | Document why, mark as incomplete |
| **Change** | Different approach than planned | Document old vs new, rationale |
| **Dependency** | Needed something from another sprint | Document, may block |

### Deviation Log Format

```markdown
## Deviation: {title}

**Type:** Addition | Removal | Change | Dependency
**Planned:** What the plan said
**Actual:** What was done
**Reason:** Why the change was necessary
**Impact:** Does this affect other sprints?
**Recommendation:** Keep | Revert | Discuss
```

---

## Verification Requirements

Sprint is "verified working" when:

### Must Pass
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx prettier --check` — formatted
- [ ] All user stories from plan — manually tested
- [ ] No console errors in browser
- [ ] No unhandled promise rejections in server logs

### Should Pass
- [ ] Works after server restart
- [ ] Works after page refresh
- [ ] Error states handled gracefully
- [ ] No obvious security issues (XSS, injection)

### Nice to Have
- [ ] Works on mobile viewport
- [ ] Keyboard navigation works
- [ ] Loading states present

---

## Deliverables

The branch must contain these files before morning review:

### Required Artifacts

```
docs/sprints/m{N}-s{N}-{name}/
├── plan.md          # Original (unchanged unless critical fix)
├── review.md        # Opus review with verdict
├── DECISIONS.md     # All decisions made overnight
├── DEVIATIONS.md    # All deviations from plan
└── test-report.md   # QA manual test results
```

### Review.md Template

```markdown
# Sprint M{N}-S{N} Review: {Name}

> **Reviewer:** Opus
> **Date:** {date}
> **Verdict:** PASS | PASS WITH CONCERNS | FAIL

## Summary
{2-3 sentences on what was built}

## Plan Adherence
| Task | Planned | Delivered | Notes |
|------|---------|-----------|-------|
| ... | ... | ... | ... |

## Decisions Made
{Count} decisions logged. {Count} flagged for review.
- Major: {list}
- Medium: {list}

## Deviations
{Count} deviations from plan.
- Additions: {list}
- Removals: {list}
- Changes: {list}

## Code Quality
- Security: {assessment}
- Architecture: {assessment}
- Readability: {assessment}

## Issues Found
{List of bugs, concerns, or risks}

## User Stories for Testing
{Copied from plan or written fresh}

## Recommendation
{What CTO should do: merge, request changes, discuss decisions}
```

---

## Morning Review Process

CTO reviews in this order:

1. **Read review.md** — get the verdict and summary
2. **Check DECISIONS.md** — review flagged decisions
3. **Check DEVIATIONS.md** — approve or revert changes
4. **Run user stories** — verify it actually works
5. **Merge or request changes** — branch stays until approved

### Merge Checklist

- [ ] All flagged decisions approved or reverted
- [ ] All deviations acceptable
- [ ] User stories pass on my machine
- [ ] No major concerns from review
- [ ] Ready to merge: `git checkout master && git merge sprint/m{N}-s{N}-{name}`

---

## Failure Modes

### Sprint Fails Overnight

If the team cannot complete the sprint:

1. Document what was completed
2. Document what blocked progress
3. Set verdict to FAIL with clear reason
4. Leave branch in best working state possible
5. Recommend: continue tomorrow vs. abandon vs. redesign

### Reviewer Fails Sprint

If Opus review finds critical issues:

1. Attempt one fix cycle (max 2 rounds)
2. If still failing, document issues clearly
3. Set verdict to FAIL or PASS WITH CONCERNS
4. Let CTO decide whether to iterate or abandon

---

## Example Kickoff Prompt

```
You are Tech Lead for overnight sprint M2-S4 (Conversation Persistence).

**Your mission:** Deliver a verified working sprint by morning.

**Branch:** sprint/m2-s4-conversations (already created)
**Plan:** docs/sprints/m2-s4-conversations/plan.md
**Procedure:** docs/procedures/overnight-sprint.md

**Team:**
- You (Tech Lead, Opus) — orchestrate, decide, integrate
- Frontend Dev (Sonnet) — UI tasks
- Backend Dev (Sonnet) — server tasks
- Reviewer (Opus) — independent code review
- QA (Sonnet) — manual testing

**Rules:**
1. Work only on the branch, never touch master
2. Make decisions instead of blocking — log everything
3. Follow the verification checklist
4. Produce all required artifacts
5. Reviewer operates independently (can fail the sprint)

**Start by:**
1. Reading the plan thoroughly
2. Breaking down tasks for parallel execution
3. Assigning work to team members
4. Beginning implementation

Go.
```

---

## Integration with Normal Flow

| Aspect | Normal Sprint | Overnight Sprint |
|--------|---------------|------------------|
| Decision making | Block → escalate → wait | Decide → log → continue |
| Branch | Optional | Required |
| Review timing | During sprint | End of sprint |
| CTO involvement | Throughout | Morning only |
| Iteration | Real-time | Next night or daytime |
| Risk tolerance | Lower (can ask) | Higher (must decide) |

---

*Created: 2026-02-14*
