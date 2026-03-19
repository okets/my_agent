# M3-S6: Transport / Channel Split — Sprint Plan

> **Status:** Planned
> **Date:** 2026-03-19
> **Branch:** `refactor/m3-s6-transport-channel-split`
> **Depends on:** M3-S5 (Connection Stability — complete)
> **Design:** `docs/design/transport-channel-split.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single "Channel" abstraction into Transport (infrastructure) and Channel (owner binding), with persistent token-based authorization.

**Architecture:** Three phases — rename existing layer to Transport, extract Channel as a binding layer, implement the authorization flow. Each phase produces working software that passes all tests. The user stressed heavy validation at every step.

**Tech Stack:** TypeScript, Vitest, Node.js crypto module, Fastify, Alpine.js

---

## Validation Strategy

Every task ends with a verification step. Between phases, a full validation checkpoint runs:

1. TypeScript compiles for both `packages/core` and `packages/dashboard`
2. All existing tests pass (`cd packages/dashboard && npx vitest run` — currently 548 tests, run from dashboard package)
3. Service restarts cleanly (`systemctl --user restart nina-dashboard.service`)
4. Dashboard loads in browser without errors
5. WhatsApp transport connects (if credentials exist)

Any failure at a checkpoint blocks the next phase.

---

## Phase 1: Rename to Transport (mechanical, no behavior change)

The goal of Phase 1 is pure renaming. No new features, no behavior changes. Every test that passed before must pass after. This is the largest phase by number of edits but the safest — it's all find-and-replace with type checking as the safety net.

### Task 1: Rename core types

**Files:**
- Rename: `packages/core/src/channels/` directory to `packages/core/src/transports/`
- Modify: `packages/core/src/transports/types.ts` — rename all types
- Modify: `packages/core/src/transports/index.ts` — update re-exports
- Modify: `packages/core/src/lib.ts` — update import paths and re-exports
- Modify: `packages/core/src/config.ts` — update imports and type references
- Modify: `packages/core/src/types.ts` — update any references

**Renames:**
- `ChannelPlugin` → `TransportPlugin` (including `readonly type: 'channel'` → `readonly type: 'transport'`)
- `ChannelInstanceConfig` → `TransportConfig`
- `ChannelStatus` → `TransportStatus`
- `ChannelDisplayStatus` → `TransportDisplayStatus`
- `ChannelInfo` → `TransportInfo`
- `ChannelAttachment` → `TransportAttachment`
- `PluginFactory` → `TransportPluginFactory`
- `toDisplayStatus` and `initialStatus` — keep names, update param/return types
- `loadChannelConfigs` → `loadTransportConfigs`
- `BrainConfig.channels` → `BrainConfig.transports` (cascades to all consumers of this field)

**Keep backward-compatible re-exports:** For any type used outside the core package, add a deprecated type alias:
```typescript
/** @deprecated Use TransportPlugin */
export type ChannelPlugin = TransportPlugin
```

This allows Phase 1 to complete without touching every consumer file. The deprecated aliases are removed in Phase 2 after consumers are updated.

- [ ] **Step 1:** Rename directory `packages/core/src/channels/` to `packages/core/src/transports/`
- [ ] **Step 2:** Update all type names in `transports/types.ts`
- [ ] **Step 3:** Update `transports/index.ts` re-exports
- [ ] **Step 4:** Update `lib.ts` import path and re-exports, add deprecated aliases
- [ ] **Step 5:** Update `config.ts` imports and function names
- [ ] **Step 6:** Update any references in `types.ts`
- [ ] **Step 7:** Run `cd packages/core && npx tsc --noEmit` — must pass
- [ ] **Step 8:** Run `cd packages/dashboard && npx tsc --noEmit` — must pass (using deprecated aliases)
- [ ] **Step 9:** Commit: `refactor(m3-s6): rename core channel types to transport`

### Task 2: Rename dashboard channel manager

**Files:**
- Rename: `packages/dashboard/src/channels/` directory to `packages/dashboard/src/transports/`
- Modify: `packages/dashboard/src/transports/manager.ts` — rename class and all internal references
- Modify: `packages/dashboard/src/transports/index.ts` — update re-exports
- Modify: `packages/dashboard/src/transports/mock-plugin.ts` — update type references
- Modify: `packages/dashboard/src/transports/message-handler.ts` — update type references
- Modify: `packages/dashboard/src/transports/external-store.ts` — update type references
- Modify: `packages/dashboard/src/transports/response-timer.ts` — update if needed
- Modify: `packages/dashboard/src/index.ts` — update imports
- Modify: `packages/dashboard/src/server.ts` — update imports and type references
- Modify: `packages/dashboard/src/tasks/delivery-executor.ts` — update imports
- Modify: `packages/dashboard/src/tasks/task-processor.ts` — update imports
- Modify: `packages/dashboard/src/agent/conversation-initiator.ts` — update imports
- Modify: `packages/dashboard/src/ws/chat-handler.ts` — update imports

**Renames:**
- `ChannelManager` → `TransportManager`
- `ChannelMessageHandler` → `TransportMessageHandler` (temporary — this will be split in Phase 2)
- `ChannelEntry` (internal) → `TransportEntry`
- All `channelManager` variables → `transportManager`
- All `channelMessageHandler` variables → `transportMessageHandler`

- [ ] **Step 1:** Rename directory `packages/dashboard/src/channels/` to `packages/dashboard/src/transports/`
- [ ] **Step 2:** Rename class `ChannelManager` to `TransportManager` in `manager.ts`, update all internal references
- [ ] **Step 3:** Update `index.ts` re-exports
- [ ] **Step 4:** Update `mock-plugin.ts` type references
- [ ] **Step 5:** Update `message-handler.ts` type references (class name stays for now — renamed in Phase 2)
- [ ] **Step 6:** Update all consumer imports (`index.ts`, `server.ts`, `delivery-executor.ts`, `task-processor.ts`, `conversation-initiator.ts`, `chat-handler.ts`)
- [ ] **Step 7:** Run `cd packages/dashboard && npx tsc --noEmit` — must pass
- [ ] **Step 8:** Run `npx vitest run` — all 548 tests must pass
- [ ] **Step 9:** Commit: `refactor(m3-s6): rename dashboard channel manager to transport manager`

### Task 3: Rename WhatsApp plugin references

**Files:**
- Modify: `plugins/channel-whatsapp/src/plugin.ts` — update type imports and references

The plugin directory stays as `channel-whatsapp/` for now (it's a transport plugin but renaming the directory would break npm workspace references).

- [ ] **Step 1:** Update imports from `@my-agent/core` to use new type names
- [ ] **Step 2:** Update internal type references (`ChannelStatus` → `TransportStatus`, etc.)
- [ ] **Step 3:** Run `cd packages/dashboard && npx tsc --noEmit` — must pass
- [ ] **Step 4:** Commit: `refactor(m3-s6): update whatsapp plugin to transport types`

### Task 4: Rename API routes

**Files:**
- Rename: `packages/dashboard/src/routes/channels.ts` to `packages/dashboard/src/routes/transports.ts`
- Modify: `packages/dashboard/src/server.ts` — update route registration import
- Modify: `packages/dashboard/src/routes/transports.ts` — update route paths from `/api/channels/` to `/api/transports/`

The existing `routes/channels.ts` has ~8 route handlers. All of them are transport-level operations (they deal with connecting, pairing, disconnecting, status — not owner bindings). They all move to `routes/transports.ts`:

- `GET /api/transports` — list transports (was `GET /api/channels`)
- `POST /api/transports` — create transport (was `POST /api/channels`)
- `POST /api/transports/:id/connect` — connect transport
- `POST /api/transports/:id/disconnect` — disconnect transport
- `POST /api/transports/:id/pair-phone` — phone pairing
- `POST /api/transports/:id/authorize` — generate auth token (stays transport-level: "who will own this transport?")
- `POST /api/transports/:id/remove-owner` — removed (replaced by channel deletion in Phase 3)
- `DELETE /api/transports/:id` — remove transport

**Important:** Keep `/api/channels/` route aliases working during transition. The frontend still uses `/api/channels/` — updated in Task 5.

- [ ] **Step 1:** Rename file
- [ ] **Step 2:** Rename all route paths from `/api/channels/` to `/api/transports/`
- [ ] **Step 3:** Add `/api/channels/` aliases (deprecated, removed in Task 18)
- [ ] **Step 4:** Update `server.ts` import
- [ ] **Step 5:** Run `cd packages/dashboard && npx tsc --noEmit` — must pass
- [ ] **Step 6:** Commit: `refactor(m3-s6): rename channel routes to transport routes`

### Task 5: Rename WebSocket protocol events

**Files:**
- Modify: `packages/dashboard/src/ws/protocol.ts` — rename event types
- Modify: all WebSocket event emitters/handlers in dashboard

**Renames:**
- `channel_status_changed` → `transport_status_changed`
- `channel_qr_code` → `transport_qr_code`
- `channel_paired` → `transport_paired`
- `channel_pairing_code` → `transport_pairing_code`
- `channel_authorized` → `transport_authorized`
- `channel_owner_removed` → `transport_owner_removed`

**Important:** The frontend must be updated in the same commit to stay in sync.

- [ ] **Step 1:** Update `protocol.ts` event types
- [ ] **Step 2:** Update all event emitters in backend code
- [ ] **Step 3:** Update `public/js/app.js` event handlers to match new names
- [ ] **Step 4:** Update `public/index.html` — rename all `channel` references to `transport` in settings/status UI. Keep `channel` terminology in the chat UI where it refers to the message source (this is conceptually correct — "which channel did this conversation come from").
- [ ] **Step 5:** Update API fetch calls in `app.js` from `/api/channels/` to `/api/transports/`
- [ ] **Step 6:** Run `cd packages/dashboard && npx tsc --noEmit` — must pass
- [ ] **Step 7:** Commit: `refactor(m3-s6): rename websocket events and frontend to transport terminology`

### Task 6: Config migration

**Files:**
- Modify: `packages/core/src/config.ts` — add migration logic
- Create: `packages/core/src/config-migration.ts` — migration function

The config parser needs to:
1. Guard: if `transports:` section already exists, skip migration (handles partial manual migration)
2. Detect old format (`channels:` section with `plugin` field in entries — new-format channels have `transport` field instead)
3. Back up config.yaml to `config.yaml.backup-pre-transport-split`
4. Move entries from `channels:` to `transports:`
5. Write migrated config

- [ ] **Step 1:** Write test for migration detection (old format has `plugin` in channel entries)
- [ ] **Step 2:** Run test, verify it fails
- [ ] **Step 3:** Implement migration detection function
- [ ] **Step 4:** Run test, verify it passes
- [ ] **Step 5:** Write test for migration transformation (channels → transports)
- [ ] **Step 6:** Run test, verify it fails
- [ ] **Step 7:** Implement migration transformation
- [ ] **Step 8:** Run test, verify it passes
- [ ] **Step 9:** Wire migration into `loadConfig()` — runs before parsing
- [ ] **Step 10:** Run full test suite — all tests must pass
- [ ] **Step 11:** Commit: `feat(m3-s6): auto-migrate config.yaml from channels to transports format`

### Task 7: Phase 1 Validation Checkpoint

- [ ] **Step 1:** `cd packages/core && npx tsc --noEmit && echo "core OK"`
- [ ] **Step 2:** `cd packages/dashboard && npx tsc --noEmit && echo "dashboard OK"`
- [ ] **Step 3:** `npx vitest run` — all tests pass
- [ ] **Step 4:** `systemctl --user restart nina-dashboard.service`
- [ ] **Step 5:** Check service is running: `systemctl --user status nina-dashboard.service`
- [ ] **Step 6:** Check logs for errors: `journalctl --user -u nina-dashboard.service --since "1 minute ago" | grep -i error`
- [ ] **Step 7:** Verify dashboard loads in browser
- [ ] **Step 8:** Verify config.yaml was migrated (should now have `transports:` section)
- [ ] **Step 9:** Verify WhatsApp transport connects (check logs for "opened connection")
- [ ] **Step 10:** Commit: `refactor(m3-s6): phase 1 complete — rename to transport terminology`

### Task 8: Remove deprecated aliases

After Phase 1 validation, remove the backward-compatible type aliases added in Task 1.

**Files:**
- Modify: `packages/core/src/lib.ts` — remove deprecated aliases
- Modify: `packages/core/src/transports/index.ts` — remove deprecated aliases

- [ ] **Step 1:** Remove all `/** @deprecated */` type aliases
- [ ] **Step 2:** Run `cd packages/core && npx tsc --noEmit` — must pass
- [ ] **Step 3:** Run `cd packages/dashboard && npx tsc --noEmit` — must pass
- [ ] **Step 4:** Commit: `refactor(m3-s6): remove deprecated channel type aliases`

---

## Phase 2: Extract Channel Binding Layer

### Task 9: Define ChannelBinding type and config parser

**Files:**
- Create: `packages/core/src/channels/types.ts` — new ChannelBinding type
- Create: `packages/core/src/channels/index.ts` — re-exports
- Modify: `packages/core/src/lib.ts` — add channel re-exports
- Modify: `packages/core/src/config.ts` — parse `channels:` section from config.yaml

**ChannelBinding type:**
```typescript
export interface ChannelBinding {
  id: string
  transport: string
  ownerIdentity: string
  ownerJid: string
  /** Set during re-authorization — channel is suspended */
  previousOwner?: string
}
```

- [ ] **Step 1:** Write test: `loadConfig()` parses a `channels:` section into `ChannelBinding[]`
- [ ] **Step 2:** Run test, verify it fails
- [ ] **Step 3:** Create `packages/core/src/channels/types.ts` with `ChannelBinding` interface
- [ ] **Step 4:** Create `packages/core/src/channels/index.ts` with re-exports
- [ ] **Step 5:** Update `lib.ts` to re-export from new channels module
- [ ] **Step 6:** Add `loadChannelBindings()` to `config.ts` — reads `channels:` section
- [ ] **Step 7:** Wire into `loadConfig()` return value
- [ ] **Step 8:** Run test, verify it passes
- [ ] **Step 9:** Run full test suite — all tests pass
- [ ] **Step 10:** Commit: `feat(m3-s6): add ChannelBinding type and config parser`

### Task 10: Config write queue

**Files:**
- Create: `packages/core/src/config-writer.ts` — serialized async write queue
- Modify: `packages/core/src/config.ts` — replace direct writes with queue

The write queue ensures all config.yaml mutations are sequential. It exposes:
- `writeConfig(mutator: (yaml: YamlConfig) => void): Promise<void>`
- Internally: acquires lock, reads file, applies mutator, writes file, releases lock

All existing config writers must use the queue: `saveChannelToConfig` (→ `saveTransportToConfig`), `removeChannelFromConfig` (→ `removeTransportFromConfig`), `saveEmbeddingsConfig`, and the new `saveChannelBinding`/`removeChannelBinding`.

- [ ] **Step 1:** Write test: two concurrent writes both succeed without data loss
- [ ] **Step 2:** Run test, verify it fails
- [ ] **Step 3:** Implement `ConfigWriter` class with async queue
- [ ] **Step 4:** Run test, verify it passes
- [ ] **Step 5:** Write test: existing `saveChannelToConfig` equivalent works through queue
- [ ] **Step 6:** Implement `saveTransportToConfig` and `saveChannelBinding` using the queue
- [ ] **Step 7:** Run test, verify it passes
- [ ] **Step 8:** Run full test suite — all tests pass
- [ ] **Step 9:** Commit: `feat(m3-s6): add serialized config write queue`

### Task 11: Routing layer — split message handler

**Files:**
- Create: `packages/dashboard/src/routing/authorization-gate.ts` — token check logic
- Create: `packages/dashboard/src/routing/message-router.ts` — channel-aware routing
- Modify: `packages/dashboard/src/transports/message-handler.ts` — simplify to delegate to router
- Modify: `packages/dashboard/src/index.ts` — wire new components

The current `ChannelMessageHandler` (now `TransportMessageHandler`) does three things: token check, owner routing, external routing. This task splits it:

- **AuthorizationGate** — validates tokens, creates channel bindings. In Phase 2 this uses the existing in-memory token map (same as current behavior). In Phase 3, Task 13 replaces the in-memory store with persistent hashed tokens.
- **MessageRouter** — looks up channel bindings, routes owner messages to brain, unbound to external store
- **TransportMessageHandler** — thin wrapper: receives messages from transport, passes through gate then router

The AuthorizationGate accepts a `TokenStore` interface so the implementation can be swapped:
```typescript
interface TokenStore {
  getPendingToken(transportId: string): { token: string; expiresAt: Date } | null
  clearToken(transportId: string): void
}
```
Phase 2 uses an in-memory implementation. Phase 3's TokenManager implements the same interface with persistence.

- [ ] **Step 1:** Write test: `AuthorizationGate` validates a correct token (in-memory store)
- [ ] **Step 2:** Run test, verify it fails
- [ ] **Step 3:** Implement `AuthorizationGate` with `TokenStore` interface and in-memory implementation
- [ ] **Step 4:** Run test, verify it passes
- [ ] **Step 5:** Write test: `AuthorizationGate` rejects expired tokens
- [ ] **Step 6:** Implement expiry check
- [ ] **Step 7:** Run test, verify it passes
- [ ] **Step 8:** Write test: `MessageRouter` routes owner messages when channel binding exists
- [ ] **Step 9:** Implement `MessageRouter` — reads channel bindings from config, matches sender
- [ ] **Step 10:** Run test, verify it passes
- [ ] **Step 11:** Write test: `MessageRouter` sends unbound messages to external store when no binding
- [ ] **Step 12:** Implement unbound routing
- [ ] **Step 13:** Run test, verify it passes
- [ ] **Step 14:** Refactor `TransportMessageHandler` to delegate to gate + router
- [ ] **Step 15:** Run full test suite — all tests pass
- [ ] **Step 16:** Commit: `feat(m3-s6): split message handler into authorization gate and message router`

### Task 12: Phase 2 Validation Checkpoint

- [ ] **Step 1:** `cd packages/core && npx tsc --noEmit && echo "core OK"`
- [ ] **Step 2:** `cd packages/dashboard && npx tsc --noEmit && echo "dashboard OK"`
- [ ] **Step 3:** `npx vitest run` — all tests pass
- [ ] **Step 4:** `systemctl --user restart nina-dashboard.service`
- [ ] **Step 5:** Service running, no errors in logs
- [ ] **Step 6:** Dashboard loads, transport settings visible
- [ ] **Step 7:** WhatsApp transport connects
- [ ] **Step 8:** Send a test message on WhatsApp — verify it routes to brain correctly (existing owner binding from migration)
- [ ] **Step 9:** Commit: `refactor(m3-s6): phase 2 complete — channel binding layer extracted`

---

## Phase 3: Authorization Flow

### Task 13: Token generation and persistence

**Files:**
- Create: `packages/dashboard/src/routing/token-manager.ts` — generate, persist, validate, cleanup tokens
- Modify: `packages/dashboard/src/routing/authorization-gate.ts` — use token manager

The token manager implements the `TokenStore` interface from Task 11, replacing the in-memory implementation with persistent hashed tokens. It handles:
- `generateToken(transportId)` — creates token with `crypto.randomInt()`, hashes with SHA-256, writes `.pending-auth.json` with 0600 permissions, returns plaintext
- `getPendingToken(transportId)` — reads from in-memory cache (loaded from disk on startup)
- `validateToken(transportId, input)` — hashes input, compares against cached hash, manages attempt counter
- `clearToken(transportId)` — deletes auth file and clears cache
- `loadPendingTokens()` — on startup, reads all pending auth files into memory cache, skips expired
- `scheduleCleanup(transportId, expiresAt)` — setTimeout for expiry

- [ ] **Step 1:** Write test: `generateToken` creates a `.pending-auth.json` file with hash (not plaintext)
- [ ] **Step 2:** Run test, verify it fails
- [ ] **Step 3:** Implement `generateToken` using `crypto.randomInt()` and `crypto.createHash('sha256')`
- [ ] **Step 4:** Run test, verify it passes
- [ ] **Step 5:** Write test: `validateToken` returns true for correct token, false for wrong
- [ ] **Step 6:** Implement `validateToken`
- [ ] **Step 7:** Run test, verify it passes
- [ ] **Step 8:** Write test: `validateToken` rejects after 5 failed attempts
- [ ] **Step 9:** Implement attempt limiting
- [ ] **Step 10:** Run test, verify it passes
- [ ] **Step 11:** Write test: `loadPendingTokens` loads from disk on startup, skips expired
- [ ] **Step 12:** Implement startup loading
- [ ] **Step 13:** Run test, verify it passes
- [ ] **Step 14:** Wire token manager into authorization gate (replace in-memory TokenStore with persistent implementation)
- [ ] **Step 15:** Run full test suite
- [ ] **Step 16:** Commit: `feat(m3-s6): token manager with persistent hashed tokens`

### Task 14: Authorization API routes

**Files:**
- Create: `packages/dashboard/src/routes/channels.ts` — new channel management routes
- Modify: `packages/dashboard/src/routes/transports.ts` — remove authorization endpoints (moved to channels)
- Modify: `packages/dashboard/src/server.ts` — register new routes

**New routes:**
- `POST /api/transports/:id/authorize` — generate token (transport-level, creates pending auth)
- `POST /api/transports/:id/reauthorize` — start re-auth flow (suspends channel, generates token)
- `GET /api/channels` — list channel bindings
- `DELETE /api/channels/:id` — remove a channel binding

- [ ] **Step 1:** Create `routes/channels.ts` with channel listing endpoint
- [ ] **Step 2:** Move authorize endpoint from `routes/transports.ts` — update to use token manager
- [ ] **Step 3:** Add reauthorize endpoint — sets `previousOwner`, suspends channel, generates token
- [ ] **Step 4:** Add channel deletion endpoint
- [ ] **Step 5:** Register routes in `server.ts`
- [ ] **Step 6:** Run `cd packages/dashboard && npx tsc --noEmit` — must pass
- [ ] **Step 7:** Commit: `feat(m3-s6): authorization and channel management API routes`

### Task 15: Re-authorization flow

**Files:**
- Modify: `packages/dashboard/src/routing/authorization-gate.ts` — handle re-auth state
- Modify: `packages/dashboard/src/routing/message-router.ts` — check suspended state
- Modify: `packages/dashboard/src/routing/token-manager.ts` — cleanup reverts channel on expiry

**Re-auth flow:**
1. Channel gets `previousOwner` field, enters suspended state
2. Messages from previous owner during suspension: dropped, WhatsApp warning sent
3. New token generated
4. On verification: channel updated with new owner, `previousOwner` cleared
5. On expiry: `previousOwner` restored to `ownerIdentity`, channel unsuspended

- [ ] **Step 1:** Write test: re-auth suspends channel, messages from old owner are dropped
- [ ] **Step 2:** Run test, verify it fails
- [ ] **Step 3:** Implement suspended state in message router
- [ ] **Step 4:** Run test, verify it passes
- [ ] **Step 5:** Write test: re-auth expiry reverts to previous owner
- [ ] **Step 6:** Implement expiry revert in token manager cleanup
- [ ] **Step 7:** Run test, verify it passes
- [ ] **Step 8:** Write test: successful re-auth clears `previousOwner`
- [ ] **Step 9:** Implement successful re-auth path
- [ ] **Step 10:** Run test, verify it passes
- [ ] **Step 11:** Run full test suite
- [ ] **Step 12:** Commit: `feat(m3-s6): re-authorization flow with suspension and revert`

### Task 16: Dashboard UI update

**Files:**
- Modify: `packages/dashboard/public/js/app.js` — transport vs channel distinction in settings
- Modify: `packages/dashboard/public/index.html` — UI updates

**UI changes:**
- Settings panel: "Transports" section shows connection status, QR pairing
- "Authorize Owner" button appears on connected transports without a channel binding
- Token display when pending auth is active
- "Authorized" badge when channel binding exists
- "Re-authorize" button when channel exists (for owner number changes)
- Channel info section shows owner identity

- [ ] **Step 1:** Update settings panel to show "Transports" header with connection info
- [ ] **Step 2:** Update authorize flow to call new API routes
- [ ] **Step 3:** Add re-authorize button and flow
- [ ] **Step 4:** Show channel status (authorized/pending/none) on each transport
- [ ] **Step 5:** Update WebSocket event handlers for new event names
- [ ] **Step 6:** Test in browser: full authorize flow works
- [ ] **Step 7:** Test in browser: re-authorize flow works
- [ ] **Step 8:** Commit: `feat(m3-s6): dashboard UI for transport/channel split`

### Task 17: Phase 3 Validation Checkpoint (Full E2E)

This is the critical validation. Every scenario must be tested manually.

- [ ] **Step 1:** `cd packages/core && npx tsc --noEmit && echo "core OK"`
- [ ] **Step 2:** `cd packages/dashboard && npx tsc --noEmit && echo "dashboard OK"`
- [ ] **Step 3:** `npx vitest run` — all tests pass
- [ ] **Step 4:** `systemctl --user restart nina-dashboard.service`
- [ ] **Step 5:** Service running, no errors in logs, no "channel" or "watchdog" log entries
- [ ] **Step 6:** Dashboard loads, shows "Transports" in settings
- [ ] **Step 7:** WhatsApp transport shows as "Connected"
- [ ] **Step 8:** **E2E: First-time authorization.** Remove channel binding from config.yaml. Restart. Click "Authorize Owner." Token appears. Send token via WhatsApp. Verify: channel created, dashboard shows "Authorized", next WhatsApp message gets brain response.
- [ ] **Step 9:** **E2E: Restart resilience.** Generate token. Restart service. Send token via WhatsApp. Verify: authorization succeeds (token survived restart).
- [ ] **Step 10:** **E2E: Token expiry.** Generate token. Wait 20 minutes (or temporarily set expiry to 30 seconds for testing). Verify: token cleared, dashboard shows "Authorize" button again.
- [ ] **Step 11:** **E2E: Brute force protection.** Generate token. Send 5 wrong codes via WhatsApp. Verify: token invalidated, dashboard shows "Authorize" button.
- [ ] **Step 12:** **E2E: Re-authorization.** Click "Re-authorize." Verify old owner gets suspension warning. Send new token from same/different number. Verify: new owner registered, old binding replaced.
- [ ] **Step 13:** **E2E: Re-auth expiry revert.** Click "Re-authorize." Let token expire. Verify: channel reverts to previous owner, messages route to brain again.
- [ ] **Step 14:** **E2E: No channel = no brain.** Remove channel binding. Send message on WhatsApp. Verify: no brain response, message stored as unbound.
- [ ] **Step 15:** **E2E: Web UI unaffected.** Chat on web dashboard throughout all tests. Verify: web conversations work regardless of WhatsApp channel state.
- [ ] **Step 16:** **E2E: Personal transport skips token flow.** If a personal-role transport exists in config, verify it does not show "Authorize Owner" button and messages route based on implicit authorization.
- [ ] **Step 17:** Commit: `feat(m3-s6): phase 3 complete — authorization flow verified`

---

### Task 18: Sprint docs and cleanup

**Files:**
- Modify: `docs/sprints/m3-s6-transport-channel-split/plan.md` — mark complete
- Modify: `docs/ROADMAP.md` — update S6 status
- Remove: deprecated `/api/channels/` route aliases from `routes/transports.ts`

- [ ] **Step 1:** Remove deprecated route aliases
- [ ] **Step 2:** Update sprint status to Complete
- [ ] **Step 3:** Update roadmap S6 status to Complete
- [ ] **Step 4:** Final full validation (tsc + vitest + restart + dashboard)
- [ ] **Step 5:** Commit: `docs(m3-s6): mark transport/channel split sprint complete`
