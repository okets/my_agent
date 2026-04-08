# M9.4 — Conversation UX/UI Design Spec

> **Status:** Draft v1
> **Author:** CTO + Claude (design session 2026-04-08)
> **Milestone:** M9.4 (Conversation UX/UI)
> **Depends on:** M6.10 (Headless App), M6.9-S3 (ConversationInitiator), M9.3 (Delegation Compliance)

---

## 1. Problem Statement

The notification delivery path (`alert()`, `initiate()`, heartbeat) bypasses the Headless App layer introduced in M6.10. The result: brain responses injected via `alert()` are saved to the database but never broadcast to WebSocket clients. The user sees silence until page refresh, even though the answer is in the DB.

The root cause is not "four competing active conversation definitions" (as initially suspected). The design has one clear model — one conversation is `current` at any time. The problem is that `alert()` was built during M6.9-S3, before M6.10 extracted the Headless App. It calls `SessionManager.injectSystemTurn()` directly, bypassing `app.chat` and its event pipeline.

---

## 2. The CTO's Mental Model

> "There is only one current conversation. It is where the user spoke to Nina last. This is what is shown in all WebSocket clients. WhatsApp starts new conversations when the active conversation was held on a different channel — the user can't see history so we start a new conversation."

This model is correct. The conversation-system design spec supports it. The implementation drifted.

---

## 3. Delivery Model (Corrected)

### 3.1 How `alert()` Should Work

```
Heartbeat has a notification to deliver
  → Get current conversation (getCurrent() — status='current', NO threshold)
  → Was the last web UI message within 15 minutes?
    → YES: deliver to current conversation via app.chat
           (broadcasts to all WebSocket clients automatically)
    → NO: deliver via preferred channel (WhatsApp for this user)
           → Was current conversation already on WhatsApp?
             → YES: continue current conversation
             → NO: channel switch — start new conversation on WhatsApp
                   (current becomes inactive, new becomes current — normal rules)
```

### 3.2 Key Changes from M6.9-S3 Design

| Aspect | M6.9-S3 (original) | M9.4 (corrected) |
|--------|-------------------|-------------------|
| Find conversation | `getActiveConversation()` — status='current' AND last_user_message_at > 15 min | `getCurrent()` — status='current', always finds it |
| 15-min threshold | Combined "which conversation" + "is user available" | Separated: threshold only governs channel choice (web vs WhatsApp) |
| alert() returns false | When threshold expired (no active conversation) | Never — there's always a current conversation |
| Fallback to initiate() | When alert() returns false | Only when channel switch triggers a new conversation |
| Message delivery | `sessionFactory.injectSystemTurn()` directly | Through `app.chat` (emits events, broadcasts to WS clients) |
| WebSocket broadcast | None (DB write only) | Automatic via App event pipeline |

### 3.3 Why the Threshold Was Wrong

The original `getActiveConversation()` combined two questions into one query:
1. **Which conversation is current?** → `status = 'current'` (always exactly one)
2. **Is the user on the web app?** → `last_user_message_at > 15 min ago`

When the threshold expired, the query returned null — meaning "no active conversation." But the conversation existed and was current. The heartbeat then called `initiate()`, which created a new conversation on WhatsApp, demoting the real current conversation.

The corrected model keeps these separate:
- **Which conversation?** → `getCurrent()` — always returns one
- **Which channel?** → Check if last web message was within 15 minutes. If yes: web. If no: preferred channel.

### 3.4 Channel Switch Triggers New Conversation

