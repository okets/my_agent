# M6.9-S3 — Conversation Initiation Design Spec

> **Status:** Draft v1
> **Author:** CTO + Claude (brainstorming session 2026-03-13)
> **Milestone:** M6.9 (Knowledge Lifecycle)
> **Sprint:** S3 — Conversation Initiation
> **Depends on:** M6.9-S2.5 (complete), M6.7 (conversation lifecycle), M3 (channel plugins)

---

## 1. Problem Statement

Working Nina (scheduler, Haiku jobs, background tasks) produces artifacts — summaries, `current-state.md`, staged facts, task results — but has no way to proactively reach the user. The morning brief writes a file and stops. The user only sees it when they happen to open a conversation.

Nina needs a way to tap the user on the shoulder.

---

## 2. Design Principle: Working Nina / Conversation Nina

**"Working Nina does the work, Conversation Nina presents it."**

- **Working Nina:** Scheduler, Haiku jobs, background tasks. Produces artifacts (data, reports, structured context). Never talks to the user directly.
- **Conversation Nina:** The brain session facing the user. Presents, discusses, and acts on artifacts. Speaks in Nina's voice.
- **`ConversationInitiator`:** The bridge. How Working Nina signals Conversation Nina to reach out.

This principle governs this sprint's implementation. A follow-up sprint (S3.5) will audit and refactor all existing Working Nina → user touchpoints to route through this bridge.

---

## 3. Two Primitives

`ConversationInitiator` is a service with two public methods:

### 3.1 `alert(prompt: string): Promise<boolean>`

Sends a message into the **active conversation** through the brain session.

- Injects a synthetic system turn into the active brain session (e.g., `[SYSTEM: Morning brief is due. Ask the user if they'd like to start now or be reminded later.]`)
- Nina responds naturally in her voice, adapting to conversational context
- The synthetic turn is internal — the user only sees Nina's response. The synthetic turn is **not appended** to the conversation transcript; only the brain's response is appended as an assistant turn.
- Sends via whatever channel the active conversation is on
- Returns `true` if an active conversation was found and alerted, `false` otherwise (enables caller to fall back to `initiate()`)

**When to use:** There's an active conversation and Working Nina needs Conversation Nina's attention without breaking flow.

### 3.2 `initiate(options?: { firstTurnPrompt?: string }): Promise<Conversation>`

Starts a **new conversation** on the preferred outbound channel.

- Creates a new conversation via ConversationManager (demotes any existing current conversation — normal rules)
- Starts a brain session — Nina composes the opening message
- Sends via the preferred outbound channel (`preferences.outboundChannel`)
- Falls back silently to web if the preferred channel is unavailable (not connected)
- Returns the created conversation

**When to use:** No active conversation, or Working Nina needs to start a dedicated interaction.

### 3.3 Active Conversation Detection

A conversation is "active" if the last user message was within **15 minutes**. Beyond that, it's safe to start a new one.

**Implementation:** Add a `lastUserMessageAt` column to the `conversations` table (nullable timestamp, updated on each user turn in `ConversationManager.appendTurn()`). Query via a new `ConversationManager.getActiveConversation(thresholdMinutes: number)` method. This is more efficient than scanning JSONL transcripts and avoids conflating user activity with assistant responses (the existing `updated` field tracks any turn).

### 3.4 `alert()` With No Active Conversation

If `alert()` is called but no active conversation exists, it is a **no-op** that logs a warning. The caller is responsible for checking first and falling back to `initiate()`. The morning brief flow (Section 4.1) always checks before calling.

### 3.5 Dependencies

`ConversationInitiator` constructor receives:
- `chatHandler` / session factory — for brain session access. `SessionManager` is per-conversation (not a singleton), so `ConversationInitiator` needs a way to obtain the correct instance for the active conversation (`alert()`) or create a new one (`initiate()`). It receives the same session factory/chat handler that `index.ts` uses to manage sessions, avoiding tight coupling to a single `SessionManager` instance.
- `ConversationManager` — for creating conversations, checking active status
- `ChannelManager` — for sending messages via channels
- Config access — for reading `preferences.outboundChannel`

---

## 4. Morning Brief Flow

The morning brief is the first consumer of the two primitives.

### 4.1 Sequence

1. **Haiku step** (unchanged) — Working Nina synthesizes `current-state.md`, runs daily/weekly/monthly summaries
2. **Initiation step** (new):
   - Check for active conversation (last user message < 15 min ago)
   - **Active:** `alert("Morning brief is ready. Ask the user if they'd like to go through it now or later.")`
   - **Not active:** `initiate()` — new conversation on preferred channel, Nina opens with her morning greeting

### 4.2 Brain Context

No special morning-brief context injection needed (approach A). Nina's system prompt already includes:
- `current-state.md` (Layer 4) — freshly written by the Haiku step
- Staged facts via `manage_staged_knowledge` MCP tool
- Stale properties in Layer 4

Nina speaks first with all context already loaded. If initial testing shows she needs more guidance, we can add a prompt hint to the opening turn (upgrade to approach C).

### 4.3 User Declines

If the user says "not now" to the in-conversation alert, it's on them to ask for the brief later. No timers, no retries, no flags.

### 4.4 Guards

- **Haiku failure guard:** If the Haiku synthesis step fails (current-state.md not updated), do NOT call ConversationInitiator. Stale context is worse than no conversation.
- **Duplicate guard:** If morning brief already ran today (check work_loop_runs), skip. Prevents scheduler race conditions.

