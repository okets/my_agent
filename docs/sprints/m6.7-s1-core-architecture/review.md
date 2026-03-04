# M6.7-S1: Core Architecture — Sprint Review

> **Date:** 2026-03-04
> **Verdict:** PASS
> **Milestone:** M6.7 (Two-Agent Refactor)

---

## Goal

Replace the two-branch `buildQuery()` in SessionManager with a single path that always passes both `resume` + `systemPrompt`, powered by a new SystemPromptBuilder that assembles a 6-layer prompt with caching annotations.

## Delivered

### Task 1: Documentation Updates
- Rewrote `docs/design/conversation-system.md` — current/inactive lifecycle model, resume+systemPrompt mechanics, channel routing, MCP tools, key flows
- Updated `docs/design/channels.md` — asymmetric channel switching (Web→WhatsApp = new, WhatsApp→Web = continues), per-contact scoping for Working Agents only, email as task submission
- Updated `docs/ROADMAP.md` — design specs table (conversation-system.md marked revised)

### Task 2: SystemPromptBuilder
- New module: `packages/dashboard/src/agent/system-prompt-builder.ts`
- 6-layer architecture: identity + skills (cached) → state → memory → metadata → session (rebuilt per query)
- `cache_control: { type: "ephemeral" }` on stable layers (reserved for future SDK support — SDK currently serializes to string)
- Calendar context integration with graceful degradation
- 7 tests passing (including calendar branch coverage)

### Task 3: Unified buildQuery
- `session-manager.ts` — single code path, always passes `systemPrompt` + optional `resume`
- `session-registry.ts` — simplified, no context injection, no ConversationManager dependency
- `context-builder.ts` — deleted (cold-start injection no longer needed)
- `chat-handler.ts` — 5 call sites updated to new `(conversationId, "web", sdkSessionId)` API
- `message-handler.ts` — 1 call site updated to pass real `channelId`
- `brain.ts` — `BrainSessionOptions.systemPrompt` accepts `string | SystemPromptBlock[]`
- `SystemPromptBlock` exported from `@my-agent/core` public API
- `conversations.test.ts` — updated for new SessionRegistry API

## Scope Changes

**Moved to S2:** Conversation status model (current/inactive) and ConversationRouter were originally in S1 scope per ROADMAP. The implementation plan already placed them in Tasks 4-5 (S2 scope), which is the correct sequencing — they depend on the session architecture being in place first.

## Test Results

| Suite | Result |
|-------|--------|
| system-prompt-builder.test.ts | 7/7 pass |
| conversations.test.ts | 66/67 pass (1 pre-existing: DB file naming assertion) |
| step-executor.test.ts | Skipped (pre-existing: missing module import) |
| tsc --noEmit (core) | Clean |
| tsc --noEmit (dashboard) | Clean |
| prettier (src/) | Clean |

## Code Review Findings (addressed)

| Issue | Severity | Resolution |
|-------|----------|------------|
| cache_control silently dropped in serialization | Critical | Documented as reserved for future SDK support; added comments in brain.ts and SystemPromptBlock |
| Constructor args still optional | Important | Made `conversationId` and `channel` required |
| messageIndex double-incremented on fallback | Important | Moved increment to streamMessage, before buildQuery |
| SystemPromptBlock not exported from lib.ts | Important | Added to core public API |
| Mock incomplete (missing createCalDAVClient) | Important | Added all 5 stubs + calendar branch test |

## E2E Test Scenarios (for S4)

Added to `docs/sprints/m6.7-s4-e2e-scenarios.md`:
1. Session resume with fresh system prompt
2. Resume fallback on stale session
3. /new creates fresh conversation
4. System prompt contains expected layers

## Architecture Notes

- The SDK does not accept content block arrays for `systemPrompt` — blocks are serialized to a joined string in `createBrainQuery`. The `cache_control` field on `SystemPromptBlock` is reserved for future SDK support.
- The `agentDir` derivation from `brainDir` (`brainDir.replace(/\/brain$/, "")`) is fragile but pre-existing. Noted for future cleanup when `BrainConfig` is extended.
- The 2 pre-existing test failures should be tracked separately.

## Files Changed

| File | Change |
|------|--------|
| `docs/design/conversation-system.md` | Full rewrite |
| `docs/design/channels.md` | Updated continuity + routing sections |
| `docs/ROADMAP.md` | Design specs table update, S4 scope clarification |
| `docs/sprints/m6.7-s1-core-architecture/plan.md` | Created |
| `docs/sprints/m6.7-s4-e2e-scenarios.md` | Created |
| `packages/dashboard/src/agent/system-prompt-builder.ts` | Created |
| `packages/dashboard/tests/system-prompt-builder.test.ts` | Created |
| `packages/dashboard/src/agent/session-manager.ts` | Rewritten (single buildQuery) |
| `packages/dashboard/src/agent/session-registry.ts` | Simplified |
| `packages/dashboard/src/agent/context-builder.ts` | Deleted |
| `packages/dashboard/src/ws/chat-handler.ts` | 5 call sites updated |
| `packages/dashboard/src/channels/message-handler.ts` | 1 call site updated |
| `packages/dashboard/tests/conversations.test.ts` | Updated for new API |
| `packages/core/src/brain.ts` | SystemPromptBlock type, systemPrompt accepts blocks |
| `packages/core/src/lib.ts` | Export SystemPromptBlock |
