# Handoff — CFR Coverage Gap: STT-only, Should Be Universal

**Created:** 2026-04-16
**Author:** The architect (M9.6 author)
**For:** The next planning session (fresh context)
**Status:** Known gap, milestone to follow

---

## 0. The honest summary

M9.6 was planned and sold as "when any capability fails during a user interaction, recover gracefully." What actually shipped is: **when the STT (audio-to-text) capability fails during a user turn, recover gracefully.** Every other capability type — TTS, image-to-text, browser-control, desktop-control, any future type — still has the silent-failure bug class M9.6 claimed to close.

The gap surfaced on 2026-04-16 when a WhatsApp voice message produced a text reply instead of a voice reply, because `text-to-audio` had no `.enabled` file and the framework had no CFR emitter on the TTS invocation path to notice.

This was the architect's planning error. Plan §3.6 explicitly scoped CFR detection to `transcribeAudio()` and nobody — including the architect — pushed back that the detection layer was cap-type-specific while the rest of the framework (orchestrator, emitter, reverify dispatch, ack copy table) was deliberately generic. Every sprint review approved that asymmetry without flagging it. The S7 exit gate verified the one path that was wired. Pass.

Now the next session owns extending CFR to the other types. This handoff captures what's generic-ready, what's STT-specific, and what the work actually is.

---

## 1. Architectural coverage map

This is the single most important section. Each row is a layer of the CFR framework; each column is a capability type and whether that layer supports it.

| Layer | `audio-to-text` (STT) | `text-to-audio` (TTS) | `image-to-text` | `text-to-image` | `desktop-control` | `browser-control` (multi-instance) | Future custom types |
|-------|----|----|----|----|----|----|----|
| `CfrEmitter` (event plumbing) | ✅ generic | ✅ generic | ✅ generic | ✅ generic | ✅ generic | ✅ generic | ✅ generic |
| `failure-symptoms.ts` (classifier) | ✅ `classifySttError` implemented | ❌ no TTS classifier | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Detection at invocation site (the gap)** | ✅ `chat-service.ts:592-707` | ❌ silent | ❌ silent | ❌ silent | ❌ silent (MCP tool, not chat-service) | ❌ silent (MCP tool) | ❌ silent |
| `RecoveryOrchestrator` (3-tries loop) | ✅ generic, dispatches by `capabilityType` | ✅ generic | ✅ generic | ✅ generic | ✅ generic | ✅ generic | ✅ generic |
| `reverify.ts` (post-fix verification) | ✅ `reverifyAudioToText` implemented | ❌ returns `pass: true` vacuously | ❌ ditto | ❌ ditto | ❌ ditto | ❌ ditto | ❌ ditto |
| `resilience-messages.ts` (ack copy) | ✅ | ✅ "voice reply" copy ready | ✅ "image understanding" | ✅ "image generation" | ⚠ no friendly name; falls through to raw type | ⚠ no friendly name | ⚠ raw type fallback |
| `AckDelivery` (channel routing) | ✅ generic | ✅ generic | ✅ generic | ✅ generic | ✅ generic | ✅ generic | ✅ generic |
| Orphan watchdog (S5) | ✅ detects voice placeholder in user turn content | ❌ no equivalent "I asked for image, never got one" detection | ❌ | ❌ | — | — | — |

**Summary:** every layer that touches *events, orchestration, recovery, delivery* is already cap-type-agnostic. Every layer that touches *detection and verification at the invocation site* is STT-only.

The next milestone's work is filling the red boxes in the `Detection` and `reverify` rows, plus minor polish on `failure-symptoms.ts` and `resilience-messages.ts`.

---

## 2. Exact code gaps

### 2.1 Detection gaps

| Capability | Invocation site | What detection is missing |
|-----------|-----------------|---------------------------|
| `text-to-audio` | `packages/dashboard/src/chat/chat-service.ts:~964` (`synthesizeAudio()`) and `packages/dashboard/src/app.ts:879-896` (`sendAudioViaTransport` → `bp.onSendVoiceReply`) | `synthesizeAudio` returns `null` on capability absence. No CFR emit. `onSendVoiceReply` returns `null` on capability absence. No CFR emit. Caller (`message-handler.ts:588-598`) silently falls back to text. |
| `image-to-text` | TBD — no current invocation site (capability not installed) | Future work; when the capability ships, its invocation site must emit CFR on failure. |
| `text-to-image` | TBD — no current invocation site | Same. |
| `desktop-control` / `browser-control` | Agent SDK MCP tool calls via `packages/core/src/capabilities/mcp-middleware.ts` | Plan §3.6 named MCP middleware (`PostToolUse` for well-known capability tools) as a detection point but **this was never implemented**. Tool errors / timeouts / schema mismatches from MCP capabilities silently propagate to the brain's response. |

### 2.2 The duplicate-TTS-path mess

While you're extending TTS detection, note the architectural smell in the TTS pipeline:

