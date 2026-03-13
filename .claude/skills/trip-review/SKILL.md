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

### 3. What Was Built

**This comes first.** The CTO wasn't at their desk — they need to understand what changed before they can evaluate the verdict. Summarize in plain language:

- What the sprint goal was (1-2 sentences)
- What user-visible things changed (new UI, new behavior, new settings)
- What internal things changed (new APIs, new background behavior)

Keep it concrete: "Morning brief now auto-adjusts when you travel" not "implemented timezone-aware scheduling logic."

### 4. How to Verify

**This is the main deliverable.** Give the CTO specific things they can do on their phone to see the sprint working:

- URLs to visit, buttons to tap, settings to change
- Observable behavior changes ("tomorrow's morning brief will arrive at your local time")
- Before/after comparisons where helpful

If there's nothing user-verifiable yet (pure backend/infra), say so explicitly.

### 5. Present Verdict & Concerns

Present in order, one topic per message. Keep messages short — the CTO is on a phone.

**If PASS:**

```
"External reviewer: PASS. All {N} tests pass,
browser checks passed, no spec gaps."

"No decisions or deviations to flag."

"Want to merge to master?"
```

**If PASS WITH CONCERNS:**

```
"External reviewer: PASS WITH CONCERNS. {N} issues flagged."

"Concern 1: {1-2 sentence description}"

"Concern 2: {1-2 sentence description}"

"Everything else checks out. {N} tests pass, all spec
requirements covered. These are non-blocking."

"Want to merge, or should I fix the concerns first?"
```

**If FAIL:**

```
"External reviewer: FAIL."

"Main issue: {1-2 sentence description of primary failure}"

"The rest looks good — {N} of {N} tasks verified."

"Options:
A. I fix the issue and re-run verification
B. Wait until you're at a desk
C. Roll back the branch"
```

### 6. Handle CTO Response

| Response | Action |
|----------|--------|
| "merge" | Execute `git checkout master && git merge sprint/m{N}-s{N}-{name}` |
| "fix" | Continue working on the branch, fix issues, re-run external reviewer, re-present results |
| "wait" | Leave branch as-is, no action |
| "elaborate" / question | Give more detail on whatever they ask about |
| Blocked items from timeout | Present each blocked item with the deviation details, ask for decision on each |

### 7. After Merge

If CTO approves merge:
1. Execute the merge
2. Confirm: "Merged to master. {N} commits."
3. Check if roadmap needs updating
4. Handle all post-merge tasks yourself (service restarts, builds, etc.)

## Conversation Style

- **Short messages** — one topic per message
- **No jargon** — no file paths unless CTO asks for specifics
- **Numbers over prose** — "5 decisions, all minor" not "several decisions were made"
- **Lead with verdict** — then details
- **Always end with a clear question or action**
- **Never ask CTO to run commands** — the whole point of trip mode is they're on mobile. Execute everything yourself: service restarts, builds, deployments, verifications. Never say "you'll want to run X".

## Identifying the Sprint

If the CTO doesn't specify which sprint:
1. Check for branches matching `sprint/m*`
2. If exactly one exists, use it
3. If multiple exist, list them and ask which one
4. If none exist, say "No sprint branches found"
