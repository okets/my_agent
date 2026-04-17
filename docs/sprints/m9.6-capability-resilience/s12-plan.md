# M9.6-S12 PostToolUseFailure CFR Hook + Automation-Origin Wiring — Dev Sub-Task Tracker

> **NOT THE ARCHITECT PLAN** — this is the dev's sub-task breakdown. The architect plan is [`plan-phase2-coverage.md §2.4`](plan-phase2-coverage.md). This sub-tracker integrates the architect's pre-sprint corrections (C1–C9) inline so the dev sees a single executable plan.

> **For agentic workers:** Implement task-by-task. Use TaskUpdate to mark status. Stop-On-Deviation rule from `plan.md §0` applies — file proposals in `proposals/s12-<slug>.md`. **Process from `plan-phase2-coverage.md §0.3` is non-negotiable** — see "Process compliance" below.

**Sprint:** M9.6-S12
**Date:** 2026-04-17
**Branch:** `sprint/m9.6-s12-mcp-cfr-detector`
**Design refs:** [`capability-resilience-v2.md`](../../design/capability-resilience-v2.md) §3.1 (McpCapabilityCfrDetector + CapabilityInvoker placeholder fix), §3.2 (origin generalization), §3.4 (6-step ordering rule + terminal states), §6.1 (mandatory PostToolUseFailure spike)

---

## Goal

Universal MCP-plug detection; automation-origin routing works end-to-end; conversation-origin's S10-placeholder origin replaced with real session context.

- Detect MCP tool failures via the Agent SDK's `PostToolUseFailure` hook (verified by Day-1 spike).
- Route every plug failure to the orchestrator regardless of origin (conversation / automation / system).
- Replace the S10 placeholder origin in `app.ts:542-546` with a real `SessionContext`-driven factory.
- Write `CFR_RECOVERY.md` to the automation job's run dir on terminal transition; extend `debrief-prep` to read it.
- Extend the orchestrator mutex with `attachedOrigins` so late-arriving CFRs for the same plug attach to the in-flight fix rather than spawning a duplicate (N-aware, not capped at 2).
- Replace **all five** S9 "unreachable in S12" throws — the first non-conversation CFR will crash any throw left behind.
- Make the orchestrator's terminal flow non-crashing for non-conversation origins (skip `reprocessTurn` when there's no turn). Full `RESTORED_TERMINAL` state machine wiring is S13; S12 just makes the path safe.

**Exit condition:** every MCP-typed plug in `.my_agent/capabilities/` (today: `browser-chrome`, `desktop-x11`) has CFR emission wired via the spike-confirmed hook(s); automation-origin tests land `CFR_RECOVERY.md` in the job run dir; debrief-prep parses it; conversation-origin uses real session context (not the placeholder); zero `unreachable in S9` throws remain in production code; all acceptance tests green.

---

## Process compliance (non-negotiable; § 0.3)

- Sprint artifacts at completion: `s12-DECISIONS.md`, `s12-DEVIATIONS.md`, `s12-FOLLOW-UPS.md`, `s12-test-report.md`. Optional `s12-review.md` from external auditor with frontmatter `reviewer: External auditor (dev-contracted)` and `recommended: APPROVE | REJECT | CONDITIONAL` (NEVER `verdict: APPROVED`).
- Dev does NOT write `s12-architect-review.md` — that file is the architect's exclusively.
- Dev does NOT commit `Done` / `APPROVED` framing in any commit message before architect approval. Roadmap-done commit lands AFTER `s12-architect-review.md` per Phase 1 §0.3.
- §0.2 detection-at-the-gates rule: any `cfr.emitFailure(...)` call must be inside `CapabilityInvoker` (S10) or `McpCapabilityCfrDetector` (this sprint). Socket-internal failures (deps wiring) emit directly per Phase 1 patterns. Anything else → STOP and file a deviation proposal.
- **Scope creep was the central S11 process failure.** If you find yourself implementing something not in the "File Map" below, STOP and file `proposals/s12-<slug>.md` BEFORE writing code. Inline code comments are not deviation proposals.

