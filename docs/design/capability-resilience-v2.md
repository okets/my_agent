# Capability Resilience v2 — Universal Coverage

> **Status:** Approved 2026-04-17 — course-correction of M9.6 after the STT-only handoff
> **Created:** 2026-04-17
> **Milestone:** M9.6 — extension of the original spec, not a new milestone
> **Supersedes:** sprint ordering and scope of [`../sprints/m9.6-capability-resilience/plan-universal-coverage.md`](../sprints/m9.6-capability-resilience/plan-universal-coverage.md) (v2.3, Opus 4.6). v2.3 stays on disk as historical reference; this doc + the new phase plans are authoritative.
> **Binding context:** [`capability-resilience.md`](capability-resilience.md) — original M9.6 design. Unchanged. v2 amends scope and architecture, not goals.
> **Origin:** [`../sprints/m9.6-capability-resilience/HANDOFF-cfr-coverage-gap.md`](../sprints/m9.6-capability-resilience/HANDOFF-cfr-coverage-gap.md) — the post-S8 gap report
> **Audit:** Opus 4.7 audit of v2.3, 2026-04-17 — six findings, three plan-shape changes, recorded in this doc

---

## 0. Why this exists

M9.6 was sold as "when any capability fails during a user interaction, recover gracefully." Phase 1 (S1–S8) shipped *"when the STT capability fails during a conversation, recover gracefully."* Every other plug type — TTS, image-to-text, text-to-image, desktop-control, browser-control, future custom types — still has the silent-failure bug class M9.6 claimed to close.

The gap surfaced on 2026-04-16 when a WhatsApp voice message produced a text reply because `text-to-audio` had no `.enabled` file and the framework had no CFR emitter on the TTS invocation path to notice. Detection had been wired per-call-site for STT only, while every other layer — emitter, orchestrator, reverify dispatch, ack copy, mutex — was deliberately generic. Every Phase 1 sprint review approved the asymmetry without flagging it. The S7 exit gate verified the one path that was wired. Pass.

A v2.3 follow-up plan was written by Opus 4.6 (the same agent that wrote v1). An Opus 4.7 audit found the architectural core sound but the scope ~2× too wide: ten sprints bundled coverage with three orthogonal refactors (fix-engine swap, reflect-phase collapse, duplicate-TTS-path collapse) and two speculative features (parallel-CFR coalescing, system-origin routing). v2 splits the work into two phases with a clear coverage gate between them, accepts the architectural moves Opus 4.6 designed correctly, defers what doesn't belong, and corrects three specific issues Opus 4.6 acknowledged on direct questioning.

---

## 1. Framing — sockets and plugs

CTO, 2026-04-16:

> *"We provide the socket, the agent provides the plug. Nina built a plug, the plug fails, maybe she had a bug, maybe we changed something, maybe she uses a service that broke. I don't care much for the reason, but as long as it's a plug issue, Nina should be able to fix it the same way she was able to build it. With proper ACK and a streamlined UX. If we have issues with our socket side — like saving audio files before parsing so the agent can look for them and parse them after she fixed the capability — it's our role. If not, the agent's role."*

Translated to ownership:

- **Socket (framework) owns:** detecting any plug failure, persisting enough context that the fix is retriable, engaging the agent on the plug's own folder, verifying the fix, and the user-facing ack/status/surrender UX.
- **Plug (agent's capability) owns:** the actual fix. The agent uses the same skill she used to author the plug, reading the plug's existing folder (`CAPABILITY.md`, `config.yaml`, `scripts/`, `DECISIONS.md`) and making a targeted change. Brainstorming from scratch is the wall-hit fallback, never the default path.

The detection layer being generic is the architectural difference between v1 and v2.

---

## 2. Design principles

1. **Detection is socket-level, not plug-level.** Every sanctioned path from a triggering input → plug execution passes through a framework-owned gate that emits CFR on failure. The plug author never writes detection code.
2. **Invocation style is an implementation detail.** Script plugs (execFile) and MCP plugs (Agent SDK tool-call) have different invocation shapes but the same socket contract. There are exactly two gates — one per invocation style.
3. **Fix is symmetric with authoring.** The orchestrator does not maintain a parallel fix prompt. It invokes the same `capability-brainstorming` skill in fix-mode; the skill reads the plug's folder and DECISIONS.md, makes a targeted change in-process. The framework appends a paper-trail entry via its existing `writePaperTrail` hook. *(Phase 3.)*
4. **Retry semantics are type-aware.** Some plugs have a retriable input (STT, image-to-text — the user's artifact is persisted, re-run against it). Some don't (TTS, text-to-image, MCP tools — the triggering input was text or a tool call; nothing to replay). The orchestrator has two terminal states: `RESTORED_WITH_REPROCESS` (re-run the user's turn with recovered content) and `RESTORED_TERMINAL` (capability is healthy, no turn to replay — ack accordingly).
5. **User-facing copy uses the plug's friendly name + instance name for multi-instance types.** No hardcoded "voice transcription" strings survive. `FRIENDLY_NAMES[failure.capabilityType]` for the type; `failure.capabilityName` appended for multi-instance types.
6. **Origin-agnostic core, origin-aware routing.** Capabilities fail from three places: a live conversation, a background automation job, or a framework-internal system task. Detection, fix, reverify, and paper trail are identical across origins. Only the user-facing side — ack delivery, terminal routing, reprocess semantics — branches on origin. The plug author never writes origin code.
7. **Smoke-fixture contract per plug.** Every plug declares a `scripts/smoke.sh`. Exit 0 = healthy. Run by the framework as a fresh out-of-session subprocess. This is how reverify works without per-type framework code for every future capability type.
8. **Universal coverage discipline (the §0 rule).** Every sprint that adds a generic layer must show coverage for every plug type registered in `.my_agent/capabilities/` at sprint-end. If a new type can't be covered in-sprint, name it and scope it; do not omit it. *(See §8.)*

---

## 3. Architecture

### 3.1 Two detection gates

**`CapabilityInvoker` — single gate for script plugs.**

`packages/core/src/capabilities/invoker.ts` (new). The only sanctioned way to invoke a plug's shell script. Wraps `registry.get()` + `execFile` + error classification + `cfr.emitFailure()` in one call. Behavior:

- Registry returns no plug → emit `not-installed`.
- Plug exists but `cap.enabled === false` → emit `not-enabled`.
- Plug enabled but `cap.status !== "available"` → emit `execution-error`.
- `execFile` rejects with timeout marker → emit `timeout`.
- `execFile` rejects otherwise → emit `execution-error`.
- `expectJson` and stdout is not valid JSON → emit `validation-failed`.

Caller receives `{kind: "failure", symptom, detail}` and degrades however it was going to degrade — the CFR has already fired. Exec-bit validation lives in the registry's scanner: any `scripts/*.sh` without exec bit marks the plug `invalid`, so the invoker can drop the `bash` wrapper inherited from S1 and call `execFile(scriptPath, args)` directly.

Semantic failures (e.g., "STT returned empty text but the script succeeded") stay at the caller — they're plug-specific judgment calls, not invocation outcomes. `classifyEmptyStt` in `failure-symptoms.ts` stays put.

**`McpCapabilityCfrDetector` — single gate for MCP plugs.**

`packages/core/src/capabilities/mcp-cfr-detector.ts` (new). Wired as a `PostToolUseFailure` hook in both:
- `session-manager.ts` (brain sessions → conversation-origin)
- `automation-executor.ts:426` (`buildJobHooks` → automation-origin)

The hook reads SDK `error: string`, classifies via `classifyMcpToolError(error)` (timeout / validation-failed / not-enabled / execution-error), looks up the plug via `registry.findByName(name)` (where `name` is parsed from the tool name `mcp__<capability.name>__<tool>`), and emits CFR.

**Critical unverified assumption — must be spiked before commit.** `PostToolUseFailure` is type-def-confirmed (`sdk.d.ts:1229-1236`); its actual firing behavior against MCP server-level failures (child crashed, connection lost, server-never-started) is **not** verified. S12 spike is mandatory; see §6.

`PostToolUse` (success-path) carries a secondary lightweight check for "success-shaped but empty" — emit `empty-result` only when the tool returned a structurally empty response (e.g., zero content blocks where one was expected). Conservative to avoid double-emits.

### 3.2 `TriggeringOrigin` discriminated union

```typescript
export type TriggeringOrigin =
  | { kind: "conversation"; conversationId: string; turnNumber: number; channel: Channel }
  | { kind: "automation"; automationId: string; jobId: string; runDir: string; notifyMode: "immediate" | "debrief" | "none" }
  | { kind: "system"; component: string };

export interface TriggeringInput {
  origin: TriggeringOrigin;
  artifact?: { type: "audio" | "image" | "document"; rawMediaPath: string; mimeType: string };
  userUtterance?: string;
}
```

Existing emit sites mechanically rewrap into `origin: { kind: "conversation", ... }` (chat-service.ts:594/685/700, orphan-watchdog.ts:422). Existing consumers (recovery-orchestrator, ack-delivery, reverify, app.ts:749-760, orphan-watchdog re-processor) get discriminated-union narrowings — `switch (origin.kind)` or early-return on non-conversation — to guard field accesses.

No data migration: `CapabilityFailure` and `FixAttempt` are in-memory only on the orchestrator. TypeScript clean break.

`notifyMode` defaults to `"debrief"` when an automation manifest doesn't specify — safest, surfaces on next debrief without real-time spam.

### 3.3 Reverify dispatcher + smoke-fixture contract

`packages/core/src/capabilities/reverify.ts`:

```typescript
const REVERIFIERS: Record<string, Reverifier> = {
  "audio-to-text": reverifyAudioToText,
  "text-to-audio": reverifyTextToAudio,
  "image-to-text": reverifyImageToText,
  "text-to-image": reverifyTextToImage,
};

async function dispatchReverify(failure, registry, watcher): Promise<ReverifyResult> {
  const specific = REVERIFIERS[failure.capabilityType];
  if (specific) return specific(failure, registry);
  return runSmokeFixture(failure, registry);  // default for MCP plugs, custom types
}
```

- `reverifyAudioToText`: unchanged semantics. Refactored to use `CapabilityInvoker`. Returns `{pass, recoveredContent: <transcription>}` — the only reverifier that yields content for reprocess.
- `reverifyTextToAudio`: runs `synthesize.sh` against a deterministic fixture phrase, checks output file headers (Ogg/WAV magic). Returns `{pass, recoveredContent: undefined}`.
- `reverifyImageToText`: runs OCR script against a stock test image (template fixture), expects non-empty text. Returns `{pass, recoveredContent: undefined}` — real-artifact reverify deferred.
- `reverifyTextToImage`: runs generation against a deterministic prompt, checks output image headers. Returns `{pass, recoveredContent: undefined}`.
- `runSmokeFixture` (default): executes `<capDir>/scripts/smoke.sh` as a **fresh out-of-session subprocess**. Treats exit 0 as pass. Falls back to "capability reports `status: available`" if `smoke.sh` is missing, with a warning logged.

**Smoke fixture contract — landed in templates AND backfilled into installed plugs in the same sprint.** Every capability template gains a "Smoke fixture" section declaring a required `scripts/smoke.sh`; every currently-installed plug in `.my_agent/capabilities/` gets one written during the same sprint. Without the backfill, `runSmokeFixture` ships with degraded fall-through behavior on day-one for every existing plug — that would be backwards.

For MCP plugs: `smoke.sh` spawns the MCP server, invokes the core required tool once, checks the response is well-formed, tears down.

**Reverify is out-of-session, MCP children are not expected to recover mid-session.** When an automation job's MCP plug fails, the plug's child process stays broken for the remainder of that job. `runSmokeFixture` probes the fix independently. The job-side child is abandoned; next invocation starts a fresh session with a fresh child that inherits the fix.

### 3.4 Terminal states (`RESTORED_WITH_REPROCESS` / `RESTORED_TERMINAL`)

Today's orchestrator calls `reprocessTurn` unconditionally on reverify pass. For STT this re-runs the user's turn with the recovered transcription; for TTS/MCP there's no user input to re-run.

Solution: extend the state machine's DONE-family:

- `RESTORED_WITH_REPROCESS` — reverifier returned `recoveredContent` → call `reprocessTurn` (STT path).
- `RESTORED_TERMINAL` (new) — reverifier returned `{pass: true, recoveredContent: undefined}` → skip reprocess, emit terminal-recovery ack ("voice reply is back — this message went out as text, but it'll be working next time" or per-type equivalent).

Both terminal for the recovery loop. A new `TERMINAL_ACK` action fires the per-type terminal copy. The state-machine diff retains `REPROCESS_TURN` (STT path).

Origin-aware terminal routing per the 6-step ordering in §3.6:
1. Fix job's `deliverable.md` persists; framework's `writePaperTrail` appends to plug's DECISIONS.md.
2. Orchestrator reads reverify result. Failed → surrender branch.
3. On reverify pass, for every attached **automation** origin: write `CFR_RECOVERY.md` synchronously to `origin.runDir`. If `notifyMode === "immediate"`, fire notification.
4. For every attached **conversation** origin: if `recoveredContent` defined → `reprocessTurn` (STT); else → `emitAck(terminal)`.
5. For every attached **system** origin: log + dashboard health page.
6. Release per-type mutex.

Steps 3–5 sequential, automations first. Each origin gets its own try/catch.

### 3.5 Fix engine (Phase 3)

The orchestrator stops rendering `fix-automation.md`. It invokes `capability-brainstorming` with a `MODE: FIX` prefix. The skill's Step 0 hard-disables Steps 1–6 (research, scope, design, build, test, ship) and the `.enabled` write. Fix-mode reads the plug folder + DECISIONS.md, forms a hypothesis from the symptom + previous-attempts table, makes a targeted change in-process, runs `<capDir>/scripts/smoke.sh`, writes `deliverable.md`. No nested `create_automation`. No clarifying questions — if insufficient context, write `ESCALATE: insufficient-context` and stop. If existing design can't be repaired, write `ESCALATE: redesign-needed` and stop.

The orchestrator parses `ESCALATE:` markers atop `deliverable.md` body and surrenders directly with the corresponding reason; reverify is skipped for that attempt.

`AutomationSpec` gains `targetPath?: string`; orchestrator sets `targetPath: cap.path`; dashboard's `spawnAutomation` closure (`app.ts:635-653`) copies into `manifest.target_path`. The automation framework's `writePaperTrail` (`automation-executor.ts:594-603`) reads `target_path` to append the paper-trail entry. The `.my_agent/` write-guard hook exempts `job_type === "capability_modify"` scoped to `.my_agent/capabilities/<name>/`.

`JOB_TIMEOUT_MS` for fix-mode jobs raises to 15 min (from 10). Cold Opus run on an unfamiliar plug is projected at 5–12 min. **Wall-time is paper-estimated, not measured.** S16 must measure post-implementation against at least two plug types and propose mitigations (60s status ack, Sonnet for simple symptom classes) if consistently >5 min. See §6.

**Sibling-skill escape hatch.** The CTO chose Option A (mode flag on `capability-brainstorming`) per the "same way she built it" framing. Option B (separate `capability-fixing` skill) stays available if implementation reveals coupling pain. Decision is conversational, not architectural; refactor if needed.

### 3.6 Frozen surfaces

Frozen (no edits in v2):
- `cfr-emitter.ts` — the emitter.
- `ack-delivery.ts` transport routing core (additions land as a new layer, not a rewrite).
- `RecoveryOrchestrator.handle()` cooldown / mutex / budget infrastructure (origin-attachment adds a notify list, not a reshape).

Not frozen:
- `cfr-types.ts` — `TriggeringInput` widens with `origin`; `FixAttempt.phase` narrows in Phase 3.
- `orchestrator-state-machine.ts` — terminal-state split (Phase 2); reflect collapse (Phase 3).
- `resilience-messages.ts` — friendly names + multi-instance + terminal copy + new surrender reasons.
- `orphan-watchdog.ts` — scanner extension (Phase 3).
- `failure-symptoms.ts` — `classifySttError` removal (Phase 2 S10); `classifyMcpToolError` addition (Phase 2 S12).

Violations require a deviation proposal.

---

## 4. Coverage bar (exit criterion)

The milestone is done when, for every capability type registered in `.my_agent/capabilities/` at acceptance:

- **If the plug fails from any origin** — live conversation, automation job, or system task — the socket emits CFR automatically (no per-site wiring in the caller).
- **The orchestrator engages a fix path** — Phase 2: `fix-automation.md`; Phase 3: `capability-brainstorming` in fix-mode.
- **DECISIONS.md gets a paper-trail append** for every fix attempt via the automation framework's `writePaperTrail`.
- **Reverify confirms the fix** — either against the persisted triggering artifact (STT, image-to-text) or against the plug's `scripts/smoke.sh`.
- **The user gets an ack that names the right capability** ("voice reply", "image generation", "browser (chrome)" for multi-instance) — never the generic raw type, never the wrong type.
- **An incident-replay test exists** for every plug type installed on the test machine.

Future capability types inherit coverage through the two gates and the smoke-fixture contract, with no new CFR code.

---

## 5. Phase boundaries

The work is one milestone (M9.6), three phases. Phase 2 is the architectural minimum to unblock M10. **CTO scheduling decision 2026-04-17: M10 work does NOT start until Phase 3 closes (M9.6 done).** Phases 2 and 3 ship sequentially before M10 begins.

### 5.1 Phase 1 — STT-only CFR (DONE)

S1–S8. Shipped, exit gate passed for STT path. See [`../sprints/m9.6-capability-resilience/plan.md`](../sprints/m9.6-capability-resilience/plan.md). No further work.

### 5.2 Phase 2 — Universal coverage (S9–S15)

The actual stated goal of M9.6. Closes the coverage gap for every currently-installed plug type. Plan: [`../sprints/m9.6-capability-resilience/plan-phase2-coverage.md`](../sprints/m9.6-capability-resilience/plan-phase2-coverage.md).

| Sprint | Goal | Depends on |
|--------|------|-----------|
| S9 | `TriggeringOrigin` type landing (zero behavior); §5 matrix correction | — |
| S10 | `CapabilityInvoker` + exec-bit validation | S9 |
| S11 | Template smoke fixtures + backfill into installed plugs | S10 |
| S12 | MCP detection spike → `PostToolUseFailure` hook + automation-origin wiring | S9, S11 |
| S13 | Reverify dispatcher + terminal-on-fix state | S10, S11, S12 |
| S14 | Friendly names + multi-instance copy + per-type fallback copy | S13 |
| S15 | Phase 2 exit gate: incident-replay per installed plug type | S9–S14 |

**Phase 2 exit:** every installed plug type has a working CFR path from detection → fix → reverify → ack. This is the architectural unblock-point for M10, but per the CTO decision above, M10 work does not start here — Phase 3 runs first.

### 5.3 Phase 3 — Architecture refinements (S16–S20)

Layered on a green Phase 2. Plan: [`../sprints/m9.6-capability-resilience/plan-phase3-refinements.md`](../sprints/m9.6-capability-resilience/plan-phase3-refinements.md).

| Sprint | Goal | Depends on |
|--------|------|-----------|
| S16 | Fix-engine swap to `capability-brainstorming` fix-mode + wall-time measurement | Phase 2 |
| S17 | Reflect-phase collapse (dead-code cleanup, post-fix-mode) | S16 |
| S18 | Duplicate TTS path collapse | Phase 2 |
| S19 | Ack coalescing + assistant-turn orphan via `TranscriptTurn.failure_type` + system-origin routing | S16 |
| S20 | Phase 3 exit gate: the two CTO-defined definitive smoke tests (automation-origin browser, conversation-origin voice) | S16–S19 |

**Why this ordering** (corrects v2.3): S16 ships fix-mode as one-shot Opus that bypasses reflect. S17 then deletes reflect as dead code. The reverse ordering — S17 first — would leave the existing Sonnet-only fix path running without its Opus reflect step between sprints, a quality regression during the gap. Opus 4.6 acknowledged this miss directly.

**Phase 3 exit:** the architectural refinements land. M9.6 closes.

---

## 6. Open verifications (must-spike before commit)

These are unverified assumptions baked into the plan. Each carries an explicit pre-sprint spike.

### 6.1 `PostToolUseFailure` firing behavior (S12, mandatory)

**Status:** type-def-confirmed (`sdk.d.ts:1229-1236`). Runtime behavior against actual MCP failures is not verified.

**Spike:** Day 1 of S12. Break an MCP server three ways and observe which SDK events fire for each:
1. Tool-level exception (server responds with an error mid-protocol).
2. Child process crash (server killed mid-session).
3. Server-never-started (entrypoint command fails).

**Acceptable spike outcomes:**
- All three route through `PostToolUseFailure` → wire as planned.
- Some route elsewhere (e.g., top-level session error, message-stream `ToolUseError`) → S12 scope expands to wire multiple hooks. File deviation proposal.
- None route through hooks → MCP detection design needs rework. Block S12, escalate to architect.

**Why it matters:** if server-level failures don't fire `PostToolUseFailure`, S12 ships a hook that catches only the failure modes the SDK *catches*, not the ones that motivated this work (broken plugs that never start).

### 6.2 Browser-control automation flow live? (S15, framing)

**Status:** wiring exists (`automation-executor.ts:353-377` + `:418,426`); no production automation currently invokes `browser-control` end-to-end (Opus 4.6 confirmed).

**Implication for S15 exit gate:** the automation-origin / browser-control test is a *synthetic* incident replay, not a historical-incident replay. STT and TTS conversation-origin tests are real-incident replays. Phase 2's exit gate is honest about this distinction in test naming and acceptance commentary. Both are valid; the labels matter.

### 6.3 Fix-mode wall-time (S16, mandatory measurement)

**Status:** projected 5–12 min for a cold Opus run on an unfamiliar plug. Single real data point: 142s end-to-end for a Phase 1 STT fix using Sonnet-execute + Opus-reflect.

**Measurement:** S16 acceptance gate includes a wall-time test against at least two plug types (STT plus one MCP plug). Recorded in S16's `DECISIONS.md`.

**If consistently >5 min:** file proposal in S16 for either:
- Second status ack at 60s (in addition to the existing 20s ack from Phase 1 S6).
- Sonnet for simple symptom classes (`not-enabled`, configuration errors); Opus for hard diagnosis (`execution-error`, `timeout`).

### 6.4 Smoke-fixture hermeticity per plug (S11)

**Status:** the smoke contract assumes every plug can run a self-contained smoke without external resources. Some plugs (cloud STT, paid TTS) require API keys. X11 plugs need a display.

**S11 acceptance:** for every template, document the fallback when external resources aren't available (e.g., "smoke requires `DEEPGRAM_API_KEY`; absent → smoke exits 2 with `SMOKE_SKIPPED`, framework treats as inconclusive, not a failure"). The framework's treatment of inconclusive smoke is documented in S13 (reverify dispatcher).

---

## 7. Out of scope

- **Nested-CFR budget (`parentFailureId`).** Stays parked. Fix-mode forbids nested builder spawns.
- **Adding new capability types** beyond those in `.my_agent/capabilities/` at acceptance time.
- **Full redesign flow for `redesign-needed` escalation.** This milestone surrenders the turn gracefully and logs. A later milestone wires a conversational-layer flow that engages authoring-mode `capability-brainstorming` on user follow-up.
- **Real-artifact reverify for `image-to-text`.** Fixture-only this milestone.
- **CI audio via secrets** (Phase 1 S7-FU3) — unchanged.
- **Cross-conversation orphan recovery across automation + conversation boundaries.** Existing job-debrief mechanism handles automation orphans separately.

---

## 8. The §0 universal-coverage rule

Every Phase 2 and Phase 3 sprint's `§0 / Goal` MUST include this rule verbatim:

> **Universal-coverage rule:** Any new generic layer this sprint adds must come with coverage for every capability type registered in `.my_agent/capabilities/` at sprint-end. If a new type can't be covered in-sprint, name it explicitly in `FOLLOW-UPS.md` with: (a) the type, (b) why it can't be covered now, (c) which sprint will cover it. Omitting a type silently is a sprint-failure condition, not a follow-up.

This is the rule that would have caught the original Phase 1 mistake — the architect approved a per-call-site STT detection while every other layer was generic, and no review fired. The rule lives in §0 of every plan so every implementing agent reads it before touching code.

The architect's review checklist for every sprint must verify: "Does the new layer have coverage for every plug type listed in `.my_agent/capabilities/`?" If the answer is no, the sprint is rejected.

---

## 9. References

- **Original M9.6 design (binding context):** [`capability-resilience.md`](capability-resilience.md)
- **Original red-team:** [`capability-resilience-redteam.md`](capability-resilience-redteam.md)
- **Phase 1 plan (DONE):** [`../sprints/m9.6-capability-resilience/plan.md`](../sprints/m9.6-capability-resilience/plan.md)
- **Coverage gap handoff:** [`../sprints/m9.6-capability-resilience/HANDOFF-cfr-coverage-gap.md`](../sprints/m9.6-capability-resilience/HANDOFF-cfr-coverage-gap.md)
- **v2.3 plan (superseded by phase plans, retained as reference):** [`../sprints/m9.6-capability-resilience/plan-universal-coverage.md`](../sprints/m9.6-capability-resilience/plan-universal-coverage.md)
- **Phase 2 plan:** [`../sprints/m9.6-capability-resilience/plan-phase2-coverage.md`](../sprints/m9.6-capability-resilience/plan-phase2-coverage.md)
- **Phase 3 plan:** [`../sprints/m9.6-capability-resilience/plan-phase3-refinements.md`](../sprints/m9.6-capability-resilience/plan-phase3-refinements.md)
- **Capability system:** [`capability-system.md`](capability-system.md)
- **Capability framework v2 (multi-instance):** [`capability-framework-v2.md`](capability-framework-v2.md)
- **Routing rule (for acks):** [`../sprints/m10-s0-routing-simplification/plan.md`](../sprints/m10-s0-routing-simplification/plan.md)
- **Incident that started M9.6:** `.my_agent/conversations/conv-01KP3WPV3KGHWCRHD7VX8XVZFZ.jsonl`
- **TTS gap incident:** 2026-04-16 WhatsApp voice reply (text fallback)

---

*Created: 2026-04-17*
*Authors: Opus 4.7 (audit + course-correct), Opus 4.6 (architectural moves in §3)*
