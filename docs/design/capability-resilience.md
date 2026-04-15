# Capability Resilience & Conversation Recovery — Design Spec

> **Status:** Approved (red-team resolved 2026-04-15)
> **Created:** 2026-04-15
> **Milestone:** M9.6 — Capability Resilience & Recovery (blocker for M10+)
> **Scope:** Runtime protocol for capability failures during user interactions. Generalizes the 3-tries rule to conversation-level recovery. Orphaned-turn recovery. Self-preservation rules.
> **Origin incident:** `.my_agent/conversations/conv-01KP3WPV3KGHWCRHD7VX8XVZFZ.jsonl` (2026-04-15)
> **Red-team:** [`capability-resilience-redteam.md`](capability-resilience-redteam.md) — all findings accepted.
> **Implementation plan:** [`../sprints/m9.6-capability-resilience/plan.md`](../sprints/m9.6-capability-resilience/plan.md)
> **Architect:** review session that owns the plan, the red-team, and sprint-time deviation adjudication. Sonnet implementing agents route clarifications to the architect, not the CTO.

---

## Red-Team Resolutions (2026-04-15)

All red-team findings are **accepted** and folded into the sprint plan. Summary of binding decisions:

1. **Detection layer is chat-service, not message-handler** (B1). Primary CFR emitters live at `packages/dashboard/src/chat/chat-service.ts:587-616` and inside `transcribeAudio()` at `:938-958`. The `Detection Points` table below reflects this.
2. **Channel layer persists raw media before any deps check** (B2). New `RawMediaStore` writes every inbound audio/image buffer to `.my_agent/conversations/<convId>/raw/` the moment a transport handler receives it. Re-verification always has the triggering artifact.
3. **The `systemctl restart` block targets the conversation brain's Bash tool**, not just the fix automation (B3). `packages/core/src/hooks/safety.ts:51` is extended to block `systemctl restart nina-*` and `pkill -f nina*` unconditionally. The brain's identity-layer system prompt is updated.
4. **`rescan()` is driven by a real filesystem watcher** (B4). New `CapabilityWatcher` (chokidar) watches `.my_agent/capabilities/**` and calls `registry.rescan()` on change, then triggers `testAll()` to update `status`. The false claim in `packages/core/src/agents/definitions.ts:110-114` is retracted or made true; after S3 it is true.
5. **Open question 4 (ack channel) — closed.** CFR acks go to the conversation's channel (same-channel rule from M10-S0 routing simplification). No preferred-channel fallback; CFR is conversation-scoped.
6. **Open question 5 (fixture fallback) — closed.** Committed-fixture fallback is build-time only. Runtime surrender is plain-language "please resend as text"; never a canned response.
7. **Open question 7 (cascading failures) — bounded.** Max 1 level of nested CFR; a nested fix consumes the parent iteration's budget slot; total Claude job spawns per triggering user turn capped at 5.
8. **Open question 6 (orphan watchdog stale window) — bounded.** Startup watchdog skips orphans older than 30 minutes; those become "resolved (stale)" events, not re-drives.
9. **JSONL user turn mutation policy** (M4) — append-only preserved. A `turn_corrected` event references the placeholder turn's `turnNumber` with the transcribed content. Abbreviation queue honors `turn_corrected` when summarizing.
10. **Surrender is scoped to `(capability, conversation, turnNumber)`** with a global 10-minute cross-conversation cooldown. A successful `testAll()` pass clears cooldown immediately (M5).
11. **Per-phase model selection is specified** (M11): Opus for reflection/surrender-decision, Sonnet for the actual fix-execute phase. Declared in the orchestrator-emitted automation file.
12. **`empty-result` disambiguation** (M7) — the capability contract grows `confidence` and `duration_ms` fields. STT scripts report them; `empty-result` is only raised when `duration_ms > 500 && confidence > 0.2` and the text is empty. Silent/short audio is never a CFR trigger.
13. **Two placeholder strings stay distinct** (M2). Detection handles both:
    - `"[Voice note — audio attached, pending transcription]"` (WhatsApp plugin, `plugins/channel-whatsapp/src/plugin.ts:518`) → symptom `deps-missing`.
    - `"[Voice message — transcription failed: <error>]"` (chat-service, `:612`) → symptom parsed from the error (`not-installed | not-enabled | execution-error`).
