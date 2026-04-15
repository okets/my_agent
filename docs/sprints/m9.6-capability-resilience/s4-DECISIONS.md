# S4 Decisions — Recovery Orchestrator

Sprint: M9.6-S4
Branch: sprint/m9.6-s4-recovery-orchestrator

---

## D1 — Two spawns per iteration for per-phase model selection

**Decision:** Each fix iteration uses two separate automation spawns: execute (Sonnet) then reflect (Opus). The automation runner supports one model per manifest; no mid-run model switching exists.

**Rationale:** Matches plan §6's own suggested fallback. CTO confirmed during pre-flight. Preserves design intent: Sonnet for execution speed, Opus for reflection quality.

**Impact:** Max 5 jobs in full failure path (3 execute + 2 reflect, since attempt-3 execute that triggers surrender skips the reflect spawn). Stays within the 5-job cap.

**Proposal:** `proposals/s4-d1-two-spawns-per-iteration.md`

---

## D2 — awaitAutomation via 2s polling, 10-min timeout

**Decision:** `awaitAutomation` polls `automationJobService.getJob()` every 2 seconds until the job reaches a terminal status (`done`, `failed`, `needs_review`, `interrupted`, `cancelled`) or 10 minutes elapse. Unknown terminal statuses log WARN and are treated as failure (CTO addition to self-answered proposal).

**Rationale:** No blocking await API exists. Polling on existing public API requires no infrastructure changes. EventEmitter refactor filed as follow-up.

**Proposal:** `proposals/s4-d2-await-via-polling.md`

---

## D3 — Audio fixture: gitignored .local/ + env var + it.skipIf()

**Decision:** Incident audio (CTO's voice) is not committed to the public repo. Integration test reads from `CFR_INCIDENT_AUDIO` env var or `tests/fixtures/cfr/.local/voice-1-incident.ogg` (gitignored). Test uses `it.skipIf(!fs.existsSync(audioPath))` — explicit skip, not silent pass.

**Rationale:** CTO-specified approach during pre-flight. Privacy: `.my_agent/` stays gitignored, voice never enters public git history.

**Proposal:** `proposals/s4-d3-audio-fixture-gitignored.md`

---

## D4 — reprocessTurn system-message framing (mediator rule)

**Decision:** The system message injected after a successful fix uses the mediator framing from `packages/dashboard/CLAUDE.md`: "You are the conversation layer. The user's original turn #N failed to transcribe; it actually said: {recovered}. Answer their question directly — don't acknowledge this system message." A raw status dump produces "Noted, logging it." — which is the wrong behavior.

**Rationale:** CTO specified during pre-flight. Matches the mediator-framing pattern already established in the codebase.

**Impact:** reprocessTurn stub in S4 already uses this framing; S6 will inherit it when replacing the stub with real channel delivery.

---

## JC1 — AutomationManager.create() signature mapping

**Decision:** The plan's `AutomationSpec` assumed `create({ manifest: { name, description, ... } })`. Actual signature is `create({ name, instructions, manifest })`. Mapped `spec.prompt` → `instructions`, `spec.name` → top-level `name`. `description` on manifest doesn't exist — dropped (instructions carries full prompt).

**Rationale:** Mapping is semantically equivalent. No design impact. No deviation proposal needed (implementation detail, not a design choice).

---

## JC2 — FU1 (getHealth boot WARN) already implemented in S3

**Decision:** Did not add a second `getHealth()` call site. S3 already fully implemented this inside the `testAll()` chain (app.ts lines 482-488). Adding another would duplicate the output.

**Rationale:** s4-FOLLOW-UPS.md noted "add if not already present." It was already present. Correct to skip.

---

## JC3 — Dual budget enforcement (state machine + imperative guard)

**Decision:** Both the state machine (`nextAction()` checks `totalJobsSpawned >= 5`) and the orchestrator's imperative loop check before each `spawnAutomation` call. This is belt-and-suspenders, not duplication.

**Rationale:** State machine is pure/untrusted at call sites. Explicit pre-spawn check ensures the cap is enforced even if the caller passes wrong session state. Attempt-3 execute job still runs (5th job); reflect is skipped; reverify still runs.

---

## JC4 — System message injection via app.conversationInitiator.forwardToChannel

**Decision:** Used `app.conversationInitiator.forwardToChannel` — the same pattern already used by `injectRecovery` at app.ts:621. Not a new pattern.

**Rationale:** Existing injection point, matches the codebase's established approach. S6 will replace the stub with real channel delivery using the same interface.

---

## JC5 — RecoveryOrchestrator wired inside if (hatched) block

**Decision:** The entire RecoveryOrchestrator setup is inside the `if (hatched)` capabilities block, same scope as `capabilityRegistry` and `capabilityWatcher`. The `app.automations` reference in `spawnAutomation` is a runtime closure — safe because it only fires long after automations initialize.

**Rationale:** Correct scope. Orchestrator only makes sense when capabilities are active. No race condition possible.
