---
sprint: M9.4-S4.2 — Proactive Delivery as Action Request
soak_status: Day 2 of 7
date: 2026-04-29
events_observed:
  - 07:01 BKK morning brief (notify: debrief)
  - 08:04 BKK relocation session (notify: immediate)
verdict: Worse than Day 1's diagnosis suggested. User reports "massive degradation" vs pre-S4.2 baseline.
prepared_for: Team review before next-step decision
---

# M9.4-S4.2 — Soak Day 2 Case Report

## TL;DR

All four Day-1 follow-up fixes shipped and deployed (PR #8 merged, PR #9 merged, manifest patched, SDK session cleared, dashboard restarted). Day-2 deliveries fired through the new code on a fresh SDK session.

**Both deliveries still arrived contaminated.** User reports a *"massive degradation in how Nina presents me briefs since last week"* — felt-experience regression vs the pre-S4.2 baseline (Apr 24 clean brief).

Three distinct factors contributed, only one of which is what Day-1 diagnosed:

1. **Workers still produce contaminated `deliverable.md`** (regex match confirmed; framework not enforcing reject).
2. **Conversation Nina narrates her own `Read` tool usage** (structural side effect of artifact-reference design — this is new to S4.2 and not present pre-S4.2).
3. **Conversation gravity was not the sole cause** of yesterday's bleed. RC1 from soak-day-1 was at best partial. Fresh SDK session did not eliminate the opener bleed.

We are at `superpowers:systematic-debugging` Phase 4.5: *"If 3+ Fixes Failed: STOP and question the architecture."* Two distinct fix attempts (S4.2 + fu1) have each surfaced a new layer of problem. A third without questioning fundamentals is the anti-pattern the skill warns against.

---

## What was deployed between Day-1 and Day-2

| Action | Where | Effect |
|---|---|---|
| L1: widen validator regex (`I'll start (by\|executing)`, `Now I need to`, `Let me (get\|find\|search\|create\|locate)`) | PR #8 (master @ `5d4833c`) | Live |
| Tighten action-request prompt body ("TODAY's", "pause and deliver", anti-tomorrow/background clauses) | PR #8 | Live |
| L6: patch `daily-relocation-session.md` manifest todos (split compose+emit, attach `validation: deliverable_written`) | Local `.my_agent/` edit | Live (worker uses framework template, see §4 below) |
| L3b: `UPDATE conversations SET sdk_session_id = NULL WHERE id = 'conv-01KP…'` | DB | Confirmed: new session `c7c569fd-…` created at 03:00:48 IDT |
| Test fixture privacy fix | PR #9 (master @ `1d9ac35`) | No runtime effect; cleanup only |
| Dashboard restart | systemd | Live since 08:21:27 IDT (yesterday) |

---

## What S4.2-fu1 actually delivered (honest accounting)

To not lose sight of: Day-2 confirmed the **infrastructure-level changes worked exactly as designed**:

1. **L3b rotation worked.** `Starting new SDK session (message 1)` at 03:00:44 IDT for the brief — fresh session, new system prompt loaded, no inheritance from yesterday's transcript at the model-context level.
2. **Action-request routing fired.** Both deliveries logged `[Heartbeat] Delivering job_completed as action request (run_dir=yes)`. No `[SYSTEM:]` pre-wrap. Routing is correct.
3. **Validator code is correct.** When run against today's actual deliverable contents post-hoc, `STRONG_OPENERS` matches the relocation deliverable and `SECOND_MARKERS` count of 2 matches the brief deliverable (verified — see §4). The widened regex from fu1 is doing its job at the regex level.
4. **Prompt tightening fired.** Today's brief opener does NOT say "tomorrow's" or "background" — those specific dismissal patterns are gone. The fu1 prompt clauses are working at the model level.

What did NOT work: the felt experience. The brief still opens with model thought-narration; the worker output still contains thought-narration; the user's experienced regression is real and confirmed by the artifacts.

---

## Evidence

### Brief turn — 2026-04-29T00:01:13 UTC (07:01 BKK)

**Verbatim opener:**

> *"Let me read that deliverable. Good — I have the full picture. The deliverable has the worker narratives but the actual content is embedded in them. Let me render this cleanly.*
>
> *---*
>
> *## Morning Brief — Wednesday, April 29*"

The body that follows is well-structured: AQI section with embedded chart, expat tips, upcoming events, project status. **The CONTENT is rich.** The opener is the regression surface.

Critically:
- No "tomorrow's brief" mislabel ✓
- No "background activity" framing ✓
- But: *"Let me read that deliverable"* — Read tool narration
- And: *"The deliverable has the worker narratives but the actual content is embedded in them"* — Nina is *meta-explaining* the worker contamination to the user, mid-delivery
- And: *"Let me render this cleanly"* — synthesis narration

### Relocation turn — 2026-04-29T01:04:07 UTC (08:04 BKK)

**Verbatim opener:**

> *"The worker left its process narration instead of the final composed message, but the content is all there. Here's the session:*
>
> *---*
>
> *## Today's Relocation Session — April 29*"

Same shape: meta-explanation about the worker being broken, then renders the actual content. The body content is reasonable (3 priorities + week horizon).

### Worker `deliverable.md` files (today)

**Relocation (`daily-relocation-session/job-49c33b2e-…/deliverable.md`):**

> *"I'll start by checking the todo list and then executing the daily relocation session. Now I need to load the necessary tools and understand what this automation does. Now I'll load the necessary tools and begin the work. First, I need to mark task t1 as in progress (but the actual writing is the LAST step), so I'll need to do the preparatory tasks first. Let me check what the proper workflow is - I need to research, then compose the message in deliverable.md at the end. […]"*

The deliverable body is **the worker writing its own thought process as the deliverable content**. It enumerates the manifest's todos *as the deliverable*.

**Brief — `expat-tips-worker/job-a7fdf35a-…/deliverable.md` (one of 5 worker outputs aggregated by debrief-reporter):**

> *"I'll start by checking my todo list and then execute the automation. I need to understand the automation spec first before writing deliverable.md. Let me read the automation spec to understand what expat-tips-worker should produce. Now let me check what previous tips have been given to avoid repeating evergreen ones […]"*

Same pattern. The brief inherits this contamination via the aggregator (`debrief-reporter`).

### System state during deliveries

| Timestamp (IDT) | Event | Source |
|---|---|---|
| 2026-04-28 08:21:27 | Dashboard restart with merged fu1 + privacy code | journalctl |
| 2026-04-29 02:02 | Workers run (5 workers for the brief) | journalctl |
| 2026-04-29 03:00:33 | `debrief-reporter`: due, firing | journalctl |
| 2026-04-29 03:00:44 | `[Heartbeat] Delivering job_completed as action request (8928 chars summary, run_dir=yes)` | journalctl |
| 2026-04-29 03:00:44 | `[SessionManager] Initialized` | journalctl |
| 2026-04-29 03:00:44 | **`Starting new SDK session (message 1)`** | journalctl |
| 2026-04-29 03:00:48 | **`Captured SDK session ID: c7c569fd-5902-4018-a4b9-c9363a926772`** (new — replacing the cleared `167916ef-…`) | journalctl |
| 2026-04-29 04:00:33 | `daily-relocation-session`: due, firing | journalctl |
| 2026-04-29 04:03:52 | `[Heartbeat] Delivering job_completed as action request (3410 chars summary, run_dir=yes)` | journalctl |
| 2026-04-29 04:03:52 | **`Resuming SDK session: c7c569fd-… (message 2)`** | journalctl |

---

## Three distinct factors contributed

### Factor (a): Worker deliverables are still contaminated

Both `daily-relocation-session` and `expat-tips-worker` (which feeds the brief via aggregator) produced 100% narration deliverables today.

Regex check against today's actual files (run post-hoc to confirm the validator code is correct):

```
relocation:
  head[0..80]: "I'll start by checking the todo list and then executing the daily relocation ses"
  STRONG hit: /^I'll start (by|executing)\b/i  ← MATCHES (fu1 widened pattern)
  SECOND markers found: 1  ["Now I need to"]

brief (debrief-reporter output, which embeds expat-tips-worker):
  head[0..80]: "<!-- wrapper -->\n## expat-tips-worker\n\nI'll start by checking my todo list and t"
  STRONG hit: none  (the wrapper marker is at byte 0, not narration)
  SECOND markers found: 2  ["Let me read", "Now let me"]  ← MATCHES doubled-signal
```

The validator code returns `pass: false` for both files when called directly. **The widened regex from fu1 is correct.** The contamination still landed because of factor (b).

### Factor (b): Validator enforcement is leaking

Today's `daily-relocation-session/job-49c33b2e-…/todos.json`:

```json
{
  "items": [
    { "id": "t1", "validation": "deliverable_written", "status": "done", "mandatory": true, ... },
    { "id": "t2", "status": "done", "mandatory": true, ... },
    { "id": "t3", "validation": "status_report", "status": "done", "mandatory": true, ... }
  ],
  "last_activity": "2026-04-29T01:03:45.293Z"
}
```

`t1` shows `status: done` and **no `validation_attempts` field**. The expected enforcement (per `packages/dashboard/src/mcp/todo-server.ts:120-156`) is: when a worker calls `todo_update(id: t1, status: "done")`, the server runs the validator. If `pass: false`, increment `validation_attempts` and return an error message ("Cannot mark done: …"). After 3 fails, mark blocked.

But the on-disk deliverable triggers `pass: false` when run today, AND `validation_attempts` is absent (i.e., zero). Three plausible causes — none of which we've verified:

1. **Race / out-of-order writes.** Worker calls `todo_update` while the deliverable is in some intermediate clean state (e.g., a partial write); validator passes; worker then re-uses Edit tool to prepend more narration; final on-disk file is contaminated.
2. **Worker is bypassing the todo MCP tool entirely.** Marking `t1` done via direct file write to `todos.json` rather than the MCP tool would skip validator enforcement. Possible if the framework registers two paths for todo updates.
3. **Validator runs on the wrong path.** `runValidation("deliverable_written", jobDir)` reads `${jobDir}/deliverable.md`. If `jobDir` resolves to a different directory than the worker's actual run dir at validation-time, validator passes against an empty/clean file while the contaminated one lives elsewhere.

This is a framework bug **independent of S4.2**. It would have existed regardless of the trigger conversion. S4.2 didn't introduce it; soak just surfaced it because contaminated workers became more visible after the action-request framing.

### Factor (c): Conversation Nina narrates her own Read tool usage

The S4.2 action-request prompt body (post-fu1) reads:

> *"It's time to deliver TODAY's results from a scheduled background task you (past-you) set up. The conversation may have been on another topic — pause and deliver this now. […] Deliverable: ${run_dir}/deliverable.md. Read the deliverable, render its contents in your voice, and present it to the user now. Editorial freedom inside each section […]"*

The model receives this as a USER turn. The instruction "Read the deliverable, render its contents…" requires Nina to **call the Read tool** on the file path. Sonnet (claude-sonnet-4-6, our config model) is trained to narrate tool usage. So the response stream begins with text about reading: *"Let me read that deliverable. Good — I have the full picture. Let me render this cleanly."*

The pre-S4.2 prompt was `[SYSTEM: Background work results: <inline content>. Forward verbatim.]` — content was IN the prompt body, no Read tool needed, no narration possible.

This is a **structural side effect of the artifact-reference design.** Moving content out of the prompt body and pointing at a file path inherently introduces a tool call, which inherently introduces narration on Sonnet.

The fu1 prompt tightening (anti-tomorrow/anti-background clauses) addressed two specific dismissal patterns observed Day-1. It did not — and could not — address the structural Read-narration issue, because that issue is downstream of the file-reference choice itself.

The architect's pre-merge review M3 was prescient: *"render-don't-drop is tested at directive level only; the test confirms the prompt-level guard is in place [but] does not verify the model would actually preserve sections — that's deferred to live soak."* The same logic applies to "render-without-narration": a directive-level prompt instruction can't override a structural property of the prompt's surface.

---

## Felt regression — the timeline

| Date | Brief opener | Quality |
|---|---|---|
| Apr 24 (pre-S4.2, fresh convo) | *"Good morning! Here's today's brief: …"* | Clean. Forward-verbatim path. (per bug-record memory) |
| Apr 25–27 (pre-S4.2, ongoing convo) | *"That's tomorrow's brief workers — they'll land at 7am. Nothing to action now."* | Dismissive — the original S4.2-motivating pattern |
| Apr 28 (post-S4.2 merge, ongoing convo) | *"(That's tomorrow's morning brief arriving early — the debrief reporter runs at 2am to be ready for 7am. Let me grab it.)"* | Read narration + meta-explain. Day-1 finding. |
| Apr 29 (post-fu1 merge, FRESH SDK session) | *"Let me read that deliverable. Good — I have the full picture. […] Let me render this cleanly."* | Read narration + meta-explain (worker contamination). Today. |

**The user's "massive degradation" is anchored against Apr 24** (the pre-S4.2 baseline, which was clean). The S4.2 changes traded the dismissal pattern (Apr 25-27) for the Read-narration pattern (Apr 28-29). The user is reporting that the new failure shape is more disruptive than the old one — the meta-explanation of the worker's brokenness is itself an unwelcome surface.

---

## We are at the architectural-question point

`superpowers:systematic-debugging` Phase 4.5:

> *Pattern indicating architectural problem: Each fix reveals new shared state/coupling/problem in different place. Fixes require "massive refactoring" to implement. Each fix creates new symptoms elsewhere.*
>
> *STOP and question fundamentals: Is this pattern fundamentally sound? Are we "sticking with it through sheer inertia"?*

What we've seen across the two fix attempts:

| Fix attempt | Surfaced |
|---|---|
| **S4.2 (initial)** | "Fresh session needed for new system prompt to take effect" |
| **fu1 (Day-1 follow-up)** | "Read tool narration is structural; validator enforcement leaks" |

The architectural claim of S4.2 is: *"Proactive deliveries are user-role action requests, not system-role status notes."* That principle remains sound at the routing/role level (the dismissal pattern is gone — that part of S4.2 worked). But the *implementation choice* of "reference the artifact by file path so the model reads and renders" has the side effect of inviting tool narration that the inline-content design did not have.

Question for the team: is the artifact-reference design fundamentally right (and we need a new mechanism for tool-use suppression on this specific call), or is the inline-content design strictly better for this delivery shape?

---

## Decision space

| | What it does | Cost | Addresses |
|---|---|---|---|
| **A: Rollback the flag** (`PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0`, restart) | Revert routing to `sendSystemMessage`; old `[SYSTEM: forward verbatim]` framing returns | Loses S4.2's anti-dismissal win mid-conversation; reintroduces the original Apr 25-27 failure pattern | Read narration (no Read tool needed in old path) |
| **B: Inline the summary, drop the file reference** | Keep action-request routing; replace `\nDeliverable: ${run_dir}/deliverable.md\nRead the deliverable…` with the summary content directly in the prompt body | Briefs can be 8K+ chars; need to think about what we lose vs gain. Doesn't fix worker contamination. | Read narration (no Read tool needed) |
| **C: Investigate validator enforcement gap** | Find why `t1: done` lands with `pass: false` regex match. File-watch + ordering + MCP-tool audit. | Real engineering work; framework-level | Worker contamination at the source |
| **D: Force Sonnet to suppress tool narration on this specific call** | New SDK option / hook to intercept text_delta until first non-narration token; or use Haiku for this specific render call (no narration tendency on Haiku) | Real engineering; cross-component change | Read narration |
| **E: Pause the soak, take this report to the team, no further patches today** | Same posture as Day-1 follow-up — surface findings, don't patch | Tomorrow's brief still lands on broken state unless flag is flipped (A) | Nothing alone — but allows a considered architectural decision |

Combinations worth considering:
- **A + E**: flip flag now to restore Apr 24 quality during architectural deliberation; revisit once team picks a forward direction
- **B + E**: most conservative forward path that keeps S4.2's anti-dismissal benefit while removing the structural Read-narration cause
- **B + C**: address both the Read narration AND the validator gap; doesn't address whether the action-request framing is the right design

---

## Open questions for the team

1. **Is the action-request principle still the right call** if its concrete implementation (artifact reference) introduces a worse failure than the dismissal it was meant to fix?
2. **Should we measure "delivery quality" as a soak metric** — not just pass/fail? Today's brief content was actually richer than Apr 24's (charts embedded, project-status grounded in real test data), but the experience was worse. Quality and quantity moved in opposite directions.
3. **Validator enforcement gap** — separable framework bug. Is this its own sprint, or rolled into the next iteration of S4.2?
4. **Where do we draw the "questioning architecture" line?** We're at 2 fix attempts. Skill says question at 3+. Is the user's felt regression evidence enough to question now, or do we hold the line?

---

## Appendix

### Timing reference

- BKK = UTC+7, IDT = UTC+3 (BKK is 4h ahead of IDT)
- 07:00 BKK = 03:00 IDT, 08:00 BKK = 04:00 IDT

### Relevant commit refs

- `5d4833c` — PR #8 merge (fu1 widened validator + tightened prompt body)
- `1d9ac35` — PR #9 merge (test fixture privacy fix; runtime no-op)
- `c7c569fd-5902-4018-a4b9-c9363a926772` — new SDK session id from L3b rotation, captured 2026-04-29 03:00:48 IDT

### Run dirs

- Brief (debrief-reporter): `.my_agent/automations/.runs/debrief-reporter/job-45235e0d-4d70-42ec-bff7-d7179aadffb6/`
- Relocation: `.my_agent/automations/.runs/daily-relocation-session/job-49c33b2e-c730-421d-8c49-7f8b34d57ba0/`
- Expat-tips (the contamination source feeding the brief): `.my_agent/automations/.runs/expat-tips-worker/job-a7fdf35a-9ecf-4753-9258-91a67fb132c3/`

### Code locations to investigate (for factor b)

- `packages/dashboard/src/mcp/todo-server.ts:107-156` — `todo_update` MCP tool, validator enforcement path
- `packages/dashboard/src/automations/todo-validators.ts:105-167` — `deliverable_written` validator implementation
- `packages/dashboard/src/automations/automation-executor.ts:413` — where `runValidation` is wired

### Soak status

- Day 1 of 7 — observed (see [`soak-day-1.md`](soak-day-1.md))
- Day 2 of 7 — observed (this report)
- Day 3 of 7 — pending (2026-04-30) **— blocked on team decision**
- Sprint stays open
- Feature flag remains default ON (no rollback applied yet)
- Awaiting team decision on direction
