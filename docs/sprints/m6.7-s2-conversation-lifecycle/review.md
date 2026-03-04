# M6.7-S2: Conversation Lifecycle — Sprint Review

> **Date:** 2026-03-04
> **Verdict:** PASS
> **Milestone:** M6.7 (Two-Agent Refactor)

---

## Goal

Add current/inactive conversation status model, ConversationRouter for owner/external routing with channel-switch detection, and wire both into chat-handler and message-handler.

## Delivered

### Task 1: Conversation Status Model
- Added `status: "current" | "inactive"` to Conversation type
- DB migration with `ALTER TABLE` + status column, marks most recent as current
- `makeCurrent()` with SQLite transaction for atomic swap
- `getCurrent()` method returns the one current conversation
- `create()` auto-demotes current before inserting new
- 5 tests passing

### Task 2: ConversationRouter
- New module: `packages/dashboard/src/agent/conversation-router.ts`
- `RouteResult` interface: target (conversation-nina | working-agent), newConversation flag, channel
- Owner vs external routing with case-insensitive identity matching
- Channel-switch detection: Web→WhatsApp = new conversation, WhatsApp→Web = NOT new
- 12 tests passing

### Task 3: Wire into Handlers
- `protocol.ts` — added `status` to `ConversationMeta`
- `chat-handler.ts` — `handleConnect()` uses `getCurrent()` instead of `getMostRecent("web")`
- `chat-handler.ts` — `handleSwitchConversation()` calls `makeCurrent()` for status swap
- `message-handler.ts` — optional `ConversationRouter` in deps, `forceNewConversation` flag for channel-switch detection
- `state-publisher.ts` — `status` added to both state sync broadcast paths
- `toConversationMeta()` includes `status: conv.status`

### Task 4: E2E Scenarios
- Added Scenarios 5-8 to `docs/sprints/m6.7-s4-e2e-scenarios.md`
- Covers: only-one-current, connect-loads-current, web→whatsapp switch, whatsapp→web continuity

## Test Results

| Suite | Result |
|-------|--------|
| conversation-status.test.ts | 5/5 pass |
| conversation-router.test.ts | 12/12 pass |
| conversations.test.ts | 59/60 pass (1 pre-existing: DB file naming assertion) |
| tsc --noEmit (dashboard) | Clean |

## Code Review Findings

| Issue | Severity | Resolution |
|-------|----------|------------|
| ConversationRouter optional in message-handler deps — silent if missing | Important | Intentional: full router integration deferred to M6.6. Channel-switch detection is additive. |
| makeCurrent() doesn't validate ID exists | Suggestion | All callers validate first; deferred |
| status field required vs isPinned optional inconsistency | Suggestion | Correct: migration ensures all rows have status |

## Files Changed

| File | Change |
|------|--------|
| `packages/dashboard/src/conversations/types.ts` | Added `status` field |
| `packages/dashboard/src/conversations/db.ts` | Migration + makeCurrent + getCurrent |
| `packages/dashboard/src/conversations/manager.ts` | makeCurrent + getCurrent + create demotes |
| `packages/dashboard/tests/conversation-status.test.ts` | Created (5 tests) |
| `packages/dashboard/src/agent/conversation-router.ts` | Created |
| `packages/dashboard/tests/conversation-router.test.ts` | Created (12 tests) |
| `packages/dashboard/src/ws/protocol.ts` | Added status to ConversationMeta |
| `packages/dashboard/src/ws/chat-handler.ts` | getCurrent, makeCurrent, status in meta |
| `packages/dashboard/src/channels/message-handler.ts` | ConversationRouter integration |
| `packages/dashboard/src/state/state-publisher.ts` | Status in state sync payloads |
| `docs/sprints/m6.7-s4-e2e-scenarios.md` | Added Scenarios 5-8 |
| `docs/sprints/m6.7-s2-conversation-lifecycle/plan.md` | Created |
| `docs/sprints/m6.7-s2-conversation-lifecycle/review.md` | This file |

## Commits

| Hash | Message |
|------|---------|
| `3e72d5a` | feat(m6.7-s2): add conversation status model (current/inactive) |
| `2626898` | feat(m6.7-s2): add ConversationRouter |
| `31d0056` | feat(m6.7-s2): wire conversation status + router into handlers |
| `d5c65b1` | docs: add S2 E2E scenarios to S4 accumulation file |
