# WhatsApp Phone Number Pairing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add phone number pairing as an alternative to QR code for WhatsApp channels, with improved owner verification UX.

**Architecture:** Baileys `sock.requestPairingCode(number)` returns an 8-char code the user enters in WhatsApp app. The existing QR flow stays intact. Both flows feed into the same post-pairing owner verification for dedicated channels. Desktop defaults to QR, mobile defaults to phone number input. **All state transitions are pushed via WebSocket** — the pairing code, like the QR code, is delivered as a broadcast event so all connected dashboard clients stay in sync.

**Tech Stack:** Baileys (WhatsApp), Fastify (API), Alpine.js (UI)

**Key design decision — WebSocket-first state:**
- `POST /api/channels/:id/pair` with `phoneNumber` kicks off the process asynchronously and returns `{ ok: true }` immediately
- The server connects the socket, waits for readiness, calls `requestPairingCode`, then broadcasts `channel_pairing_code` via WebSocket
- This mirrors the QR flow: `POST /pair` → returns ok → QR/code arrives via WS → `channel_paired` on success
- Owner removal broadcasts `channel_owner_removed` so all clients update

---

### Task 1: Add `requestPairingCode()` + socket readiness to BaileysPlugin

Add a method to the WhatsApp plugin that requests a pairing code for a given phone number. Includes socket readiness wait (Baileys needs the WebSocket handshake to complete before `requestPairingCode` can be called).

**Files:**
- Modify: `plugins/channel-whatsapp/src/plugin.ts`

**Step 1: Add socket readiness field**

Add to the class fields (after line 119, near `private messageCache`):

```typescript
// Promise that resolves when the socket is ready for pairing code request
private socketReady: { resolve: () => void; promise: Promise<void> } | null = null;
```

**Step 2: Create readiness signal in `connect()`**

In the `connect()` method, right after `this.sock = sock;` (line 197), add:

```typescript
// Create a readiness signal for phone number pairing
this.socketReady = (() => {
  let resolve: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { resolve: resolve!, promise };
})();
```

**Step 3: Resolve readiness when QR fires**

In the `connection.update` handler, inside the `if (qr)` block (around line 214), add before the `qrToDataUrl` call:

```typescript
// Socket is ready for pairing code request (handshake complete)
if (this.socketReady) {
  this.socketReady.resolve();
}
```

**Step 4: Clean up socketReady in disconnect and reconnect**

In `disconnect()` (around line 467), add:
```typescript
this.socketReady = null;
```

In `connect()`, in the cleanup block where existing socket is cleaned up (around line 147-164), add:
```typescript
this.socketReady = null;
```

**Step 5: Add the `requestPairingCode` method**

Add after the `clearAuth()` method (after line 496):

```typescript
/**
 * Request a pairing code for phone number authentication.
 * Alternative to QR scanning — user enters the returned code
 * in WhatsApp app (Settings > Linked Devices > Link a Device).
 *
 * Must be called AFTER connect() creates the socket. Waits for
 * socket readiness (QR event = handshake complete) before requesting.
 *
 * @param phoneNumber — any format, normalized to digits only
 * @returns 8-character pairing code (e.g., "ABCD-1234")
 */
async requestPairingCode(phoneNumber: string): Promise<string> {
  if (!this.sock) {
    throw new Error("[channel-whatsapp] requestPairingCode() called while disconnected");
  }

  // Wait for socket to be ready (QR event = socket handshake complete)
  if (this.socketReady) {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for socket readiness")), 15000)
    );
    await Promise.race([this.socketReady.promise, timeout]);
  }

  if (this.sock.authState.creds.registered) {
    throw new Error("[channel-whatsapp] Already registered — disconnect and clear auth first");
  }

  // Normalize: strip everything except digits
  const normalized = phoneNumber.replace(/[^\d]/g, "");
  if (normalized.length < 7) {
    throw new Error("Phone number too short — include country code");
  }

  console.log(`[channel-whatsapp] Requesting pairing code for ${normalized.slice(0, 4)}****`);
  const code = await this.sock.requestPairingCode(normalized);
  console.log(`[channel-whatsapp] Pairing code received`);
  return code;
}
```