### 4.5 `handleMorningPrep()` Refactoring

Following the Working Nina / Conversation Nina principle:
- `handleMorningPrep()` produces a **report** (`current-state.md`), not user-facing prose
- After writing the report, it calls `ConversationInitiator` to let Conversation Nina present it
- Any conversational phrasing currently in the morning prep output should be data-oriented instead — Conversation Nina decides how to present it

---

## 5. Configuration

### 5.1 Global Outbound Channel

New preference in `config.yaml`:

```yaml
preferences:
  outboundChannel: "whatsapp"  # or "web"
  morningBrief:
    time: "08:00"
    model: "sonnet"
    channel: "default"  # deprecated, superseded by outboundChannel
```

- `outboundChannel` is the global preference for all agent-initiated contact
- Used by both `alert()` (fallback if needed) and `initiate()`
- `morningBrief.channel` is ignored if `outboundChannel` exists (backwards compat)

### 5.2 Fallback

If the preferred channel is not connected, fall back silently to web:
- Create the conversation (visible in dashboard Home widget)
- No error, no notification, no queue-and-retry

### 5.3 Hatching

Add outbound channel question to the hatching flow: "How should I reach you when I need to tell you something?" Options: WhatsApp (if connected), Web only.

### 5.4 Settings UI

Add outbound channel dropdown to the Settings panel (alongside existing morning brief settings).

---

## 6. Synthetic Turn Injection

When `alert()` needs to inject a system message into the active brain session:

- The turn is formatted as: `[SYSTEM: {prompt}]`
- It goes through `SessionManager` as a user-role message (the brain sees it as input)
- The brain responds naturally — Nina's response is appended as an assistant turn and sent via the conversation's channel
- The synthetic turn is **not** shown to the user in the transcript — it's internal routing

### 6.1 SessionManager Changes

`SessionManager` needs a method to inject a turn into the active session without a real user message. This is a new capability:

```typescript
async *injectSystemTurn(prompt: string): AsyncGenerator<StreamEvent>
```

No `conversationId` parameter — `SessionManager` is per-conversation, so the conversation is already bound at construction. Returns an `AsyncGenerator<StreamEvent>` (consistent with `streamMessage()`) so the caller can stream the response to the channel in real time. The caller collects the full response for transcript storage.

The method wraps the prompt in `[SYSTEM: {prompt}]` format before passing to the brain, so the brain can distinguish system injections from user messages.

---

## 7. Files Changed

| File | Change |
|------|--------|
| **New:** `packages/dashboard/src/agent/conversation-initiator.ts` | `ConversationInitiator` service with `alert()` and `initiate()` |
| **New:** `packages/dashboard/tests/conversation-initiator.test.ts` | Unit tests for both primitives |
| `packages/dashboard/src/scheduler/work-loop-scheduler.ts` | Call `ConversationInitiator` after morning prep completes |
| `packages/dashboard/src/agent/session-manager.ts` | Add `injectSystemTurn()` for synthetic turn injection |
| `packages/dashboard/src/index.ts` | Wire `ConversationInitiator` with dependencies |
| `packages/dashboard/src/conversations/manager.ts` | Add `lastUserMessageAt` tracking in `appendTurn()`, add `getActiveConversation()` method |
| `packages/dashboard/src/conversations/db.ts` | Migration: add `last_user_message_at` column to conversations table |
| `packages/core/src/config.ts` | Add `outboundChannel` to `UserPreferences` type and `loadPreferences()` defaults |
| `packages/dashboard/src/agent/hatching/operating-rules.ts` | Add outboundChannel question |
| `packages/dashboard/public/js/app.js` | OutboundChannel in Settings UI |
| `packages/dashboard/public/index.html` | OutboundChannel dropdown markup |
| `packages/dashboard/src/routes/settings.ts` | Expose outboundChannel in preferences API |

---

## 8. Edge Cases

| Scenario | Behavior |
|----------|----------|
| No channels connected | Conversation created on web only |
| WhatsApp disconnects mid-send | Catch error, fall back to web |
| Active conversation on web, preferred channel is WhatsApp | Alert goes into the web conversation (respect active conversation) |
| Morning brief triggers but Haiku step fails | No initiation — `current-state.md` is stale, don't start a conversation with bad context |
| Two morning brief triggers (scheduler race) | Guard: if morning brief already ran today, skip |

---

## 9. Follow-Up: S3.5 — Working Nina / Conversation Nina Refactor

A short follow-up sprint to fully adopt the separation principle:

- Audit all Working Nina → user touchpoints (task completion, notifications, reminders)
- Route all proactive outreach through `ConversationInitiator`
- Refactor job outputs to produce structured data, not user-facing prose
- Conversation Nina interprets and presents everything in her voice

---

## 10. Test Strategy

- **Unit tests:** `ConversationInitiator` with mocked SessionManager, ConversationManager, ChannelManager
  - `alert()` with active conversation — verify synthetic turn injected
  - `alert()` with no active conversation — verify no-op with warning log
  - `initiate()` — verify conversation created, channel send attempted
  - `initiate()` with disconnected channel — verify web fallback
  - Active conversation detection (15-min threshold)
- **Integration test:** Morning prep → initiation flow end-to-end
- **Settings:** outboundChannel read/write via API, hatching flow
- **Browser verification:** Settings UI dropdown, morning brief conversation appears in dashboard

---

*Created: 2026-03-13*
