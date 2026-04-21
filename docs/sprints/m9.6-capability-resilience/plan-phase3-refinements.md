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

### 0.4 Operational rules learned in Phase 2

These are non-negotiable for any sprint that runs scripts against real installed plugs (S16 wall-time measurement, S20 exit gate):

**Env-mismatch protocol (mandatory).** When invoking a smoke or test script against a real plug that requires environment variables (`DEEPGRAM_API_KEY`, etc.), the dashboard service loads `packages/dashboard/.env` via `--env-file=.env` at process start, but a standalone shell does not. **Before reporting any "key not set" / `SMOKE_SKIPPED` result against a production plug:**

1. Source the dashboard env: `set -a && . packages/dashboard/.env && set +a`
2. Re-run the script with the env loaded.
3. Only after step 2 still fails, report the result to the architect.

Reporting `SMOKE_SKIPPED — key not on this machine` without first loading `.env` misleads the CTO into thinking the plug is unconfigured. The plug IS configured — your shell just doesn't see it. This rule was added to MEMORY.md after the S11 re-review (2026-04-17). See `feedback_env_mismatch_cto_notice.md`.

**Cross-package dist rebuild (operational).** Dashboard E2E tests resolve `@my-agent/core` via the compiled `dist/` directory, not source. After any `packages/core/src/` change, run `cd packages/core && npx tsc` before `cd packages/dashboard && npx vitest run` for the dashboard tests to pick up the change. Recorded in S15 D9 — flag in CONTRIBUTING.md if it bites Phase 3 frequently.

### 0.5 Inherited Phase 2 deferrals

Phase 2 architect deferred the following items to specific Phase 3 sprints (CTO deferral rule). The receiving-sprint sections below name each item explicitly:

| From | What | Receiving sprint |
|---|---|---|
| S10-FU-2 / S13-FU-1 | Remove legacy `bash` wrapper from `reverifyAudioToText`; make `invoker` required | S18 |
| S11-FU-2 | Strengthen `text-to-audio.md` template smoke to validate Ogg magic bytes | S18 |
| S11-FU-5 | Fix `tts-edge-tts/scripts/synthesize.sh` to transcode to Ogg per template contract (currently outputs MP3) | S18 |
| S15-FU-4 | `reverifyTextToAudio` audio format coverage strategy (format-agnostic check OR per-plug frontmatter contract) | S18 |
| S14-FU-1 / S15-FU-3 | `FRIENDLY_NAMES` → frontmatter migration (`registry.getFriendlyName(type)` reads from CAPABILITY.md) | S19 |
| S15 architect §3 | Extract shared E2E test helpers from S15's 4 duplicated `cfr-phase2-*` test files | S20 |
| S12 obs #1 | Multi-session `originFactory` "first active session wins" — track if parallel-conversation surfaces it | S20 |
| S15-FU-2 | `image-to-text` / `text-to-image` installed-plug E2E (no plug installed today; rule applies if installed during M9.6) | S20 framing only |

If any item ships earlier than its receiving sprint or doesn't ship at all by S20, the architect documents it in the closing review.

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
| S21 | M9.6 milestone-close fix sprint (S20 live-test bugs) | S20 | — |
| S22 | Tool capability recovery loop (S21 live-test gap) | S21 | — |
| S23 | Mode 3 verification + matcher fix (S22 follow-up — any plug-side failure recoverable) | S22 | — |
| S24 | Mode 4: daily silent self-heal + brief integration | S23 | — |

**Phase 3 exit (now S24):** the framework's recovery loop works for input, output, AND tool capabilities, across all four MCP failure modes (1: tool exception; 2: child crash mid-call; 3: server crashes at startup; 4: daily proactive health probe). Reactive failures (1+2+3) get real-time user-facing acks. Proactive (4) self-heals silently and surfaces in the next morning's brief. Live retests verify each. M9.6 closes.

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

### 2.2.1 Inherited from S16 architect review (2026-04-19)

S17 also inherits two items from the S16 re-review (`s16-architect-review.md` §7):

**Item A — M1 mitigation: pre-populate smoke output in MODE: FIX prompt (S16 wall-time mitigation)**

The current `buildFixModeInvocation` carries `symptom` and `detail` from the failure record but not the actual smoke.sh stderr output. Opus spends ~60–90 s per attempt re-running diagnostics CFR already has. Since S17 touches `runOneAttempt`, fold this in.

- `packages/core/src/capabilities/recovery-orchestrator.ts` —
  - Extend `AutomationSpec` with `smokeOutput?: string`.
  - In `runOneAttempt`, before `spawnAutomation`, capture the failure's smoke output (from the invoker's `failure.detail` if it carries it, or run smoke once to capture). Append to the prompt as a `## Smoke Output` section.
  - Acceptance test: prompt contains the smoke stderr text when supplied.
- Expected improvement per `proposals/s16-walltime-mitigation.md`: tts-edge-tts 8 min → ~7 min, browser-chrome 11 min → ~9.5 min (Branch C → B).

**Item B (HIGH PRIORITY) — Investigate orchestrator's 3-attempt iteration on 1-attempt fixes**

Both S16 wall-time runs showed Opus landing a real, verifiable fix at attempt 1 but the orchestrator iterating to attempts 2 and 3 because `executeResult.status === "failed"` from `awaitAutomation` despite `deliverable.test_result === "pass"`. This is a pre-existing orchestrator bug surfaced by the wall-time measurement, not introduced by S16.

**Investigation questions:**
1. Does `executeResult.status` reflect the automation worker's exit code, the deliverable's `test_result`, or `writePaperTrail`'s success? If the first, a worker that exits non-zero after writing a successful deliverable would trigger spurious iterations. Trace `automation-executor.ts` job-completion path.
2. Is `doReverify` running against stale capability state? Confirm `CapabilityWatcher` (chokidar) actually picks up `config.yaml` writes from a fix-mode worker before the orchestrator's next read. The TTS deliverable suspects this directly.
3. Does the `executeResult.status` enum distinguish "worker died after writing deliverable" from "worker died with no output"? The first should pass through the deliverable's verdict; the second should fail the attempt.

**If the investigation finds a root cause:** fix it in S17 alongside the reflect-collapse work. If the root cause is non-trivial (e.g., requires changes to `automation-executor.ts` or `CapabilityWatcher`), file `proposals/s17-orchestrator-iteration-investigation.md` with findings + scope estimate; architect picks whether to fix in S17, defer to S18, or split into a dedicated sprint.

**Why it matters:** the wall-time gate hit Branch B/C *only* because of the 3-attempt iteration. Per-attempt fix-mode wall-time was Branch A territory (122 s, 113 s). Fixing the iteration bug would bring wall-time well within the projection envelope and reduce overall fix-mode cost by ~3x.

**Universal coverage check (added):** the orchestrator-iteration fix (if it lands here) must be exercised against both script-plug and MCP-plug paths — the same two plugs S16 measured. Re-run the S16 wall-time script after the fix; expected per-plug wall-time drops to single-attempt territory.

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
- `packages/dashboard/src/chat/chat-service.ts:~1058` (`synthesizeAudio()`) — formalize CFR emission via `app.capabilityInvoker.run({capabilityType: "text-to-audio", scriptName: "synthesize.sh", ...})`. This was deferred in S10 and minimally wired in S15 (commit `3d3d321`); finalize here. Remove any remaining `// TODO(S13/S17)` (or `S15/S18`) marker.

**Files (inherited Phase 2 deferrals — must land in this sprint per §0.5):**

- `packages/core/src/capabilities/reverify.ts` — **remove the legacy `execFile("bash", scriptPath, ...)` fallback from `reverifyAudioToText`** (S10-FU-2 + S13-FU-1). Make `invoker` a required parameter on the `Reverifier` type and on `reverifyAudioToText`; assert/throw if not present. Migrate any remaining unit tests passing `undefined` invoker to use a mock invoker. Lines ~163–212 as of S13 — confirm at sprint-time via `grep -n 'execFile.*bash' packages/core/src/capabilities/reverify.ts`.
- `skills/capability-templates/text-to-audio.md` — strengthen reference `smoke.sh` to validate Ogg magic bytes (`OggS`) in addition to file size > 100 (S11-FU-2). Bring template up to par with the installed-plug smoke contract.
- `.my_agent/capabilities/tts-edge-tts/scripts/synthesize.sh` — **fix the plug's contract violation** (S11-FU-5). The `text-to-audio` template requires Ogg output; `edge-tts` outputs MPEG audio regardless of filename extension. Add an ffmpeg transcode step (`ffmpeg -i <mp3-temp> -c:a libopus -b:a 64k <ogg-out>`) so the script returns Ogg per the contract. Update the plug's `smoke.sh` to validate Ogg headers (revert the MP3 magic-byte check that S11-FU-5 documented as a workaround).
- `packages/core/src/capabilities/reverify.ts` (`reverifyTextToAudio`) — **decide and document the audio format coverage strategy** (S15-FU-4). Two options:
  - (a) **Strict + plug-side compliance** (recommended if S11-FU-5 fix above lands cleanly): remove MP3 magic-byte check from reverifier; rely on plug-side compliance with the Ogg-only template contract.
  - (b) **Format-agnostic fallback**: keep current Ogg/WAV/MP3 detection plus add `file size > 0 + exit 0` final fallback for unknown formats. Document the implicit acceptance.

  Choice goes in S18 `DECISIONS.md`. Default: (a). Pick (b) only if the plug fix in S11-FU-5 reveals format diversity beyond Ogg/MP3.

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

**Files (automation notifier — `AutomationNotifierLike` impl + `fixed`-outcome immediate fan-out, deferred from S12):**

S12's `AckDelivery` exposes a `notifier` dependency for automation-origin terminal acks but no concrete implementation is wired in `app.ts` — so `notifyMode === "immediate"` currently logs a warning and still writes `CFR_RECOVERY.md` (degraded but not broken). S12's terminal drain also skips the immediate-notification fan-out for the `"fixed"` outcome (writes the file only). Per S12 architect-review §6, both items land here:

- `packages/dashboard/src/app.ts` — wire a concrete `AutomationNotifierLike` implementation. Hook into the existing notification layer used by debrief delivery so automation-origin CFR recoveries can fire real-time notifications when `notifyMode === "immediate"`. Coordinate with the system-origin UI work above so health events and CFR recovery events share one notification surface.
- `packages/core/src/capabilities/ack-delivery.ts` — extend the automation-origin terminal branch: when `notifyMode === "immediate"` AND `outcome === "fixed"`, fire the notifier after `CFR_RECOVERY.md` is written (currently only the surrendered branch reaches the notifier). Per-origin try/catch still applies — notifier failure must not block other origins' draining.
- `packages/dashboard/tests/integration/cfr-automation-notifier.test.ts` *(new)* — `notifyMode === "immediate"` + `outcome === "fixed"` → CFR_RECOVERY.md written THEN notifier called; missing notifier degrades gracefully (warn + write); `notifyMode === "debrief"` does not call notifier at terminal time (debrief-prep handles narrative).

**Files (FRIENDLY_NAMES → frontmatter migration — inherited from S14-FU-1 / S15-FU-3):**

S14 hardcoded `FRIENDLY_NAMES` covers the six well-known types. The "Markdown is source of truth" principle (CLAUDE.md) calls for moving this into frontmatter so plug authors can override per-plug without code changes. Phase 2 architect deferred the migration to S19/S20.

