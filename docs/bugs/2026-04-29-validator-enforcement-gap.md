---
date: 2026-04-29
status: open
discovered_by: M9.4-S4.2 Soak Day-2 investigation
severity: medium
scope: half-day investigation; framework-level (not S4.2-specific)
related_sprint: M9.4-S4.2 (the sprint surfaced it; the bug is older)
---

# Validator enforcement gap: `validation: deliverable_written` not preventing `status: done` on contaminated deliverables

## Symptom

Workers with `validation: deliverable_written` attached to a mandatory todo are marking that todo `status: done` even when the on-disk `deliverable.md` would fail the validator's regex check. Contaminated deliverables (100% stream-of-consciousness narration) flow through the framework as if they had passed validation.

Discovered in M9.4-S4.2 Soak Day-2 ([`docs/sprints/m9.4-s4.2-action-request-delivery/soak-day-2.md`](../sprints/m9.4-s4.2-action-request-delivery/soak-day-2.md), Factor (b)). The widened validator regex from fu1 IS correct — when run directly against the contaminated files, it returns `pass: false`. The framework just isn't enforcing the result.

## Concrete evidence (2026-04-29)

### Case 1: `daily-relocation-session/job-49c33b2e-c730-421d-8c49-7f8b34d57ba0/`

`deliverable.md` (head 80 chars):

> *"I'll start by checking the todo list and then executing the daily relocation ses…"*

Regex check post-hoc:

```
STRONG hit: /^I'll start (by|executing)\b/i  ← MATCHES
SECOND markers found: 1  ["Now I need to"]
```

`todos.json`:

```json
{
  "items": [
    {
      "id": "t1",
      "text": "Use the Write tool to emit deliverable.md…",
      "status": "done",
      "mandatory": true,
      "validation": "deliverable_written"
    },
    { "id": "t2", "status": "done", ... },
    { "id": "t3", "status": "done", "validation": "status_report" }
  ],
  "last_activity": "2026-04-29T01:03:45.293Z"
}
```

**`t1` is `done` with no `validation_attempts` field.** Per `mcp/todo-server.ts:128-146`, a failed validation increments `validation_attempts` and prevents `status` from being set to `"done"`. The absence of `validation_attempts` plus the presence of `status: done` is inconsistent with the validator returning `pass: false` at any point during this run.

### Case 2: `expat-tips-worker/job-a7fdf35a-9ecf-4753-9258-91a67fb132c3/`

Same shape: contaminated deliverable, `t1: done`, no `validation_attempts`. This worker feeds into the morning brief via `debrief-reporter`'s aggregator, so its contamination cascades to the user-facing delivery.

## Hypotheses (none verified — investigation needed)

### H1: Race / out-of-order writes

