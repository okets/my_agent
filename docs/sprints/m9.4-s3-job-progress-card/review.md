# M9.4-S3 External Review: Job Progress Card

**Reviewer:** External (Opus)
**Date:** 2026-04-10
**Verdict:** PASS

## Spec Compliance

### 10.2 Sticky card above compose, one per running job, max 2 stacked
**MET.** Progress card is placed as a `shrink-0` div between `</main>` (message list) and `<footer>` (compose area) in both desktop and mobile templates. The `activeCards` computed property in the jobs store filters to running jobs with todoProgress items, sorts newest-first, and applies `.slice(0, 2)` to enforce the max-2 constraint.

### 10.3 Click toggles collapsed/expanded, X dismisses, completion fade after 2s
**MET.** Collapsed view has `@click="toggle(job.id)"`. Expanded header title also has `@click="toggle(job.id)"` with a `@click.stop="dismiss(job.id)"` button. Completion uses a two-phase approach: "done" state at full opacity for 1.5s, then "fading" state triggers `opacity:0` CSS transition, then card removed at 2s total. Browser test T8 verifies this end-to-end.

### 10.4 Correct icons and colors
**MET (with minor note).** Icons match spec exactly: done=U+2713, in_progress=U+21BB, blocked=U+2298, pending=U+25CB. The `statusClass()` function returns the correct Tailwind classes per spec: `text-green-400/60`, `text-blue-400`, `text-orange-400/60`, `text-gray-500`. See Minor issue M1 below regarding step text color for blocked items.

### 10.5 Max 5 rows visible (1 header + 4 steps), scrollable
**MET.** The step list container uses `max-h-[6.5rem] overflow-y-auto` with thin scrollbar styling. At `text-xs leading-5` (~1.25rem per row plus `py-0.5` padding), 6.5rem accommodates approximately 4 visible step rows. Browser test T5 verifies scroll behavior with 8 items.

### 10.6 todoProgress.items with { id, text, status } in StatePublisher
**MET.** `JobSnapshot` type in `protocol.ts` adds `items: Array<{ id: string; text: string; status: TodoStatus }>`. `StatePublisher._getJobSnapshots()` maps todo items to `{ id, text, status }`, stripping internal fields (mandatory, created_by, notes). Integration test verifies the exact shape.

### 10.7 Old delegationProgress, _syncDelegationProgress, inline progress bar removed
**MET.** Grep confirms zero references to `delegationProgress`, `_syncDelegationProgress`, or `_doneTimestamp` in `packages/dashboard/public/`. Both desktop and mobile inline progress bar templates deleted. The `state:jobs` case in app.js now has only a comment. Old test file `delegation-progress-bar.test.ts` deleted.

### 10.8 All 10 validation tests exist and pass
**MET.** All 10 tests from the spec table are implemented as browser tests (T1-T10) and all pass:
- T1: Card appears when job starts with todos
- T2: Card updates as todo statuses change
- T3: Collapsed shows current step text
- T4: Expanded shows all steps with correct icons
- T5: Scrollbar appears when > 4 steps
- T6: Click/tap toggles collapsed/expanded
- T7: X dismisses card, job continues
- T8: Card fades on job completion
- T9: Two concurrent jobs show two stacked cards
- T10: Mobile: card renders correctly, tap works

## Code Quality

**TypeScript:** Compiles cleanly with `npx tsc --noEmit`, no errors.

**Architecture:** Clean separation -- backend extends the existing `_getJobSnapshots()` IIFE with one additional `items` field. Frontend uses a standalone Alpine component (`progressCard()`) that reads from the existing jobs store, avoiding coupling to app.js internals. The store extension (activeCards, completedCards, dismissed) is well-structured.

**Design Language:** Uses `glass-strong` class, `rgba(255,255,255,0.08)` border, Tokyo Night color tokens (blue-400, green-400/60, gray-500, orange-400/60). Matches the dashboard design language spec.

**Patterns:** Follows existing codebase patterns -- separate JS file for the component, `x-data` Alpine binding, store-based state management. Desktop and mobile templates are kept in sync (identical structure, minor padding difference for mobile `pb-1`).

**Decision documented:** D1 (Playwright tests use WS injection instead of debug API) is well-reasoned and properly logged in DECISIONS.md.

## Issues Found

### Minor

**M1: Blocked item text color inconsistency.** In both desktop and mobile HTML templates, the step item text uses a ternary chain that maps `in_progress` to `text-blue-400`, `done` to `text-green-400/60`, and everything else (including `blocked`) to `text-gray-500`. The icon correctly shows orange for blocked items via `statusClass()`, but the text beside it renders gray. The spec (10.4) associates `text-orange-400/60` with blocked status. This is cosmetically inconsistent -- the icon is orange but the text is gray. Low impact since `blocked` is rarely used.

**Fix:** Change the ternary to include blocked:
```
:class="item.status === 'in_progress' ? 'text-blue-400' : (item.status === 'done' ? 'text-green-400/60' : (item.status === 'blocked' ? 'text-orange-400/60' : 'text-gray-500'))"
```

### Suggestions

**S1: Two separate `x-data="progressCard()"` instances.** Desktop and mobile each create independent component instances. This means `init()` runs twice, creating two `$watch` listeners on the same store. Both will call `handleJobCompleted()` for the same job, pushing it to `completedCards` twice. In practice this is benign (both instances filter by the same `dismissed` list, and the duplicate push gets cleaned up at the 2s mark), but it is worth noting for future reference.

## Test Results

| Suite | Tests | Passed | Failed | Skipped |
|-------|-------|--------|--------|---------|
| Unit (progress-card.test.ts) | 13 | 13 | 0 | 0 |
| Integration (state-publishing-jobs.test.ts) | 2 | 2 | 0 | 0 |
| Browser (progress-card.test.ts) | 10 | 10 | 0 | 0 |
| Full suite (non-browser) | 1170 | 1156 | 2 | 12 |

The 2 failures in the full suite are pre-existing (`heartbeat-service.test.ts` -- "stops retrying after max delivery attempts"), unrelated to this sprint.

## Verdict

**PASS.** The implementation faithfully follows the design spec across all 7 sub-sections (10.2-10.8). All 10 acceptance tests pass. The old progress bar code is cleanly removed. Code quality is high, patterns are consistent with the codebase, and the design language is followed. The one minor issue (M1 -- blocked text color) is cosmetic and low-impact.