- `packages/core/src/capabilities/types.ts` — add `friendly_name?: string` to the loaded capability metadata (and to the template/CAPABILITY.md frontmatter spec).
- `packages/core/src/capabilities/scanner.ts` — read `friendly_name` from frontmatter (template + plug-level; plug-level overrides template).
- `packages/core/src/capabilities/registry.ts` — add `getFriendlyName(type: string): string` method. Looks up a registered plug of the requested type; returns its `friendly_name` if set, else falls back to the hardcoded `FRIENDLY_NAMES` table, else returns the raw type string.
- `packages/core/src/capabilities/resilience-messages.ts` — `createResilienceCopy(registry)` uses `registry.getFriendlyName(type)` instead of the constant. Hardcoded table becomes the documented fallback for types not yet present in the registry.
- `skills/capability-templates/audio-to-text.md`, `text-to-audio.md`, `image-to-text.md`, `text-to-image.md`, `browser-control.md`, `desktop-control.md` — add `friendly_name:` field to each template's frontmatter with the current value from the hardcoded table.
- `packages/core/tests/capabilities/registry-friendly-name.test.ts` *(new)* — frontmatter override; missing-frontmatter fallback to hardcoded; missing-from-both fallback to raw type.
- `packages/core/tests/capabilities/resilience-messages-frontmatter.test.ts` *(new)* — copy uses frontmatter when present; no regressions vs S14's coverage test.

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

**Blocked on:** M9.4-S4.1 (brief section preservation + delivery-ack correctness) landing first. S4.1 fixes the byte-slice bug in `summary-resolver.ts:90` that silently dropped sections during debrief aggregation. Without S4.1, S20's CFR-fix output (multiple attempt deliverables aggregated) would still get truncated even after the new terse-deliverable contract below lands.

**Goal:** the two CTO-defined definitive smoke tests pass end-to-end on the dev machine with real plugs installed. **M9.6 closes here.**

**Files:**

- **NEW (added 2026-04-20 after M9.4-S4.1 handoff):** test-suite triage — see Task §2.5.0 below. Three dashboard tests are currently red on master; S20 cannot prove milestone-clean while baseline noise hides whether new work regressed anything.
- **NEW (added 2026-04-20 after M9.4-S4.1 incident):** the CFR-fix worker output contract change — see Task §2.5.1 below before the test files. This must land before the exit-gate tests run, otherwise S20's own debriefs will pollute the user's brief with forensic detail.
- **NEW (added 2026-04-20 from M9.4-S4.1 handoff §1):** any code path in this sprint that touches debrief aggregation must preserve the `WRAPPER_MARKER` contract — see the cross-cutting constraint below Task §2.5.0.
- **NEW (added 2026-04-20 from M9.4-S4.1 FOLLOW-UPS.md FU-8):** small cosmetic cleanup — see Task §2.5.0b below. Drop the unused `response` accumulator on the `send_failed` / `skipped_busy` exit branches in `conversation-initiator.ts`.

#### 2.5.0 Test-suite triage gate — clear the red baseline before feature work (added 2026-04-20)

**Why this exists.** S20 is the milestone exit. Returning a clean test suite is part of the exit. Three dashboard failures are currently inherited on master:

| Test | Failure | Hypothesis |
|------|---------|-----------|
| `tests/browser/capabilities-singleton-visual.test.ts` | sha256 mismatch vs baseline `capabilities-singletons.png` | Either real CSS regression in M9.5/M9.6 capability-card work, or stale baseline. |
| `tests/browser/capability-ack-render.test.ts` | `data.handleWebSocketMessage is not a function` on Alpine root | API renamed/removed without test migration. Could mask a real WS-wiring bug. |
| `tests/e2e/whatsapp-before-browser.test.ts` | `expected 0 to be greater than 0` — no STT-level CFR emitted | Pipeline behaviour drifted (deps-gate now blocks, or CFR signal moved); either the test premise is stale or a real pre-existing CFR detection regression. |

**Each failure must be root-caused, not silenced.** A "fix" that mutes the assertion without explaining why the previous behaviour was correct or what changed is a deviation per §0.4 — escalate instead.

**Files:**

- `packages/dashboard/tests/browser/capabilities-singleton-visual.test.ts` + `docs/sprints/m9.5-s7-browser-capability/screenshots/baseline/capabilities-singletons.png` — diff `*.actual.png` vs baseline; if intended-change, regenerate baseline with `UPDATE_VISUAL_BASELINES=1` and document what changed in the sprint DECISIONS file (one line: "baseline refreshed; CSS change: <brief>"). If unintended regression, fix the dashboard CSS / Alpine template — do NOT silently update the baseline.
- `packages/dashboard/tests/browser/capability-ack-render.test.ts` + `packages/dashboard/public/js/chat.js` (or wherever the Alpine `chat()` component lives) — find the rename/removal of `handleWebSocketMessage`; either restore the function name or migrate the test to call the current API. If the function was intentionally removed without a replacement, audit real consumers (broadcast handlers, WS wiring) before marking the test stale.
- `packages/dashboard/tests/e2e/whatsapp-before-browser.test.ts` — re-run with logging to see what the pipeline actually emits when an audio-bearing WhatsApp message hits a deps-wired-but-no-STT environment. If a different CFR/signal type is emitted, update the assertion to match the new contract and document the contract drift; if no signal is emitted at all, that's a regression in CFR detection — root-cause first.
- `docs/sprints/m9.6-capability-resilience/s20-DECISIONS.md` — D-X (assign at sprint-time) — capture per-failure root cause + fix rationale in three short paragraphs.
- `docs/sprints/m9.6-capability-resilience/s20-FOLLOW-UPS.md` — if any failure surfaces a deeper bug whose fix exceeds S20 scope (e.g., a multi-day refactor of WS wiring), file it as a follow-up and apply the minimal patch to green the test, with a `// TODO(FU-N)` reference and a sprint-DECISIONS note.

**Acceptance:** all three tests green on the dev machine. `npx vitest run` in both `packages/dashboard` and `packages/core` reports zero failures.

**Verification command:**

```bash
cd packages/dashboard && npx vitest run tests/browser/capabilities-singleton-visual tests/browser/capability-ack-render tests/e2e/whatsapp-before-browser
cd packages/dashboard && npx vitest run   # full suite, must be green
cd packages/core && npx vitest run        # already green at S19 close, regression gate
```

Expected: zero failed.

**Deviation triggers:**

- A failure root-causes to a multi-day fix that would blow S20's envelope. File a follow-up sprint, apply minimal patch with TODO marker, document in DECISIONS — do NOT skip the test.
- A baseline refresh is needed but the underlying CSS change isn't traceable to a specific recent commit. Walk `git log -- packages/dashboard/public/` since the baseline-add commit (`a6285fe`) and identify the commit; if multiple candidates, document the ambiguity.
- A test is genuinely obsolete (the feature it covers was deleted). Delete the test file with a DECISIONS entry naming the commit that removed the feature.

**Out of scope:**

- Reviving any of the 18 currently-skipped tests (`describe.skipIf(!dashboardAvailable)`, `live/*` skips). Skips are gates, not failures.
- Touching `packages/core` tests — green at S19 close; only run as the regression gate.

**Why it's first.** The dev needs a clean baseline to know whether their S20 work breaks anything. Running new feature work against a 3-failure baseline means every failure-set diff requires manual subtraction.

#### 2.5.0b FU-8 cleanup — drop unused `response` accumulator on error/busy exits (added 2026-04-20)

**Why this exists.** Inherited from M9.4-S4.1 FOLLOW-UPS.md FU-8. The S4.1 review flagged that `conversation-initiator.ts:177-190` (the external same-channel path) accumulates `response` from `text_delta` events for the happy path's `forwardToChannel(response, targetChannel)` call, but on the `send_failed` and `skipped_busy` exit branches control returns before `forwardToChannel` runs — leaving the accumulator as dead state on those branches. Not a bug; cosmetic readability debt. Pulled into S20 because S20 is closing M9.6 cleanly and this is a one-file edit.

**Files:**

- `packages/dashboard/src/agent/conversation-initiator.ts` — at lines 177-190 (verify line numbers at sprint-time; S4.1 may have shifted them), conditionally accumulate `response` only when the loop is on the happy path, or restructure so the accumulator isn't touched on the error/busy exits. Pick whichever shape is more readable; behaviour must not change on the happy path.
- `packages/dashboard/tests/unit/agent/conversation-initiator-alert-outcome.test.ts` (existing from S4.1) — already covers happy + error + busy outcomes. **No new test required** — the existing assertions on `AlertResult` shape catch any behavioural regression. Verify all three S4.1 outcomes still pass post-cleanup.
- `docs/sprints/m9.6-capability-resilience/s20-DECISIONS.md` — D-X (assign at sprint-time) — one line: "FU-8 closed in S20; no behaviour change."
- `docs/sprints/m9.4-s4.1-brief-section-preservation/FOLLOW-UPS.md` — annotate FU-8 with `✅ ADDRESSED IN M9.6-S20` (matching the FU-6 close pattern).

**Acceptance:** `conversation-initiator-alert-outcome.test.ts` (3 tests) still green; visual diff of the changed function shows the accumulator is no longer assigned on the `send_failed` / `skipped_busy` branches.

**Verification command:**

```bash
cd packages/dashboard && npx vitest run tests/unit/agent/conversation-initiator-alert-outcome
```

Expected: 3/3 pass.

**Deviation triggers:**

