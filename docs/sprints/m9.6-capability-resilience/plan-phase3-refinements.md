# M9.6 Phase 3 — Architecture Refinements (S16–S20)

**Status:** Approved 2026-04-17 — supersedes sprint ordering and scope of `plan-universal-coverage.md` v2.3
**Phase:** 3 of 3 (Phase 1 = S1–S8 DONE; Phase 2 = S9–S15)
**Design spec:** [`../../design/capability-resilience-v2.md`](../../design/capability-resilience-v2.md) — binding context
**Phase 1 plan:** [`plan.md`](plan.md) — implementing-agent rules in §0 carry over verbatim
**Phase 2 plan:** [`plan-phase2-coverage.md`](plan-phase2-coverage.md) — must be green before Phase 3 starts
**Milestone exit:** Phase 3 closes M9.6.

---

## 0. For the implementing agent — READ THIS FIRST

The implementing-agent rules in `plan.md` §0 (Stop-On-Deviation, Deviation Proposal Protocol, "done" definition, Ground rules) carry over verbatim. Re-read them. Proposals land in `proposals/s<N>-<slug>.md`.

### 0.1 The universal-coverage rule (§8 of design v2)

> **Universal-coverage rule:** Any new generic layer this sprint adds must come with coverage for every capability type registered in `.my_agent/capabilities/` at sprint-end. If a new type can't be covered in-sprint, name it explicitly in `FOLLOW-UPS.md` with: (a) the type, (b) why it can't be covered now, (c) which sprint will cover it. Omitting a type silently is a sprint-failure condition, not a follow-up.

Phase 3 adds architectural change without adding new types. The rule still applies — when fix-mode lands in S16, every plug type in the registry must be reachable by it. When ack coalescing lands in S19, every type's friendly name + multi-instance flag must be respected.

### 0.2 Phase 3 ordering rationale

S16 (fix-engine swap) ships **before** S17 (reflect-phase collapse). The reverse — S17 first — would leave the existing Sonnet-only fix path running without its Opus reflect step between sprints, a quality regression during the gap. Opus 4.6 acknowledged this miss directly during the 2026-04-17 audit.

S16 ships fix-mode as a one-shot Opus run that bypasses the reflect state entirely. S17 then deletes reflect as dead code. Old path stays at full quality during the transition; new path never used reflect.

### 0.3 Phase 2 must be green; M10 must wait

This phase does not start until Phase 2's S15 exit gate is green and architect-approved. If Phase 2 has open follow-ups, they get fixed in a closing-the-gap sprint before Phase 3 begins. Don't leak coverage debt forward.

**CTO scheduling decision 2026-04-17:** M10 work does NOT start at Phase 2 close, even though Phase 2 architecturally unblocks it. Phase 3 runs first; M9.6 closes at S20 exit; M10 begins after.

---

## 1. Phase overview

**Goal:** the architectural refinements deferred from Phase 2. Symmetric authoring/fixing via `capability-brainstorming` fix-mode. State-machine cleanup. UX polish. Final exit gate.

**Sprint sequence:**

| Sprint | Name | Depends on | Parallelizable with |
|--------|------|-----------|---------------------|
| S16 | Fix-engine swap + wall-time measurement | Phase 2 | — |
| S17 | Reflect-phase collapse (dead-code cleanup) | S16 | S18 |
| S18 | Duplicate TTS path collapse | Phase 2 | S17 |
| S19 | Ack coalescing + assistant-turn orphan + system-origin UI | S16 | — |
| S20 | Phase 3 exit gate: two definitive smoke tests | S16–S19 | — |

**Phase 3 exit (S20):** the two CTO-defined definitive smoke tests pass. M9.6 closes.

---

## 2. Detailed sprint plans

### 2.1 Sprint 16 — Fix-engine swap to `capability-brainstorming` fix-mode

**Design refs:** §3.5 (fix engine block), §6.3 (wall-time measurement).

**Goal:** the orchestrator stops using `fix-automation.md`. It invokes the existing `capability-brainstorming` skill in fix-mode for every recovery attempt. The skill reads the plug folder + DECISIONS.md, makes a targeted change in-process, runs `<capDir>/scripts/smoke.sh`, writes `deliverable.md`. DECISIONS.md gets a paper-trail append via the framework's existing `writePaperTrail` hook. **Wall-time measured against at least two plug types as part of acceptance.**

**Files (skill):**

