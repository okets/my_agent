---
date: 2026-04-30
phase: 2 of 3 (mechanism inventory; precedes worker-pipeline-redesign.md)
input_to: worker-pipeline-redesign.md (Phase 3 design proposal)
---

# Worker Pipeline — Mechanism Inventory

## Scope

Every place in the codebase that writes, reads, validates, or has expectations about `deliverable.md` and the worker output contract. Surface the conflicts so Phase 3 can pick a single path.

## Writers — what creates/mutates deliverable.md on disk

| File:line | Code | When | Source of content |
|---|---|---|---|
| (worker, via SDK Write tool) | n/a — SDK call | During worker run | Worker model directly emits content |
| `automation-executor.ts:619` | `fs.writeFileSync(deliverablePath, finalDeliverable)` | After worker run completes; only if worker's file is missing OR doesn't start with `---` | `extractDeliverable(response).deliverable ?? .work` — model's full response stream |
| `automation-executor.ts:659` | `fs.writeFileSync(deliverablePath, finalDeliverable)` | After post-run chart augmentation appends `![chart](url)` | Worker's content + chart link |
| `automation-executor.ts:277` | `fs.writeFileSync(handlerDeliverablePath, result.deliverable)` | For handler-based automations (e.g. `debrief-reporter`) | Handler's structured return |

**Three independent writers in production code.** The worker writes via Write tool. The executor's fallback writes the model response. The chart augmentation appends. The handler-path writes a handler return.

## Readers — what consumes deliverable.md

| File:line | Purpose | Format expected |
|---|---|---|
| `automation-executor.ts:613-617` | Decide whether to preserve worker's version | Looks for `startsWith("---")` (YAML frontmatter) |
| `summary-resolver.ts:50` | Resolve `n.summary` for action-request prompt | Strips frontmatter via `stripFrontmatter()`; treats both formats as equivalent |
| `scheduler/jobs/handler-registry.ts:367-369` | debrief-reporter aggregator | Strips frontmatter; treats both formats as equivalent |
| `routes/automations.ts:197` | `/api/automations/:id/jobs/:id` API consumer | Returns raw content; no format assumption |
| `core/capabilities/recovery-orchestrator.ts:771-774` | Read capability recovery outcome | Reads YAML frontmatter (`change_type`, `test_result`) |
| `todo-validators.ts:105-167` (`deliverable_written`) | Worker-runtime validation | Strips frontmatter; checks body length + narration heuristic |
| `todo-validators.ts:47-64` (`completion_report`) | Worker-runtime validation | **Requires** frontmatter with `change_type` |
| `todo-validators.ts:66-83` (`test_executed`) | Worker-runtime validation | **Requires** frontmatter with `test_result` |
| `todo-validators.ts:125-138` (`change_type_set`) | Worker-runtime validation | **Requires** frontmatter with `change_type` |

**Mixed expectations.** Some readers require frontmatter; others strip it; the validator-set is split.

## Templates — what tells workers how to emit deliverable.md

`packages/dashboard/src/automations/todo-templates.ts`:

| Template `job_type` | Worker instruction | Validator attached |
|---|---|---|
| `capability_build` | "Write deliverable.md with YAML frontmatter (change_type, test_result, summary)" | `completion_report`, `test_executed`, `capability_frontmatter` |
| `capability_modify` | "Identify change type — write to deliverable.md frontmatter as change_type" + "Write deliverable.md with YAML frontmatter (change_type, test_result, summary)" | `completion_report`, `change_type_set`, `test_executed` |
| `generic` | "Use the Write tool to emit deliverable.md with your final findings and output … emit the report only. Final step." | `deliverable_written` |
| `research` | (same as generic) | `deliverable_written` |

**Two opposing contracts shipped in the same templates file:**

- **capability_build, capability_modify** → MUST have frontmatter. Validators parse YAML.
- **generic, research** → "emit the report only" — explicitly NO frontmatter mentioned. Validator only checks body length + narration heuristic.

## The contradiction at the executor layer

`automation-executor.ts:605-621`:

```typescript
// Write deliverable.md to run_dir — but preserve the worker's version if it has
// valid frontmatter (workers write structured deliverables with metadata that
// validators check; the extracted stream text would overwrite that).
let deliverablePath: string | undefined;
let finalDeliverable = deliverable ?? work;
if (job.run_dir) {
  deliverablePath = path.join(job.run_dir, "deliverable.md");
  const workerWroteDeliverable =
    fs.existsSync(deliverablePath) &&
    fs.readFileSync(deliverablePath, "utf-8").startsWith("---");
  if (workerWroteDeliverable) {
    finalDeliverable = fs.readFileSync(deliverablePath, "utf-8");
  } else if (finalDeliverable) {
    fs.writeFileSync(deliverablePath, finalDeliverable, "utf-8");
  }
}
```

The executor preserves the worker's file ONLY IF it starts with `---`. This works for `capability_*` workers (frontmatter required by template) but **silently corrupts** `generic`/`research` workers (template forbids frontmatter).

**Specifically, for `daily-relocation-session` and `debrief-reporter`'s aggregated workers** (all `generic` or `research` job_type):

1. Worker writes plain markdown → no `---` prefix → executor reads `workerWroteDeliverable === false`
2. Executor falls through to `else if (finalDeliverable)` branch
3. `finalDeliverable = deliverable ?? work` — where `deliverable` is the `<deliverable>...</deliverable>`-tagged content (almost always null in modern templates) and `work` is the **entire model response stream**
4. The full response stream begins with the model's pre-tool-call thinking ("I'll start by checking the todo list…") — exactly the narration the validator was supposed to reject
5. `fs.writeFileSync(deliverablePath, finalDeliverable)` — clean worker output overwritten with stream text

## The validator timing gap

The `deliverable_written` validator runs **inside `todo_update(t1, "done")`** at `mcp/todo-server.ts:127`. Its read happens **during** the worker run, not after.

- Time T0: worker writes clean deliverable.md
- Time T1: worker calls `todo_update(t1, "done")` → validator reads → passes → status set to done
- Time T2: worker run completes
- Time T3: executor's auto-write block runs → reads file (still clean per T0) → checks `startsWith("---")` → false → overwrites
- Time T4: heartbeat fires later → reads contaminated content from T3

The validator has no visibility into T3. It validated content the heartbeat never sees.

## The legacy `<deliverable>` tag pattern

`deliverable-utils.ts:9-20`:

```typescript
export function extractDeliverable(response: string): {
  work: string;
  deliverable: string | null;
} {
  const match = response.match(/<deliverable>([\s\S]*?)<\/deliverable>/);
  if (match) {
    const deliverable = match[1].trim();
    const work = response.replace(match[0], "").trim();
    return { work, deliverable: deliverable || null };
  }
  return { work: response, deliverable: null };
}
```

No modern template tells the worker to use `<deliverable>` tags. Greps confirm: zero references in current `todo-templates.ts` to `<deliverable>` syntax. This is a contract from a previous architecture that has been silently retired in the templates but still exists in the executor's fallback path. **It never fires intentionally** — when modern workers emit content, they don't wrap it in tags. The fallback only ever uses `work` (full response).

## The handler-based path (a third worker contract)

`automation-executor.ts:276-284` shows there's a SEPARATE flow for handler-based automations (e.g. `debrief-reporter`):

```typescript
handlerDeliverablePath = path.join(job.run_dir, "deliverable.md");
fs.writeFileSync(handlerDeliverablePath, result.deliverable, "utf-8");
```

Handlers return a `deliverable` field directly from code. No model involvement. The executor writes whatever the handler returned. **No contamination possible** — but also no validation enforced. (debrief-reporter aggregates worker outputs, so it inherits worker contamination upstream.)

## Conflict #4 — Template todo order vs prompt cadence rule

`automation-executor.ts:1115` (worker system prompt, "Progress Cadence" section):

> *"**The last tool call before writing `deliverable.md` MUST be `todo_done` on your final step.**"*

This says: do all todos → mark them done → write deliverable.md last.

But the `generic`/`research` template's t1 says:

> *"Use the Write tool to emit deliverable.md … **Final step**: this should be the last thing you write before marking done."*

This says: write deliverable.md → then mark t1 done.

**These are opposite orderings.** The prompt's order has the worker calling `todo_done` BEFORE the file exists, which is exactly what triggers `validation_attempts: 1` (validator can't find the file → fails → worker pivots to writing the file → second `todo_done` call passes).

This is the most likely explanation for why `validation_attempts: 1` appears in `t1` in every contaminated run we've inspected. The worker is following the prompt's rule (which contradicts t1's text) and getting rejected once, then recovering.

The validator is doing its job. The conflicting instructions just inflate `validation_attempts` cosmetically — they don't cause the contamination. (The contamination is still Conflict #1: executor's overwrite.)