**Step 6: Verify TypeScript compiles**

Run: `cd plugins/channel-whatsapp && npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add plugins/channel-whatsapp/src/plugin.ts
git commit -m "feat(whatsapp): add requestPairingCode with socket readiness wait"
```

---

### Task 2: Add WebSocket protocol types for pairing code + owner removal

Add new server→client message types so all dashboard clients receive pairing codes and owner changes live.

**Files:**
- Modify: `packages/dashboard/src/ws/protocol.ts`

**Step 1: Add `channel_pairing_code` and `channel_owner_removed` to ServerMessage**

In the `ServerMessage` type union (around line 153-154, near the other channel events), add:

```typescript
| { type: "channel_pairing_code"; channelId: string; pairingCode: string }
| { type: "channel_owner_removed"; channelId: string }
```

**Step 2: Commit**

```bash
git add packages/dashboard/src/ws/protocol.ts
git commit -m "feat(protocol): add channel_pairing_code and channel_owner_removed WS events"
```

---

### Task 3: Add ChannelManager `requestPairingCode` + pairing code event handler

Wire up the channel manager to request pairing codes and emit them as events (parallel to QR code events).

**Files:**
- Modify: `packages/dashboard/src/channels/manager.ts`

**Step 1: Add pairing code handler type and registration**

Add a new handler type after `PairedHandler` (around line 59):

```typescript
/** Pairing code handler signature (phone number pairing) */
type PairingCodeHandler = (channelId: string, pairingCode: string) => void;
```

Add a field to the class (around line 68):

```typescript
private pairingCodeHandler: PairingCodeHandler | null = null;
```

Add registration method after `onPaired` (around line 103):

```typescript
/**
 * Register a pairing code handler (called when phone number pairing returns a code).
 */
onPairingCode(handler: PairingCodeHandler): void {
  this.pairingCodeHandler = handler;
}
```

**Step 2: Add `requestPairingCode` method**

Add after `connectChannel` (after line 389):

```typescript
/**
 * Request a phone number pairing code for a channel.
 * Connects the socket, waits for readiness, requests the code,
 * and emits it via the pairing code handler.
 *
 * This is async fire-and-forget from the caller's perspective —
 * the pairing code is delivered via the pairingCodeHandler (WebSocket broadcast).
 */
async requestPairingCode(channelId: string, phoneNumber: string): Promise<void> {
  const entry = this.channels.get(channelId);
  if (!entry) throw new Error(`Channel not found: ${channelId}`);

  if (!("requestPairingCode" in entry.plugin)) {
    throw new Error(`Channel plugin does not support phone number pairing`);
  }

  try {
    const code = await (entry.plugin as any).requestPairingCode(phoneNumber);
    if (this.pairingCodeHandler) {
      this.pairingCodeHandler(channelId, code);
    }
  } catch (err) {
    console.error(`[ChannelManager] requestPairingCode failed for ${channelId}:`, err);
    // Emit status change with error so frontend can show it
    entry.status.lastError = err instanceof Error ? err.message : String(err);
    for (const handler of this.statusChangeHandlers) {
      handler(channelId, entry.status);
    }
  }
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/dashboard/src/channels/manager.ts
git commit -m "feat(channels): add requestPairingCode with WS event emission"
```

---

### Task 4: Modify pair API endpoint + add remove-owner + wire WS broadcasts

The pair endpoint kicks off phone pairing asynchronously. A new endpoint removes owners. Both broadcast state via WebSocket.

**Files:**
- Modify: `packages/dashboard/src/routes/channels.ts`
- Modify: `packages/dashboard/src/index.ts` (wire the new `onPairingCode` handler)

**Step 1: Modify `POST /api/channels/:id/pair` to accept `phoneNumber`**

In `packages/dashboard/src/routes/channels.ts`, replace the pair route (lines 147-174):

