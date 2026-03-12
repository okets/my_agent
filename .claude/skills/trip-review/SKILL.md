---
name: trip-review
description: Conversational sprint review for mobile CTO. Reads all artifacts, presents findings in short messages, ends with merge decision.
---

# Trip Review (Conversational Sprint Review)

Walk the CTO through sprint results. Read all artifacts, present findings in short digestible messages, end with a clear action.

**When to use:** After a trip sprint completes, or when CTO runs `/trip-review`.

## Flow

### 1. Read All Artifacts

Read these files from `docs/sprints/m{N}-s{N}-{name}/`:
- `review.md` — external reviewer's verdict and findings
- `DECISIONS.md` — all decisions made during execution
- `DEVIATIONS.md` — all departures from plan
- `test-report.md` — test results and browser verification
- `plan.md` — original plan for context

If any artifact is missing, note it explicitly: "No deviations logged" or "test-report.md is missing — this needs investigation."

### 2. Determine Verdict

Read the verdict from `review.md`: PASS, PASS WITH CONCERNS, or FAIL.

### 3. Present Findings

Present in order, one topic per message. Keep messages short — the CTO is on a phone.

**If PASS:**

```
"Sprint M{N}-S{N} is done. {N} commits, all {N} tasks complete."

"The external reviewer gave it a PASS. All {N} tests pass,
browser checks passed, no spec gaps found."

"{N} decisions were made, all minor — {brief summary}."

"{N} deviations: {brief summary of each}."

"Want to merge to master?"
```

**If PASS WITH CONCERNS:**

```
"Sprint done, but the reviewer flagged {N} concerns."

"Concern 1: {1-2 sentence description}"

"Concern 2: {1-2 sentence description}"

"Everything else checks out. {N} tests pass, all spec
requirements covered. These are non-blocking."

"Want to merge, or should I fix the concerns first?"
```

**If FAIL:**

```
"Sprint finished but the reviewer failed it."

"Main issue: {1-2 sentence description of primary failure}"

"The rest looks good — {N} of {N} tasks verified."

"Options:
A. I fix the issue and re-run verification
B. Wait until you're at a desk
C. Roll back the branch"
```

### 4. Handle CTO Response

| Response | Action |
|----------|--------|
| "merge" | Execute `git checkout master && git merge sprint/m{N}-s{N}-{name}` |
| "fix" | Continue working on the branch, fix issues, re-run external reviewer, re-present results |
| "wait" | Leave branch as-is, no action |
| "elaborate" / question | Give more detail on whatever they ask about |
| Blocked items from timeout | Present each blocked item with the deviation details, ask for decision on each |

### 5. After Merge

If CTO approves merge:
1. Execute the merge
2. Confirm: "Merged to master. {N} commits."
3. Check if roadmap needs updating

## Conversation Style

- **Short messages** — one topic per message
- **No jargon** — no file paths unless CTO asks for specifics
- **Numbers over prose** — "5 decisions, all minor" not "several decisions were made"
- **Lead with verdict** — then details
- **Always end with a clear question or action**

## Identifying the Sprint

If the CTO doesn't specify which sprint:
1. Check for branches matching `sprint/m*`
2. If exactly one exists, use it
3. If multiple exist, list them and ask which one
4. If none exist, say "No sprint branches found"
