---
sprint: M9.4-S6
title: Progress Cadence — Implementation Plan
status: plan (v1)
created: 2026-04-12
spec: docs/sprints/m9.4-s6-progress-cadence/spec.md
---

# M9.4-S6 Plan

## Shape

Prompt-only sprint. Single file of production change: `packages/dashboard/src/automations/automation-executor.ts`. One new test file under `packages/dashboard/tests/unit/automations/`.

No new hooks, no new MCP tools, no UI work, no global prompt changes.

## Sequencing

Single-agent execution (Opus, Tech Lead role acting as Backend). External reviewer + CTO smoke test at tail. Team feature is overkill for a 200-line prompt change.

## Tasks

### T1 — Reorder todo assembly before `buildAutomationContext`

File: `packages/dashboard/src/automations/automation-executor.ts`

- Lift the todo-assembly block (currently lines ~298–314, inside the MCP-server setup) above the `buildAutomationContext` call (currently line 274).
- Compute `todoItems` and `todoPath` once; reuse them for both the todo file write and the MCP server wiring.
- Ensure the existing `writeTodoFile` / `createEmptyTodoFile` side effects still execute at exactly the same points — only the code location moves.
- The `createTodoServer(todoPath, ...)` wiring below stays put but now reads from the lifted `todoItems`/`todoPath`.

### T2 — Extend `buildAutomationContext` signature

File: `packages/dashboard/src/automations/automation-executor.ts` (method around line 808)

- Add `todoItems: TodoItem[]` parameter (optional, default `[]` if any callsite is missed).
- Import `TodoItem` from `@my-agent/core` at the top of the file (or reuse the existing import chain via `./todo-templates.js`).
- Call chain: only one caller (`run()`). Update the callsite to pass `todoItems`.

### T3 — Emit Progress Cadence section

Inside `buildAutomationContext`, after autonomy, append a new section **only when `todoItems.length > 0`**. The section is the exact text from spec D3, with `{inlined todo list}` expanded per D4:

```
- [id: {item.id}] {item.text}
```

Implementation: a private helper `buildProgressCadenceSection(todoItems: TodoItem[]): string` that returns the fixed prose + inlined bullet list. Keeps `buildAutomationContext` readable.

Ordering guarantee: the section is pushed last in `sections`. The method joins with `\n\n`, so it is trivially the trailing block.

### T4 — Unit tests

File: `packages/dashboard/tests/unit/automations/progress-cadence.test.ts` (new).

Tests (from spec §Acceptance criteria and §Test plan):

1. **Section is the last block** — generate prompt via `buildAutomationContext` for an automation with 3 todos; assert that the last `## ` section of the returned string starts with `## Progress Cadence`.
2. **Todos inlined in order** — 3 todos with ids `a/b/c` texts `T1/T2/T3`; assert substrings `- [id: a] T1`, `- [id: b] T2`, `- [id: c] T3` appear in that order within the Progress Cadence section.
3. **Section omitted when `todoItems.length === 0`** — empty todo list → generated prompt does NOT contain `## Progress Cadence`.
4. **Handler-dispatched jobs** — the handler branch in `run()` returns before `buildAutomationContext` is invoked, so the section cannot appear. Assert this indirectly: when `buildAutomationContext` is called with empty todos (the handler-equivalent input) no Progress Cadence section is emitted. (Coverage of the handler short-circuit itself belongs to `automation-executor.test.ts`, which already exists and stays untouched.)

Access: `buildAutomationContext` is `private`. Either (a) promote it to `public` for testability (minor API surface change on an internal class) or (b) exercise it via a test-only access shim. Preference: expose via a small exported helper `__buildAutomationContext` or mark the method `/** @internal */` and test via `(executor as any).buildAutomationContext(...)`. Go with `(executor as any)` — zero production-surface change, consistent with how other internal methods are tested in this codebase (confirm during implementation by grepping existing tests).

### T5 — Regression check

Run:

```bash
cd packages/dashboard && npx tsc --noEmit
cd packages/dashboard && npm test -- tests/unit/automations
```

All existing automation-executor unit + integration tests must still pass. No snapshot churn expected — existing tests do not inspect the exact assembled system prompt text.

### T6 — External review

Dispatch external reviewer (`docs/procedures/external-reviewer.md`) with:

- Spec + this plan
- Diff: `git diff master...HEAD`
- Test run output
- Files touched: the executor + the new test file

External reviewer writes `review.md` + `test-report.md`. Since this sprint touches no UI, no browser verification is required — external reviewer verifies via:

1. Generated system prompt snapshot (log `systemPrompt` for a sample automation, confirm Progress Cadence section is last).
2. Unit test output (all green).
3. Spec compliance grep (no new hooks/MCP/UI, confirmed by diff).

### T7 — CTO smoke test (α gate, manual)

After merge, CTO runs the CNN automation. Observation (pass/fail) recorded by CTO in `test-report.md` "Closing smoke test" section. This happens post-sprint-close; external reviewer stubs the section with the procedure and awaits CTO entry.

## Risk register

| Risk | Mitigation |
|------|------------|
| Compliance ceiling (prompt is stochastic) | Spec accepts 85–95% as success. If α fails, tune wording in a follow-up pass before escalating to hooks. |
| Duplicate todo assembly after reorder | T1 explicitly consolidates to a single assembly call. Caught by regression test. |
| Test access to private method | Use `(executor as any)` shim; zero production-surface change. |

## Deliverables

- `packages/dashboard/src/automations/automation-executor.ts` — modified (reorder + prompt section).
- `packages/dashboard/tests/unit/automations/progress-cadence.test.ts` — new.
- `docs/sprints/m9.4-s6-progress-cadence/DECISIONS.md` — created when first decision logged.
- `docs/sprints/m9.4-s6-progress-cadence/DEVIATIONS.md` — created only if a deviation occurs.
- `docs/sprints/m9.4-s6-progress-cadence/review.md` — external reviewer.
- `docs/sprints/m9.4-s6-progress-cadence/test-report.md` — external reviewer (α gate left for CTO).

## Estimated effort

~150–200 LOC. ~30 min implementation, ~15 min tests, ~15 min external review. CTO smoke test is async.