---

## Day-1 spike (mandatory; gates Tasks 2–9)

Per design §6.1, `PostToolUseFailure` is type-def-confirmed (`sdk.d.ts:1229-1236`) but its actual firing behavior against MCP server-level failures is **not** verified. Spike-first, then implement.

Break a real MCP server (use `browser-chrome` plug) three ways and observe SDK events:

1. **Tool-level exception** — call a `browser-chrome` tool with bad args so the server responds with an error mid-protocol.
2. **Child process crash** — `kill -9` the MCP server PID mid-session.
3. **Server-never-started** — corrupt the entrypoint command in `CAPABILITY.md` or block its startup.

For each, log every SDK event fired (use a temporary catch-all hook attached to every `HookEvent` in `HOOK_EVENTS` from the SDK; print event name + payload). Record findings in `proposals/s12-spike-results.md`.

**Outcomes and required actions:**

| Spike result | Required action before Task 2 |
|---|---|
| All three route through `PostToolUseFailure` | File spike-results.md anyway; proceed with planned scope. |
| Some route through other events (e.g., session-error for crashes; message-stream `ToolUseError`) | File spike-results.md AND a deviation proposal listing the additional hooks needed. **Stop. Wait for architect adjudication** before starting Task 2. Architect will commit scope expansions to this plan. |
| None of the three route through any hook | **Stop immediately.** Escalate to CTO + architect. Detection design needs rework; do not proceed. |

**Architect-review gate (per design §6.1):** regardless of outcome, the spike result MUST be reviewed by the architect before Task 2 begins. The dev does not self-approve the spike. Pause after `proposals/s12-spike-results.md` lands; notify CTO; wait for architect commit confirming or expanding scope.

Spike target: 1 day. Escalate if it bleeds beyond 3 days.

---

## File Map

