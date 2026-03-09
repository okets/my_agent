---
name: whats-next
description: Deterministic self-sync on resume. Scans project state via file checks to identify remaining work, sync gaps, and next actions.
---

# What's Next (Development Driver)

Deterministic file checks to sync state and identify next actions. No speculation — only facts from files.

## Checks to Perform

### 1. Sprint State

```
Find active sprint folder: docs/sprints/m{N}-s{N}-{name}/
  └─ If no active sprint → report "No active sprint"
  └─ If found → continue checks
```

### 2. Task Completion

```
Read plan.md → extract task list
For each task:
  └─ Check for corresponding artifact (code, test, doc)
  └─ Mark: done | in-progress | not-started

Report: X of Y tasks complete
```

### 3. Decision Sync

```
If DECISIONS.md exists:
  └─ For each decision logged
  └─ Check if plan.md or code reflects the decision
  └─ Flag any unsynced decisions
```

### 4. Commit vs Roadmap

```
Read recent commits (git log --oneline -10)
Read docs/ROADMAP.md current sprint status
Flag mismatches:
  └─ Commit says "done X" but roadmap says "pending"
  └─ Roadmap says "complete" but no commit evidence
```

### 5. Sprint Closure

```
If plan.md tasks all done:
  └─ Check review.md exists → if not: "Sprint needs review"
  └─ Check test-report.md exists → if not: "Sprint needs QA"
  └─ Check roadmap updated → if not: "Update roadmap"
```

### 6. Success Criteria

```
Read plan.md success criteria (checkboxes)
For each criterion:
  └─ Check if verifiable from artifacts/tests
  └─ Flag unchecked items that block completion
```

## Output Format

```markdown
## Sprint Status: M{N}-S{N} {name}

**Tasks:** X/Y complete
**Blockers:** [list or "none"]

### Remaining Work
1. [task] — [status/notes]
2. ...

### Sync Issues
- [any decision/commit/roadmap mismatches]

### Next Action
[Single clear next step]

### Recommended Sprint Mode
[Normal | Overnight | Either] — [reason]
```

### 7. Sprint Mode Recommendation

```
Assess the next action for overnight suitability:
  Suitable for overnight if ALL:
    └─ Sprint plan exists and is complete
    └─ Scope is unambiguous (no open design questions)
    └─ No UI-heavy work requiring visual review cycles
    └─ No dependencies on external services being configured
  NOT suitable for overnight if ANY:
    └─ Plan has open questions or ambiguous requirements
    └─ Heavy UI/UX work needing CTO visual feedback
    └─ Requires access or credentials not yet set up
    └─ First sprint in a new milestone (architectural decisions likely)
  Report: "Overnight" | "Normal" | "Either" with brief reason
```

## When to Run

- On session resume (after crash, limit, or interrupt)
- When asked "what's next" or "where were we"
- Before starting work on an existing sprint
- After extended break from the project

## Rules

1. **File checks only** — Don't guess, read the files
2. **Report facts** — State what exists vs what's expected
3. **Single next action** — End with one clear step
4. **No side effects** — This skill only reads and reports