14. **Ack ownership is framework-first**. Deterministic acks for `not-installed | not-enabled | deps-missing | timeout` emitted by the framework with transport context carried in the CFR event. Brain-owned acks only for `empty-result | validation-failed` (needs judgment).
15. **`status` vs `enabled` coupling specified** (M8). After `.enabled` creation the orchestrator MUST call `registry.rescan()` then `registry.testAll()` and wait for `status === 'available'` before re-verifying. `.enabled` alone is never a success signal.
16. **Sprint count is 7**, not 5. Scope not reduced; honest estimate.

---

## Problem

Nina can hatch capabilities, test them against the build harness, and ship them. What she cannot do is **recover gracefully when one of those capabilities fails at runtime while a user is waiting**. When a capability misbehaves during a real conversation, the current system fails silently and the user is left pressing for answers.

### The Incident (2026-04-15)

A single WhatsApp conversation produced four distinct failures compounding into one end-user symptom: **Nina received three voice messages and replied to none of them.** The user had to explicitly instruct Nina to "fix the issue with voice capability" — behavior that should have been automatic.

**Conversation timeline (from `conv-01KP3WPV3KGHWCRHD7VX8XVZFZ.jsonl`):**

| Turn | Time | Event | What Nina Did |
|------|------|-------|---------------|
| 1 | 11:52 | User sends voice #1 ("can you understand voice messages now") | Content saved as literal `[Voice note — audio attached, pending transcription]`. No transcription ran. Brain treated placeholder as the message. Replied generically. |
| 2 | 11:54 | User says "Fix the issue with voice capability." | Brain spawns fix-audio-to-text-capability job. Job finds `.enabled` file missing, creates it. Decides capability is now fixed. |
| 3 | 11:55 | Brain issues `systemctl --user restart nina-dashboard.service` to activate fix | SIGTERM kills the brain's own in-flight reply to voice #2. User sees no response. |
| 4 | 11:55 | User sends voice #2 (retry) | Still processed with stale config (pre-restart). Same placeholder symptom. Reply begins streaming. |
| 5 | 11:56 | Brain restarts again | SIGTERM #2 — kills voice #3's reply. |
| 6 | 11:56 | User sends voice #3 ("can you understand voice messages now") | Placeholder-only content. No reply emitted. Conversation ends unanswered. |

