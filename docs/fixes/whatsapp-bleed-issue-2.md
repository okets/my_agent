## WhatsApp Bleed Fix (Issue #2)

### Problem

Messages sent from the **dashboard web UI** leaked to WhatsApp. When a conversation had a WhatsApp channel binding, post-response hooks (visual augmentation charts, response watchdog recovery) forwarded their output to WhatsApp unconditionally — even when the triggering message came from the dashboard, not WhatsApp.

### Root Cause

`PostResponseHooks.run()` is called from two paths:
- **Dashboard path** (`chat-service.ts`) — user sends message via web UI
- **Channel path** (`message-handler.ts`) — user sends message via WhatsApp

Both paths fed into the same post-response hooks, which had two channel-forwarding points that didn't check where the message originated:

1. **Visual augmentation** (`visual-augmentation.ts`) — looks at recent turns to find `activeChannel`, then calls `sendToChannel()` unconditionally. If the conversation ever had a WhatsApp turn, charts get sent to WhatsApp.
2. **Response watchdog** (`app.ts`, `injectRecovery` callback) — calls `trySendViaChannel()` unconditionally after injecting a recovery turn.

### Fix

Added a `source: 'dashboard' | 'channel'` option threaded through the post-response hooks:

| File | Change |
|------|--------|
| `post-response-hooks.ts` | Added `source` to `run()` options. When `source === 'dashboard'`, strips `sendToChannel` from visual augmentation deps and passes source to `injectRecovery`. |
| `chat-service.ts` | Passes `source: 'dashboard'` when calling `run()`. |
| `message-handler.ts` | Passes `source: 'channel'` when calling `run()`. |
| `app.ts` | `injectRecovery` callback accepts `options.source`, skips `trySendViaChannel` when source is `'dashboard'`. |

### Pattern for Similar Issues

The general problem: **shared post-response infrastructure that doesn't distinguish message origin**. Any code path that forwards output to a channel transport should check whether the triggering input came from that channel. Look for:

- Callbacks like `sendToChannel`, `trySendViaChannel`, or `sendViaTransport` that fire unconditionally
- Post-processing hooks that run identically for both dashboard and channel paths
- Channel inference from conversation history (e.g. "last user turn had a channel, so use that") rather than from the current turn's actual origin

The fix pattern: **tag the source at entry, check it at every exit point** that touches an external channel.
