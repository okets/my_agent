# Sprint M3-S1: Channel Infrastructure (Updated)

> **Status:** In Progress
> **Milestone:** M3 (WhatsApp Channel)
> **Design spec:** [channels.md](../../design/channels.md)

## Goal

Define what a channel is at the code level. Build the generic plugin interface, channel manager, config schema, and message routing — so that S2 (WhatsApp) just has to implement a plugin and plug in. Channel conversations are viewable in real-time on the web dashboard. Includes battle-tested resilience patterns (backoff, dedup, debounce, watchdog) from OpenClaw production.

## Context

The conversation system already has a `channel` field and multi-party support. The dashboard handles messages via WebSocket. This sprint adds the abstraction layer between external channels and the existing message handling. OpenClaw's production WhatsApp patterns are incorporated into utilities and the manager to prevent real-world issues we'd otherwise discover in S2.

**What this sprint delivers:**
- `ChannelPlugin` interface and message types (including SVG icon requirement)
- Rich `ChannelStatus` with reconnect tracking, watchdog, last-message timestamps
- Core utilities: exponential backoff, message dedup (LRU+TTL), message debouncing
- `ChannelManager` — plugin registry, lifecycle, reconnection loop, watchdog, dedup, debounce
- Config schema for channel instances with reconnect/watchdog/debounce defaults
- Incoming message routing: plugin → dedup → debounce → conversation lookup/create → brain → response
- Outbound response delivery: brain response → plugin send
- Real-time WebSocket broadcast of channel conversations + status changes
- Channel icon & status dot in conversation sidebar + pinned position
- A mock channel for testing (proves the interface + resilience patterns work)

