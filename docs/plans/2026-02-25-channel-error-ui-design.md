# Channel Error UI Design

**Date:** 2026-02-25
**Status:** Approved
**Scope:** Self-service error resolution for WhatsApp channel connection issues

---

## Problem

When a WhatsApp channel has an error, the Settings UI shows only a red dot and "error" text. Users have no idea what's wrong or how to fix it.

![Current state: red dot + "error" with no guidance]

## Solution

Add an expandable error panel to channel cards that shows:
1. Human-readable error message
2. Guidance text
3. Two CTAs: "Re-pair Device" (manual) and "Ask Nina" (creates task)

---

## Design

### UI: Expandable Channel Card

**Collapsed (error state):**
```
┌─────────────────────────────────────────────────┐
│ [icon] channel_name  [role]           ● error ▼ │
└─────────────────────────────────────────────────┘
```

**Expanded (on click):**
```
┌─────────────────────────────────────────────────┐
│ [icon] channel_name  [role]           ● error ▲ │
├─────────────────────────────────────────────────┤
│ ⚠️ {Error Title}                                │
│ {Guidance text}                                 │
│                                                 │
│ [Re-pair Device]  [Ask Nina]                    │
└─────────────────────────────────────────────────┘
```

**After "Ask Nina" clicked:**
```
┌─────────────────────────────────────────────────┐
│ [icon] channel_name  [role]   🔸 Nina is on it  │
├─────────────────────────────────────────────────┤
│ ...                                             │
│ [Re-pair Device]  [Ask Nina] ✓                  │
└─────────────────────────────────────────────────┘
```

### Error Messages

The WhatsApp plugin maps Baileys `DisconnectReason` codes to user-friendly messages:

| Code | Reason | User Message |
|------|--------|--------------|
| 401 | loggedOut | "Logged out from WhatsApp. Re-pair your device." |
| 408 | connectionLost / timedOut | "Connection timed out. Check your internet connection." |
| 428 | connectionClosed | "Connection closed unexpectedly. Try re-pairing." |
| 440 | connectionReplaced | "Logged in from another device. Re-pair to use here." |
| 500 | badSession | "Session corrupted. Re-pair required." |
| 503 | unavailableService | "WhatsApp service unavailable. Try again later." |
| 515 | restartRequired | (Not shown as error — normal reconnect) |
| 403 | forbidden | "Access denied by WhatsApp." |
| 411 | multideviceMismatch | "Multi-device sync issue. Re-pair required." |

### Behavior

**Error row click:**
- Toggles expansion with Alpine.js `x-collapse`
- Chevron rotates (▼ → ▲)

**"Re-pair Device" button:**
- Calls existing `pairChannel(channelId)` function
- Triggers QR code flow

**"Ask Nina" button:**
1. Creates task: `"Fix WhatsApp error: {channel_id} - {error_message}"`
2. Shows "Nina is on it" tag on channel card (amber badge)
3. Disables button (shows checkmark)
4. Tag disappears when:
   - Channel status changes to "connected"
   - OR task is marked complete

---

## Data Flow

```
Baileys disconnect event
    ↓
Plugin: Map statusCode to human-readable message
    ↓
Manager: Store in status.lastError
    ↓
API: Return via statusDetail.lastError
    ↓
UI: Display in expanded error panel
```

No new API endpoints needed — data already flows through `GET /api/channels`.

---

## Changes Required

| Component | File | Change |
|-----------|------|--------|
| WhatsApp Plugin | `plugins/channel-whatsapp/src/plugin.ts` | Add `DISCONNECT_MESSAGES` map, use for `errorMessage` |
| Dashboard HTML | `packages/dashboard/public/index.html` | Add expandable error section to channel card |
| Dashboard JS | `packages/dashboard/public/js/app.js` | Add `askNinaAboutChannel()`, `channelHelpTasks` state |
| Task Creation | (existing) | Use existing task creation API |

---

## Scope Boundaries

**In scope:**
- WhatsApp connection errors (session, logout, network)
- Expandable UI pattern
- "Re-pair Device" and "Ask Nina" CTAs

**Out of scope:**
- Delivery errors (message send failures)
- Configuration errors (missing credentials)
- Other channel types (email, etc.) — can extend pattern later

---

## Success Criteria

- [ ] User sees clear error message instead of just "error"
- [ ] "Re-pair Device" triggers QR flow
- [ ] "Ask Nina" creates task and shows immediate feedback
- [ ] Error panel collapses when channel reconnects
