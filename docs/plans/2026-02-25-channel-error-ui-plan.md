# Channel Error UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to self-service WhatsApp connection errors with clear messaging and actionable CTAs.

**Architecture:** Enhance WhatsApp plugin to emit human-readable error messages, then update dashboard UI with expandable error panels and "Ask Nina" task creation.

**Tech Stack:** TypeScript, Alpine.js, Baileys DisconnectReason enum

**Related:** Addendum to M3-S2 WhatsApp Plugin sprint

---

## Task 1: Add Human-Readable Error Messages to WhatsApp Plugin

**Files:**
- Modify: `plugins/channel-whatsapp/src/plugin.ts:140-190`

**Step 1: Add disconnect message map**

Add this constant after line 52 (after `MESSAGE_CACHE_SIZE`):

```typescript
// ─────────────────────────────────────────────────────────────────
// Human-readable disconnect messages
// ─────────────────────────────────────────────────────────────────

const DISCONNECT_MESSAGES: Record<number, string> = {
  401: "Logged out from WhatsApp. Re-pair your device to reconnect.",
  403: "Access denied by WhatsApp.",
  408: "Connection timed out. Check your internet connection.",
  411: "Multi-device sync issue. Re-pair required.",
  428: "Connection closed unexpectedly. Try re-pairing.",
  440: "Logged in from another device. Re-pair to use here.",
  500: "Session corrupted. Re-pair required.",
  503: "WhatsApp service unavailable. Try again later.",
  515: "Reconnecting...", // Normal restart, not shown as error
};

function getDisconnectMessage(statusCode: number | undefined, fallbackError?: string): string {
  if (statusCode !== undefined && DISCONNECT_MESSAGES[statusCode]) {
    return DISCONNECT_MESSAGES[statusCode];
  }
  return fallbackError || "Connection error. Try re-pairing your device.";
}
```

**Step 2: Update error message generation**

Replace lines 149-154 (the `errorMessage` assignment):

```typescript
          const errorMessage = getDisconnectMessage(
            statusCode,
            lastDisconnect?.error instanceof Error
              ? lastDisconnect.error.message
              : undefined
          );
```

**Step 3: Build and verify**

Run:
```bash
cd plugins/channel-whatsapp && npm run build
```

Expected: Build succeeds with no errors.

**Step 4: Commit**

```bash
git add plugins/channel-whatsapp/src/plugin.ts
git commit -m "feat(whatsapp): add human-readable disconnect messages

Map Baileys DisconnectReason codes to user-friendly error messages.
Enables self-service error resolution in Settings UI.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Expandable Error Panel State to Dashboard

**Files:**
- Modify: `packages/dashboard/public/js/app.js:130-160` (state)
- Modify: `packages/dashboard/public/js/app.js:1934-1946` (fetchChannels)

**Step 1: Add state for expanded channels and help tasks**

Find the state section (around line 130) and add after `createTaskForm`:

```javascript
    // Channel error UI state
    expandedChannelErrors: {}, // { channelId: true/false }
    channelHelpTasks: {}, // { channelId: taskId } — tracks "Ask Nina" tasks
```

**Step 2: Update fetchChannels to include lastError**

Modify the fetchChannels function (around line 1939) to include `lastError`:

```javascript
    fetchChannels() {
      fetch("/api/channels")
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            this.channels = data.map((ch) => ({
              ...ch,
              reconnectAttempts: ch.statusDetail?.reconnectAttempts ?? 0,
              lastError: ch.statusDetail?.lastError ?? null,
            }));
            // Clear help task tags for channels that reconnected
            for (const ch of this.channels) {
              if (ch.status === 'connected' && this.channelHelpTasks[ch.id]) {
                delete this.channelHelpTasks[ch.id];
              }
            }
          }
        })
        .catch(() => {});
    },
```

**Step 3: Verify syntax**

Run:
```bash
cd packages/dashboard && npx prettier --write public/js/app.js
```

Expected: No syntax errors.

**Step 4: Commit**

```bash
git add packages/dashboard/public/js/app.js
git commit -m "feat(dashboard): add channel error UI state

Track expanded error panels and 'Ask Nina' help tasks.
Clear help tags when channels reconnect.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Channel Helper Functions

**Files:**
- Modify: `packages/dashboard/public/js/app.js:1962-1980` (after channelDotClass)

**Step 1: Add helper functions**

Add after the `channelTooltip` function (around line 1970):

