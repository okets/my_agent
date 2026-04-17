# M9.6 Phase 2 — Universal Coverage (S9–S15)

**Status:** Approved 2026-04-17 — supersedes sprint ordering and scope of `plan-universal-coverage.md` v2.3
**Phase:** 2 of 3 (Phase 1 = S1–S8 DONE; Phase 3 = S16–S20)
**Design spec:** [`../../design/capability-resilience-v2.md`](../../design/capability-resilience-v2.md) — binding context
**Original M9.6 design:** [`../../design/capability-resilience.md`](../../design/capability-resilience.md) — still binding for unchanged items
**Phase 1 plan:** [`plan.md`](plan.md) — implementing-agent rules in §0 carry over verbatim
**Origin handoff:** [`HANDOFF-cfr-coverage-gap.md`](HANDOFF-cfr-coverage-gap.md)
**Phase exit:** Phase 2 closes when every plug type currently installed in `.my_agent/capabilities/` has a working detection → fix → reverify → ack path. Phase 2 is the architectural minimum to unblock M10, but per CTO decision 2026-04-17, M10 work does NOT start at Phase 2 close — Phase 3 runs first.

---

## 0. For the implementing agent — READ THIS FIRST

The implementing-agent rules in `plan.md` §0 (Stop-On-Deviation, Deviation Proposal Protocol, "done" definition, Ground rules) carry over verbatim. Re-read them. Proposals land in `proposals/s<N>-<slug>.md`.

Two additional rules specific to Phase 2:

### 0.1 The universal-coverage rule (§8 of design v2)

> **Universal-coverage rule:** Any new generic layer this sprint adds must come with coverage for every capability type registered in `.my_agent/capabilities/` at sprint-end. If a new type can't be covered in-sprint, name it explicitly in `FOLLOW-UPS.md` with: (a) the type, (b) why it can't be covered now, (c) which sprint will cover it. Omitting a type silently is a sprint-failure condition, not a follow-up.

This is the rule that would have caught the original Phase 1 mistake. Architect's review checklist for every sprint MUST verify: "Does the new layer have coverage for every plug type listed in `.my_agent/capabilities/`?" If no, the sprint is rejected.

### 0.2 Detection lives at the gates

Phase 1 wired detection per-call-site for STT only — that was the mistake. **In Phase 2, new detection code lives in one of two places only:**
- `CapabilityInvoker` (script plugs)
- `PostToolUseFailure` hook detector (MCP plugs)

If you find yourself adding a `cfr.emitFailure(...)` call at a new call site that isn't one of these two gates, STOP and file a deviation proposal. The exception is socket-internal failures (deps wiring, AttachmentService missing) — those are emitted directly per existing Phase 1 patterns, not via the gates.

### 0.3 Sprint approval flow — what the dev does and does not do

Established after S9. These rules apply to every Phase 2 sprint.