**Evidence in the JSONL:** turn 9 (voice #3) is a user entry with no following assistant entry. Nothing in the system detected this orphan. The user assumed Nina was ignoring them.

**Direct test after the fact:** running `transcribe.sh` against voice #3's audio file returned `{"text": "can you understand voice messages now", "language": "en"}` — the capability works. The conversation broke anyway.

### Four Bugs

| # | Bug | Evidence | Root Cause |
|---|-----|----------|------------|
| A | **Registry activation is a hidden gate.** Capability was fully configured (CAPABILITY.md correct, env secret present, script executable) but `.enabled` file was missing. Registry silently skipped it. | `.my_agent/capabilities/stt-deepgram/.enabled` did not exist until 11:44:01Z; capability was configured days earlier. | Registry scan has no warning path for "configured but not enabled" — the file acts as a boolean toggle, not a health surface. |
| B | **Deps-on-first-WS wiring.** `AppChatService.deps` is `null` until a browser WebSocket connects. Voice notes arriving before any browser connect bypass the attachment save + STT branch entirely. | `packages/dashboard/src/chat/chat-service.ts:157` (`setDeps`), `packages/dashboard/src/chat/chat-service.ts:536` (deps-gated branch), `packages/dashboard/src/ws/chat-handler.ts:61` (the only `setDeps` call site), `packages/dashboard/src/app.ts:1827` (AppChatService constructed without deps). | AttachmentService lifecycle was retrofitted from the WS handler instead of the App. WhatsApp arrives before browser → silent STT bypass. |
| C | **Self-destructive restart.** Brain runs `systemctl --user restart nina-dashboard.service` to activate its own fix. SIGTERM kills the brain mid-stream, dropping the user-facing reply. | Two SIGTERMs in the 11:55–11:56 window; two user turns lost. | No rule against the brain restarting its own host process. No hot-reload path for capability activation. |
| D | **No orphaned-turn recovery.** User turns with no following assistant turn are not detected. Conversation simply ends. | Turn 9 in the JSONL — user entry, no reply, no re-drive. | No startup sweep; no periodic health check on last-turn state. |

### The 3-Tries Rule — Origin and Gap

A rule already exists for capped-iteration capability fixing, but **only for agent-build-from-scratch acceptance testing**:

> **Capped iterations:** max 3 attempts. Between attempts, collect structured reflection from Nina per S4's review questionnaire.
> **Stopping rule:** if iteration 3 fails, ship the **committed fixture** as a registered fallback capability.
> — [`docs/sprints/m9.5-s7-browser-capability/plan.md:272-273`](../sprints/m9.5-s7-browser-capability/plan.md)

> Cap at 3 iterations; ship a committed fixture fallback if iteration 3 fails and file a skill-iteration follow-up.
> — [`docs/design/adding-a-multi-instance-capability-type.md:44`](adding-a-multi-instance-capability-type.md)

**The gap:** this is a build-time gate, not a runtime protocol. Nothing in the running system triggers the 3-tries loop when a capability fails *during an active conversation*. So the user had to invoke it manually with "fix the issue" — after the capability had already failed Nina silently.

---

## Design Goals

The fundamental UX promise this spec is trying to keep:

> **When a capability fails during a user message, the user should not have to ask twice. Nina should acknowledge the problem, fix it, and answer the original question. Silence is the bug.**

Concrete properties:

1. **No silent failures.** Every capability failure during a user turn produces a user-visible signal within one response cycle — never silence.
2. **Autonomous recovery.** Nina triggers the fix loop herself. The user does not need to say "fix it."
3. **Repay the original debt.** After a successful fix, Nina re-processes the triggering input and replies to it — the user's original question gets answered, not abandoned.
4. **Bounded effort.** 3 iterations max. On iteration 3 failure, surrender gracefully in plain language: "I tried three fixes, voice isn't working. Please resend as text."
5. **Never interrupt self.** The fix pipeline never kills the running conversation. Restarts, if genuinely needed, defer to idle or surface to the user.
6. **Pick up where we left off.** If the brain is killed mid-stream for any reason, orphaned user turns are re-driven on next boot.
7. **The user is kept in the loop.** Acknowledge on attempt 1 ("hold on, voice isn't working, fixing now"), status on attempt 2 if slow, graceful message on attempt 3.

**Non-goals for M9.6:**
- Preventing capability failures in the first place. This spec handles recovery, not prevention.
- Extending the 3-tries budget. Three is chosen; changing it is a separate discussion.
- Cross-capability root-cause analysis. Each failing capability is fixed independently.
- Rewriting the capability registry. Extensions only.

---

## Core Protocol: Capability Failure Recovery (CFR)

### State Machine

```
  [user turn arrives]
         │
         ▼
  ┌─────────────────┐
  │ capability runs │
  └──────┬──────────┘
         │
         ▼
  ┌─────────────────┐   ok   ┌──────────────────┐
  │   succeeded?    ├──────► │   normal reply   │
  └──────┬──────────┘        └──────────────────┘
         │ fail
         ▼
  ┌─────────────────┐
  │ raise CFR event │  (chat-service / message-handler detects symptom)
  └──────┬──────────┘
         │
         ▼
  ┌─────────────────────────────────┐
  │ brain receives CFR event        │
  │ 1. ack to user (attempt 1)      │
  │ 2. spawn fix-<capability> job   │
  │ 3. wait for fix result          │
  └──────┬──────────────────────────┘
         │
         ▼
  ┌─────────────────────────────────┐
  │ re-verify against ACTUAL input  │   pass   ┌────────────────────────────┐
  │ (the user's real message, not  ├────────► │ re-process original input │
  │  a synthetic test fixture)     │          │ reply to user              │
  └──────┬──────────────────────────┘          └────────────────────────────┘
         │ fail
         ▼
  ┌─────────────────────────────────┐   n<3   ┌──────────────────┐
  │ increment attempt counter       ├───────► │ iterate (goto    │
  │                                 │         │ spawn fix job)   │
  └──────┬──────────────────────────┘         └──────────────────┘
         │ n=3
         ▼
  ┌─────────────────────────────────┐
  │ graceful surrender message      │
  │ file follow-up in paper trail   │
  │ user sees "tried 3, please ..." │
  └─────────────────────────────────┘
```

### CFR Event Shape

```typescript
interface CapabilityFailure {
  capabilityType: string;          // e.g. "audio-to-text"
  capabilityName?: string;          // e.g. "stt-deepgram" (if known)
  symptom: CapabilityFailureSymptom; // what we observed
  triggeringInput: {
    channel: "whatsapp" | "dashboard" | ...;
    conversationId: string;
    turnId: string;
    artifact: { type: "audio" | "image" | ...; path: string; };
    userUtterance?: string;         // if any text accompanies
  };
  attemptNumber: 1 | 2 | 3;
  previousAttempts: FixAttempt[];   // for reflection between iterations
}

type CapabilityFailureSymptom =
  | "not-installed"           // no capability of this type in registry
  | "not-enabled"             // installed but .enabled missing
  | "deps-missing"            // attachmentService null, env var unset, etc.
  | "execution-error"         // script exited non-zero / MCP tool threw
  | "empty-result"            // returned but output is empty/placeholder
  | "timeout"                 // ran past deadline
  | "validation-failed";      // result didn't match expected schema
```

### Detection Points (Runtime Instrumentation)

| Layer | File | What Must Raise CFR |
|-------|------|---------------------|
| Chat service STT branch | `packages/dashboard/src/chat/chat-service.ts:587-616` + `transcribeAudio()` at `:938-958` | **Primary emitter.** Parses `sttResult.error` into a symptom: no capability → `not-installed`/`not-enabled`; execFile threw → `execution-error`; timeout hit → `timeout`; text empty but `duration_ms > 500 && confidence > 0.2` → `empty-result`. |
| Chat service deps guard | `packages/dashboard/src/chat/chat-service.ts:536` | `options.attachments?.length && !deps?.attachmentService` → `deps-missing`. Framework raises CFR *before* bypassing the save branch. |
| Channel raw-media writer | `packages/dashboard/src/channels/message-handler.ts` (new `RawMediaStore` call near line 460) | Writes the buffer to `.my_agent/conversations/<convId>/raw/<attachmentId>.<ext>` unconditionally. Never raises CFR itself — provides the artifact for re-verification. |
| Capability registry health | `registry.getHealth()` (new in S3) | After rescan: capabilities that are `status === 'unavailable'` or `enabled && health === 'degraded'` are reported proactively on App boot. |
| MCP tool invocation | Agent SDK middleware hook (`PostToolUse` for well-known capability tools) | Tool error response, timeout, unexpected schema → `execution-error` / `timeout` / `validation-failed`. |

**Design rule:** CFR detection lives in the framework, not in the brain's prompt. Prompts can miss things; code cannot.

### Re-verification Against Actual Input

The critical correctness property. When the fix loop completes, the capability is **re-run against the user's actual triggering input**, not against a synthetic test fixture.

**Why this matters:** the 2026-04-15 fix job passed its internal test (`.enabled` file now exists) but nobody re-tested on voice #1's audio. If voice #1 still produced a placeholder, we'd have caught it immediately. Instead, the fix was declared successful based on configuration-level checks.

**Rule:** every CFR fix iteration ends with `capability.invoke(triggeringInput.artifact)`. If that returns a useful result, the fix is real. If not, iterate.

### Deciphering the Original Message

After a successful fix, Nina must **answer the user's original question**, not just the follow-up retry. The triggering input is preserved in the CFR event specifically for this purpose.

**Flow:**

1. User's turn arrives with audio.
2. Transcription fails. Turn is stored with placeholder content, `inputMedium: "audio"`, and `attachmentRef` pointing to the saved audio file.
3. CFR event raised; brain acknowledged ("hold on, fixing voice").
4. Fix iteration succeeds.
5. Brain receives `[SYSTEM: capability audio-to-text is now working. The user's original turn that failed was turn X with audio at <path>. Re-transcribe and respond to what they said.]`
6. Brain calls transcribe on the saved audio, receives the real text, processes the user's actual request, and replies.

**Result:** one user message, one answer. The user never repeats themselves.

### 3-Tries Budget & Reflection

Each failed iteration records structured reflection:

```yaml
attempt: 1
timestamp: 2026-04-15T11:52:03Z
capability: audio-to-text/stt-deepgram
hypothesis: ".enabled file missing blocks registry activation"
change: "created .enabled"
verification_input: /path/to/voice-1.ogg
verification_result: "still returned placeholder"
failure_mode: "pipeline did not route audio through capability despite .enabled present"
next_hypothesis: "deps-missing — AppChatService.setDeps not called at boot"
```

This reflection is input to iteration 2's hypothesis. By iteration 3, if we haven't converged, the evidence says the problem is likely not fixable from the brain's tool surface — which is why surrender is the right move.

### Graceful Surrender (Iteration 3 Fail)

On 3-fail:
1. User-visible message on the same channel: "I tried three times to fix voice transcription and couldn't. Could you resend as text?"
2. A follow-up entry filed in the capability's paper trail (`DECISIONS.md` + follow-up record).
3. Conversation is **marked resolved** (no orphan watchdog retry).
4. If the capability has a committed fixture fallback (per M9.5-S7's rule), fallback activates for subsequent turns.

---

## User Journey — Before / After

### Before (today, 2026-04-15)

```
User voice #1  → [silence, then generic non-answer]
User: "fix the issue"
Nina: "ok fixing"           ← user had to ask
Nina: [self-restarts, killing her reply]
User voice #2 → [silence]
User voice #3 → [silence]
User: disengages, assumes Nina is broken
```

### After (M9.6 target)

```
User voice #1
Nina (attempt 1 ack):  "hold on — voice transcription isn't working right, fixing now."
Nina (3s later):       "fixed it. you asked 'can you understand voice messages now' —
                        yes, I can now. what's next?"
```

If the fix fails 3 times:

```
User voice #1
Nina:                  "hold on — voice transcription isn't working, fixing now."
Nina (30s later):      "still fixing — second attempt."
Nina:                  "I tried three fixes and voice isn't working today.
                        could you resend as text? I've logged the issue."
```

**Key property:** the user sends **one** message and gets **one** resolution thread. No repeated pressing.

---

## Component-Level Design

### Sprint 1 — Runtime 3-Tries Protocol

**New:**
- `packages/core/src/capabilities/failure-detector.ts` — subscribes to channel/chat-service events, evaluates symptoms, emits `CapabilityFailure` events.
- `packages/core/src/capabilities/recovery-orchestrator.ts` — consumes events, spawns `fix-<type>` automation, enforces 3-iteration cap, manages reflection, re-verifies, re-processes.
- Prompt wrapping for the "fix automation" that explicitly requires re-verification against the triggering artifact, not a synthetic test.

**Modified:**
- Brain system-prompt additions (layered, not hardcoded): "When you receive a CAPABILITY_RECOVERED system message, use the original triggering artifact at <path> to respond to the user's original question."

**Acceptance test:**
- Break `stt-deepgram` (remove `.enabled`), send voice note, verify: (a) user sees ack within 1 response cycle, (b) fix runs, (c) Nina answers the original voice note's content.

### Sprint 2 — Deps Wiring on Boot

**Modified:**
- `packages/dashboard/src/app.ts:1827` — AttachmentService constructed at App boot; `app.chat.setDeps()` called here.
- `packages/dashboard/src/ws/chat-handler.ts:38-69` — removes the `setDeps` block; WS handler only consumes deps, doesn't install them.
- `packages/dashboard/src/channels/message-handler.ts` — if deps unexpectedly null, raise `CapabilityFailure` with `symptom: "deps-missing"` instead of silent bypass.

**Acceptance test:**
- Boot dashboard, never open a browser, send WhatsApp voice note, verify transcription runs and response is sent.

### Sprint 3 — No Self-Destructive Restart

**New:**
- `capabilityRegistry.rescan()` — hot-reload path for capability changes. Reads registry, diffs against in-memory state, loads/unloads capabilities without process restart.
- Claude Code hook (PreToolUse on Bash) that blocks `systemctl restart nina-dashboard.service` and `pkill` targeting our own process while a streaming session is active. Suggest `rescan()` instead.

**Modified:**
- Fix automation prompts: "Do NOT run systemctl restart on your own host. Use registry rescan. If a full restart is truly required, surface it to the user via the conversation; don't self-kill."
- Brain system prompt: same reminder at the identity layer.

**Acceptance test:**
- Fix automation attempts self-restart → hook denies, registry rescan runs instead, brain's reply is not interrupted.

### Sprint 4 — Orphaned-Turn Watchdog

**New:**
- `packages/core/src/conversations/orphan-watchdog.ts` — on App boot, scan last N conversations (configurable, default 5), find user turns with no following assistant turn within a threshold window (default 2 min). For each: inject a system message to the brain asking it to pick up where it left off, providing the user's original content (with re-transcription if it was audio).

**Design rules:**
- Startup-only. No periodic sweeps (loop risk).
- Idempotent: watchdog sets a marker in the JSONL after re-driving; re-runs on the same turn skip.
- Respects conversation state: if conversation is explicitly marked resolved (via surrender message), skip.

**Acceptance test:**
- Simulate brain kill mid-stream (SIGTERM during a user turn's reply). Restart dashboard. Verify brain re-drives the unanswered turn within 10s of boot.

### Sprint 5 — User-Facing Resilience Messaging

**New:**
- `packages/core/src/capabilities/resilience-messages.ts` — standard copy for ack, status-update, surrender, and re-answer patterns. Single source of truth, reusable across channels.

**Rules:**
- Ack message is issued **before** the fix loop starts, not after. User never waits more than 2s for first feedback.
- Status update if attempt 2 is running past 20s.
- Surrender message on attempt 3 fail is plain-language and actionable ("resend as text").
- Copy lives in the framework, not in the brain's prompt — deterministic.

**Acceptance test:**
- Integration test with a deliberately-broken fixture capability. Verify the user sees ack → status → surrender in that order, with correct timing, on both dashboard and WhatsApp.

---

## Open Questions — Closed

All open questions from the draft have been resolved by red-team and are now binding. See [Red-Team Resolutions](#red-team-resolutions-2026-04-15) at the top of this doc and the corresponding rules in [`../sprints/m9.6-capability-resilience/plan.md`](../sprints/m9.6-capability-resilience/plan.md).

| # | Question | Resolution |
|---|----------|-----------|
| 1 | Ack latency | Framework ack within 2s of CFR emit. If detector (e.g. MCP timeout) is itself slow, the *transport-level* typing indicator keeps the user aware — then the real ack fires once detector resolves. |
| 2 | Ack ownership | Framework for deterministic symptoms (`not-installed`, `not-enabled`, `deps-missing`, `timeout`). Brain for judgment symptoms (`empty-result`, `validation-failed`). |
| 3 | Artifact retention | `RawMediaStore` persists every inbound buffer at channel layer before any deps/processing. Available for full CFR session lifetime. |
| 4 | Ack channel | Same channel as the triggering message. Always. No preferred-channel escalation. |
| 5 | Fixture fallback | Build-time only. Runtime surrender is plain-language "please resend as text". No canned data. |
| 6 | Orphan watchdog window | Startup-only sweep. Skip orphans older than 30 min (log as `resolved-stale`). |
| 7 | Cascading CFR | Max 1 level of nesting; nested fix consumes a parent-iteration slot; total Claude job spawns per triggering user turn capped at 5. |
| 8 | Concurrent failures | Per-capability mutex. Second trigger for the same capability attaches to the in-flight fix loop; its turn gets the same outcome. |
| 9 | Brain override | Allowed via explicit `user.intent.skipCFR=true` flag derived from phrases like "just reply to what you can hear". Orchestrator respects and logs. |
| 10 | Symptom granularity | Taxonomy is sufficient. Mapping rules live in `packages/core/src/capabilities/failure-symptoms.ts`. |

---

## Dependencies & Ordering

**Depends on:**
- M9 (capability registry, paper trail)
- M9.5 (capability framework v2, 3-tries rule origin)
- M6.10 (headless App — App-level deps wiring happens here)

**Blocks:**
- M10 and everything downstream. Every channel added before M9.6 ships inherits the "silent capability failure → dead conversation" fragility. M10's whole value proposition (transports are easy to add) breaks if each new channel inherits the bug class.

**Sprint order:**
S1 → S2 (parallel ok) → S3 → S4 → S5. S5 depends on S1's CFR event shape being finalized.

---

## Testing Strategy

Three layers, all required:

1. **Unit:** failure-detector symptom classification, orchestrator state machine, surrender logic.
2. **Integration:** dashboard + fixture capability. Break capability deliberately, verify the full CFR flow.
3. **E2E on the incident replay.** Use `conv-01KP3WPV3KGHWCRHD7VX8XVZFZ`'s voice #1 audio file as a regression corpus. The exit gate for the milestone is: replay voice #1 against a fresh dashboard where `.enabled` is missing, and the user sees a transcribed-and-answered reply within 30s — with no manual intervention.

---

## References

- **Incident JSONL:** `.my_agent/conversations/conv-01KP3WPV3KGHWCRHD7VX8XVZFZ.jsonl`
- **Fix job paper trail:** `.my_agent/automations/.runs/fix-audio-to-text-capability/job-4f716f84-ea2f-44b0-8f2f-f0bc54676119/`
- **3-tries rule origin:** [`docs/sprints/m9.5-s7-browser-capability/plan.md:272-273`](../sprints/m9.5-s7-browser-capability/plan.md), [`docs/design/adding-a-multi-instance-capability-type.md:44`](adding-a-multi-instance-capability-type.md)
- **Capability system:** [`capability-system.md`](capability-system.md), [`capability-framework-v2.md`](capability-framework-v2.md)
- **Routing:** [`docs/sprints/m10-s0-routing-simplification/plan.md`](../sprints/m10-s0-routing-simplification/plan.md) — CFR ack channel rule interacts with the presence-based routing
- **Headless App:** [`headless-api.md`](headless-api.md) — App-level deps construction
