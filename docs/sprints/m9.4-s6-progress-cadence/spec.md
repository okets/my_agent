---
sprint: M9.4-S6
title: Progress Cadence — Methodical Worker Rhythm
status: spec (v1)
created: 2026-04-12
origin: M9.4-S5 FOLLOW-UPS.md UX-2
related_sprints:
  - M9.4-S3 (job progress card)
  - M9.4-S5 (job card handoff continuity)
---

# M9.4-S6: Progress Cadence — Methodical Worker Rhythm

## Problem

During the closing smoke test for M9.4-S5 (CNN automation, 2026-04-12), the CTO observed that the progress card sat at `0/3` for 20–30 seconds while the worker was visibly doing real work (browser opening, navigating, taking a screenshot). The counter eventually jumped from `0/3` directly to `2/3` or `3/3` — the worker batched its `todo_in_progress` / `todo_done` tool calls retroactively instead of narrating progress in real time.

The progress card is faithful: when the worker calls the todo MCP tool, the UI updates. The bug is purely on the worker's side — it does work first, reports second.

## Root cause

The progress card's premise is "continuous activity feedback." Today, the worker alone decides when progress is reported. There is no architectural guarantee; delivery depends on the model's discretion. Sonnet's default behavior is to batch tool calls, which collides with the premise.

## Approach

**Strong prompting at the tail of the system prompt.** No hooks, no PostToolUse inference, no framework policing. Instead: a compact "Progress Cadence" section appended at the very end of the worker's system prompt that (a) explains why methodical narration matters, (b) gives the exact rhythm, (c) inlines the worker's specific todos so rules and content are physically adjacent, (d) names the common anti-patterns.

The positioning — last section of the system prompt — is deliberate. Recency improves compliance; autonomy instructions already sit at the tail for this reason.

**This is a prompt sprint. No structural code changes, no new hooks, no UI changes, no MCP tool changes.** The only code change is inlining todos into the prompt text, which requires a small refactor to pass `todoItems` into `buildAutomationContext`.

## Why not a blocking hook (Y) or tool-use inference (Approach 1)

- **Blocking PreToolUse hook:** enforces the contract mechanically, but adds turn-cycle friction on every violation, requires a whitelist of "exploratory" tools that drifts, and can be gamed (worker marks step 1 in progress and does all work under it). Not a root cause fix — just relocates the problem.
- **PostToolUse tool-use inference:** duplicates what the todo MCP tool already does (tool already advances the bar when called). Adds a second mechanism with heuristic mappings that can misfire. Not root cause.
- **Strong prompting (this sprint):** treats the worker as a cooperating agent who can internalize rhythm. Compliance is stochastic, but the expected behavior matches the architecture — progress reporting *is* the worker's responsibility, and better prompts help the worker do it well.

If prompt-only compliance proves insufficient after this sprint's smoke test, we revisit. For now, this matches the "no hacks, proper root cause fix" direction: the architecture doesn't change, the worker gets the clarity it needs to comply.

## Design

### D1. System prompt assembly — append Progress Cadence as final section

In `packages/dashboard/src/automations/automation-executor.ts`, `buildAutomationContext()` currently assembles four sections: Automation instructions, Space manifests, Trigger Context, Autonomy instructions. The system prompt is:

```
[buildWorkingNinaPrompt — global]
  +
[automationContext:
  ## Automation: <name> + instructions
  ### Space: ... (0-N)
  ## Trigger Context (if any)
  ## Autonomy: <level>
]
```

**Change:** append a fifth section, `## Progress Cadence`, *after* autonomy, so it is the very last block in the system prompt. The section inlines the worker's todos and the rhythm rules.

### D2. Refactor: pass `todoItems` into `buildAutomationContext`

Today, `buildAutomationContext` is built at line 274 of `automation-executor.ts`, *before* todo assembly (line 298–314). To inline todos, todo assembly must happen first.

Move this block:

