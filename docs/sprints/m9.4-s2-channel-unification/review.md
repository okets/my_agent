# M9.4-S2 External Review + HITL Results

**Sprint:** Channel Message Unification
**Date:** 2026-04-10
**Commits:** 24 (10 planned tasks + 14 HITL bug fixes)

## Verdict: PASS

---

## What Was Built

Channel messages (WhatsApp) now route through `app.chat.sendMessage()` — the same pipeline as dashboard messages. STT unified into the application layer (transports pass raw audio). New `injectTurn()` for admin/scheduler transcript writes. S1 architect review items fixed.

## Spec Coverage

| Spec Section | Status | Evidence |
|---|---|---|
| 8.1 Scope | Done | All 4 deliverables implemented |
| 8.2 Architecture | Done | Message handler delegates brain to app.chat, keeps channel I/O |
| 8.3 ChatMessageOptions | Done | `channel`, `source`, `detectedLanguage` on types + sendMessage |
| 8.4 injectTurn() | Done | 3 unit tests passing |
| 8.5 STT Unification | Done | WhatsApp passes raw audio, sendMessage transcribes |
| 8.6 S1 Corrections | Done | forwardToChannel public, (ci as any) removed, tests strengthened |
| 8.7 Admin/Scheduler | Done | Both route through injectTurn() with fallback |
| 8.8 Validation Tests | Done | 8 spec tests + 3 injectTurn tests, all passing |

## Test Results

- **1019 tests pass**, 6 pre-existing failures (not regressions)
- **11 new tests** added, all passing
- Type checks clean for both `packages/core` and `packages/dashboard`
- Full details in `test-report.md`

## HITL Verification (Spec 8.9)

| Step | Description | Result |
|---|---|---|
| 8.9-1 | Full test suite, no regressions | PASS |
| 8.9-2 | All new unit tests pass | PASS |
| 8.9-3 | Headless App integration | PASS |
| 8.9-4 | Channel message through app.chat | PASS |
| 8.9-5 | Build clean | PASS |
| 8.9-6 | Dashboard restart, no errors | PASS |
| 8.9-7 | Dashboard voice round-trip (EN + HE) | PASS — transcription + TTS both work |
| 8.9-8 | WhatsApp voice round-trip | PASS — voice reply received, transcription in dashboard |
| 8.9-9 | Text on both channels | PASS — both route through app.chat, channel badges correct |

## Bugs Found During HITL (All Fixed)

### B1: WS broadcasts missing for channel messages
Message handler delegated to `sendMessage()` but didn't forward streaming events to WS clients. Dashboard showed nothing for WhatsApp messages.
**Fix:** `conversation_ready` event — broadcast after all turns saved, frontend loads complete conversation.

### B2: Channel-switch detection missed web→WhatsApp
`getByExternalParty()` found old pinned WhatsApp conversation. Channel-switch only compared last turn's channel within that conversation, not against the current (web) conversation.
**Fix:** Also check if current conversation differs from found conversation — if so, it's a channel switch.

### B3: Dashboard didn't auto-switch to new channel conversations
`conversation_created` broadcast arrived but frontend never loaded the new conversation's turns. Multiple approaches tried (switchAllToConversation, broadcastToAll) before settling on `conversation_ready`.
**Fix:** New `conversation_ready` WS message type. Sent after channel message fully processed. Frontend sends `switch_conversation` to load complete turns.

### B4: Duplicate user messages in web UI
The `conversation_updated` handler for user turns only matched local attachments/voice placeholders. Plain text messages from the same tab had no match, so they were added as duplicates.
**Fix:** Also match by content equality for dedup.

### B5: State broadcast race
`state:conversations` broadcast from StatePublisher triggered premature conversation load with empty turns before `conversation_ready` arrived.
**Fix:** `conversation_ready` always reloads regardless of current conversation ID.

## Pre-existing Issues (Not S2)

- **TTS escaping bug:** Quotes in response text break the Edge TTS Python command. Causes text fallback instead of voice reply when response contains quotes. Not introduced by S2.
- **Baileys fetchProps 400:** Non-fatal error on every connect from Baileys 7.0.0-rc.9. Added to pre-release checklist.
- **6 pre-existing test failures:** `conversation-initiator-routing.test.ts` (5) and `source-channel.test.ts` (1). Confirmed on master.

## Decisions

4 decisions made during execution, all minor. See `DECISIONS.md`.

## Architecture Note

Channel messages do NOT stream live to the dashboard. The `conversation_ready` model loads the complete conversation after processing. Live streaming for channel messages is deferred — it requires rethinking the WS subscription model (per-socket conversation binding vs. global event bus).
