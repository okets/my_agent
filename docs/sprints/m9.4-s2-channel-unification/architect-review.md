# M9.4-S2 CTO Architect Review

> **Reviewer:** CTO architect session (2026-04-10)
> **Verdict:** APPROVED
> **Sprint:** M9.4-S2 — Channel Message Unification
> **Spec:** [conversation-ux-ui-design.md](../../superpowers/specs/2026-04-08-conversation-ux-ui-design.md) (Section 8)
> **Prior review:** Opus agent review (same file, overwritten) — PASS WITH CONCERNS, I1+I2 fixed in `de6721d`

---

## Spec Compliance

All spec sections delivered:

| Section | Requirement | Status |
|---------|-------------|--------|
| 8.1 | Scope: channel messages through app.chat, STT unification, injectTurn, S1 corrections | Done |
| 8.2 | Message-handler keeps channel I/O, delegates brain to app.chat | Done |
| 8.3 | `ChatMessageOptions` with channel + source fields | Done |
| 8.4 | `injectTurn()` for admin/scheduler | Done |
| 8.5 | STT in sendMessage() only — WhatsApp passes raw audio | Done |
| 8.6 | S1 corrections: `forwardToChannel` public, `as any` removed, tests strengthened | Done |
| 8.7 | Risk mitigations: channel stamping, source field, setChannel, naming skip | Done |
| 8.8 | 12 validation tests | 11 passing (see below) |
| 8.9 | 9-step verification including HITL | All 9 pass |

## What I Like

**The STT unification is clean.** One `transcribeAudio()` in chat-service, `onAudioMessage` callback gone, WhatsApp plugin just downloads and passes buffer. This is the right boundary — transports handle transport, application handles application logic.

**`injectTurn()` is minimal and correct.** Write + emit, no brain. Admin and scheduler have fallbacks for when app isn't available. Good.

**S1 corrections all addressed.** `forwardToChannel` public, no more `as any`, channel-switch test checks conversation count + ID difference.

**HITL was thorough.** Voice round-trips on both channels, text on both channels, all passing. 5 bugs found and fixed during HITL — this is exactly what HITL is for.

## Issues

### I1: 5 broken tests in conversation-initiator-routing.test.ts

The review calls these "pre-existing on master" which is technically true — they broke when S1 merged to master. The test mocks `SessionFactory` with `injectSystemTurn()`/`streamNewConversation()` but S1 changed ConversationInitiator to use `ChatServiceLike` with `sendSystemMessage()`. The test was never updated.

These test a real scenario (reply routing — externalParty + channel on initiated conversations). The underlying behavior still works, but it's unverified since S1. This needs fixing.

**Action:** Fix in S3 or as a standalone commit. Update the mock from `SessionFactory` to `ChatServiceLike`. The 5 tests should then pass. Do NOT delete them — they cover real routing logic.

### I2: `conversation_ready` loads full conversation on every channel message

Every channel message broadcasts `conversation_ready` → every connected tab does a full switch + turn reload. This works but is wasteful when already viewing the correct conversation, and creates a UX gap (no streaming — user sees nothing for 10-30s until processing completes, then the whole conversation reloads).

The Opus agent review flagged this correctly. The `conversation_ready` model is the right call for now — live streaming for channel messages requires redesigning WS subscriptions. But the UX gap matters and should be addressed.

**Action:** Deferred. Note for S3 or later: when already viewing the conversation, skip full reload and rely on `conversation:updated` events. For the streaming gap, consider a lightweight "typing" indicator broadcast at message receipt (before brain processing starts).

### I3: Non-null assertions on non-optional `app` property

`message-handler.ts` uses `this.deps.app!.conversations` in 4 places. The `app` property is non-optional in the interface. The `!` assertions are noise — remove them.

**Action:** Minor cleanup, any time.

## The S1 Bug

The review mentions an S1 bug was fixed during S2. Commit `b4fd95c` references "M9.4-S4: brief delivery pipeline fix." This is a separate sprint for a truncated debrief delivery bug — not an S2 concern. The naming `S4` (skipping S3) is noted — the roadmap should reflect this if S3 is the progress card.

## Pre-existing Test Failures

6 tests failing on master:
- 5 in `conversation-initiator-routing.test.ts` — S1-induced, fix described in I1
- 1 in `source-channel.test.ts` — heartbeat behavior mismatch from S1 simplification

Both are test-mock mismatches from S1's architectural change, not implementation bugs. The underlying features work (validated by HITL). But 6 broken tests erode confidence. Fix before S3.

## Summary

S2 delivers everything the spec asked for. The `conversation_ready` pattern was a pragmatic discovery during HITL — real race conditions required it. STT unification is clean. Channel messages now go through `app.chat` for brain interaction while keeping transport-specific logic in the message-handler.

**Before S3:** Fix the 6 broken tests (I1 + source-channel). These are mock updates, not implementation changes.
