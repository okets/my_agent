# M9.4-S1 Code Review

> **Sprint:** M9.4-S1 Real-Time Notification Delivery
> **Reviewer:** External (Opus)
> **Date:** 2026-04-08
> **Branch:** `sprint/m9.4-s1-notification-delivery` (9 commits, base `172ee6c`)

---

## Verdict: APPROVE with minor issues

The implementation is solid, well-structured, and faithfully follows the design spec. All 23 tests pass, TypeScript compiles clean, and the core architectural goal -- routing system-initiated messages through `app.chat` so they broadcast to WebSocket clients -- is achieved cleanly.

---

## What Was Done Well

1. **Clean separation of concerns.** `sendSystemMessage()` is a focused, single-purpose async generator that handles exactly one job: inject prompt, stream response, save turn, emit event. No scope creep.

2. **Interface-based decoupling.** `ChatServiceLike` and `TransportManagerLike` give `ConversationInitiator` clean dependency boundaries. The adapter pattern in `app.ts` (lines 807-816) keeps the wiring contained.

3. **Correct busy-session handling.** `sendSystemMessage()` checks `isStreaming()` and exits early with zero events. Callers get a clean signal (empty generator) instead of a thrown error.

4. **Design decision well-documented.** DECISIONS.md explains the `externalParty` vs `channel` column choice with rationale and impact assessment.

5. **Heartbeat simplification is significant.** The old attempt-counting and escalation logic was removed cleanly. The new `deliverPendingNotifications()` is straightforward and correct.

6. **Mock infrastructure extended properly.** `MockSessionManager.injectSystemTurn()` was added to `mock-session.ts`, enabling E2E tests without API calls.

---

## Issues

### Important (should fix)

**I1: `(ci as any).trySendViaChannel(response)` in app.ts line 756**

The ResponseWatchdog `injectRecovery` callback accesses `trySendViaChannel()` via an `as any` cast because it is a private method on `ConversationInitiator`. This bypasses TypeScript's type safety.

Two options:
- (a) Make `trySendViaChannel()` a package-internal method (remove `private`, or mark it with a `/** @internal */` convention).
- (b) Add a public `forwardToChannel(content: string): Promise<void>` method on `ConversationInitiator` that wraps the private call.

Option (b) is cleaner and keeps the public API intentional.

**I2: No test for "same channel continuation" path in alert()**

The spec (Section 6.1) lists: "alert() continues conversation when same channel." This path -- where `outboundChannel` is WhatsApp and the current conversation is already on WhatsApp -- is not tested. The code path at lines 140-155 of `conversation-initiator.ts` (the `else` branch of `needsNewConversation`) is untested. This is the path that calls `trySendViaChannel()` after `sendSystemMessage()`, and a bug there would silently drop WhatsApp delivery.

### Suggestions (nice to have)

**S1: Duplicate stream-consuming pattern**

The pattern `for await (const event of this.chatService.sendSystemMessage(...)) { if (event.type === "text_delta"...) response += event.text }` appears 4 times in `conversation-initiator.ts` (lines 107-113, 121-128, 143-152) and once in `app.ts` (lines 742-750). Consider extracting a `consumeSystemMessage()` helper that returns the accumulated response string.

**S2: `getLastWebMessageAge()` searches 50 turns but could use SQL**

The current implementation fetches 50 recent turns in-memory and filters for web user turns. Since the conversations DB already tracks `last_user_message_at` at the conversation level, and the spec originally proposed a `getLastWebMessageAge()` query in `db.ts`, a SQL query filtering turns by channel would be more efficient and avoid the 50-turn search depth limit. Not a problem now (50 is generous), but worth noting for future scale.

**S3: E2E test calls sendSystemMessage directly, not alert()**

The E2E smoke test validates the sendSystemMessage pipeline but does not exercise the full alert() -> sendSystemMessage() -> turn saved -> event emitted path. An integration test that creates a `ConversationInitiator` with the real `AppHarness.chat` as the `chatService` and calls `alert()` would increase confidence.

---

## Spec Compliance Check

### Section 5.1: alert() uses app.chat
**COMPLIANT.** `alert()` calls `this.chatService.sendSystemMessage()` (lines 107, 121, 143). No direct session management.

