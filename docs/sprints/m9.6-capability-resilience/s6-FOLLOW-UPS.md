# S6 Follow-Ups — User-Facing Messaging + Capability Confidence Contract

Sprint: M9.6-S6
Branch: sprint/m9.6-s6-user-facing-messaging

---

## FU1 — CTO: Update `.my_agent/capabilities/stt-deepgram/scripts/transcribe.sh` to emit `confidence` + `duration_ms`

**Context:** Plan §8.4 explicitly forbids editing `.my_agent/` from a
framework sprint. The audio-to-text template at
`skills/capability-templates/audio-to-text.md` now documents the two new
fields as "optional but recommended".

**Why it matters:** Until the real Deepgram script emits these, the
`classifyEmptyStt` rule stays in its conservative path — a broken STT that
returns empty text is indistinguishable from silent audio, so no CFR fires.
Emitting the fields flips on the "empty-result" symptom that the whole CFR
loop depends on.

**Suggested patch:** Deepgram's Nova-2 response already contains
`results.channels[0].alternatives[0].confidence` and `metadata.duration`
(seconds) — multiply by 1000 for ms. Example:

```bash
jq -c '{
  text: .results.channels[0].alternatives[0].transcript,
  language: .results.channels[0].detected_language,
  confidence: .results.channels[0].alternatives[0].confidence,
  duration_ms: (.metadata.duration * 1000 | floor)
}'
```

---

## FU2 — Per-status-emit elapsed time is always "20" in the copy call

**Context:** `defaultCopy.status(failure, elapsedSec)` currently ignores
`elapsedSec` and returns a fixed string. The signature kept the parameter
because a future iteration may want "still fixing — third attempt" or
"still fixing — 90s in". The timer in `recovery-orchestrator.ts` hardcodes
`20` as the elapsed value. Low-priority — product copy choice.

**Suggested resolution:** Either drop `elapsedSec` from the `ResilienceCopy`
contract (YAGNI) or wire a second timer at 60s for a "still at it" message.
Defer until we have real user-feedback data on whether one status message
is enough.

---

## FU3 — `isSurrendered` cooldown-hit path does not persist a `capability_surrender` event

**Context:** When `handle()` hits the cross-conversation surrender cooldown
(lines 103–108 of `recovery-orchestrator.ts`), it emits ack kind `"surrender"`
but the `app.ts` callback writes a surrender event for *every* surrender ack.
That means cooldown-hit turns also get a `capability_surrender` marker — which
is technically correct (the orphan watchdog should not re-drive a turn that
Nina's already bailed on for cooldown reasons) but is slightly noisier than
the design intent.

**Suggested resolution:** Consider differentiating "new surrender" vs
"cooldown-hit surrender" with a separate ack kind, and only persisting the
event for the former. Non-urgent — the current behavior is correct, just
noisy.

---

## FU5 — Dashboard WS ack has no frontend handler

**Context:** `AckDelivery.deliver()` broadcasts `{ type: "system_message", ... }` for dashboard-channel CFRs. This type is not in the `ServerMessage` union in `packages/dashboard/src/ws/protocol.ts`, and the Alpine client has no handler for it. The ack is broadcast to the correct sockets but silently ignored — the user sees nothing in the browser conversation UI.

**Impact:** WhatsApp channel delivery (the primary S7 E2E test case) works correctly. Dashboard-channel CFR acks are invisible to browser users only.

**Suggested fix:** Add `"capability_ack"` (or reuse an existing variant like `conversation_updated` with a synthetic assistant turn) to the `ServerMessage` union, and add a `case` in `handleWebSocketMessage` that renders it as a system-styled turn. One-sprint scope — good candidate for M9.7 or the next dashboard-facing sprint.

---

## FU4 — Status timer duration (20s) is a single magic constant

**Context:** `STATUS_ACK_DELAY_MS` lives in `recovery-orchestrator.ts`
and is not configurable. The plan §8.1 locks it to 20s, so this is
intentional — but if real-world fix jobs trend long (Sonnet + Opus + reverify
can easily burn 40–60s), we may want to revisit.

**Suggested resolution:** Leave as-is for M9.6. Revisit after S7 E2E data
shows median fix-loop duration.