- Line numbers don't match — locate the same logical branches by behaviour (the two paths that return without calling `forwardToChannel`).
- The cleanup uncovers a real bug (e.g., a branch that should have been calling `forwardToChannel` and wasn't). Stop, document in proposals, escalate — this is a cosmetic task, not a behaviour-fix scope.

**Out of scope:**

- Touching the happy-path branch (works correctly today).
- Refactoring the broader `alert()` / `initiate()` mediator pattern (S4.1's surface; stable).
- Type-alias consolidation (FU-3, explicitly deferred).

#### Cross-cutting constraint: WRAPPER_MARKER preservation (added 2026-04-20 from M9.4-S4.1 handoff §1)

S20's exit-gate tests assert that the automation's debrief includes a CFR recovery summary (Task §2.5.2 Test 1, last assertion). The debrief aggregator at `handler-registry.ts` prefixes every worker section with `<!-- wrapper -->\n` immediately before `## automationName`; `summary-resolver.ts` keys section extraction off this exact marker. **Any S20 work that touches `handler-registry.ts` aggregation, the CFR recovery summary writer, or the debrief-prep section assembly MUST preserve this prefix.**

The contract is enforced by `summary-resolver.test.ts` → `"wrapper-marker contract"` suite, which asserts at test-time that `handler-registry.ts` imports `WRAPPER_MARKER` from `summary-resolver.ts`. If this test starts failing during S20, do not "fix" it by hard-coding the marker string elsewhere — restore the import.

#### 2.5.1 CFR-fix worker output contract — terse `deliverable.md` + sibling `attempts.md` (added 2026-04-20)

**Why this exists.** During M9.4-S4.1 investigation on 2026-04-20, the team confirmed: even after S4.1 fixes the section-drop, CFR-fix output will still dominate the Haiku 10K condense budget. Each fix-mode attempt produces a ~2–3K forensic deliverable; three attempts aggregate above the threshold. Once S20's exit-gate tests fire real CFR fixes, the resulting debriefs will push out other automations' brief sections under the new no-truncation rule. The user-facing signal is "voice capability broken, now fixed" — not the three-attempt forensic diary. Full forensic detail still gets written, but to a sibling file the debrief-reporter doesn't aggregate.

**Files:**

- `packages/core/skills/capability-brainstorming/SKILL.md` — Step 0 Fix Mode item 5 (deliverable spec) — change the deliverable.md contract:
  - **Body:** **terse one-liner per attempt**, 2–5 lines TOTAL across all attempts. Format: `Attempt {N}: {outcome} — {file changed | "no change"}`. No diagnosis prose, no decision log, no per-attempt state, no validation commands in `deliverable.md`.
  - **Frontmatter:** unchanged (`change_type`, `test_result`, `hypothesis_confirmed`, `summary`, `surface_required_for_hotreload`).
  - **`summary` frontmatter field:** stays one short sentence (already the contract); summarises the FINAL outcome across attempts, not the journey.
  - **NEW sibling file:** `<runDir>/forensic.md` — full per-attempt detail (diagnosis, hypothesis, change explanation, smoke output, validation commands). The fix-mode skill writes this in Step 5 alongside `deliverable.md`. Format is free-form prose; this file is for human/agent audit, not automated aggregation.
- `packages/core/src/capabilities/recovery-orchestrator.ts` — `readDeliverable()` already reads the frontmatter + body. **No change needed** — the orchestrator's existing logic continues to work with shorter bodies. Verify at sprint-time that `surrenderReason` parsing still finds the `ESCALATE:` marker (it's at body start; one-liner format keeps it at body start).
- `packages/dashboard/src/scheduler/jobs/debrief-prep.ts` — verify the existing reader behavior. It currently reads `deliverable.md` body for the brief; with the terse body, the brief stays terse. **Optional NEW reader:** if the reporter wants to surface the forensic file's existence (e.g., "full diagnosis available at <path>"), add a one-line reference. Don't read the forensic content into the brief — that's the whole point.
- `packages/core/tests/skills/capability-brainstorming-gate.test.ts` (existing from S16) — extend the regression assertions to verify Step 0 Fix Mode now references `forensic.md` and the terse deliverable contract:
  - `expect(content).toContain("forensic.md")` — sibling file named.
  - `expect(content).toMatch(/2[–-]5 lines|terse|one-liner/i)` — terse contract present.
  - The existing R3 regression assertions (Steps 1-6 still exist + key authoring phrases) must continue to pass. Adding to the same gate test keeps the SKILL.md edit one-touch.
- `packages/core/tests/capabilities/fix-mode-deliverable-contract.test.ts` *(new)* — runs the fix-mode skill against a stub plug (same harness as `fix-mode-integration.test.ts`), asserts:
  - `deliverable.md` body line count ≤ 5
  - `deliverable.md` body matches the per-attempt format (regex per spec above)
  - `forensic.md` exists in the same `run_dir`
  - `forensic.md` body length > deliverable.md body length (the forensic detail actually went somewhere)
- `docs/sprints/m9.6-capability-resilience/s20-DECISIONS.md` — D-X (assign at sprint-time) — capture the contract change rationale. Reference the M9.4-S4.1 incident.

**Acceptance test:** the existing CFR-fix run dirs from S15/S16/S17/S18/S19 use the OLD contract. Don't retroactively edit those — they're history. The new contract applies only to S20's exit-gate fix runs and beyond.

**Verification command:**

```bash
cd packages/core && npx vitest run tests/skills/capability-brainstorming-gate tests/capabilities/fix-mode-deliverable-contract
```

Expected: all pass.

**Deviation triggers:**

- The terse deliverable format breaks `recovery-orchestrator.readDeliverable()` ESCALATE marker parsing (verify ESCALATE marker stays at body start in the new format).
- The forensic.md sibling file collides with an existing artifact name in any worker template.
- A test elsewhere depended on the old verbose deliverable body (grep for `deliverable.md` consumers; expand if found).

**Out of scope:**

- Retroactive editing of historical CFR-fix run dirs.
- Aggregating multiple `deliverable.md` files at the debrief layer (covered by M9.4-S4.1's no-truncation aggregation; this contract change makes that aggregation produce sensible output).
- Changing the format for non-CFR automations' deliverables — those follow their own contracts.

**Why it's in S20, not M9.4-S4.1:** S4.1 is a framework-level fix (no truncation, no silent drops). The terse-deliverable contract is an automation-template change scoped to the CFR-fix path. Cleaner separation: S4.1 makes the framework not lose data; S20 makes the CFR template not flood it.

---

#### 2.5.2 Exit-gate tests (the original §2.5 work)

- `packages/dashboard/tests/e2e/cfr-exit-gate-helpers.ts` *(new — inherited from S15 architect §3, S15-FU code-duplication note)* — extract shared E2E helpers from S15's four `cfr-phase2-*-replay.test.ts` files (~200 lines duplicated each: agentDir setup, plug-break helpers, CFR-emit harness, recovery-loop assertions). DRY before S20 adds two more E2E tests. The helper API surface is a sprint-time call: target ~150 lines factored, ~50 lines per remaining test file. Don't over-abstract.
- `packages/dashboard/tests/integration/app-harness.ts` — extend with the `MockTransport` recording shape: implements the transport interface and records every `send` call with args; injection point in `AppHarness`. **Note:** S15 deliberately substituted the direct-emit pattern (S15 D-EXT, D2). For S20, the recording mock is required for Exit-gate Test 2 — voice reply via the conversation's transport must be captured by the mock to assert "delivered, not silently dropped." The S15 substitution does not cover this assertion shape.
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

**Acceptance:** both exit-gate tests green; abbreviated replays green for every registered plug type; **plus** Task §2.5.0's zero-failed-tests gate holds at sprint close (no new failures introduced by S20 work, no pre-existing failures left behind).

**Verification:**

```bash
cd packages/dashboard && npx vitest run tests/e2e/cfr-exit-gate-automation tests/e2e/cfr-exit-gate-conversation tests/e2e/cfr-abbreviated-replays
```

Dev-machine preconditions:
- **Source `packages/dashboard/.env` before running smoke checks** (per §0.4 env-mismatch protocol). Without this, plugs that need API keys (`stt-deepgram` → `DEEPGRAM_API_KEY`) report `SMOKE_SKIPPED` falsely.
- `browser-chrome` plug healthy (npx + playwright deps available).
- `audio-to-text` plug healthy (`DEEPGRAM_API_KEY` set; verify with the env-loaded smoke).
- `text-to-audio` plug healthy. **Note:** `tts-edge-tts/.enabled` may still be absent in production per S15 D6 / FU-0. If S20 includes TTS in abbreviated replays, either re-enable in production (CTO action — see `s15-FOLLOW-UPS.md` FU-0) or scaffold per the S15 test pattern (copy plug to test agentDir without `.enabled`, exercise the recovery loop).
- `desktop-x11` plug healthy if testing (or expect SMOKE_SKIPPED on a headless test host — handled as inconclusive-pass per S11 hermeticity rule).
- All plugs' `smoke.sh` green at start: `set -a && . packages/dashboard/.env && set +a && for s in .my_agent/capabilities/*/scripts/smoke.sh; do bash "$s" || echo "FAIL: $s"; done`
- Core dist rebuilt before dashboard E2E (per §0.4): `cd packages/core && npx tsc`
- Test setup deliberately breaks a plug and runs the full loop; expects automatic restoration. **No manual intervention. No `systemctl restart`.**

**Multi-session originFactory observation (inherited from S12 architect obs #1):**

`CapabilityInvoker.originFactory` at `app.ts:549-557` uses "first active session wins" — the brain's single-session-per-conversation assumption today. If S20's exit-gate tests run two parallel conversations (or set up such a scenario), this surfaces as a latent bug: a CFR from conversation B may be tagged with conversation A's origin. **S20's tests as-specified above do not exercise parallel conversations.** Either:
- (a) Add a parallel-conversation assertion to `cfr-exit-gate-conversation.test.ts` (run two STT incidents back-to-back from different conversations; assert origin tagging is correct per conversation). This is the more rigorous gate.
- (b) Document the deferral in S20 `DECISIONS.md`: parallel-conversation origin tagging untested in M9.6; surfaces in M10+ when channel concurrency lands. Track for whichever M10 sprint introduces multi-session.

Default: (a) for higher exit-gate confidence. Pick (b) only if the parallel-conversation harness work overruns the sprint.

**Image-plug coverage note (inherited from S15-FU-2):**

No `image-to-text` or `text-to-image` plug is installed in `.my_agent/capabilities/` at S20 start. Per the §0.1 universal-coverage rule, this is **named non-coverage**, not omission. The per-type reverifiers (S13) and friendly-name copy (S14) are in place; an installed-plug E2E only gets exercised if a plug lands during M9.6. If one does, S20 picks it up; if not, the `S20 DECISIONS.md` records "no installed image plug at exit; rule satisfied via fixture-only reverify covered by `reverify-image-to-text.test.ts` and `reverify-text-to-image.test.ts`."

**Deviation triggers:**

- Infrastructure blocker (Playwright not installed; STT not configured; MCP server startup races the test). Document in `proposals/s20-<slug>.md` and escalate — this sprint is the milestone gate.
- A plug type can't be deliberately broken in a way that's plausibly agent-caused (the test premise breaks). Propose alternative break.
- Reverify takes longer than the test timeout. Increase timeout; confirm wall-time within S16's measured envelope.

**Universal coverage check:** **this sprint IS the final coverage gate.** Every plug type in `.my_agent/capabilities/` exercised via either Exit-gate Test 1, Test 2, or an abbreviated replay. If any plug isn't exercised, M9.6 doesn't close.

**Milestone exit:** all tests pass (full `packages/dashboard` and `packages/core` suites — **zero failed**, per Task §2.5.0) + S16-S19 acceptance gates green + architect approval + CTO sign-off. The clean test suite is a hard gate, not a soft target — if any failure remains at sprint close, S20 does not exit and M9.6 does not close.

**Roadmap commit:** lands AFTER architect + CTO approval per Phase 1 §0.3 rule. *(Note: post-2026-04-20 S20 live-test discovery, M9.6 closure moves to S21 — see §2.6 below.)*

---

### 2.6 Sprint 21 — M9.6 milestone-close fix sprint (production wiring bugs from S20 live test, added 2026-04-20)

**Why this exists.** S20 delivered the test infrastructure, terse contract, FU-8 cleanup, and three test-triage fixes. The unit/integration suite was clean (1347/0). The abbreviated E2E replays passed. **But the live /pair-browse milestone sign-off test on 2026-04-20 — CTO sent a real voice message over WhatsApp with both STT and TTS plugs deliberately broken — exposed three production wiring bugs that every prior test layer missed plus a process bug.** See `s20-test-report.md` for the full timeline.

The user-facing CFR contract — *"user sees 'hold on' ack, then receives the real answer to the original message"* — does not work end-to-end in the real app. Unit tests passed because they used isolated orchestrators with their own `emitAck` callbacks. The integration tests passed because they mocked `TransportManager`. The abbreviated E2E tests passed because they didn't exercise the full conversation-origin acknowledgement path (TTS test asserts `terminal-fixed` ack-kind in callbacks, NOT delivery to the conversation's transport). Only the live test exposed that the production wiring between `RecoveryOrchestrator → AckDelivery → TransportManager` is broken.

**M9.6 cannot close until S21 fixes these and the full user-facing contract is verified end-to-end on the live system.**

**Files (BUG-1 — AckDelivery wiring):**

- `packages/dashboard/src/app.ts` — locate where `AckDelivery` is constructed and where `emitAck` is wired into `RecoveryOrchestrator`. The instance must be passed the live `TransportManager` (not null, not a stub). Trace the `[CFR] AckDelivery unavailable (TransportManager or ConnectionRegistry missing)` log line to its source — that branch is what's firing in production today. Verify both `transportManager` AND `connectionRegistry` are non-null at the construction site.
- `packages/core/src/capabilities/ack-delivery.ts` — verify the unavailability check is the right shape: it should warn-and-no-op only if the dependencies are genuinely absent, not if they're present but mis-wired. Add a constructor-time assertion if the production codepath requires both deps (don't rely on call-site nullability).
- `packages/dashboard/tests/integration/cfr-ack-delivery-wiring.test.ts` *(new)* — boots a real `App` (via `app-harness.ts`), wires a `MockTransport`, fires a CFR, asserts that `mockTransport.sends.length > 0` for the conversation's channel. **This test would have caught BUG-1 before the live run.** It's the regression test that must accompany the fix.

**Files (BUG-2 — brain races CFR):**

S20 live timeline (19:10:20 → 19:10:31 = 11 seconds): voice arrives → STT CFR fires → fix automation spawned → **brain processes turn with `[Voice message — transcription unavailable]` fallback text and replies "Voice transcription is down again. Can you resend as text?"** before fix completes. Even after the fix succeeds and reverify recovers the original transcription, the brain has already committed to the wrong reply.

**Design decision (architect):** Option (a) — gate the brain pending CFR completion. The brain session must NOT receive the fallback text turn while a CFR is dispatched for that turn. When the orchestrator calls `reprocessTurn`, the real text is injected. If CFR surrenders (after orchestrator's job timeout, currently 15 min from S16), the fallback text is injected then with terminal-surrender framing.

Reasoning: option (b) — sentinel fallback text the brain learns to ignore — relies on prompt-engineering reliability and is fragile. The brain might still reply. Option (a) is the architecturally correct answer; the orchestrator already owns the timeout, so the brain doesn't need to invent its own.

- `packages/dashboard/src/conversations/message-handler.ts` (or wherever STT failure converts to brain-injected text — verify location at sprint-time) — add a CFR-pending gate. When STT fails AND a CFR is dispatched for the turn, hold the message in a "pending CFR" state. Do NOT inject the fallback text into the brain session.
- `packages/core/src/capabilities/recovery-orchestrator.ts` — when `reprocessTurn` is called, the message-handler must release the pending state and inject the recovered text. When the orchestrator surrenders (`SURRENDERED_TERMINAL` state), the message-handler must release the pending state and inject the fallback text with surrender framing ("transcription couldn't be recovered — would you like to send as text?"). Both transitions must signal the message-handler.
- `packages/dashboard/tests/integration/brain-cfr-race-gate.test.ts` *(new)* — boots a real `App`, simulates an STT-bearing turn arrival with a registered orchestrator that delays `reprocessTurn` by 2 seconds, asserts that no brain reply is generated during the 2-second window AND that the brain reply uses the recovered transcription (not the fallback). Second test: orchestrator surrenders after 1 second, brain reply uses the surrender framing.
- `packages/dashboard/tests/integration/brain-cfr-race-timeout.test.ts` *(new)* — orchestrator never calls `reprocessTurn` and never surrenders; pending-state must time out after 15 min (test-time = 200 ms via injected clock); brain receives the fallback with timeout framing.

**Files (BUG-3 — `reverifyAudioToText → reprocessTurn` chain):**

S20 live timeline: STT fix completed at 19:13:17 (`.enabled` created at 19:11). No `reprocessTurn` log entry appears. No `terminal-fixed` ack for `audio-to-text`. Three candidate causes per the test report — all need investigation:

1. The raw audio file path stored in the CFR failure event is not accessible at reverification time (path mismatch between conversation runtime and orchestrator).
2. `reverifyAudioToText` throws and the error is swallowed.
3. The orchestrator's `awaitAutomation` returns a non-`done` status (e.g., `completed` not normalized — but S17 fixed that; verify the fix actually applies here).

- `packages/core/src/capabilities/recovery-orchestrator.ts` — instrument the conversation-origin terminal path with detailed logging (every state transition, every reverify call, every reprocessTurn call). Sprint dev runs the live test once with logging on, identifies which step is failing.
- `packages/core/src/capabilities/reverify/audio-to-text.ts` (verify path at sprint-time) — wrap reverify in a try/catch and log the error if it throws. Currently a thrown error may be silently swallowed by the orchestrator's outer handler.
- Whatever production reverify file fails — fix the bug found.
- `packages/dashboard/tests/integration/cfr-stt-reprocess-chain.test.ts` *(new)* — boots a real `App` with stub registry that fails STT once then succeeds, registers a real orchestrator, fires a conversation-origin CFR with `rawMediaPath` pointing to a fixture audio file, asserts that `reprocessTurn` IS called with non-empty text and that `terminal-fixed` ack is emitted. **This test would have caught BUG-3 before the live run.**

**Files (BUG-4 — terse SKILL.md not synced):**

S20 live: TTS fix attempts a2 and a3 wrote deliverables of 3071 and 2629 chars. Terse contract requires ≤5 lines. Root cause: production agent reads from `.my_agent/brain/skills/`, the instance copy. `packages/core/skills/` was updated but the copy wasn't synced.

- `.my_agent/brain/skills/capability-brainstorming/SKILL.md` — copy from `packages/core/skills/capability-brainstorming/SKILL.md`. Verify `diff` shows zero output post-copy.
- `packages/core/src/skills/sync.ts` *(new)* — small utility that reads `packages/core/skills/` and writes to `<agentDir>/brain/skills/`. Hash-based change detection (SHA-256 of source file → only copy if different).
- `packages/dashboard/src/app.ts` — call the sync utility at app startup (after agentDir is known, before the brain session opens). Log "skills synced: N files" or "skills already in sync" so it's visible.
- `packages/core/tests/skills/skills-sync.test.ts` *(new)* — temp dir as agentDir; populate `packages/core/skills/foo.md`; run sync; assert the file exists at `<agentDir>/brain/skills/foo.md` with identical content; modify source; re-run sync; assert update propagates.
- `packages/core/tests/skills/skills-sync-startup.test.ts` *(new)* — boots `App`, asserts that on startup the agent's `brain/skills/capability-brainstorming/SKILL.md` matches `packages/core/skills/capability-brainstorming/SKILL.md` byte-for-byte. **This test catches the drift class as a pattern, not just BUG-4.**

**Files (BUG-5 — `cfr-exit-gate-automation` precondition mismatch):**

S20 test report: this test SKIPPED with `canRun = false` despite `browser-chrome` plug being installed. Either the precondition check is buggy or the plug-presence detection didn't see the same files in the test env.

- `packages/dashboard/tests/e2e/cfr-exit-gate-automation.test.ts` — instrument the precondition check (`hasBrowserPlug`, `hasAuth`) at test boot to log which check returned false and why. Run the test once with the instrumentation, identify the gap, fix it.
- `packages/dashboard/tests/e2e/cfr-exit-gate-helpers.ts` — if the precondition logic lives here (e.g., `findAgentDir`), trace whether the path resolution matches between test environments. Possibly a `__dirname` resolution issue when run from a specific subdirectory.

**Files (BUG-6 — brain unaware of degraded output capabilities; falsely claims voice works in text-fallback replies, added 2026-04-21):**

The 2026-04-21 live retest (see `s21-live-retest.md`) confirmed BUG-1 through BUG-5 are fixed. But it surfaced a new failure mode the inverted CFR ack ordering was a symptom of: when TTS is unhealthy and the message-handler falls back to text, **the brain doesn't know its own output medium has degraded.** It commits to audio-friendly content ("Loud and clear!", "Voice is working great") that gets delivered as text — a self-contradicting message. Conversation `conv-01KP3WPV3KGHWCRHD7VX8XVZFZ` turns 42, 43, 44 all show this: each assistant turn has `failure_type: "text-to-audio"` and no `audioUrl`, while the text content asserts voice works. Same M9.4-S4.1 invariant violated (*"never claim delivered when session was busy or errored"*) — applied to OUTPUT medium.

The dev's `s21-live-retest.md` framing of "TTS recovered silently, subsequent replies delivered as audio" misread the transcript — turn 45 was the first reply with a real `audioUrl`; turns 42-44 were silent text-fallbacks with false-positive voice content. The TTS attempt-ack arriving AFTER the text reply (the "wrong order" the report flagged at 6/10 clarity) is a downstream symptom: the brain shipped contradictory content before the recovery signal could reach the user.

**Design (architect, 2026-04-21):** brain awareness via system prompt, **not** capability-specific code in the message-handler. The brain reads degraded-capability state from the registry at prompt-assembly time and authors the acknowledgement in its own voice. One prompt section, one registry read, zero per-capability branching. Generic — works for any capability that becomes unhealthy, not just TTS.

- `packages/core/src/agent/system-prompt-builder.ts` (or whichever 6-layer builder layer surfaces capability state — verify exact location at sprint-time; likely the same layer that already lists installed capabilities) — append a "Currently degraded (auto-recovery in progress)" section, populated from the registry. Section content: bulleted list of `friendly_name` (per-template, S19) for every capability whose health state is `unhealthy` / `recovering` / similar (use the registry's existing health enum — don't invent a new one). Followed by one short instruction: *"If a capability you'd normally use for THIS reply is in this list, briefly acknowledge it in your own voice (one short sentence, no padding). If nothing here is relevant to the reply you're about to write, ignore this section."* Section is OMITTED entirely when no capabilities are degraded — no empty header.
- `packages/core/src/capabilities/registry.ts` — if a `listDegraded()` (or equivalent) method doesn't already exist on the registry, add one. ~5 lines reading from existing health state. Returns `{ name, friendly_name, type }[]`.
- `packages/dashboard/tests/integration/system-prompt-degraded-capabilities.test.ts` *(new)* — three tests: (a) all capabilities healthy → section absent from assembled prompt; (b) one capability marked degraded → section present, lists that capability's `friendly_name`; (c) capability transitions back to healthy → next prompt assembly omits the section. Use a real `CapabilityRegistry` with synthetic state, not a mock.
- `docs/sprints/m9.6-capability-resilience/s21-DECISIONS.md` — D-X (assign at sprint-time): "BUG-6 fix is generic — system prompt + registry read; no per-capability code. Brain authors the wording. The pattern works for any future capability degradation."
- `docs/sprints/m9.6-capability-resilience/s21-live-retest.md` — annotate that the original 6/10 clarity finding was a downstream symptom of BUG-6, not the root cause; correct the "TTS recovered silently, subsequent replies delivered as audio" framing once BUG-6 retest confirms turns now match audioUrl + content.

**Optional companion change (CTO decision):** suppress the user-facing TTS `attempt` ack entirely for output-class capabilities. Once the brain itself acknowledges the degradation, the ack is redundant. Paper trail (`DECISIONS.md`, system-origin Settings panel) is unaffected — only the user-facing WhatsApp/dashboard message is suppressed. If left in, it's harmless background noise; if suppressed, one fewer message per recovery. **Default: suppress.** Confirm at sprint-time.

**Acceptance for S21 close:**

| Gate | Verification |
|------|--------------|
| BUG-1 fixed | New `cfr-ack-delivery-wiring.test.ts` passes; live test sees "hold on" ack on WhatsApp |
| BUG-2 fixed | New `brain-cfr-race-gate.test.ts` + timeout test pass; live test does NOT show brain replying before fix completes |
| BUG-3 fixed | New `cfr-stt-reprocess-chain.test.ts` passes; `cfr-exit-gate-conversation.test.ts` (S20 file) passes; live test, brain answers the original voice message correctly after fix |
| BUG-4 fixed | New `skills-sync.test.ts` + `skills-sync-startup.test.ts` pass; live test, fix-mode deliverables are ≤5 lines |
| BUG-5 fixed | `cfr-exit-gate-automation.test.ts` runs (not skipped) and passes on the dev machine |
| BUG-6 fixed | New `system-prompt-degraded-capabilities.test.ts` (3 cases) passes; live retest, brain text-fallback replies acknowledge "voice fix in progress" in Nina's own voice and do NOT contain false-positive claims like "loud and clear" while `failure_type: text-to-audio` is set on the assistant turn |
| Live retest | CTO repeats /pair-browse with both STT and TTS deliberately broken. Pass conditions: (a) "hold on" ack arrives on WhatsApp; (b) real reply to the voice message after STT recovers; (c) every text-fallback reply acknowledges the TTS degradation (no contradiction between `failure_type` and content); (d) once TTS recovers, replies are delivered as audio with no further acknowledgement |

**Verification command (full suite + live retest):**

```bash
cd packages/dashboard && npx vitest run                    # full suite, 0 failures
cd packages/core && npx vitest run                          # full suite, 0 failures
env -u CLAUDECODE node --env-file=packages/dashboard/.env \
  node_modules/.bin/vitest run \
  tests/e2e/cfr-exit-gate-automation \
  tests/e2e/cfr-exit-gate-conversation \
  tests/e2e/cfr-abbreviated-replays                         # all pass, none skipped (with plugs + auth)
# Live: CTO sends voice message via WhatsApp with both plugs broken; observes correct flow
```

**Deviation triggers:**

- BUG-2 design decision changes — if the brain-CFR gate proves harder to implement than expected (e.g., the brain session's turn-injection point is structured differently than spec), escalate to architect with a proposal in `proposals/s21-brain-cfr-gate.md`. Do NOT silently fall back to option (b) sentinel-text.
- BUG-3 turns out to be in the message-handler not the orchestrator (e.g., the orchestrator IS calling reprocessTurn but the message-handler isn't actioning it). Fix the actual location; document the expected vs actual call shape in DECISIONS.
- BUG-4 sync mechanism reveals that `packages/core/skills/` and `.my_agent/brain/skills/` have drifted on OTHER files too (not just `capability-brainstorming/SKILL.md`). Diff all skills; document drift in DECISIONS; sync them all (with a one-line per-file note in the commit message).
- BUG-6 — the registry has no `listDegraded()` equivalent and adding one requires a non-trivial health-state refactor (S19 surfaced ring-buffer + `/api/capabilities/cfr-system-events`; the health enum may be split across modules). Document the gap in DECISIONS and propose the simplest adapter that keeps BUG-6 self-contained — do NOT refactor the registry's health state machine in S21.
- BUG-6 — the system-prompt-builder layer that owns capability state turns out to be in the dashboard package (not core). Fine — implement there; reference the registry method via the existing core import path.

**Out of scope for S21:**

- Refactoring the brain session lifecycle beyond what BUG-2's gate requires.
- Migrating any of the 22 currently-skipped tests to non-skipped state (other than BUG-5's exit-gate-automation).
- Touching `RecoveryOrchestrator` state machine logic beyond fixing BUG-3 (the orchestrator is mostly correct; this is a wiring or instrumentation fix).
- New CFR-fix template work (the contract change landed in S20; only the sync is open).

**Why it's S21, not amended into S20:** S20 shipped substantive work (test infra, terse contract, FU-8, test triage). The bugs are NEW discoveries from the live test, not S20 work products. Splitting keeps S20 sprint artifacts intact and makes the milestone-close gate clearly attributable. The dev's S20 commits (still uncommitted at architect-review time) should land as S20; S21 starts from there.

**Milestone exit:** all five bugs fixed + new regression tests green + S20's exit-gate-conversation test green + live retest signed off by CTO + architect approval. **M9.6 closes here.**

**Roadmap commit:** lands AFTER architect + CTO approval per §0.3. *(S16 and S20 dev have both made the same premature-Done mistake; S21 dev: do NOT pre-mark Done. Wait for sign-off.)*

---

### 2.7 Sprint 22 — Tool capability recovery loop (added 2026-04-21)

**Why this exists.** S21 closed cleanly for input (STT) and output (TTS) capabilities. The 2026-04-21 live retest of the third shape — **tool capabilities** (browser-control, desktop-control) — exposed a structural gap that no prior sprint built for. See `tool-capability-cfr-gap.md` for the full live-test transcript and dev analysis.

**The architectural gap:** M9.6's recovery machinery was designed around the STT incident. Phase 1 built the input-recovery loop; Phase 2 generalized the **detection and fix-execution** machinery (CFR detector, orchestrator, fix-mode) — but the **gate** (which holds the brain pre-failure) and the **content-replay** path (`reprocessTurn`) stayed input-shaped. They generalized to *"any input capability that produces recoverable content."* TTS sidestepped the gap by accepting degraded UX (text fallback + BUG-6 brain awareness). Tool capabilities don't fit either pattern: the failure happens **mid-brain-session** (no gate possible without SDK changes), and there's **no recoverable content** (the user wanted an *action* performed, not data lost).

**The S20 exit-gate Test 1 was supposed to catch this.** Per S20 architect review §R2, the test's "deliberately broken" scenario was `.enabled` missing with the test's own CLAUDE.md prescribing the exact `touch <path>` fix. It exercised the orchestrator → spawn → fix → smoke chain but NOT the user-facing "task gets done after recovery" assertion. The other half of the loop — what happens after `terminal-fixed` for a tool capability — was never tested because the test had no original task to retry. **The framework promised "Nina gets task → capability broken → fixes it → resumes task" uniformly; today that promise holds only for input capabilities.**

**Goal:** the orchestrator gains a `retryTurn` path alongside the existing `reprocessTurn` path. Capability authors declare their interaction model in CAPABILITY.md frontmatter. The orchestrator dispatches generically. After S22 closes, the recovery loop works for all three shapes (input replay / output degrade-and-acknowledge / tool retry-original-action). M9.6 actually closes.

#### 2.7.1 BUG-7 — task silently dropped after tool-capability fix (in scope)

**Files (capability frontmatter — `interaction` field):**

- `packages/core/src/capabilities/types.ts` — extend the loaded capability metadata with `interaction?: "input" | "output" | "tool"`. Default-inferred from `provides` for the well-known types when frontmatter omits it (see scanner change below). Explicit declaration in CAPABILITY.md overrides.
- `packages/core/src/capabilities/scanner.ts` — read `interaction:` from frontmatter (template + plug-level; plug-level overrides template). When absent, default-infer from `provides`:
  - `audio-to-text`, `image-to-text` → `input`
  - `text-to-audio`, `text-to-image` → `output`
  - everything else (including `browser-control`, `desktop-control`) → `tool`
  - The default-inference table lives next to `FRIENDLY_NAMES` (S14 / S19 frontmatter migration sister of). Keep the table but make explicit declaration the preferred path — log a debug-level "no interaction declared, inferred as X" so plug authors learn to declare.
- `packages/core/src/capabilities/registry.ts` — add `getInteraction(type: string): "input" | "output" | "tool"` method (pattern-matches `getFriendlyName` from S19). Looks up registered plug; returns its `interaction` if set; falls back to default-inference table; never throws — unknown types return `"tool"` (safest default since `tool` triggers retry, which can't lose data; `input` would call reprocessTurn which expects content).
- `skills/capability-templates/audio-to-text.md`, `text-to-audio.md`, `image-to-text.md`, `text-to-image.md`, `browser-control.md`, `desktop-control.md` — add explicit `interaction:` field to each template's frontmatter. Templates are the documented contract; relying on inference everywhere is fragile.
- `.my_agent/capabilities/browser-chrome/CAPABILITY.md`, `.my_agent/capabilities/desktop-x11/CAPABILITY.md`, `.my_agent/capabilities/stt-deepgram/CAPABILITY.md`, `.my_agent/capabilities/tts-edge-tts/CAPABILITY.md` — add `interaction:` field to each installed plug. Required for the live retest to use declared values, not inferred.
- `packages/core/tests/capabilities/registry-interaction.test.ts` *(new)* — frontmatter override; missing-frontmatter fallback to default-inference; missing-from-both fallback to `"tool"`.

**Files (orchestrator — `retryTurn` path):**

- `packages/core/src/capabilities/recovery-orchestrator.ts` — `terminalDrain` (around line 665, verify at sprint-time) currently dispatches:
  ```
  if (outcome === "fixed" && recoveredContent !== undefined) {
    await reprocessTurn(failure, recoveredContent)
  }
  ```
  Add a sibling branch:
  ```
  } else if (outcome === "fixed" && registry.getInteraction(capabilityType) === "tool") {
    await retryTurn(failure)
  }
  ```
  `retryTurn` is a NEW dependency on the orchestrator (mirrors the existing `reprocessTurn` injection). Caller (`app.ts`) wires the implementation.
- `packages/core/src/capabilities/recovery-orchestrator.ts` — `OrchestratorDeps` type adds `retryTurn?: (failure: CapabilityFailure) => Promise<void>` (optional for backward compat; undefined → log warn + no-op same as missing notifier in S12).
- `packages/dashboard/src/app.ts` — wire a concrete `retryTurn` implementation. It receives the failure event, extracts `convId` and `turnNumber` from `failure.triggeringInput.origin`, looks up the original user turn via `conversationManager.getTurns(convId)` filtered to that turn number (verify the lookup pattern at sprint-time — there may already be a `getTurn(convId, turnNumber)` helper), and re-submits via `chatService.streamMessage(convId, originalText, ...)` with the same channel context. The brain processes it as a new turn, sees the now-healthy capability, completes the task. **No per-capability code in this path.** Generic for all `interaction: tool` capabilities.
- `packages/dashboard/tests/integration/cfr-tool-retry.test.ts` *(new)* — boots a real `App`; registers a synthetic tool capability that fails once then succeeds; user turn arrives with that tool needed; CFR fires; fix succeeds; asserts `chatService.streamMessage` was called the second time with the original user message text and that the second call sees the capability as healthy. **This test catches the BUG-7 class for ANY tool capability, not just browser-control.**
- `packages/dashboard/tests/integration/cfr-input-no-retry.test.ts` *(new — symmetric coverage)* — same harness, but synthetic capability declared `interaction: input`; orchestrator should call `reprocessTurn` not `retryTurn`. Asserts the dispatch decision is correct.
- `packages/dashboard/tests/e2e/cfr-exit-gate-tool-retry.test.ts` *(new)* — extends the S20 helpers pattern. Real `browser-chrome` plug, deliberately broken (this time NOT just `.enabled` missing — break a script or config so the fix-mode agent has to actually diagnose). User turn requesting a screenshot. Asserts: CFR fires, fix runs, plug recovers, retryTurn called, second brain run produces an audioUrl-or-text reply containing screenshot evidence (e.g. attachment present). This is the test that S20 should have had but didn't.

**Idempotency / recursion guard:**

The orchestrator already tracks `attemptNumber` and `previousAttempts` on `CapabilityFailure`. `retryTurn` increments attempt counter; if the second brain run fails the same tool again, CFR fires for `attemptNumber: 2`; if budget is exhausted, surrender path runs (existing S12 machinery). No new recursion guard needed — the existing per-failure attempt budget (3 from Phase 1) caps the loop.

**Out of scope (BUG-8 — explicit deferral):**

BUG-8 (ack ordering / brain races CFR mid-session, the wart described in `tool-capability-cfr-gap.md` Bug 1) is **explicitly deferred**. The user's first reply ("I can't, want to set up?") still lands before CFR begins, because `PostToolUseFailure` fires after the SDK has already streamed the tool error into the brain. Fixing this requires either:
- A pre-delivery SDK hook that intercepts tool errors before they reach the brain stream, OR
- Suppression of brain output mid-stream when CFR is active.

The Agent SDK as of M9.6 doesn't expose pre-delivery interception. Mid-stream output suppression is race-y and architecturally invasive. **BUG-8 belongs in M10's brain-lifecycle work**, where the SDK hook surface is being revisited anyway. For S22, the BUG-7 fix means the user *eventually gets their screenshot* — Nina's stale "I can't" reply lurks in the transcript but the recovery itself becomes the implicit correction. Track BUG-8 in `s22-FOLLOW-UPS.md`.

**Acceptance for S22 close:**

| Gate | Verification |
|------|--------------|
| Frontmatter spec | New `registry-interaction.test.ts` passes (3 cases: explicit / inferred / unknown). All 6 templates declare `interaction:` explicitly. All 4 installed plugs declare `interaction:` explicitly. |
| Orchestrator dispatch | New `cfr-tool-retry.test.ts` + `cfr-input-no-retry.test.ts` pass. `retryTurn` is called for `interaction: tool`; `reprocessTurn` is called for `interaction: input`; no false-cross-dispatch. |
| End-to-end browser recovery | New `cfr-exit-gate-tool-retry.test.ts` passes (with auth + plug). Real browser-chrome deliberately broken; fix-mode diagnoses + repairs; user receives the screenshot. |
| Live retest | **CORRECTED 2026-04-21 after first retest failed (see s22-DECISIONS D11-D13).** CTO breaks `browser-chrome` with an **(a)-shape failure**: corrupt the browser **binary or runtime path** (NOT the MCP-init config that makes the server exit at boot — that's an (b)-shape failure handled by Mode 3, FOLLOW-UP-3, out of scope here). Concretely: point `config.yaml`'s `browser_path` (or equivalent) at an executable script that exits non-zero on invocation; OR break user-data-dir permissions so navigation fails when called. The MCP server must START CLEANLY (tools register; brain sees `browser-chrome` in its tool list) and the tool call must FAIL when invoked. CTO sends Nina an **explicit-prompt request: "Use the chrome browser capability to take a screenshot of [URL]"** — the explicit naming routes the call through `browser-chrome` rather than Desktop MCP's parallel browser path (parallel paths are by design per D11). Pass conditions: (a) CFR fires from `PostToolUseFailure`; (b) fix runs successfully (paper trail in DECISIONS.md); (c) `terminal-fixed` ack delivered to user; (d) **`retryTurn` fires and re-submits the original request via `browser-chrome`**; (e) **screenshot attachment arrives within ~3 min of the original request.** Acceptable: Nina's first reply may be a stale "I can't, want to set up?" — the screenshot arriving later is the implicit correction (BUG-8 deferral). Document the live-test methodology explicitly in `s22-test-report.md` and the live transcript in `s22-live-retest.md`. |
| Suite green | `packages/dashboard` + `packages/core` both report zero failed tests at sprint close. Same gate that closed S20 / S21. |

**Verification command:**

```bash
cd packages/core && npx vitest run tests/capabilities/registry-interaction
cd packages/dashboard && npx vitest run tests/integration/cfr-tool-retry tests/integration/cfr-input-no-retry
cd packages/dashboard && npx vitest run                                          # full suite, 0 failures
cd packages/core && npx vitest run                                                # full suite, 0 failures
env -u CLAUDECODE node --env-file=packages/dashboard/.env \
  node_modules/.bin/vitest run tests/e2e/cfr-exit-gate-tool-retry                 # passes with browser-chrome installed
# Live: CTO breaks browser-chrome (real corruption, not .enabled), asks for a screenshot, observes arrival within 3 min
```

**Deviation triggers:**

- The `getTurns(convId)` lookup pattern in `app.ts`'s `retryTurn` doesn't match the existing helper signature (e.g., turns aren't keyed by `turnNumber` directly). Locate the right helper; document in DECISIONS. Don't write a new lookup if `conversationManager` already has one.
- A synthetic capability harness for the integration tests is harder to mock than expected (e.g., the orchestrator's CFR detection requires real PostToolUseFailure wiring). Use a smaller-scoped unit test that exercises just `terminalDrain`'s dispatch decision; document the integration-test gap as a follow-up.
- The live retest reveals that CFR fires but the orchestrator can't actually retry because the `triggeringInput.origin` shape for tool failures lacks `convId` or `turnNumber` (M9.6 origin types may be input-shaped). Surface the missing fields, propose extension in `proposals/s22-tool-origin-shape.md`, escalate to architect.
- The `interaction` default-inference table needs to handle a capability type not in the well-known list. Default to `"tool"` (safest — triggers retry, which can't lose data). Document the choice in DECISIONS.

**Out of scope:**

- BUG-8 (ack ordering / brain races CFR mid-session) — see explicit deferral above.
- Refactoring the `OrchestratorDeps` injection pattern (the new `retryTurn?` field follows the existing optional-dep pattern; don't restructure).
- Migrating any other frontmatter fields (`friendly_name` migration was S19; this sprint only adds `interaction`).
- Suppressing or rewriting the brain's first reply when a tool fails mid-session — that's BUG-8 territory.
- Cross-conversation tool failures (a tool fired in conversation A fails because of state from conversation B). Tracked as `s22-FOLLOW-UPS.md` if surfaced.
- **Mode 3 (`processSystemInit`) verification for MCP-init / startup failures** — see s22-FOLLOW-UPS FOLLOW-UP-3. This is a separately-tracked detection path for the (b)-shape failure (MCP server crashes at boot, tools never registered). S22 covers (a)-shape only (tool-call mid-session). The first live retest exercised (b) by accident and missed S22's intended path. Mode 3 verification is S23 / M10 scope.
- **Removing Desktop MCP's browser tool surface** — per D11, the parallel browser paths are intentional. Desktop MCP = Nina's working browser; `browser-chrome` capability = user's accounts/cookies/sessions. Brain disambiguates by intent (explicit prompts route to the right capability). Do NOT modify Desktop MCP's tool registrations.

**Why it's S22, not amended into S21:** S21's scope was wiring fixes to the input/output recovery loops the framework already had. S22 ships a **new third shape** of the framework (tool retry) that was conceptually missing from M9.6 entirely. Naming it as its own sprint makes the architectural change visible in the artifact trail. The dev can audit the spec → S20 exit-gate-test → S21 fixes → S22 third-shape-build chain and see exactly what was added when. Folding into S21 would hide the design gap.

**Milestone exit:** S22 acceptance gates green + S21 still green + live retest signed off by CTO + architect approval. **M9.6 actually closes here, for real this time.**

**Roadmap commit:** lands AFTER architect + CTO approval per §0.3. **S22 dev: do NOT pre-mark Done.** S16 + S20 + (almost) S21 each made this mistake. The pattern stops here.

---

### 2.8 Sprint 23 — Mode 3 verification + matcher fix (added 2026-04-21)

**Why this exists.** S22 closed the (a)-shape recovery loop (Mode 1+2: tool exception, child crash mid-call). The (b)-shape (Mode 3: MCP server crashes at startup) has wired detection in `mcp-cfr-detector.ts:127-165` (`processSystemInit`) since S12, but **was never verified end-to-end against a real plug.** S22 dev's first three retest attempts engineered Mode 3 failures (config corruption → MCP exits at boot) and observed: no `processSystemInit` log output, no CFR detection. Two candidate causes (per S22 review §"Structural finding"):
1. The SDK doesn't include the failed server in `mcp_servers[]` for the `system_init_raw` event when the stdio process exits immediately at boot.
2. The SDK status string for a failed-at-boot server doesn't match the matcher's expected values (`"failed" | "needs-auth" | "disabled"`).

**Goal:** any plug-side failure is recoverable. Mode 3 detection works end-to-end against a real plug. With S23, the framework's three-MCP-failure-mode coverage matches the three capability shapes — full M9.6 promise actually delivered.

**Files (diagnostic + matcher fix):**

- `packages/core/src/capabilities/mcp-cfr-detector.ts` — at the entry of `processSystemInit` (line 127), add a debug log capturing the full `systemMessage.mcp_servers[]` shape: `console.debug("[CfrDetector] processSystemInit:", JSON.stringify(systemMessage.mcp_servers))`. Temporary diagnostic — used in step 1 below to capture what the SDK actually emits. Once the matcher is fixed, leave the debug log in place at debug level (not info) for future diagnosis but don't gate behavior on it.
- `packages/core/src/capabilities/mcp-cfr-detector.ts` — `isInitSystemMessage` type guard at line 186-200: after step 1 captures the actual shape, expand the guard if the SDK's `mcp_servers[]` array structure differs from the expected `{name, status, error?}` (e.g., status field renamed, additional wrapper). Don't widen the guard speculatively — only adjust to match observed reality.
- `packages/core/src/capabilities/mcp-cfr-detector.ts` — the status matcher at line 131-138: extend the explicit "failed-states" list with whatever string the SDK actually uses. Common candidates the matcher should accept: `"failed"`, `"needs-auth"`, `"disabled"`, plus any newly-observed strings like `"crashed"`, `"exited"`, `"terminated"`, or empty/missing status with non-empty `error`. Use a positive match against an allow-list, not negative match against `connected/pending` — defensive against future SDK additions of new "failed-equivalent" states.
- `packages/core/src/capabilities/mcp-cfr-detector.ts` — fallback (only if step 1 reveals SDK doesn't include failed servers in init at all): add a periodic health probe that calls `q.mcpServerStatus()` on session start (1-shot, not periodic — single check post-init, idempotent via existing `initEmitted: Set<string>`). The spike's S12 results (`s12-spike-results.md`) confirmed `q.mcpServerStatus()` returns `status: "failed"` for Mode 3 servers — this is the SDK's authoritative async RPC for server state. Wire it in `session-manager.ts:731` adjacent to the `system_init_raw` handler. Implement only if step 1 confirms the init-frame path doesn't carry the failed server.
- `packages/core/tests/capabilities/mcp-cfr-detector-init.test.ts` *(new — extend existing test if one exists for this detector; check at sprint-time)* — three tests:
  - (a) init message with all `connected` servers → no CFR fired
  - (b) init message with one `failed` server matching a registered capability → CFR fired with `symptom: "execution-error"`
  - (c) init message with one of each newly-supported failure status (whatever step 1 reveals) → CFR fired for each, idempotent (`initEmitted` prevents double-emit)
- `packages/dashboard/tests/integration/cfr-mode3-init-detection.test.ts` *(new)* — boots a real `App` with a synthetic capability registered; injects a synthetic `system_init_raw` event with the failed server in `mcp_servers[]`; asserts CFR emits and `RecoveryOrchestrator` spawns fix-mode. Catches the wiring end-to-end, not just the matcher in isolation.

**Files (live test scaffolding):**

- `docs/sprints/m9.6-capability-resilience/s23-test-report.md` *(new)* — the diagnostic capture from step 1 (raw `mcp_servers[]` payload from the SDK on a real `browser-chrome` MCP-init failure) + the matcher fix decision + the live retest transcript. Future Mode 3 diagnostics start here.

**Live retest:**

CTO breaks `browser-chrome` with a **(b)-shape failure** (the same kind that masked S22's first retest): corrupt `config.yaml` so the MCP server exits with code 2 at startup, OR rename a script under `scripts/` that the MCP server requires. The MCP must FAIL to register tools — opposite of S22's (a)-shape requirement. Send Nina any prompt that doesn't necessarily need browser-chrome (e.g., *"What time is it?"* — a simple message that doesn't trigger any tool call). Pass conditions:

- (a) `[CfrDetector] processSystemInit` debug log fires at session start and captures the failed `browser-chrome` entry
- (b) CFR emits proactively (no tool call needed) — `[CFR] ack(attempt) for browser-control`
- (c) Brain notifies user (or doesn't, depending on `notifyMode` for system-origin failures — verify what's expected)
- (d) Fix-mode agent spawns, repairs config, smoke passes, `terminal-fixed` ack
- (e) **The original simple message gets answered correctly** — the test prompt isn't blocked by the CFR pipeline (system-origin failures don't gate the conversation)
- (f) Subsequent prompt explicitly using `browser-chrome` capability succeeds (proves the plug self-healed end-to-end)

**Acceptance for S23 close:**

| Gate | Verification |
|------|--------------|
| Diagnostic captures SDK shape | `[CfrDetector] processSystemInit` debug log shows the actual `mcp_servers[]` payload for a Mode 3 failure |
| Matcher fix lands | `processSystemInit` correctly identifies the failed server and emits CFR. New unit test `mcp-cfr-detector-init.test.ts` proves the matcher handles all observed failure-status strings |
| Wiring proven | New integration test `cfr-mode3-init-detection.test.ts` proves init → CFR → orchestrator chain |
| Suite green | Both packages report zero failed (same gate that closed S20/S21/S22) |
| Live retest | (b)-shape break + simple prompt → CFR fires proactively from `processSystemInit` → fix-mode → terminal-fixed → subsequent explicit prompt succeeds |

**Verification command:**

```bash
cd packages/core && npx vitest run tests/capabilities/mcp-cfr-detector-init
cd packages/dashboard && npx vitest run tests/integration/cfr-mode3-init-detection
cd packages/dashboard && npx vitest run                    # full suite, 0 failures
cd packages/core && npx vitest run                          # full suite, 0 failures
# Live: CTO corrupts browser-chrome config (b-shape, MCP exits at boot), starts a session, observes
#   processSystemInit log, CFR detection, fix-mode run, plug self-heals, subsequent explicit-capability
#   prompt succeeds
```

**Deviation triggers:**

- **Step 1 reveals the SDK omits failed servers from `mcp_servers[]` entirely.** Fall back to `q.mcpServerStatus()` health probe per the file plan above. Document in DECISIONS as "SDK init frame doesn't carry failed servers; using `mcpServerStatus()` RPC as the authoritative source."
- **The SDK status string for crash-at-boot is unstable across SDK versions.** Use a defensive allow-list (positive match) and document each accepted value in a comment. If the list grows past ~5 values, refactor to a config constant.
- **Fix-mode struggles to repair a Mode 3 corruption** (e.g., MCP exits but smoke can't reproduce because shell-launching scripts/ behavior differs from MCP-launched). Document as a fix-mode hardening follow-up — out of scope for S23 but worth tracking. Live retest may surface this; if so, file as `s23-FOLLOW-UPS.md` and accept that this specific corruption can't be auto-recovered.

**Out of scope:**

- BUG-8 (still deferred to M10).
- Restructuring the orchestrator state machine for Mode 3-specific paths — Mode 3's CFR uses the existing pipeline (system-origin via `originFactory`), no new state needed.
- Changing the symptom classification (Mode 3 maps to `execution-error` per the existing matcher; don't add new symptom values).
- Mode 3 for non-MCP capabilities (script-based plugs that fail at script-init time). Different surface, not currently broken in production. File as M10 if it surfaces.

**Why it's S23, not folded into S22:** S22 was scoped to building the third capability shape's recovery (tool retry). S23 verifies the third MCP failure mode's detection. Different code paths, different testing methodology. Splitting keeps each sprint's artifact trail clean: S22's retryTurn for Modes 1+2, S23's processSystemInit verification for Mode 3. After S23, the framework matrix is fully covered (3 shapes × 3 modes).

**Milestone exit:** S23 acceptance gates green + S22 still green + live retest signed off by CTO + architect approval. **M9.6 closes here.**

**Roadmap commit:** lands AFTER architect + CTO approval per §0.3. **S22 dev followed this discipline; S23 dev: same expectation.**

---

### 2.9 Sprint 24 — Mode 4: daily silent self-heal + brief integration (added 2026-04-21)

**Why this exists.** S22 + S23 closed the reactive recovery surface (Modes 1+2+3): failures the user or Nina encounter get fixed immediately. But a capability can degrade silently — API key revoked, dependency rot, config drift — and stay broken indefinitely until someone tries to use it. Per CTO direction: *"any plug-side failure should be recoverable"* and *"the user should not be bothered with internal fixes if they are done in the background."*

**Goal:** once a day, the framework probes every registered capability. Anything degraded triggers an auto-fix via the existing CFR pipeline with `system` origin (silent — no chat ack, no WhatsApp, no real-time bother). The next morning's brief includes a "System Health" section listing what self-healed and what surrendered (if anything). After S24, the framework matrix is fully covered: 3 capability shapes × 4 MCP failure modes.

**Audit findings (architect, 2026-04-21):** Before writing this plan, an auditor checked the proposed design against the actual code. Five issues surfaced and are folded into the file plan below:

1. `systemOrigin()` factory does NOT exist — only `conversationOrigin()` does. Use inline `{ kind: "system", component: "..." }`.
2. `RecoveryOrchestrator.inFlight` is private; no public query method. Need to add `isInFlight(type: string): boolean`.
3. The system-origin terminal drain at `recovery-orchestrator.ts:700-714` only logs the outcome — it does NOT append fixed/surrendered to the ring buffer. The ring buffer accumulates only initial `in-progress` entries. Without a fix, the brief would show "in progress" forever.
4. `testAll()` filters to `c.status === 'available' && c.provides`. MCP capabilities with `provides` set go through `testMcpCapability` (spawn + handshake + tool list — no API call). **Need to verify** that the installed `browser-chrome` and `desktop-x11` CAPABILITY.md files actually declare `provides` + `interface: mcp` so they're included in the daily probe; if not, fix the manifests OR extend `TEST_CONTRACTS`.
5. Brief composer is `debrief-reporter` at `packages/dashboard/src/scheduler/jobs/`, not `handler-registry.ts`. It strictly aggregates DB job rows — no injection seam for framework data. **Need to add** an `AckDelivery` constructor dep so it can read `getSystemEvents()` directly and append a "System Health" section.

#### 2.9.1 Wire heartbeat → daily capability probe (in scope)

**Files:**

- `packages/dashboard/src/app.ts` — locate the `new HeartbeatService({...})` construction. The existing `capabilityHealthIntervalMs: 60 * 60 * 1000` (1h) is wired but the `capabilityHealthCheck` callback is undefined, so the timer ticks with no effect. Two changes:
  - Change interval to `24 * 60 * 60 * 1000` (24h).
  - Add the callback:
    ```typescript
    capabilityHealthCheck: async () => {
      await app.capabilityRegistry.testAll();
      for (const cap of app.capabilityRegistry.list()) {
        if (cap.health !== 'degraded' && cap.health !== 'unhealthy') continue;
        if (app.recoveryOrchestrator?.isInFlight(cap.provides ?? cap.name)) continue;
        app.cfr.emitFailure({
          capabilityType: cap.provides ?? 'custom',
          capabilityName: cap.name,
          symptom: 'execution-error',
          detail: cap.degradedReason ?? 'daily health probe failed',
          triggeringInput: {
            origin: { kind: "system", component: "heartbeat-daily-probe" },
          },
        });
      }
    },
    ```
- `packages/dashboard/src/automations/heartbeat-service.ts` — no code change. The existing `checkCapabilityHealth()` at line 365 already gates on `lastCapabilityCheck` and calls the callback. Verify the existing log message at the call site is still appropriate at 24h cadence (currently logs each time it fires; should be info-level, not debug).
- `packages/dashboard/tests/unit/automations/heartbeat-service.test.ts` (existing) — extend with one new test: heartbeat ticks at fake-time intervals, capabilityHealthCheck fires once per `capabilityHealthIntervalMs` window, idempotent.

**Cadence note:** heartbeat ticks every 30s; the capability check is gated via `now - lastCapabilityCheck < capabilityHealthIntervalMs`. At 24h, fires once per day on the first tick after the interval elapses. Process restart resets `lastCapabilityCheck = 0`, so it fires immediately on first tick after restart — acceptable behavior (catches anything that broke during downtime).

#### 2.9.2 Add `RecoveryOrchestrator.isInFlight(type)` public method (in scope)

**Files:**

- `packages/core/src/capabilities/recovery-orchestrator.ts` — add a small public method:
  ```typescript
  isInFlight(capabilityType: string): boolean {
    return this.inFlight.has(capabilityType);
  }
  ```
  Used by the daily probe (above) to skip emitting CFR for capabilities that already have a recovery in flight (the S12 `inFlight` mutex would dedup anyway, but pre-checking avoids ring-buffer noise from duplicate `in-progress` entries).
- `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts` (existing) — extend with one new test: `isInFlight` returns true while a recovery is mid-flight, false after it completes.

#### 2.9.3 Fix system-origin terminal drain to append outcome to ring buffer (in scope — required for brief integration)

**Files:**

- `packages/core/src/capabilities/recovery-orchestrator.ts` — at the system-origin terminal drain (around line 700-714, verify at sprint-time), the current behavior is log-only. Add a call to `ackDelivery.appendSystemEvent({ ..., outcome: 'fixed' | 'surrendered' })` (or the existing equivalent — verify the method name in `ack-delivery.ts`) so the ring buffer entry transitions from `in-progress` to its terminal outcome. Without this fix, the brief composer would show stale `in-progress` entries indefinitely.
- `packages/core/src/capabilities/ack-delivery.ts` — verify the system event log entry shape supports outcome transitions (or add an `outcome` field if missing). The S19 ring buffer was built for "system-origin events" — extending it to carry terminal outcomes is consistent with that purpose.
- `packages/dashboard/tests/integration/cfr-system-origin-terminal-drain.test.ts` *(new)* — boots a real `App`, fires a system-origin CFR, mocks fix-mode to succeed, asserts the ring buffer has one entry that transitions from `in-progress` to `fixed` (and a parallel test for `surrendered`).

**Note:** This is a real bug discovered by the audit, not just an S24 enabler. Even without S24, a system-origin failure today (e.g., S23's Mode 3 detection at session start) leaves the ring buffer in `in-progress` forever. **This fix lands as part of S24 but resolves a pre-existing gap.** Worth flagging in the s24 review as "fix landed in S24 closes a latent S19 gap."

#### 2.9.4 Verify + fix `testAll()` MCP coverage (in scope)

**Files:**

- `.my_agent/capabilities/browser-chrome/CAPABILITY.md` — verify the frontmatter declares `provides: browser-control` AND `interface: mcp`. If either is missing, add it. Without `provides`, the cap is silently skipped by `testAll()`'s filter.
- `.my_agent/capabilities/desktop-x11/CAPABILITY.md` — same verification + fix if needed.
- `skills/capability-templates/browser-control.md` and `skills/capability-templates/desktop-control.md` — if the installed plugs have correct frontmatter but the templates don't show `interface: mcp` as required, add it for clarity (templates are the documented contract).
- `packages/core/src/capabilities/test-harness.ts` — verify `TEST_CONTRACTS` table at line 211 + the MCP dispatch path at line 35 actually cover all currently-installed capability types. If a script-interface plug type lacks a TEST_CONTRACTS entry (e.g., a future script-based browser plug), `testCapability` returns an error and the cap stays `untested`. Document the dispatch table as the source of truth in CAPABILITY.md schema.
- `packages/core/tests/capabilities/test-harness-mcp-coverage.test.ts` *(new — small scope)* — for each currently-installed capability type, asserts that `testCapability` returns either `ok` or `error` with a meaningful message (NOT silent `untested` from a missing dispatch entry).

**Sprint-time verification:** before implementing 2.9.1, run a quick diagnostic in the dev environment:
```bash
node -e "
const { CapabilityRegistry, scanCapabilities } = require('./packages/core/dist');
const r = new CapabilityRegistry();
const caps = await scanCapabilities('.my_agent/capabilities', '.env');
r.load(caps);
await r.testAll();
console.log(r.list().map(c => ({ name: c.name, provides: c.provides, interface: c.interface, health: c.health, reason: c.degradedReason })));
"
```
If any installed plug shows `health: 'untested'` after `testAll()`, that's the gap — fix it before wiring the daily probe. Document the diagnostic + fix in `s24-DECISIONS.md`.

#### 2.9.5 Brief integration via `debrief-reporter` (in scope)

**Files:**

- `packages/dashboard/src/scheduler/jobs/debrief-reporter.ts` (verify exact path at sprint-time) — add a constructor dependency on `AckDelivery` (or pass it via the existing handler-registry init). After the existing worker-section aggregation, before returning the deliverable string, query `app.ackDelivery.getSystemEvents()` filtered to the last 24h. If non-empty, append a "## System Health" section. Format:

  ```markdown
  ## System Health

  - 03:14 — browser-chrome auto-recovered (config drift; smoke clean within 2 min)
  - 14:47 — tts-edge-tts auto-recovered (voice config; 3 attempts, smoke clean)
  - 22:08 — desktop-x11 surrendered after 3 attempts; needs attention
    (last error: xdotool not found; check `which xdotool`)
  ```

  If the ring buffer is empty for the last 24h: omit the section entirely (no empty header).
- `packages/dashboard/src/scheduler/jobs/handler-registry.ts` — locate where `debrief-reporter` is registered and ensure the new `AckDelivery` dep flows through. Likely a one-line addition to the dep object.
- `packages/dashboard/src/app.ts` — ensure `app.ackDelivery` is constructed before the scheduler initialises (verify ordering at sprint-time; if scheduler init runs first, refactor to lazy-resolve the dep).
- `packages/dashboard/tests/integration/debrief-reporter-system-health-section.test.ts` *(new)* — three tests:
  - (a) ring buffer empty for last 24h → no "System Health" section in deliverable
  - (b) ring buffer has one fixed event in last 24h → section appears with one bullet, fixed framing
  - (c) ring buffer has one surrendered event in last 24h → section appears with surrender framing + remediation hint

**Why this design (not a separate brief-worker automation):** instance-level `.my_agent/automations/cfr-self-heal-summary.md` would require every agent to set it up manually — wrong for framework-level functionality. The debrief-reporter is the framework's brief composer; adding `AckDelivery` as a dep is the cleanest extension point.

#### 2.9.6 Live retest

**Setup:** corrupt `.my_agent/capabilities/stt-deepgram/scripts/transcribe.sh` so the script exits non-zero (e.g., `mv transcribe.sh transcribe.sh.bak; echo '#!/bin/bash\nexit 1' > transcribe.sh; chmod +x transcribe.sh`). Don't restart the dashboard (we want to observe the daily probe catching it organically). Optionally also: revoke `DEEPGRAM_API_KEY` in `.env` (force-restart needed for env to reload — but that gets us a different fail mode).

**Wait** until next 24h heartbeat tick fires the probe. To accelerate for the live test, temporarily set `capabilityHealthIntervalMs: 60_000` (1 min) in `app.ts`, restart, and revert after the test. Document the test-mode override in s24-test-report.md.

**Pass conditions:**

| Gate | Verification |
|------|--------------|
| Probe fires | `[Heartbeat] capability health check starting` log entry at the expected interval |
| Capability marked degraded | `app.capabilityRegistry.list()` shows `stt-deepgram` with `health: 'degraded'` after `testAll()` |
| CFR emitted with system origin | `[CFR] ack(attempt) for audio-to-text — origin: system` log entry |
| **Silent path** | **NO chat bubble appears in any open dashboard conversation; NO WhatsApp message sent; NO brain turn fired.** Inspect the conversation transcripts and the WhatsApp transport log. |
| Fix runs | Fix-mode agent spawned, repairs transcribe.sh (or installs missing dep), smoke clean |
| Ring buffer transitions | After fix: ring buffer entry for stt-deepgram shows `outcome: fixed` (was `in-progress` during recovery). Verify via `/api/capabilities/cfr-system-events`. |
| Brief includes the event | Trigger debrief-reporter (or wait for next morning brief). Resulting deliverable includes `## System Health` section listing the stt-deepgram self-heal with timestamp and outcome. |

**Acceptance for S24 close:**

- All five sub-tasks (2.9.1 through 2.9.5) implemented + their unit/integration tests pass
- Live retest above passes end-to-end with NO user-visible signal during the recovery window
- Suite green: dashboard + core both report zero failed (same gate that closed S20/S21/S22/S23)

**Verification command:**

```bash
cd packages/core && npx vitest run tests/capabilities/orchestrator/orchestrator-state-machine tests/capabilities/test-harness-mcp-coverage
cd packages/dashboard && npx vitest run tests/unit/automations/heartbeat-service tests/integration/cfr-system-origin-terminal-drain tests/integration/debrief-reporter-system-health-section
cd packages/dashboard && npx vitest run                    # full suite, 0 failures
cd packages/core && npx vitest run                          # full suite, 0 failures
# Live: corrupt stt-deepgram, accelerate cadence, observe silent recovery + ring-buffer transition + brief section
```

**Deviation triggers:**

- **`testAll()` MCP coverage diagnostic reveals browser-chrome / desktop-x11 are silently `untested`.** Fix the CAPABILITY.md frontmatter or extend `testCapability`'s dispatch. Document the gap class in DECISIONS — this is a pre-existing latent bug surfaced by S24's audit, not S24's introduction.
- **System-origin terminal drain fix turns out to also affect S23's Mode 3 detection path** (which is the only system-origin emit currently in production). Verify S23 still works after the fix; the drain change is additive (new outcome write) so it shouldn't regress.
- **`debrief-reporter` constructor signature can't accept `AckDelivery` cleanly** (e.g., it's instantiated via a factory that doesn't have the AckDelivery instance). Refactor the wiring; document in DECISIONS. Don't fall back to instance-level automation file as a workaround — that violates the framework-level constraint.
- **Live retest reveals the brief section appears empty even when ring buffer has events.** Trace the data flow; likely a timestamp filter mismatch (UTC vs local time) or a serialization gap. Fix before claiming the gate passes.

**Out of scope:**

- BUG-8 (still deferred to M10).
- Per-capability `health_probe_interval_minutes` frontmatter override (rejected per CTO direction — daily is fine for everyone).
- More-frequent-than-daily probing for any capability (CTO: "I don't want to be this wasteful").
- User-facing real-time notification for system-origin failures (rejected — silent contract).
- Surrender escalation to brain mediator after N failures (rejected — brief is the only user-facing surface; user can act when they read it).
- Mode 4 for non-MCP, non-script capabilities. None exist today; not a real concern.
- Adjusting the actual brief generation cron schedule. The brief runs when it runs; S24 just contributes one more section to it.

**Why it's S24, not folded into S23:** S23 was scoped to verifying Mode 3 detection (a reactive, session-start-triggered path). S24 introduces Mode 4, the proactive daily probe — a different code surface, a different testing methodology, a different user-visibility contract (silent, brief-only). Splitting keeps each sprint's artifact trail clean and makes the framework matrix transition (3 modes → 4 modes) visible in the audit chain.

**Milestone exit:** S24 acceptance gates green + S23 still green + live retest signed off by CTO + architect approval. **M9.6 closes here. M10 unblocks.**

**Roadmap commit:** lands AFTER architect + CTO approval per §0.3. **S22 + S23 dev followed this discipline; S24 dev: same expectation. The pattern is established now.**

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
| S16 inherit (M1) | Pre-populate smoke output in MODE: FIX prompt — `AutomationSpec.smokeOutput?: string` + render in `buildFixModeInvocation` | S17 §2.2.1 Item A |
| S16 inherit (HIGH) | Investigate orchestrator's 3-attempt iteration on 1-attempt fixes (`executeResult.status` vs `deliverable.test_result` mismatch) | S17 §2.2.1 Item B |
| §3.6 | TTS path collapse (synthesizeAudio authoritative) | S18 |
| §3.6 | `sendAudioUrlViaTransport` / `sendTextViaTransport` split | S18 |
| §3.6 | Baileys `onSendVoiceReply` synthesis removed | S18 |
| §3.6 | TTS detection through CapabilityInvoker (formalize) | S18 |
| Phase 2 deferral | S10-FU-2 / S13-FU-1: remove bash-wrapper from `reverifyAudioToText`; `invoker` required | S18 |
| Phase 2 deferral | S11-FU-2: text-to-audio template smoke validates Ogg magic bytes | S18 |
| Phase 2 deferral | S11-FU-5: tts-edge-tts plug transcodes to Ogg per template contract | S18 |
| Phase 2 deferral | S15-FU-4: `reverifyTextToAudio` audio format coverage strategy | S18 |
| §5.3 | Per-conversation 30s ack-coalescing | S19 |
| §5.3 | N-aware coalescing | S19 |
| §5.3 | Combined surrender for parallel CFRs | S19 |
| §5.3 | `TranscriptTurn.failure_type` structured field | S19 |
| §5.3 | Assistant-turn orphan watchdog scan | S19 |
| §5.3 | `FAILURE_PLACEHOLDERS` dispatch table | S19 |
| §5.3 | System-origin dashboard health UI | S19 |
| Phase 2 deferral | S14-FU-1 / S15-FU-3: FRIENDLY_NAMES → frontmatter migration (`registry.getFriendlyName`) | S19 |
| Phase 2 deferral | S12 obs: `AutomationNotifierLike` impl + `fixed`-outcome immediate fan-out | S19 |
| v2.3 §8 / §5.3 | Exit-gate Test 1 (automation-origin browser) | S20 |
| v2.3 §8 / §5.3 | Exit-gate Test 2 (conversation-origin voice) | S20 |
| §5.3 | Abbreviated replays per plug type | S20 |
| Phase 2 deferral | S15 architect §3: extract shared E2E helpers (`cfr-exit-gate-helpers.ts`) | S20 |
| Phase 2 deferral | S12 obs #1: multi-session `originFactory` parallel-conversation verification (or named deferral) | S20 |
| Phase 2 deferral | S15-FU-2: `image-to-text` / `text-to-image` installed-plug E2E (named non-coverage if no plug installed) | S20 |
| §0 | Universal-coverage rule (every sprint review) | every sprint |
| §0.4 | Env-mismatch protocol — source `packages/dashboard/.env` before real-plug smoke | S16, S20 |
| §0.4 | Cross-package dist rebuild before dashboard E2E | every sprint touching `packages/core` source |

---

*Created: 2026-04-17*
*Authors: Opus 4.7 (course-correct from Opus 4.6 v2.3)*
