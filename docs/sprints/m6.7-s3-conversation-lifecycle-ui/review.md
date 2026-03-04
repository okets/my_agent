# M6.7-S3: Conversation Lifecycle UI — Sprint Review

> **Date:** 2026-03-04
> **Verdict:** PASS
> **Milestone:** M6.7 (Two-Agent Refactor)

---

## Goal

Make the S2 backend status model visible in the UI: current/inactive conversation indicators in the sidebar + channel badges on transcript messages.

## Delivered

### Task 1: Current/inactive indicators in conversation sidebar
- **Desktop dropdown:** Green dot for current conversation, transparent for inactive. Bold title when current but not selected. Muted text for inactive with hover-to-normal transition. Existing blue highlight for selected conversation preserved.
- **Mobile switcher:** Same pattern — green dot, bold/muted styling, consistent with desktop.
- All inline Tailwind, no custom CSS needed.

### Task 2: Channel badge on transcript messages
- **Backend:** Added `channel?: string` to `Turn` protocol type, populated from `TranscriptTurn.channel` via `toTurn()`.
- **Frontend:** Added `channel`, `channelIcon`, `channelName` to all 3 turn→message mapping locations. Two helper methods: `getChannelBadgeIcon()` and `getChannelBadgeName()`.
- **UI:** Both assistant and user message templates now show a small pill badge (channel icon + name) next to the timestamp for non-web channels. Web messages show no badge.

### Task 3: ROADMAP update
- S3 renamed to "Conversation Lifecycle UI" with actual scope
- S4 added: "Tabs & Search"
- S5 added: "E2E Validation" (moved from old S4)

## Test Results

| Check | Result |
|-------|--------|
| tsc --noEmit (dashboard) | Clean |
| prettier --check src/ public/ | Clean |

## Files Changed

| File | Change |
|------|--------|
| `packages/dashboard/public/index.html` | Status dots + text styling in sidebar (desktop + mobile), channel badge on message timestamps |
| `packages/dashboard/public/js/app.js` | Channel properties on 3 message mapping locations + 2 helper methods |
| `packages/dashboard/src/ws/protocol.ts` | `channel?: string` on Turn interface |
| `packages/dashboard/src/ws/chat-handler.ts` | `channel: turn.channel` in toTurn() |
| `docs/ROADMAP.md` | S3/S4/S5 sprint table update |

## Commits

| Hash | Message |
|------|---------|
| `b8728e0` | feat(m6.7-s3): add current/inactive indicators to conversation sidebar |
| `c54ca93` | feat(m6.7-s3): add channel badges on transcript messages |

## User Stories for Testing

### Story 1: Current conversation indicator
1. Open dashboard, note the conversation list in the sidebar
2. The current conversation should have a green dot and bold title
3. Inactive conversations should have muted (dimmer) text
4. Switch to a different conversation — verify the green dot moves
5. Send `/new` — verify new conversation gets the dot, old one becomes muted

### Story 2: Channel badges on messages
1. Open a conversation that has WhatsApp messages
2. Messages from WhatsApp should show a small badge with the WhatsApp icon and "whatsapp" text next to the timestamp
3. Web messages in the same conversation should show only the timestamp (no badge)
4. Check both user and assistant messages have the badge when from a channel

### Story 3: Mobile verification
1. Open dashboard at 390px width (or on phone)
2. Open the conversation switcher — verify green dot and bold/muted styling
3. Open a channel conversation — verify channel badges appear on messages
