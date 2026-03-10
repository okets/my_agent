# WhatsApp Stability Fixes — Recovery Transcript

> **Source:** Conversation transcript recovered from mobile interface (2026-03-10)
> **Branch:** `feat/whatsapp-phone-pairing` (on master now)
> **Status:** Fixes applied and working

---

## Investigation

Thorough exploration of the WhatsApp channel plugin comparing our implementation with OpenClaw's production patterns.

### Key Files Analyzed

| File | Purpose |
|------|---------|
| `plugins/channel-whatsapp/src/plugin.ts` | BaileysPlugin class, connection lifecycle, message handling (592 lines) |
| `plugins/channel-whatsapp/src/auth.ts` | CredentialSaveQueue for serialized writes (47 lines) |
| `plugins/channel-whatsapp/src/qr.ts` | QR-to-dataURL conversion |
| `packages/core/src/channels/types.ts` | ChannelStatus, ChannelPlugin interface |
| `packages/dashboard/src/channels/manager.ts` | Reconnection, backoff, watchdog, dedup |
| `docs/sprints/m3-s2-whatsapp-plugin/review.md` | Lessons learned, debug tips |

---

## Root Cause Analysis

### Symptom

WhatsApp showed error dot in dashboard. Status: 408 timeout, `lastConnectedAt: null`, `running: false`, `reconnectAttempts: 0`. The plugin gave up without retrying.

### Two Problems Found

**Problem 1: Missing `makeCacheableSignalKeyStore`**

OpenClaw wraps signal keys with an in-memory LRU cache. Without it, every encryption/decryption operation hits the filesystem. Under load, this causes race conditions and corrupted reads, which WhatsApp interprets as a protocol violation and terminates the session.

OpenClaw (`session.ts:113-116`):
```typescript
auth: {
  creds: state.creds,
  keys: makeCacheableSignalKeyStore(state.keys, logger),
},
```

Our code (before fix):
```typescript
auth: state,  // raw state, no caching
```

**Problem 2: Reconnect logic bug**

The reconnect logic in `plugin.ts:267-270`:
```typescript
const isRestartRequired = statusCode === DisconnectReason.restartRequired;
const hadPriorConnection = this._status.lastConnectedAt !== null;
const shouldReconnect = isRestartRequired || hadPriorConnection;
```

Since `lastConnectedAt` is `null` (never connected) and status code is 408 (not 515/restartRequired), `shouldReconnect` evaluates to `false`. The plugin sets `running: false` and stops. A 408 timeout during initial connection should still retry — the timeout could be transient.

---

## Five Fixes Applied

| # | Fix | Confidence | Impact |
|---|-----|------------|--------|
| 1 | **`makeCacheableSignalKeyStore`** — cache signal keys in memory | High | Prevents filesystem race conditions causing protocol violations |
| 2 | **`markOnlineOnConnect: false`** — avoid presence conflicts with phone app | Medium | Reduces unnecessary WhatsApp presence handling |
| 3 | **`syncFullHistory: false`** — prevent heavy history syncs | Medium | Avoids timeouts on reconnect |
| 4 | **WebSocket error handler** (`sock.ws.on("error", ...)`) — catch raw WS errors | Lower | Prevents unhandled errors crashing process or leaving broken socket |
| 5 | **Reconnect logic fix** — 408/503/500 errors now trigger retry instead of giving up | High | Fixes the immediate bug where plugin stopped after first timeout |

### Additional OpenClaw Pattern Not Yet Implemented

- **Credential backup/restore** — `safeSaveCreds()` backs up `creds.json` before every save, `maybeRestoreCredsFromBackup()` restores on corruption. Our `CredentialSaveQueue` serializes writes but doesn't protect against corruption from abrupt shutdowns. Lower priority — more about crash recovery than session stability.

---

## Previously Resolved Issues (M3-S2)

From sprint review, all fixed prior to this session:

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| QR code flickering every 1-2s | Manager reconnect triggered when `!connected && running` during QR | Check `newStatus.lastDisconnect !== null` before reconnect |
| Credentials lost after QR scan | Race condition: socket cleanup before credential save | Added `flush()` to CredentialSaveQueue |
| 515 (restartRequired) treated as logout | Incorrectly in `isLoggedOut` check | Only code 401 is logout |
| Group replies sent as DMs | Using `first.from` instead of group JID | Use `first.groupId ?? first.from` |
| LID JID owner detection fails | LID senders (e.g., `169969@lid`) can't match to phone | Known limitation for S3 |

---

## Connection Architecture Summary

### Three-Layer Reconnection Strategy

1. **Plugin-level** (`plugin.ts`): Detects disconnect reason, decides whether to reconnect based on status code
2. **Channel Manager** (`manager.ts`): Exponential backoff with jitter (initial 2s, max 30s, factor 1.8, jitter 0.25), max 50 attempts, pairing flag suppression
3. **Watchdog timer** (`manager.ts`): Per-channel, checks every 60s, force-reconnects if no message in 30 minutes

### Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 401 | Logged out | Stop, require re-pairing |
| 408 | Timeout | Retry (after fix) |
| 440 | Logged in elsewhere | Require re-pairing |
| 515 | Restart required | Reconnect immediately |
| 403, 411, 428, 500, 503 | Various errors | Retry if had prior connection |

### OpenClaw Patterns Incorporated (M3-S1)

- Exponential backoff with jitter
- Message dedup (LRU + TTL)
- Message debouncing (configurable per-channel)
- Watchdog timer for silent disconnections
- Rich status tracking

---

## Post-Fix Result

After applying all five fixes, server restarted and showed QR code (expected — `makeCacheableSignalKeyStore` changes auth structure). After re-pairing, session held stable.