- `packages/core/skills/capability-brainstorming/SKILL.md` — add a `Step 0: Mode check` section at the top:

  ```
  ## Step 0: Mode check

  If the invocation prompt starts with `MODE: FIX`, follow the Fix Mode path ONLY.
  Steps 1, 2, 3, 4, 5, and 6 of the authoring flow, and the `.enabled` write step, are
  DISABLED in fix mode. Do not run them. Do not `create_automation`. Do not write
  user-facing copy. Do not ask clarifying questions — if you do not have enough info,
  write `ESCALATE: insufficient-context` atop your deliverable and stop.

  ### Fix Mode

  You have been invoked by the recovery orchestrator because a capability failed during a
  user turn or automation. The capability folder already exists at <capDir> (passed in the
  prompt).

  1. Read <capDir>/CAPABILITY.md, <capDir>/config.yaml, <capDir>/DECISIONS.md, and the
     relevant files under <capDir>/scripts/. Form a hypothesis from the symptom, detail,
     and previous-attempt history in the invocation prompt.
  2. Write a one-line "why this change is being made" context entry to
     <capDir>/DECISIONS.md (appending, with a timestamp). Mirrors authoring-flow Step 1.
  3. Make a targeted change to the plug in-process (config tweak, script patch, env fix,
     dep bump). Do NOT spawn a nested builder automation. Do NOT rewrite from scratch.
     If the existing design cannot be repaired, write `ESCALATE: redesign-needed` atop
     your deliverable and stop.
  4. Run <capDir>/scripts/smoke.sh. Record the result.
  5. Write deliverable.md in your run directory with frontmatter (change_type,
     test_result, hypothesis_confirmed, summary, surface_required_for_hotreload) + body.
  6. Do NOT append the paper-trail entry to DECISIONS.md yourself — the automation
     framework's writePaperTrail does that on job completion (target_path is set).
  ```

- **Authoring-side neutral-identifier convention** (per v2.3 §10 item 10 resolution): add a one-line rule in Step 5's "spawn builder" section — "capability `name:` must be a neutral identifier (provider/variant/model), never user-identifiable content (no real names, phone numbers, emails). The name surfaces in user-facing ack copy for multi-instance types."

**Files (orchestrator):**

- `packages/core/src/capabilities/recovery-orchestrator.ts` —
  - Replace `renderPrompt(failure, session)` with `buildFixModeInvocation(failure, session)`. Prompt begins with `MODE: FIX`, carries capability-folder path (`cap.path`), symptom, detail, and a rendered previous-attempts table.
  - Add `targetPath?: string` to `AutomationSpec` interface (around line 30).
  - On spawn, set `spec.targetPath = cap.path` so `writePaperTrail` knows where to append.
  - Raise `JOB_TIMEOUT_MS` to 15 minutes for fix-mode jobs (current value is 10 min). Document why in `DECISIONS.md`: cold Opus run on unfamiliar plug projected at 5–12 min.
  - **`ESCALATE:` marker parsing:** in `readDeliverable()`, check if the body starts with `ESCALATE: redesign-needed` or `ESCALATE: insufficient-context`. If so:
    - Set `session.surrenderReason = "redesign-needed"` (or `"insufficient-context"`).
    - Skip reverify for that attempt.
    - Transition directly to `SURRENDER` (skip remaining attempts for this session).
    - Surrender ack uses §3.5 / S14 copy for the new reasons (copy table updated below).
  - Model selection: spec uses `model: "opus"` for fix-mode. Old `fix-automation.md` path's Sonnet-execute / Opus-reflect remains in code but is unreachable once swap is wired (deleted in S17 cleanup).

**Files (dashboard plumbing):**

- `packages/dashboard/src/app.ts` (around line 635-653 — confirm via grep `spawnAutomation`) — the closure constructs the automation manifest. Add `target_path: spec.targetPath` to the manifest object. Without this, setting `targetPath` on the orchestrator spec is a no-op and `writePaperTrail` at `automation-executor.ts:594-603` does nothing. Confirm `automation-executor.ts:162-167` auto-`job_type` inference triggers on `.my_agent/capabilities/...` target path → sets `job_type: capability_modify`. No collision with explicit setting.

**Files (write-guard exemption):**

- `.my_agent/` write-guard hook — location: check `.claude/settings.json` and `scripts/pre-commit-check.sh` (per the post-M9.2 hook noted in MEMORY.md). Add an exemption: writes by a worker with `job_type === "capability_modify"` are allowed scoped to `.my_agent/capabilities/<name>/`. **If the hook isn't yet in place** (memory says "post-M9.2, add hook" — might still be a TODO), document the requirement here and coordinate with the architect; do not block on a non-existent hook.