- `chat-service.ts:synthesizeAudio()` synthesizes audio, yields `audioUrl` in the `done` event.
- `message-handler.ts:571-575` **ignores `audioUrl`** — captures only `detectedLanguage`.
- `message-handler.ts:588-598` calls `sendAudioViaTransport(channelId, replyTo, currentText, language)` — passes text.
- `app.ts:879-896` receives the text, calls `bp.onSendVoiceReply(text, ...)` on the Baileys plugin, which synthesizes TTS **a second time**.

Two TTS invocation paths, both hit the same `text-to-audio` capability. CFR work needs to pick which one is authoritative before wiring detection — otherwise the emit fires twice on a single failure.

Recommendation: make `chat-service`'s `synthesizeAudio` authoritative (it's already in the pipeline's natural place), have `message-handler` use the `audioUrl` from the `done` event, delete or narrow `bp.onSendVoiceReply`. Then wire CFR emission once at the `synthesizeAudio` site. But this is a design call — the next planner should decide.

### 2.3 Reverify gaps

`packages/core/src/capabilities/reverify.ts:62-72` has a dispatcher that special-cases `audio-to-text` and returns `{pass: true, recoveredContent: undefined}` for everything else. The orchestrator at `recovery-orchestrator.ts:~208` then sees `pass: true && recoveredContent: undefined` → treats it as fail → iterates to surrender. So unknown types always surrender even when the capability was fixed.

You need per-type reverifiers for: TTS (generate a fixture and check the output file is a valid audio), image-to-text (OCR a fixture image), etc. Or — a looser dispatcher that accepts "capability now reports `status: available`" as sufficient for types where a fresh invocation against the original input isn't meaningful (TTS — you can't "re-speak" something the user sent). Design call.

### 2.4 Symptom classifier gaps

`failure-symptoms.ts` has `classifySttError` only. Other types need analogous classifiers that map error strings from their own capability scripts to the seven `CapabilityFailureSymptom` values.

Less urgent: for capabilities whose failure modes are simple ("script not found" / "API key missing"), the generic fall-through to `execution-error` or `not-enabled` is probably fine. STT needed the classifier mainly because its error strings had to be parsed to distinguish `not-installed` / `not-enabled` / `execution-error`.

### 2.5 Resilience-message copy

`resilience-messages.ts:24-29` has `FRIENDLY_NAMES` for four well-known types:

```
"audio-to-text" → "voice transcription"
"image-to-text" → "image understanding"
"text-to-audio" → "voice reply"
"text-to-image" → "image generation"
```

Other types fall through to the raw type name ("hold on — `desktop-control` isn't working right, fixing now."). Adding friendly names for `desktop-control`, `browser-control`, and any other registered type is trivial.

---

## 3. What's already generic and reusable

Do not re-architect these. Extend them.

- **`CapabilityFailure` event shape** (`packages/core/src/capabilities/cfr-types.ts:49-60`) — `capabilityType: string` + `symptom: CapabilityFailureSymptom`. No changes needed.
- **`CfrEmitter`** (`packages/core/src/capabilities/cfr-emitter.ts`) — already accepts any capabilityType.
- **`RecoveryOrchestrator.handle()`** (`packages/core/src/capabilities/recovery-orchestrator.ts:95+`) — dispatches by capabilityType, enforces per-type mutex, cooldown, budget. Drop new detection points into it and it works.
- **Fix automation prompt** (`packages/core/src/capabilities/prompts/fix-automation.md`) — generic "fix capability X" template, no STT-specific content.
- **`AckDelivery`** (`packages/core/src/capabilities/ack-delivery.ts`) — routes on `TriggeringInput.channel`, type-agnostic.
- **Orphan watchdog** (`packages/core/src/conversations/orphan-watchdog.ts`) — user-turn scanner is type-agnostic. Only the placeholder-detection list (`VOICE_PLACEHOLDERS` at `:168-171`) is STT-specific and would grow if we add image-placeholders etc.
- **Test patterns** — `packages/core/tests/capabilities/orchestrator/*.test.ts` and `packages/dashboard/tests/cfr/*.test.ts` are the reference. Replicate shape, not content.

---

## 4. Known-good test patterns to replicate

When wiring a new type's detection, the next agent should follow S1's four acceptance-test shape:

1. `<type>-store.test.ts` or equivalent for media persistence (if applicable to this type).
2. `cfr-emit-<type>-errors.test.ts` — table-driven mapping of error strings → symptoms.
3. `cfr-emit-<type>-deps-missing.test.ts` (or equivalent gating scenario).
4. `cfr-emit-<type>-empty-silent-vs-broken.test.ts` — for the boundary-case discrimination (if the type has a silent-but-valid output analog to empty audio).

For orchestrator-side changes, replicate the `orchestrator-*.test.ts` patterns in `packages/core/tests/capabilities/orchestrator/`.

