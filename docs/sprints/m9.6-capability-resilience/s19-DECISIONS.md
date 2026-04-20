---
sprint: M9.6-S19
---

# S19 Decisions

## D1: Coalescer placement

**Decision:** `ConversationAckCoalescer` is instantiated as a private field inside `AckDelivery` rather than as a separate injectable service.

**Options considered:**
- (a) Private field in AckDelivery — simpler, no new constructor param, coalescer lifecycle tied to delivery
- (b) Separate injectable — more testable in isolation, but adds DI complexity with no spec requirement

**Chosen:** (a). The coalescer has no state that needs to survive `AckDelivery` re-instantiation, and the spec doesn't require it to be separately testable. Unit tests access it via `AckDelivery`'s public methods.

## D2: System-origin ring buffer storage

**Decision:** In-memory ring buffer (max 100 events) stored as `private systemEventLog: SystemCfrEvent[]` on `AckDelivery`.

**Options considered:**
- (a) In-memory — lost on restart; simplest; no persistence requirement in spec
- (b) Append-only log file — survives restart; adds file I/O complexity

**Chosen:** (a). Spec requires a ring buffer for health panel display. Cross-restart persistence is not a spec requirement, and S20 exit-gate tests don't test persistence. A log file would add failure modes (disk full, permissions) for no specified benefit.

## D3: `failure_type` write-callsite discovery

**Hypothesis (plan v0):** `message-handler.ts` would set `failure_type` when sending text fallback after TTS failure.

**Grep-discovered reality:** `appendTurn` is NOT called in `message-handler.ts` (zero grep hits). The actual callsite is `chat-service.ts` — the assistant-turn `appendTurn()` call at line ~931, after the streaming loop completes.

**Implementation (Task 5.5):** Added local `ttsFailed = false` flag before the streaming loop. In the `done` event case, `synthesizeAudio()` return value sets the flag. After the loop, `failure_type: ttsFailed ? "text-to-audio" : undefined` is included in the `appendTurn` payload.

**Why plan v0 was wrong:** S18's duplicate-path collapse moved synthesis responsibility fully into `chat-service.ts`. The `appendTurn` call in `chat-service.ts` is the single authoritative write-point for all assistant turn fields. `message-handler.ts` is a dispatch layer that doesn't touch turn persistence. The plan text predated S18's path collapse.

## D4: Fixed-outcome bug root cause

**Bug (S12 inherited):** Automation branch always set `outcome = "surrendered"` — a hardcoded string that ignored whether the CFR actually fixed the capability.

**Fix:** `const outcome = context?.kind === "terminal-fixed" ? "fixed" : "surrendered"` — derives outcome from the CFR context that is already available at the callsite.

**Why it was missed in S12:** The S12 automation fan-out task focused on wiring the notifier interface; the hardcoded string was left from a stub. Not caught because S12 tests didn't assert the `outcome` field value.