## Active workers — what's actually shipping today

Audit of `~/my_agent/.my_agent/automations/*.md` with `status: active`:

| Worker | job_type | Contract | Affected by executor overwrite? |
|---|---|---|---|
| `chiang-mai-aqi-worker` | (unspecified → generic) | B | YES |
| `chiang-mai-events-worker` | (unspecified → generic) | B | YES |
| `coworking-spaces-chiang-mai` | research | B | YES |
| `daily-relocation-session` | (unspecified → generic) | B | YES |
| `debrief` | (unspecified → generic) | B | YES |
| `debrief-reporter` | (unspecified → generic) | C (handler) | NO (handler-path, distinct flow) |
| `expat-tips-worker` | (unspecified → generic) | B | YES |
| `project-status-worker` | (unspecified → generic) | B | YES |
| `system-daily-summary` | (unspecified → generic) | B | YES |
| `thailand-news-worker` | (unspecified → generic) | B | YES |

**Zero active automations use Contract A.** `capability_build` / `capability_modify` workers exist in `_archive/` only (the 26 `cfr-fix-*` and 3 `build-*-capability` automations archived in S4.2-fu1). The frontmatter-required code path is **dormant in production today.**

This is a strong data point for Phase 3: the `startsWith("---")` gate in the executor protects nothing real, while corrupting 9 of 9 active model-driven workers (all Contract B). The handler-driven `debrief-reporter` is unaffected directly but inherits contamination from its 5 upstream workers.

## Conflict summary

Three contracts shipping in one codebase:

| Contract | Workers using it | Frontmatter? | Validator | Executor preserves worker file? |
|---|---|---|---|---|
| **A: capability_*** | `capability_build`, `capability_modify` | REQUIRED | YAML-aware | Yes (`startsWith("---")`) |
| **B: generic/research** | `daily-relocation-session`, `chiang-mai-aqi-worker`, `expat-tips-worker`, `chiang-mai-events-worker`, `thailand-news-worker`, `project-status-worker`, `coworking-spaces-chiang-mai`, etc. | FORBIDDEN ("emit the report only") | Body-only (length + narration) | **No** — gets overwritten |
| **C: handler-based** | `debrief-reporter` | n/a (code-driven) | n/a | Wrote directly by handler |

Plus a fourth retired-but-still-wired path:
- **D: `<deliverable>` tags** — referenced nowhere in templates, exists only as the executor's fallback that never fires intentionally

## Other artifacts in run dir (for context)

Each worker run dir typically contains:

| File | Writer | Purpose |
|---|---|---|
| `CLAUDE.md` | Executor (job context header) | Tells worker its job_id + automation name |
| `deliverable.md` | (the conflict zone — see above) | User-facing output |
| `status-report.md` | Worker (via Write tool) | Internal post-mortem (validators check) |
| `todos.json` | MCP `todo_*` tools | Worker-runtime task tracking |

## What this points at for Phase 3

Three options to consider, in order of cleanliness (pre-production, no backcompat constraints):

1. **Drop the auto-write fallback entirely.** Modern templates require the worker to write deliverable.md (Contract B says so explicitly; Contract A's templates also tell the worker to write). The fallback never fires intentionally. If the file isn't there at the end of the worker run, that's a job failure — fail loud, don't silently fabricate.

2. **Pick ONE format for all workers.** Either everyone uses frontmatter (drop Contract B's "emit the report only" instruction; teach generic/research workers to write `---\n<yaml>\n---\n<body>`) OR no one does (drop Contract A's frontmatter-required validators; rewrite capability_* validators to read structured data from a dedicated metadata file instead of the deliverable's frontmatter).

3. **Delete the `<deliverable>` tag legacy.** `extractDeliverable` and `validateDeliverable` in `deliverable-utils.ts` are unreferenced by current templates. Modern workers don't wrap in tags. Remove the function; remove the import from `automation-executor.ts`; the file goes away.

(1) and (3) are independent and both clearly correct. (2) is the bigger architectural decision — Phase 3 should propose a concrete answer.

## What's still pending (Phase 1 subagent)

The history investigation is running in parallel — when did Contract A get split from Contract B, when did the fallback drift from intentional to silent-corruption, when did the user-facing failure become visible. That history will inform whether option 2's "pick one format" should lean toward A or B.
