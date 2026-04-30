---
date: 2026-04-30
status: proposal
phase: 3 of 3 (synthesis of mechanism-inventory + history)
inputs:
  - worker-pipeline-mechanism-inventory.md
  - worker-pipeline-history.md
prepared_for: CTO + team review before implementation
---

# Worker Pipeline — Redesign Proposal

## What this proposes

A single, aligned contract for how workers produce `deliverable.md`, and a corresponding cleanup of the framework's reading/writing/validation paths. Pre-production scope — no backwards-compatibility constraints, all current workers fixable in-place if needed.

## TL;DR

1. **One worker contract:** worker emits `deliverable.md` directly via the Write tool. Plain markdown. No XML tags, no required frontmatter. Validator enforces no-narration before the job completes. **No executor-side rewriting of the file, ever.**

2. **Structured metadata moves to a sidecar file:** `result.json` next to `deliverable.md`. Capability-build/modify workers populate `result.json` with `change_type`, `test_result`, etc. The deliverable stays a clean user-facing markdown artifact. Validators that need structured fields read from `result.json`; validators that check the user-facing content read `deliverable.md`.

3. **Delete the legacy code:** `extractDeliverable`, `validateDeliverable` (the unused string-tag version), `<deliverable>...</deliverable>` parsing, the `startsWith("---")` guard, and the entire `automation-executor.ts:605-621` overwrite block.

4. **Resolve the prompt-vs-template ordering contradiction:** template's t1 wins. Worker writes `deliverable.md` first (Write tool), then calls `todo_done(t1)`. The "Progress Cadence" prompt's "last tool call must be `todo_done`" rule was written for an earlier contract that has been superseded.

