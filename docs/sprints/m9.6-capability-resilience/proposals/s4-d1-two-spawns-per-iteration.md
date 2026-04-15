# Deviation Proposal — Sprint 4: Two Spawns Per Iteration (Per-Phase Model Selection)

**self-answered: implement two separate spawns per iteration — execute=Sonnet then reflect=Opus**

**Blocker:** The automation runner supports a single `model` field per automation manifest; it cannot switch models mid-run. The plan requires Sonnet for execute-phase and Opus for reflect-phase within the same iteration.

**Original plan says:**
> Per-phase model selection is specified (M11): Opus for reflection/surrender-decision, Sonnet for the actual fix-execute phase. Declared in the orchestrator-emitted automation file.

> Per-phase model selection: current `AutomationSpec`s in `.my_agent/automations/*.md` only have one `model:` field. If the automation runner can't switch models mid-run, structure each iteration as two separate spawns (execute-Sonnet then reflect-Opus). Propose before coding.
> — plan.md §6, escalation conditions

**What I found:**
- `AutomationManager.create()` accepts one `model` field per manifest (`automation-manager.ts:50`)
- `AutomationExecutor.run()` uses that single model for the entire run (`automation-executor.ts:173+`)
- No mid-run model switching exists in the executor or processor
- `app.automations.create()` + `fire()` is the programmatic spawn path (`app.ts:248-283`)

**Options I considered:**
1. **Two separate spawns per iteration** (execute=Sonnet, reflect=Opus) — models match spec intent; fits existing infrastructure cleanly; `FixAttempt.phase` tracks which spawn we're in. Each iteration produces 2 jobs (max 6 jobs for 3 iterations, within the 5-job-cap — see D2 note below).
2. **Single spawn using Opus for the whole iteration** — simpler, slightly more expensive per iteration; loses the intent of using Sonnet for the faster execute step.
3. **Single spawn using Sonnet for the whole iteration** — cheapest, loses the Opus reflection quality that drives hypothesis quality for iteration 2.

**My recommendation:** Option 1 (two spawns per iteration), because it exactly matches the plan's own suggested fallback and preserves the design intent (Sonnet for execution speed, Opus for reflection quality). CTO confirmed this approach.

**Blast radius:**
- `FixAttempt` already has a `phase: "execute" | "reflect"` field in `cfr-types.ts` — designed for this.
- The 5-job cap (plan §6.1) applies per triggering turn across all sessions. With 2 spawns/iteration × 3 iterations = 6 theoretical jobs; however, surrender after attempt 3's execute spawn means reflect is skipped → max 5 jobs in the failure path (3 execute + 2 reflect). The orchestrator tracks `totalJobsInThisTrigger` and skips reflect if the execute job's outcome is already surrender-triggering. This stays within the cap.
- `AutomationSpec.model` in `recovery-orchestrator.ts` is set per spawn call, not per iteration — no interface changes needed.

**Question for the architect:** None — self-answered per plan §6 escalation conditions. CTO confirmed during trip-sprint pre-flight.
