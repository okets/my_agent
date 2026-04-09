# M9.4-S1 Test Report

> **Sprint:** M9.4-S1 Real-Time Notification Delivery
> **Reviewer:** External (Opus)
> **Date:** 2026-04-08
> **Branch:** `sprint/m9.4-s1-notification-delivery`

---

## Test Execution Summary

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| Unit: sendSystemMessage | `tests/unit/chat/send-system-message.test.ts` | 6 | PASS |
| Unit: ConversationInitiator | `tests/conversation-initiator.test.ts` | 15 | PASS |
| E2E: Notification delivery | `tests/integration/notification-delivery.test.ts` | 2 | PASS |
| **Total** | | **23** | **ALL PASS** |

TypeScript type check: **PASS** (zero errors)

---

## Spec Section 6.1 — Unit Test Coverage

| Spec Requirement | Covered? | Test Location |
|------------------|----------|---------------|
| alert() finds current via getCurrent() (no threshold) | Yes | `conversation-initiator.test.ts` lines 192-208 |
| alert() delivers via web when last web message < 15 min | Yes | `conversation-initiator.test.ts` lines 192-208 |
| alert() delivers via WhatsApp when last web message > 15 min | Yes | `conversation-initiator.test.ts` lines 269-312 |
| alert() starts new conversation on channel switch | Partial | Lines 269-289 assert chatService.calls >= 1, but does not explicitly verify a new conversation was created |
| alert() continues conversation when same channel | Not explicitly tested | No test where outbound=whatsapp AND current is already on whatsapp |
| initiate() creates conversation and routes through app.chat | Yes | `conversation-initiator.test.ts` lines 316-331 |
| ResponseWatchdog routes through app.chat | Yes (implicitly) | Verified via app.ts code review; no dedicated unit test |
| getLastWebMessageAge() returns correct age | Implicit | Tested through alert() behavior tests |
| getLastWebMessageAge() returns null for no web messages | Yes | `conversation-initiator.test.ts` lines 292-312 |

### Additional Tests Beyond Spec

| Test | Location |
|------|----------|
| alert() returns false when no conversation exists | Lines 230-242 |
| Dashboard-sourced alerts never route to WhatsApp | Lines 244-267 |
| initiate() sends via preferred channel when connected | Lines 333-346 |
| initiate() demotes existing current conversation | Lines 348-364 |
| Daily brief integration flow | Lines 367-383 |
| sendSystemMessage skips when session busy | Unit + E2E tests |
| sendSystemMessage persists SDK session ID | Unit test line 90 |
| sendSystemMessage does not save turn on empty response | Unit test line 84 |

---

## Spec Section 6.2 — E2E Smoke Test

| Step | Spec Requirement | Covered? |
|------|------------------|----------|
| 1 | Start headless App | Yes (AppHarness.create) |
| 2 | Create conversation (becomes current) | Yes |
| 3 | Send user message (establishes web recency) | Yes |
| 4 | Call alert() with test prompt | Adapted: calls sendSystemMessage() directly |
| 5 | Assert: app.chat events emitted (text_delta, done) | Yes |
| 6 | Assert: conversation has new assistant turn | Yes |
| 7 | Assert: StatePublisher broadcast triggered | Adapted: asserts chat:done App event emitted |

Note: The E2E test calls `sendSystemMessage()` directly rather than going through `alert()`. This tests the core pipeline but not the alert-to-sendSystemMessage routing. The unit tests cover that routing.

---

## Test Gaps

1. **No test for "same channel continuation"** — alert() when outbound is WhatsApp and current conversation is already on WhatsApp (should continue, not create new). The spec lists this case in 6.1.

2. **No dedicated ResponseWatchdog test** — The spec lists "ResponseWatchdog routes through app.chat" as a unit test case. The wiring is verified by code review (app.ts line 742), but no test exercises it.

3. **E2E uses sendSystemMessage directly** — Does not exercise alert() end-to-end through the full heartbeat path.