```typescript
// POST /api/channels/:id/pair — trigger QR or phone number pairing
// If channel is in error/logged_out state, clears auth to force fresh pairing
fastify.post<{ Params: { id: string }; Body: { phoneNumber?: string } }>(
  "/api/channels/:id/pair",
  async (request, reply) => {
    const channelManager = fastify.channelManager;
    if (!channelManager) {
      return reply.code(404).send({ error: "No channels configured" });
    }
    const info = channelManager.getChannelInfo(request.params.id);
    if (!info) {
      return reply.code(404).send({ error: "Channel not found" });
    }
    if (info.statusDetail.connected) {
      return reply.code(409).send({ error: "Channel already connected" });
    }
    try {
      // Clear auth for fresh pairing if channel is in error/logged_out state
      const needsFreshAuth =
        info.status === "error" || info.status === "logged_out";
      await channelManager.connectChannel(request.params.id, needsFreshAuth);

      // If phone number provided, fire-and-forget pairing code request.
      // The code will arrive via WebSocket `channel_pairing_code` event.
      const phoneNumber = request.body?.phoneNumber;
      if (phoneNumber) {
        // Don't await — let it run async, code delivered via WS
        channelManager.requestPairingCode(request.params.id, phoneNumber);
      }
      // Without phone number, QR code arrives via WebSocket `channel_qr_code`

      return reply.send({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: message });
    }
  },
);
```

**Step 2: Add `POST /api/channels/:id/remove-owner` endpoint**

Add after the authorize route (after line 191):

```typescript
// POST /api/channels/:id/remove-owner — clear owner identity
fastify.post<{ Params: { id: string } }>(
  "/api/channels/:id/remove-owner",
  async (request, reply) => {
    const channelManager = fastify.channelManager;
    if (!channelManager) {
      return reply.code(404).send({ error: "No channels configured" });
    }
    const info = channelManager.getChannelInfo(request.params.id);
    if (!info) {
      return reply.code(404).send({ error: "Channel not found" });
    }

    // Clear owner from runtime config
    channelManager.updateChannelConfig(request.params.id, {
      ownerIdentities: undefined,
      ownerJid: undefined,
    });

    // Persist to config.yaml
    try {
      saveChannelToConfig(
        request.params.id,
        { owner_identities: null, owner_jid: null },
        fastify.agentDir,
      );
    } catch (err) {
      console.error("[channels] Failed to persist owner removal:", err);
    }

    // Broadcast to all connected clients
    if (fastify.connectionRegistry) {
      fastify.connectionRegistry.broadcastToAll({
        type: "channel_owner_removed",
        channelId: request.params.id,
      });
    }

    return reply.send({ ok: true });
  },
);
```

**Step 3: Wire `onPairingCode` in index.ts**

In `packages/dashboard/src/index.ts`, find where `channelManager.onQrCode` is wired (around line 174-179). Add right after it:

```typescript
// Phone number pairing code → broadcast to all WS clients
channelManager.onPairingCode((channelId, pairingCode) => {
  connectionRegistry.broadcastToAll({
    type: "channel_pairing_code",
    channelId,
    pairingCode,
  });
});
```

**Step 4: Verify TypeScript compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/dashboard/src/routes/channels.ts packages/dashboard/src/index.ts
git commit -m "feat(dashboard): async phone pairing via WS + remove-owner endpoint"
```

---

### Task 5: Update dashboard frontend — app.js

Add phone number pairing state, handle new WS events, add `removeOwner()`.

**Files:**
- Modify: `packages/dashboard/public/js/app.js`

**Step 1: Add new state variables**

In the state section (around line 68-100), add after the `authTokens` line (line 89):

```javascript
// Phone number pairing state
pairingPhoneNumber: {},    // { channelId: "entered number" }
pairingCodes: {},          // { channelId: "ABCD-1234" }
pairingByPhone: {},        // { channelId: true } — tracks which method is active
```

**Step 2: Add `channel_pairing_code` and `channel_owner_removed` WS handlers**

In the WebSocket message handler switch statement, add after the `channel_paired` case (around line 1227):

```javascript
case "channel_pairing_code": {
  // Phone number pairing code received via WebSocket
  this.pairingCodes[data.channelId] = data.pairingCode;
  this.pairingByPhone[data.channelId] = true;
  break;
}