```typescript
const todoPath = job.run_dir
  ? path.join(job.run_dir, "todos.json")
  : null;
const jobType = this.detectJobType(automation);
const todoItems = assembleJobTodos(automation.manifest.todos, jobType);
if (todoPath) {
  if (todoItems.length > 0) {
    writeTodoFile(todoPath, {
      items: todoItems,
      last_activity: new Date().toISOString(),
    });
  } else {
    createEmptyTodoFile(todoPath);
  }
}
```

To run *before* `buildAutomationContext(...)`. Then pass `todoItems` as a new argument:

```typescript
const automationContext = this.buildAutomationContext(
  automation,
  spaces,
  triggerContext,
  todoItems,  // NEW
);
```

Update `buildAutomationContext` signature and body to accept `todoItems: TodoItem[]` and append the new Progress Cadence section when `todoItems.length > 0`.

The existing workerMcpServers `todo` wiring (which currently does its own `assembleJobTodos` + `writeTodoFile`) must not duplicate that work — consolidate so todos are assembled once.

### D3. Progress Cadence prompt text

The section text is fixed (not templated per automation, beyond the todo list itself). Exact text:

```
## Progress Cadence (read last — this matters)

You have a todo list. The human watching this job sees a progress card that
updates whenever you call the todo MCP tool. If you do work without calling
the tool, the card sits silent — and silence feels like the job crashed.

Narrating your progress is not a UI obligation. It is how methodical work
looks. Announce each step, do it, close it, move to the next.

**Your steps for this job:**
{inlined todo list — see format below}

**The rhythm — apply it for every step:**
1. Call `todo_in_progress(<id>)` — BEFORE any other tool call for that step.
2. Do the work for that step.
3. Call `todo_done(<id>)` — IMMEDIATELY when the step is finished.
4. Repeat for the next step.

**The first tool call of this job MUST be `todo_in_progress` on your first step.**
Not `Read`, not `Bash`, not `browser_*`, not a capability tool. `todo_in_progress`.

**The last tool call before writing `deliverable.md` MUST be `todo_done` on your final step.**

**Anti-patterns — do not do these:**
- Do **not** batch todo updates at the end. Calling `todo_done` on three steps
  in a row after all work is finished defeats the purpose.
- Do **not** mark a step done before its work is actually complete.
- Do **not** skip the `todo_in_progress` step because a task seems quick.
  Quick steps still get announced.
- Do **not** mark multiple steps in_progress simultaneously. One step at
  a time.

If you find yourself about to call a non-todo tool and your most recent
todo call was `todo_done` (or there has been no todo call yet), pause —
you owe a `todo_in_progress` first.
```

### D4. Inlined todo list format

In the section above, `{inlined todo list}` expands to a bulleted list of the worker's actual todos, with IDs, in the order they'll be executed:

```
- [id: {item.id}] {item.text}
```

Example (CNN automation):

```
- [id: research] Research latest CNN homepage structure
- [id: screenshot] Take screenshot of cnn.com homepage
- [id: report] Write deliverable with observations
```

If `todoItems.length === 0` (handler-dispatched or manifest-less jobs), the Progress Cadence section is omitted entirely. Those jobs have no todos to narrate.

### D5. Global worker prompt (`working-nina-prompt.ts`) — no changes

The principle is that this guidance lives *once*, at the tail of the system prompt, close to the task. Do not duplicate into the global prompt. Single source of truth.

## Out of scope

- Blocking hook enforcement (PreToolUse / PostToolUse).
- Tool-use-to-todo inference.
- UI "Starting…" fallback.
- Todo MCP tool changes.
- Progress card template changes.
- F6 status-specific labels (deferred from M9.4-S5).
- Intra-step progress (finer granularity *within* a single todo item).

## Acceptance criteria

