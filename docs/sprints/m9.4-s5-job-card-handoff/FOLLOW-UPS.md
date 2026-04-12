---
sprint: M9.4-S5
created: 2026-04-12
---

# Follow-Ups from M9.4-S5 Smoke Tests

Items discovered during the CTO's closing smoke test (pair-browse) that are
outside this sprint's scope but need tracking. The **handoff** behavior
built in M9.4-S5 verified correctly — card persists through completion and
fades on Nina's tagged `start`. These items concern **pre-completion**
progress reporting.

## UX-2: Progress counter sits at 0/N while the worker is visibly doing work

**Observed during:** M9.4-S5 closing smoke test, `screenshot-cnn-homepage`
automation, 2026-04-12. User reported: "the card is stuck showing 0/3
even though I saw a browser window opening." Counter eventually caught
up ("all of a sudden") to 2/3, then 3/3.

**Root cause (confirmed in code):** The progress card faithfully displays
whatever the worker reports via the `todo_in_progress` / `todo_done` MCP
tools. The worker model (Sonnet) frequently does several steps of real
work — opening a browser, navigating, taking a screenshot — *before*
calling any todo-status MCP tool. From the user's perspective, the counter
sits at 0/N for 20-30 s, then jumps.

This is NOT a regression from M9.4-S5. The running-job rendering path is
unchanged on our branch (`activeCards` filter, counter template). The
`onJobProgress` callback in `app.ts:1182` fires `publishJobs()` on every
todo write — but if the worker never writes mid-work, there's nothing to
publish.

**Why it matters:** Undermines the progress UI's purpose (continuous
activity feedback). User perception is "the system is frozen" during the
most visible phase of the job.

**Three candidate fixes (choose one or combine):**

1. **Tighten the working-Nina prompt.** Add explicit guidance in
   `packages/dashboard/src/automations/working-nina-prompt.ts` mandating
   `todo_in_progress` BEFORE starting a step and `todo_done` IMMEDIATELY
   after. Cheapest fix; relies on model compliance.

2. **Implicit progress markers.** Infer activity from tool use — e.g.,
   any `browser_*` or `bash_*` call bumps the first `pending` todo to
   `in_progress` automatically. More robust but heuristic; risks
   inaccurate mappings when tool order doesn't match todo order.

3. **UI "starting…" state.** When the job is running but `done === 0` and
   `current === null`, show "Starting…" instead of "0/N" so the user
   knows the worker is mid-launch rather than stuck. Presentational
   bandage; doesn't fix the underlying cadence.

**Suggested priority:** Medium — same UX class as UX-1 but less severe
(activity is happening, just unreported). Discuss with architect for the
right framework-vs-prompt split.

**Where to look first:**
- `packages/dashboard/src/automations/working-nina-prompt.ts`
- `packages/dashboard/src/automations/automation-executor.ts` (todo_* tool
  handlers + PostToolUse hooks that could emit implicit markers)
- `packages/dashboard/public/index.html:5987-5995` (running-card template
  for the "Starting…" fallback option)
- `packages/dashboard/public/js/progress-card.js` `currentStepText()` for
  the fallback condition

**Noted by:** CTO (pair-browse, 2026-04-12)