Per the conversation-system design spec (asymmetric channel switching):
- Web → WhatsApp = new conversation (user can't see web history on WhatsApp)
- WhatsApp → Web = continue (web shows full transcript)

This applies to system-initiated messages too. If the current conversation's last turn was on web and the delivery channel is WhatsApp, a new conversation starts. The new conversation becomes current, and all WebSocket clients sync to it via StatePublisher.

### 3.5 Single-Channel Users

- **WhatsApp-only user:** One long conversation. Notifications continue it (same channel, no switch).
- **Web-only user:** One long conversation. Notifications appear in real-time via WebSocket.
- **Mixed user:** New conversations on channel switches, as designed.

---

## 4. What Routes Through `app.chat`

### 4.1 Audit Results

Six code paths inject messages into conversations without going through `app.chat.sendMessage()`:

| # | Location | What | Sprint |
|---|----------|------|--------|
| 1 | `conversation-initiator.ts` alert() | System notification into active conv | **S1** |
| 2 | `conversation-initiator.ts` initiate() | New conversation + first turn | **S1** |
| 3 | `app.ts` ResponseWatchdog | Recovery injection on failed response | **S1** |
| 4 | `channels/message-handler.ts` | Entire inbound channel message flow | **S2** |
| 5 | `routes/admin.ts` inject-message | Debug endpoint | **S2** |
| 6 | `scheduler/event-handler.ts` | Calendar event logging | **S2** |

### 4.2 S1 Scope: Notification Delivery

S1 fixes the notification path — items 1-3. These are the paths that cause user-visible silence.

### 4.3 S2 Scope: Channel Unification

S2 routes channel messages (WhatsApp inbound) and remaining bypasses through `app.chat`. The channel message-handler currently works (broadcasts manually) but should use the App event pipeline for consistency.

---

## 5. S1 Implementation Design

### 5.1 `alert()` Uses `app.chat`

Instead of calling `sessionFactory.injectSystemTurn()` directly:

```typescript
// conversation-initiator.ts — alert()

// 1. Always find the current conversation
const current = await this.conversations.getCurrent();
if (!current) return false; // edge case: no conversations exist

// 2. Channel decision: is the user on the web?
const webRecency = this.getLastWebMessageAge(current.id);
const useWeb = webRecency !== null && webRecency < this.thresholdMinutes;

if (useWeb) {
  // 3a. Deliver via app.chat — broadcasts to all WS clients automatically
  for await (const event of this.app.chat.sendMessage(
    current.id,
    `[SYSTEM: ${prompt}]`,
    (current.turnCount ?? 0) + 1
  )) {
    // accumulate response for channel forwarding if needed
  }
} else {
  // 3b. Deliver via preferred channel
  const outboundChannel = this.preferences.outboundChannel;
  const needsNewConversation = this.isChannelSwitch(current, outboundChannel);

  if (needsNewConversation) {
    // Channel switch: new conversation on preferred channel
    await this.initiate({ firstTurnPrompt: `[SYSTEM: ${prompt}]` });
  } else {
    // Same channel: continue current conversation
    for await (const event of this.app.chat.sendMessage(
      current.id,
      `[SYSTEM: ${prompt}]`,
      (current.turnCount ?? 0) + 1
    )) { /* accumulate */ }
    await this.trySendViaChannel(response, outboundChannel);
  }
}
```

### 5.2 `getLastWebMessageAge()` — New Helper

Returns minutes since last user message on the web channel, or null if no web messages exist.

```typescript
// conversations/db.ts
getLastWebMessageAge(conversationId: string): number | null
```

Queries the turns table for the most recent user turn where `channel IS NULL OR channel = 'web'` (web messages have no channel field or channel='web'). Returns the difference in minutes from now.

### 5.3 `initiate()` Uses `app.chat`

Same principle — route through `app.chat` instead of `sessionFactory.streamNewConversation()`:

```typescript
// conversation-initiator.ts — initiate()

// 1. Create conversation (uses app.conversations.create — already emits events)
const conv = await this.app.conversations.create({
  externalParty: ownerJid,
  channel: outboundChannel,
});

// 2. Brain speaks first via app.chat
for await (const event of this.app.chat.sendMessage(
  conv.id,
  firstTurnPrompt ?? '[SYSTEM: Start a new conversation naturally.]',
  1
)) { /* accumulate */ }

// 3. Send via channel if applicable
if (outboundChannel) {
  await this.trySendViaChannel(response, outboundChannel);
}
```

### 5.4 ResponseWatchdog Uses `app.chat`

The watchdog in `app.ts` currently calls `sm.injectSystemTurn()` directly. Route through `app.chat.sendMessage()` instead.

### 5.5 `getActiveConversation()` — Deprecate

Replace all callers with `getCurrent()` (already exists at `db.ts:591`). The threshold logic moves to `getLastWebMessageAge()` for channel decisions only. `getActiveConversation()` can be removed once all callers are migrated.

### 5.6 Heartbeat Changes

The heartbeat currently has special logic for dashboard-sourced vs channel-sourced notifications, with different attempt thresholds (60 vs 20) and escalation paths. With the corrected model:

- `alert()` always succeeds (there's always a current conversation)
- The channel decision is inside `alert()`, not in the heartbeat
- The heartbeat simplifies to: call `alert()`, mark delivered

The only failure case is if no conversations exist at all (fresh install).

---

## 6. Validation

### 6.1 Unit Tests

| Test | What it validates |
|------|-------------------|
| `alert()` finds current conversation via `getCurrent()` (no threshold) | Always finds one |
| `alert()` delivers via web when last web message < 15 min | Channel decision |
| `alert()` delivers via WhatsApp when last web message > 15 min | Channel decision |
| `alert()` starts new conversation on channel switch | Asymmetric rule |
| `alert()` continues conversation when same channel | No unnecessary new conversations |
| `initiate()` creates conversation and routes through app.chat | Event pipeline |
| ResponseWatchdog routes through app.chat | No bypass |
| `getLastWebMessageAge()` returns correct age | Query correctness |
| `getLastWebMessageAge()` returns null for no web messages | Edge case |

### 6.2 E2E Smoke Test

One end-to-end test that proves the full notification delivery path works:

**"Worker result appears in real-time on dashboard"**

```
1. Start headless App
2. Create a conversation (becomes current)
3. Send a user message via app.chat (establishes web recency)
4. Call alert() with a test prompt
5. Assert: app.chat events were emitted (text_delta, done)
6. Assert: conversation has the new assistant turn in transcript
7. Assert: StatePublisher broadcast was triggered
```

This test uses the headless App directly (no browser, no HTTP). It proves the event pipeline works end-to-end. Browser rendering is trusted — if App events fire and StatePublisher broadcasts, the UI updates.

---

## 7. Sprint Plan — M9.4-S1: Real-Time Notification Delivery

| Task | Description |
|------|-------------|
| 1. Add `getLastWebMessageAge()` | New query in conversations/db.ts |
| 2. Refactor `alert()` | Route through `app.chat`, use `getCurrent()` + web recency for channel decision |
| 3. Refactor `initiate()` | Route through `app.chat` |
| 4. Refactor ResponseWatchdog | Route through `app.chat` |
| 5. Simplify heartbeat | Remove attempt counting and escalation logic — alert() handles channel decision |
| 6. Deprecate `getActiveConversation()` | Replace callers with `getCurrent()`, remove method |
| 7. Unit tests | Cover all cases from Section 6.1 |
| 8. E2E smoke test | Section 6.2 — headless App, full pipeline |
| 9. Manual verification | Restart dashboard, send delegation, confirm result appears in real-time |

---

## 8. S2 Design: Channel Message Unification

### 8.1 Scope

Route inbound channel messages (WhatsApp) through `app.chat` for the brain-interaction portion. Unify admin inject and scheduler event-handler with proper App event emission.

### 8.2 Architecture Decision

**The message-handler is NOT replaced.** It retains ownership of channel-specific responsibilities:
- Conversation resolution (`getByExternalParty()`, channel-switch detection)
- Channel metadata stamping (`channel` field on turns)
- Outbound delivery (`sendViaTransport()`, `sendAudioViaTransport()`)
- Typing indicators and response timers
- Voice note TTS reply path
- Message batching (multi-message debounce → single brain query)
- Reply-to context prefixing
- `/new` and `/model` slash commands with channel-specific behavior

**What changes:** The brain invocation portion — currently `sessionManager.streamMessage()` — routes through `app.chat.sendMessage()` instead. This gives channel messages the same event pipeline (App events, StatePublisher broadcasts, search indexing, SDK session persistence).

### 8.3 `ChatMessageOptions` Extension

```typescript
// chat/types.ts — extended for S2
interface ChatMessageOptions {
  // ... existing fields ...
  channel?: {
    transportId: string;
    channelId: string;
    sender: string;
    replyTo?: string;
    senderName?: string;
    groupId?: string;
    isVoiceNote?: boolean;
    detectedLanguage?: string;
  };
  source?: "dashboard" | "channel";
}
```

When `channel` is provided, `sendMessage()`:
- Stamps user and assistant turns with `channel: options.channel.channelId`
- Calls `sessionManager.setChannel(channelId)` for brain context
- Passes `source: "channel"` to post-response hooks

### 8.4 `app.chat.injectTurn()` — New Method

For operations that write to the transcript without invoking the brain:

```typescript
async injectTurn(conversationId: string, turn: Turn): Promise<void>
```

- Appends turn to transcript
- Emits `conversation:updated` event (triggers StatePublisher)
- No brain invocation, no streaming, no session management

**Consumers:**
- `routes/admin.ts` inject-message endpoint
- `scheduler/event-handler.ts` calendar event logging

### 8.5 Risks Identified (External Audit)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Turns lose `channel` field → breaks channel-switch detection | High | `ChatMessageOptions.channel` stamps turns (8.3) |
| No outbound delivery in `sendMessage()` | High | Message-handler retains outbound delivery; `sendMessage()` only handles brain interaction |
| Admin inject triggers brain instead of transcript write | High | New `injectTurn()` method (8.4) |
| Scheduler events invoke brain for every calendar event | High | Use `injectTurn()` (8.4) |
| Voice note TTS reply path lost | Medium | Message-handler retains voice delivery; reads response from `sendMessage()` events |
| `source: "dashboard"` on channel messages | Medium | `ChatMessageOptions.source` field (8.3) |
| Session `setChannel()` not called | Medium | `sendMessage()` calls it when `channel` option present |
| Conversation auto-naming fires on channel convs that already have titles | Low | Skip naming when conversation already has a title from `senderName`/`groupName` |

### 8.6 S2 Validation

| Test | What it validates |
|------|-------------------|
| Channel message saved with `channel` field on turns | Metadata preserved |
| Channel-switch detection still works after unification | No spurious new conversations |
| `injectTurn()` writes turn and emits event without brain call | Admin/scheduler path |
| Voice note round-trip: WhatsApp in → brain → TTS → WhatsApp out | Voice not regressed |
| Concurrent channel + web messages on same conversation | No turn number collision |
| `source: "channel"` reaches post-response hooks | Watchdog behaves correctly for channel messages |

---

## 9. S3 Design: Job Progress Card

### 9.1 Problem

The current progress bar:
1. Doesn't progress (updates only on `todo_update` status changes, not reliably)
2. Is attached to the first assistant message — Nina sends more messages, the bar scrolls away
3. Flickers when `current` text changes; text disappears between updates

### 9.2 Solution: Sticky Progress Card

Replace the inline progress bar with a sticky card at the bottom of the chat area, above the compose box. One card per running job, max two stacked.

**Collapsed (default) — single row:**
```
┌──────────────────────────────────────────────┐
│ ● Research Thai visa requirements        2/5 │
└──────────────────────────────────────────────┘
```

**Expanded (click/tap to toggle) — max 5 rows including header, scrollable:**
```
┌──────────────────────────────────────┐
│ ● Research Thai visa requirements  ✕ │  ← header row, ✕ closes card
│ ✓ Find visa types for Dutch citizens │
│ ✓ Check processing times             │
│ ↻ Checking embassy website...        │  ← highlighted current step
│ ○ Compare visa agents                │
│ ○ Write summary                      │  ← scrolls if > 4 steps
└──────────────────────────────────────┘
```

### 9.3 Interaction

| Action | Result |
|--------|--------|
| Click/tap card (collapsed) | Expand to show all steps |
| Click/tap card (expanded) | Collapse to show current step only |
| Click ✕ button | Close card (job continues, card dismissed) |
| Job completes | Card shows "Done", fades out after 2 seconds |

### 9.4 Step Styling

| Status | Icon | Style |
|--------|------|-------|
| `done` | ✓ | `text-green-400/60` — dimmed green |
| `in_progress` | ↻ | `text-blue-400` (`accent-blue`) — highlighted |
| `pending` | ○ | `text-gray-500` — muted |
| `blocked` | ⊘ | `text-orange-400/60` — muted orange |

Card background: `glass-strong` (matches design language). Border: `rgba(255,255,255,0.08)`.

### 9.5 Expanded Mode Scrolling

The expanded card shows a maximum of 5 rows (1 header + 4 visible steps). If more steps exist, the step list scrolls with a thin scrollbar. This prevents the card from covering the entire chat area for jobs with many steps.

### 9.6 Headless App Contract

**Current `todoProgress` shape (insufficient):**
```typescript
todoProgress?: { done: number; total: number; current: string | null }
```

**Required for step list — include full items:**
```typescript
todoProgress?: {
  done: number;
  total: number;
  current: string | null;
  items: Array<{ id: string; text: string; status: TodoStatus }>;
}
```

StatePublisher already reads `todos.json` from disk for each broadcast. The change is including `items` (text + status only, no notes/validation metadata) in the snapshot.

### 9.7 Frontend Changes

- **Remove:** `msg.delegationProgress` on messages, `_syncDelegationProgress()` matching logic, inline progress bar template (both desktop and mobile)
- **Add:** Alpine component for progress cards, positioned fixed above compose box
- **Data source:** `state:jobs` WebSocket message (already carries job snapshots — just needs `items` added)
- **Max cards:** 2 stacked. If more jobs exist, show most recent 2.

### 9.8 S3 Validation

| Test | What it validates |
|------|-------------------|
| Card appears when job starts with todos | Basic rendering |
| Card updates as todo statuses change | Progress tracking |
| Collapsed shows current step text | Default view |
| Expanded shows all steps with correct icons | Step list rendering |
| Scrollbar appears when > 4 steps | Overflow handling |
| Click/tap toggles collapsed/expanded | Interaction |
| ✕ dismisses card, job continues | Close behavior |
| Card fades on job completion | Completion UX |
| Two concurrent jobs show two stacked cards | Max cards |
| Mobile: card renders correctly, tap works | Mobile parity |

---

## 10. Sprint Summary

| Sprint | Scope | Key Deliverable |
|--------|-------|-----------------|
| **S1** | Notification delivery via `app.chat` | `alert()` broadcasts to WebSocket, correct channel decision |
| **S2** | Channel messages via `app.chat` + `injectTurn()` | Unified brain path, channel metadata preserved |
| **S3** | Job progress card (replaces inline bar) | Sticky card, step list, collapsed/expanded, scrollable |

---

## 11. References

- [conversation-system.md](../design/conversation-system.md) — Canonical conversation lifecycle design
- [conversation-initiation-design.md](2026-03-13-conversation-initiation-design.md) — Original M6.9-S3 spec (alert/initiate)
- [headless-app-design.md](2026-03-16-headless-app-design.md) — M6.10 Headless App architecture
- [2026-04-08-alert-delivery-not-realtime.md](../issues/2026-04-08-alert-delivery-not-realtime.md) — Original issue (partially overclaimed, corrected by this spec)
- `packages/dashboard/src/chat/chat-service.ts` — The correct message path (app.chat.sendMessage)
- `packages/dashboard/src/agent/conversation-initiator.ts` — The bypass path (to be fixed)
- `packages/dashboard/src/app.ts` — ResponseWatchdog (to be fixed)
- `packages/dashboard/src/automations/heartbeat-service.ts` — Heartbeat (to be simplified)
