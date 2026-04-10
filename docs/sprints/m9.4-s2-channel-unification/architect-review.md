# M9.4-S2 Architect Review

**Reviewer:** Opus Architect Agent
**Date:** 2026-04-10
**Branch:** `sprint/m9.4-s2-channel-unification` (24 commits)

## Verdict: PASS WITH CONCERNS

The architecture is sound and the implementation matches the design spec. The `conversation_ready` pattern is a pragmatic solution to real race conditions discovered during HITL testing. The channel-switch detection logic handles both directions (web-to-channel and channel-to-web). No critical issues found. Two important items warrant attention before or shortly after merge.

---

## Architecture Assessment

### conversation_ready Pattern: Sound

The decision to broadcast `conversation_ready` after all turns are saved (rather than streaming live to WS clients) is architecturally correct for the current system. The core problem -- WS clients are subscribed to a specific conversation and can't receive events from a conversation that doesn't exist yet or that they haven't subscribed to -- is real. Live streaming for channel messages would require either a global event bus or pre-subscription logic, both of which are bigger changes. The review correctly documents this as deferred work.

The frontend handler sends a `switch_conversation` message back to the server, which triggers a full turn reload. This is simple and reliable, trading real-time streaming for correctness.

### Channel-Switch Detection: Correct

Two-case detection in `handleOwnerMessage()`:
1. **Case 2 (web-to-channel):** Compares current conversation ID with the found externalParty conversation. If different, the user moved to web and now a channel message arrives. Forces new conversation.
2. **Case 1 (channel-to-channel):** Checks last turn's channel field within the same conversation. Forces new conversation if channel differs.

Both cases properly unpin the old conversation and broadcast `conversation_unpinned`. The ordering is correct -- Case 2 is checked first (cheaper check) before querying recent turns for Case 1.

### Responsibility Boundaries: Clean

The message-handler retains channel-specific concerns (conversation resolution, slash commands, typing, TTS, outbound delivery) and delegates brain invocation + STT to `app.chat.sendMessage()`. This matches the spec (Section 8.2) and avoids both over-centralizing and fragmenting logic.

### injectTurn(): Clean and Minimal

Correctly writes to transcript + emits `conversation:updated` without brain invocation. Both admin and scheduler consumers have fallback paths for when `app.chat` is unavailable. Good defensive pattern.

### STT Unification: Complete

WhatsApp plugin now passes raw `audioAttachment` (buffer + mimeType). No more `onAudioMessage` callback. The `chat-service.ts` `transcribeAudio()` method is the single STT path for both dashboard and channel voice messages. The `VOICE_MODE_HINT` is injected consistently regardless of source.

---

## Issues Found

### 1. [Important] Dedup by Content Equality Can Suppress Legitimate Duplicates

In `app.js`, the `conversation_updated` handler for user turns deduplicates by comparing `msg.content === data.turn.content`. This iterates all user messages in the current message list (newest first) and considers any content match as "already displayed."

**Scenario that breaks:** User sends "yes" twice in quick succession from the web. The second "yes" arrives via `conversation_updated` broadcast (from another tab or the save confirmation). The dedup logic matches it against the first "yes" and suppresses it. The second message exists in the DB but is invisible in the UI until refresh.

**Mitigation:** The dedup loop iterates recent messages only, and in practice users rarely send identical messages back-to-back. But it can happen with short confirmations ("ok", "yes", "no").

**Recommendation:** Add a `turnNumber` comparison alongside content matching. The server sends `turnNumber` in the `conversation_updated` turn payload. Check both content AND turnNumber to distinguish distinct messages with identical text.

### 2. [Important] Uncommitted Changes on Sprint Branch

Two files are modified but not committed:
- `packages/dashboard/public/js/app.js` -- two debug `console.log` statements added
- `docs/ROADMAP.md` -- Baileys update tracking entry

These should be committed or stashed before merge.

### 3. [Minor] Non-null Assertions on Non-optional Property

