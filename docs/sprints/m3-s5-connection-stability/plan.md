# M3-S5: WhatsApp Connection Stability — Sprint Plan

> **Status:** Complete
> **Date:** 2026-03-19
> **Branch:** `fix/m3-s5-whatsapp-connection-stability`
> **Depends on:** M3-S1 (channel infrastructure), M3-S2 (WhatsApp plugin)
> **Type:** Correction sprint (stability fix, not new features)

---

## Problem Statement

WhatsApp channel disconnects after ~1-3 days, requiring manual re-authentication via QR code. Investigation on 2026-03-19 identified the root cause and contributing factors.

### Root Cause: Watchdog Death Loop

The channel manager's watchdog timer (`startWatchdog()` in `manager.ts:809`) checks `lastMessageAt` every 60 seconds. After 30 minutes of no **user messages**, it force-disconnects the socket to trigger reconnection. However:

1. `lastMessageAt` is updated on incoming messages in both the manager (`manager.ts:637`) and the plugin (`plugin.ts:412`, `plugin.ts:483`), but the watchdog reads from the manager's `entry.status` which only gets the manager-level update
2. A successful reconnect does NOT reset `lastMessageAt`
3. The watchdog fires again 60 seconds after reconnect (stale `lastMessageAt`)
4. This creates an infinite disconnect/reconnect loop — every 60 seconds

**Evidence from logs (2026-03-16):**
```
04:38:44 Watchdog timeout for ninas_dedicated_whatsapp (1836648ms since last message)
04:38:44 Reconnecting ninas_dedicated_whatsapp in 1947ms (attempt 1)
04:38:46 Attempting reconnect for ninas_dedicated_whatsapp
04:38:48 opened connection to WA
04:39:44 Watchdog timeout for ninas_dedicated_whatsapp (1896648ms since last message)
04:39:44 Reconnecting ninas_dedicated_whatsapp in 1670ms (attempt 1)
...
[73 cycles over ~70 minutes, every cycle shows "attempt 1"]
```

The loop ran for 73 cycles before a service restart killed it. WhatsApp likely flags or throttles sessions with this rapid connect/disconnect pattern, leading to session invalidation.

### Contributing Factor: No Credential Flush on Shutdown

The SIGTERM handler (`index.ts:965`) calls `channelManager.disconnectAll()` → `plugin.disconnect()` → `sock.end()`. But the plugin's `disconnect()` method (`plugin.ts:500`) does not call `saveQueue.flush()`. If a credential update was in-flight during `systemctl restart` (frequent during development), the write is lost.

The `CredentialSaveQueue` (`auth.ts:8-50`) serializes writes correctly during normal operation, and `CredentialBackupManager` (`auth.ts:56-137`) maintains backups. But neither helps if the process exits before the queue drains.

### Non-Issue: Session Timeout

Initial hypothesis was WhatsApp server-side session timeout (~7 days). Investigation revealed Baileys already has a built-in keepalive ping (`keepAliveIntervalMs: 30000` — every 30 seconds) that prevents server-side timeout. The 3-day expiry was caused by the watchdog loop, not session staleness.

---

## Design

### T1: Remove Message-Based Watchdog

**Problem:** The watchdog assumes "no messages = dead connection." For a personal assistant, hours or days between conversations is normal — not a failure signal.

**Solution:** Remove the message-activity watchdog entirely.

**Rationale:**
- Baileys' built-in keepalive (30s ping/pong) detects dead sockets and emits `connection: "close"`
- Our reconnect logic (`handlePluginStatus` → `startReconnect`) already handles `connection: "close"` correctly
- The watchdog adds no safety beyond what Baileys provides, and actively causes harm

**Edge case — silent socket (TCP alive but messages not routing):** This could happen with a server-side shadow ban or protocol-level issue where pings succeed but messages don't deliver. The old watchdog wouldn't help here either — it can't distinguish "no messages because nobody sent any" from "messages lost in transit." This is a WhatsApp server issue outside our control.