**Files (surrender copy — depends on S14 from Phase 2):**

- `packages/core/src/capabilities/resilience-messages.ts` — add new surrender-reason copy (S14 set the parameterization on friendlyName; this sprint adds the new reasons):
  - `redesign-needed` → "I tried to fix {friendlyName} but the design needs a bigger rework — I've flagged it, {fallback_action} for now."
  - `insufficient-context` → "I couldn't fix {friendlyName} — I didn't have enough to go on. {fallback_action}."

**Files (deprecation of `fix-automation.md`):**

- `packages/core/src/capabilities/prompts/fix-automation.md` — add a deprecation notice atop the file. Do not delete (deletion lands in S17 once fix-mode has been green for one sprint).

**Acceptance tests:**

- `packages/core/tests/capabilities/fix-mode-invocation.test.ts` *(new)* — orchestrator builds a `MODE: FIX` prompt; spec carries `targetPath`; spawn target is `capability-brainstorming` skill, not `fix-automation`.
- `packages/core/tests/capabilities/fix-mode-integration.test.ts` *(new)* — stub plug folder under temp dir → fix-mode reads folder + DECISIONS.md + patches a config + runs smoke + writes deliverable.md. Assert: no nested `create_automation` call (mock-asserted); paper trail appended via `writePaperTrail` (target_path correctly set on manifest).
- `packages/core/tests/capabilities/fix-mode-escalate.test.ts` *(new)* — orchestrator reads `ESCALATE: redesign-needed` marker → `session.surrenderReason === "redesign-needed"`, reverify skipped, state transitions to SURRENDER. Same for `ESCALATE: insufficient-context`.
- `packages/core/tests/skills/capability-brainstorming-gate.test.ts` *(new)* — authoring-mode prompt still runs full Steps 1-6; fix-mode prompt runs fix-only path.
- `packages/core/tests/capabilities/resilience-messages-new-reasons.test.ts` *(new)* — `redesign-needed` and `insufficient-context` surrender copy renders correctly per type.
- **Wall-time measurement test** (gate, per design §6.3): run fix-mode against at least two broken plugs (STT + one MCP plug) and record wall-time. Output to `s16-walltime-results.md`. Architect review checks the file.

**Verification:**

```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/fix-mode-invocation tests/capabilities/fix-mode-integration tests/capabilities/fix-mode-escalate tests/skills/capability-brainstorming-gate tests/capabilities/resilience-messages-new-reasons
cd packages/dashboard && npx tsc --noEmit

# Wall-time measurement (run on dev machine with broken plugs)
node scripts/measure-fix-mode-walltime.js  # output to s16-walltime-results.md
```

**Wall-time decision gate:**

- If wall-time consistently ≤5 min: ship as-is.
- If wall-time consistently 5–10 min: file proposal in `proposals/s16-walltime-mitigation.md`. Choose between (a) second status ack at 60s, (b) Sonnet for simple symptoms (`not-enabled`, configuration errors) + Opus for hard diagnosis. Architect picks. Mitigation lands in a separate commit before S16 closes.
- If wall-time consistently >10 min: escalate. May need to revisit fix-engine architecture (e.g., consider sibling skill Option B if coupling adds overhead).

**Deviation triggers:**

- `targetPath` plumbing requires touching more than the named files.
- The `.my_agent/` write-guard hook isn't in place — file proposal documenting prerequisite work.
- `capability-brainstorming` Step 0 gate interferes with authoring-mode invocation in unexpected ways. Consider Option B (sibling `capability-fixing` skill) per design §3.5 escape hatch — propose if pain.
- `writePaperTrail` doesn't write to `DECISIONS.md` in the expected shape (verify by inspecting Phase 1's paper-trail entries first).
- Wall-time mitigation requires architectural changes (not just a 60s ack or model swap). Escalate.

**Universal coverage check:** fix-mode must work for every plug type. Explicitly run fix-mode against each type listed in `.my_agent/capabilities/` (script and MCP); record results in `DECISIONS.md`. If any type can't be fixed via fix-mode (e.g., the smoke contract fails), name it.

---

### 2.2 Sprint 17 — Reflect-phase collapse (dead-code cleanup)

**Design refs:** §3.6 (frozen surfaces — orchestrator-state-machine.ts not frozen), §5.3 (reflect ordering rationale).

**Goal:** delete the reflect phase. Fix-mode (S16) made it dead code; this sprint removes it. Two-commit sequence: state-machine + types in commit 1, orchestrator behavior in commit 2.