In `message-handler.ts`, lines 336, 347, 450, 456 use `this.deps.app!.conversations` with a non-null assertion (`!`). The `app` property is typed as non-optional `import("../app.js").App` in the `MessageHandlerDeps` interface. The assertions are unnecessary -- remove them for clarity, since the type system already guarantees non-null.

### 4. [Minor] conversation_ready Always Triggers Full Reload

Every channel message broadcasts `conversation_ready`, causing every connected WS client to send `switch_conversation` and reload all turns -- even if that client is already viewing the conversation. For conversations with many turns (hundreds), this is wasteful.

**Recommendation:** In the frontend handler, compare `data.conversationId === this.currentConversationId` and, if already viewing, send a lighter "refresh turns" request instead of a full switch. Or better: skip the reload entirely and rely on the individual `conversation_updated` events that `sendMessage()` already emits via `App.emit("conversation:updated")`.

### 5. [Minor] Debug Logging in Production Code

`message-handler.ts` has extensive `[E2E]` debug logging (lines 64-66, 84-89, 181-196, 222-226, 240-242, etc.). These are useful during development but verbose for production. Consider gating behind a debug flag or reducing to key events only.

---

## Risks

### R1: conversation_ready Flicker on Multi-Tab

When a channel message completes, `conversation_ready` is broadcast to ALL WS clients. Each client independently sends `switch_conversation`, which triggers a full conversation load. If the user has multiple tabs open on different conversations, all tabs will switch to the channel conversation. This is correct behavior per the CTO's mental model ("there is one current conversation"), but could feel jarring if a user has a tab open on an older conversation they're reading.

### R2: Turn Number Race with Concurrent Messages

The message handler reads `conversation.turnCount + 1` for the turn number, then passes it to `sendMessage()`. If two channel messages arrive near-simultaneously for the same conversation, both could read the same `turnCount` and produce colliding turn numbers. The concurrent test (8.8 Test 5) covers sequential sends but not truly parallel ones. SQLite's write lock likely serializes this in practice, but it's not guaranteed at the application layer.

### R3: Deferred Live Streaming Creates UX Gap

Channel messages show no activity in the dashboard until processing completes (could be 10-30 seconds for complex queries). The user sees nothing until `conversation_ready` fires. For long-running tool-use responses, this is a noticeable gap. The review correctly documents this as deferred work.

---

## Recommendations

1. **Before merge:** Commit the two uncommitted files (debug logs in app.js, Baileys tracking in ROADMAP.md).

2. **Before merge:** Fix the dedup logic to include turnNumber comparison (Issue 1). This is a 2-line change in `app.js` that prevents a real data loss scenario.

3. **Post-merge (S3 or later):** Optimize `conversation_ready` to skip full reload when already viewing the conversation (Issue 4). This is a performance improvement, not a correctness issue.

4. **Post-merge:** Remove `[E2E]` debug logging or gate behind a flag (Issue 5). Low priority.

5. **Post-merge:** Design live streaming for channel messages. The `conversation_ready` pattern is correct for now, but the UX gap (R3) will become more noticeable as channel usage increases.

---

## Test Assessment

- **1011 tests pass**, 6 pre-existing failures (confirmed on master: 5 in `conversation-initiator-routing.test.ts`, 1 in `source-channel.test.ts`). No new regressions.
- **11 new tests** cover: injectTurn (3), channel unification spec (8). Tests exercise the happy path, concurrent sends, channel metadata propagation, source field routing, and STT path (graceful degradation without real Deepgram).
- Tests are meaningful and well-structured. The concurrent test (8.8 Test 5) correctly validates turn number uniqueness across user turns only (per Decision D3).
- Voice note tests verify wiring without real transcription (per Decision D4) -- acceptable given HITL coverage.

## S1 Corrections Verified

- `forwardToChannel` is now public (no longer `private trySendViaChannel`)
- No `as any` casts remain in `app.ts` or `chat-service.ts`
- Channel-switch test assertion strengthened (checks conversation count and ID difference)