**The dev:**
1. Implements the sprint per its §2.N section.
2. Writes `s<N>-DECISIONS.md` (judgment calls + rationale), `s<N>-DEVIATIONS.md` (proposals filed, link to each), `s<N>-FOLLOW-UPS.md` (out-of-scope items noticed; per §0.1 every deferred plug type is named here with the receiving sprint).
3. Optionally runs an external auditor for an independent technical read. If used, the auditor's artifact lands at `s<N>-review.md` with frontmatter `reviewer: External auditor (dev-contracted)` and `recommended: APPROVE | REJECT | CONDITIONAL`. **Never** `reviewer: Architect` and **never** `verdict: APPROVED` — those framings claim a role the dev does not hold.
4. Writes `s<N>-test-report.md` with verification command output.
5. Stops the trip-sprint and notifies the CTO that the sprint is done. **Does not commit `APPROVED` in any commit message.** Does not write `s<N>-architect-review.md` (that file is the architect's exclusively).

**The CTO:**
- Notifies the architect that the dev is done.

**The architect:**
- Reads the dev's artifacts + diff + runs verification gates independently.
- Writes `s<N>-architect-review.md` with the binding verdict.
- If APPROVED: commits review + any plan-text corrections; advises CTO on next sprint.
- If REJECTED: commits review with required corrections; sprint goes back to dev.
- If CONDITIONAL: commits review with conditions; dev addresses; architect re-reviews.

**Phase 1 §0.3 carries over verbatim:** the roadmap-done commit (and any "approved" framing) is the LAST commit on the sprint branch, landed AFTER the architect-review commit. A premature "APPROVED" commit by the dev is the same anti-pattern as a premature roadmap-done commit, scoped to the sprint branch — it misrepresents state for hours and pre-empts the independent gate.

---

## 1. Phase overview

**Goal:** every plug type currently installed in `.my_agent/capabilities/` has CFR coverage from any origin (conversation, automation, system).

**Sprint sequence:**

| Sprint | Name | Depends on | Parallelizable with |
|--------|------|-----------|---------------------|
| S9 | `TriggeringOrigin` type landing + matrix correction | — | — |
| S10 | `CapabilityInvoker` + exec-bit validation | S9 | — |
| S11 | Template smoke fixtures + installed-plug backfill | S10 | — |
| S12 | MCP detection spike → `PostToolUseFailure` hook + automation-origin wiring | S9, S11 | — |
| S13 | Reverify dispatcher + terminal-on-fix state | S10, S11, S12 | — |
| S14 | Friendly names + multi-instance + per-type fallback copy | S13 | — |
| S15 | Phase 2 exit gate: incident-replay per installed plug type | S9–S14 | — |

**Phase exit (S15):** every plug type currently installed in `.my_agent/capabilities/` (today: `audio-to-text`, `text-to-audio`, `browser-control`, `desktop-control`) has an end-to-end incident-replay test that passes. Conversation-origin tests for STT and TTS are *real-incident* replays. Automation-origin browser-control test is a *synthetic* replay (no historical incident exists; framing per design §6.2).

**Review cadence:** architect reviews each sprint at completion. CTO reviews at S15 exit.

---

## 2. Detailed sprint plans

Each sprint follows Phase 1's discipline: Goal, Files (concrete pointers), Acceptance tests, Verification commands, Deviation triggers. Design prose is in `capability-resilience-v2.md` §3 — not repeated here; read it.

### 2.1 Sprint 9 — `TriggeringOrigin` type landing + matrix correction

**Design refs:** §3.2.

**Goal:** land the `TriggeringOrigin` discriminated union with zero behavior change. Prerequisite for S12 automation-origin wiring. Also fix the §5 coverage matrix inconsistency Opus 4.6 flagged on direct questioning.

**Files:**

- `packages/core/src/capabilities/cfr-types.ts` —
  - Add `TriggeringOrigin` discriminated union with three variants: `conversation` (channel + conversationId + turnNumber), `automation` (automationId + jobId + runDir + notifyMode), `system` (component).
  - Widen `TriggeringInput`: replace flat `channel` / `conversationId` / `turnNumber` fields with `origin: TriggeringOrigin`. Keep `artifact` and `userUtterance` fields.
  - `FixAttempt.phase` stays as-is (Phase 3 narrows in S17).
- `packages/core/src/capabilities/cfr-helpers.ts` *(new)* — `conversationOrigin(channel, conversationId, turnNumber): TriggeringOrigin` factory. Helps emit-site rewraps.
- **Emit-site rewraps** (mechanical — wrap into `{ kind: "conversation", ... }`):
  - `packages/dashboard/src/chat/chat-service.ts:594` (deps-missing emit)
  - `packages/dashboard/src/chat/chat-service.ts:685` (transcribeAudio failure emit)
  - `packages/dashboard/src/chat/chat-service.ts:700` (transcribeAudio empty-result emit)
  - `packages/core/src/conversations/orphan-watchdog.ts:422` (orphan re-driven emit)
- **Consumer-site narrowings** (discriminated-union guards — `switch (origin.kind)` or early-return on non-conversation; throw with `"unreachable in S9 — wired in S12"` for automation/system):
  - `packages/core/src/capabilities/recovery-orchestrator.ts` — every `failure.triggeringInput.conversationId` / `.turnNumber` / `.channel` read.
  - `packages/core/src/capabilities/ack-delivery.ts` — routing.
  - `packages/core/src/capabilities/reverify.ts` — input-path resolution.
  - `packages/dashboard/src/app.ts:749-760` — CFR event consumer.
  - `packages/core/src/conversations/orphan-watchdog.ts` — re-processor branch.
- **§5 coverage matrix correction** in `docs/design/capability-resilience-v2.md`: confirmed already correct in v2 design. Verify and note in `DECISIONS.md`. (The bug was in v2.3 §5; v2 design fixes it.)

**Acceptance tests:**

- `packages/core/tests/capabilities/cfr-types-origin.test.ts` *(new)* — discriminated-union narrowing works (TS-level via expected `never` checks); helper produces correct shape; widening fixture mocks compile.
- Full Phase 1 CFR test suite passes unchanged (no behavior change).

**Verification:**

```bash
cd packages/core && npx tsc --noEmit
cd packages/dashboard && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities
cd packages/dashboard && npx vitest run tests/cfr
```

**Deviation triggers:** any consumer reads a field not on all variants without a guard (TypeScript catches); union widening breaks a Phase 1 test fixture whose mock shape diverges and can't be rewrapped mechanically.

**Universal coverage check:** N/A — type landing only, no behavior change. Confirm in review that no plug type is "missed" because the type-level work doesn't add a layer requiring coverage.

---

### 2.2 Sprint 10 — `CapabilityInvoker` + exec-bit validation

**Design refs:** §3.1 (CapabilityInvoker block), §3.6 (frozen surface contract).

**Goal:** single gate for script-plug invocation. Every script-plug invocation emits CFR automatically when the plug fails. Drop the `bash` wrapper inherited from Phase 1 reverify.

**Files:**

- `packages/core/src/capabilities/invoker.ts` *(new)* — `CapabilityInvoker` class with `run(opts: InvokeOptions): Promise<InvokeResult>`. Behavior matrix per design §3.1:
  - Registry returns no plug → `{kind: "failure", symptom: "not-installed"}` + `cfr.emitFailure`.
  - Plug exists, `cap.enabled === false` → `not-enabled`.
  - Plug enabled, `cap.status !== "available"` → `execution-error`.
  - `execFile` rejects with timeout marker (`ETIMEDOUT`, `/timeout/i`) → `timeout`.
  - `execFile` rejects otherwise → `execution-error`.
  - `expectJson === true` and stdout invalid JSON → `validation-failed`.
  - All `failure` paths emit via `cfr.emitFailure(failure, triggeringInput)` before returning.
  - Constructor takes `{cfr, registry, originFactory: () => TriggeringOrigin}` so per-execution-context instances populate origin automatically.
- `packages/core/src/capabilities/test-harness.ts` — exec-bit validation during scan: any `scripts/*.sh` without exec bit marks the plug `status: "invalid"` and adds a reason. Implement via `fs.statSync(p).mode & 0o111`.
- `packages/dashboard/src/chat/chat-service.ts` —
  - `transcribeAudio()` (around line 1032) refactor to call `app.capabilityInvoker.run({capabilityType: "audio-to-text", scriptName: "transcribe.sh", args: [audioPath], triggeringInput, expectJson: true})`. Existing emit calls at `:685` and `:700` collapse into the invoker (`:594` deps-missing emit stays — socket-internal).
  - `synthesizeAudio()` (around line 1058) — *do not* refactor in this sprint. S13's reverifier reaches it via the dispatcher; S18 (Phase 3, "Duplicate TTS path collapse") formalizes the invoker rewire. S15's exit gate may need a minimal pre-wire if TTS detection is required for the TTS replay test — file a deviation in S15 if so. Leave a `// TODO(S15/S18): route through invoker` marker.
- `packages/core/src/capabilities/reverify.ts:~105-186` — `reverifyAudioToText` uses `CapabilityInvoker`; drop the `execFile("bash", [scriptPath, ...])` form and call `invoker.run({...scriptName: "transcribe.sh"...})` instead. Exec-bit validation in test-harness ensures executable.
- `packages/dashboard/src/app.ts` — wire `app.capabilityInvoker = new CapabilityInvoker({cfr, registry, originFactory: () => conversationOrigin(...) /* per-call context */})` in the boot path alongside existing capability service wiring (around the `setDeps` call). Document the per-context-instance pattern: brain holds one invoker; automation workers will get their own in S12.
- `packages/core/src/capabilities/failure-symptoms.ts` —
  - Remove `classifySttError` (no-capability branches subsumed by invoker).
  - Keep `classifyEmptyStt` (semantic-empty boundary, plug-specific judgment, stays at caller).
  - Confirm no other caller imports `classifySttError` (`rg "classifySttError" packages/`).

**Acceptance tests:**

- `packages/core/tests/capabilities/invoker.test.ts` *(new)* — 6-symptom matrix (not-installed / not-enabled / execution-error / timeout / validation-failed / success). Confirm `cfr.emitFailure` fires on every failure path with correct symptom + triggeringInput.
- `packages/core/tests/capabilities/exec-bit-validator.test.ts` *(new)* — executable scripts pass; non-executable plugs marked `invalid` with reason; mixed (some scripts executable, some not) marked `invalid`.
- All Phase 1 STT tests still pass (regression gate). Specifically: `packages/core/tests/capabilities/orchestrator/*` and `packages/dashboard/tests/cfr/*`.

**Verification:**

```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/invoker tests/capabilities/exec-bit-validator tests/capabilities/orchestrator
cd packages/dashboard && npx tsc --noEmit && npx vitest run tests/cfr
```

**Deviation triggers:**

- `reverify.ts` refactor changes its return shape (it shouldn't — invoker wraps execFile cleanly).
- Removing `classifySttError` breaks a caller outside `chat-service.ts` (search before deleting).
- The originFactory pattern doesn't fit the App's boot order (e.g., capabilityInvoker constructed before CFR emitter is available). If so, propose a setter or lazy-init.

**Universal coverage check:** invoker handles all *script-plug* types generically (data-driven by registry lookup). Confirm in review by listing every script plug in `.my_agent/capabilities/` and verifying each would route through the invoker if its caller called `invoker.run`. The actual TTS rewire happens in S17 — flag this in `FOLLOW-UPS.md` per the universal-coverage rule.

---

### 2.3 Sprint 11 — Template smoke fixtures + installed-plug backfill

**Design refs:** §3.3 (smoke fixture contract block), §6.4 (hermeticity per plug).

**Goal:** every capability template declares a `scripts/smoke.sh` contract + `fallback_action` + `multi_instance` frontmatter; **every currently-installed plug in `.my_agent/capabilities/` gets a working `smoke.sh` written**. Without the backfill, S13's `runSmokeFixture` ships with degraded fall-through behavior on day one.

**Files (templates):**

- `skills/capability-templates/audio-to-text.md` — add "Smoke fixture" section: `scripts/smoke.sh` runs transcribe on a short test audio (template ships a 2s sine-wave fixture or templated test audio); exit 0 = healthy. Add frontmatter fields: `fallback_action: "could you resend as text"`, `multi_instance: false`.
- `skills/capability-templates/text-to-audio.md` — smoke.sh synthesizes a fixed test phrase + validates output file headers (Ogg magic / WAV RIFF). Frontmatter: `fallback_action: "you can read my last reply above"`, `multi_instance: false`.
- `skills/capability-templates/text-to-image.md` — smoke.sh generates against a fixed prompt + validates image file headers (PNG/JPEG magic). Frontmatter: `fallback_action: "I'll skip the image this time"`, `multi_instance: false`.
- `skills/capability-templates/browser-control.md` — smoke.sh spawns the MCP server, invokes `browser_navigate about:blank`, tears down. Frontmatter: `fallback_action: "try again in a moment"`, `multi_instance: true`.
- `skills/capability-templates/desktop-control.md` — smoke.sh invokes a noop screenshot against a headless buffer or confirms X11 availability via `xset q`. Frontmatter: `fallback_action: "try again in a moment"`, `multi_instance: false`.
- `skills/capability-templates/_bundles.md` — update bundle descriptions to mention smoke.sh requirement.

**Files (installed-plug backfill — read `.my_agent/capabilities/` at sprint-time to enumerate):**

- For every installed plug folder, write a `scripts/smoke.sh` matching its template's reference shape. Today's expected list (verify at sprint-time):
  - `.my_agent/capabilities/stt-deepgram/scripts/smoke.sh` — runs `transcribe.sh` against a bundled test audio fixture; checks `text` field is non-empty.
  - `.my_agent/capabilities/tts-edge-tts/scripts/smoke.sh` — runs `synthesize.sh` against a fixed phrase; checks output file has Ogg/WAV header.
  - `.my_agent/capabilities/browser-chrome/scripts/smoke.sh` — spawns MCP server, navigates `about:blank`, exits 0.
  - `.my_agent/capabilities/desktop-x11/scripts/smoke.sh` — checks `xset q` succeeds (X11 reachable).
- **`.my_agent/` write rule:** the backfill is a sanctioned write to `.my_agent/`. Flag in the architect review that this sprint deliberately writes to `.my_agent/`. Coordinate with the existing write-guard hook (no exemption needed — files under `scripts/` for installed plugs are part of plug definitions; the implementer writes them with the CTO's foreknowledge as part of this sprint).

**Hermeticity rule (§6.4):**

For plugs that require external resources (cloud STT API key, paid TTS, X11 display):
- `smoke.sh` checks for the resource (env var present, display reachable). If absent → exit 2 with `SMOKE_SKIPPED` on stderr.
- The framework's `runSmokeFixture` (S13) treats exit 2 as "inconclusive — capability *might* be healthy, can't tell." Logged but not treated as failure for terminal routing.

Document this convention in each template and in `DECISIONS.md` for Phase 2.

**Acceptance:**

- Manual review: each template has a "Smoke fixture" section with a concrete reference `smoke.sh` body and frontmatter fields documented.
- Each installed plug's `smoke.sh` runs: `bash .my_agent/capabilities/<name>/scripts/smoke.sh; echo "exit=$?"` produces exit 0 (healthy plug) or exit 2 (hermetic-skip); never exit 1 on an installed-and-functional plug.
- One deliberately-broken plug (manually break, then revert) returns exit 1 from smoke — confirms the contract works.

**Verification:**

```bash
# Run from repo root.
ls skills/capability-templates/*.md
grep -l "Smoke fixture" skills/capability-templates/*.md  # should list all 5
grep -l "fallback_action:" skills/capability-templates/*.md
grep -l "multi_instance:" skills/capability-templates/*.md
ls .my_agent/capabilities/*/scripts/smoke.sh  # backfill check
for s in .my_agent/capabilities/*/scripts/smoke.sh; do
  echo "=== $s ==="
  bash "$s"; echo "exit=$?"
done
```

**Deviation triggers:**

- A template's plug fundamentally cannot run a self-contained smoke (e.g., requires paid API with no free smoke-path even with `SMOKE_SKIPPED` exit 2 fallback). Flag per template.
- An installed plug's `scripts/` folder doesn't exist yet (e.g., `tts-edge` has only `DECISIONS.md` — verify at sprint-time which plugs are actually deployed vs scaffolded).

**Universal coverage check:** every template gets the smoke contract. Every installed plug gets a working smoke.sh. If any installed plug can't get a working smoke.sh, name it in `FOLLOW-UPS.md` with the reason; that plug ships in Phase 2 with degraded reverify (warning logged) and is named in S15's exit-gate framing.

---

### 2.4 Sprint 12 — MCP detection spike → `PostToolUseFailure` hook + automation-origin wiring

**Design refs:** §3.1 (McpCapabilityCfrDetector block), §3.2 (origin generalization), §3.4 (6-step ordering rule), §6.1 (mandatory spike).

**Goal:** universal MCP-plug detection; automation-origin routing works end-to-end. **Day 1 of the sprint is a spike on `PostToolUseFailure` firing behavior — the rest of the sprint depends on the spike outcome.**

#### 2.4.1 Day-1 spike (mandatory, blocks rest of sprint)

Per design §6.1, break an MCP server three ways and observe SDK events:

1. **Tool-level exception** — server responds with an error mid-protocol. Use `browser-chrome` plug, deliberately call a tool with bad args.
2. **Child process crash** — `kill -9` the MCP server PID mid-session.
3. **Server-never-started** — corrupt the entrypoint command in `CAPABILITY.md`.

For each, log every SDK event fired (use a temporary catch-all hook if needed). Record findings in `proposals/s12-spike-results.md`. Decide:

- **All three route through `PostToolUseFailure`** → wire as planned below. No scope change.
- **Some route elsewhere** (top-level session error, message-stream `ToolUseError`, etc.) → expand sprint scope to wire multiple hooks. File deviation proposal documenting the hook list.
- **None route through hooks** → escalate to architect immediately. MCP detection design needs rework.

Spike duration target: 1 day. If it bleeds beyond 3 days, escalate.

#### 2.4.2 Implementation (after spike approval)

**Files:**

- `packages/core/src/capabilities/mcp-cfr-detector.ts` *(new)* — `createMcpCapabilityCfrDetector({cfr, registry, originFactory})` returning a `HookCallback` for `PostToolUseFailure` (and any additional hooks the spike identified). Calls `classifyMcpToolError(error)`. Includes a secondary `PostToolUse` (success-path) check for "success-shaped but empty" — emit `empty-result` only when the response is structurally empty (e.g., zero content blocks where one expected). Conservative.
- `packages/core/src/capabilities/failure-symptoms.ts` — add `classifyMcpToolError(error: string): CapabilityFailureSymptom`. Regex map per design §3.1:
  - `/timeout|etimedout/i` → `timeout`
  - `/schema|validation/i` → `validation-failed`
  - `/disabled|not enabled/i` → `not-enabled`
  - default → `execution-error`
- `packages/core/src/capabilities/registry.ts` — add `findByName(name: string): Capability | undefined`. Looks up by `CAPABILITY.md name:` field (the same name parsed from MCP tool names `mcp__<name>__<tool>`).
- `packages/core/src/capabilities/session-manager.ts` (around lines 431-456 — confirm at sprint-time) — attach detector alongside existing audit/screenshot hooks. Origin factory reads brain-session view-context (records which conversationId/turnNumber originated the SDK session). Variant: `kind: "conversation"`.
- `packages/dashboard/src/automations/automation-executor.ts` — `buildJobHooks` (around line 104) — append the CFR detector to the hooks list. Origin factory reads automation manifest → `kind: "automation"` with `notifyMode` defaulted to `"debrief"` per design §3.2.
- `packages/core/src/capabilities/ack-delivery.ts` — add branches for `automation` and `system` origins:
  - **Automation:** writes `CFR_RECOVERY.md` synchronously to `origin.runDir` on terminal transition (per §3.4 step 3). Content: fix summary, timestamps, plug name, attempt history. If `notifyMode === "immediate"`, fire the existing notification layer after the write succeeds.
  - **System:** logs only (component name + symptom + result). Dashboard health-page surfacing is deferred — see FOLLOW-UPS rule below.
  - **Conversation:** unchanged from Phase 1.
- `packages/core/src/capabilities/recovery-orchestrator.ts` — mutex extension:
  - `FixSession.attachedOrigins: TriggeringOrigin[]` — accumulates late-arriving CFRs for the same plug while a fix is in-flight (per design §3.4).
  - On terminal transition, drain origins in the 6-step order:
    1. Fix job's `deliverable.md` already persisted; framework's `writePaperTrail` already appended.
    2. Read reverify result. Failed → surrender branch (unchanged).
    3. For every attached automation origin: write `CFR_RECOVERY.md` (see ack-delivery branch above).
    4. For every attached conversation origin: if `recoveredContent` defined → `reprocessTurn`; else → `emitAck(terminal)`.
    5. For every attached system origin: log.
    6. Release per-type mutex.
  - Each origin gets its own try/catch — failures in one don't block subsequent steps.
- `packages/dashboard/src/scheduler/jobs/debrief-prep.ts` (or whichever file the debrief flow lives in — confirm at sprint-time via `rg "debrief" packages/dashboard/src/`) — extend to read `CFR_RECOVERY.md` from job `run_dir` when present and include its summary in the debrief prompt. Without this reader extension, the writer is orphaned.

**Acceptance tests:**

- `packages/core/tests/capabilities/mcp-cfr-detector.test.ts` *(new)* — classifier matrix per spike findings (timeout / validation-failed / not-enabled / execution-error / empty-result); `findByName` lookup; emit shape correct.
- `packages/core/tests/capabilities/registry-find-by-name.test.ts` *(new)* — `findByName` returns correct plug; missing name returns undefined; multi-instance types resolve by name uniquely.
- `packages/core/tests/capabilities/ack-delivery-origin.test.ts` *(new)* — automation branch writes `CFR_RECOVERY.md` to `runDir`; `notifyMode` default = `"debrief"`; `notifyMode: "immediate"` fires notification; system branch logs only; conversation branch unchanged.
- `packages/core/tests/capabilities/orchestrator/mutex-origin-coalescing.test.ts` *(new)* — late CFR for same plug attaches to `attachedOrigins`; terminal drain fires per-origin callbacks in §3.4 order; per-origin failures don't block siblings.
- `packages/dashboard/tests/integration/cfr-conversation-mcp.test.ts` *(new)* — conversation-origin MCP failure → channel ack fires.
- `packages/dashboard/tests/integration/cfr-automation-mcp.test.ts` *(new)* — automation-origin MCP failure → `CFR_RECOVERY.md` lands in job run dir; debrief carries summary.
- `packages/dashboard/tests/integration/debrief-prep-cfr-recovery.test.ts` *(new)* — debrief-prep reads `CFR_RECOVERY.md` and includes it in prompt.

**Verification:**

```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/mcp-cfr-detector tests/capabilities/registry-find-by-name tests/capabilities/ack-delivery-origin tests/capabilities/orchestrator/mutex-origin-coalescing
cd packages/dashboard && npx tsc --noEmit
cd packages/dashboard && npx vitest run tests/integration/cfr-conversation-mcp tests/integration/cfr-automation-mcp tests/integration/debrief-prep-cfr-recovery
```

**Deviation triggers:**

- Spike outcome diverges from "all three routes through `PostToolUseFailure`" (file proposal first, then proceed with adjusted scope).
- `buildJobHooks` signature differs from session-manager's hook attachment contract (propose alignment).
- `debrief-prep` flow's actual path differs significantly from the educated guess (confirm via grep at sprint-start, propose change if shape requires).
- The view-context struct in `session-manager.ts` doesn't carry the fields needed for origin factory. Propose extension.

**Universal coverage check:** every MCP-typed plug in `.my_agent/capabilities/` (today: `browser-chrome`, `desktop-x11`) routes through the new detector. Verify in review by listing each MCP plug and confirming the spike + detector covers its failure modes. If any MCP plug has a failure mode the spike didn't reproduce, name it in `FOLLOW-UPS.md`. **System-origin routing's dashboard health-page UI is intentionally minimal in S12 (logs only)** — full UI lands in S19 (Phase 3); name in `FOLLOW-UPS.md` with that pointer per the rule.

---

### 2.5 Sprint 13 — Reverify dispatcher + terminal-on-fix state

**Design refs:** §3.3 (REVERIFIERS table, runSmokeFixture), §3.4 (terminal states).

**Goal:** per-type reverifiers + smoke-fixture default + `RESTORED_TERMINAL` state for plugs without retriable input.

**Files:**

- `packages/core/src/capabilities/reverify.ts` —
  - Add `REVERIFIERS: Record<string, Reverifier>` dispatch table.
  - `dispatchReverify(failure, registry, watcher): Promise<ReverifyResult>` — top-level entry; routes to per-type reverifier or falls through to `runSmokeFixture`.
  - Add `reverifyTextToAudio` — runs `synthesize.sh` against deterministic fixture phrase (template-supplied), checks output file has valid Ogg/WAV magic bytes. Returns `{pass, recoveredContent: undefined}`.
  - Add `reverifyImageToText` — runs OCR script against template-supplied stock test image, expects non-empty text. Returns `{pass, recoveredContent: undefined}` (real-artifact reverify deferred per design §7).
  - Add `reverifyTextToImage` — runs generation against deterministic prompt fixture, checks output image header. Returns `{pass, recoveredContent: undefined}`.
  - **`runSmokeFixture` already delivered in S11** (commit `3a83a36`, signature `(capDir, registry, capabilityType): Promise<ReverifyResult>` — note the deviation from the original sketch `(failure, registry)`). S13's job is to **wire it into the dispatcher**, not re-implement it. The current implementation handles: missing `smoke.sh` → falls back to `cap.status === "available"` with `console.warn` (template-gap signal); exit 0 → pass; non-zero → fail with `failureMode: "smoke.sh failed: ..."`. **S13 must add exit-2 handling per the §6.4 hermeticity rule** — exit 2 → `{pass: true, inconclusive: true}` (the current implementation treats exit 2 as plain failure; needs a small extension to surface inconclusive results to the dispatcher). Add a unit test for exit-2 handling alongside the existing 4 tests in `tests/capabilities/run-smoke-fixture.test.ts`.
  - `verificationInputPath` field in `FixAttempt` always populated: triggering artifact path for type-specific reverifiers; `<capDir>/scripts/smoke.sh` (probe path) for smoke-fixture reverifier. Never empty string.
- `packages/core/src/capabilities/orchestrator-state-machine.ts` —
  - Add `RESTORED_TERMINAL` to `OrchestratorState` union.
  - Add `TERMINAL_ACK` to `Action` union.
  - Add `EXECUTING + REVERIFY_PASS_RECOVERED → RESTORED_WITH_REPROCESS` (rename / clarify existing transition; emits `REPROCESS_TURN`).
  - Add `EXECUTING + REVERIFY_PASS_TERMINAL → RESTORED_TERMINAL` (new transition; emits `TERMINAL_ACK`).
  - Both terminal for the recovery loop.
- `packages/core/src/capabilities/recovery-orchestrator.ts` —
  - After `dispatchReverify` returns pass: branch on `recoveredContent`. Defined → emit `REVERIFY_PASS_RECOVERED` event (existing reprocess flow). Undefined → emit `REVERIFY_PASS_TERMINAL`.
  - Origin-aware terminal routing per §3.4 6-step ordering (already wired in S12's mutex extension; this sprint adds the terminal branch logic):
    - Conversation origin + `RESTORED_TERMINAL` → `emitAck(terminal)` with §3.4 terminal copy.
    - Automation origin + `RESTORED_TERMINAL` → finalize `CFR_RECOVERY.md` (writer already in S12).
    - System origin + `RESTORED_TERMINAL` → log (already in S12 ack-delivery branch).

**Acceptance tests:**

- `packages/core/tests/capabilities/reverify-dispatch.test.ts` *(new)* — routes by type correctly; smoke-fixture default for MCP and unknown types; missing smoke.sh falls through to `cap.status === "available"` with warning; exit 2 treated as inconclusive.
- `packages/core/tests/capabilities/reverify-tts.test.ts` *(new)* — smoke.sh path runs + validates Ogg/WAV header.
- `packages/core/tests/capabilities/reverify-image-to-text.test.ts` *(new)* — fixture-only, returns `recoveredContent: undefined`.
- `packages/core/tests/capabilities/reverify-text-to-image.test.ts` *(new)* — fixture-only.
- `packages/core/tests/capabilities/reverify-smoke-fixture.test.ts` *(new)* — fresh out-of-session subprocess; not coupled to in-session MCP child.
- `packages/core/tests/capabilities/orchestrator/terminal-routing.test.ts` *(new)* — conversation origin → reprocess (recoveredContent defined) or terminal ack (undefined); automation origin → CFR_RECOVERY.md finalized; system origin → log only.
- Phase 1 STT reprocess tests still pass (regression gate).

**Verification:**

```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/reverify-dispatch tests/capabilities/reverify-tts tests/capabilities/reverify-image-to-text tests/capabilities/reverify-text-to-image tests/capabilities/reverify-smoke-fixture tests/capabilities/orchestrator/terminal-routing tests/capabilities/orchestrator
```

**Deviation triggers:**

- A registered plug type has a `smoke.sh` with a non-standard shape (S11 should have normalized — flag).
- The state-machine union widening breaks Phase 1 transition tests in unexpected ways (probably means S13's transitions are subtly different from intent — propose).
- Per-type reverifier needs a fixture that doesn't fit the template's smoke-fixture concept (e.g., requires a specific image not yet in the template). Propose where the fixture should live.

**Universal coverage check:** every plug type in `.my_agent/capabilities/` has either a per-type reverifier or routes through `runSmokeFixture` with a working `smoke.sh` (delivered in S11). Verify in review.

---

### 2.6 Sprint 14 — Friendly names + multi-instance + per-type fallback copy

**Design refs:** §2 principle 5, §3.4 (terminal copy), §4 (coverage bar — "names the right capability").

**Goal:** every plug type's user-facing copy uses friendly names; multi-instance types append the instance name; per-type fallback action copy lives in plug frontmatter.

**Files:**

- `packages/core/src/capabilities/resilience-messages.ts` —
  - Extend `FRIENDLY_NAMES` for every registered type. Today: `"audio-to-text" → "voice transcription"`, `"text-to-audio" → "voice reply"`, `"image-to-text" → "image understanding"`, `"text-to-image" → "image generation"`, `"desktop-control" → "desktop control"`, `"browser-control" → "browser"`. (Template `multi_instance: true` types get instance-name suffix at render time.)
  - **Multi-instance ack disambiguation:** for types where `registry.isMultiInstance(type) === true`, append the capability's `name` field: `"hold on — ${friendlyName}${isMultiInstance ? ` (${capabilityName})` : ""} isn't working right, fixing now."` So a Chrome failure reads "browser (chrome) isn't working right" instead of "browser-control isn't working right".
  - `surrender()` uses `friendlyName(failure.capabilityType)` (+ instance-name suffix) uniformly. Remove any hardcoded "voice transcription" strings from the existing `iteration-3` branch. Existing surrender reasons (`iteration-3`, `budget`, `surrender-cooldown`) keep their copy but parameterize on friendlyName.
  - **Terminal-recovery ack copy** for `RESTORED_TERMINAL` — per-type templates:
    - `audio-to-text` → "voice transcription is back — what's next?" (rare in practice; reprocess path applies).
    - `text-to-audio` → "voice reply is back — this message went out as text, but it'll be working next time."
    - `text-to-image` → "image generation is back — I'll include images next time."
    - MCP plugs (browser/desktop) → "{friendlyName}{instance suffix} is back — try again whenever you'd like."
  - **Per-type fallback action:** sourced from the capability template's `fallback_action` frontmatter (added in S11). The function `getFallbackAction(capabilityType): string` reads from the registered template via `registry`. Used in surrender copy and terminal acks.
- `packages/core/src/capabilities/registry.ts` — add `isMultiInstance(type: string): boolean` helper. Source of truth: the capability template's `multi_instance: true` frontmatter flag (S11 templates). Defaults false for any type whose template doesn't declare it.
- `packages/core/src/capabilities/types.ts` (or wherever Capability shape is defined — confirm via grep) — extend the loaded capability metadata to include `fallback_action` and `multi_instance` fields read from template frontmatter. Plug-level frontmatter can override template-level (advanced use case; document in `DECISIONS.md` whether to allow override or always inherit from template).
- `packages/core/src/capabilities/invoker.ts` — **add `capabilityName?: string` to `InvokeOptions`** (per `s10-FOLLOW-UPS.md` FU-4, deferred from S10 by architect). When set, the invoker filters `listByProvides` results to the named instance before applying enabled+available selection. When unset, current "first enabled+available, then first-by-insertion" behavior is preserved. This unblocks any future caller that needs a specific instance of a multi-instance type. Add a unit test in `invoker.test.ts`: register two `browser-control` instances with different names; call `invoker.run({ capabilityType: "browser-control", capabilityName: "browser-firefox", ... })` and assert the firefox instance is invoked.

**Acceptance tests:**

- `packages/core/tests/capabilities/resilience-messages-coverage.test.ts` *(new)* — every type registered in `.my_agent/capabilities/` has a friendly name + a `fallback_action`. Test fails if a new type is added without copy.
- `packages/core/tests/capabilities/resilience-messages-multi-instance.test.ts` *(new)* — multi-instance type ack includes capability name; single-instance does not.
- `packages/core/tests/capabilities/resilience-messages-terminal.test.ts` *(new)* — every type has terminal-recovery copy; copy uses friendly name + instance suffix where applicable.
- `packages/core/tests/capabilities/registry-multi-instance.test.ts` *(new)* — `isMultiInstance("browser-control")` returns true; `isMultiInstance("audio-to-text")` returns false.

**Verification:**

```bash
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/resilience-messages-coverage tests/capabilities/resilience-messages-multi-instance tests/capabilities/resilience-messages-terminal tests/capabilities/registry-multi-instance
```

**Deviation triggers:**

- Template frontmatter parsing doesn't surface to runtime (capability loader doesn't read these fields). Propose where to wire the loader.
- A registered type has no template (custom plug). Decide: require a template, or allow plug-level frontmatter override.

**Universal coverage check:** the coverage test (`resilience-messages-coverage.test.ts`) is itself the universal-coverage gate — it iterates every registered type and asserts copy exists. Add it to CI. **This is the model for how the universal-coverage rule (§0.1) gets enforced mechanically.**

Note: ack coalescing for parallel CFRs is **deferred to S19 (Phase 3)** per the rule — the architectural change of N-aware coalescing is a feature, not coverage. Name it in `FOLLOW-UPS.md` as "deferred to S19".

---

### 2.7 Sprint 15 — Phase 2 exit gate

**Design refs:** §4 (coverage bar), §6.2 (browser-control synthetic test framing).

**Goal:** end-to-end incident-replay test for every plug type currently installed in `.my_agent/capabilities/`. **Phase 2 closes here. M10 unblocks.**

**Test framing (honest):** STT and TTS conversation-origin tests are real-incident replays (Phase 1's STT incident; the 2026-04-16 TTS incident). Browser-control automation-origin test is a synthetic incident replay — the wiring exists but no historical incident exists. Desktop-control test is a synthetic replay if no incident exists; otherwise real.

**Files:**

- `packages/dashboard/tests/integration/app-harness.ts` (or extend existing harness — confirm path) — add a recording mock transport: `MockTransport` implements the transport interface and records every `send` call with args. Injection point in `AppHarness` so tests can inject voice/text input without going through real channels. Rationale: avoid violating the "no live outreach during tests" rule.
- `packages/dashboard/tests/e2e/cfr-phase2-stt-replay.test.ts` *(new)* — break `stt-deepgram` (remove `.enabled` or corrupt config), inject voice via AppHarness + mock transport, assert: ack fires → fix runs → reverify against persisted artifact → `reprocessTurn` → meaningful reply. Mirrors Phase 1's S7 exit gate but using v2 plumbing (CapabilityInvoker, dispatcher).
- `packages/dashboard/tests/e2e/cfr-phase2-tts-replay.test.ts` *(new)* — break `tts-edge-tts` (e.g., remove `.enabled`), send a text turn that triggers voice reply, assert: ack fires → fix runs → reverify via smoke fixture → terminal ack (no reprocess) → next turn produces voice. **Note:** TTS detection wiring is deferred from S10 (per the `// TODO(S13/S17)` marker) — confirm S13's reverifier is being exercised even if the detection emit point is still pending. If TTS detection is genuinely not wired by S15, file a deviation: either expedite S17 or wire a minimal TTS detection point in S13/S15.
- `packages/dashboard/tests/e2e/cfr-phase2-browser-synthetic.test.ts` *(new)* — synthetic test (per design §6.2). Create a test automation: open `https://example.com`, take a screenshot, attach to debrief. Set `notifyMode: debrief`. Deliberately break the `browser-chrome` plug at the plug side. Fire automation. Assert: `PostToolUseFailure` fires with `origin.kind === "automation"`; orchestrator runs fix path; smoke reverify passes; `CFR_RECOVERY.md` lands in job run dir; debrief includes summary; subsequent automation run is clean.
- `packages/dashboard/tests/e2e/cfr-phase2-desktop-synthetic.test.ts` *(new, if `desktop-x11` is installed and live)* — same shape as browser test against `desktop-x11`. Skip with explicit `it.skip` and reason if no live trigger exists.

**Acceptance:** all four tests green on the dev machine with installed plugs healthy at start.

**Verification:**

```bash
cd packages/dashboard && npx vitest run tests/e2e/cfr-phase2-stt-replay tests/e2e/cfr-phase2-tts-replay tests/e2e/cfr-phase2-browser-synthetic tests/e2e/cfr-phase2-desktop-synthetic
```

Dev-machine preconditions (document at sprint-start, not at run-time):
- All installed plugs healthy at start (smoke green for each).
- `DEEPGRAM_API_KEY` (or whatever STT requires) set.
- Browser-chrome plug functional (npx + playwright deps installed).

**Deviation triggers:**

- TTS detection not wired by S15 (the S10 deferral comes home to roost). Either fix in S15 with a minimal scoped emit at `synthesizeAudio`, or document as a known Phase 2 hole that S17 closes (but then Phase 2 doesn't fully close the gap). Propose.
- A plug type is installed but cannot be exercised in a synthetic test (no easy way to trigger it). Propose.
- An incident-replay test depends on a flow that's still being wired (e.g., debrief-prep extension from S12 incomplete). Sequence carefully.

**Universal coverage check:** **this sprint IS the coverage check for Phase 2.** Every plug type in `.my_agent/capabilities/` has its own E2E test file. If any plug is missing one, Phase 2 doesn't close.

**Phase 2 exit:** all four tests pass + S9–S14 acceptance gates green + architect approval. Roadmap commit lands AFTER architect approval per Phase 1 §0.3 rule. Phase 3 begins immediately; M10 waits per CTO decision.

---

## 3. Coverage matrix (Phase 2 deliverable)

| Capability type | Detection (from S12 spike) | Reverify path (S13) | Friendly name (S14) | Terminal state | Phase 2 E2E (S15) |
|---|---|---|---|---|---|
| `audio-to-text` (STT) | `CapabilityInvoker` (script) | `reverifyAudioToText` | "voice transcription" | `RESTORED_WITH_REPROCESS` | real-incident replay |
| `text-to-audio` (TTS) | `CapabilityInvoker` (script, deferred wiring per S10 note) | `reverifyTextToAudio` (smoke fixture) | "voice reply" | `RESTORED_TERMINAL` | real-incident replay |
| `browser-control` | `PostToolUseFailure` hook + `classifyMcpToolError` | `runSmokeFixture` (template smoke) | "browser (chrome)" multi-instance | `RESTORED_TERMINAL` | synthetic replay |
| `desktop-control` | `PostToolUseFailure` hook | `runSmokeFixture` (template smoke) | "desktop control" | `RESTORED_TERMINAL` | synthetic replay (if installed) |

Future capability types inherit the framework via the two gates and the smoke contract. No new CFR code per type.

---

## 4. Out of scope for Phase 2

The following land in Phase 3:
- Fix-engine swap to `capability-brainstorming` fix-mode (S16).
- Reflect-phase collapse (S17).
- Duplicate TTS path collapse (S18).
- Ack coalescing for parallel CFRs (S19).
- Assistant-turn orphan via `TranscriptTurn.failure_type` (S19).
- Full system-origin routing (dashboard health page) (S19).
- The two CTO-defined definitive smoke tests (§8 of v2.3, S20).

---

## 5. Design feature → sprint coverage map

For audit traceability — every feature in `capability-resilience-v2.md` §3 maps to a Phase 2 sprint or is explicitly Phase 3:

| Design ref | Feature | Phase 2 sprint |
|---|---|---|
| §3.1 | `CapabilityInvoker` class | S10 |
| §3.1 | Exec-bit validation | S10 |
| §3.1 | Drop bash wrapper in reverify | S10 |
| §3.1 | `classifySttError` removal | S10 |
| §3.1 | `McpCapabilityCfrDetector` class | S12 |
| §3.1 | `classifyMcpToolError` | S12 |
| §3.1 | Secondary `PostToolUse` empty check | S12 |
| §3.1 | `registry.findByName` | S12 |
| §3.1 | `session-manager` hook attachment | S12 |
| §3.1 | `automation-executor` hook attachment | S12 |
| §3.2 | `TriggeringOrigin` discriminated union | S9 |
| §3.2 | Emit-site rewraps (4 sites) | S9 |
| §3.2 | Consumer-site narrowings (5 sites) | S9 |
| §3.2 | `conversationOrigin` helper | S9 |
| §3.2 | `notifyMode` default = "debrief" | S12 |
| §3.3 | `REVERIFIERS` dispatch table | S13 |
| §3.3 | `reverifyTextToAudio` | S13 |
| §3.3 | `reverifyImageToText` | S13 |
| §3.3 | `reverifyTextToImage` | S13 |
| §3.3 | `runSmokeFixture` (out-of-session) | S13 |
| §3.3 | Smoke contract in 5 templates | S11 |
| §3.3 | Backfill smoke.sh into installed plugs | S11 |
| §3.3 | `verificationInputPath` always populated | S13 |
| §3.4 | `RESTORED_WITH_REPROCESS` state | S13 |
| §3.4 | `RESTORED_TERMINAL` state | S13 |
| §3.4 | `TERMINAL_ACK` action | S13 |
| §3.4 | 6-step terminal-transition ordering | S12 (mutex) + S13 (terminal branch) |
| §3.4 | `CFR_RECOVERY.md` writer | S12 |
| §3.4 | `CFR_RECOVERY.md` reader (debrief-prep) | S12 |
| §3.4 | `attachedOrigins` mutex extension | S12 |
| §2 principle 5 | Friendly names per type | S14 |
| §2 principle 5 | Multi-instance copy | S14 |
| §2 principle 5 | `isMultiInstance` registry helper | S14 |
| §2 principle 5 | `fallback_action` frontmatter | S11 (templates) + S14 (loader) |
| §2 principle 5 | `multi_instance` frontmatter | S11 (templates) + S14 (loader) |
| §3.4 | Terminal-recovery copy per type | S14 |
| §6.1 | `PostToolUseFailure` spike | S12 (Day 1) |
| §6.4 | Hermeticity exit-2 convention | S11 |
| §4 | Phase 2 coverage bar | S15 |
| §0 | Universal-coverage rule (§0.1 every sprint) | every sprint review |

**Phase 3 features (not in Phase 2):**

| Design ref | Feature | Phase 3 sprint |
|---|---|---|
| §3.5 | Fix-engine swap to `capability-brainstorming` fix-mode | S16 |
| §3.5 | `MODE: FIX` Step 0 gate | S16 |
| §3.5 | `ESCALATE:` markers (`redesign-needed`, `insufficient-context`) | S16 |
| §3.5 | `AutomationSpec.targetPath` | S16 |
| §3.5 | `spawnAutomation` closure copies `targetPath` | S16 |
| §3.5 | `.my_agent/` write-guard exemption | S16 |
| §3.5 | `JOB_TIMEOUT_MS` = 15 min for fix-mode | S16 |
| §3.5 / §6.3 | Wall-time measurement post-S16 | S16 |
| §3.5 | Sibling-skill escape hatch (Option B noted) | S16 |
| §5.3 | Reflect-phase collapse | S17 |
| §5.3 | Duplicate TTS path collapse | S18 |
| §5.3 | Ack coalescing for parallel CFRs | S19 |
| §5.3 | Assistant-turn orphan via `TranscriptTurn.failure_type` | S19 |
| §5.3 | System-origin dashboard health UI | S19 |
| §5.3 | Two CTO-defined definitive smoke tests | S20 |

---

*Created: 2026-04-17*
*Authors: Opus 4.7 (course-correct from Opus 4.6 v2.3)*
