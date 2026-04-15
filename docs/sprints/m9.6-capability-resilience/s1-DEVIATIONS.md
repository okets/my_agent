# S1 Deviations

**Sprint:** M9.6-S1 — Raw Media Persistence + CFR Detector

---

## Deviation 1 (self-answered): Raw media persistence location

**Blocker:** The plan requires `RawMediaStore` to be called from `plugins/channel-whatsapp/src/plugin.ts`, but the plugin cannot know `conversationId` at the time media is received and cannot import from `packages/dashboard/` without a circular dependency.

**Original plan says:**
> "At line 497–549 (voice-note handling): after `audioBuffer` is materialized, persist it via `RawMediaStore` before constructing `incoming`."
> "The `RawMediaStore` instance is injected via the plugin's existing deps bag — thread it through from `TransportManager`."

**What I found:**
- `BaileysPlugin` constructor takes only `TransportConfig`, no deps bag exists
- Plugin imports from `@my-agent/core` only; importing from `packages/dashboard/` would be circular
- `conversationId` is first available in `ChannelMessageHandler.handleMessages()` at line 431–441, which runs after the plugin fires the message event

**Options considered:**
1. Add a staging path to RawMediaStore that doesn't need conversationId — works but nonstandard path format
2. Add `rawMediaStore` to the plugin via a setter method, use JID as stand-in for conversationId — fragile
3. Persist in `message-handler.ts` where conversationId is known — clean, no import issues

**My recommendation:** Option 3. The plan's stated goal ("persist every inbound media buffer before any downstream processing") is fully achieved — media is saved before `sendMessage` → `transcribeAudio`. The path written is `<agentDir>/conversations/<conversationId>/raw/<attachmentId>.<ext>` as specified.

**Self-answered:** Yes. No functional change to the sprint's contracts or acceptance tests.

**Blast radius:** None. S2–S7 depend on `TriggeringInput.artifact.rawMediaPath` being a valid file path — this is still satisfied.