### Section 5.2: getLastWebMessageAge()
**COMPLIANT with deviation.** Implemented as a private method on `ConversationInitiator` instead of a query on `conversations/db.ts` as the spec proposed. The approach works correctly -- it searches recent turns for web user messages and computes age. The deviation is justified: keeps the web-recency logic co-located with its only consumer.

### Section 5.3: initiate() uses app.chat
**COMPLIANT.** `initiate()` calls `this.chatService.sendSystemMessage()` (line 181). Creates conversation via `conversationManager.create()`, then invokes brain through the chat service.

### Section 5.4: ResponseWatchdog uses app.chat
**COMPLIANT.** `injectRecovery` in `app.ts` (line 742) calls `app.chat.sendSystemMessage()`. No direct `sessionManager.injectSystemTurn()` or manual `appendTurn()`.

### Section 5.5: getActiveConversation() deprecated
**COMPLIANT.** Removed from both `db.ts` and `manager.ts`. No remaining callers in `src/`. The only references are in test file descriptions (describing the migration from the old API).

### Section 5.6: Heartbeat simplification
**COMPLIANT.** `deliverPendingNotifications()` is simplified to: call `alert()`, mark delivered, fall back to `initiate()` only when no conversation exists. `MAX_DELIVERY_ATTEMPTS` constant removed. `incrementAttempts()` retained only for error recovery.

---

## Deviations from Plan

| Deviation | Justified? | Notes |
|-----------|------------|-------|
| `getLastWebMessageAge()` on ConversationInitiator instead of db.ts | Yes | Co-locates logic with its only consumer |
| Channel-switch detection uses `externalParty` instead of `channel` | Yes | Documented in DECISIONS.md; `channel` column is unreliable |
| Tasks 2-4 squashed into one commit | Neutral | Slightly less granular than plan, but the commit message is clear |
| `sendSystemMessage` is a standalone function + thin class wrapper | Yes | Good: testable without App instantiation |

---

## Regression Risk Assessment

| Area | Risk | Mitigation |
|------|------|------------|
| Existing sendMessage() flow | Low | No changes to sendMessage; sendSystemMessage is additive |
| WhatsApp delivery | Low | trySendViaChannel() is unchanged from original |
| Heartbeat notification delivery | Low | Simplified but same external interface; test coverage adequate |
| ResponseWatchdog recovery | Medium | `as any` cast is fragile; method rename or removal would silently break |
| Conversation creation via initiate() | Low | Uses established conversationManager.create() |

---

## Files Reviewed

- `/home/nina/my_agent/packages/dashboard/src/chat/send-system-message.ts` (new)
- `/home/nina/my_agent/packages/dashboard/src/chat/types.ts` (modified)
- `/home/nina/my_agent/packages/dashboard/src/chat/chat-service.ts` (modified)
- `/home/nina/my_agent/packages/dashboard/src/chat/index.ts` (modified)
- `/home/nina/my_agent/packages/dashboard/src/agent/conversation-initiator.ts` (rewritten)
- `/home/nina/my_agent/packages/dashboard/src/app.ts` (modified)
- `/home/nina/my_agent/packages/dashboard/src/automations/heartbeat-service.ts` (simplified)
- `/home/nina/my_agent/packages/dashboard/src/conversations/db.ts` (method removed)
- `/home/nina/my_agent/packages/dashboard/src/conversations/manager.ts` (method removed)
- `/home/nina/my_agent/packages/dashboard/tests/conversation-initiator.test.ts` (rewritten)
- `/home/nina/my_agent/packages/dashboard/tests/unit/chat/send-system-message.test.ts` (new)
- `/home/nina/my_agent/packages/dashboard/tests/integration/notification-delivery.test.ts` (new)
- `/home/nina/my_agent/packages/dashboard/tests/integration/mock-session.ts` (modified)
- `/home/nina/my_agent/docs/sprints/m9.4-s1-notification-delivery/DECISIONS.md`
- `/home/nina/my_agent/docs/sprints/m9.4-s1-notification-delivery/plan.md`
- `/home/nina/my_agent/docs/superpowers/specs/2026-04-08-conversation-ux-ui-design.md` (Sections 5-7)
