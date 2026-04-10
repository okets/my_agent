# M9.4-S2 Decisions Log

## D1: Remove sessionRegistry and postResponseHooks from MessageHandlerDeps

**Decision:** Remove both from the deps interface entirely rather than marking as deprecated optional unknown.

**Reasoning:** Both are now handled by `app.chat.sendMessage()`. Keeping them as deprecated stubs adds noise. Callers (app.ts, tests) were updated in the same commit to remove these parameters.

**Impact:** Minor — only affects ChannelMessageHandler construction in app.ts and 2 test files.

## D2: Keep deprecated deps briefly, then clean up in same commit

**Decision:** Initially the implementer kept `sessionRegistry` and `postResponseHooks` as `@deprecated` optional fields. Cleaned up immediately after in a follow-up within the same task.

**Reasoning:** Cleaner to remove in the same commit than leave dead code for a future cleanup that may never happen.

## D3: Concurrent test uses user turn numbers only

**Decision:** The "concurrent channel + web messages" test (8.8 Test 5) checks uniqueness of user turn numbers only, not all turn numbers.

**Reasoning:** User and assistant turns from a single `sendMessage()` call intentionally share the same turn number space. The real concern is that two parallel `sendMessage()` calls don't collide — which is verified by checking user turn numbers are distinct.

## D4: Voice note tests exercise path, don't verify actual transcription

**Decision:** STT-related tests (8.8 Tests 4, 7, 8) verify the code path doesn't crash when given fake audio data, rather than verifying actual transcription output.

**Reasoning:** The test environment doesn't have a real Deepgram capability configured. Testing actual STT requires HITL verification (8.9 steps 7-8). The automated tests verify the wiring is correct and the error handling is graceful.