| Action | Path |
|---|---|
| Proposal | `docs/sprints/m9.6-capability-resilience/proposals/s12-spike-results.md` (Day-1 spike findings) |
| Create | `packages/core/src/capabilities/mcp-cfr-detector.ts` |
| Modify | `packages/core/src/capabilities/failure-symptoms.ts` (add `classifyMcpToolError`) |
| Modify | `packages/core/src/capabilities/registry.ts` (add `findByName`) |
| Modify | `packages/dashboard/src/agent/session-manager.ts` (SessionContext + attach detector to brain sessions; conversation-origin factory) |
| Modify | `packages/dashboard/src/automations/automation-executor.ts` (SessionContext + attach detector to job sessions; automation-origin factory in `buildJobHooks`) |
| Modify | `packages/dashboard/src/app.ts:~542-546` (replace S10 placeholder origin with real SessionContext-driven factory; rewire `app.capabilityInvoker.originFactory` to read from session-manager's view-context) |
| Modify | `packages/core/src/capabilities/ack-delivery.ts:~73` (add automation + system branches; `CFR_RECOVERY.md` writer; remove S9 unreachable throw) |
| Modify | `packages/core/src/capabilities/recovery-orchestrator.ts` (mutex `attachedOrigins`; 6-step terminal drain; replace S9 unreachable throws at `:103` and `:192`; non-conversation `reprocessTurn` skip; non-conversation surrender handling per Option A) |
| Modify | `packages/dashboard/src/app.ts:~721-724` (replace S9 unreachable throw in surrender event write path) |
| Modify | `packages/dashboard/src/app.ts:~749-752` (replace S9 unreachable throw in `reprocessTurn` path with origin-aware skip) |
| Modify | `packages/dashboard/src/scheduler/jobs/debrief-prep.ts` (read `CFR_RECOVERY.md` when present; parse via `readFrontmatter`) |
| Create | `packages/core/tests/capabilities/mcp-cfr-detector.test.ts` |
| Create | `packages/core/tests/capabilities/registry-find-by-name.test.ts` |
| Create | `packages/core/tests/capabilities/ack-delivery-origin.test.ts` |
| Create | `packages/core/tests/capabilities/orchestrator/mutex-origin-coalescing.test.ts` |
| Create | `packages/dashboard/tests/integration/cfr-conversation-mcp.test.ts` |
| Create | `packages/dashboard/tests/integration/cfr-automation-mcp.test.ts` |
| Create | `packages/dashboard/tests/integration/debrief-prep-cfr-recovery.test.ts` |
| Modify | `docs/ROADMAP.md` (S12 row → Done — **AFTER architect approval**) |

Confirm exact line numbers via grep at sprint-start; they may have drifted.

---

## Implementation

### Task 0 — SessionContext design (do this BEFORE touching code)

The Day-1 spike establishes which SDK events fire. Task 0 establishes how the detector's `originFactory` looks up its origin at hook-fire time.

**Problem:** the SDK gives the hook a `session_id` (from `BaseHookInput`), not a `conversationId`. The originFactory must look up the conversation/turn (or automation/job) that owns the session.

**Design:**

- **Storage:** `Map<sessionId, SessionContext>` — one map on `SessionManager` (brain sessions), one on `AutomationExecutor` (job sessions).
- **Population:** at session-start (when `streamMessage` opens a new SDK session for the brain, or when a job's session is constructed in the executor), record the originating context.
- **Clearing:** at session-end / session-error / job-completion. Avoid leaks.
- **Shape per origin:**
  - Brain → `SessionContext = { kind: "conversation", channel: ChannelContext, conversationId: string, turnNumber: number }`.
  - Automation → `SessionContext = { kind: "automation", automationId: string, jobId: string, runDir: string, notifyMode: "immediate" | "debrief" | "none" }` (default `notifyMode = "debrief"` when manifest absent).
- **Lookup at hook fire:** `originFactory()` closure captures the map + sessionId; returns the looked-up context or throws if missing (a missing context is a programming error, not a runtime path).

**Channel-struct completeness:** when the brain populates `SessionContext.channel`, it MUST populate the full `ChannelContext` shape (`transportId`, `channelId`, `sender`, optionally `replyTo`, `senderName`, `groupId`) — not just `transportId`. The S10 placeholder used empty values; this sprint replaces it with the real values from the conversation's last turn.

**Document the SessionContext type + lifecycle in `s12-DECISIONS.md` before writing the implementation.** This is a load-bearing design decision; one wrong shape means both gates ship incompatible context.

### Task 1 — Day-1 spike (see "Day-1 spike" section above)

Run the spike, file `proposals/s12-spike-results.md`, wait for architect adjudication. Do NOT proceed to Task 2 until the architect has signed off.

### Task 2 — `classifyMcpToolError` + `registry.findByName`

- `packages/core/src/capabilities/failure-symptoms.ts` — add `classifyMcpToolError(error: string): CapabilityFailureSymptom`. Regex map per design §3.1:
  - `/timeout|etimedout/i` → `timeout`
  - `/schema|validation/i` → `validation-failed`
  - `/disabled|not enabled/i` → `not-enabled`
  - default → `execution-error`
- `packages/core/src/capabilities/registry.ts` — add `findByName(name: string): Capability | undefined`. Looks up by `CAPABILITY.md name:` field (the same name parsed from MCP tool names `mcp__<name>__<tool>` via `parseMcpToolName` in `mcp-middleware.ts`).

Tests: `registry-find-by-name.test.ts` (correct plug returned; missing name → undefined; multi-instance type resolves uniquely by name).

### Task 3 — Create `mcp-cfr-detector.ts`

`packages/core/src/capabilities/mcp-cfr-detector.ts` (new):

- `createMcpCapabilityCfrDetector({ cfr, registry, originFactory }): { hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> }` — returns the hooks block to be merged into the SDK options.
- For the spike-confirmed `PostToolUseFailure` hook (and any additional hooks the spike identified):
  - Parse tool name `mcp__<name>__<tool>` via `parseMcpToolName`. If parse fails (non-MCP tool), do nothing — pass through.
  - Look up the plug: `registry.findByName(name)`. If absent, do nothing (the failure isn't from a known capability).
  - Build `TriggeringInput`:
    - `origin: originFactory()` — pulls from SessionContext map per Task 0.
    - `userUtterance: JSON.stringify(tool_input).slice(0, 1000)` — best-effort trace evidence; capped at 1000 chars to keep CFR events small (tool_input may be large for screenshot/image data).
    - `artifact: undefined` — MCP failures don't have a triggering media artifact.
  - Classify: `symptom = classifyMcpToolError(error)`.
  - Emit: `cfr.emitFailure({ capabilityType: cap.provides, capabilityName: cap.name, symptom, detail: error, triggeringInput })`.
- Secondary `PostToolUse` (success-path) check for "success-shaped but empty" — emit `empty-result` only when the response is structurally empty (e.g., zero content blocks where one was expected per the SDK's `ContentBlock` shape). Conservative — when in doubt, do not emit.

### Task 4 — Wire detector into session-manager + automation-executor

- `packages/dashboard/src/agent/session-manager.ts` — confirm location of hook attachment via `rg "hooks:" packages/dashboard/src/agent/session-manager.ts`. Attach `createMcpCapabilityCfrDetector(...)` alongside existing audit/screenshot hooks. The originFactory closes over the SessionContext map this file owns; populated at `streamMessage` start with `{ kind: "conversation", channel, conversationId, turnNumber }` from the originating turn.
- `packages/dashboard/src/automations/automation-executor.ts:~104` (`buildJobHooks`) — append the CFR detector to the hooks list. The originFactory closes over the SessionContext map this file owns; populated when the job session is constructed with `{ kind: "automation", automationId, jobId, runDir, notifyMode }` from the manifest. Default `notifyMode = "debrief"` when manifest absent.
- `packages/dashboard/src/app.ts:~542-546` — **replace the S10 placeholder origin.** The placeholder factory `() => ({kind: "conversation", channel: ..., conversationId: "", turnNumber: 0})` must become a factory that reads from `app.sessionManager`'s SessionContext map. The brain holds a single `app.capabilityInvoker`; its originFactory looks up the *current* SDK session's context. Coordinate the lookup mechanism with the MCP detector — both gates source origin from the same map.

### Task 5 — `ack-delivery.ts` automation/system branches + `CFR_RECOVERY.md` writer

- `packages/core/src/capabilities/ack-delivery.ts:~73` — replace the S9 `unreachable in S9` throw with origin-aware branches:
  - **Conversation:** unchanged from Phase 1 (existing transport-routing logic).
  - **Automation:** write `CFR_RECOVERY.md` synchronously to `origin.runDir` on terminal transition. If `notifyMode === "immediate"`, fire the existing notification layer after the write succeeds. If `notifyMode === "none"`, skip the notification (still write the file).
  - **System:** log to console (component name + symptom + result). Dashboard health-page surfacing is deferred to S19 (Phase 3) — name in `s12-FOLLOW-UPS.md`.

**`CFR_RECOVERY.md` schema (load-bearing — debrief-prep parses this):**

YAML frontmatter + markdown body, per the project's normalized-metadata standard:

```yaml
---
plug_name: <capability.name>            # e.g. browser-chrome
plug_type: <capability.provides>        # e.g. browser-control
detected_at: <ISO8601>                  # CFR detection timestamp
resolved_at: <ISO8601>                  # terminal transition timestamp
attempts: <1|2|3>                       # number of fix attempts run
outcome: fixed | surrendered            # terminal outcome
surrender_reason: <iteration-3 | redesign-needed | insufficient-context | budget>  # only when outcome === "surrendered"
---

# <plug_name> recovery summary

<one paragraph from the final attempt's deliverable.md frontmatter.summary; or, on surrender, a brief explanation of what was tried and why it stopped>

## Attempts

| # | Hypothesis | Change | Result |
|---|---|---|---|
| 1 | <session.attempts[0].hypothesis> | <session.attempts[0].change> | <pass|fail with failureMode> |
| ... |
```

Use `writeFrontmatter()` (not raw YAML) per the project's normalized-markdown-metadata standard. Document the schema in `s12-DECISIONS.md`.

### Task 6 — `recovery-orchestrator.ts` mutex origin coalescing + non-crashing terminal flow

#### 6a — `attachedOrigins` mutex extension

- Add `attachedOrigins: TriggeringOrigin[]` to `FixSession`. Initialized with the originating CFR's origin.
- When a new CFR arrives for a plug with an in-flight FixSession (mutex held):
  1. Append the new origin to `existingSession.attachedOrigins`.
  2. **Skip spawning a new automation** (no second fix job for the same plug).
  3. **Skip emitting a duplicate "hold on" ack** (the originating conversation-origin already got one; new attached origins don't).
  4. The terminal drain processes ALL attached origins, not just the originating one.
- N-aware (not capped at 2): the list grows for every late-arriving CFR until terminal drain.
- Replace the S9 `unreachable in S9` throw at `recovery-orchestrator.ts:~103` with the attached-origins enqueue path above.

#### 6b — Six-step terminal drain (per design §3.4)

On terminal transition (reverify pass or surrender), execute in order. Each step in its own try/catch — failures in one origin don't block subsequent steps.

1. Fix job's `deliverable.md` already persisted; framework's `writePaperTrail` already appended (no work here).
2. Read reverify result. If failed → surrender branch (Step 6c).
3. For every attached **automation** origin: write `CFR_RECOVERY.md` (per Task 5 schema). If `notifyMode === "immediate"`, fire notification.
4. For every attached **conversation** origin: if `recoveredContent` is defined → call `reprocessTurn(failure, recoveredContent)`; else → call `emitAck(failure, "terminal")`.
5. For every attached **system** origin: log (component name + symptom + result).
6. Release per-type mutex.

Steps 3–5 sequential in this order — automations first so the durable record lands before any user-facing ack.

#### 6c — Non-conversation surrender handling (Option A — minimum scope)

`SurrenderScope` (from S9 D1) is conversation-scoped: `{capabilityType, conversationId, turnNumber, expiresAt}`. For automation/system origins, there is no conversationId.

**Option A (recommended, this sprint):** non-conversation origins skip `SurrenderScope` recording entirely. Their surrender info lands in `CFR_RECOVERY.md` (automation, with `outcome: surrendered`) or log (system) instead. Cross-conversation cooldown's purpose is to prevent the user being asked to retry repeatedly; automations don't ask the user.

**Option B (deferred):** widen `SurrenderScope` to a discriminated union. Out of scope for this sprint — name in `s12-FOLLOW-UPS.md` if a future sprint needs cross-origin cooldown.

Replace the S9 `unreachable in S9` throw at `recovery-orchestrator.ts:~192` with the Option A skip-and-write logic.

#### 6d — Non-conversation `reprocessTurn` skip (in `app.ts`)

The existing flow calls `reprocessTurn` on reverify pass. For non-conversation origins, there is no turn to reprocess.

- `packages/dashboard/src/app.ts:~749-752` — replace the S9 `unreachable in S9` throw with an origin-aware early return:
  ```typescript
  if (origin.kind !== "conversation") {
    // Non-conversation origins have no turn to reprocess; orchestrator's
    // terminal drain (Task 6b) handles their delivery via CFR_RECOVERY.md
    // (automation) or log (system). Full RESTORED_TERMINAL state machine
    // wiring is S13; S12 just makes this path non-crashing.
    return;
  }
  ```
- `packages/dashboard/src/app.ts:~721-724` — replace the S9 throw in the surrender event write path. Surrender still writes a record for non-conversation origins, but uses the CFR_RECOVERY.md path (Task 5 + 6c) rather than the conversation's surrender event.

### Task 7 — `debrief-prep.ts` `CFR_RECOVERY.md` reader

- Confirm the file's actual path via `rg "debrief" packages/dashboard/src/`. The architect plan named `packages/dashboard/src/scheduler/jobs/debrief-prep.ts` as a best guess; if the shape differs, file a deviation proposal before editing.
- Extend the debrief flow: when the job's `run_dir` contains `CFR_RECOVERY.md`, parse it via `readFrontmatter()` (per the normalized-metadata standard).
- Include the parsed summary in the debrief prompt. Suggested injection:
  ```
  Capability recovery during this job:
  - Plug: <plug_name> (<plug_type>)
  - Outcome: <outcome>
  - Attempts: <attempts>
  - Summary: <body first paragraph>
  ```
- Without this reader extension, the writer (Task 5) is orphaned. Test in `debrief-prep-cfr-recovery.test.ts`.

### Task 8 — Replace S9 `unreachable in S9` throws (acceptance check)

By the end of Task 7, every S9 throw must be gone. The replacements landed inside Tasks 4, 5, 6, but Task 8 is an explicit acceptance check before claiming sprint-done:

```bash
rg "unreachable in S9" packages/
```

Must return zero hits. Any remaining throw means a non-conversation CFR will crash the orchestrator at runtime.

### Task 9 — Acceptance tests (5–7 test files; spike-driven)

**Test design depends on Task 1's spike result.** If the spike found that some failure modes route through hooks other than `PostToolUseFailure`, add corresponding test files for each new hook before claiming coverage.

Unit:

- `packages/core/tests/capabilities/mcp-cfr-detector.test.ts` — classifier matrix per spike findings (timeout / validation-failed / not-enabled / execution-error / empty-result); `findByName` lookup; `userUtterance` serialization (verify cap at 1000 chars); emit shape correct.
- `packages/core/tests/capabilities/registry-find-by-name.test.ts` — `findByName` returns correct plug; missing name returns undefined; multi-instance types resolve by name uniquely.
- `packages/core/tests/capabilities/ack-delivery-origin.test.ts` — automation branch writes `CFR_RECOVERY.md` to `runDir` with the schema from Task 5; `notifyMode` default = `"debrief"`; `notifyMode: "immediate"` fires notification; `notifyMode: "none"` writes file but skips notification; system branch logs only; conversation branch unchanged from Phase 1.
- `packages/core/tests/capabilities/orchestrator/mutex-origin-coalescing.test.ts` — late CFR for same plug attaches to `attachedOrigins`; **NO second `spawnAutomation` call** (mock-asserted); **NO duplicate "hold on" ack** (mock-asserted); terminal drain fires per-origin callbacks in §3.4 order; per-origin failures don't block siblings (use one origin's callback that throws, assert siblings still fire).

Integration:

- `packages/dashboard/tests/integration/cfr-conversation-mcp.test.ts` — conversation-origin MCP failure (use a deliberately-broken `browser-chrome` invocation) → channel ack fires; `app.capabilityInvoker.originFactory` returns the real conversation context (NOT the S10 placeholder).
- `packages/dashboard/tests/integration/cfr-automation-mcp.test.ts` — automation-origin MCP failure → `CFR_RECOVERY.md` lands in job run dir; debrief carries summary; subsequent automation fire runs clean against the (assumed-still-failing-without-fix-engine) plug — verifies the wiring, not the fix (fix engine is S16).
- `packages/dashboard/tests/integration/debrief-prep-cfr-recovery.test.ts` — `debrief-prep` reads `CFR_RECOVERY.md` and includes it in prompt; absent file → no extra prompt content.

---

## Verification commands

From plan-phase2-coverage.md §2.4:

```bash
# Repo root.
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run tests/capabilities/mcp-cfr-detector tests/capabilities/registry-find-by-name tests/capabilities/ack-delivery-origin tests/capabilities/orchestrator/mutex-origin-coalescing
cd packages/dashboard && npx tsc --noEmit
cd packages/dashboard && npx vitest run tests/integration/cfr-conversation-mcp tests/integration/cfr-automation-mcp tests/integration/debrief-prep-cfr-recovery

# Acceptance check from Task 8.
rg "unreachable in S9" packages/  # must return zero hits

# Phase 1 + Phase 2 regression.
cd packages/core && npx vitest run tests/capabilities tests/conversations  # must still be 185+ passed / 2 skipped baseline
cd packages/dashboard && npx vitest run tests/cfr  # must still be 35+ passed
```

All Phase 1 + Phase 2 (S9, S10, S11) regression tests must still pass.

---

## Deviation triggers

- **Spike outcome diverges** from "all three route through `PostToolUseFailure`" — file `proposals/s12-spike-results.md` first; wait for architect.
- `buildJobHooks` signature differs from session-manager's hook attachment contract — propose alignment.
- `debrief-prep` flow's actual path differs significantly from the educated guess — confirm via `rg "debrief" packages/dashboard/src/` at sprint-start; propose change if shape requires.
- The view-context / SessionContext struct doesn't fit the session-manager's existing shape — propose extension before writing it.
- An MCP plug has a failure mode the spike didn't reproduce — name in `FOLLOW-UPS.md` per the universal-coverage rule (§0.1).
- Any S9 `unreachable in S9` throw needs to be kept (it shouldn't, but if so) — propose; cannot ship sprint with throws remaining.

---

## Universal coverage check (§0.1)

Every MCP-typed plug in `.my_agent/capabilities/` (today: `browser-chrome`, `desktop-x11`) routes through the new detector. Verify in review by listing each MCP plug and confirming the spike + detector covers its failure modes.

System-origin routing's dashboard health-page UI is intentionally minimal in S12 (logs only) — full UI lands in S19 (Phase 3). Name in `s12-FOLLOW-UPS.md` per the rule.

---

## Out of scope (deferred — name each in FOLLOW-UPS with receiving sprint)

- **Ack coalescing for parallel CFRs** (30s window, friendly-name combining) → Phase 3, S19.
- **System-origin dashboard health page UI** → Phase 3, S19.
- **Fix-engine swap to `capability-brainstorming` fix-mode** → Phase 3, S16.
- **`RESTORED_TERMINAL` state machine literal + `TERMINAL_ACK` action** → S13. (S12 makes the path non-crashing for non-conversation; S13 wires the explicit terminal-state branching with the right ack copy.)
- **Cross-origin SurrenderScope (Option B)** → defer; name in FOLLOW-UPS only if Option A proves insufficient.
- **`reverify` semantic for "in-session MCP child stays broken"** → S13 (reverify dispatcher's smoke fixture handles this; S12 just routes the failure event).

---

## Sprint artifacts (dev deliverables)

On completion:

1. `docs/sprints/m9.6-capability-resilience/s12-DECISIONS.md` — judgment calls + rationale. **Required entries:** SessionContext shape + lifecycle (Task 0); CFR_RECOVERY.md schema (Task 5); Option A surrender choice (Task 6c); any spike-driven scope adjustments.
2. `docs/sprints/m9.6-capability-resilience/s12-DEVIATIONS.md` — proposals filed (with link to each), else "No deviations".
3. `docs/sprints/m9.6-capability-resilience/s12-FOLLOW-UPS.md` — out-of-scope items noticed; every deferred plug type named with the receiving sprint (§0.1 rule); the deferred items above explicitly cross-referenced.
4. `docs/sprints/m9.6-capability-resilience/s12-test-report.md` — verification command output (every command from "Verification commands" above; explicit `unreachable in S9` zero-hit check).
5. `docs/sprints/m9.6-capability-resilience/proposals/s12-spike-results.md` — spike findings (mandatory regardless of outcome).
6. `docs/ROADMAP.md` — S12 row → Done. **Landed AFTER architect approval**, per Phase 1 §0.3.
7. Optional: `docs/sprints/m9.6-capability-resilience/s12-review.md` — external auditor read with frontmatter `reviewer: External auditor (dev-contracted)` and `recommended: APPROVE | REJECT | CONDITIONAL`. **NEVER** `verdict: APPROVED`.

Dev does NOT write `s12-architect-review.md`.

---

## Design feature → task coverage check

For audit traceability — every S12 feature in the design + architect plan maps to a task here:

| Design / plan feature | Source | Plan task |
|---|---|---|
| `McpCapabilityCfrDetector` class | v2 §3.1 | Task 3 |
| `PostToolUseFailure` hook (+ secondary `PostToolUse` empty check) | v2 §3.1 | Task 3 (spike-driven) |
| `classifyMcpToolError` regex map | v2 §3.1 | Task 2 |
| `registry.findByName` | v2 §3.1 | Task 2 |
| MCP-server-to-capability lookup via `mcp__<name>__<tool>` parse | v2 §3.1 | Task 3 |
| `triggeringInput` for MCP: `origin` + `userUtterance` (tool args, ≤1000 chars) + `artifact: undefined` | v2 §3.1 | Task 3 |
| Day-1 spike (3 failure modes) + architect adjudication | v2 §6.1 | Task 1 (spike) |
| `TriggeringOrigin` automation variant + `notifyMode` default `"debrief"` | v2 §3.2 | Task 4 |
| Session-manager hook attachment (conversation-origin) | v2 §3.1 | Task 4 |
| Automation-executor `buildJobHooks` attachment (automation-origin) | v2 §3.1 | Task 4 |
| Replace S10 `app.ts:542-546` placeholder origin with real factory | s10 audit C4 | Task 4 |
| SDK `session_id` → origin lookup struct + lifecycle (`SessionContext`) | v2 §3.1 (under-spec) | Task 0 + Task 4 |
| Channel struct fully populated (not just transportId) | s9 + v2 §3.2 | Task 0 + Task 4 |
| `ack-delivery.ts` automation/system branches | v2 §3.4 | Task 5 |
| `CFR_RECOVERY.md` writer (synchronous, on terminal transition) | v2 §3.4 | Task 5 |
| `CFR_RECOVERY.md` schema (frontmatter + body) | v2 §3.4 (under-spec) | Task 5 |
| `notifyMode === "immediate"` → notification after write | v2 §3.4 | Task 5 |
| `notifyMode === "none"` → file written, no notification | v2 §3.2 | Task 5 |
| `recovery-orchestrator.ts` `attachedOrigins` mutex extension | v2 §3.4 | Task 6a |
| 6-step terminal-transition ordering | v2 §3.4 | Task 6b |
| Per-origin try/catch (failure isolation) | v2 §3.4 | Task 6b |
| N-aware mutex coalescing (not capped at 2) | v2 §3.4 | Task 6a |
| Skip-duplicate-ack on attached conversation-origin | v2 §3.4 (implicit) | Task 6a |
| Non-conversation surrender handling (Option A) | v2 (under-spec) | Task 6c |
| Non-conversation `reprocessTurn` skip (non-crashing) | v2 §3.4 (S13 finishes) | Task 6d |
| `debrief-prep.ts` `CFR_RECOVERY.md` reader | v2 §3.4 | Task 7 |
| Replace all 5 S9 `unreachable in S12` throws | s9 architect-review | Task 8 (acceptance) + Tasks 4/5/6 (replacement landings) |
| Universal-coverage check: every MCP plug covered | v2 §0.1 | "Universal coverage check" + Task 9 tests |
| Out-of-scope deferrals named in FOLLOW-UPS | v2 §5.3 + §0.1 | "Out of scope" + sprint artifact 3 |

100% design coverage.

— Plan author: Opus 4.7 (Phase 2 architect, after S12-dev-attempt-1 crashed). Re-run by fresh dev session.
