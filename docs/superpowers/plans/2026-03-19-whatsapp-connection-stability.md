# WhatsApp Connection Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the watchdog death loop that kills WhatsApp sessions after 30 minutes of inactivity, and harden credential persistence across service restarts.

**Architecture:** Remove the message-activity watchdog (Baileys' built-in 30s keepalive makes it redundant and it actively harms stability). Add credential flush on plugin disconnect. Move reconnect counter reset from connection-open to message-receipt to prevent infinite reconnect loops.

**Tech Stack:** TypeScript, Vitest, Baileys v7.0.0-rc.9

**Spec:** `docs/sprints/m3-s5-connection-stability/plan.md`

**Branch:** `fix/m3-s5-whatsapp-connection-stability`

---

### Task 1: Create branch

**Files:** None

- [ ] **Step 1: Create feature branch from current HEAD**

```bash
git checkout -b fix/m3-s5-whatsapp-connection-stability
```

- [ ] **Step 2: Verify clean state**

```bash
git status
```

Expected: On branch `fix/m3-s5-whatsapp-connection-stability`, clean working tree (untracked files are fine).

---

### Task 2: Flush credentials on plugin disconnect

**Files:**
- Modify: `plugins/channel-whatsapp/src/plugin.ts:500-515` (disconnect method)

This is the safest change — purely additive, no removal. Do it first.

- [ ] **Step 1: Add credential flush before socket close**

In `plugins/channel-whatsapp/src/plugin.ts`, modify the `disconnect()` method (line 500) to flush the save queue before closing the socket:

```typescript
  async disconnect(): Promise<void> {
    // Flush any pending credential saves before closing the socket.
    // Without this, a systemctl restart can lose in-flight credential writes.
    // The saveQueue is already flushed in connect() (line 164) before creating
    // a new socket — this mirrors that pattern for disconnect.
    await this.saveQueue.flush();

    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.socketReady = null;

    this._status = {
      ...this._status,
      running: false,
      connected: false,
      lastEventAt: new Date(),
    };

    this.emitStatus();
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to `saveQueue` or `disconnect`.

- [ ] **Step 3: Commit**

```bash
git add plugins/channel-whatsapp/src/plugin.ts
git commit -m "fix(m3-s5): flush credential save queue on disconnect

Prevents credential loss during service restarts (systemctl restart).
The saveQueue was already flushed in connect() before creating a new
socket — this mirrors that pattern for the disconnect path."
```

---

### Task 3: Remove watchdog from channel manager

**Files:**
- Modify: `packages/dashboard/src/channels/manager.ts`

This is the core fix. Remove all watchdog-related code from the channel manager.

- [ ] **Step 1: Remove WatchdogConfig import and DEFAULT_WATCHDOG constant**

In `packages/dashboard/src/channels/manager.ts`, remove `WatchdogConfig` from the import (line 19) and delete the `DEFAULT_WATCHDOG` constant (lines 30-35):

Remove from imports (line 19):
```typescript
// Before:
import type {
  Plugin,
  ChannelPlugin,
  PluginFactory,
  ChannelInstanceConfig,
  ChannelStatus,
  ChannelInfo,
  IncomingMessage,
  OutgoingMessage,
  ReconnectPolicy,
  WatchdogConfig,
} from "@my-agent/core";

// After:
import type {
  Plugin,
  ChannelPlugin,
  PluginFactory,
  ChannelInstanceConfig,
  ChannelStatus,
  ChannelInfo,
  IncomingMessage,
  OutgoingMessage,
  ReconnectPolicy,
} from "@my-agent/core";
```

Delete the `DEFAULT_WATCHDOG` constant (lines 30-35):
```typescript
// DELETE these lines:
/** Default watchdog configuration */
const DEFAULT_WATCHDOG: WatchdogConfig = {
  enabled: true,
  checkIntervalMs: 60000, // 1 minute
  timeoutMs: 1800000, // 30 minutes
};
```

- [ ] **Step 2: Remove watchdogTimer from ChannelEntry interface**

In the `ChannelEntry` interface (line 38), remove the `watchdogTimer` field (line 43):

```typescript
// Before:
interface ChannelEntry {
  config: ChannelInstanceConfig;
  plugin: ChannelPlugin;
  status: ChannelStatus;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  watchdogTimer: ReturnType<typeof setInterval> | null;
  debouncer: MessageDebouncer<IncomingMessage> | null;
  /** Flag to suppress reconnects during QR pairing */
  pairing: boolean;
}

// After:
interface ChannelEntry {
  config: ChannelInstanceConfig;
  plugin: ChannelPlugin;
  status: ChannelStatus;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  debouncer: MessageDebouncer<IncomingMessage> | null;
  /** Flag to suppress reconnects during QR pairing */
  pairing: boolean;
}
```

- [ ] **Step 3: Remove watchdogTimer initialization in registerChannel**

In `registerChannel()`, remove `watchdogTimer: null` from the entry initialization (~line 181):

```typescript
// Remove this line:
      watchdogTimer: null,
```

- [ ] **Step 4: Remove watchdog startup from registerChannel**

Remove the watchdog setup block (~lines 263-269):

```typescript
// DELETE these lines:
    // Start watchdog if applicable
    if (config.role === "dedicated" && config.processing === "immediate") {
      const watchdogConfig = this.getWatchdogConfig(config);
      if (watchdogConfig.enabled) {
        this.startWatchdog(id, watchdogConfig);
      }
    }
```

- [ ] **Step 5: Remove watchdog cleanup from removeChannel**

In `removeChannel()`, remove the watchdog timer cleanup (~lines 524-528):

```typescript
// DELETE these lines:
    // Stop watchdog
    if (entry.watchdogTimer) {
      clearInterval(entry.watchdogTimer);
      entry.watchdogTimer = null;
    }
```

- [ ] **Step 6: Remove watchdog cleanup from disconnectAll**

In `disconnectAll()`, remove the watchdog timer cleanup (~lines 591-595):

```typescript
// DELETE these lines:
      // Clear watchdog timer
      if (entry.watchdogTimer) {
        clearInterval(entry.watchdogTimer);
        entry.watchdogTimer = null;
      }
```

- [ ] **Step 7: Remove startWatchdog method and getWatchdogConfig method**

Delete the entire `startWatchdog` method (~lines 807-840) and `getWatchdogConfig` method (~lines 852-860):

```typescript
// DELETE startWatchdog (lines 807-840)
// DELETE getWatchdogConfig (lines 852-860)
```

- [ ] **Step 8: Update module docstring**

Update the top-of-file comment (line 5) to remove "watchdog":

```typescript
// Before:
 * resilience features (reconnection, watchdog, dedup, debounce),

// After:
 * resilience features (reconnection, dedup, debounce),
```

- [ ] **Step 9: Remove watchdog from runtime channel registration route**

In `packages/dashboard/src/routes/channels.ts`, delete the `watchdog` property from the channel config object (~line 79):

```typescript
// DELETE this line:
      watchdog: { enabled: true, checkIntervalMs: 60000, timeoutMs: 1800000 },
```

- [ ] **Step 10: Update shutdown comment in index.ts**

In `packages/dashboard/src/index.ts`, update the comment at ~line 986:

```typescript
// Before:
      // Disconnect all channels first (clears reconnect + watchdog timers)

// After:
      // Disconnect all channels first (clears reconnect timers)
```

- [ ] **Step 11: Verify TypeScript compiles**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 12: Commit**

```bash
git add packages/dashboard/src/channels/manager.ts packages/dashboard/src/routes/channels.ts packages/dashboard/src/index.ts
git commit -m "fix(m3-s5): remove watchdog death loop from channel manager

The message-activity watchdog caused an infinite disconnect/reconnect
loop: after 30min of no user messages it force-disconnected, reconnect
succeeded in ~2s, but lastMessageAt was never reset so the watchdog
fired again 60s later. Logs showed 73 cycles in 70 minutes.

Baileys has a built-in keepalive ping (30s) that detects dead sockets
and emits connection:close, which our reconnect logic already handles.
The watchdog added no safety beyond this and actively killed sessions."
```

---

### Task 4: Remove WatchdogConfig from core types and config

**Files:**
- Modify: `packages/core/src/channels/types.ts:75-80,159-160`
- Modify: `packages/core/src/channels/index.ts:7`
- Modify: `packages/core/src/lib.ts:86`
- Modify: `packages/core/src/config.ts:5,33-37,76,132,141-144,168-171`

- [ ] **Step 1: Remove WatchdogConfig interface from types.ts**

In `packages/core/src/channels/types.ts`, delete the `WatchdogConfig` interface (lines 75-80):

```typescript
// DELETE these lines:
/** Watchdog timer configuration */
export interface WatchdogConfig {
  enabled: boolean
  checkIntervalMs: number
  timeoutMs: number
}
```

And remove the `watchdog` field from `ChannelInstanceConfig` (line 159-160):

```typescript
// DELETE these lines:
  /** Watchdog config overrides */
  watchdog?: Partial<WatchdogConfig>
```

- [ ] **Step 2: Remove WatchdogConfig re-export from channels/index.ts**

In `packages/core/src/channels/index.ts`, remove `WatchdogConfig` from the type exports (line 7):

```typescript
// Before:
export type {
  ChannelDisplayStatus,
  ChannelStatus,
  ReconnectPolicy,
  WatchdogConfig,
  IncomingMessage,
  OutgoingMessage,
  ChannelAttachment,
  ChannelInstanceConfig,
  ChannelPlugin,
  PluginFactory,
  ChannelInfo,
} from './types.js'

// After:
export type {
  ChannelDisplayStatus,
  ChannelStatus,
  ReconnectPolicy,
  IncomingMessage,
  OutgoingMessage,
  ChannelAttachment,
  ChannelInstanceConfig,
  ChannelPlugin,
  PluginFactory,
  ChannelInfo,
} from './types.js'
```

- [ ] **Step 3: Remove WatchdogConfig re-export from lib.ts**

In `packages/core/src/lib.ts`, remove `WatchdogConfig` from the type exports (line 86):

```typescript
// Before:
export type {
  ChannelDisplayStatus,
  ChannelStatus,
  ReconnectPolicy,
  WatchdogConfig,
  IncomingMessage,
  OutgoingMessage,
  ChannelAttachment,
  ChannelInstanceConfig,
  ChannelPlugin,
  PluginFactory,
  ChannelInfo,
} from './channels/index.js'

// After:
export type {
  ChannelDisplayStatus,
  ChannelStatus,
  ReconnectPolicy,
  IncomingMessage,
  OutgoingMessage,
  ChannelAttachment,
  ChannelInstanceConfig,
  ChannelPlugin,
  PluginFactory,
  ChannelInfo,
} from './channels/index.js'
```

- [ ] **Step 4: Remove WatchdogConfig from config.ts**

In `packages/core/src/config.ts`:

Remove `WatchdogConfig` from import (line 5):
```typescript
// Before:
import type { ChannelInstanceConfig, ReconnectPolicy, WatchdogConfig } from './channels/types.js'

// After:
import type { ChannelInstanceConfig, ReconnectPolicy } from './channels/types.js'
```

Delete `DEFAULT_WATCHDOG` constant (lines 33-37):
```typescript
// DELETE:
const DEFAULT_WATCHDOG: WatchdogConfig = {
  enabled: true,
  checkIntervalMs: 60000,
  timeoutMs: 1800000,
}
```

Remove `watchdog` from `YamlConfig.channels.defaults` (line 76):
```typescript
// Before:
    defaults?: {
      reconnect?: Partial<ReconnectPolicy>
      watchdog?: Partial<WatchdogConfig>
      debounceMs?: number
    }

// After:
    defaults?: {
      reconnect?: Partial<ReconnectPolicy>
      debounceMs?: number
    }
```

Remove `watchdog` from `defaultsOverride` type (lines 130-134):
```typescript
// Before:
  const defaultsOverride = channelsSection.defaults as
    | {
        reconnect?: Partial<ReconnectPolicy>
        watchdog?: Partial<WatchdogConfig>
        debounceMs?: number
      }
    | undefined

// After:
  const defaultsOverride = channelsSection.defaults as
    | {
        reconnect?: Partial<ReconnectPolicy>
        debounceMs?: number
      }
    | undefined
```

Delete `mergedWatchdog` (lines 141-144):
```typescript
// DELETE:
  const mergedWatchdog: WatchdogConfig = {
    ...DEFAULT_WATCHDOG,
    ...(defaultsOverride?.watchdog ?? {}),
  }
```

Delete `watchdog` from channel config construction (lines 168-171):
```typescript
// DELETE:
      watchdog: {
        ...mergedWatchdog,
        ...((channelYaml.watchdog as Partial<WatchdogConfig>) ?? {}),
      },
```

Remove `'watchdog'` from the `knownKeys` set (~line 191):
```typescript
// DELETE this line from the knownKeys set:
      'watchdog',
```

- [ ] **Step 5: Build core package to verify**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 6: Build dashboard package to verify**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors. The dashboard already had its `WatchdogConfig` import removed in Task 3.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/channels/types.ts packages/core/src/channels/index.ts packages/core/src/lib.ts packages/core/src/config.ts
git commit -m "fix(m3-s5): remove WatchdogConfig from core types and config

Completes watchdog removal — cleans up the type definition, re-exports
from channels/index.ts and lib.ts, and all watchdog-related config
parsing in loadChannelConfigs()."
```

---

### Task 5: Move reconnect counter reset to message receipt

**Files:**
- Modify: `packages/dashboard/src/channels/manager.ts:637,742`

- [ ] **Step 1: Remove reconnectAttempts reset from handlePluginStatus connected branch**

In `packages/dashboard/src/channels/manager.ts`, in `handlePluginStatus()` connected branch (~line 742), remove the `reconnectAttempts` reset:

```typescript
// Before (in the `} else if (newStatus.connected) {` block):
      entry.status.reconnectAttempts = 0;

// DELETE that line. Keep everything else in this block:
      // Successfully connected — reset reconnect state and pairing flag
      if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
      }
      // entry.status.reconnectAttempts = 0;  <-- REMOVED
      entry.pairing = false;
      this.phonePairingChannels.delete(channelId);
```

Note: Keep the `reconnectAttempts = 0` in the pairing mode entry (`manager.ts:440`) — that's a deliberate fresh-start for new pairing attempts.

- [ ] **Step 2: Add reconnectAttempts reset to handlePluginMessage**

In `handlePluginMessage()`, after the existing `lastMessageAt` update (~line 637), add the reconnect counter reset:

```typescript
    // Update last message timestamp
    entry.status.lastMessageAt = new Date();

    // Reset reconnect attempts on real message receipt.
    // This ensures the 50-attempt cap is only reset by genuine activity,
    // not by a successful reconnect (which could enable infinite reconnect loops).
    entry.status.reconnectAttempts = 0;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/channels/manager.ts
git commit -m "fix(m3-s5): reset reconnect counter on message receipt, not connection

Previously reconnectAttempts reset to 0 on every successful connect,
meaning the 50-attempt cap could never be reached in a reconnect loop.
Now it only resets when a real message arrives — genuine activity."
```

---

### Task 6: Verify full build and restart service

**Files:** None (verification only)

- [ ] **Step 1: Run full TypeScript check across both packages**

```bash
cd packages/core && npx tsc --noEmit && echo "core OK"
cd packages/dashboard && npx tsc --noEmit && echo "dashboard OK"
```

Expected: Both "OK".

- [ ] **Step 2: Run existing tests**

```bash
cd packages/dashboard && npx vitest run 2>&1 | tail -20
```

Expected: All existing tests pass (none should be affected by these changes).

- [ ] **Step 3: Restart the dashboard service**

```bash
systemctl --user restart nina-dashboard.service
```

- [ ] **Step 4: Check service started cleanly**

```bash
systemctl --user status nina-dashboard.service
journalctl --user -u nina-dashboard.service --since "1 minute ago" 2>&1 | head -30
```

Expected: Service is `active (running)`. Logs should show normal startup with NO "Starting watchdog" messages.

- [ ] **Step 5: Verify no watchdog entries in logs**

```bash
journalctl --user -u nina-dashboard.service --since "1 minute ago" 2>&1 | grep -i watchdog
```

Expected: No output (no watchdog-related log lines).

- [ ] **Step 6: Verify WhatsApp auto-connected**

```bash
journalctl --user -u nina-dashboard.service --since "1 minute ago" 2>&1 | grep -iE "Auto-connecting|Connected channel|opened connection"
```

Expected: Auto-connect and successful connection messages.

---

### Task 7: Update sprint docs

**Files:**
- Modify: `docs/sprints/m3-s5-connection-stability/plan.md` (update status)

- [ ] **Step 1: Update sprint status to Complete**

In `docs/sprints/m3-s5-connection-stability/plan.md`, change the status line:

```markdown
// Before:
> **Status:** Planned

// After:
> **Status:** Complete
```

- [ ] **Step 2: Final commit**

```bash
git add docs/sprints/m3-s5-connection-stability/plan.md
git commit -m "docs(m3-s5): mark connection stability sprint complete"
```
