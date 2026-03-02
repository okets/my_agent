# Ad-Hoc: WhatsApp Typing Indicator — Sprint Plan

> **Type:** Ad-hoc quick sprint
> **Status:** Planned
> **Scope:** WhatsApp channel + message handler
> **Estimated effort:** ~30 min

---

## Problem

When a message is sent via WhatsApp, the agent takes time to process (brain thinking + streaming). During this time, WhatsApp shows no activity — it looks like the agent isn't responding, especially for longer replies.

## Solution

Send a `composing` presence update via Baileys when the agent starts processing a reply. WhatsApp will show the "typing..." indicator until the reply is sent.

Baileys already provides `sock.sendPresenceUpdate('composing', jid)` — we just need to wire it through the layers.

---

## Tasks

| # | Task | File | Description |
|---|------|------|-------------|
| 1 | Add `sendTypingIndicator()` to plugin | `plugins/channel-whatsapp/src/plugin.ts` | Wrap `sock.sendPresenceUpdate('composing', jid)` with error handling (non-critical, must not break message flow) |
| 2 | Add passthrough on ChannelManager | `packages/dashboard/src/channels/manager.ts` | Duck-type check (like `clearAuth`), call plugin method if available |
| 3 | Wire into message handler | `packages/dashboard/src/channels/message-handler.ts` | Add dep to `MessageHandlerDeps`, call before `streamMessage()` |
| 4 | Connect dep in server init | `packages/dashboard/src/index.ts` | Pass `channelManager.sendTypingIndicator` as dep |

## Verification

1. Restart dashboard server
2. Send a message via WhatsApp
3. Observe "typing..." indicator in WhatsApp chat
4. Confirm indicator clears when reply arrives (automatic)
5. Confirm no errors when channel is disconnected (graceful skip)
