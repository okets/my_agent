# Sprint M2-S4: Conversations — Review

> **Verdict:** PASS
> **Date:** 2026-02-16
> **Commit:** `3d1438d`

## Summary

Conversation persistence, sidebar, multi-tab sync, and session isolation. Conversations survive refresh and server restart. Multiple conversations with sidebar switching. Real-time sync across browser tabs.

## Tasks Completed

| Task | Status | Notes |
|------|--------|-------|
| T1: Transcript Storage + ConversationManager | Done | SQLite + JSONL, FTS, WAL mode |
| T2: Session Binding + History Injection | Done | LRU registry, context builder, history injection |
| T3: WebSocket Protocol + Handler Updates | Done | Full conversation protocol, ConnectionRegistry |
| T4: Frontend Sidebar + Conversation Switching | Done | Sidebar, new/switch, reset, autofocus |
| T5: Abbreviation + Idle Timer | Done | AbbreviationQueue, IdleTimerManager, graceful shutdown |
| T6: Integration + Verification | Done | Manual testing via Playwright + real browsers |

## Files Created (11)

- `packages/dashboard/src/conversations/types.ts`
- `packages/dashboard/src/conversations/transcript.ts`
- `packages/dashboard/src/conversations/db.ts`
- `packages/dashboard/src/conversations/manager.ts`
- `packages/dashboard/src/conversations/abbreviation.ts`
- `packages/dashboard/src/conversations/idle-timer.ts`
- `packages/dashboard/src/conversations/index.ts`
- `packages/dashboard/src/agent/session-registry.ts`
- `packages/dashboard/src/agent/context-builder.ts`
- `packages/dashboard/src/ws/connection-registry.ts`
- `packages/dashboard/tests/conversations.test.ts`

## Files Modified (8)

- `packages/dashboard/src/ws/protocol.ts` — conversation message types
- `packages/dashboard/src/ws/chat-handler.ts` — conversation lifecycle, multi-tab broadcast
- `packages/dashboard/src/agent/session-manager.ts` — history injection, always `continue: false`
- `packages/dashboard/src/agent/stream-processor.ts` — handle only `stream_event`, skip `assistant`
- `packages/dashboard/src/index.ts` — ConversationManager + AbbreviationQueue init, graceful shutdown
- `packages/dashboard/src/server.ts` — Fastify decorators for conversation state
- `packages/dashboard/public/index.html` — sidebar HTML, font stack fix
- `packages/dashboard/public/js/app.js` — conversation state, sidebar logic, UI fixes
- `packages/dashboard/public/css/app.css` — sidebar styles, removed emoji font interference
- `packages/core/src/auth.ts` — auto-detect token type by prefix

## Key Bugs Found & Fixed During Testing

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Empty assistant responses | Stream processor only handled `stream_event`, SDK also yields `assistant` messages | Rewrote processor to handle `stream_event` only, explicitly skip `assistant` |
| Doubled response text | SDK yields BOTH `stream_event` AND `assistant` for same content | Process only `stream_event`, skip `assistant` with `continue` |
| Auth failure with OAuth token | auth.json had `method: "api_key"` for `sk-ant-oat01-` token | Auto-detect token type by prefix in `resolveAuth()` |
| User message disappearing | `conversation_created` handler called `resetChatState()` | Removed reset — user message already added by `sendMessage()` |
| Cross-session context leak | SDK `continue: true` continues last subprocess globally | Always `continue: false`, accumulate turns in memory, inject full history |
| Numbers in emoji font | `font-variant-emoji: emoji` + Noto Color Emoji in `*` selector | Removed both from CSS |
| Double chat bubbles during streaming | Typing dots and streaming bubble both visible | Show dots until first `text_delta`, then swap to streaming bubble |
| New Chat didn't reset | Only sent WS message, didn't clear local state | Added `resetChatState()` + null conversationId + autofocus |
| Sidebar not synced across tabs | `conversation_created` only sent to creating socket | Added `broadcastToAll()` to ConnectionRegistry |

## Architecture Decisions

1. **No SDK `continue: true`**: The SDK's continue flag resumes the last subprocess globally, not per conversation. Abandoned it entirely — each query is independent with full history injected into the system prompt.

2. **Stream event filtering**: The Agent SDK yields both `stream_event` (raw SSE) and `assistant` (partial BetaMessage) simultaneously. Must process only one type to avoid doubled content.

3. **Auth auto-detection**: Token prefix (`sk-ant-oat01-` = OAuth, else API key) determines env var, regardless of stored `method` field.

## User Stories for Testing

1. **Persistence**: Send a message, refresh page — conversation loads with all messages.
2. **New conversation**: Click "New Chat" — empty chat, cursor in input box, old conversation in sidebar.
3. **Switch**: Click a conversation in sidebar — loads its messages, agent has context.
4. **Session isolation**: Open two conversations, ask "capitalize my last message" in each — each uses only its own history.
5. **Multi-tab**: Open dashboard in two browser tabs. Send message in one — appears in both. Create new conversation in one — appears in other's sidebar.
6. **Numbers**: Type a message with numbers (e.g. "I have 42 items") — numbers render in normal font, same weight/size/baseline as text.
7. **Emojis**: Messages with emojis render correctly in real browsers (Playwright headless lacks emoji fonts — expected).