```javascript
    /**
     * Toggle expanded error panel for a channel
     */
    toggleChannelError(channelId) {
      this.expandedChannelErrors[channelId] = !this.expandedChannelErrors[channelId];
    },

    /**
     * Check if channel error panel is expanded
     */
    isChannelErrorExpanded(channelId) {
      return !!this.expandedChannelErrors[channelId];
    },

    /**
     * Create a help task for Nina to fix channel error
     */
    async askNinaAboutChannel(channelId) {
      const channel = this.channels.find(ch => ch.id === channelId);
      if (!channel) return;

      const errorMsg = channel.lastError || "Unknown error";
      const title = `Fix ${channelId} connection`;
      const instructions = `The WhatsApp channel "${channelId}" has an error: "${errorMsg}"\n\nPlease help diagnose and fix this connection issue.`;

      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "immediate",
            sourceType: "manual",
            title,
            instructions,
            createdBy: "user",
          }),
        });

        if (res.ok) {
          const task = await res.json();
          this.channelHelpTasks[channelId] = task.id;
          // Refresh tasks list
          this.fetchTasks();
        }
      } catch (err) {
        console.error("[App] Failed to create help task:", err);
      }
    },

    /**
     * Check if channel has an active help task
     */
    hasChannelHelpTask(channelId) {
      return !!this.channelHelpTasks[channelId];
    },
```

**Step 2: Format and verify**

Run:
```bash
cd packages/dashboard && npx prettier --write public/js/app.js
```

**Step 3: Commit**

```bash
git add packages/dashboard/public/js/app.js
git commit -m "feat(dashboard): add channel error helper functions

- toggleChannelError: expand/collapse error panel
- askNinaAboutChannel: create help task with error context
- hasChannelHelpTask: track active help requests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update Channel Card UI with Expandable Error Panel

**Files:**
- Modify: `packages/dashboard/public/index.html:948-1060` (channel card section)

**Step 1: Replace channel card with expandable version**

Replace the channel card template (lines 948-1057) with:

```html
                <div class="space-y-3">
                  <template x-for="ch in channels" :key="ch.id">
                    <div
                      class="bg-tokyo-card/50 rounded-lg border border-white/5"
                      :class="{ 'border-red-500/30': ch.status === 'error' }"
                    >
                      <!-- Channel header (always visible) -->
                      <div
                        class="flex items-center gap-3 p-4"
                        :class="{ 'cursor-pointer hover:bg-white/5': ch.status === 'error' }"
                        @click="ch.status === 'error' && toggleChannelError(ch.id)"
                      >
                        <!-- Channel icon -->
                        <div
                          class="w-8 h-8 rounded-lg bg-tokyo-panel flex items-center justify-center text-tokyo-muted shrink-0 channel-icon"
                          x-html="ch.icon"
                        ></div>

                        <!-- Channel info -->
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2">
                            <span
                              class="text-sm font-medium text-tokyo-text"
                              x-text="ch.id"
                            ></span>
                            <span
                              class="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium"
                              x-text="ch.role"
                            ></span>
                            <!-- Nina is on it tag -->
                            <template x-if="hasChannelHelpTask(ch.id)">
                              <span
                                class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium flex items-center gap-1"
                              >
                                <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                                Nina is on it
                              </span>
                            </template>
                          </div>
                          <div
                            class="text-xs text-tokyo-muted mt-0.5"
                            x-text="ch.identity"
                          ></div>
                        </div>

                        <!-- Status -->
                        <div class="flex items-center gap-2 shrink-0">
                          <span
                            class="w-2 h-2 rounded-full"
                            :class="channelDotClass(ch.status)"
                          ></span>
                          <span
                            class="text-xs"
                            :class="{
                              'text-green-400': ch.status === 'connected',
                              'text-yellow-400': ch.status === 'connecting',
                              'text-red-400': ch.status === 'error',
                              'text-tokyo-muted': ch.status === 'disconnected' || ch.status === 'logged_out'
                            }"
                            x-text="ch.status"
                          ></span>
                          <!-- Expand chevron for error state -->
                          <template x-if="ch.status === 'error'">
                            <svg
                              class="w-4 h-4 text-tokyo-muted transition-transform"
                              :class="{ 'rotate-180': isChannelErrorExpanded(ch.id) }"
                              fill="none" viewBox="0 0 24 24" stroke="currentColor"
                            >
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                          </template>
                        </div>
                      </div>

                      <!-- Expandable error panel -->
                      <template x-if="ch.status === 'error'">
                        <div
                          x-show="isChannelErrorExpanded(ch.id)"
                          x-collapse
                          class="border-t border-white/5"
                        >
                          <div class="p-4 bg-red-500/5">
                            <div class="flex items-start gap-3">
                              <svg class="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              <div class="flex-1 min-w-0">
                                <p class="text-sm text-tokyo-text" x-text="ch.lastError || 'Connection error'"></p>
                              </div>
                            </div>
                            <div class="flex items-center gap-2 mt-4">
                              <button
                                @click.stop="pairChannel(ch.id)"
                                class="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-[rgba(224,122,95,0.15)] text-[#e07a5f] hover:bg-[rgba(224,122,95,0.25)]"
                              >
                                Re-pair Device
                              </button>
                              <button
                                @click.stop="askNinaAboutChannel(ch.id)"
                                class="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                                :class="hasChannelHelpTask(ch.id)
                                  ? 'bg-amber-500/15 text-amber-400 cursor-default'
                                  : 'bg-tokyo-panel text-tokyo-text hover:bg-white/10'"
                                :disabled="hasChannelHelpTask(ch.id)"
                              >
                                <span x-show="!hasChannelHelpTask(ch.id)">Ask Nina</span>
                                <span x-show="hasChannelHelpTask(ch.id)" class="flex items-center gap-1">
                                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                  </svg>
                                  Asked
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </template>

                      <!-- Channel actions (for non-error states) -->
                      <template x-if="ch.status !== 'error'">
                        <div
                          class="flex items-center gap-2 px-4 pb-4 pt-0"
                        >
                          <!-- Pair button (for disconnected/logged_out channels) -->
                          <template
                            x-if="ch.status !== 'connected' && ch.status !== 'connecting'"
                          >
                            <button
                              @click="pairChannel(ch.id)"
                              class="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-[rgba(224,122,95,0.15)] text-[#e07a5f] hover:bg-[rgba(224,122,95,0.25)]"
                            >
                              Pair
                            </button>
                          </template>

                          <!-- Authorize button (for connected channels without a token yet) -->
                          <template
                            x-if="ch.status === 'connected' && !authTokens[ch.id]"
                          >
                            <button
                              @click="requestAuthToken(ch.id)"
                              class="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-[rgba(224,122,95,0.15)] text-[#e07a5f] hover:bg-[rgba(224,122,95,0.25)]"
                            >
                              Authorize Owner
                            </button>
                          </template>

                          <!-- Disconnect button (for connected channels) -->
                          <template x-if="ch.status === 'connected'">
                            <button
                              @click="disconnectChannel(ch.id)"
                              class="text-xs px-3 py-1.5 rounded-lg font-medium text-tokyo-muted hover:text-tokyo-red hover:bg-tokyo-red/10 transition-colors"
                            >
                              Disconnect
                            </button>
                          </template>

                          <!-- Reconnect attempts info -->
                          <template x-if="ch.reconnectAttempts > 0">
                            <span class="text-[10px] text-tokyo-muted ml-auto">
                              Reconnect attempt
                              <span x-text="ch.reconnectAttempts"></span>
                            </span>
                          </template>
                        </div>
                      </template>

                      <!-- QR Code display (shown when pairing is active for this channel) -->
                      <template
                        x-if="pairingChannelId === ch.id && qrCodeDataUrl"
                      >
                        <div class="p-4 border-t border-white/5">
                          <p class="text-xs text-tokyo-muted mb-3">
                            Scan this QR code with WhatsApp on your phone:
                          </p>
                          <div
                            class="bg-white p-3 rounded-lg inline-block"
                          >
                            <img
                              :src="qrCodeDataUrl"
                              alt="QR Code"
                              class="w-48 h-48"
                            />
                          </div>
                        </div>
                      </template>
                    </div>
                  </template>
                </div>