The worker:
1. Calls `Write` tool with clean content (just the report).
2. Calls `todo_update(t1, status: "done")` → MCP server runs validator → `pass: true` (file is clean at that instant) → marks done.
3. Calls `Edit` tool to PREPEND narration (or simply continues writing into the same file across multiple stream chunks that the framework doesn't re-validate).
4. Final on-disk state: contaminated.

This is plausible but requires the worker to actively edit AFTER marking done — unusual but not impossible.

### H2: Worker bypassing the todo MCP tool

If a code path exists that mutates `todos.json` directly (file write rather than `todo_update`), the validator never runs. Candidates: any tooling that bulk-creates todos at job start, any framework cleanup code that finalizes todos at job end, any cron-style "mark all done if file exists" path.

### H3: Validator runs against the wrong path

`runValidation("deliverable_written", jobDir)` reads `${jobDir}/deliverable.md`. If `jobDir` resolves to a different directory than the worker's actual run dir at validation-time (e.g., the worker writes to a temp dir then moves to `jobDir` after marking done), the validator passes against an empty/clean file while the contaminated one ends up at the final location.

### H4: Validator output is being ignored

Possible if a different code path enforces "mandatory todos must complete" without actually consulting the validator return value. Worth checking whether anything bypasses the `if (!result.pass)` branch in `todo-server.ts:128`.

## Code locations to investigate

1. **`packages/dashboard/src/mcp/todo-server.ts:107-156`** — `todo_update` tool. The validator-enforcement code path. Verify:
   - Validator is actually called.
   - `result.pass` is honored.
   - `validation_attempts` is incremented.
   - The `if (args.status) item.status = args.status` line at ~159 is genuinely after the early-return on validation failure.

2. **`packages/dashboard/src/automations/automation-executor.ts:413`** — where `runValidation` is wired into the executor. Check whether the executor has a parallel todo-mutation path.

3. **`packages/dashboard/src/automations/todo-validators.ts:105-167`** — the validator itself. Verify it reads from `${runDir}/deliverable.md` and that `runDir` resolves correctly across all caller sites.

4. **Any code that reads/writes `todos.json` directly.** Grep for `writeTodoFile` and `JSON.stringify.*items` outside of `todo-server.ts`. If a non-MCP path exists, that's likely H2.

5. **File-modification timestamps.** For a contaminated run, compare:
   - `mtime` of `deliverable.md`
   - `last_activity` in `todos.json`
   - Validator-run timestamp (would need a log-line addition, see below).

## Recommended investigation steps

1. **Add a log line** to `todo-server.ts:127` that prints the validator result (`pass`, `message`, `validation_attempts`). One-line edit. Restart, observe a contaminated run, see what the validator actually returned.

2. **Add a log line** to the worker that records when it Writes/Edits `deliverable.md`. Tells us if the worker is post-validation editing.

3. **Grep for direct `todos.json` mutations** outside the MCP server. Half hour.

4. **Reproduce in a unit test** if possible — construct a worker job, write contaminated content, call the MCP `todo_update`, see if it rejects. This tells us whether the enforcement path works at all in isolation.

5. **If steps 1-4 don't surface the cause**, instrument the validator with a snapshot — log the file content at validation time so a later post-mortem can compare what was on disk at validation vs what's there now.

## Why this is medium severity (not urgent)

- The action-request principle of S4.2 is now (post-fu2) addressed at the trigger/prompt-shape layer. The validator-enforcement gap is upstream — workers produce bad deliverables, validator should reject, framework currently lets them through.
- The fu2 prompt body inlines content directly, so contaminated worker content still reaches the user, but the *delivery turn itself* is no longer narration-prone (no Read tool call). The user experience improves with fu2 even without fixing this bug.
- That said: a half-day investigation now will save weeks of head-scratching on the next "why is contamination still leaking?" thread. Worth scheduling.

## Out of scope

- Tightening the validator regex further (already widened in fu1).
- Architectural redesign of how todos are tracked.
- Migrating non-MCP todo paths to the MCP server (that's H2 territory and could be a follow-up if H2 is confirmed).

## References

- Soak Day-2 case report: [`../sprints/m9.4-s4.2-action-request-delivery/soak-day-2.md`](../sprints/m9.4-s4.2-action-request-delivery/soak-day-2.md) §Factor (b)
- Soak Day-2 follow-up plan: [`../sprints/m9.4-s4.2-action-request-delivery/soak-day-2-followup-plan.md`](../sprints/m9.4-s4.2-action-request-delivery/soak-day-2-followup-plan.md) §"Out of scope"
- M9.4-S4.2 plan v3 (the original validator design): [`../sprints/m9.4-s4.2-action-request-delivery/plan.md`](../sprints/m9.4-s4.2-action-request-delivery/plan.md) §Task 5
- M9.4-S4.2 fu1 plan (regex widening, separate from enforcement): [`../sprints/m9.4-s4.2-action-request-delivery/soak-day-1-followup-plan.md`](../sprints/m9.4-s4.2-action-request-delivery/soak-day-1-followup-plan.md) §Task 2
