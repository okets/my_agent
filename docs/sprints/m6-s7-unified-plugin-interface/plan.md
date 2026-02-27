# M6-S7 Sprint Plan — Unified Plugin Interface

**Date:** 2026-02-27
**Status:** Planned
**Milestone:** M6 (Memory — course correction)
**Estimated size:** S (mechanical refactor, ~1 day)

---

## Motivation

M6-S6 added health checks to both channels (`healthCheck?()` on `ChannelPlugin`) and embeddings (`isReady()` + `checkHealth()` on `OllamaEmbeddingsPlugin`). The two interfaces define health, status, and lifecycle independently with different shapes, names, and return types. The dashboard has type-specific code for each.

This sprint introduces a `Plugin` base interface that both `ChannelPlugin` and `EmbeddingsPlugin` extend. Today it standardizes health and status. Tomorrow it's the natural place to add shared capabilities (config, metadata, dispose) without reinventing things per plugin type.

### Design decisions

1. **Flat interface, not adapter bags.** OpenClaw uses optional capability bags (`status?`, `heartbeat?`, `gateway?`). We use TypeScript `extends` — simpler to understand, better IDE support.
2. **OpenClaw compatibility rejected.** OpenClaw plugins are thin config wrappers around a monolithic core — you can't import one without importing all of OpenClaw. Our plugins are self-contained. New channels are M-sized work each against our interface.
3. **MCP alignment deferred.** MCP wrapping was considered but rejected for channels — it adds serialization overhead and process boundaries for no benefit. Channels stay in-process. MCP alignment happens in M6.5 for tools, not for plugin lifecycle.

---

## Base Types

```typescript
// ── Plugin base ─────────────────────────────────────────────

type PluginType = 'channel' | 'embeddings' | string

type PluginState =
  | 'active'        // Healthy and operational
  | 'degraded'      // Was active, now unhealthy
  | 'connecting'    // Starting up
  | 'disconnected'  // Cleanly stopped
  | 'error'         // Failed, not recovering

interface HealthResult {
  healthy: boolean
  message?: string      // "Ollama unreachable"
  resolution?: string   // "Start the Docker container"
  since?: Date          // When this state started
}

interface PluginStatus {
  state: PluginState
  lastHealthCheck?: Date
  error?: string
  detail?: Record<string, unknown>  // Plugin-specific extras
}

interface Plugin {
  readonly id: string
  readonly name: string
  readonly type: PluginType
  readonly icon: string             // SVG string (viewBox="0 0 24 24")
  healthCheck(): Promise<HealthResult>
  status(): PluginStatus
}
```

### Channel extends Plugin

```typescript
interface ChannelPlugin extends Plugin {
  readonly type: 'channel'
  init(config: ChannelInstanceConfig): Promise<void>
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(to: string, message: OutgoingMessage): Promise<void>
  on(event: 'message', handler: (msg: IncomingMessage) => void): void
  on(event: 'error', handler: (err: Error) => void): void
  on(event: 'status', handler: (status: PluginStatus) => void): void
  on(event: 'qr', handler: (qrDataUrl: string) => void): void
}
```

Changes from current: `icon` moves to base. `healthCheck()` returns `HealthResult` instead of `boolean`. `status` event emits `PluginStatus`. Adds `type`, `id`.

### Embeddings extends Plugin

```typescript
interface EmbeddingsPlugin extends Plugin {
  readonly type: 'embeddings'
  readonly modelName: string
  readonly modelSize?: string
  getDimensions(): number | null
  isReady(): Promise<boolean>
  initialize(options?: InitializeOptions): Promise<void>
  cleanup(): Promise<void>
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
}
```

Changes from current: adds `Plugin` base (type, icon, healthCheck, status). `icon` is new (lightbulb/brain SVG for dashboard). `healthCheck()` replaces the ad-hoc `checkHealth()` method.

---

## Tasks

### Task 1: Core types

**File:** `packages/core/src/plugin/types.ts` (new)

- Define `Plugin`, `PluginType`, `PluginState`, `HealthResult`, `PluginStatus`
- Export from `packages/core/src/lib.ts`

### Task 2: Align ChannelPlugin

**File:** `packages/core/src/channels/types.ts`

- `ChannelPlugin extends Plugin`
- Remove `icon` (now inherited)
- `healthCheck()` returns `Promise<HealthResult>` (was `Promise<boolean>`)
- Add `readonly type: 'channel'`
- Add `readonly id: string` (was implicit in config)
- `status` event emits `PluginStatus` (map from `ChannelStatus` internally)
- Keep `ChannelStatus` as internal detail type — plugins track it, but expose `PluginStatus` through `status()`

### Task 3: Align EmbeddingsPlugin

**File:** `packages/core/src/memory/embeddings/types.ts`