**Pre-flight check:** confirm S16 is shipped and the fix-automation.md path is unreachable in production (no automation jobs spawn via the old prompt). If the old path is still being used by anything, do not proceed; file a proposal.

**Files (commit 1 — state + types):**

- `packages/core/src/capabilities/orchestrator-state-machine.ts` —
  - Remove `"REFLECTING"` literal from `OrchestratorState` union.
  - Remove `REFLECT_JOB_DONE` from `OrchestratorEvent`.
  - Remove `SPAWN_REFLECT_JOB` from `Action`.
  - Remove the `REFLECTING → REVERIFYING` transition; `EXECUTING → REVERIFYING` becomes the single post-execute edge on success (already exists per S13's terminal-routing changes — confirm).
  - Remove the `REFLECTING + totalJobsSpawned >= 5 → SURRENDER` budget guard.
  - `MAX_JOBS` (currently 5) → 4 (safety ceiling, since reflect is gone; max actual jobs per recovery = 3).
  - Remove `reflectJobId?: string` from `FixSession` interface.
- `packages/core/src/capabilities/cfr-types.ts` —
  - `FixAttempt.phase: "execute" | "reflect"` → `"execute"` only. No data migration: `CapabilityFailure` and `FixAttempt` are in-memory only on the orchestrator's in-flight map; nothing persisted.
- `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts` (lines 54-58, 126-129 — confirm at sprint-time) — update edge expectations.
- `packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts` (around line 173) — rewrite: 3 attempts × 1 job = 3 max; ceiling at 4.
- `packages/core/tests/capabilities/orchestrator/orchestrator-timing.test.ts` — audit any reflect-related timing assertions; remove or rewrite.

**Files (commit 2 — orchestrator behavior):**

- `packages/core/src/capabilities/recovery-orchestrator.ts` —
  - Delete lines ~349–415 (reflect spawn / await / deliverable read / next-hypothesis threading). Confirm exact line range via grep at sprint-time (`grep -n "REFLECTING\|reflectJobId\|renderReflectPrompt"`).
  - Delete `renderReflectPrompt` (around line 546-578).
  - Remove `session.reflectJobId` references (now removed from type in commit 1).

**Files (commit 3 — final cleanup):**

- `packages/core/src/capabilities/prompts/fix-automation.md` — **delete the file**. S16 deprecated it; this sprint removes it after one sprint of green fix-mode operation.

**Acceptance tests:** updated state-machine + budget tests pass; no orphaned references to reflect in production code (`rg 'reflect|REFLECTING' packages/core/src/capabilities/` returns zero hits).

**Verification:**

```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/orchestrator
rg "reflect|REFLECTING|reflectJobId" packages/core/src/capabilities/  # expect zero hits
ls packages/core/src/capabilities/prompts/fix-automation.md 2>/dev/null  # expect "no such file"
```

**Deviation triggers:**

- Budget cap removal surfaces a Phase 1 test relying on 5-job headroom (rewrite or delete).
- `FixAttempt.phase` narrowing breaks a test fixture that can't be mechanically migrated (rewrite).
- Production code outside the named files imports anything reflect-related (find before deleting; rewrite caller).

**Universal coverage check:** N/A — pure dead-code removal, no new layer added.

---

### 2.3 Sprint 18 — Duplicate TTS path collapse

**Design refs:** §3.6 (not frozen — chat-service synthesizeAudio + message-handler), HANDOFF §2.2 (the duplicate-TTS-path mess).

**Goal:** `chat-service.synthesizeAudio` becomes the authoritative TTS path. `message-handler` consumes the `audioUrl` from `done` events. Baileys plugin's `onSendVoiceReply` synthesis is deleted. **One TTS invocation per turn, one CFR emit point** (which S10 left as a TODO and S15 may have temporarily wired — formalize here).

**Files:**

- `packages/dashboard/src/channels/message-handler.ts` (around lines 571–602) —
  - Capture `audioUrl` from both split-`done` and final-`done` events (currently only `detectedLanguage` is captured).
  - Decide audio vs text per the per-path fallback table (below). Pass `audioUrl` to the new transport function instead of re-passing text.
  - Explicit fallback for every error/empty path — no silent drops.
- `packages/dashboard/src/app.ts` (around lines 879-896 and 2217+) —
  - Replace `sendAudioViaTransport(transportId, to, text, language)` with two new functions:
    - `sendAudioUrlViaTransport(transportId, to, audioUrl)` — receives an already-synthesized audio URL, reads bytes from local disk under `/api/assets/audio/`, hands to `bp.sendAudio`. Boolean return.
    - `sendTextViaTransport(transportId, to, text)` — fallback for text. Boolean return.
  - Delete or narrow `bp.onSendVoiceReply` synthesis path.
- `plugins/channel-whatsapp/` (or wherever the Baileys plugin lives — confirm at sprint-time) — remove `onSendVoiceReply` synthesis. Keep any audio-format postprocessing (compression, format conversion) if needed.
- `packages/dashboard/src/chat/chat-service.ts:~1058` (`synthesizeAudio()`) — formalize CFR emission via `app.capabilityInvoker.run({capabilityType: "text-to-audio", scriptName: "synthesize.sh", ...})`. This was deferred in S10 and possibly minimally wired in S15; finalize here. Remove the `// TODO(S13/S17): route through invoker` marker.

**Per-path fallback table:**

| Path | Today | New behavior |
|---|---|---|
| Split `done` with `splitAudioUrl` | handler sends text via `turn_advanced` | handler sends audio via `sendAudioUrlViaTransport` when `first.isVoiceNote`; text fallback otherwise |
| Final `done` with `audioUrl` | handler sends text, Baileys re-synthesizes | handler uses captured `audioUrl` |
| `done` with empty `audioUrl` (CFR fired or empty assistantContent) | silent drop | explicit text fallback via `sendTextViaTransport` |
| `error` event catch path | handler sends error string, Baileys re-synthesizes | handler sends error text via `sendTextViaTransport`; if voice input, still text fallback (don't invent audio for errors) |
| Tool-only assistant turn (empty text) | nothing synthesized | nothing sent; log and skip |

**Acceptance tests:**

- `packages/dashboard/tests/integration/tts-paths.test.ts` *(new)* — one test per row of the fallback table.
- `packages/dashboard/tests/integration/voice-reply-regression.test.ts` *(new)* — healthy path: voice input → assistant reply → voice output. No regressions vs Phase 2 S15's STT/TTS replay.
- `packages/dashboard/tests/integration/cfr-tts-single-emit.test.ts` *(new)* — break TTS, send a voice-eligible reply, confirm CFR emits **once** (not twice as before, when both paths could fire).

**Verification:**

```bash
cd packages/dashboard && npx tsc --noEmit
cd packages/dashboard && npx vitest run tests/integration/tts-paths tests/integration/voice-reply-regression tests/integration/cfr-tts-single-emit
```

Manual: confirm live WhatsApp voice message replies with voice on the healthy path (pre-/post-change). Coordinate with the architect for live transport tests per the no-live-outreach rule.

**Deviation triggers:**

- Baileys plugin can't drop synthesis without breaking audio-format compatibility.
- `audioUrl` not reliably produced by `done` event in all streaming paths (e.g., split-done sometimes returns null).
- `sendAudioViaTransport` is called from a path the table doesn't cover (grep first; expand the table).

**Universal coverage check:** TTS detection now flows through the same `CapabilityInvoker` gate as STT. Confirm S15's TTS replay still passes after the collapse.

---

### 2.4 Sprint 19 — Ack coalescing + assistant-turn orphan + system-origin UI

**Design refs:** §3.4 + v2.3 §4.5 (ack coalescing), v2.3 §4.5 + S14 of v2.3 (assistant-turn orphan), §3.4 (system-origin routing).

**Goal:** UX polish. Parallel CFRs in the same conversation get coalesced acks. Assistant-turn orphans get detected via a structured `TranscriptTurn.failure_type` field. System-origin emits surface on a dashboard health page (was log-only in Phase 2 S12).

**Files (ack coalescing):**

- `packages/core/src/capabilities/ack-delivery.ts` — add per-conversation coalescing layer:
  - 30-second window per `conversationId`.
  - If a second CFR arrives for a different type within the window, send a follow-up: "still fixing — now also ${friendlyName2}." Combine via friendly names.
  - N-aware (not capped at 2): "still fixing — voice transcription, voice reply, browser." Use Oxford comma for ≥3 types.
  - If one reaches `RESTORED_TERMINAL` while the other is still fixing, the restoration ack waits until both are in terminal state, then emits: "{friendlyName1} is back; {friendlyName2} still in progress." Or, if both in terminal: "{friendlyName1} and {friendlyName2} are back."
  - Conversation-origin ONLY. Automation and system origins bypass — they have their own routing per §3.4.
- `packages/core/tests/capabilities/ack-coalescing.test.ts` *(new)* — 2 CFRs in 30s merged; 3+ CFRs N-way merge; one terminal during fix; cross-origin bypass (automation CFR doesn't coalesce with conversation CFR).

**Files (assistant-turn orphan via structured field):**

- `packages/core/src/conversations/types.ts` — add `failure_type?: string` to `TranscriptTurn`. Structured field — not a placeholder string.
- `packages/core/src/conversations/orphan-watchdog.ts` —
  - Generalize `VOICE_PLACEHOLDERS` to `FAILURE_PLACEHOLDERS` dispatch table keyed by capability type (for back-compat with any existing string-based detection).
  - Add **assistant-turn scan:** scan recent assistant turns for `failure_type` field set. If set and the failure isn't yet reverified, schedule re-driven recovery same way user-turn orphans are handled.
  - Unit test asserts the `FAILURE_PLACEHOLDERS` table covers every placeholder string any invocation site writes.
- `packages/dashboard/src/ws/protocol.ts` (confirm path) — extend turn message shape to carry `failure_type` through the wire. May be transparent if existing pass-through already works; verify.
- `packages/dashboard/src/conversations/search.ts` (or whichever file indexes turns — confirm via `rg 'indexTurn|TranscriptTurn' packages/dashboard/src/conversations/`) — ensure indexing skips `failure_type` or handles gracefully; no crash on the new field.
- `packages/dashboard/public/js/app.js` (and any related rendering) — turns with `failure_type` render with a subtle inline marker ("voice reply unavailable — fixing…") rather than a blank assistant bubble. Copy per S14 terminal table.
- `packages/core/tests/conversations/orphan-watchdog-assistant.test.ts` *(new)* — assistant turn with `failure_type: "text-to-audio"` detected + scheduled.

**Files (system-origin UI):**

- `packages/dashboard/src/api/capabilities.ts` (or the route that serves `.my_agent/capabilities/` health — confirm at sprint-time) — extend the health endpoint to surface system-origin CFR events. Source: a new in-memory ring buffer in `ack-delivery.ts` or a small append-only log file under `.my_agent/.runtime/cfr-system.log`.
- `packages/dashboard/public/js/capabilities.js` (or wherever the capability-health UI lives) — show a "recent system-origin recoveries" panel listing last N CFR events from system-origin component names.
- `packages/core/src/capabilities/ack-delivery.ts` — extend the `system` branch (currently log-only from Phase 2 S12) to also append to the ring buffer / log file.
- `packages/dashboard/tests/integration/cfr-system-origin-health.test.ts` *(new)* — system-origin CFR fires, health endpoint returns it.

**Acceptance tests:** sum of the per-feature tests above. All Phase 2 tests still pass.

**Verification:**

```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/ack-coalescing tests/conversations/orphan-watchdog-assistant
cd packages/dashboard && npx tsc --noEmit
cd packages/dashboard && npx vitest run tests/integration/cfr-system-origin-health
cd packages/dashboard && npx vitest run  # full dashboard suite, regression gate
```

**Deviation triggers:**

- `TranscriptTurn.failure_type` breaks WS protocol or search indexing in unexpected ways. Catch during sprint; propose shape change if needed.
- Assistant-turn orphan re-driven recovery loops on itself (re-drive triggers another orphan). Add idempotency marker.
- System-origin ring buffer grows unbounded. Cap at last 100 events.

**Universal coverage check:** ack coalescing covers every type registered (uses `friendlyName` from S14). Assistant-turn orphan detection covers every capability type that records `failure_type` (S13's terminal-on-fix path should now write this; verify in S19 that all terminal paths set the field). System-origin UI surfaces CFRs from any component that emits with `kind: "system"`.

---

### 2.5 Sprint 20 — Phase 3 exit gate: two definitive smoke tests

**Design refs:** v2.3 §8 (Exit-gate Tests 1 and 2 — CTO-defined 2026-04-16).

**Goal:** the two CTO-defined definitive smoke tests pass end-to-end on the dev machine with real plugs installed. **M9.6 closes here.**

**Files:**

- `packages/dashboard/tests/integration/app-harness.ts` — confirm the `MockTransport` from Phase 2 S15 is in place (a `MockTransport` that implements the transport interface and records every `send` call with args; injection point in `AppHarness`). Extend if needed for richer assertions.
- `packages/dashboard/tests/e2e/cfr-exit-gate-automation.test.ts` *(new — supersedes the synthetic browser test from S15)* — Exit-gate Test 1 per v2.3 §8:
  - Setup: install / confirm `browser-control` plug present and healthy (`scripts/smoke.sh` green). Create a test automation: "open `https://example.com`, take a screenshot, attach to debrief." Set `notifyMode: debrief`. Deliberately break the plug at the plug side — one surgical change to `config.yaml`, `CAPABILITY.md`, or a script under `scripts/`, chosen so the break is plausibly one Nina herself could have caused. Record what was broken; do NOT restore manually. Fire the automation.
  - Assertions:
    - `PostToolUseFailure` hook fires; CFR emits with `origin.kind === "automation"`, `origin.notifyMode === "debrief"`.
    - Orchestrator spawns fix-mode `capability-brainstorming`. **No real-time user ack** (automation origin).
    - Fix-mode reads plug folder + DECISIONS.md, produces a targeted fix, runs `scripts/smoke.sh`, writes `deliverable.md`.
    - Plug's `DECISIONS.md` gains both a context entry (why-this-change) and a paper-trail append (what-was-done via `writePaperTrail`).
    - `CFR_RECOVERY.md` appears in the automation's job `run_dir` with the fix summary + timestamps.
    - Reverify runs `scripts/smoke.sh` as a fresh out-of-session subprocess and returns green. Originally-broken MCP child in the job's SDK session is *not* expected to recover mid-session; the test asserts against the fresh smoke probe.
    - Orchestrator transitions to `RESTORED_TERMINAL`.
    - Automation completes. Its debrief includes the CFR recovery summary (per `notifyMode: debrief` and S12's debrief-prep extension).
    - A subsequent fire of the same automation runs clean against the fixed plug.
- `packages/dashboard/tests/e2e/cfr-exit-gate-conversation.test.ts` *(new — supersedes the STT replay from S15)* — Exit-gate Test 2 per v2.3 §8:
  - Setup: install / confirm `audio-to-text` plug present and healthy. Smoke green. Deliberately break the plug at the plug side — e.g., remove the API key from `config.yaml`, corrupt `transcribe.sh`, or break a dependency in `requires.env`. Record what was broken; do NOT restore. Inject a voice message through `AppHarness` extended with the recording mock transport.
  - Audio content: something that can be meaningfully responded to (e.g., "What time is it?") so reprocess is visible.
  - Assertions:
    - `CapabilityInvoker` fires CFR with `origin.kind === "conversation"`.
    - User sees an initial ack on the conversation's channel ("hold on — voice transcription isn't working, fixing now").
    - Orchestrator spawns fix-mode `capability-brainstorming`. Fix-mode reads plug folder + DECISIONS.md, patches, runs smoke.
    - Plug's `DECISIONS.md` gains context + paper-trail entries.
    - Reverify runs `reverifyAudioToText` against the persisted `rawMediaPath` (the user's original audio), returns `{pass: true, recoveredContent: <transcription>}`.
    - Orchestrator transitions to `RESTORED_WITH_REPROCESS` and calls `reprocessTurn` with the recovered transcription.
    - Brain processes the reprocessed turn, produces a coherent reply to the message's content (not just a meta-ack).
    - The mock transport's capture log shows: (1) initial "hold on" ack, (2) final meaningful reply. Reply delivered to the conversation's transport (captured by mock), not silently dropped.
- `packages/dashboard/tests/e2e/cfr-abbreviated-replays.test.ts` *(new — extends Phase 2 S15 abbreviated tests)* — one abbreviated test per other registered plug type (TTS conversation-origin, desktop-control automation-origin if installed) matching whichever of Test 1 / Test 2's shape fits each plug's origin/invocation profile.

**Acceptance:** both exit-gate tests green; abbreviated replays green for every registered plug type.

**Verification:**

```bash
cd packages/dashboard && npx vitest run tests/e2e/cfr-exit-gate-automation tests/e2e/cfr-exit-gate-conversation tests/e2e/cfr-abbreviated-replays
```

Dev-machine preconditions:
- `browser-chrome` plug healthy (npx + playwright deps available).
- `audio-to-text` plug healthy (`DEEPGRAM_API_KEY` set or local equivalent configured).
- `text-to-audio` plug healthy.
- `desktop-x11` plug healthy if testing.
- All plugs' `smoke.sh` green at start (run `for s in .my_agent/capabilities/*/scripts/smoke.sh; do bash "$s" || echo "FAIL: $s"; done`).
- Test setup deliberately breaks a plug and runs the full loop; expects automatic restoration. **No manual intervention. No `systemctl restart`.**

**Deviation triggers:**

- Infrastructure blocker (Playwright not installed; STT not configured; MCP server startup races the test). Document in `proposals/s20-<slug>.md` and escalate — this sprint is the milestone gate.
- A plug type can't be deliberately broken in a way that's plausibly agent-caused (the test premise breaks). Propose alternative break.
- Reverify takes longer than the test timeout. Increase timeout; confirm wall-time within S16's measured envelope.

**Universal coverage check:** **this sprint IS the final coverage gate.** Every plug type in `.my_agent/capabilities/` exercised via either Exit-gate Test 1, Test 2, or an abbreviated replay. If any plug isn't exercised, M9.6 doesn't close.

**Milestone exit:** all tests pass + S16-S19 acceptance gates green + architect approval + CTO sign-off.

**Roadmap commit:** lands AFTER architect + CTO approval per Phase 1 §0.3 rule. **M9.6 done.**

---

## 3. Out of scope for Phase 3 (and for M9.6 entirely)

- Nested-CFR budget (`parentFailureId`) — stays parked.
- Adding new capability types beyond those in `.my_agent/capabilities/` at acceptance.
- Full redesign flow for `redesign-needed` escalation. M9.6 surrenders gracefully and logs.
- Real-artifact reverify for `image-to-text`. Fixture-only.
- CI audio via secrets (Phase 1 S7-FU3) — unchanged.
- Cross-conversation orphan recovery across automation + conversation boundaries.

These are tracked in `docs/ROADMAP.md` for future milestones if they become real.

---

## 4. Design feature → sprint coverage map

For audit traceability — every Phase 3 feature in `capability-resilience-v2.md` maps to a sprint:

| Design ref | Feature | Phase 3 sprint |
|---|---|---|
| §3.5 | Fix-engine swap (renderPrompt → buildFixModeInvocation) | S16 |
| §3.5 | `MODE: FIX` Step 0 gate | S16 |
| §3.5 | Hard-disable Steps 1-6 + .enabled write | S16 |
| §3.5 | `ESCALATE: redesign-needed` marker parsing | S16 |
| §3.5 | `ESCALATE: insufficient-context` marker parsing | S16 |
| §3.5 | `AutomationSpec.targetPath` | S16 |
| §3.5 | `spawnAutomation` closure copies targetPath | S16 |
| §3.5 | `.my_agent/` write-guard exemption for capability_modify | S16 |
| §3.5 | `JOB_TIMEOUT_MS` = 15 min for fix-mode | S16 |
| §3.5 | Surrender copy for new reasons | S16 |
| §3.5 | Authoring neutral-identifier convention | S16 |
| §3.5 / §6.3 | Wall-time measurement gate | S16 |
| §3.5 | `fix-automation.md` deprecation notice | S16 |
| §3.5 | Sibling-skill escape hatch documented | S16 |
| §5.3 | Reflect-phase collapse (state machine) | S17 (commit 1) |
| §5.3 | Reflect-phase collapse (orchestrator behavior) | S17 (commit 2) |
| §5.3 | `fix-automation.md` deletion | S17 (commit 3) |
| §3.6 | TTS path collapse (synthesizeAudio authoritative) | S18 |
| §3.6 | `sendAudioUrlViaTransport` / `sendTextViaTransport` split | S18 |
| §3.6 | Baileys `onSendVoiceReply` synthesis removed | S18 |
| §3.6 | TTS detection through CapabilityInvoker (formalize) | S18 |
| §5.3 | Per-conversation 30s ack-coalescing | S19 |
| §5.3 | N-aware coalescing | S19 |
| §5.3 | Combined surrender for parallel CFRs | S19 |
| §5.3 | `TranscriptTurn.failure_type` structured field | S19 |
| §5.3 | Assistant-turn orphan watchdog scan | S19 |
| §5.3 | `FAILURE_PLACEHOLDERS` dispatch table | S19 |
| §5.3 | System-origin dashboard health UI | S19 |
| v2.3 §8 / §5.3 | Exit-gate Test 1 (automation-origin browser) | S20 |
| v2.3 §8 / §5.3 | Exit-gate Test 2 (conversation-origin voice) | S20 |
| §5.3 | Abbreviated replays per plug type | S20 |
| §0 | Universal-coverage rule (every sprint review) | every sprint |

---

*Created: 2026-04-17*
*Authors: Opus 4.7 (course-correct from Opus 4.6 v2.3)*
