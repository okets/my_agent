# M3-S2: WhatsApp Plugin + Identity Routing — Sprint Review

> **Reviewer:** Opus
> **Verdict:** PASS WITH NOTES
> **Date:** 2026-02-17

---

## Summary

Sprint delivers a working WhatsApp dedicated channel with Baileys, QR pairing, identity-based message routing, a settings view for channel management, and channel conversation indicators in the sidebar. All 7 tasks completed. Opus review caught 5 issues (2 critical, 1 high, 2 medium) — all resolved before completion.

---

## Deliverables

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Baileys WhatsApp plugin | Done | `plugins/channel-whatsapp/` — 6 files |
| QR pairing flow | Done | REST endpoints + WS events + 3-min TTL |
| Identity-based routing | Done | `ownerIdentities` config, `normalizeIdentity()`, external store |
| Dashboard integration | Done | Plugin factory wired, QR/paired broadcast |
| Settings view | Done | Gear icon, channel cards, QR display, actions |
| Channel conversation UI | Done | Sidebar icon + read-only badge |
| Integration verification | Done | Code review + fix cycle |

---

## Files Created

| File | Purpose |
|------|---------|
| `plugins/channel-whatsapp/package.json` | Package config |
| `plugins/channel-whatsapp/tsconfig.json` | TypeScript config |
| `plugins/channel-whatsapp/src/index.ts` | Plugin factory export |
| `plugins/channel-whatsapp/src/plugin.ts` | BaileysPlugin class |
| `plugins/channel-whatsapp/src/auth.ts` | Credential save queue |
| `plugins/channel-whatsapp/src/qr.ts` | QR-to-data-URL conversion |
| `packages/dashboard/src/channels/external-store.ts` | SQLite store for non-owner messages |

## Files Modified

| File | Changes |
|------|---------|
| `packages/core/src/channels/types.ts` | Added `qr` event to `ChannelPlugin`, `ownerIdentities` to config |
| `packages/core/src/config.ts` | Parse `ownerIdentities` / `owner_identities` from YAML |
| `packages/dashboard/src/channels/manager.ts` | QR/pairing handlers, `getChannelConfig()`, removed `as any` cast |
| `packages/dashboard/src/channels/mock-plugin.ts` | Added `qr` event overload |
| `packages/dashboard/src/channels/message-handler.ts` | Owner detection, external routing, group reply fix, missing-config warning |
| `packages/dashboard/src/index.ts` | Baileys factory registration, QR/paired broadcast |
| `packages/dashboard/src/routes/channels.ts` | `POST /pair`, `POST /disconnect` endpoints |
| `packages/dashboard/src/ws/protocol.ts` | `channel_qr_code`, `channel_paired` message types |
| `packages/dashboard/package.json` | Added `@my-agent/channel-whatsapp` dependency |
| `packages/dashboard/public/index.html` | Settings view HTML, gear icon, conversation channel indicators |
| `packages/dashboard/public/js/app.js` | Settings state, WS handlers, pair/disconnect methods, channel helpers |
| `packages/dashboard/public/css/app.css` | Channel icon styles |
| `docs/design/channels.md` | "Conversations vs External Communications" section |
| `docs/design/conversation-system.md` | External Communication terminology, Flow 3 rewrite |
| `docs/ROADMAP.md` | Visual timeline, M3 sprint table, status updates |

---

## Review Findings (Resolved)

### Critical

1. **`restartRequired` (515) treated as logout** — After QR scan, Baileys disconnects with status 515 (restart required). Original code included this in `isLoggedOut`, which prevented reconnection. Fix: only code 401 triggers logout.

2. **Group replies sent to individual JID** — In group chats, `first.from` is the sender's individual JID, not the group. Replies would go as DMs instead of group messages. Fix: use `first.groupId ?? first.from` as reply target.

### High

3. **LID JID owner detection gap** — WhatsApp Link IDs (e.g., `169969@lid`) cannot be matched to phone numbers without a contact store lookup. Owner detection fails for LID senders. Documented as known limitation with TODO for S3.

### Medium

4. **`workspace:*` dependency** — Not valid for npm (only pnpm/yarn). Changed to `file:../../packages/core`.

5. **Silent failure on missing `ownerIdentities`** — If channel config lacks `ownerIdentities`, all messages are silently treated as external. Added one-time console.warn per channel.

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| `qr` event on `ChannelPlugin` interface (not WhatsApp-specific) | Other channels may need pairing (Telegram, etc.) |
| External store shares conversations SQLite DB | No new DB file; same lifecycle, same backup |
| `normalizeIdentity()` strips platform suffixes | JID `+1555000000@s.whatsapp.net` must match config `+1555000000` |
| Runtime `getChannelConfig()` via ChannelManager | Config can change at runtime (e.g., after adding owner identities) |
| Single-use socket pattern | Baileys sockets are not reusable after disconnect |

---

## Known Limitations

| Limitation | Impact | Resolution |
|------------|--------|------------|
| LID JID identity resolution | Owner detection fails for LID senders | S3: Baileys store-based lookup |
| No media message support | Only text messages handled | Future enhancement |
| No message delivery receipts | No read/delivered indicators | Future enhancement |
| External messages stored but not surfaced | No UI for non-owner messages | S3: External communications UI |

---

## Verification Status

