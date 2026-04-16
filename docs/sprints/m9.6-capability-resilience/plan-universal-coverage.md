# M9.6 Universal Coverage — Follow-up Plan (v2.3, two red-team passes + coverage-verification patch)

**Status:** Draft v2.3 — two red-team passes incorporated; design↔sprint coverage verification passed with six focused sprint-scope patches (G1–G6); CTO-approved; ready to execute S9.25 onward
**Milestone:** M9.6 — extension, not a new milestone
**Origin:** [`HANDOFF-cfr-coverage-gap.md`](HANDOFF-cfr-coverage-gap.md) — CFR shipped STT-only; CTO correction 2026-04-16
**Primary plan:** [`plan.md`](plan.md) — S1–S8 (merged). This doc adds S9+.
**Design spec:** [`../../design/capability-resilience.md`](../../design/capability-resilience.md) — binding context; §Red-Team Resolutions still apply
**Red-team notes:** see §10 — v1 red-team found six material gaps (all resolved); v2.1 red-team found ten more (all resolved in v2.2).

---

## 0. For the implementing agent — READ THIS FIRST

Same rules as the primary plan. The Stop-On-Deviation rule and the Deviation Proposal Protocol carry over verbatim — proposals live in `proposals/`, named `s<N>-<slug>.md`. See `plan.md` §0 for the full text; not duplicated here.

One additional rule specific to this follow-up:

**This plan is a course-correction.** The primary plan shipped with a structural error — detection was wired per-invocation-site for STT only, while every other layer was deliberately generic. Do not replicate that mistake. Detection for script plugs funnels through `CapabilityInvoker`; detection for MCP plugs funnels through a `PostToolUseFailure` hook. New detection code lives in one of those two gates, not at a new call site.

---

## 1. The framing (CTO's words, 2026-04-16)

> "We provide the socket, the agent provides the plug. Nina built a plug, the plug fails, maybe she had a bug, maybe we changed something, maybe she uses a service that broke. I don't care much for the reason, but as long as it's a plug issue, Nina should be able to fix it the same way she was able to build it. With proper ACK and a streamlined UX. If we have issues with our socket side — like saving audio files before parsing so the agent can look for them and parse them after she fixed the capability — it's our role. If not, the agent's role."

Translated to the code:

- **Socket (framework) owns:** detecting any plug failure, persisting enough context that the fix is retriable, engaging Nina on the plug's own folder, verifying the fix, and the user-facing ack/status/surrender UX.
- **Plug (agent's capability) owns:** the actual fix. Nina uses the same skill she used to author the plug, reading the plug's existing folder (`CAPABILITY.md`, `config.yaml`, `scripts/`, `DECISIONS.md`) and making a targeted change. Brainstorming from scratch only engages if the existing design is no longer viable — the wall-hit fallback, not the default path.

---

## 2. Design principles

1. **Detection is socket-level, not plug-level.** Every sanctioned path from user turn → plug execution passes through a framework-owned gate that emits CFR on failure. The plug author never writes detection code.
2. **Invocation style is an implementation detail.** Script plugs (execFile) and MCP plugs (Agent SDK tool-call) have different invocation shapes but the same socket contract.
3. **Fix is symmetric with authoring.** The orchestrator does not run a parallel fix prompt. It invokes `capability-brainstorming` in fix-mode; the skill reads the plug's folder and DECISIONS.md, makes a targeted change in-process (no nested builder job), and the framework appends a DECISIONS.md entry via its existing `writePaperTrail` hook.
4. **Retry semantics are type-aware, not universal.** Some plugs have a retriable input (STT, image-to-text — the user's artifact is persisted, re-run against it). Some don't (TTS, text-to-image, MCP tools — the triggering input was text or a tool call; there's nothing to replay). The orchestrator has two terminal states: `RESTORED_WITH_REPROCESS` (re-run the user's turn with recovered content) and `RESTORED_TERMINAL` (capability is healthy now, no turn to replay — ack accordingly).
5. **User-facing copy uses the plug's friendly name, and for multi-instance types the instance name.** No hardcoded "voice transcription" strings survive any branch. `FRIENDLY_NAMES[failure.capabilityType]` for the type; `failure.capabilityName` appended for multi-instance types.
6. **Frozen surfaces stay frozen, but the list is smaller than v1 claimed.** v1 put `orchestrator-state-machine.ts` in the frozen list; the reflect-phase collapse modifies it. The corrected frozen list is in §6.
7. **Origin-agnostic core, origin-aware routing.** Capabilities fail from three places: a live conversation, a background automation job, or a framework-internal system task. Detection, fix, reverify, and paper trail are identical across origins. Only the user-facing side — ack delivery, terminal routing, reprocess semantics — branches on origin. The plug author never writes origin code.

---

## 3. Coverage bar (exit criterion)

The milestone is done when, for every capability type registered in `.my_agent/capabilities/` at the time of acceptance:

- **If the plug fails from any origin** — live conversation, automation job, or system task — the socket emits CFR automatically (no per-site wiring in the caller).
- **The orchestrator engages `capability-brainstorming` in fix-mode**, which operates on the plug's folder.
- **DECISIONS.md gets both a "why" context entry and a paper-trail append for every fix attempt** — the first from the skill's fix-mode path (authoring-flow parity), the second from the automation framework's `writePaperTrail`.
- **Reverify confirms the fix** — either against the persisted triggering artifact (STT, image-to-text) or against the plug's `scripts/smoke.sh` (every other type, including MCP plugs).
- **The user gets an ack that names the right capability** ("voice reply", "image generation", "desktop control / chrome" for multi-instance) — never the generic raw type name, never the wrong type.
- **An incident-replay test exists** for every type whose plug is installed on the test machine; CI runs contract-fake tests for every type regardless.

Future capability types inherit coverage through the two gates and the smoke-fixture contract, with no new CFR code.

---

## 4. Design

### 4.1 `CapabilityInvoker` — the single gate for script plugs

**Location:** `packages/core/src/capabilities/invoker.ts` (new).

**Purpose:** the only sanctioned way to invoke a plug's shell script. Wraps `registry.get()` + script execution + error classification + `cfr.emitFailure()` in one call.

**Invocation shape normalization:** the invoker runs scripts as `execFile(scriptPath, args, options)` — direct execution, not via a `bash` wrapper. The existing `reverify.ts` audio-to-text reverifier invokes via `execFile("bash", [scriptPath, ...])`; that form is inherited from S1 and is a latent fragility (breaks silently if the script lacks `chmod +x`). S9 adds scan-time executable-bit validation in the registry loader (`test-harness.ts`), ensuring every `scripts/*.sh` is executable before the plug is marked `available`. The invoker then runs the direct form. The `reverify.ts` audio reverifier refactors to use the invoker once the executable-bit validation is in place.

**Interface sketch:**

```typescript
export interface InvokeOptions {
  capabilityType: string;          // e.g. "audio-to-text"
  scriptName: string;              // e.g. "transcribe.sh"
  args: string[];
  triggeringInput: TriggeringInput;
  timeoutMs?: number;              // default 30000
  expectJson?: boolean;            // if true, parse stdout as JSON and validate
}

export type InvokeResult =
  | { kind: "success"; stdout: string; stderr: string; parsed?: unknown }
  | { kind: "failure"; symptom: CapabilityFailureSymptom; detail: string };
```

Behavior:

- Registry returns no plug → emit `not-installed`.
- Plug exists but `cap.enabled === false` → emit `not-enabled`.
- Plug enabled but `cap.status !== "available"` → emit `execution-error`.
- `execFile` rejects with timeout marker (`ETIMEDOUT`, `/timeout/i`) → emit `timeout`.
- `execFile` rejects otherwise → emit `execution-error`.
- `expectJson` and stdout is not valid JSON → emit `validation-failed`.

All emits go through `cfr.emitFailure()` with the passed `triggeringInput`. Caller receives `{kind: "failure"}` and degrades however it was going to degrade (text fallback, null return, etc.) — the CFR has already fired.

**What does NOT go in the invoker:**

- Semantic failures like "STT returned empty text but the script succeeded" — plug-specific judgment calls (`classifyEmptyStt` in `failure-symptoms.ts`) stay at the caller, gated on duration/confidence.
- Attachment-service-missing at `chat-service.ts:592` — socket-internal failure (deps not wired at boot), emits CFR directly without going through the invoker.

**`failure-symptoms.ts` consolidation:** `classifySttError` is redundant for "No audio-to-text capability available" after the refactor — the invoker classifies `not-installed`/`not-enabled`/`execution-error` directly. The function narrows to `classifyEmptyStt` (the semantic-empty boundary) only. Delete `classifySttError` after confirming no other caller uses it (A2 confirmed no other callers).

### 4.2 `McpCapabilityCfrDetector` — the single gate for MCP plugs

**Location:** `packages/core/src/capabilities/mcp-cfr-detector.ts` (new). Wired as a **`PostToolUseFailure`** hook in `session-manager.ts`, attached alongside the existing `PostToolUse` audit + screenshot hooks (which stay on success-path only).

**Why `PostToolUseFailure`, not `PostToolUse`:** the Agent SDK v0.1.x ships both events. `PostToolUseFailure` (`sdk.d.ts:1229-1236`) carries a typed `error: string` field and fires specifically on tool errors (exceptions, timeouts, SDK-detected failures). `PostToolUse` fires on success and carries `tool_response: unknown` — classifying in-band there requires guessing at error shapes. v1 of this plan wired to the wrong hook. v2 wires to `PostToolUseFailure` as primary and keeps a lightweight "success-shaped but empty" check on `PostToolUse` for cases where a tool returned a malformed-but-non-throwing response.

**MCP-server-to-capability lookup:** there is no separate `mcp.server` field in `CAPABILITY.md` frontmatter (verified against `packages/core/src/capabilities/types.ts:54-64` and the `browser-control` template at line 36). The MCP server name *is* the capability's `name:` field — the tool name format is `mcp__<capability.name>__<tool>` (parsed by `parseMcpToolName` in `mcp-middleware.ts:20`). Rename v1's proposed `findByMcpServer` to `findByName(name: string): Capability | undefined` on `CapabilityRegistry` (if absent; confirm before editing).

**triggeringInput for MCP failures:** the SDK hook input carries `session_id` (from `BaseHookInput`), not `conversationId`. The session manager holds a `view context` struct per session (`session-manager.ts` — confirm exact struct name in S10) that records which conversation/turn originated the SDK session. The detector reads that context at failure time. The `channel`, `conversationId`, `turnNumber` fields of `TriggeringInput` are populated from it. `artifact` stays undefined for MCP failures. `userUtterance` is the tool-call arguments serialized (best-effort trace evidence).

**Classifier sketch:**

```typescript
function classifyMcpToolError(error: string): CapabilityFailureSymptom {
  const e = error.toLowerCase();
  if (e.includes("timeout") || e.includes("etimedout")) return "timeout";
  if (e.includes("schema") || e.includes("validation")) return "validation-failed";
  if (e.includes("disabled") || e.includes("not enabled")) return "not-enabled";
  // Exceptions, crashes, protocol errors:
  return "execution-error";
}
```

The `PostToolUse` (success-path) secondary check only emits `empty-result` when the tool returned a response the framework considers structurally empty (explicitly zero content blocks when a content block was expected) — purposely conservative to avoid double-emits.

### 4.3 Fix engine — `capability-brainstorming` in fix-mode

**The swap:** the orchestrator stops rendering `fix-automation.md`. It invokes the existing `capability-brainstorming` skill with a `mode: fix` context, passing failure details via the automation's prompt.

**Changes to `capability-brainstorming/SKILL.md`:** a single gated branch at the top. The gate is **hard-disabling**, not just "skip user questions":

```
## Step 0: Mode check

If the invocation prompt starts with `MODE: FIX`, follow the Fix Mode path ONLY.
Steps 1, 2, 3, 4, 5, and 6 of the authoring flow, and the `.enabled` write step, are
DISABLED in fix mode. Do not run them. Do not `create_automation`. Do not write
user-facing copy. Do not ask clarifying questions — if you do not have enough info,
write `ESCALATE: insufficient-context` atop your deliverable and stop.

### Fix Mode

You have been invoked by the recovery orchestrator because a capability failed during a
user turn. The capability folder already exists at `<capDir>` (passed in the prompt).

1. Read `<capDir>/CAPABILITY.md`, `<capDir>/config.yaml`, `<capDir>/DECISIONS.md`, and
   the relevant files under `<capDir>/scripts/`. Form a hypothesis from the symptom,
   detail, and previous-attempt history in the invocation prompt.
2. Write a one-line "why this change is being made" context entry to
   `<capDir>/DECISIONS.md` (appending, with a timestamp). This mirrors the authoring
   flow's Step 1 context-write and keeps DECISIONS.md narratively complete.
3. Make a targeted change to the plug in-process (config tweak, script patch, env fix,
   dep bump). Do NOT spawn a nested builder automation. Do NOT rewrite the plug from
   scratch. If the existing design cannot be repaired, write `ESCALATE: redesign-needed`
   atop your deliverable and stop.
4. Run `<capDir>/scripts/smoke.sh` (the template contract mandates one — see §4.4).
   Record the result.
5. Write `deliverable.md` in your run directory with frontmatter
   (change_type, test_result, hypothesis_confirmed, summary, surface_required_for_hotreload)
   + body. This is the orchestrator's retry-loop contract.
6. Do NOT append the paper-trail entry to DECISIONS.md yourself — the automation
   framework's `writePaperTrail` does that on job completion, because the orchestrator
   sets `target_path = <capDir>`.
```

**Changes to `recovery-orchestrator.ts`:**

- `renderPrompt(failure, session)` → `buildFixModeInvocation(failure, session)`: prompt begins with `MODE: FIX`, carries capability-folder path, symptom, detail, and a rendered previous-attempts table.
- `AutomationSpec` (in `recovery-orchestrator.ts:30`) gains a `targetPath?: string` field.
- The orchestrator sets `targetPath: cap.path` on the spec when spawning.
- `readDeliverable()` unchanged. The skill still writes `deliverable.md`.
- **Reflect phase: collapsed.** See §4.3.1 for the full blast radius.
- `JOB_TIMEOUT_MS` for fix-mode jobs raised to 15 minutes (from 10). A cold skill run reads folder, diagnoses, patches, runs smoke, writes deliverable — reasonable wall time at Opus pace is 5–12 minutes. The primary plan's measured 142s STT fix was a hot-path; fix-mode's new surface is larger.

**Changes to the dashboard's `spawnAutomation` closure** (`packages/dashboard/src/app.ts:635-653`): the closure constructs the automation manifest from the spec. It currently does not copy `target_path`. Add:

```typescript
manifest: {
  // ...existing fields...
  target_path: spec.targetPath,  // NEW
}
```

This is required — without it, setting `targetPath` on the orchestrator spec is a no-op, the manifest has no `target_path`, and `writePaperTrail` at `automation-executor.ts:594-603` does nothing. The automation framework's auto-`job_type` inference at `automation-executor.ts:162-167` will trigger on a `.my_agent/capabilities/...` target path and set `job_type: capability_modify` — aligns with what the orchestrator also explicitly passes. Confirm no collision in S11.

**`.my_agent` write guard:** the post-M9.2 hook that blocks writes to `.my_agent/` must allow the `job_type === "capability_modify"` worker to write to `.my_agent/capabilities/<name>/`. Confirm the exemption exists (or add it) in S11.

**Escalation signals:** `ESCALATE: redesign-needed` or `ESCALATE: insufficient-context` at the top of `deliverable.md` → orchestrator treats the attempt as failed with a specific `surrenderReason`. Surrender copy for these reasons is distinct from the "I tried three times" generic path; see §4.5.

### 4.3.1 Reflect-phase collapse — own sprint, not a one-liner

v1 presented the reflect collapse as a single-line state-machine change. It is not. The collapse touches:

- `orchestrator-state-machine.ts`:
  - Remove the `REFLECTING` literal from the `OrchestratorState` union.
  - Remove `REFLECT_JOB_DONE` from `OrchestratorEvent`.
  - Remove `SPAWN_REFLECT_JOB` from `Action`.
  - Remove the `REFLECTING → REVERIFYING` transition; `EXECUTING → REVERIFYING` becomes the single post-execute edge on success.
  - Remove the `REFLECTING + totalJobsSpawned >= 5 → SURRENDER` budget guard.
- `recovery-orchestrator.ts`:
  - Delete lines 349–415 (reflect spawn, await, deliverable read, next-hypothesis threading).
  - Delete `renderReflectPrompt` (lines 546–578).
  - `FixSession.reflectJobId` becomes dead — remove from type.
- `cfr-types.ts`:
  - `FixAttempt.phase: "execute" | "reflect"` → `"execute"` only. No migration needed: `CapabilityFailure` and `FixAttempt` are held in-memory only on the orchestrator's in-flight map; nothing is persisted to disk for these records. Clean-break TypeScript change.
- Tests:
  - `orchestrator-state-machine.test.ts:54-58` and `:126-129` break — update expectations.
  - `orchestrator-budget.test.ts:173` — the "5 jobs across execute+reflect" test is now semantically wrong; rewrite or delete.
  - `orchestrator-timing.test.ts` — audit any reflect-related timing assertions.
- Budget math:
  - With reflect gone, maximum jobs per recovery = 3 (one per attempt). The 5-job cap (`MAX_JOBS = 5`) is non-binding. Keep it as a safety ceiling against runaway nested spawns (even though fix-mode forbids nested spawns, defense in depth) but reduce to 4 to reflect reality + 1 margin.

This is its own sprint (S11 in the sprint plan, once written). The state-machine diff lands in one commit; orchestrator behavior changes in a second; test updates in a third. Never ship behavior-first — the state-machine test-matrix must show green before the orchestrator changes.

### 4.4 Reverify dispatcher + smoke fixture contract

**Location:** `packages/core/src/capabilities/reverify.ts`.

**The dispatch table:**

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

**Per-type reverifiers:**

- `reverifyAudioToText`: unchanged semantics. Runs STT script against `rawMediaPath`, expects non-empty `text`. Refactored to use `CapabilityInvoker` after S9's exec-bit validation lands. Returns `{pass, recoveredContent, confidence, durationMs}` (populating confidence/durationMs when script reports them).
- `reverifyTextToAudio`: runs `synthesize.sh` against a deterministic fixture prompt (from template), checks output file exists and has a valid audio header (Ogg magic bytes / WAV RIFF). Does NOT re-speak the user's assistant reply. Returns `{pass, recoveredContent: undefined}`.
- `reverifyImageToText`: runs OCR script against a small stock test image (from template), expects non-empty text output. Returns `{pass, recoveredContent: undefined}` — re-running against the user's original image is deferred; fixture-only for this milestone.
- `reverifyTextToImage`: runs generation against a deterministic prompt fixture, checks output image header. Returns `{pass, recoveredContent: undefined}`.
- `runSmokeFixture` (default): executes `<capDir>/scripts/smoke.sh` if present as a **fresh out-of-session subprocess** — not through any in-flight MCP child or SDK session. Treats exit 0 as pass. Falls back to "capability reports `status: available`" if the script is missing (with a warning logged — this is a template-gap signal, not a normal path).

**Reverify is out-of-session, MCP children are not expected to recover mid-session.** When an automation job's MCP plug fails, the plug's child process (spawned by the SDK at session init) stays broken for the remainder of that job. `runSmokeFixture` probes the fix independently — the fresh subprocess it spawns runs against the patched scripts. The job-side MCP child is abandoned; next invocation of the automation starts a fresh session with a fresh child, which inherits the fix. Assertion consumers (terminal-on-fix, CFR_RECOVERY.md) should not interpret "reverify passed" as "the originally-broken in-session tool is now working."

**Smoke fixture contract — new requirement per template:**

Every capability template (`skills/capability-templates/*.md`) gains a "Smoke fixture" section declaring:

1. A required `scripts/smoke.sh` at the plug folder root. Exit 0 = healthy, any non-zero = broken.
2. The smoke script SHOULD exercise the plug's core tool(s) against a deterministic fixture that doesn't require external resources. If external resources are unavoidable (e.g., network for cloud STT), document the fallback behavior.
3. For MCP plugs: `smoke.sh` spawns the MCP server, invokes the core required tool once, checks the response is well-formed, tears down. (Reference implementation lands in S12 against desktop-control and browser-control.)

**Adding smoke.sh to the six existing templates is a distinct sprint (S9.5).** Without it, the default reverifier has nothing to call. S9.5 ships alongside S9 (invoker) because S9's exec-bit validator needs to know smoke.sh is a well-known script.

**`verificationInputPath` field in `FixAttempt`:** currently `.triggeringInput.artifact?.rawMediaPath ?? ""`. New rule: write the real path used for verification — triggering artifact when the type-specific reverifier consumes it; otherwise `<capDir>/scripts/smoke.sh` (the probe path itself, not any fixture smoke.sh internally references). Never empty string. Readers of this field should treat it as "the path the reverifier probed" rather than "the input I replayed" — the two coincide only for STT-like reverifiers.

**Terminal state awareness:** reverify returns `{pass, recoveredContent}`. When `recoveredContent` is undefined (TTS, image-gen, MCP — no reprocess), the orchestrator transitions to `RESTORED_TERMINAL` (new state, see §4.4.1) instead of `RESTORED_WITH_REPROCESS`.

### 4.4.1 Terminal-on-fix state — new

**Problem:** today's orchestrator calls `reprocessTurn(failure, recoveredContent)` unconditionally on reverify pass (`recovery-orchestrator.ts:~248`). For STT this re-runs the user's turn with the recovered transcription; for TTS/MCP there's no user input to re-run — the assistant reply was already delivered as text.

**Solution:** extend the state machine's DONE-family:

- `RESTORED_WITH_REPROCESS` (existing behavior, rename from `DONE` in context where it applies): reverifier returned `recoveredContent` — call `reprocessTurn`.
- `RESTORED_TERMINAL` (new): reverifier returned `{pass: true, recoveredContent: undefined}` — capability is healthy, but there's nothing to replay. Orchestrator skips `reprocessTurn` entirely and emits a terminal-recovery ack (§4.5).

Both states are terminal for the recovery loop. Neither re-engages the fix loop.

**On the state-machine diff:** `REPROCESS_TURN` action is retained (STT path); a new `TERMINAL_ACK` action fires the §4.5 terminal copy. The collapse from v1's description of "just skip reprocess" is too loose — the orchestrator today emits `chat:restored` events, updates turn state, etc. The terminal path must fire equivalent instrumentation without reprocess.

### 4.5 Universal ack copy + orphan placeholders

**`resilience-messages.ts`:**

- `FRIENDLY_NAMES` extends to cover every registered type: `"desktop-control": "desktop control"`, `"browser-control": "browser"`, plus any others in the registry at acceptance time.
- **Multi-instance ack disambiguation:** for types flagged as multi-instance (the registry's `listByProvides`-required types), ack copy appends the capability's `name`: `"hold on — ${friendlyName}${isMultiInstance ? ` (${capabilityName})` : ""} isn't working right, fixing now."` So a Chrome failure reads "browser (chrome) isn't working right" instead of "browser-control isn't working right".
- `surrender()` uses `friendlyName(failure.capabilityType)` (+ instance-name suffix) uniformly — the hardcoded "voice transcription" in the `iteration-3` branch is removed.
- New surrender reasons and their copy:
  - `"redesign-needed"`: "I tried to fix {friendlyName} but the design needs a bigger rework — I've flagged it, {fallback-action} for now."
  - `"insufficient-context"`: "I couldn't fix {friendlyName} — I didn't have enough to go on. {fallback-action}."
  - Existing `"iteration-3"` and `"budget"` stay, but their copy uses friendlyName everywhere.
- `{fallback-action}` table per type: STT → "could you resend as text"; TTS → "you can read my last reply above"; desktop/browser → "try again in a moment"; etc. Ships with the capability template in a new `fallback_action` frontmatter field.
- **New terminal-recovery ack** for `RESTORED_TERMINAL` (§4.4.1): "{friendlyName} is back — this message went out as text, but it'll be working next time." TTS-specific rephrasings are per-type copy.

**Per-conversation ack-coalescing window** (conversation-origin only; automation and system origins route per §4.7): a single user turn can trigger multiple CFRs (voice input breaks STT → STT recovers → assistant reply breaks TTS). Without coalescing, the user sees "hold on — voice transcription isn't working" and "hold on — voice reply isn't working" in quick succession. New rule in `ack-delivery.ts`:

- Per-conversation, coalesce CFR acks within a 30-second window by combining their friendly names.
- If a second CFR arrives for a different type within the window, send a follow-up: "still fixing — now also ${friendlyName2}."
- If one reaches `RESTORED_TERMINAL` while the other is still fixing, the restoration ack waits until both are in terminal state, then emits: "{friendlyName1} is back; {friendlyName2} still in progress." The logic is bounded by the same state machine the orchestrator already owns.

**Automation-origin and system-origin acks** do not flow through this coalescing layer. Per §4.7: automation origins get a `CFR_RECOVERY.md` in the job's run dir plus whatever their `notifyMode` dictates; system origins log only. Cross-origin coalescing happens at the mutex/orchestrator layer (§4.7's "attach origin to in-flight fix's notify list"), not at the ack-delivery layer.

**`orphan-watchdog.ts`:**

- `VOICE_PLACEHOLDERS` generalized to a dispatch table `FAILURE_PLACEHOLDERS` keyed by capability type.
- **Scanner scope extension:** today the watchdog scans user-turn content for voice placeholders. TTS failure leaves a placeholder in *assistant* turn content (or more accurately, the *absence* of an audioUrl on an assistant turn). S13 extends the scanner to cover assistant turns with known assistant-side placeholder strings (or better: the app records a `failure_type` on the turn at write time). The exact shape depends on where the TTS failure gets recorded — likely a new field on `TranscriptTurn` for the assistant side, not a placeholder string. S13 decides.
- A unit test asserts the `FAILURE_PLACEHOLDERS` table covers every placeholder string any invocation site writes.

### 4.6 Duplicate TTS path collapse — explicit per-path fallback

Current state (per A4 + handoff §2.2 + red-team trace):

1. `chat-service.synthesizeAudio` synthesizes TTS at split-turn and final-done, yields `audioUrl` in `done` events.
2. `message-handler.ts:571-575` captures `detectedLanguage` but **ignores `audioUrl`**.
3. `message-handler.ts:588-602` calls `sendAudioViaTransport(channelId, replyTo, currentText, language)` — text, not audioUrl.
4. `app.ts:879-896` + `app.ts:2217` re-synthesize TTS in the Baileys plugin.

**Resolution:** `chat-service.synthesizeAudio` becomes authoritative. Every code path currently routing through `sendAudioViaTransport` with text gets an explicit fallback contract:

| Path | Today | New behavior |
|---|---|---|
| Split `done` with `splitAudioUrl` | handler sends text via `turn_advanced` | handler sends audio via `sendAudioUrlViaTransport` when `first.isVoiceNote`; text fallback otherwise |
| Final `done` with `audioUrl` | handler sends text, Baileys re-synthesizes | handler uses captured `audioUrl` |
| `done` with empty `audioUrl` (CFR fired or empty assistantContent) | — | explicit text fallback via `sendTextViaTransport`; no silent drop |
| `error` event catch path | handler sends error string, Baileys re-synthesizes | handler sends error text via `sendTextViaTransport`; if voice input, still fall back to text (don't invent audio for error strings) |
| Tool-only assistant turn (empty text) | nothing synthesized | nothing sent; log and skip |

**Contract:** `sendAudioUrlViaTransport(transportId, to, audioUrl)` — new function in `app.ts`, replaces the text-synthesizing `sendAudioViaTransport`. Receives an already-synthesized audio URL, reads bytes from local disk (under `/api/assets/audio/`), hands them to `bp.sendAudio`. `sendTextViaTransport(transportId, to, text)` — new complementary function for fallback. Both return boolean; caller picks based on `audioUrl !== undefined`.

`BaileysPlugin.onSendVoiceReply` synthesis is deleted. Plugin keeps only audio-format postprocessing (compression, format conversion) if any.

**Tests:** one integration test per row of the table above. Voice input + each path + asserting the correct send function fires.

### 4.7 Origin generalization — failures from automations and system tasks

**The problem v1 missed:** every emit site in v1's plan assumed `conversationId` + `turnNumber` + `channel`. Capabilities are also invoked from:

- **Automation jobs** — a working-Nina task like "every morning, open dashboard.com, take a screenshot, attach to debrief." The browser plug is an MCP plug; if it fails mid-job, there's no conversation, no turn to reprocess, no channel to ack on — but the failure is real and the socket must still detect → fix → reverify → route the outcome somewhere the user (or the next debrief) sees it.
- **System tasks** — capability health checks, indexers, maintenance sweeps. Failures here log; they never interrupt a user.

**The fix:** `TriggeringInput.origin` becomes a discriminated union.

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

Existing callers split into two categories:

- **Emitters** (~6 sites): chat-service.ts:594/685/700, orphan-watchdog.ts:422, plus new invoker/MCP-hook sites. Mechanical rewrap into `origin: { kind: "conversation", ... }`.
- **Consumers** (~5 sites): recovery-orchestrator.ts, ack-delivery.ts, reverify.ts, app.ts:749-760, orphan-watchdog.ts's re-processor. Each needs a discriminated-union narrowing — `switch (origin.kind)` or an early-return on non-conversation — to guard field accesses like `origin.conversationId`.

No persisted format break: `CapabilityFailure` and `FixAttempt` are held in-memory only on the orchestrator; nothing reads old records from disk. TypeScript clean-break migration.

**`notifyMode` default**: `AutomationManifest.notify` is optional (`automation-types.ts:32`). The origin-population step in automation-executor defaults undefined to `"debrief"` — the safest choice: surfaces on the next debrief without real-time user spam. Any automation that explicitly opts into `"immediate"` or `"none"` gets that behavior.

**Detection — where origin comes from at emit time:**

- **`CapabilityInvoker`**: constructor-injected. The App holds an invoker per execution context — `app.capabilityInvoker` for conversation-originated invocations; automation workers get their own invoker wired to their job's origin. One interface, many instances. At invocation time the invoker already knows its origin, no caller-side work.
- **`PostToolUseFailure` hook**: reads the SDK session's context. Brain sessions carry `conversationId`; automation sessions carry `automationId`/`jobId`. The session manager (or automation executor) records which on session start; the hook reads it at failure time. Same mechanism §4.2 already needs for conversation failures; we extend the struct to carry automation fields too.

**Routing — origin-aware branches:**

| Origin | Ack during fix | Terminal restore | Paper trail |
|---|---|---|---|
| `conversation` | Channel transport, real-time (§4.5 coalescing applies) | `RESTORED_WITH_REPROCESS` for STT/image-to-text; `RESTORED_TERMINAL` otherwise | Plug's DECISIONS.md (via writePaperTrail) |
| `automation` | None in real-time. `CFR_RECOVERY.md` is written to `origin.runDir` **at terminal transition** (see ordering rule below), not during the fix. Honor `origin.notifyMode`: `immediate` → Nina's notification layer fires when CFR_RECOVERY.md lands; `debrief` → the existing debrief-prep flow reads CFR_RECOVERY.md alongside deliverable.md and includes its summary; `none` → file lands, no notification | Always `RESTORED_TERMINAL`. Automation does not auto-retry — the fix landed too late for this job run; next invocation of the automation gets a healthy plug | Plug's DECISIONS.md (same path), plus `CFR_RECOVERY.md` in the job run dir cross-referencing the plug fix |
| `system` | None. Log + surface on dashboard capability-health page | Always `RESTORED_TERMINAL` | Plug's DECISIONS.md; no job-side artifact |

**Mutex coalescing across origins:** `RecoveryOrchestrator`'s per-capability-type mutex already serializes fix jobs for the same plug. Extension: when a second CFR arrives for a plug already being fixed, attach its origin to the running fix's "notify-on-completion" list instead of starting a new fix. Supports N origins, not just 2.

**Terminal-transition ordering** (explicit, because the plan's §4.3 terminal path has multiple side effects and the mutex is released at the end):

1. Fix job's `deliverable.md` persists to run dir; framework's `writePaperTrail` appends to plug's DECISIONS.md.
2. Orchestrator reads reverify result. If failed → surrender branch (separate ordering, unchanged from v1).
3. On reverify pass, for every attached **automation** origin: write `CFR_RECOVERY.md` synchronously to `origin.runDir`. Content: fix summary, timestamps, plug name, attempt history. If `origin.notifyMode === "immediate"`, fire Nina's notification layer after the write succeeds.
4. For every attached **conversation** origin: if reverifier returned `recoveredContent` → call `reprocessTurn` (STT path); else call `emitAck(terminal)` with the per-§4.5 terminal copy (TTS/MCP path).
5. For every attached **system** origin: log + update dashboard capability-health page.
6. Release the per-type mutex.

Steps 3–5 run sequentially in that order (automations first so the durable record lands before any user-facing ack fires). Failures inside steps 3 or 4 do not block subsequent steps — each origin gets its own try/catch.

**CFR_RECOVERY.md reader:** the existing debrief-prep flow (at `packages/dashboard/src/scheduler/jobs/debrief-prep.ts` — confirm path at S10-time) currently reads `deliverable.md` per job. S10's scope includes extending debrief-prep to also read `CFR_RECOVERY.md` (when present) and include its summary in the debrief prompt. Without the reader extension, the writer is orphaned.

**Orphan watchdog stays conversation-scoped.** The automation-equivalent (a job that ran while its plug was broken, didn't recover, but the job completed without flagging it) is a different concern handled by the existing job-debrief mechanism — out of scope for this milestone. If it becomes a real problem, it gets its own sprint.

**Automation invoker wiring:** the automation-executor creates a brain-like SDK session per job. That creation path gets passed a `TriggeringOrigin` with `kind: "automation"` + the job's IDs + notifyMode. Same session-context mechanism as brain sessions; the executor is the injection point.

---

## 5. Coverage matrix

| Capability type | Invocation style | Detection path (new) | Reverify path | Terminal | Orphan placeholder |
|---|---|---|---|---|---|
| `audio-to-text` (STT) | script | `CapabilityInvoker.run()` (semantic `classifyEmptyStt` at caller) | `reverifyAudioToText` | `RESTORED_WITH_REPROCESS` | existing |
| `text-to-audio` (TTS) | script | `CapabilityInvoker.run()` at single authoritative `synthesizeAudio` | `reverifyTextToAudio` (smoke fixture) | `RESTORED_TERMINAL` | new: assistant-side failure marker (§4.5) |
| `image-to-text` | script (future) | `CapabilityInvoker.run()` automatic | `reverifyImageToText` | `RESTORED_WITH_REPROCESS` if triggering image available; `RESTORED_TERMINAL` otherwise | future |
| `text-to-image` | script (future) | `CapabilityInvoker.run()` automatic | `reverifyTextToImage` | `RESTORED_TERMINAL` | future |
| `desktop-control` | MCP | `PostToolUseFailure` hook + `classifyMcpToolError` | `runSmokeFixture` (template smoke.sh) | `RESTORED_TERMINAL` | depends on how failures are recorded |
| `browser-control` | MCP, multi-instance | same; `findByName` on tool server name | `runSmokeFixture` | `RESTORED_TERMINAL` | same |
| Future custom type | either | whichever gate matches | `runSmokeFixture` default unless template registers | by reverify contract | scanner extends via recorded turn flags |

Rows requiring per-type code: 4 per-type reverifiers, 1 per-type `fallback_action` copy in template, 1 per-type smoke.sh in template. Everything else — detection, orchestration, ack, fix, DECISIONS.md, terminal routing — is type-agnostic.

---

## 6. Frozen surfaces (corrected)

Frozen (no edits in this milestone):

- `cfr-emitter.ts` — the emitter.
- `ack-delivery.ts` transport routing logic (coalescing additions land as a new layer, not a rewrite of the routing core).
- `RecoveryOrchestrator.handle()` cooldown/mutex/budget *infrastructure* — per-type mutex, cooldown map, surrender scope recording. Behavior around those changes, not the infrastructure; origin-attachment (§4.7) adds a notify list on the existing mutex without reshaping it.

**Not frozen** (contrary to v1):

- `cfr-types.ts` — `TriggeringInput` widens with the `origin` discriminated union (§4.7); `FixAttempt.phase` narrows in §4.3.1. Clean-break TypeScript change — no persisted records exist that need migration.
- `orchestrator-state-machine.ts` — modified by reflect collapse (§4.3.1) and terminal-state split (§4.4.1). Own sprint.
- `resilience-messages.ts` — friendly names + multi-instance + terminal copy + new surrender reasons.
- `orphan-watchdog.ts` — scanner extension + placeholder table.
- `failure-symptoms.ts` — `classifySttError` removal; `classifyMcpToolError` addition.

Violations of the frozen list require a deviation proposal.

---

## 7. Migration and compatibility

- **STT continues to work through the refactor.** S1-S7's incident replay stays as an acceptance test at every sprint in this plan.
- **No data migration needed** — `CapabilityFailure` and `FixAttempt` live in-memory on the orchestrator's in-flight map; nothing is persisted to disk for these records. Type changes in `cfr-types.ts` are a clean TypeScript break.
- **`fix-automation.md`** stays in the repo until every incident-replay test for every type is green for one full sprint; deleted in the cleanup sprint.
- **No protocol change.** `capability_ack` (M9.6-S8) remains the transport for framework-emitted user messages.
- **Parallel CFR** (STT + TTS failing in the same turn): handled via the §4.5 ack coalescing + existing per-type mutex (which keeps the fix jobs on parallel tracks, bounded per type). Surrender de-duplication: if both paths surrender, emit a single coalesced surrender message naming both.

---

## 8. Test strategy

**CI-required tests** (fakes, hermetic):

1. **Unit** — `CapabilityInvoker` behavior matrix (5 symptoms).
2. **Unit** — `McpCapabilityCfrDetector` classification against fake `PostToolUseFailure` inputs.
3. **Unit** — `reverify` dispatcher routing; each per-type reverifier with a fake script; `runSmokeFixture` default with + without `smoke.sh`.
4. **Unit** — `resilience-messages`: friendly names for every registered type; multi-instance name inclusion; every surrender reason; terminal copy.
5. **Unit** — `orphan-watchdog` scanner: table-driven placeholder match; assistant-turn scan (if that lands in §4.5).
6. **Integration** — `capability-brainstorming` fix-mode invocation against a stub plug folder under a temp dir. Asserts deliverable shape, DECISIONS.md context-write + paper-trail append, no nested `create_automation` calls.
7. **Integration** — orchestrator fix-mode roundtrip (CFR → skill → deliverable → reverify → terminal OR reprocess).
8. **Integration** — ack coalescing: two CFRs in same conversation inside 30s produce one combined ack.
9. **Integration** — duplicate-TTS collapse: every row of §4.6's fallback table, one test each.

**Milestone exit gate — two definitive smoke tests** (CTO-defined, 2026-04-16):

These are the only tests that prove universal coverage end-to-end. Each exercises one origin kind + one plug invocation style.

### Exit-gate Test 1 — **Automation-origin, MCP plug**: *working Nina takes a website screenshot after we deliberately break the browser capability on the plug side.*

Setup:
1. Install / confirm a `browser-control` plug (MCP) is present and healthy. Run its `scripts/smoke.sh` green.
2. Create a test automation: "open `https://example.com`, take a screenshot, attach to debrief." Set `notifyMode: debrief`.
3. Deliberately break the plug at the plug side — one surgical change to `config.yaml`, `CAPABILITY.md`, or a script under `scripts/`, chosen so the break is plausibly one Nina herself could have caused. Record what was broken; do NOT restore it manually.
4. Fire the automation.

Assertions:
- `PostToolUseFailure` hook fires, CFR emits with `origin.kind === "automation"` and `origin.notifyMode === "debrief"`.
- Orchestrator spawns fix-mode `capability-brainstorming`. No real-time user ack is sent.
- Fix-mode reads the plug folder + DECISIONS.md, produces a targeted fix, runs `scripts/smoke.sh`, writes `deliverable.md`.
- Plug's `DECISIONS.md` gains both a context entry (why-this-change) and a paper-trail append (what-was-done via `writePaperTrail`).
- `CFR_RECOVERY.md` appears in the automation's `job run_dir` with the fix summary + timestamps.
- Reverify runs `scripts/smoke.sh` as a fresh out-of-session subprocess and returns green. The originally-broken MCP child in the job's SDK session is *not* expected to recover mid-session; the test asserts against the fresh smoke probe, not the in-session child.
- Orchestrator transitions to `RESTORED_TERMINAL`.
- Automation completes. Its debrief (per `notifyMode: debrief`) includes the CFR recovery summary.
- A subsequent fire of the same automation runs clean against the fixed plug.

Pass = all assertions; any miss = milestone blocker.

### Exit-gate Test 2 — **Conversation-origin, script plug**: *conversation Nina understands a voice message after we deliberately break the voice capability.*

Setup:
1. Install / confirm `audio-to-text` plug (STT) is present and healthy. Smoke green.
2. Deliberately break the plug at the plug side — e.g., remove the API key from `config.yaml`, corrupt `transcribe.sh`, or break a dependency in `requires.env`. Record what was broken; do NOT restore it.
3. Inject a voice message through **`AppHarness` extended with a mock transport** that records `send` calls. Rationale: the post-M9.8 "headless App" refactor is planned but not shipped; Playwright against a live dashboard would work but violates the "no live outreach during tests" rule if any channel transport (WhatsApp, email) is partially wired. A recording mock transport inside `AppHarness` is deterministic, inside-process, and lets the test assert against the transport's capture log. S16's scope includes the `AppHarness` extension if it isn't already in place. Audio content is something that can be meaningfully responded to, e.g., "What time is it?" so the reprocess step is visible.

Assertions:
- `CapabilityInvoker` fires CFR with `origin.kind === "conversation"`.
- User sees an initial ack on the conversation's channel ("hold on — voice transcription isn't working, fixing now").
- Orchestrator spawns fix-mode `capability-brainstorming`. Fix-mode reads plug folder + DECISIONS.md, patches, runs smoke.
- Plug's `DECISIONS.md` gains context + paper-trail entries (same pattern as Test 1).
- Reverify runs `reverifyAudioToText` against the persisted `rawMediaPath` (the user's original audio), returns `{ pass: true, recoveredContent: <transcription> }`.
- Orchestrator transitions to `RESTORED_WITH_REPROCESS` and calls `reprocessTurn` with the recovered transcription.
- Brain processes the reprocessed turn, produces a coherent reply to the message's content (not just a meta-ack).
- The mock transport's capture log shows: (1) the initial "hold on" ack, (2) the final meaningful reply. The reply is delivered to the conversation's transport (captured by the mock), not silently dropped.

Pass = all assertions; any miss = milestone blocker.

### Supporting exit-gate tests

For every other registered plug type (e.g., `desktop-control`, or `text-to-audio` if added), run an abbreviated incident replay of the same shape as whichever of the two above matches its origin/invocation profile. These verify coverage but are not definitive exit gates — the two tests above are.

Categories 1-9 (CI) must pass at sprint-review-time for the sprint they belong to. The two exit-gate tests are the milestone gate; a dev machine with real plugs installed runs them at milestone-done.

---

## 9. Out of scope

- **Nested-CFR budget (`parentFailureId`)** — stays parked; fix-mode forbids nested builder spawns, so the in-orchestrator case doesn't arise. Can be revisited if a fix-mode automation somehow triggers a second CFR (unlikely by construction).
- **Adding new capability types** beyond those in `.my_agent/capabilities/` at acceptance time.
- **Full redesign flow for `redesign-needed` escalation.** This milestone surrenders the turn gracefully and logs. A later milestone wires a conversational-layer flow that, on user follow-up in a later turn, engages authoring-mode `capability-brainstorming`.
- **Re-running against the user's original image for `image-to-text`.** Milestone uses a fixture for reverify. Real-artifact reverify is deferred.
- **CI audio via secrets** (M9.6-S7 FU3) — unchanged.

---

## 10. Open questions — status

v1 raised eight questions; the red-team resolved four and surfaced more. Current status:

| # | v1 question | Status | Resolution |
|---|---|---|---|
| 1 | `findByMcpServer` field name | **Resolved** | No separate field; use `findByName(name)` keyed on `CAPABILITY.md name:`. Incorporated in §4.2. |
| 2 | MCP tool error hook | **Resolved** | Wire `PostToolUseFailure` with typed `error: string`. Incorporated in §4.2. |
| 3 | `JOB_TIMEOUT_MS` with nested builder | **Resolved** | Fix-mode forbids nested builder spawn; timeout raised to 15min. Incorporated in §4.3. |
| 4 | `spawnAutomation` `targetPath` support | **Resolved** | Two-edit change: `AutomationSpec` + dashboard closure. Incorporated in §4.3. Auto-`job_type` inference confirmed compatible. |
| 5 | Reflect collapse blast radius | **Resolved** | Own sprint (S11); enumerated in §4.3.1. |
| 6 | TTS collapse silent-drop risk | **Resolved** | Per-path fallback table in §4.6. |
| 7 | Opus budget | **Accepted** | Per-attempt cost roughly equals today (1 Opus vs. Sonnet+Opus); wall time doubles. Non-issue at M9.6 volume. |
| 8 | Fix-mode bypass of authoring discipline | **Resolved** | Hard-disable Steps 1-6 + `.enabled` write; retain DECISIONS.md context-write for narrative parity. `.my_agent/` guard exemption on `capability_modify` job_type. Incorporated in §4.3. |

**Items 9-12 resolved via CTO approval (2026-04-16):**

- **9 — Smoke fixture contract:** approved; S9.5 adds `scripts/smoke.sh` to the five existing templates.
- **10 — Multi-instance name leakage:** approved with guardrail; capability-brainstorming skill gains a "neutral identifier" naming convention.
- **11 — Parallel CFR UX:** ship N-aware coalescing, don't cap at 2.
- **12 — Assistant-side orphan scanning:** structured `TranscriptTurn.failure_type` field (not placeholder string). S13.

**v2.1 red-team (second pass) — all resolved in v2.2:**

| # | Finding | Resolution |
|---|---|---|
| A1 | Automation-executor hosts in-process SDK sessions | **Confirmed sound.** §4.7's injection-point premise holds; `automation-executor.ts:418,426` are real. |
| A2 | MCP child doesn't recover mid-session | §4.4 + §8 Test 1 now explicit: `runSmokeFixture` is out-of-session; in-session MCP child is abandoned; next invocation gets fresh session. |
| A3 | `CFR_RECOVERY.md` writer/reader vapor | §4.7 now specifies writer location (terminal transition), ordering, reader (debrief-prep extension in S10). |
| A4 | `notifyMode` default undefined | Default = `"debrief"` per §4.7. |
| A5 | Mutex terminal-drain race | §4.7 now has explicit 6-step ordering rule: persist → reverify → automations → conversations → system → release. |
| A6 | Deserialization coercion dead code | Dropped. Nothing persisted; clean TypeScript break. §4.3.1, §4.7, §6, §7 updated. |
| A7 | S10.5 touches consumers, not just emitters | Scope in §4.7 + §11 names ~5 consumer narrowings. |
| A8 | S10 → S10.5 ordering backwards | Merged into single S10 with automation-origin wiring from day one. S9.25 type-landing split out. |
| A9 | Test 2 execution vehicle vapor | Committed: `AppHarness` + recording mock transport. S16 scope. |
| A10 | `verificationInputPath` for smoke unclear | §4.4 spec: `<capDir>/scripts/smoke.sh` (probe path). |

**No open CTO decisions remaining.**

---

## 11. Deliverables of this plan (after approval)

Proposed sprint shape (for step 4, post-approval):

- **S9 — `CapabilityInvoker` + exec-bit validation.** New class, migrate STT + TTS callsites. Exec-bit validator in `test-harness.ts`. Unit tests. Fold STT's `classifySttError` removal in once STT callsite is clean. Invoker is constructor-injected with a `TriggeringOrigin` factory so per-execution-context instances can populate origin automatically.
- **S9.25 — `TriggeringOrigin` type landing (zero-behavior).** Land the discriminated union in `cfr-types.ts`. Add a `conversationOrigin(channel, convId, turn)` helper. Backfill all existing emit sites (chat-service.ts:594/685/700, orphan-watchdog.ts:422) and all consumer narrowings (recovery-orchestrator, ack-delivery, reverify, app.ts:749-760, orphan-watchdog re-processor). No new origin kinds wired yet; same behavior as today. Landing this separately lets S10 and S10.5 consume the type without a rewrite pass.
- **S9.5 — Template smoke fixtures.** Add `scripts/smoke.sh` contract to the **five** existing templates (`audio-to-text`, `text-to-audio`, `text-to-image`, `browser-control`, `desktop-control`; `_bundles.md` is an index). Ship reference `smoke.sh` for each. Add `fallback_action` frontmatter field.
- **S10 — `PostToolUseFailure` CFR hook + automation-origin wiring.** New detector class. Registry `findByName`. Session-context plumbing covers both brain sessions (conversation-origin) and automation-executor sessions (automation-origin) from day one — no two-pass rewrite. Automation-executor's `buildJobHooks` (at `automation-executor.ts:426`) appends the CFR detector. Origin populated via factory from S9.25. Ack-delivery gains automation + system branches: `CFR_RECOVERY.md` writer landing at terminal transition per §4.7's ordering rule; `notifyMode` default = `"debrief"`. Orchestrator mutex extension — attach-origin-to-in-flight-fix notify list with explicit terminal draining (§4.7). Debrief-prep reader extension so `CFR_RECOVERY.md` isn't orphaned. Unit + two integration tests (conversation-origin MCP failure; automation-origin MCP failure with `CFR_RECOVERY.md` assertion).
- **S11 — Reflect-phase collapse.** State machine diff → orchestrator behavior → test updates. Two-commit sequence (no phase-coercion commit — nothing persisted).
- **S12 — Reverify dispatcher + terminal-on-fix.** Per-type reverifiers. `runSmokeFixture` default (fresh out-of-session subprocess). `RESTORED_TERMINAL` state. Terminal routing origin-aware: conversation → terminal ack; automation → `CFR_RECOVERY.md` final update (coordinated with §4.7 ordering rule landed in S10); system → log.
- **S13 — Ack coalescing + orphan-watchdog extension.** Friendly-name overhaul. Multi-instance copy. Conversation-origin coalescing layer (automation/system origins bypass — see §4.5). Assistant-turn orphan via structured `TranscriptTurn.failure_type` field.
- **S14 — Fix-engine swap.** `capability-brainstorming` fix-mode gate. `targetPath` plumbing (AutomationSpec + dashboard closure at `app.ts:635-653`). `.my_agent/` guard exemption for `job_type === "capability_modify"`. `JOB_TIMEOUT_MS` raised to 15 minutes for fix-mode. Integration test.
- **S15 — Duplicate TTS collapse.** `sendAudioUrlViaTransport` / `sendTextViaTransport` split. Per-path fallback table verification.
- **S16 — Milestone exit gate.** Extend `AppHarness` with a recording mock transport (if not already present). Run the two CTO-defined definitive smoke tests (§8 Exit-gate Test 1 automation-origin browser; Test 2 conversation-origin voice). Abbreviated incident replay for every other registered plug type. Milestone done.

Sprint order dependencies:
- **S9.25 before S9** (type landing — invoker's constructor-injected origin factory needs `TriggeringOrigin` to exist).
- S9 before S12 (invoker → reverifier).
- S9.25 before S10 (type landing before the hook consumes it).
- S9.5 before S12 (smoke.sh contract before `runSmokeFixture` references it).
- S10 before S12 (automation-origin wiring → terminal routing needs it).
- S11 before S14 (clean state machine before fix-engine swap).
- Everything before S16.

Execution order: **S9.25 → S9 → S9.5 → S10 → S11 → S12 → S13 → S14 → S15 → S16.**

Net: **9 sprints** (S9, S9.25, S9.5, S10, S11, S12, S13, S14, S15) plus S16 exit gate = 10.

---

## 12. Detailed sprint plans

Each sprint follows the primary plan's discipline: Goal, Files-to-edit with concrete pointers, Acceptance tests, Verification commands, Deviation triggers. Design prose is in §4 — not repeated here. The Stop-On-Deviation rule in primary `plan.md` §0.1 applies in full; proposals land in `proposals/s<N>-<slug>.md`.

### 12.1 Sprint 9 — CapabilityInvoker + exec-bit validation

**Goal:** single gate for script-plug invocation; every script-plug invocation emits CFR automatically. Design: §4.1.

**Files:**
- `packages/core/src/capabilities/invoker.ts` *(new)* — `CapabilityInvoker.run(opts)` per §4.1 sketch.
- `packages/core/src/capabilities/test-harness.ts` — exec-bit validation during scan: any `scripts/*.sh` without exec bit marks the plug `invalid`.
- `packages/dashboard/src/chat/chat-service.ts:~1028-1085` — refactor `transcribeAudio` and `synthesizeAudio` through `app.capabilityInvoker.run()`.
- `packages/core/src/capabilities/reverify.ts:~105-186` — `reverifyAudioToText` uses the invoker; `bash` prefix dropped after exec-bit validation is in place.
- `packages/dashboard/src/app.ts` — wire `app.capabilityInvoker = new CapabilityInvoker(...)` in the boot path, alongside existing capability service wiring.
- `packages/core/src/capabilities/failure-symptoms.ts` — remove `classifySttError` (no-capability branches subsumed by invoker); keep `classifyEmptyStt`.

**Acceptance tests:**
- `packages/core/tests/capabilities/invoker.test.ts` — 5-symptom matrix (not-installed / not-enabled / execution-error / timeout / validation-failed).
- `packages/core/tests/capabilities/exec-bit-validator.test.ts` — executable scripts pass; non-executable plugs marked `invalid`.
- All primary-plan S1-S8 STT tests still pass (regression gate).

**Verification:**
```bash
cd packages/core && npx tsc --noEmit && npx vitest run tests/capabilities/invoker tests/capabilities/exec-bit-validator
cd packages/dashboard && npx tsc --noEmit && npx vitest run tests/cfr
```

**Deviation triggers:** reverify.ts refactor changes its return shape; removing `classifySttError` breaks a caller outside chat-service.ts.

### 12.2 Sprint 9.25 — TriggeringOrigin type landing

**Goal:** land the `TriggeringOrigin` discriminated union with zero behavior change. Prerequisite for S10. Design: §4.7.

**Files:**
- `packages/core/src/capabilities/cfr-types.ts` — widen `TriggeringInput` with `origin: TriggeringOrigin`. `FixAttempt.phase` stays as-is (S11 narrows).
- `packages/core/src/capabilities/cfr-helpers.ts` *(new)* — `conversationOrigin(channel, conversationId, turnNumber): TriggeringOrigin` factory.
- Emit-site rewraps: `chat-service.ts:594`, `chat-service.ts:685`, `chat-service.ts:700`, `orphan-watchdog.ts:422`.
- Consumer-site narrowings (discriminated-union guards on field access): `recovery-orchestrator.ts` (every `failure.triggeringInput.conversationId`/`.channel`/`.turnNumber` read), `ack-delivery.ts` (routing — still only handles conversation kind, other kinds throw with `"unreachable in S9.25"` to be filled in S10), `reverify.ts`, `app.ts:749-760`, `orphan-watchdog.ts` re-processor.

**Acceptance tests:**
- `packages/core/tests/capabilities/cfr-types-origin.test.ts` — union narrowing works; helper produces correct shape.
- Full CFR test suite passes unchanged (no behavior change).

**Verification:**
```bash
cd packages/core && npx tsc --noEmit  # strict mode; exhaustiveness enforced at call sites
cd packages/dashboard && npx tsc --noEmit
cd packages/core && npx vitest run
cd packages/dashboard && npx vitest run
```

**Deviation triggers:** any consumer reads a field not on all variants without a guard (TypeScript catches); union widening breaks a test fixture whose mock shape diverges.

### 12.3 Sprint 9.5 — Template smoke fixtures

**Goal:** every capability template declares a `scripts/smoke.sh` contract + `fallback_action` frontmatter field. Prerequisite for S12's `runSmokeFixture`. Design: §4.4.

**Files:**
- `skills/capability-templates/audio-to-text.md` — add "Smoke fixture" section specifying `scripts/smoke.sh`; reference implementation runs transcribe on a 2s sine-wave fixture or templated test audio; exit 0 = healthy.
- `skills/capability-templates/text-to-audio.md` — smoke.sh synthesizes a fixed test phrase + validates output file headers.
- `skills/capability-templates/text-to-image.md` — smoke.sh generates against a fixed prompt + validates image file headers.
- `skills/capability-templates/browser-control.md` — smoke.sh spawns the MCP server, invokes `browser_navigate about:blank`, tears down.
- `skills/capability-templates/desktop-control.md` — smoke.sh invokes `desktop_screenshot` against a headless buffer or confirms X11 availability.
- `skills/capability-templates/_bundles.md` — update bundle references to mention smoke.sh.
- Each template adds frontmatter fields: `fallback_action: "could you resend as text"` (or per-type copy) **and** `multi_instance: boolean` (defaults false; set to true only on `browser-control`).

**Acceptance:**
- Manual review: each template has a "Smoke fixture" section with a concrete reference `smoke.sh` body.
- Every existing plug folder in `.my_agent/capabilities/` that uses these templates gets a follow-up ticket to backfill `smoke.sh` (tracked separately — not sprint-blocking; the default reverifier logs a warning when missing).

**Verification:**
- Read-through: `ls /home/nina/my_agent/skills/capability-templates/*.md` then confirm each contains "smoke.sh" and "fallback_action".
- No code changes; no tsc/vitest requirement.

**Deviation triggers:** a template's plug fundamentally cannot run a self-contained smoke (e.g., requires paid API with no free smoke-path) — flag per template.

### 12.4 Sprint 10 — PostToolUseFailure CFR hook + automation-origin wiring

**Goal:** universal MCP-plug detection; automation-origin routing works end-to-end. Design: §4.2, §4.7.

**Files:**
- `packages/core/src/capabilities/mcp-cfr-detector.ts` *(new)* — `createMcpCapabilityCfrDetector({cfr, registry, originFactory})` returning a `HookCallback` for `PostToolUseFailure`; secondary empty-content check for `PostToolUse` per §4.2. Calls `classifyMcpToolError`.
- `packages/core/src/capabilities/failure-symptoms.ts` — add `classifyMcpToolError(error: string): CapabilityFailureSymptom` per §4.2 regex map (timeout / validation-failed / not-enabled / execution-error). Lives alongside `classifyEmptyStt`.
- `packages/core/src/capabilities/registry.ts` — add `findByName(name: string): Capability | undefined`.
- `packages/core/src/capabilities/session-manager.ts:~431-456` — attach detector alongside existing audit/screenshot hooks; origin factory reads brain-session view-context (conversation-origin).
- `packages/dashboard/src/automations/automation-executor.ts:~426` (`buildJobHooks`) — attach detector; origin factory reads automation manifest → `kind: "automation"` with `notifyMode` default `"debrief"` per §4.7.
- `packages/core/src/capabilities/ack-delivery.ts` — branches for `automation` and `system` origins; writes `CFR_RECOVERY.md` on terminal transition per §4.7's 6-step ordering rule. Conversation-origin path unchanged.
- `packages/core/src/capabilities/recovery-orchestrator.ts` — mutex extension: `FixSession.attachedOrigins: TriggeringOrigin[]` accumulates late-arriving CFRs for the same plug; terminal draining in the order specified by §4.7.
- `packages/dashboard/src/scheduler/jobs/debrief-prep.ts` *(confirm path at sprint-time)* — read `CFR_RECOVERY.md` from job run_dir when present; include its summary in the debrief prompt.

**Acceptance tests:**
- `packages/core/tests/capabilities/mcp-cfr-detector.test.ts` — classifier matrix (timeout / validation-failed / not-enabled / execution-error / empty-result); `findByName` lookup.
- `packages/core/tests/capabilities/ack-delivery-origin.test.ts` — automation branch writes CFR_RECOVERY.md; notifyMode default = "debrief"; system branch logs only.
- `packages/core/tests/capabilities/orchestrator/mutex-origin-coalescing.test.ts` — late CFR attaches to in-flight fix; terminal drain fires per-origin callbacks in §4.7 order.
- `packages/dashboard/tests/integration/cfr-conversation-mcp.test.ts` — conversation-origin MCP failure, channel ack fires.
- `packages/dashboard/tests/integration/cfr-automation-mcp.test.ts` — automation-origin MCP failure, `CFR_RECOVERY.md` lands in job run dir, debrief carries summary.

**Verification:**
```bash
cd packages/core && npx tsc --noEmit && npx vitest run tests/capabilities/mcp-cfr-detector tests/capabilities/ack-delivery-origin tests/capabilities/orchestrator/mutex-origin-coalescing
cd packages/dashboard && npx tsc --noEmit && npx vitest run tests/integration/cfr-conversation-mcp tests/integration/cfr-automation-mcp
```

**Deviation triggers:** `buildJobHooks` signature differs from session-manager's hook attachment contract; debrief-prep's actual path differs from the educated guess; MCP child failures don't route to `PostToolUseFailure` in practice (sanity-test first with a deliberately-broken MCP server).

### 12.5 Sprint 11 — Reflect-phase collapse

**Goal:** eliminate REFLECTING state; one job per attempt. Design: §4.3.1.

**Files (two commits):**

*Commit 1 — state + types:*
- `packages/core/src/capabilities/orchestrator-state-machine.ts` — remove `REFLECTING` literal from `OrchestratorState`; remove `REFLECT_JOB_DONE` from `OrchestratorEvent`; remove `SPAWN_REFLECT_JOB` from `Action`; collapse `EXECUTING → REFLECTING → REVERIFYING` to `EXECUTING → REVERIFYING` on success; remove the REFLECTING budget guard.
- `packages/core/src/capabilities/cfr-types.ts` — `FixAttempt.phase: "execute"` only (narrow from union).
- `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts:54-58,126-129` — update edge expectations.
- `packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts:~173` — rewrite: 3 attempts × 1 job = 3 max.

*Commit 2 — orchestrator behavior:*
- `packages/core/src/capabilities/recovery-orchestrator.ts` — delete lines ~349-415 (reflect spawn/await/deliverable read/next-hypothesis); delete `renderReflectPrompt` (~546-578); remove `session.reflectJobId`. Budget `MAX_JOBS` (`orchestrator-state-machine.ts:57`) → 4 (safety ceiling, previously 5).

**Acceptance tests:** updated state-machine + budget tests pass; no orphaned references to reflect in the codebase (`rg 'reflect' packages/core/src/capabilities/` returns zero production hits).

**Verification:**
```bash
cd packages/core && npx tsc --noEmit && npx vitest run tests/capabilities/orchestrator
```

**Deviation triggers:** budget cap removal surfaces a test relying on 5-job headroom; `FixAttempt.phase` narrowing breaks a test fixture that can't be mechanically migrated.

### 12.6 Sprint 12 — Reverify dispatcher + terminal-on-fix

**Goal:** per-type reverifiers + smoke-fixture default + `RESTORED_TERMINAL` state for plugs without retriable input. Design: §4.4, §4.4.1.

**Files:**
- `packages/core/src/capabilities/reverify.ts` — `REVERIFIERS` dispatch table; `dispatchReverify(failure, registry, watcher)` top-level; add `reverifyTextToAudio`, `reverifyImageToText`, `reverifyTextToImage`; `runSmokeFixture(failure, registry)` default spawning `<capDir>/scripts/smoke.sh` as a **fresh out-of-session subprocess**; `verificationInputPath` always populated (probe path for smoke).
- `packages/core/src/capabilities/orchestrator-state-machine.ts` — add `RESTORED_TERMINAL` state; `RESTORED_WITH_REPROCESS` as alias or rename from current `DONE-with-reprocess`; `TERMINAL_ACK` action; transitions per §4.4.1.
- `packages/core/src/capabilities/recovery-orchestrator.ts` — after `doReverify` returns pass: branch on `recoveredContent` (defined → reprocess; undefined → terminal). Origin-aware terminal routing per §4.7's terminal-drain ordering: for conversation-origin, emit terminal ack; for automation-origin, finalize `CFR_RECOVERY.md`; for system-origin, log.

**Acceptance tests:**
- `packages/core/tests/capabilities/reverify-dispatch.test.ts` — route correctly per type; smoke-fixture default for MCP + unknown types.
- `packages/core/tests/capabilities/reverify-tts.test.ts` — smoke.sh path runs + checks output audio header.
- `packages/core/tests/capabilities/orchestrator/terminal-routing.test.ts` — conversation → reprocess; automation → CFR_RECOVERY.md finalization; system → log only.

**Verification:**
```bash
cd packages/core && npx tsc --noEmit && npx vitest run tests/capabilities/reverify-dispatch tests/capabilities/reverify-tts tests/capabilities/orchestrator/terminal-routing
```

**Deviation triggers:** a registered plug type has a smoke.sh with a non-standard shape (S9.5 failed to normalize).

### 12.7 Sprint 13 — Ack coalescing + orphan-watchdog extension

**Goal:** friendly-name overhaul + multi-instance disambiguation + conversation-origin ack coalescing + assistant-turn orphan detection. Design: §4.5.

**Files:**
- `packages/core/src/capabilities/resilience-messages.ts` — extend `FRIENDLY_NAMES` for every registered type; multi-instance `capabilityName` injection; terminal copy; new surrender reasons (`redesign-needed`, `insufficient-context`); per-type `fallback_action` sourced from capability frontmatter.
- `packages/core/src/capabilities/registry.ts` — add `isMultiInstance(type: string): boolean` helper. Source of truth: the capability template's `multi_instance: true` frontmatter flag (new field in S9.5 templates; defaults false for existing types). `resilience-messages` uses this to decide whether to append `capabilityName` to the ack copy.
- `skills/capability-templates/browser-control.md` — set `multi_instance: true` in frontmatter. All other templates default false. (S9.5 lands the field shape; S13 sets values.)
- `packages/core/src/capabilities/ack-delivery.ts` — per-conversation coalescing layer: 30s window, N-aware merge; automation/system origins bypass.
- `packages/core/src/conversations/orphan-watchdog.ts` — `FAILURE_PLACEHOLDERS` table; assistant-turn scan using `TranscriptTurn.failure_type`.
- `packages/core/src/conversations/types.ts` — `TranscriptTurn.failure_type?: string` structured field.
- `packages/dashboard/src/ws/protocol.ts` — extend turn message shape to carry `failure_type` through the wire (if not already transparent via existing pass-through).
- `packages/dashboard/src/conversations/search.ts` (or whichever file indexes turns — confirm at sprint-time via `rg 'indexTurn|TranscriptTurn' packages/dashboard/src/conversations/`) — ensure indexing skips `failure_type` or handles it gracefully; no crash on a new field.
- `packages/dashboard/public/js/app.js` + rendering — turns with `failure_type` render with a subtle inline marker ("voice reply unavailable — fixing…") rather than a blank assistant bubble; exact copy per §4.5 terminal table.

**Acceptance tests:**
- `packages/core/tests/capabilities/resilience-messages-coverage.test.ts` — every registered type has friendly name + `fallback_action`.
- `packages/core/tests/capabilities/ack-coalescing.test.ts` — 2 CFRs in 30s merged; 3+ CFRs N-way; terminal-during-fix; cross-origin bypass.
- `packages/core/tests/conversations/orphan-watchdog-assistant.test.ts` — assistant turn with `failure_type: "text-to-audio"` detected + scheduled.

**Verification:**
```bash
cd packages/core && npx tsc --noEmit && npx vitest run tests/capabilities/resilience-messages-coverage tests/capabilities/ack-coalescing tests/conversations/orphan-watchdog-assistant
cd packages/dashboard && npx tsc --noEmit && npx vitest run
```

**Deviation triggers:** `TranscriptTurn.failure_type` breaks WS protocol or search indexing (catch during sprint; propose shape change if needed).

### 12.8 Sprint 14 — Fix-engine swap

**Goal:** orchestrator fix engine = `capability-brainstorming` in fix-mode; DECISIONS.md paper trail via `writePaperTrail`. Design: §4.3.

**Files:**
- `packages/core/skills/capability-brainstorming/SKILL.md` —
  1. Step 0 fix-mode gate per §4.3; hard-disable Steps 1-6 + `.enabled` write; forbid nested `create_automation`; retain DECISIONS.md "why" context write.
  2. **Authoring-side neutral-identifier convention** (per §10 item 10 resolution): add a one-line rule in Step 5's "spawn builder" section — "capability `name:` must be a neutral identifier (provider/variant/model), never user-identifiable content (no real names, phone numbers, emails). The name surfaces in user-facing ack copy for multi-instance types."
- `packages/core/src/capabilities/recovery-orchestrator.ts` —
  1. Replace `renderPrompt` with `buildFixModeInvocation`; add `targetPath` to `AutomationSpec`; set `targetPath: cap.path` on spec; raise `JOB_TIMEOUT_MS` to 15 min for fix-mode jobs.
  2. **ESCALATE-marker parsing** per §4.3: on deliverable read, check if `deliverable.md` body starts with `ESCALATE: redesign-needed` or `ESCALATE: insufficient-context`. If so, set `session.surrenderReason = "redesign-needed"` (or `"insufficient-context"`) and transition directly to `SURRENDER` — skip reverify for that attempt, skip further attempts for this session. Surrender copy dispatched via §4.5's new reason branches (landed in S13; reference only here).
- `packages/dashboard/src/app.ts:635-653` — spawnAutomation closure copies `spec.targetPath` into `manifest.target_path`.
- `packages/core/src/capabilities/prompts/fix-automation.md` — add deprecation notice atop the file; do not delete (removed in a cleanup sprint after S16 green for one sprint).
- `.my_agent/` write-guard hook (location TBD at sprint-time; check `.claude/settings.json` and `scripts/pre-commit-check.sh`) — exempt `job_type === "capability_modify"` from the write-block, scoped to `.my_agent/capabilities/<name>/`.

**Acceptance tests:**
- `packages/core/tests/capabilities/fix-mode-invocation.test.ts` — orchestrator spawns capability-brainstorming with `MODE: FIX` prompt; spec carries `targetPath`.
- `packages/core/tests/capabilities/fix-mode-integration.test.ts` — stub plug folder → fix-mode reads folder + DECISIONS.md + patches + `writePaperTrail` appends; no nested `create_automation` call (assert via mock); `deliverable.md` written to run_dir.
- `packages/core/tests/capabilities/fix-mode-escalate.test.ts` — orchestrator reads `ESCALATE: redesign-needed` marker in deliverable body → `session.surrenderReason === "redesign-needed"`, reverify skipped, state transitions to SURRENDER. Same for `ESCALATE: insufficient-context`.
- `packages/core/tests/skills/capability-brainstorming-gate.test.ts` — authoring-mode prompt still runs full Steps 1-6; fix-mode prompt runs fix-only.

**Verification:**
```bash
cd packages/core && npx tsc --noEmit && npx vitest run tests/capabilities/fix-mode-invocation tests/capabilities/fix-mode-integration tests/skills/capability-brainstorming-gate
cd packages/dashboard && npx tsc --noEmit
```

**Deviation triggers:** `targetPath` plumbing requires touching more than the two named files; `.my_agent/` write-guard can't be exempted cleanly; capability-brainstorming's Step 0 gate interferes with authoring-mode invocation.

### 12.9 Sprint 15 — Duplicate TTS path collapse

**Goal:** `chat-service.synthesizeAudio` authoritative; per-path fallback table covers every TTS code path. Design: §4.6.

**Files:**
- `packages/dashboard/src/channels/message-handler.ts:~571-602` — capture `audioUrl` from `done` events (both split and final); decide audio vs text per §4.6 table; explicit fallback for every error/empty path.
- `packages/dashboard/src/app.ts:~879-896,~2217+` — replace `sendAudioViaTransport(text)` with `sendAudioUrlViaTransport(audioUrl)` + `sendTextViaTransport(text)`; delete `onSendVoiceReply` synthesis.
- `plugins/channel-whatsapp/` (or wherever the Baileys plugin lives in-tree) — remove `onSendVoiceReply` synthesis; keep any audio-format postprocessing.

**Acceptance tests:**
- `packages/dashboard/tests/integration/tts-paths.test.ts` — one test per row of §4.6 fallback table (split-done with audioUrl, final-done with audioUrl, done with empty audioUrl, error-catch path, tool-only empty turn).
- `packages/dashboard/tests/integration/voice-reply-regression.test.ts` — healthy path: voice input → assistant reply → voice output, no regressions.

**Verification:**
```bash
cd packages/dashboard && npx tsc --noEmit && npx vitest run tests/integration/tts-paths tests/integration/voice-reply-regression
```

Manual: confirm live WhatsApp voice message replies with voice on the healthy path (pre-/post-change).

**Deviation triggers:** Baileys plugin can't drop synthesis without breaking audio-format compatibility; audioUrl not reliably produced by `done` event in all streaming paths.

### 12.10 Sprint 16 — Milestone exit gate

**Goal:** run the two CTO-defined definitive smoke tests end-to-end on the dev machine with real plugs installed. Design: §8.

**Files:**
- `packages/dashboard/tests/integration/app-harness.ts` — extend with a recording mock transport (if not already present): a `MockTransport` that implements the transport interface and records every `send` call with args; injection point in `AppHarness`.
- `packages/dashboard/tests/e2e/cfr-exit-gate-automation.test.ts` *(new)* — §8 Test 1 end-to-end: break browser-control, fire automation, assert every Test 1 bullet.
- `packages/dashboard/tests/e2e/cfr-exit-gate-conversation.test.ts` *(new)* — §8 Test 2 end-to-end: break STT, inject voice via AppHarness + mock transport, assert every Test 2 bullet.
- `packages/dashboard/tests/e2e/cfr-abbreviated-replays.test.ts` *(new)* — one abbreviated test per other registered plug type (TTS, desktop-control, any extras) matching whichever of Test 1 / Test 2's shape the plug's origin/invocation profile fits.

**Acceptance:** both exit-gate tests green; abbreviated replays green for every registered type.

**Verification:**
```bash
cd packages/dashboard && npx vitest run tests/e2e/cfr-exit-gate-automation tests/e2e/cfr-exit-gate-conversation tests/e2e/cfr-abbreviated-replays
```

Dev-machine preconditions: browser-control plug healthy; STT plug (Deepgram or local) healthy; any other plug under test healthy. The test setup deliberately breaks the plug, runs the full loop, and expects restoration — no manual intervention, no `systemctl restart`.

**Deviation triggers:** infrastructure blocker (Playwright not installed; Deepgram not configured; MCP server startup races the test). Document in `proposals/s16-<slug>.md` and escalate — this sprint is the milestone gate.