case "channel_owner_removed": {
  // Owner was removed — refresh channels
  this.fetchChannels();
  break;
}
```

**Step 3: Update `channel_paired` handler to auto-trigger auth token for dedicated channels**

Modify the `channel_paired` case (lines 1217-1227):

```javascript
case "channel_paired": {
  // Channel successfully paired — clear QR and pairing code
  if (data.channelId === this.pairingChannelId) {
    this.pairingChannelId = null;
    this.qrCodeDataUrl = null;
  }
  delete this.pairingCodes[data.channelId];
  delete this.pairingByPhone[data.channelId];
  delete this.pairingPhoneNumber[data.channelId];
  this.clearQrCountdown(data.channelId);
  // Refresh channel list to get updated status
  this.fetchChannels();
  // Auto-trigger auth token for dedicated channels
  const pairedCh = this.channels.find((c) => c.id === data.channelId);
  if (pairedCh && pairedCh.role === "dedicated") {
    setTimeout(() => this.requestAuthToken(data.channelId), 500);
  }
  break;
}
```

**Step 4: Modify `pairChannel()` to support phone number**

Replace the existing `pairChannel` method (lines 2468-2484):

```javascript
async pairChannel(channelId, phoneNumber) {
  this.pairingChannelId = channelId;
  this.qrCodeDataUrl = null;
  delete this.pairingCodes[channelId];

  try {
    const body = phoneNumber ? { phoneNumber } : undefined;
    const res = await fetch(`/api/channels/${channelId}/pair`, {
      method: "POST",
      ...(body && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error("[App] Pair failed:", data.error || res.statusText);
      this.pairingChannelId = null;
      alert(data.error || "Pairing failed. Try again.");
      return;
    }
    // Pairing code (or QR code) will arrive via WebSocket
  } catch (err) {
    console.error("[App] Pair request failed:", err);
    this.pairingChannelId = null;
  }
},
```

**Step 5: Add `pairByPhone()` helper method**

Add after `pairChannel`:

```javascript
async pairByPhone(channelId) {
  const number = this.pairingPhoneNumber[channelId];
  if (!number || number.trim().length < 7) {
    alert("Enter a valid phone number with country code");
    return;
  }
  this.pairingByPhone[channelId] = true;
  await this.pairChannel(channelId, number.trim());
},
```

**Step 6: Add `removeOwner()` method**

Add after `requestAuthToken` (after line 2564):

```javascript
async removeOwner(channelId) {
  try {
    const res = await fetch(`/api/channels/${channelId}/remove-owner`, {
      method: "POST",
    });
    if (!res.ok) {
      console.error("[App] Remove owner failed");
    }
    // Owner removal broadcast will arrive via WebSocket
  } catch (err) {
    console.error("[App] Remove owner failed:", err);
  }
},
```

**Step 7: Commit**

```bash
git add packages/dashboard/public/js/app.js
git commit -m "feat(dashboard): WS-driven phone pairing + remove owner in app.js"
```

---

### Task 6: Update dashboard HTML — desktop channel cards

Modify the desktop settings channel UI to show both pairing options and improved owner verification.

**Files:**
- Modify: `packages/dashboard/public/index.html` (desktop channel section, around lines 1240-1378)

**Step 1: Replace the connect button section (lines 1240-1249)**

Replace the simple "Pair" button for disconnected channels with two options:

```html
<!-- Connect/Pair options (for disconnected/logged_out channels) -->
<template
  x-if="ch.status !== 'connected' && ch.status !== 'connecting' && !pairingCodes[ch.id]"
>
  <div class="flex items-center gap-2">
    <button
      @click="pairChannel(ch.id)"
      class="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-[rgba(224,122,95,0.15)] text-[#e07a5f] hover:bg-[rgba(224,122,95,0.25)]"
    >
      Generate QR Code
    </button>
    <span class="text-xs text-tokyo-muted">or</span>
    <button
      @click="pairingByPhone[ch.id] = true; $nextTick(() => $refs['phoneInput_' + ch.id]?.focus())"
      class="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors text-tokyo-muted hover:text-tokyo-text hover:bg-white/5"
    >
      Pair by Phone Number
    </button>
  </div>
</template>
```

**Step 2: Add phone number input section**

Add right after the connect button template (before the QR code display):

```html
<!-- Phone number input (desktop) -->
<template x-if="pairingByPhone[ch.id] && !pairingCodes[ch.id] && ch.status !== 'connected'">
  <div class="p-4 border-t border-white/5">
    <div class="flex items-center gap-2">
      <input
        type="tel"
        x-model="pairingPhoneNumber[ch.id]"
        @keydown.enter="pairByPhone(ch.id)"
        placeholder="Enter number with country code"
        class="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-tokyo-text placeholder-tokyo-muted focus:border-[#e07a5f]/50 focus:outline-none"
      />
      <button
        @click="pairByPhone(ch.id)"
        :disabled="!pairingPhoneNumber[ch.id] || pairingPhoneNumber[ch.id].length < 7"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[rgba(224,122,95,0.15)] text-[#e07a5f] hover:bg-[rgba(224,122,95,0.25)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Pair
      </button>
      <button
        @click="delete pairingByPhone[ch.id]; delete pairingPhoneNumber[ch.id]"
        class="text-xs text-tokyo-muted hover:text-tokyo-text"
      >
        Cancel
      </button>
    </div>
    <p class="text-[10px] text-tokyo-muted mt-1.5">
      Any format works: +1-555-123-4567, 15551234567, etc.
    </p>
  </div>
</template>

<!-- Pairing code display (shown after phone number pairing — arrives via WebSocket) -->
<template x-if="pairingCodes[ch.id]">
  <div class="p-4 border-t border-white/5">
    <p class="text-xs text-tokyo-muted mb-3">
      Open WhatsApp on the phone &rarr; Settings &rarr; Linked Devices &rarr; Link a Device &rarr; enter this code:
    </p>
    <div class="px-6 py-4 rounded-lg bg-white/5 border border-white/10 font-mono text-3xl tracking-[0.4em] text-tokyo-text text-center select-all">
      <span x-text="pairingCodes[ch.id]"></span>
    </div>
    <p class="text-[10px] text-tokyo-muted mt-2 text-center">
      Waiting for confirmation...
    </p>
  </div>
</template>
```

**Step 3: Replace the Authorize Owner / owner info section (lines 1251-1282)**

Replace with improved UX — owner verify only for dedicated, "Remove" instead of "Change":

```html
<!-- Verify Owner button (dedicated channels, no owner, no pending token) -->
<template
  x-if="ch.status === 'connected' && !authTokens[ch.id] && !ch.hasOwner && ch.role === 'dedicated'"
>
  <button
    @click="requestAuthToken(ch.id)"
    class="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-[rgba(224,122,95,0.15)] text-[#e07a5f] hover:bg-[rgba(224,122,95,0.25)]"
  >
    Verify Owner
  </button>
</template>

<!-- Owner info + Remove button (when has owner) -->
<template
  x-if="ch.status === 'connected' && !authTokens[ch.id] && ch.hasOwner"
>
  <div class="flex items-center gap-2">
    <span class="text-xs text-tokyo-muted">
      Owner:
      <span
        class="text-tokyo-text"
        x-text="ch.ownerNumber || 'Verified'"
      ></span>
    </span>
    <button
      @click="removeOwner(ch.id)"
      class="text-xs px-2 py-1 rounded font-medium text-tokyo-muted hover:text-tokyo-text hover:bg-white/5 transition-colors"
    >
      Remove
    </button>
  </div>
</template>
```

**Step 4: Verify in browser**

Restart dashboard: `systemctl --user restart nina-dashboard.service`
Open dashboard, navigate to Settings > Channels. Check:
- Disconnected channel shows "Generate QR Code" and "Pair by Phone Number"
- Phone number input appears when clicking "Pair by Phone Number"
- Connected + dedicated channel shows "Verify Owner" when no owner
- Connected + has owner shows owner number + "Remove" button

**Step 5: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(dashboard): desktop UI for phone number pairing + owner management"
```

---

### Task 7: Update dashboard HTML — mobile channel cards

Mirror the desktop changes for mobile, but with phone number as the default pairing method.

**Files:**
- Modify: `packages/dashboard/public/index.html` (mobile channel section, around lines 5250-5340)

**Step 1: Replace the mobile pair button area (around lines 5250-5265)**

Replace with phone-first layout:

```html
<!-- Pair options (mobile — phone number is default) -->
<template x-if="channel.status !== 'connected' && channel.status !== 'connecting' && !pairingCodes[channel.id]">
  <div class="px-3 pb-3">
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <input
          type="tel"
          x-model="pairingPhoneNumber[channel.id]"
          @keydown.enter="pairByPhone(channel.id)"
          placeholder="Phone with country code"
          class="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-tokyo-text placeholder-tokyo-muted focus:border-[#e07a5f]/50 focus:outline-none"
        />
        <button
          @click="pairByPhone(channel.id)"
          :disabled="!pairingPhoneNumber[channel.id] || pairingPhoneNumber[channel.id].length < 7"
          class="px-4 py-2 rounded-lg text-sm font-medium bg-[rgba(224,122,95,0.15)] text-[#e07a5f] active:bg-[rgba(224,122,95,0.25)] disabled:opacity-40"
        >
          Pair
        </button>
      </div>
      <button
        @click="pairChannel(channel.id)"
        class="text-xs text-tokyo-muted active:text-tokyo-text text-left"
      >
        Or scan QR code instead
      </button>
    </div>
  </div>
</template>
```

**Step 2: Add pairing code display for mobile**

Add before the existing QR code display template:

```html
<!-- Pairing code display (mobile — arrives via WebSocket) -->
<template x-if="pairingCodes[channel.id]">
  <div class="p-3 border-t border-white/5">
    <p class="text-xs text-tokyo-muted mb-2">
      WhatsApp &rarr; Linked Devices &rarr; Link a Device &rarr; enter code:
    </p>
    <div class="px-4 py-3 rounded-lg bg-white/5 border border-white/10 font-mono text-2xl tracking-[0.3em] text-tokyo-text text-center select-all">
      <span x-text="pairingCodes[channel.id]"></span>
    </div>
    <p class="text-[10px] text-tokyo-muted mt-1.5 text-center">
      Waiting for confirmation...
    </p>
  </div>
</template>
```

**Step 3: Update mobile connected actions (around lines 5268-5308)**

Replace the owner section:

```html
<!-- Actions for connected channels (mobile) -->
<template x-if="channel.status === 'connected'">
  <div class="px-3 pb-3 flex flex-wrap gap-2">
    <!-- Verify Owner (dedicated, no owner) -->
    <template
      x-if="!authTokens[channel.id] && !channel.hasOwner && channel.role === 'dedicated'"
    >
      <button
        @click="requestAuthToken(channel.id)"
        class="text-xs px-3 py-1.5 rounded-lg font-medium bg-[rgba(224,122,95,0.15)] text-[#e07a5f] active:bg-[rgba(224,122,95,0.25)]"
      >
        Verify Owner
      </button>
    </template>
    <!-- Owner info (when has owner) -->
    <template
      x-if="!authTokens[channel.id] && channel.hasOwner"
    >
      <div class="flex items-center gap-2">
        <span class="text-xs text-tokyo-muted">
          Owner:
          <span
            class="text-tokyo-text"
            x-text="channel.ownerNumber || 'Verified'"
          ></span>
        </span>
        <button
          @click="removeOwner(channel.id)"
          class="text-xs px-2 py-1 rounded font-medium text-tokyo-muted active:text-tokyo-text active:bg-white/5"
        >
          Remove
        </button>
      </div>
    </template>
    <button
      @click="disconnectChannel(channel.id)"
      class="text-xs px-3 py-1.5 rounded-lg font-medium text-tokyo-muted active:text-tokyo-red active:bg-tokyo-red/10"
    >
      Disconnect
    </button>
  </div>
</template>
```

**Step 4: Add mobile auth token display**

Add after the QR display section (if not already present for mobile):

```html
<!-- Authorization token (mobile) -->
<template
  x-if="authTokens[channel.id] && channel.status === 'connected'"
>
  <div class="p-3 border-t border-white/5 flex flex-col items-center gap-2">
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
      <p class="text-xs text-amber-400 font-medium">
        Owner Verification
      </p>
    </div>
    <p class="text-xs text-tokyo-muted text-center">
      Send this code to the agent's WhatsApp:
    </p>
    <div
      class="px-4 py-2 rounded-lg bg-white/5 border border-white/10 font-mono text-xl tracking-[0.3em] text-tokyo-text text-center select-all"
      x-text="authTokens[channel.id]"
    ></div>
    <p class="text-[10px] text-tokyo-muted">
      Expires in 10 minutes
    </p>
  </div>
</template>
```

**Step 5: Restart and verify on mobile viewport**

Restart dashboard: `systemctl --user restart nina-dashboard.service`
Open dashboard with mobile viewport. Check:
- Phone number input is the default (no QR as primary)
- "Or scan QR code instead" link triggers QR flow
- Pairing code displays after entering number (arrives via WS)
- Owner verification auto-shows for dedicated channels after pairing

**Step 6: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(dashboard): mobile UI for phone number pairing + owner management"
```

---

### Task 8: End-to-end verification

Test the complete flow on the live dashboard.

**Files:** None (testing only)

**Step 1: Restart the dashboard**

```bash
systemctl --user restart nina-dashboard.service
```

**Step 2: Test desktop QR flow (regression)**

1. Open dashboard on desktop
2. Go to Settings > Channels
3. If a channel exists and is disconnected, click "Generate QR Code"
4. Verify QR code appears with countdown
5. Verify no auto-start of QR countdown (user must click button)

**Step 3: Test desktop phone number flow**

1. Click "Pair by Phone Number"
2. Verify input appears with hint text
3. Enter a phone number in any format (parentheses, dashes, spaces — all OK)
4. Click "Pair"
5. Verify "Waiting..." appears briefly, then pairing code arrives via WebSocket
6. Enter code in WhatsApp app (Settings > Linked Devices > Link a Device)
7. Verify channel connects and auth token auto-appears (for dedicated channels)

**Step 4: Test mobile phone number flow**

1. Open dashboard on mobile viewport
2. Verify phone number input is the default (not QR)
3. Test "Or scan QR code instead" link — should trigger QR flow
4. Test phone number pairing flow

**Step 5: Test owner management**

1. Verify "Remove" button appears next to owner info
2. Click "Remove" — verify owner is cleared (via WebSocket broadcast)
3. Verify "Verify Owner" button appears for dedicated channels
4. Request new token, send via WhatsApp
5. Verify ownership is re-established

**Step 6: Test multi-client sync**

1. Open dashboard in two browser tabs
2. In tab A, pair a channel by phone number
3. Verify tab B also shows the pairing code (received via WebSocket)
4. Verify both tabs update when channel connects

**Step 7: Test edge cases**

- Short phone number (< 7 digits) — should show validation error
- Already connected channel — should show "already connected" error
- Socket timeout (> 15s) — should show error via status change

---

**Summary of all changes:**

| File | Change |
|------|--------|
| `plugins/channel-whatsapp/src/plugin.ts` | Add `requestPairingCode()` + socket readiness wait |
| `packages/dashboard/src/ws/protocol.ts` | Add `channel_pairing_code` + `channel_owner_removed` events |
| `packages/dashboard/src/channels/manager.ts` | Add `requestPairingCode()` + `onPairingCode` handler |
| `packages/dashboard/src/routes/channels.ts` | Async phone pairing in pair endpoint + remove-owner endpoint |
| `packages/dashboard/src/index.ts` | Wire `onPairingCode` → WS broadcast |
| `packages/dashboard/public/js/app.js` | WS handlers, `pairByPhone()`, `removeOwner()`, auto-auth-token |
| `packages/dashboard/public/index.html` | Desktop + mobile UI for both pairing methods + owner management |

**WebSocket event flow:**

```
Phone pairing:  POST /pair {phoneNumber} → 200 ok → [server: connect, wait, requestPairingCode]
                → WS channel_pairing_code {channelId, pairingCode}
                → [user enters code in WhatsApp]
                → WS channel_paired {channelId}
                → [dedicated: auto requestAuthToken]
                → WS channel_authorized {channelId, ownerJid}

QR pairing:     POST /pair → 200 ok → [server: connect]
                → WS channel_qr_code {channelId, qrDataUrl}
                → [user scans QR]
                → WS channel_paired {channelId}

Remove owner:   POST /remove-owner → 200 ok
                → WS channel_owner_removed {channelId}
```