```

**Step 2: Format**

Run:
```bash
cd packages/dashboard && npx prettier --write public/index.html
```

**Step 3: Test manually**

1. Start dashboard: `cd packages/dashboard && npm run dev`
2. Go to Settings
3. Find channel with "error" status
4. Click to expand — should show error message and buttons
5. Click "Ask Nina" — should show "Nina is on it" tag

**Step 4: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(dashboard): add expandable channel error UI

- Click error status to expand error panel
- Shows human-readable error message
- 'Re-pair Device' and 'Ask Nina' CTAs
- 'Nina is on it' tag when help task created

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Rebuild Core Package and Test

**Step 1: Rebuild WhatsApp plugin**

```bash
cd plugins/channel-whatsapp && npm run build
```

**Step 2: Restart dashboard**

```bash
pkill -f "tsx.*dashboard" || true
cd packages/dashboard && npm run dev &
```

**Step 3: Manual test**

1. Go to http://localhost:4321
2. Navigate to Settings
3. If WhatsApp channel shows error:
   - Click to expand
   - Verify error message is human-readable
   - Click "Re-pair Device" → QR flow starts
   - Or click "Ask Nina" → tag appears, task created

**Step 4: Final commit if needed**

If any fixes were needed, commit them.

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | WhatsApp plugin error messages | 5 min |
| 2 | Dashboard state for errors | 5 min |
| 3 | Channel helper functions | 5 min |
| 4 | Expandable error UI | 10 min |
| 5 | Build and test | 5 min |

**Total: ~30 minutes**