- `EmbeddingsPlugin extends Plugin`
- Add `readonly type: 'embeddings'`
- Add `readonly icon: string`
- `healthCheck()` replaces `checkHealth()` — returns `HealthResult`
- `isReady()` stays (embeddings-specific: "can I embed right now?")
- Remove `PluginDegradedState` — replaced by `HealthResult` + `PluginStatus`
- Remove `deriveResolution()` — resolution now comes from the plugin's `healthCheck()` response

### Task 4: Update plugin implementations

**BaileysPlugin** (`plugins/channel-whatsapp/src/plugin.ts`):
- Add `type = 'channel' as const`
- Add `id` property (from config)
- `healthCheck()` returns `HealthResult` instead of boolean
- Add `status(): PluginStatus` mapping `ChannelStatus` → `PluginStatus`

**MockChannelPlugin** (`packages/dashboard/src/channels/mock-plugin.ts`):
- Same changes as Baileys

**OllamaEmbeddingsPlugin** (`packages/core/src/memory/embeddings/ollama.ts`):
- Add `type = 'embeddings' as const`
- Add `icon` (lightbulb SVG)
- Rename `checkHealth()` → `healthCheck()` returning `HealthResult`
- Add `status(): PluginStatus`

**LocalEmbeddingsPlugin** (`packages/core/src/memory/embeddings/local.ts`):
- Same changes as Ollama

### Task 5: Update dashboard liveness & UI

**Liveness loop** (`packages/dashboard/src/index.ts`):
- Use `plugin.healthCheck()` → `HealthResult` instead of `isReady()` → boolean + `deriveResolution()`
- Use `plugin.status().state` for degraded/active decisions

**PluginRegistry** (`packages/core/src/memory/embeddings/registry.ts`):
- Store `HealthResult` instead of `PluginDegradedState`
- Simplify `setDegraded()` / `getDegradedState()` to use `HealthResult`

**API routes** (`packages/dashboard/src/routes/memory.ts`):
- `GET /api/memory/status` returns `HealthResult` shape for degraded info

**WebSocket protocol** (`packages/dashboard/src/ws/protocol.ts`):
- `MemoryStats.degraded` uses `HealthResult` shape

**Frontend** (`packages/dashboard/public/js/app.js`, `index.html`):
- Adapt to new degraded shape (field renames: `error` → `message`, etc.)

### Task 6: Verify

- Restart server, verify active → degraded → recovered cycle works
- Verify Settings badge shows message + resolution from `HealthResult`
- Verify home tab icons work on desktop + mobile
- Run `npx tsc --noEmit` on core (clean)

---

## Files changed

| File | Change |
|------|--------|
| `packages/core/src/plugin/types.ts` | **New** — Plugin, PluginType, PluginState, HealthResult, PluginStatus |
| `packages/core/src/lib.ts` | Export new plugin types |
| `packages/core/src/channels/types.ts` | ChannelPlugin extends Plugin |
| `packages/core/src/memory/embeddings/types.ts` | EmbeddingsPlugin extends Plugin, remove PluginDegradedState |
| `packages/core/src/memory/embeddings/registry.ts` | Use HealthResult instead of PluginDegradedState |
| `packages/core/src/memory/embeddings/ollama.ts` | healthCheck() → HealthResult, add icon/type/status |
| `packages/core/src/memory/embeddings/local.ts` | Same |
| `packages/dashboard/src/channels/mock-plugin.ts` | Align to Plugin base |
| `plugins/channel-whatsapp/src/plugin.ts` | Align to Plugin base |
| `packages/dashboard/src/index.ts` | Liveness loop uses HealthResult |
| `packages/dashboard/src/routes/memory.ts` | API uses HealthResult shape |
| `packages/dashboard/src/ws/protocol.ts` | WS uses HealthResult shape |
| `packages/dashboard/public/js/app.js` | Frontend adapts to new shape |
| `packages/dashboard/public/index.html` | Badge field names |

---

## Acceptance criteria

- [ ] `Plugin` base interface exists with id, name, type, icon, healthCheck, status
- [ ] `ChannelPlugin extends Plugin` — no duplicate fields
- [ ] `EmbeddingsPlugin extends Plugin` — no duplicate fields
- [ ] All 4 plugin implementations (Baileys, Mock, Ollama, Local) implement `Plugin`
- [ ] `PluginDegradedState` and `deriveResolution()` removed — replaced by `HealthResult`
- [ ] Dashboard liveness loop works with `HealthResult`
- [ ] Settings badge shows `HealthResult.message` and `HealthResult.resolution`
- [ ] Home tab icons reflect `PluginStatus.state`
- [ ] `npx tsc --noEmit` passes on core package
- [ ] Active → degraded → recovered cycle verified end-to-end

---

## Extensibility path

Future additions to `Plugin` (all optional, backwards-compatible):

```typescript
interface Plugin {
  // ... existing ...
  configure?(settings: Record<string, unknown>): Promise<void>
  metadata?(): PluginMetadata    // capabilities, version, description
  dispose?(): Promise<void>      // unified cleanup
}
```

Each addition extends the base without touching type-specific interfaces.
