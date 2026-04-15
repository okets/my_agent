# S6 Decisions — User-Facing Messaging + Capability Confidence Contract

Sprint: M9.6-S6
Branch: sprint/m9.6-s6-user-facing-messaging

---

## D1 — `AckDelivery` uses structural `*Like` interfaces, not dashboard imports

**Decision:** `packages/core/src/capabilities/ack-delivery.ts` declares
`TransportManagerLike` and `ConnectionRegistryLike` as structural interfaces,
rather than importing `TransportManager` / `ConnectionRegistry` from
`packages/dashboard`.

**Why:** `packages/core` cannot depend on `packages/dashboard` (circular;
dashboard already imports from core via `@my-agent/core`). This mirrors
the pattern already established in S5's `orphan-watchdog.ts` (`RawMediaStoreLike`,
`ConversationManagerLike`).

**Impact:** Dashboard's concrete classes are structurally assignable to the
`*Like` interfaces — no adapter needed. Tests mock the two methods directly
without pulling any dashboard dependencies.

---

## D2 — 20s status timer replaces per-attempt `emitAck(..., "status")`

**Decision:** The orchestrator no longer emits a `status` ack on every
iteration boundary. Instead, `runFixLoop` arms a single `setTimeout(20_000)`
right after the initial `attempt` ack. If the session is still not in `DONE`
or `SURRENDER` when the timer fires, a `status` ack is emitted. The timer
is cleared in a `finally` block.

**Why:** The plan (§8.1) ties status copy to "elapsed > 20s", not to
"attempt ≥ 2". Per-attempt emits fired on fast failures (spawn-reject) even
when the user hadn't been waiting long enough to warrant reassurance. A
single time-based timer matches the user-facing intent.

**Impact:** Status ack fires at most once per fix session. Tests that relied
on per-attempt `"status"` emits no longer exist (none did — see
`orchestrator-budget.test.ts`). New `orchestrator-timing.test.ts` covers the
fire / no-fire cases with fake timers.

---

## D3 — `surrenderReason` on `FixSession`, not threaded through state machine

**Decision:** `FixSession` gains an optional `surrenderReason?: "budget" | "iteration-3"`
field. `runOneAttempt` sets it to `"budget"` when the 5-job cap forces an
early bail; the 3-attempts exhaustion path sets it to `"iteration-3"` just
before calling `surrender()`. `surrender()` picks `"surrender-budget"` vs
`"surrender"` for the ack kind based on this field.

**Why:** The plan's copy table (§8.1) has two distinct surrender messages
(budget-hit vs all-three-tries). The state machine's `SURRENDER` action is
reason-agnostic, so the reason must be tracked on the session itself. Adding
a new action variant to the state machine would have been more invasive and
broken existing state-machine tests.

**Impact:** `AckKind` gains `"surrender-budget"` as a fourth variant. The
ack callback in `app.ts` maps it to the "budget" copy, all other
`"surrender"` calls map to "iteration-3". Stale `surrenderReason` on a
recovered session is harmless — it's only read inside `surrender()`.

---

## D4 — `capability_surrender` event written in the `app.ts` emitAck callback

**Decision:** The orchestrator itself does not append to the conversation
JSONL. When `emitAck(failure, "surrender" | "surrender-budget")` fires in
`app.ts`, the callback calls `conversationManager.appendEvent(...)` with a
`CapabilitySurrenderEvent` (type already defined in S5 at
`packages/dashboard/src/conversations/types.ts:230`).

**Why:** `packages/core` can't import `ConversationManager` (circular). The
surrender marker is a dashboard concept (the transcript lives there). The
orchestrator stays as pure logic + dep injection; the dashboard decides
what to persist. This also keeps the orchestrator unit-testable without any
filesystem state.

**Impact:** The orphan watchdog's `hasSurrenderEventFor` check (S5) now sees
real surrender events in production conversations. Forward-compatible check
remains unchanged.

---

## D5 — FU4 reprocessTurn routing fix (surfaced in S5 review)

**Decision:** The `reprocessTurn` callback in `app.ts` now passes
`failure.triggeringInput.channel.channelId || undefined` to
`ci.forwardToChannel(response, ...)`.

**Why:** Pre-fix, the re-processed response went to the preferred-outbound
channel regardless of where the original turn arrived. For a
WhatsApp-originated voice note that recovered via CFR, the user's answer
would have landed on dashboard (or whatever the preferred outbound was),
not WhatsApp — violating the routing rule in user memory
(`project_routing_rule.md`: "conversation replies stay on the conversation's
channel").

**Impact:** Same-channel routing for CFR-recovered turns. `|| undefined`
falls back to preferred-outbound when `channelId` is empty, preserving the
existing behavior for dashboard triggers.

---

## D6 — `confidence` / `duration_ms` added to `ReverifyResult`

**Decision:** `reverify.ts` now reads `confidence` and `duration_ms` from
the transcribe.sh JSON output and surfaces them on `ReverifyResult`.
Missing fields are coerced to `undefined`, not to a default number.

**Why:** Downstream reflection-phase prompts (Opus) need to distinguish
"Deepgram really heard nothing" (`text: "" + confidence: 0.05`) from
"Deepgram is broken" (`text: "" + confidence: 0.9`). Surfacing both on
`ReverifyResult` keeps the contract explicit. Conservative null-handling
means legacy scripts that don't emit the fields still work.

**Impact:** Template at `skills/capability-templates/audio-to-text.md` now
documents the two fields as "optional but recommended". Follow-up filed
for the CTO to update the Deepgram script.

---

## D7 — Framework-level `defaultCopy` table, no per-deploy overrides

**Decision:** `resilience-messages.ts` exports a single `defaultCopy`
const conforming to `ResilienceCopy`. No plug-in point for per-agent
custom copy.

**Why:** The plan lists copy verbatim and treats it as product-design
decisions, not configuration. Customizing copy per-agent would risk
regressing on tone or introducing language drift during an outage.
Future sprint can add locale support when we actually need it.

**Impact:** All agents share the same ack/status/surrender wording.
Tests lock the strings byte-exact.
