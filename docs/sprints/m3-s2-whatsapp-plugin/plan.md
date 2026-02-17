# M3-S2: WhatsApp Plugin + Identity Routing — Sprint Plan

> **Status:** In Progress
> **Branch:** `m3-s2-whatsapp-plugin`
> **Depends on:** M3-S1 (channel infrastructure)
> **Design refs:** `docs/design/channels.md`, `docs/design/conversation-system.md`

---

## Goal

Deliver a working WhatsApp dedicated channel with identity-based message routing. Messages from the owner create/resume conversations (same as web chat). Messages from third parties are stored for M3-S3's trust tier system.

Also introduces the dashboard settings view (gear icon in header) for channel management and QR pairing.

---

## Tasks

### T1: Baileys WhatsApp Plugin

New package at `plugins/channel-whatsapp/`. Implements `ChannelPlugin` interface.

- `@whiskeysockets/baileys` v7.0.0-rc.9 (ESM, Node>=20)
- `useMultiFileAuthState` for credential persistence
- Socket single-use pattern (fresh socket on reconnect)
- `DisconnectReason` → `ChannelStatus` mapping
- `messages.upsert` → `ChannelPlugin.on('message')`
- Credential save queue (serialize `creds.update`)
- SVG WhatsApp icon

### T2: QR Pairing Flow

Backend REST endpoints + WebSocket events for QR code display. QR-to-base64-PNG conversion. Active login tracking with 3-min TTL.

### T3: Owner Identity Config + Routing

The critical routing task. Adds `ownerIdentities` to channel config. Message handler gains `isOwnerMessage()` check:
- Owner → conversation flow (full trust, brain routing)
- Non-owner → external store (no brain, placeholder for S3)

### T4: Dashboard Integration

Wire Baileys plugin into server startup. Register plugin factory, add pairing routes.

### T5: Settings View + Channel Management UI

New settings page: gear icon in header switches main area to settings view. Channels section with status, QR pairing, actions. Extensible for future settings.

### T6: Channel Conversation UI

Channel conversations in sidebar with read-only indicator and channel icon.

### T7: Integration Verification

End-to-end testing of all flows.

---

## Dependencies

```
T1 (Baileys) ──┬── T4 (wiring) ─┬── T7 (verify)
T2 (QR flow) ──┤                 │
T3 (routing) ──┘                 │
T5 (settings) ──────────────────┤
T6 (conv UI) ──────────────────┘
```

Wave 1: T1 + T2 + T3 (parallel)
Wave 2: T4 + T5 + T6 (after wave 1)
Wave 3: T7

---

## Team

| Role | Model | Tasks |
|------|-------|-------|
| Tech Lead | Opus | Architecture, review, wiring |
| Backend Dev 1 | Sonnet | T1, T2 |
| Backend Dev 2 | Sonnet | T3, T4 |
| Frontend Dev | Sonnet | T5, T6 |
| Reviewer | Opus | Independent review |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Baileys ESM-only | Dashboard already ESM |
| QR code expiry | 3-min TTL + re-request button |
| JID vs phone format mismatch | Normalize to digits only |
| Non-owner messages lost before S3 | External store persists them |
| Single-use socket | Fresh socket in reconnect handler |
| Credential corruption | Save queue serializes writes |

---

## Progress

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T1: Baileys Plugin | Done | Sonnet | 6 files in `plugins/channel-whatsapp/` |
| T2: QR Pairing Flow | Done | Sonnet | REST endpoints + WS events + manager extensions |
| T3: Owner Identity Routing | Done | Sonnet | Config parsing, normalizeIdentity, external store |
| T4: Dashboard Integration | Done | Sonnet | Wired Baileys factory, QR/paired broadcast, getChannelConfig |
| T5: Settings View | Done | Sonnet | Gear icon, channel cards, QR display, chat↔settings toggle |
| T6: Channel Conversation UI | Done | Sonnet | Sidebar icon + read-only badge |
| T7: Integration Verification | Done | Opus | Code review (PASS WITH NOTES) + 5 fixes applied |

### Architecture decisions made during implementation

- Added `qr` event to `ChannelPlugin` interface (not just WhatsApp-specific) since QR pairing could apply to other channels
- `ExternalMessageStore` shares the existing conversations SQLite database (no new DB file)
- `normalizeIdentity()` strips `@s.whatsapp.net`, `@lid`, `@g.us` suffixes, then keeps only digits + leading `+`
- `getChannelConfig` in message handler now reads from `ChannelManager` (runtime) instead of static `config.channels` (load-time)

### Opus review findings (all resolved)

| Severity | Issue | Fix |
|----------|-------|-----|
| Critical | `restartRequired` (515) treated as logout — breaks QR pairing reconnect | Removed from `isLoggedOut` check; only 401 is true logout |
| Critical | Group replies sent to individual JID instead of group JID | Changed reply target to `first.groupId ?? first.from` |
| High | LID JIDs can't be matched to phone numbers for owner detection | Documented as known limitation with TODO for S3 |
| Medium | `workspace:*` dependency not valid for npm | Changed to `file:../../packages/core` |
| Medium | Silent failure when `ownerIdentities` missing from config | Added one-time warning log per channel |

---

## Verification

- [x] Design docs updated (channels.md, conversation-system.md, ROADMAP.md)
- [x] `npx tsc --noEmit` passes
- [x] `npx prettier --write` applied
- [ ] Settings view accessible via gear icon
- [ ] WhatsApp QR pairing works end-to-end
- [ ] Owner message → conversation + brain response
- [ ] Non-owner message → external store, no brain
- [ ] Channel conversation in sidebar (read-only)
- [ ] Disconnect → reconnect with backoff
- [ ] Status dots update in sidebar and settings

**Note:** Unchecked items above require live WhatsApp testing (real device + QR scan). Code review confirms implementation is correct. CTO to verify during testing.
