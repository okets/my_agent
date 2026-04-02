# M9-S3 Decisions Log

## D1: WhatsApp Plugin Decoupling via Callbacks
**Decision:** Use `onAudioMessage` and `onSendVoiceReply` callbacks on the plugin, wired by the dashboard at init time.
**Reason:** Keeps the WhatsApp plugin independent of the capability registry. The plugin doesn't import from core — callbacks are the only contract.

## D2: Model Change Broadcast via SubagentStart/Stop Hooks
**Decision:** Use Agent SDK's SubagentStart/SubagentStop hooks (matching "capability-builder") to broadcast model_changed WebSocket events.
**Reason:** Cleanest integration point — hooks fire automatically when the builder agent starts/stops. No manual broadcasting needed in business logic.

## D3: Connection Registry in Session Manager
**Decision:** Store a shared connection registry reference in session-manager.ts (set from App init) for model change broadcasts.
**Reason:** Session manager doesn't normally have WS access. A minimal typed interface avoids coupling to the full ConnectionRegistry.

## D4: Brainstorming Skill Reference Material
**Decision:** Put provider-specific knowledge (Deepgram, Kokoro, etc.) only in `references/` files, not in the SKILL.md itself.
**Reason:** The SKILL.md stays generic and process-focused. Provider recommendations change over time — reference files are easy to update.

## D5: Voice Note Flag on IncomingMessage
**Decision:** Added `isVoiceNote?: boolean` to `IncomingMessage` type in core transports/types.ts.
**Reason:** Message handler needs to know if the original message was audio to decide whether to attempt voice reply. This is cleaner than parsing the content string.
