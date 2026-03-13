# M6.9-S3 Decisions Log

## D1: ChannelManagerLike uses `statusDetail` not `status`

**Decision:** Use `statusDetail?.connected` instead of `status.connected` in the `ChannelManagerLike` interface.

**Why:** The actual `ChannelInfo` type uses `statusDetail` (which is `ChannelStatus` with a `connected` boolean), not `status` (which is `ChannelDisplayStatus`, a string like "Connected"). The spec had the wrong property name.

**Impact:** Minor — interface and implementation aligned to match real types.

## D2: ConversationInitiator wired before WorkLoopScheduler

**Decision:** Initialize `ConversationInitiator` after `channelManager` but before `WorkLoopScheduler`, passing it as an optional config property.

**Why:** WorkLoopScheduler needs the initiator to call after morning prep. The initiator needs channelManager and sessionRegistry which are already initialized at that point.

**Impact:** None — clean dependency ordering.

## D3: Session factory adapter uses sessionRegistry.getOrCreate()

**Decision:** The `SessionFactory` adapter in index.ts uses `sessionRegistry.getOrCreate(conversationId, sdkSessionId)` for `injectSystemTurn` and `sessionRegistry.getOrCreate(conversationId)` for `streamNewConversation`.

**Why:** SessionManager instances are per-conversation. The registry manages their lifecycle. For injection, we need to resume the existing SDK session. For new conversations, we start fresh.

**Impact:** None — follows existing patterns.

## D4: Outbound channel lives under Morning Brief in Settings UI

**Decision:** Placed the Outbound Channel dropdown under the "Morning Brief" section rather than creating a new section.

**Why:** Currently the only consumer of outbound channel is the morning brief flow. When more consumers exist (S3.5 refactor), this can be elevated to its own section.

**Impact:** Minor — UI organization choice, easily changed later.