**Changes:**
- `packages/core/src/config.ts` — Remove `DEFAULT_WATCHDOG` config, remove `WatchdogConfig` from imports/usage
- `packages/core/src/channels/types.ts` — Remove `WatchdogConfig` interface and `watchdog` from `ChannelInstanceConfig`
- `packages/core/src/channels/index.ts` — Remove `WatchdogConfig` re-export
- `packages/core/src/lib.ts` — Remove `WatchdogConfig` re-export
- `packages/dashboard/src/channels/manager.ts`:
  - Remove `startWatchdog()` method
  - Remove watchdog timer setup from `registerChannel()` (line 264-269)
  - Remove `watchdogTimer` cleanup from `disconnectAll()`
  - Keep `lastMessageAt` updates for UI display — just don't use it for liveness decisions

### T2: Flush Credentials on Disconnect

**Problem:** `plugin.disconnect()` calls `sock.end()` but doesn't flush the credential save queue. Service restarts can lose in-flight credential writes.

**Solution:** Call `saveQueue.flush()` in `disconnect()` before closing the socket.

**Note:** `saveQueue` is already a class instance property (`plugin.ts:117`), and `flush()` is already called in `connect()` before creating a new socket (`plugin.ts:164`). The fix is simply adding the same flush call to `disconnect()`.

**Changes:**
- `plugins/channel-whatsapp/src/plugin.ts` — Add `await this.saveQueue.flush()` at the top of `disconnect()` method (line 500), before `sock.end()`

### T3: Reconnect Attempt Counter Guard

**Problem:** Each watchdog-triggered reconnect resets `reconnectAttempts` to 0 on successful connect, so the 50-attempt cap never kicks in.

**Solution:** With the watchdog removed (T1), this loop can't happen. But as defense-in-depth:
- Only reset `reconnectAttempts` to 0 when a real message arrives, not just on connection open
- This prevents any future reconnect trigger from bypassing the attempt cap

**Changes:**
- `packages/dashboard/src/channels/manager.ts` — Move `reconnectAttempts = 0` from `handlePluginStatus` connected branch (`manager.ts:742`) to `handlePluginMessage` (on actual message receipt)
- Keep the reconnect timer cleanup on connect (we don't want parallel reconnects)
- Keep the separate `reconnectAttempts = 0` in pairing mode entry (`manager.ts:440`) — that's a deliberate fresh-start for new pairing attempts

---

## What We're NOT Changing

These components are working correctly:

- **Reconnect backoff logic** (`backoff.ts`) — exponential with jitter, well-implemented
- **Credential backup/restore** (`auth.ts`) — backup manager + validation on startup
- **Disconnect reason handling** (`plugin.ts:269-340`) — 401/515/transient logic is correct
- **Baileys keepAliveIntervalMs** — default 30s is appropriate
- **Signal key caching** (`makeCacheableSignalKeyStore`) — prevents protocol violations

---

## Dev Workflow Consideration

We frequently recompile and restart the dashboard service during development. The credential flush fix (T2) is especially important for this workflow — every `systemctl restart` is a potential credential loss event without it.

---

## Verification

1. Deploy fix, confirm no watchdog log entries
2. Leave running overnight with no messages — confirm connection stays alive
3. `systemctl restart nina-dashboard` — confirm reconnects cleanly without QR re-pair
4. Send WhatsApp message after 24+ hours of silence — confirm delivery
5. Check logs for any reconnect loops

---

## Files Modified

| File | Change |
|------|--------|
| `packages/core/src/config.ts` | Remove `DEFAULT_WATCHDOG`, remove `WatchdogConfig` imports/usage |
| `packages/core/src/channels/types.ts` | Remove `WatchdogConfig` interface, remove from `ChannelInstanceConfig` |
| `packages/core/src/channels/index.ts` | Remove `WatchdogConfig` re-export |
| `packages/core/src/lib.ts` | Remove `WatchdogConfig` re-export |
| `packages/dashboard/src/channels/manager.ts` | Remove watchdog, move reconnectAttempts reset |
| `plugins/channel-whatsapp/src/plugin.ts` | Flush credentials on disconnect |
