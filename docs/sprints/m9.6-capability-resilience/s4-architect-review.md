# S4 Architect Review — Recovery Orchestrator

**Reviewer:** The architect
**Branch:** `sprint/m9.6-s4-recovery-orchestrator`
**Review date:** 2026-04-15
**Plan reviewed against:** [`plan.md`](plan.md) §6

---

## Verdict: **APPROVED with one must-fix before merge**

S4 is the biggest sprint in M9.6 and the work is solid. State machine cleanly isolated as a pure module. Orchestrator handles the I/O layer with real mutex + cooldown + budget guards. All three pre-approved deviations (D1 two-spawn-per-iteration, D2 2s polling, D3 gitignored fixture) landed faithfully. `reverify.ts` runs the real capability against the actual triggering artifact (not a synthetic fixture). Mediator-framing in `reprocessTurn` is correct. 28/30 tests pass, 2 correctly skipped by `it.skipIf()`. Both packages compile clean.

The external reviewer caught two real findings (F1 nested-CFR budget, F3 surrender reason discriminator) and a minor polish (F2 unknown-type failureMode), the last of which was fixed in-commit. I found one additional gap — the orchestrator's surrender-clearing hook is never called by any producer — which should be closed on this branch.

---

## Plan ↔ code audit (independent)

I verified everything the external review covered and spot-checked the claims. Agreement on:
- §6.1 class/deps/methods all present with correct signatures
- §6.1 `inFlight` mutex (`recovery-orchestrator.ts:80, 109`) — second CFR for same capability attaches silently ✓
- §6.1 `surrendered` cooldown (`:86, 155-181`) — cross-conversation 10-min cooldown ✓
- §6.1 5-job cap enforced dually (state machine `:60`, imperative guards `:251, 328`) ✓
- §6.2 `orchestrator-state-machine.ts` pure, no I/O, 19 table-driven tests ✓
- §6.3 fix-automation.md prompt has no-self-restart + no-user-data rules; mirrored in `recovery-orchestrator.ts:470-471` ✓
- §6.4 reverify runs `transcribe.sh` against `failure.triggeringInput.artifact.rawMediaPath` — real artifact, not fixture ✓
- §6.4 reverify waits on `watcher.rescanNow()` (which awaits `testAll()` per S3) then polls for status=available up to 10s ✓
- §6.5 orchestrator wired into app.ts inside `if (hatched)` block; cfr.on("failure") subscription in place ✓
- §6.5 `reprocessTurn` framing (`app.ts:607-624`) matches `packages/dashboard/CLAUDE.md`'s mediator rule verbatim ✓

Compile: both packages clean.
Tests: 28 passed, 2 skipped (D3 integration, correct).
Regression: no S1–S3 tests broken (S3 review ran full regression, this branch only adds new files + a targeted app.ts edit).

---

## Assessment of decisions + judgment calls

All of D1–D4 and JC1–JC5 are reasonable. Specific notes:

- **D1 two-spawn-per-iteration** — faithfully implemented. Budget accounting correctly skips the reflect spawn if the 5-job cap is hit after execute (`:328-331`).
- **D2 polling** — 2s interval, 10-min timeout, unknown-terminal-status → WARN + fail. The WARN path (`app.ts:587-592`) is exactly the guardrail I asked for.
- **D3 fixture** — `.gitignore` adds `packages/core/tests/fixtures/cfr/.local/`. Integration test reads `CFR_INCIDENT_AUDIO` env var with `it.skipIf()` fallback. Header comment explains the skip gate. Good.
- **JC3 dual budget enforcement** — belt-and-suspenders is the right call. State machine is pure, imperative check protects against caller mis-set session state. Reviewer's F4 agrees.
- **JC5 orchestrator scoped to `if (hatched)`** — correct. An unhatched agent has no capabilities, so orchestrator doesn't need to exist. `app.recoveryOrchestrator` is nullable.

---

## Must-fix before merge

### C1: `onCapabilityNowAvailable` has no producer — surrender cooldown won't auto-clear

