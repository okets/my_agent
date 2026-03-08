# WhatsApp Phone Number Pairing — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add phone number pairing as an alternative to QR code scanning for WhatsApp channels, with improved owner verification UX.

**Problem:** Users can't scan a QR code displayed on their own phone screen. Phone number pairing via Baileys `requestPairingCode()` solves this.

---

## Pairing Methods

Two methods, one unified post-pairing flow:

| Method | Default on | How it works |
|--------|-----------|--------------|
| QR Code | Desktop | User clicks "Generate QR" → scans with phone |
| Phone Number | Mobile | User enters number → receives 8-char code → enters in WhatsApp app |

Both use the same Baileys socket. The difference: QR waits for a `connection.update` event with `qr` field; phone number calls `sock.requestPairingCode(number)` and returns a code the user types into WhatsApp (Settings > Linked Devices > Link a Device).

**Important:** QR generation is NOT auto-started. User must press a button. This prevents countdown/timeout issues we had before.

## Plugin Layer

`BaileysPlugin` gets:
- `requestPairingCode(phoneNumber: string): Promise<string>` — normalizes number (strip all non-digit chars), calls `sock.requestPairingCode()`, returns 8-char code
- Must be called after socket creation but before `creds.registered` is true
- Baileys requirement: `printQRInTerminal: false` (already set)

Phone number normalization: accept any format (`+1-555-123-4567`, `(555) 123-4567`, `15551234567`), strip to digits only. Country code required — short local numbers rejected with validation error.

## API Changes

### Modified: `POST /api/channels/:id/pair`

Add optional `phoneNumber` body field:
- **With phoneNumber:** Connect socket → `requestPairingCode(normalized)` → return `{ ok: true, pairingCode: "ABCD-1234" }`
- **Without phoneNumber:** Existing QR flow (connect socket, QR delivered via WebSocket)

### New: `POST /api/channels/:id/remove-owner`

Clears `ownerIdentities` and `ownerJid` from runtime config + persists to `config.yaml`. Allows re-verification if owner changed phone.

## Dashboard UI

### Pairing State (not connected)

**Desktop (QR default):**
- Primary: "Generate QR Code" button
- Secondary: "Or pair by phone number" link → reveals phone input + "Pair" button

**Mobile (phone number default):**
- Primary: Phone number input + "Pair" button
- Secondary: "Or scan QR code" link → reveals "Generate QR" button

Phone input: single text field, accepts any format. Hint text: "Enter number with country code".

### Phone Pairing Active

- Large centered 8-char code (formatted: `ABCD-1234`)
- Instructions: "Open WhatsApp → Settings → Linked Devices → Link a Device → Enter this code"
- No auto-countdown (expires server-side; user retries by clicking Pair again)

### Post-Pairing Owner Verification (dedicated channels only)

Auto-appears after pairing succeeds — no separate button to discover:
- Prompt: "Send this code to verify ownership"
- Large 6-char code, copyable
- 10-minute countdown
- Once verified: shows owner name

### Connected + Verified

- Green badge, owner name
- "Remove owner" button (clears identity, allows re-verification)
- "Disconnect" button

## Owner Verification

Both pairing methods require owner verification for **dedicated** channels only. Personal channels skip this (the owner is the phone's owner).

Flow:
1. Pairing succeeds → channel card auto-shows token prompt
2. User sends 6-char token to agent's WhatsApp
3. Backend matches token, registers sender as owner
4. Dashboard updates to show owner name

"Remove owner" allows re-verification (e.g., owner changed phone number).

---

*Design date: 2026-03-08*