**What this sprint does NOT do:**
- WhatsApp/Baileys (S2)
- Trust tiers, escalation policies (S3)
- Refactor web dashboard to use ChannelPlugin (web stays as-is, it's special)

---

## Tasks

### Task 1: Channel Types & Plugin Interface

Define the core types in `packages/core/` so both the dashboard and external plugins can import them.

**Files:**
- `packages/core/src/channels/types.ts` — ChannelPlugin interface, rich status, messages, config
- `packages/core/src/channels/index.ts` — Re-exports
- `packages/core/src/lib.ts` — Add channel exports

**Key types:**

```typescript
/** Rich status object emitted by plugins and tracked by manager */
interface ChannelStatus {
  running: boolean;
  connected: boolean;
  reconnectAttempts: number;
  lastConnectedAt: Date | null;
  lastDisconnect: {
    at: Date;
    status: ChannelDisplayStatus;
    error?: string;
    loggedOut?: boolean;
  } | null;
  lastMessageAt: Date | null;
  lastEventAt: Date | null;
  lastError: string | null;
}

/** Simple string enum for UI display */
type ChannelDisplayStatus = "disconnected" | "connecting" | "connected" | "error" | "logged_out";

/** Reconnect policy configuration */
interface ReconnectPolicy {
  initialMs: number;
  maxMs: number;
  factor: number;
  jitter: number;
  maxAttempts: number;
}

/** Watchdog configuration */
interface WatchdogConfig {
  enabled: boolean;
  checkIntervalMs: number;
  timeoutMs: number;
}

interface ChannelPlugin {
  name: string;
  icon: string; // SVG string
  init(config: ChannelInstanceConfig): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(to: string, message: OutgoingMessage): Promise<void>;
  on(event: "message", handler: (msg: IncomingMessage) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  on(event: "status", handler: (status: ChannelStatus) => void): void;
  status(): ChannelStatus;
}

interface ChannelInstanceConfig {
  id: string;
  plugin: string;
  role: "dedicated" | "personal";
  identity: string;
  processing: "immediate" | "on_demand";
  owner?: string;
  escalation?: string;
  permissions?: string[];
  authDir?: string;
  reconnect?: Partial<ReconnectPolicy>;
  watchdog?: Partial<WatchdogConfig>;
  debounceMs?: number;
  [key: string]: unknown;
}

interface IncomingMessage {
  id: string;
  from: string;
  content: string;
  timestamp: Date;
  channelId: string;
  threadId?: string;
  groupId?: string;
  attachments?: ChannelAttachment[];
  senderName?: string;
  groupName?: string;
  replyTo?: { messageId: string; sender?: string; text?: string };
}

interface OutgoingMessage {
  content: string;
  replyTo?: string;
  attachments?: ChannelAttachment[];
}

interface ChannelAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

/** Channel info exposed to the frontend */
interface ChannelInfo {
  id: string;
  plugin: string;
  role: "dedicated" | "personal";
  identity: string;
  status: ChannelDisplayStatus;
  statusDetail: ChannelStatus;
  icon: string;
}
```

**Done when:** Types compile, exported from `packages/core/src/lib.ts`, importable by dashboard.

---

### Task 2a: Core Utilities — Backoff, Dedup, Debounce

Pure-logic, zero-dependency utilities reusable by future milestones.

**Files (all new):**
- `packages/core/src/utils/backoff.ts` — `computeBackoff(policy, attempt)`, `DEFAULT_BACKOFF`
- `packages/core/src/utils/dedup.ts` — `DedupCache` class (Map-based LRU + TTL, lazy pruning, max 5000 entries, 20min TTL)
- `packages/core/src/utils/debounce.ts` — `MessageDebouncer<T>` class (per-key buffer, configurable flush timeout, bypass for media/control/replies)
- `packages/core/src/utils/index.ts` — re-exports
- `packages/core/src/lib.ts` — add utils exports

**Done when:** All utilities compile, have clear interfaces, and are exported from lib.ts.

---

### Task 2: Channel Manager

The central registry that loads plugins, manages their lifecycle, routes messages, and handles resilience.

**File:** `packages/dashboard/src/channels/manager.ts`

**Responsibilities:**
1. **Registry:** Map of channelId → { config, plugin instance, status }
2. **Lifecycle:** `initAll()` reads config, loads plugins, calls `plugin.init()` + `plugin.connect()` for immediate channels
3. **Reconnection loop:** When plugin emits disconnected (not loggedOut), apply backoff and retry. Reset after healthy uptime. Stop after maxAttempts.
4. **Watchdog timer:** Per dedicated channel, check every 60s. If lastMessageAt > 30min, force disconnect → triggers reconnect.
5. **Dedup filter:** Single DedupCache. Check `channelId:from:messageId` before forwarding.
6. **Debounce routing:** Per-channel MessageDebouncer (only if debounceMs > 0). Media/replies/control bypass.
7. **Message routing:** After dedup+debounce, call registered messageHandler callback
8. **Outbound:** `send(channelId, to, message)` finds plugin and calls `plugin.send()`
9. **Status sink:** `onStatusChange(callback)` for external consumers (WS broadcast)
10. **Channel info:** `getChannelInfos()` returns `ChannelInfo[]` including icons and rich status
11. **Shutdown:** `disconnectAll()` clears all reconnect + watchdog timers

**Done when:** ChannelManager can register plugins, init/connect, handle disconnect with backoff, dedup messages, debounce rapid fire, forward to handler, expose rich status.

---

### Task 3: Config Schema Extension

Extend config to support channel definitions with defaults.

**File:** `packages/core/src/config.ts`

**Config format:**
```yaml
channels:
  defaults:
    reconnect: { initialMs: 2000, maxMs: 30000, factor: 1.8, jitter: 0.25, maxAttempts: 50 }
    watchdog: { enabled: true, checkIntervalMs: 60000, timeoutMs: 1800000 }
    debounceMs: 0
  mock_test:
    plugin: mock
    role: dedicated
    identity: "test-channel"
    processing: immediate
```

**Changes:**
- Add `channels` section to BrainConfig (with defaults + per-channel instances)
- Parse channel configs in `loadConfig()`, inject `id` from key name
- Merge: hardcoded defaults ← yaml defaults ← per-channel
- Validate required fields (plugin, role, identity, processing)

**Done when:** `loadConfig()` returns parsed channel configs with merged defaults.

---

### Task 4: Incoming Message Handler

Route incoming channel messages to the brain through conversations. Dedup and debounce are handled by manager before messages reach here.

**File:** `packages/dashboard/src/channels/message-handler.ts`

**Flow:**
```
Messages arrive (already deduped + debounced by manager)
  → Look up conversation by (channelId, externalParty)
  → If not found: create new with senderName for display, groupName for group convos
  → Build context including replyTo context
  → Call SessionManager.streamMessage()
  → Collect response AND broadcast tokens to WS clients
  → Send response back via ChannelManager.send()
  → Persist both turns in transcript
```

**ConversationManager extension:**
- Add `getByExternalParty(channel: string, externalParty: string): Conversation | null`
- Add `externalParty` column to conversations table (nullable, for channel convos)
- Web conversations use externalParty = null (existing behavior preserved)

**Done when:** An incoming message creates/resumes a conversation, gets a brain response, sends it back, and is visible in real-time on the dashboard.

---

### Task 5: Mock Channel Plugin

A simple plugin for testing all channel infrastructure including resilience.

**File:** `packages/dashboard/src/channels/mock-plugin.ts`

**Behavior:**
- `icon` — a simple SVG chat bubble
- `connect()` → sets status to connected
- `send()` → stores messages in array
- `simulateIncoming(msg)` — inject test messages
- `simulateDisconnect()` — emits disconnected status, triggers manager reconnection
- `simulateLogout()` — emits loggedOut status, should NOT trigger reconnection
- `simulateRapidMessages(count, intervalMs)` — tests debouncing
- `simulateDuplicateMessage(msg)` — same ID twice, tests dedup
- Returns rich `ChannelStatus` object

**Done when:** Mock plugin can test the full pipeline plus all resilience scenarios.

---

### Task 6: Server Integration & Wiring

Wire ChannelManager into the Fastify server lifecycle.

**Files:**
- `packages/dashboard/src/index.ts` — Initialize ChannelManager after server starts
- `packages/dashboard/src/server.ts` — Add channelManager to Fastify decorators
- `packages/dashboard/src/routes/channels.ts` — REST endpoints
- `packages/dashboard/src/ws/protocol.ts` — New channel status message type

**Startup flow:**
```
Server starts
  → Load config (channels section)
  → Create ChannelManager
  → Register available plugins (mock)
  → Wire message handler
  → Wire onStatusChange → WS broadcast
  → channelManager.initAll(channelConfigs)
  → Dedicated channels auto-connect
```

**REST endpoints:**
- `GET /api/channels` — List all channels with status + rich statusDetail
- `GET /api/channels/:id/status` — Single channel status
- `GET /api/channels/:id/icon` — Channel icon as `image/svg+xml`

**WebSocket:**
- `channel_status_changed` broadcast on status changes
- `GET /api/channels` includes `statusDetail` in response

**Shutdown:**
- `channelManager.disconnectAll()` on server close

**Done when:** Server starts with ChannelManager, channels from config initialize, REST works, status broadcasts via WS.

---

### Task 7: Frontend — Channel Icons, Status Dots & Pinned Conversations

Update the conversation sidebar for channel awareness.

**Files:**
- `packages/dashboard/public/js/app.js` — Sidebar rendering + WS handler
- `packages/dashboard/public/css/app.css` — Channel icon, status dot, pinned section styles

**Changes:**
1. Fetch channel info on load: `GET /api/channels`
2. Channel conversations pinned at top of sidebar with channel SVG icon (16x16)
3. Status dot next to each pinned channel conversation (green/yellow/red/gray)
4. Handle `channel_status_changed` WS event to update dots in real-time
5. Tooltip on dot shows reconnect count when reconnecting
6. Subtle "Channels" label + thin separator between pinned and web conversations

**Done when:** Channel conversations appear pinned with icons and live status dots.

---

### Task 8: Integration Verification

End-to-end test with mock channel.

**Steps:**
1. Add mock channel to `.my_agent/config.yaml`
2. Start dashboard server
3. `GET /api/channels` → mock shows connected with SVG icon and rich status
4. Simulate incoming message → conversation created, brain responds
5. Verify conversation appears pinned with icon and green status dot
6. Simulate disconnect → yellow dot, reconnection starts with backoff
7. Simulate logout → red/gray dot, NO reconnection
8. Simulate duplicate message → dropped (dedup)
9. Simulate rapid messages (debounceMs=1500) → batched
10. Verify `channel_status_changed` WS events
11. `npx tsc --noEmit` clean
12. `npx prettier --write` applied

**Done when:** Full round-trip works, all resilience patterns verified, types clean.

---

## Dependencies

```
Task 1 (types) ───────────────┐
                               ├── Task 2 (manager) ─────────┐
Task 2a (utils) ──────────────┘                               │
                                                               │
Task 3 (config) ──────────────────────────────────────────────├── Task 6 (wiring) ──┐
                                                               │                      │
Task 4 (msg handler) ────────────────────────────────────────┘                      ├── Task 8 (verify)
                                                                                     │
Task 5 (mock plugin) ──────────────────────────────────────────────────────────────┘
                                                                                     │
Task 7 (frontend) ─────────────────────────────────────────────────────────────────┘
```

**Parallelization:**
- Wave 1: T1 + T2a (parallel — types and utilities are independent)
- Wave 2: T2 + T3 + T4 + T5 + T7 (partially parallel after Wave 1)
- Wave 3: T6 (wires everything)
- Wave 4: T8 (end-to-end verification)

## Team

| Role | Agent | Tasks |
|------|-------|-------|
| Tech Lead | Opus (me) | Architecture decisions, T1, T2a, review |
| Backend Dev | Sonnet | T2, T3, T4, T5, T6 |
| Frontend Dev | Sonnet | T7 |
| Reviewer | Opus | Independent review after T6+T7 |

## Risks

| Risk | Mitigation |
|------|------------|
| Reconnect loop overwhelms plugin | Backoff with maxAttempts + jitter. loggedOut check stops futile retries. |
| Dedup cache memory growth | Max 5000 entries + 20min TTL with lazy pruning. |
| Debounce delays user experience | 0ms default (disabled). Only enabled per-channel. Media/control/reply bypass. |
| Watchdog false positives | Only for dedicated channels with immediate processing. |
| Rich status type breaks simple comparisons | `ChannelDisplayStatus` string enum + `toDisplayStatus()` helper. |
| ConversationManager changes break web chat | Web chat doesn't use externalParty — null preserves existing behavior. |