**Evidence:** `grep -rn "onCapabilityNowAvailable" packages/` shows the method declared on `RecoveryOrchestrator` (`recovery-orchestrator.ts:143`) and covered by two tests, **but no call site anywhere in the running system**.

**Impact:** The surrender scope is set when a capability fails 3 times, with a 10-minute cooldown. The plan's §6.1 wiring contract said this method is *"called by CapabilityWatcher after testAll — clears matching surrender scopes."* The watcher's `rescanNow()` never calls it. The capability:changed event subscribers (settings UI, state publisher, prompt builder) never call it either.

**Concrete scenario that breaks today:**
1. User sends voice note, STT capability broken → CFR fires → 3 attempts fail → surrender, 10-min cooldown starts.
2. CTO sees the surrender log, manually creates `.enabled` file / fixes a script bug.
3. `CapabilityWatcher` picks up the change, `registry.testAll()` runs, capability now `status: 'available'`.
4. User sends another voice note during the 10-min window.
5. `handle()` at `:100-106` checks `isSurrendered(capabilityType)` → still `true` (scope hasn't been cleared), fires surrender ack, returns.
6. Result: the fixed capability sits broken from the user's perspective for up to 10 minutes after it's actually working.

**The fix is small.** Two reasonable options — pick one:

**Option A (event-driven):** in `app.ts:528-539` (the `capabilityWatcher.onRescan` callback), after the post-`testAll` emit, call:
```typescript
for (const cap of registry.list()) {
  if (cap.provides && cap.status === "available") {
    app.recoveryOrchestrator?.onCapabilityNowAvailable(cap.provides);
  }
}
```

**Option B (lazy check):** inside `isSurrendered()` in `recovery-orchestrator.ts:155-165`, before returning `true`, check the current registry state: `if (this.deps.capabilityRegistry.get(capabilityType)?.status === 'available') { return false; }`. This means a stale scope gets ignored the moment the capability is healthy; no event plumbing needed.

I'd take **Option B**. It's 3 lines, doesn't rely on event ordering, and matches the read-through pattern already used elsewhere. Option A is also fine but adds ordering risk (what if `onCapabilityNowAvailable` is called during a `handle()` run and races with the cooldown check).

Add a test: set a surrender scope, mock the registry to return `status: 'available'`, call `handle()` with a new failure → assert a new fix session starts (not an immediate surrender).

**Severity:** Major. The whole point of surrender scope is to stop pathological loops, not to keep broken-state sticky after a manual fix. Without this, Nina is one CTO-fix away from a 10-minute false silence.

---

## Deferrable (follow-ups I accept)

### FU3 (reviewer F1): `parentFailureId` + nested-job budget

Declared in `cfr-types.ts:59`, no producer, no consumer, no cross-session budget map. In M9.6 it's unreachable (per-type mutex prevents `audio-to-text` → `audio-to-text` nesting; no other capability type emits CFRs yet). Accept the deferral to whenever a second emitter lands.

### FU4 (reviewer F3): surrender ack reason discriminator

`AckKind` is `"attempt" | "status" | "surrender"` — no `{ reason }` field. The plan's acceptance said the budget-exhausted path should surrender with `reason: "budget-exhausted"` for user messaging. Since `emitAck` is a log stub in S4 and S6 replaces the whole ack pipeline, it's reasonable to widen the type in S6 when it matters. Accept.

### Unknown-type reverify always fails (carried forward)

`reverify.ts:66-72` returns `pass: cap?.status === "available"` for unknown types, `recoveredContent: undefined`. The orchestrator at `:208` checks `if (attemptResult.recovered && recoveredContent)` — unknown types always take the else branch and iterate to surrender, even when the capability is genuinely healthy. Fine for M9.6 because only `audio-to-text` ships. Worth flagging explicitly in `s4-FOLLOW-UPS.md` so whoever adds `image-to-text` or `text-to-audio` in M9.7+ knows the dispatcher needs a reverifier branch for their type. Not a blocker.

---

## Process note — third time, putting it in the plan

### P1: Roadmap-done committed before architect review — again

- **S1:** correct order (review → roadmap-done).
- **S2:** slipped.
- **S3:** correct after I called it out.
- **S4:** slipped again.

Commit `f034ba9 docs(roadmap): M9.6-S4 done` is the tip of the branch. I haven't reviewed until now. The implementer agent doesn't see S2/S3 reviews — fresh session = fresh amnesia. My review notes don't stick across sprints.

**Putting this in the plan itself.** As part of this review commit, I'll add an explicit step to plan §0.3 (definition of "done"):

> **The roadmap-done commit is the LAST commit on the sprint branch, landed AFTER the architect-review commit. The implementer does not author it; the architect does it at approval time, or the implementer does it only after explicit approval in the review.**

That way every future implementer reads it cold and follows the rule without needing to inherit context from prior reviews.

For this branch: leave the premature roadmap commit in place — the review ends in approval anyway, so it's just a sequencing cosmetic, not a correctness issue. S5 onwards follows the rule.

---

## Other observations (no action)

- **Prompt duplication (reviewer F7):** The fix-automation.md template and the in-code render function in `recovery-orchestrator.ts:452-487` carry the same constraint text. I'd slightly prefer loading the markdown file and templating into it, but for S4 the duplicate is fine — both copies stay readable side-by-side. If the two drift in future, it'll be obvious in review.
- **`spawnAutomation` race:** `app.automations.fire(automation.id)` then `app.automations.listJobs({ automationId: automation.id })[0]` (`app.ts:568-571`). For a `once: true` manifest this is safe (at most one job) but relies on `fire()` being synchronous enough to create the job before `listJobs()` reads. Test coverage is through the mock in unit tests; real-world behavior depends on AutomationManager internals. Not a bug I can see, just a fragile idiom. Future cleanup: `fire()` should return the jobId directly.
- **`reverify` runs `transcribe.sh` with `bash <script> <arg>`** (`:123`). If the script lacks a shebang or has a different interpreter, this still works because of the explicit `bash`. Robust choice.
- **State machine state name drift** (reviewer's note in §6.2 row): plan diagram used `REFLECTED` / `VERIFIED`; implementation uses `REFLECTING` / `REVERIFYING` / `DONE` / `SURRENDER`. The present-participle naming is better (describes what's in progress, not a past event). I'll amend the plan's §6.2 diagram for consistency.

---

## Paper trail

- `s4-DECISIONS.md` — 4 design decisions + 5 judgment calls, each with rationale. Exceptionally good; JC3's dual-budget reasoning is textbook.
- `s4-DEVIATIONS.md` — clean table, CTO confirmations noted.
- `proposals/s4-d1`, `-d2`, `-d3*.md` — three proposals, all self-answered + CTO-confirmed. Exactly the protocol §0.2 asks for.
- `s4-FOLLOW-UPS.md` — four items, all reasonable defers.
- `s4-review.md` — thorough external review. Caught F1–F3 correctly.
- `s4-test-report.md` — present, verified commands.

Commit hygiene: six commits, conventional-style, no `--amend`, no `--no-verify`. Fix commit `6d389cd` properly attributes the F2 catch to the external reviewer.

---

## What to do next

1. **Implementer:** fix C1 (three-line change in `recovery-orchestrator.ts:isSurrendered` — Option B preferred) + one regression test showing surrender clears when capability is healthy. Commit: `fix(m9.6-s4): clear surrender cooldown when capability already healthy`.
2. **Implementer:** add to `s4-FOLLOW-UPS.md`: FU5 — unknown-type reverify structurally fails; needs reverifier branches in M9.7+ when second capability type lands.
3. **Architect (me):** as part of this review commit, amend plan §0.3 with the roadmap-done sequencing rule and plan §6.2 with the present-participle state names.
4. **Architect (me):** re-review C1 fix when pushed. If clean, merge.
5. **After merge:** S5 (orphan-turn watchdog) in a fresh session. S5 will need to read `packages/dashboard/src/conversations/transcript.ts`'s `TurnCorrectedEvent` contract (S1 laid it, S5 consumes it) — the plan is already specific about this.

---

**Approved pending C1. Ping when the fix lands.**