1. **Smoke-test gate (α).** After merge, CTO runs the CNN automation (`screenshot-cnn-homepage` or equivalent). Observed behavior: the progress counter advances from `0/N` to `1/N` within ~5 seconds of job start — no extended silent period before the first step reports as in_progress. Pass/fail, single run, CTO's eyes are the judge. Recorded in `test-report.md` under "Closing smoke test."

2. **Progress Cadence section is the last block of the system prompt.** Verified by unit test: for a sample automation with todos, the generated system prompt's last non-whitespace section starts with `## Progress Cadence`.

3. **Todos inlined in the prompt.** Verified by unit test: for a sample automation with 3 todos (ids `a`, `b`, `c` with texts `T1`, `T2`, `T3`), the generated system prompt contains `- [id: a] T1`, `- [id: b] T2`, `- [id: c] T3` in that order, inside the Progress Cadence section.

4. **No Progress Cadence section for todo-less jobs.** Verified by unit test: for a handler-dispatched automation (manifest with `handler:` set), the generated system prompt does not contain `## Progress Cadence`.

5. **No regression in existing automation execution.** All existing `automation-executor` and related unit/integration tests still pass. CNN automation end-to-end still produces a valid deliverable.

6. **No structural changes.** Grep confirms no new hook entries, no new MCP tools, no new UI components added in this sprint's diff. Only the prompt assembly changes.

## Test plan

| Test | Type | Location |
|------|------|----------|
| Progress Cadence section appears last | unit | `packages/dashboard/tests/unit/automations/automation-executor.test.ts` (extend, or create `progress-cadence.test.ts`) |
| Todos inlined in order with IDs | unit | same file |
| Section omitted for handler jobs | unit | same file |
| Section omitted when `todoItems.length === 0` | unit | same file |
| Existing `buildAutomationContext` tests | unit | unchanged, must still pass |
| CNN automation end-to-end produces valid deliverable | integration | existing test (verify no regression) |
| CTO smoke test (counter advances to 1/N within ~5s) | manual | `test-report.md` closing section |

## Files touched (estimate)

- `packages/dashboard/src/automations/automation-executor.ts` — reorder (todo assembly before `buildAutomationContext`), extend `buildAutomationContext` signature, add Progress Cadence section builder.
- Tests: new or extended unit tests under `packages/dashboard/tests/unit/automations/`.

Estimated diff: ~150-200 lines of code (most of which is the prompt text itself as a template string).

## Risks / open questions

- **Compliance ceiling.** Prompt-only is stochastic. Even with strong prompting, expect 85–95% compliance — not 100%. If the CTO smoke test shows the counter still sits at 0/N, we iterate on the prompt text before concluding prompting alone is insufficient. Only if multiple iterations fail do we escalate to a blocking hook.
- **Prompt text tuning.** The exact wording in D3 is a starting point. If smoke test compliance is low, expect 1-2 tuning passes. We should treat the wording as a live knob, not a one-shot.
- **Anti-pattern "paused" clause.** The last paragraph ("If you find yourself about to call a non-todo tool...") asks the worker to introspect. Sonnet can do this inconsistently. Low-risk — worst case it's ignored; best case it catches the batching failure mode. Keep it; it's cheap.
- **Worker discovers todos today via `todo_read` MCP tool call.** After this sprint, todos are inlined in the system prompt AND still readable via the tool. If worker relies solely on the tool, no harm. If it reads the prompt, bonus context. No regression either way.
- **Inlined IDs must match the todos.json IDs exactly.** Both are written from the same `todoItems` array, so they cannot drift. Unit test confirms.

## Exit criteria

Sprint is signed off when:
1. All unit tests pass (tests from "Test plan" above, plus no existing-test regression).
2. CTO runs the CNN smoke test and records the observation in `test-report.md`.
3. The observation passes the α gate: counter moves to 1/N within ~5 s of job start, and progresses through steps in real time rather than in a terminal batch.

If the α gate fails, this is not a merge-blocker automatically — the CTO decides whether to iterate on the prompt text (within this sprint) or escalate to a follow-up sprint that introduces hook-based enforcement.