| Check | Status |
|-------|--------|
| `npx tsc --noEmit` (core + dashboard) | Pass |
| `npx prettier --write` | Pass |
| Design docs updated | Pass |
| Opus code review | Pass with notes (all resolved) |
| Live testing (QR pairing, messaging) | Pending CTO verification |

---

## User Stories for Testing

### Story 1: Settings View
1. Start the dashboard (`npm run dev` from `packages/dashboard/`)
2. Click the gear icon in the header bar
3. Verify the settings view appears with a "Channels" section
4. Verify channel cards show status, identity, and role
5. Click the gear icon again to return to chat view

### Story 2: WhatsApp QR Pairing
1. Configure a WhatsApp channel in `.my_agent/config.yaml`:
   ```yaml
   channels:
     whatsapp_main:
       plugin: baileys
       role: dedicated
       identity: "+1555000001"
       owner_identities:
         - "+1555000000"
   ```
2. Open settings view, find the WhatsApp channel card
3. Click "Pair" button
4. QR code should appear — scan with WhatsApp on your phone
5. After pairing, status should change to "Connected" (green dot)

### Story 3: Owner Message Flow
1. After pairing, send a WhatsApp message from the owner phone to the agent number
2. A new conversation should appear in the dashboard sidebar with a WhatsApp icon and "read-only" badge
3. The agent should respond via WhatsApp
4. The conversation should be visible (read-only) in the dashboard

### Story 4: Non-Owner Message
1. Send a WhatsApp message from a different phone (not in `owner_identities`)
2. The message should NOT create a conversation or trigger a brain response
3. Check server logs for "External message from..." confirmation
4. The message is stored in the external store (for S3's trust tier system)

### Story 5: Reconnection
1. With WhatsApp connected, restart the dashboard server
2. The channel should auto-reconnect (check status in settings view)
3. Messages sent during downtime should be received after reconnect

---

## Lessons Learned (2026-02-25 Session)

### Baileys/WhatsApp Protocol

| Issue | Root Cause | Fix |
|-------|------------|-----|
| **QR code flickering every 1-2s** | Manager triggered reconnects when `!connected && running`, but during QR display those flags are set *without* an actual disconnect | Check `newStatus.lastDisconnect !== null` before triggering reconnect |
| **Credentials lost after QR scan** | Race condition: socket cleanup ran before credential save completed | Added `flush()` method to `CredentialSaveQueue`; await it before creating new socket |
| **Single-use sockets** | Baileys sockets cannot be reused after disconnect | Always create fresh socket on reconnect; clean up old socket's event listeners first |
| **QR codes expire silently** | QRs expire in ~20s, user has no visual feedback | Added countdown timer to QR display (turns red at ≤5s) |
| **Connection timeout unclear** | ~80s total (4 QR cycles × 20s) before "QR refs attempts ended" error | Added countdown timer showing time until connection fails |

### Reconnection Logic

| Issue | Root Cause | Fix |
|-------|------------|-----|
| **Reconnect loop during QR scan** | Any disconnect triggered reconnect, even when intentionally waiting for QR | Added `entry.pairing` flag to suppress reconnects while QR is displayed |
| **Auto-connect on server start unwanted** | `registerChannel()` auto-called `plugin.connect()` for immediate processing | Disabled auto-connect; user clicks "Pair" to initiate |
| **515 restartRequired treated as logout** | Code 515 (restart required) was in `isLoggedOut` check | Only code 401 triggers logout state |

### UX Decisions

| Decision | Rationale |
|----------|-----------|
| **No auto-connect on startup** | User may not want WhatsApp connecting immediately; prefer manual control |
| **QR countdown timer (20s)** | Visual feedback prevents confusion about why QR "isn't working" |
| **Connecting countdown timer (80s)** | User knows how long until connection attempt times out |
| **On-demand ownership verification** | Auth token flow is optional; user clicks "Verify Ownership" when changing numbers |
| **Human-readable disconnect messages** | "Connection timed out" instead of "Error: QR refs attempts ended" |

### Key Files for Troubleshooting

| File | What to Check |
|------|---------------|
| `plugins/channel-whatsapp/src/plugin.ts` | Socket lifecycle, credential flush, event handlers |
| `plugins/channel-whatsapp/src/auth.ts` | `CredentialSaveQueue.flush()` for race conditions |
| `packages/dashboard/src/channels/manager.ts` | Reconnect logic, pairing flag, status handling |
| `packages/dashboard/public/js/app.js` | QR/connecting timers, channel status handlers |

### Debug Tips

1. **Enable Baileys debug logging**: Change `pino({ level: "silent" })` to `pino({ level: "debug" })` in plugin.ts
2. **Watch for "QR received" logs**: Should only appear once per QR cycle, not repeatedly
3. **Check pairing flag**: If reconnect loop happens during QR, `entry.pairing` isn't being set
4. **Credential flush**: If pairing fails after QR scan, check `flush()` is awaited before new socket

---

## Scope for S3

S3 (Trust & External Communications) will build on S2's foundation:
- Trust tier enforcement for non-owner messages
- External communications UI (separate from conversation sidebar)
- Escalation flow (untrusted → notify owner → decide)
- Auto-respond for untrusted contacts
- Personal channel role (on-demand processing)
- LID identity resolution via Baileys store