---

## 5. Things NOT to do

- **Do not rewrite the CFR architecture.** Every layer that's generic is generic on purpose. The bug is narrow: missing detection wiring on 5 capability-type invocation sites. Fix the wiring.
- **Do not retire M9.6.** The STT path is load-bearing and the exit gate passed. Build on top.
- **Do not touch `.my_agent/capabilities/`.** Private. Gitignored. Capabilities get added/enabled by the CTO or by agent-driven capability-builder flows.
- **Do not invent new message types or protocol changes** unless the spec explicitly calls for it. `capability_ack` was added in M9.6-S8 and is the standard transport for framework-emitted user messages.
- **Do not delete the duplicate TTS path (§2.2) as a drive-by.** Decide the authoritative path in the plan, then execute the change as a named item, not as cleanup.

---

## 6. Open items still parked from M9.6 (already documented)

These are separate from the coverage gap. Reading them helps calibrate scope:

- **S4-FU3** — `parentFailureId` nested-CFR budget: declared but no producer/consumer. Becomes reachable when CFR detection expands to new types that might chain (e.g., a TTS fix needs web-search, web-search fails).
- **S4-FU4** — `AckKind` reason discriminator: partially addressed in S8 via `surrender-cooldown`. A fuller `{kind, reason}` shape may be needed once more surrender scenarios exist.
- **S6-FU4** — 20s status-timer magic constant: leave alone until real fix-loop duration data contradicts it. S7 measured 142s end-to-end on STT, which suggests 20s is fine for first status.
- **S7-FU3** — CI audio via secrets: policy decision, not a code item. Only matters if the exit gate is enforced in CI.
- **The duplicate TTS path** (§2.2 above): architectural cleanup.

---

## 7. Key references

- **M9.6 plan:** [`plan.md`](plan.md)
- **M9.6 design spec:** [`../../design/capability-resilience.md`](../../design/capability-resilience.md) — especially §Red-Team Resolutions for binding decisions that still apply.
- **Red-team:** [`../../design/capability-resilience-redteam.md`](../../design/capability-resilience-redteam.md) — captures the intended generality that the implementation narrowed.
- **S1 review** (establishes the detection-layer pattern): [`s1-architect-review.md`](s1-architect-review.md)
- **S4 review** (recovery orchestrator shape, budget/cooldown rules): [`s4-architect-review.md`](s4-architect-review.md)
- **S6 review** (ack delivery shape, copy table): [`s6-architect-review.md`](s6-architect-review.md)
- **S7 review** (exit-gate patterns and fixture discipline): [`s7-architect-review.md`](s7-architect-review.md)
- **Capability system design:** [`../../design/capability-system.md`](../../design/capability-system.md)
- **Capability framework v2 (multi-instance):** [`../../design/capability-framework-v2.md`](../../design/capability-framework-v2.md)
- **Routing rule (for acks):** [`../m10-s0-routing-simplification/plan.md`](../m10-s0-routing-simplification/plan.md)
- **Incident that started M9.6:** `.my_agent/conversations/conv-01KP3WPV3KGHWCRHD7VX8XVZFZ.jsonl`

---

## 8. Suggested milestone shape (the CTO should confirm or reshape in the new session)

Not a prescription. Shape for discussion.

**M9.7 — CFR Universal Coverage**, roughly 4–5 sprints:

- **S1** — TTS detection + reverify + the authoritative-path decision (§2.2). Fold the duplicate-TTS-path cleanup in or spin to its own sprint.
- **S2** — MCP middleware detection for well-known capability-typed tools (desktop-control, browser-control). Plan §3.6 named this as a detection point; it was never implemented.
- **S3** — Generic reverify dispatcher for types where "re-run against triggering input" isn't meaningful (TTS output, tool-use side effects). Probably a fall-through "capability reports available" rule with per-type opt-outs.
- **S4** — `image-to-text` / `text-to-image` scaffolding for when the capabilities ship — detection hooks in place, no live code until a capability uses the type.
- **S5** — E2E exit gate: incident replay for each newly-wired type. Mirror S7's pattern. The machine you're testing on needs the capabilities enabled (this was the invisible precondition that kept this bug hiding).

Or fold this into an existing milestone if a different framing fits better.

---

## 9. Closing note for the next planner

The CTO said "I am disappointed in you" and they're right. M9.6 solved an incident, not a class. The plan was specific when it should have been general, and every review — including the architect's — gave the asymmetry a pass because the STT path worked and the exit gate used STT. The discipline that the plan's §0 tried to enforce ("stop on deviation") doesn't catch a miss at the plan layer.

If there's a process fix beyond the technical one: when the next milestone plan is written, its §0 should demand that every generic layer come with coverage for every registered capability type, not just the incident type. If a new type can't be covered in-sprint, its missing coverage is named and scoped, not omitted.

Good luck. The bones are strong — just finish putting the skin on.
