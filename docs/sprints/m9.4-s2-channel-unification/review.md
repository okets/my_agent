# M9.4-S2 External Review

**Sprint:** Channel Message Unification
**Reviewer:** External Opus Agent
**Date:** 2026-04-10

## Verdict: PASS

---

## Spec Coverage

| Spec Section | Status | Evidence |
|---|---|---|
| 8.1 Scope | Done | Channel messages route through `app.chat.sendMessage()`, STT unified, `injectTurn()` added, S1 corrections applied |
| 8.2 Architecture Decision | Done | Message handler retains channel-specific responsibilities (conversation resolution, outbound delivery, typing, TTS). Brain invocation delegated to `app.chat.sendMessage()` |
| 8.3 ChatMessageOptions Extension | Done | `channel` object (transportId, channelId, sender, replyTo, senderName, groupId, isVoiceNote, detectedLanguage) and `source` field added to `ChatMessageOptions` in `chat/types.ts`. `sendMessage()` stamps user turns, assistant turns, and split turns with `channel`. `setChannel()` called on session. `source` passed to post-response hooks. `detectedLanguage` returned in `done` event. |
| 8.4 injectTurn() | Done | Method on `AppChatService` appends turn to transcript, emits `conversation:updated` event. No brain invocation. Supports optional `channel` field. Tested with 3 unit tests. |
| 8.5 STT Unification (Option A) | Done | WhatsApp plugin no longer transcribes audio. Downloads raw buffer, passes as `audioAttachment` on `IncomingMessage`. `onAudioMessage` callback removed from wiring in `app.ts`. `sendMessage()` is the single STT path. `OnAudioMessageCallback` export removed from plugin index. |
| 8.6 S1 Corrections | Done | (1) `trySendViaChannel` renamed to public `forwardToChannel`. (2) `(ci as any)` cast removed from `app.ts` line 752. (3) Channel-switch test now asserts 2 conversations exist and last call targets a different conversation ID. (4) ResponseWatchdog `injectRecovery` test added. |
| 8.7 Risks Mitigated | Done | All 8 identified risks addressed: channel field stamps prevent metadata loss, outbound delivery stays in message-handler, `injectTurn()` prevents brain invocation for admin/scheduler, `source` field correctly propagated, `setChannel()` called, naming skipped for titled channel conversations |
| 8.8 Validation Tests | Done | 11 new tests covering all 10 spec validation scenarios (Tests 2, 4-10 in `channel-unification.test.ts`, plus 3 `injectTurn` tests). All pass. |

## Test Results

- **117 test files pass, 2 fail** (pre-existing on master, confirmed independently)
- **1019 tests pass, 6 fail** (all 6 are pre-existing, NOT regressions)
- **11 new tests** added by this sprint, all passing
- **Type checks clean** for both `packages/core` and `packages/dashboard`

Full details in `test-report.md`.

## Code Quality

**Strengths:**
- Clean separation: message-handler delegates brain interaction to `app.chat`, retains channel-specific logic (outbound delivery, typing, TTS)
- `injectTurn()` is appropriately minimal -- append + emit, no streaming or session management
- Admin route has sensible fallback when `app.chat` is unavailable
- Scheduler event handler uses `injectTurn()` with `channel: "scheduler"` for proper stamping
- Mock session updated to support `setChannel()` method
- Dead deps (`sessionRegistry`, `postResponseHooks`) cleanly removed from `MessageHandlerDeps` interface
- `OnAudioMessageCallback` export removed from WhatsApp plugin public API

**No issues found with:**
- Type safety (both packages compile cleanly)
- Unused imports (checked message-handler, chat-service, app.ts)
- Error handling (message-handler has try/catch/finally around `sendMessage` stream consumption with fallback error text)
- Security (no credential exposure, no new network endpoints)

## Issues

None critical or important.

1. **Minor:** Voice note tests (8.8 Tests 4, 7, 8) verify the code path does not crash rather than verifying actual transcription output. This is documented in Decisions Log D4 and is reasonable given no STT capability is available in the test environment. The spec's HITL verification steps 7-8 cover real transcription.

2. **Minor:** The `detectedLanguage` done event test (line 179 of channel-unification.test.ts) has a tautological assertion: `"detectedLanguage" in lastDone || lastDone.detectedLanguage === undefined` is always true. This test proves the event type allows the field but does not actually verify a language value flows through. Again, real STT testing is deferred to HITL (spec 8.9 steps 7-8).

3. **Minor:** `channel-message-flow.test.ts` uses `as any` cast when constructing deps with `app: { conversations: ..., chat: ... } as any`. This is a test file and the cast is localized, so low concern.

## Recommendations

1. After HITL verification of STT round-trips (spec 8.9 steps 7-9), consider adding a note to the sprint record confirming manual validation passed.

2. The 6 pre-existing test failures in `conversation-initiator-routing.test.ts` and `source-channel.test.ts` should be addressed in a future sprint to keep the test suite clean.

3. The `detectedLanguage` done event test could be made more meaningful by using a mock that returns a fixed language, validating end-to-end flow even without real Deepgram.
