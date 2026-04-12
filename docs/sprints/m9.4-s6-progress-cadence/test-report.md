# Test Report — M9.4-S6 Progress Cadence

**Reviewer:** External Opus (independent)
**Date:** 2026-04-12
**Branch:** `sprint/m9.4-s6-progress-cadence` (commit `fbeac55`)

## Test commands run

### Dashboard unit tests

```
cd packages/dashboard && npx vitest run tests/unit/automations
```

Result:

```
 ✓ tests/unit/automations/handler-registry.test.ts (5 tests)
 ✓ tests/unit/automations/automation-executor.test.ts (8 tests)
 ✓ tests/unit/automations/deliverable-validator.test.ts (5 tests)
 ✓ tests/unit/automations/automation-types.test.ts (11 tests)
 ✓ tests/unit/automations/auto-resume.test.ts (8 tests)
 ✓ tests/unit/automations/progress-cadence.test.ts (5 tests)
 ✓ tests/unit/automations/deliverable-pipeline.test.ts (3 tests)
 ✓ tests/unit/automations/working-nina-prompt.test.ts (7 tests)

 Test Files  17 passed (17)
      Tests  151 passed (151)
   Duration  4.40s
```

**Totals:** 151 passed, 0 failed, 0 skipped across 17 files.

New `progress-cadence.test.ts` contributes 5 tests covering:
1. Progress Cadence is the last `## ` section.
2. Todos inlined as `- [id: X] text` bullets in order.
3. Section omitted when `todoItems` is empty.
4. Section omitted when `todoItems` arg is defaulted (handler-path belt-and-braces).
5. First-tool-call directive + two anti-pattern substrings present verbatim.

### TypeScript typecheck

```
cd packages/dashboard && npx tsc --noEmit     # exit 0, no output
cd packages/core      && npx tsc --noEmit     # exit 0, no output
```

Both packages compile clean.

## §Out-of-scope grep confirmation

Spec §Out of scope forbids: new hooks, new MCP tools, UI changes, `working-nina-prompt.ts` changes, todo MCP tool changes, progress card template changes, status-specific labels, intra-step progress.

```
$ git diff master...HEAD --name-only
docs/sprints/m9.4-s6-progress-cadence/plan.md
packages/dashboard/src/automations/automation-executor.ts
packages/dashboard/tests/unit/automations/progress-cadence.test.ts
```

Targeted path-scoped greps (all returned empty diffs — confirmed no violations):

- `git diff master...HEAD -- 'packages/dashboard/src/hooks/**'` → empty
- `git diff master...HEAD -- 'packages/dashboard/src/mcp/**'` → empty
- `git diff master...HEAD -- 'packages/dashboard/public/**'` → empty
- `git diff master...HEAD -- 'packages/dashboard/src/tasks/working-nina-prompt.ts'` → empty
- `git diff master...HEAD -- 'packages/core/**'` → empty

Todo MCP tool (`createTodoServer`) wiring in automation-executor.ts is unchanged except for the removal of duplicate `assembleJobTodos` / `writeTodoFile` lines that were hoisted to the top of `run()` (spec §D2 — single source of truth per job). The tool itself is untouched.

## Prompt text spot-check vs spec §D3

`buildProgressCadenceSection()` in `automation-executor.ts` lines 862-904. Required substrings verified by direct inspection:

- [x] `"## Progress Cadence (read last — this matters)"` — present, exact.
- [x] `"The first tool call of this job MUST be \`todo_in_progress\` on your first step."` — present, exact.
- [x] `"do **not** batch todo updates at the end"` — present, exact.
- [x] Todo bullet format `"- [id: ${item.id}] ${item.text}"` — matches §D4.
- [x] Anti-pattern list includes the four items from spec §D3 (batching, premature done, skipping in_progress, parallel in_progress).
- [x] Trailing self-check paragraph ("If you find yourself about to call a non-todo tool…") — present, exact.
- [x] Section is `sections.push(...)` last, after the autonomy section — verified at automation-executor.ts:856-859, output joined with `\n\n` so it is the final block.

## Browser verification

Skipped — pure prompt-text change, no UI or server surface touched.

## Closing smoke test (pair-browse, α gate)

**Date:** 2026-04-12
**Mode:** `/pair-browse` — CTO + agent live, shared Playwright browser
**Automation:** `screenshot-cnn-homepage` — scheduled via Nina chat "Schedule a one-time automation to run in 1 minute: take a screenshot of cnn.com and show me the homepage."

### α gate criteria (from spec §Acceptance criteria #1 + §Exit criteria #3)

- [x] **Counter progresses through intermediate steps in real time**, not in a terminal batch (i.e. not `0/3 → 3/3` at the very end). CTO observation: *"it is progressing … clearly nina did some work before updating to 1/3. but this might be ok since the 1/3 counts completed tasks."* — cadence confirmed step-by-step, no batching.
- [x] **Worker narrates methodically, not retroactively.** First run under the new prompt produced a visible step-by-step transition (`0/3 → 1/3 → 2/3 → 3/3`) rather than the S5 pattern of sitting at `0/3` for 20-30s then jumping to `3/3`. Nina's browser popped open while the card was still at `0/3` (pre-first `todo_in_progress` call) but the counter advanced during the run instead of batching at the end.
- [x] **Job completes with a valid `deliverable.md`.** CNN screenshot delivered in chat at 12:46 local (09:46 UTC) with lead story + headlines extracted — no regression in end-to-end behaviour.
- [~] **Counter moves to `1/N` within ~5 seconds of job start.** Not strictly verified: the pair-browse watcher was installed after the job had already begun, so the exact `0/3 → 1/3` transition latency was not timed. CTO's live visual observation was that Nina opened a browser before the counter moved — suggesting step 1 (Research) ran briefly before `todo_in_progress(screenshot)` was called. Counter semantics ("K done", not "step K in progress") account for most of the apparent lag.

### UX-2 follow-up: counter/step-semantic confusion surfaced by a working α gate

The α-gate observation immediately surfaced a pre-existing UX defect: `0/3` on the counter while step 1 was genuinely in progress felt like "nothing is happening" even though the worker was actively working. Scope was expanded mid-sprint (see `DEVIATIONS.md` DEV-1) and the progress card was redesigned:

- Counter pill moved to the card's top-right border edge as a framed label (`● 1/3 Done` / `✓ 3/3 Done` / `✗ Task K failed` with a status-colored leading glyph).
- Step row redesigned with bullet (`→` pulsing orange / `✓` green / `✗` red / `○` gray) + 1-based task number + step text.
- Only the in-progress bullet breathes; the row text and number stay statically colored.
- Double-digit step numbers align via a right-justified fixed-width column.

Verification: pair-browse DOM inspection confirmed class wiring (pulse only on bullets, row colors static, pill shows correct leading glyph per job state). Three states exercised via Alpine store mocks (running, running with step 10/12, failed). Real-run α-gate observation above predates the UI redesign — the cadence fix was verified independently.

### α gate verdict

- [x] **PASS** — prompt-only cadence is sufficient. Worker narrates step-by-step rather than batching at the end. UX-2 follow-up handled in-sprint via progress card redesign (see DEV-1). CTO approved merge.