5. **Migration plan:** zero `capability_*` automations are active in production. The 2 active `notify: immediate` workers (`daily-relocation-session`, `coworking-spaces-chiang-mai`) and 7 brief-feeder workers are all `generic`/`research`. The redesign covers all of them with no manifest changes (templates already say "emit the report only" — that's now the single rule).

## The single contract

```
┌──────────────────────────────────────────────────────────────────────┐
│ Worker contract (the only contract)                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  At job runtime, the worker MUST:                                    │
│                                                                      │
│  1. Use the Write tool to emit `${run_dir}/deliverable.md`.          │
│     Plain markdown. No frontmatter. No XML tags.                     │
│     The content of this file IS what the user sees.                  │
│                                                                      │
│  2. Call `todo_done(<deliverable-todo-id>)` AFTER writing            │
│     deliverable.md. The MCP tool runs the `deliverable_written`      │
│     validator at this point. If validation fails, the worker is      │
│     told to fix the file and retry. After 3 fails, the todo is       │
│     marked `blocked` and the job fails loud.                         │
│                                                                      │
│  3. Optionally write `${run_dir}/result.json` with structured        │
│     metadata (capability-build/modify workers do this; brief         │
│     workers don't need to). The framework reads `result.json` for    │
│     telemetry and downstream pipeline decisions; it never appears    │
│     in the user-facing delivery.                                     │
│                                                                      │
│  Once the worker run completes, the framework treats whatever is     │
│  on disk in `${run_dir}/deliverable.md` as the source of truth.      │
│  No extraction, no merging, no overwriting.                          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## What stays

| Component | Status | Notes |
|---|---|---|
| `Write` tool in worker MCP | UNCHANGED | The way workers emit content |
| `todo_update`/`todo_done` MCP tool | UNCHANGED | Validator-enforcement path stays load-bearing |
| `deliverable_written` validator (regex-based, fu1-widened) | UNCHANGED | Catches narration; runs at todo-completion time |
| `summary-resolver.ts` (reads `deliverable.md` from disk) | UNCHANGED | The reading contract is correct; just trust the file |
| `formatNotification.job_completed` (fu2 inline-content prompt body) | UNCHANGED | Reads `n.summary` which comes from summary-resolver |
| `handler-registry.ts` (handler-based automations like `debrief-reporter`) | UNCHANGED for now — see "Open question" below |
| `notify: immediate` / `notify: debrief` flag semantics | UNCHANGED |
| Action-request routing (M9.4-S4.2 core) | UNCHANGED |
| Standing-orders Conversation Voice rule | UNCHANGED |

## What goes

| Component | Action | Why |
|---|---|---|
| `automation-executor.ts:605-621` (the auto-write overwrite block) | **DELETE** | This is the bug. Worker's file is the source of truth; no rewriting. |
| `automation-executor.ts:603` (`extractDeliverable(response)` call) | **DELETE** | The `<deliverable>` tag contract is dead. |
| `packages/dashboard/src/automations/deliverable-utils.ts` (`extractDeliverable`, `validateDeliverable`) | **DELETE** | Unreferenced after the executor change. The tag-based contract has been silently retired since Apr 1; finishing the job. |
| `automation-executor.ts:649-672` (post-run chart augmentation block) | **MOVE** to a worker-runtime tool | Currently appends `![chart](url)` to deliverable.md after the worker run completes. This is another implicit overwrite — the worker doesn't see the appended chart. Replace with a `chart_tools.append_to_deliverable` MCP call the worker invokes during its run, or have the worker include the `![chart](url)` itself when it writes deliverable.md. (Workers already use `chart_tools.create_chart` to generate the SVG; getting the URL inlined is a one-tool-call add for the worker.) |
| `automation-executor.ts:1115` (prompt rule: *"last tool call before writing deliverable.md MUST be todo_done on your final step"*) | **DELETE** | Contradicts the t1 todo text. Resolves Conflict #4. |
| Capability-validator dependency on `deliverable.md` frontmatter (`completion_report`, `test_executed`, `change_type_set`) | **REWRITE** to read `result.json` instead | Frontmatter-in-deliverable was always conflating user-facing content with telemetry. Sidecar JSON is the right shape. |
| Templates `capability_build` / `capability_modify` instruction text *"write deliverable.md with YAML frontmatter (change_type, test_result, summary)"* | **REWRITE** to *"write deliverable.md as plain markdown for the user, then write result.json with {change_type, test_result, summary}"* | Aligns capability workers with the single-path contract |

## What changes

### `automation-executor.ts` (the load-bearing edit)

Replace the entire overwrite block with a presence check + fail-loud:

```typescript
// 7. Worker run complete. The worker MUST have written deliverable.md
//    via the Write tool. We do not extract, merge, or overwrite — the
//    on-disk file is the source of truth from this point forward.
let deliverablePath: string | undefined;
if (job.run_dir) {
  deliverablePath = path.join(job.run_dir, "deliverable.md");
  if (!fs.existsSync(deliverablePath)) {
    // Worker failed to produce a deliverable. Fail loud — do NOT fabricate
    // one from the response stream. The validator should have caught this
    // at todo-completion time; if it didn't, that's a worker bug to surface.
    throw new Error(
      `Worker did not write deliverable.md to ${job.run_dir}. ` +
      `Check todos.json for validation_attempts; the worker likely skipped ` +
      `or short-circuited the deliverable-emit step.`,
    );
  }
}
if (unsubscribe) unsubscribe();
```

That's it. ~10 lines instead of the current 20+.

### Validators

`todo-validators.ts`:

- **`deliverable_written`**: keep as-is. Body-content regex.
- **`completion_report`**: REWRITE to read `${runDir}/result.json` and check `change_type` field.
- **`test_executed`**: REWRITE to read `${runDir}/result.json` and check `test_result` field.
- **`change_type_set`**: REWRITE to read `${runDir}/result.json` and check `change_type` field.
- **`capability_frontmatter`**: UNCHANGED (this validates `CAPABILITY.md` in the target dir, not `deliverable.md`; orthogonal).
- **`status_report`**: UNCHANGED (validates `status-report.md`, not `deliverable.md`).

### Worker templates

`todo-templates.ts`:

- **`generic`**: UNCHANGED (already aligned with the single contract).
- **`research`**: UNCHANGED.
- **`capability_build`** and **`capability_modify`**: rewrite the deliverable-related todos:

  ```diff
  -  text: "Write deliverable.md with YAML frontmatter (change_type, test_result, summary)"
  +  text: "Use the Write tool to emit deliverable.md as plain markdown for the user (the change summary, what to do next). Then write result.json with {change_type, test_result, summary} for framework telemetry."
     mandatory: true
     validation: "completion_report"
  ```

  And drop the *"write to deliverable.md frontmatter as `<field>`"* phrasing from earlier todos in the same templates.

### Worker prompt (Progress Cadence section)

`automation-executor.ts:1088-1129`:

- DELETE the line: *"**The last tool call before writing `deliverable.md` MUST be `todo_done` on your final step.**"*
- REPLACE with: *"**Write `deliverable.md` first (via Write tool), then call `todo_done` on the deliverable-emit step.** The validator runs when you mark the step done — it reads the file you just wrote, so the file must exist first."*

### Handler-based automations (Contract C)

The current `debrief-reporter` handler at `automation-executor.ts:276-284` writes `result.deliverable` directly to `deliverable.md`. Two options:

- **Keep as-is.** Handlers are code, not models, so they don't suffer narration contamination. The current write path is correct for handlers. Document the distinction: handlers write `deliverable.md` themselves; the executor doesn't read or modify it.
- **Have handlers also write to disk explicitly via fs.writeFileSync (no `result.deliverable` field).** Removes one mechanism. Slight code reorganization for handler-registry.

Recommendation: **keep as-is** for now. Handler runs are deterministic; the contamination problem is model-driven. Revisit if a future handler returns model-generated content.

### Conflict #4 resolution

Template t1 says: write deliverable.md, then mark done. The prompt says: mark done, then write deliverable.md. Pick template t1 — it matches what the validator can actually verify (the file must exist when the validator runs against it). Update the prompt to match.

## Migration plan

**Pre-production reality check** (per inventory):

- 9 of 9 active model-driven workers use Contract B (no frontmatter). The redesign default-aligns with their existing template. **Zero manifest changes required.**
- Zero active capability-build/modify workers. The capability workers in `_archive/` (the cfr-fix-* and build-* sets archived in S4.2-fu1) are dormant; if revived, they'll need to be migrated to the new structured-metadata sidecar shape — but that's a forward decision, not a backport.
- Handler automations (`debrief-reporter`) keep their current shape.
- One `notify: immediate` worker (`daily-relocation-session`) is the canonical test case for tomorrow's morning soak. The `coworking-spaces-chiang-mai` is on-demand only.

**Order of changes:**

1. Land the executor delete (the load-bearing edit). Tests will need updating where they assert about post-run deliverable.md content — those tests are exercising the bug, so the fix is to update the expectation.
2. Delete `deliverable-utils.ts`. Update all imports (only one in production code: `automation-executor.ts`).
3. Update `capability_build` / `capability_modify` templates + their validators (parallel work; doesn't gate the live morning brief fix).
4. Move chart augmentation to a worker-runtime tool. (Or accept it as a known follow-up — see "Out of scope" below.)
5. Update Progress Cadence prompt section.
6. Run the fast-iteration probe (5x PASS) on the new code path.
7. Soak it for one morning brief + one relocation session.

Steps 1, 2, 5, 6, 7 are the critical path for tomorrow's soak. Steps 3, 4 are forward improvements.

## Risk + rollback

Pre-production. No backcompat. Worst case is a worker runs and produces no `deliverable.md`, and the executor throws — that's a job failure with a clear error message, much better than silently corrupting content. Rollback is `git revert`.

The validator regex (fu1) and the action-request prompt body (fu2) remain unchanged. Their test coverage stays in place. The redesign reduces coupling — fewer code paths means fewer edge cases.

## Open questions for the team

1. **Chart augmentation:** worker-runtime tool, or worker writes the chart URL itself in deliverable.md? Either works. The current post-run append is the third overwrite mechanism in the same file and will continue to bite if not addressed.

2. **Handler-driven automations:** keep `result.deliverable` field (handler returns content, executor writes), or have handlers write directly via fs.writeFileSync (one mechanism, not two)? Stylistic choice; no contamination risk either way.

3. **Sidecar metadata format:** `result.json` (proposed) or `result.yaml` or `metadata.yaml` (consistent with existing `CAPABILITY.md` pattern)? Project's "normalized metadata standard" (CLAUDE.md reference) says YAML frontmatter for markdown files; this is a JSON sidecar to a markdown file, slightly different shape. JSON is more typed. Either works.

4. **Validator at end of run (defense in depth):** post-redesign, the executor knows the worker MUST have written deliverable.md. Should it ALSO run `runValidation("deliverable_written", run_dir)` one more time at job-end, as a final gate before the job is marked complete? Cheap (regex check on a small file) and would catch any worker that managed to bypass the todo-server (Hypothesis H2 from the bug record). Recommendation: yes. One extra validator call.

## Out of scope

- The `validation_attempts: 1` cosmetic in `todos.json` (the worker's first attempt fails because the file doesn't exist yet — see Conflict #4). Resolving Conflict #4 fixes this naturally.
- Touching `m9.4-s4.2-action-request-delivery` sprint scope. fu2 is sound. This redesign is downstream framework cleanup; it MAKES fu2 actually take effect on the user-facing delivery surface.
- Migrating archived `cfr-fix-*` automations to the new contract. They're disabled and one-off; if revived, they'll need a one-time conversion.

## Done state

After this lands:

- Worker writes `deliverable.md` via Write tool, plain markdown.
- Validator enforces no-narration at todo-completion time.
- Job runs to completion. Executor checks file exists. If not, fail loud.
- Heartbeat reads `deliverable.md` from disk via summary-resolver.
- `formatNotification.job_completed` inlines the resolved content (fu2).
- Nina renders cleanly, no Read narration (fu2 prompt structure), no contamination (this redesign).

One contract. One write path. One read path. One validator path. The validator's verdict at todo-completion time is what the user sees, because nothing rewrites the file after.

## References

- Phase 1 input: [`worker-pipeline-history.md`](worker-pipeline-history.md)
- Phase 2 input: [`worker-pipeline-mechanism-inventory.md`](worker-pipeline-mechanism-inventory.md)
- Original bug record: [`docs/bugs/2026-04-29-validator-enforcement-gap.md`](../../bugs/2026-04-29-validator-enforcement-gap.md)
- Soak Day-3 surfaced this: [`soak-day-2.md`](soak-day-2.md) §Factor (b) was the hint; today's analysis confirmed it
- M5-S9 origin commit: `7191d9e`
- Drift point 1: `f4f5d83` (Apr 1, the unsignaled abandonment of the XML contract)
- Drift point 2: `697ab41` (Apr 6, the frontmatter guard built for a different contract)
- Drift point 3: `cacba19` (Apr 10, generic/research templates added without updating the executor)
