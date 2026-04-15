# S1 Decisions

**Sprint:** M9.6-S1 — Raw Media Persistence + CFR Detector
**Date:** 2026-04-15
**Implementer:** Claude Sonnet 4.6 on sprint branch `sprint/m9.6-s1-raw-media-cfr-detector`

---

## D1: Raw media persistence moved from plugin to message-handler

**Judgment call:** The plan (section 3.4) says to persist raw media in `plugins/channel-whatsapp/src/plugin.ts` via `RawMediaStore`, but the plugin does not know the `conversationId` at the time media is received. `RawMediaStore.pathFor()` requires conversationId to construct the path `<agentDir>/conversations/<conversationId>/raw/<attachmentId>.<ext>`.

**What I found:**
- `BaileysPlugin.constructor(config: TransportConfig)` — no `agentDir` or `conversationId` available
- `createBaileysPlugin({ ...cfg, agentDir })` factory creates the plugin before conversation routing
- `conversationId` is first established in `ChannelMessageHandler.handleMessages()` at line 431–441
- Importing `RawMediaStore` from `packages/dashboard/src/media/` into `plugins/channel-whatsapp/` would create a circular dependency: plugin imports dashboard, dashboard imports plugin

**Decision:** Persist raw media in `packages/dashboard/src/channels/message-handler.ts` after the conversation is created/found (line 431–441) and before `sendMessage` is called. The `rawMediaPath` is passed as a new field on `ChatMessageOptions` rather than on `IncomingMessage`.

**Net effect:** Functionally identical to the plan's intent. "Before STT processing" is still satisfied — media is saved before `sendMessage` → `transcribeAudio`. The trigger path is: `message-handler → app.rawMediaStore.save() → rawMediaPath in options → chat-service`.

**Blast radius:** None. This doesn't affect S2–S7. The path format and storage location are identical.

---

## D2: `rawMediaPath` added to `ChatMessageOptions`, not `IncomingMessage`

**Judgment call:** Since persistence happens in message-handler (not plugin), there's no need to add `rawMediaPath` to `IncomingMessage`. The field goes directly into `ChatMessageOptions`.

**Decision:** Added `rawMediaPath?: string` to `ChatMessageOptions` in `packages/dashboard/src/chat/types.ts`. `IncomingMessage` unchanged.

**Blast radius:** None. `ChatMessageOptions` is a stable interface. Adding an optional field is backward compatible.

---

## D3: `cap?.enabled` cast-free — Capability type has `enabled: boolean`

**Judgment call:** `classifySttError()` receives `capEnabled: boolean`. In chat-service, `this.app.capabilityRegistry?.get("audio-to-text")` returns `Capability | undefined`. The plan's code snippet uses `!!cap?.enabled`.

**What I found:** `Capability` type in `packages/core/src/capabilities/types.ts` line 18: `enabled: boolean` — no cast needed.

**Decision:** Used `!!cap?.enabled` directly without any type assertion.

---

## D4: `RawMediaStore` placed in `packages/dashboard/src/media/` as planned

**Judgment call:** Despite the circular dependency concern, `RawMediaStore` is only used by `App` (which is in dashboard) and tests. The plugin does not import it.

**Decision:** Kept `RawMediaStore` in `packages/dashboard/src/media/` as specified in the plan.
