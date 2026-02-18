# Debug & Admin API Specification

> Part of: [Self-Evolving Infrastructure](./self-evolving-infrastructure.md)

---

## Overview

A comprehensive API that exposes everything the web UI can do, plus debugging internals. Designed for:
- **QA agents** — E2E testing of sprint changes
- **Claude Code sessions** — Debugging stuck agents
- **Future agents** — Self-maintenance and extension

## Security

- **Localhost-only** — All `/api/debug/*` and `/api/admin/*` routes reject non-localhost requests
- **No auth required** — Simplicity over complexity; localhost is the trust boundary
- **Logged** — All admin actions logged to `debug.log`

## Architecture

- Same server as dashboard (`:4321`)
- Routes: `/api/debug/*` (read) and `/api/admin/*` (write)
- WebSocket: existing `/api/chat/ws` with `?qa=true` mode

---

## Debug Endpoints (State Inspection)

### `GET /api/debug/brain/status`

Agent status overview.

```json
{
  "hatched": true,
  "authSource": "file",
  "authType": "api_key",
  "model": "claude-sonnet-4-5-20250929",
  "brainDir": "/home/user/project/.my_agent"
}
```

### `GET /api/debug/brain/prompt`

Assembled system prompt with component breakdown.

```json
{
  "systemPrompt": "# Nina\n\nYou are...",
  "components": {
    "personality": { "source": ".my_agent/brain/CLAUDE.md", "chars": 1234 },
    "identity": { "source": ".my_agent/brain/memory/core/identity.md", "chars": 567 },
    "contacts": { "source": ".my_agent/brain/memory/core/contacts.md", "chars": 234 },
    "preferences": { "source": ".my_agent/brain/memory/core/preferences.md", "chars": 123 },
    "notebooks": {
      "external-communications": { "chars": 456 },
      "reminders": { "chars": 789 },
      "standing-orders": { "chars": 321 }
    },
    "calendar": { "cached": true, "age": 45000, "chars": 890 },
    "skills": { "framework": 5, "user": 2 }
  },
  "totalChars": 4567
}
```

### `GET /api/debug/brain/caches`

Cache status for all runtime caches.

```json
{
  "calendarContext": {
    "cached": true,
    "ageMs": 45000,
    "ttlMs": 60000,
    "sizeBytes": 1234
  },
  "caldavCalendars": {
    "cached": true,
    "ageMs": 30000,
    "ttlMs": 60000,
    "count": 3
  },
  "dedup": {
    "entries": 127,
    "maxEntries": 5000,
    "ttlMs": 1200000
  },
  "debouncer": {
    "activeBuffers": 2,
    "pendingMessages": 5
  }
}
```

### `GET /api/debug/conversation/:id/context`

Full context being sent to model for a specific conversation.

```json
{
  "conversationId": "abc123",
  "systemPrompt": "...",
  "transcript": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi there!" }
  ],
  "tokenEstimate": {
    "system": 2000,
    "transcript": 150,
    "total": 2150
  }
}
```

### `GET /api/debug/brain/files`

List all brain files with metadata.

```json
{
  "root": "/home/user/project/.my_agent",
  "files": [
    { "path": "brain/CLAUDE.md", "size": 1234, "modified": "2026-02-18T10:00:00Z" },
    { "path": "brain/memory/core/identity.md", "size": 567, "modified": "2026-02-17T15:30:00Z" }
  ]
}
```

### `GET /api/debug/brain/skills`

Skill inventory from both locations.

```json
{
  "framework": [
    { "name": "calendar-management", "path": "packages/core/skills/calendar-management.md" }
  ],
  "user": [
    { "name": "custom-skill", "path": ".my_agent/brain/skills/custom-skill.md" }
  ]
}
```

### `GET /api/debug/calendar/events`

Raw upcoming events (not formatted as markdown).

```json
{
  "events": [
    {
      "uid": "event-123",
      "calendarId": "personal",
      "title": "Team standup",
      "start": "2026-02-18T09:00:00Z",
      "end": "2026-02-18T09:30:00Z",
      "recurring": true
    }
  ],
  "fetchedAt": "2026-02-18T08:00:00Z"
}
```

---

## Admin Endpoints (Actions)

### `POST /api/admin/inject-message`

Inject a message into conversation context (for testing).

**Request:**
```json
{
  "conversationId": "abc123",
  "role": "system",
  "content": "Remember: today is a test day"
}
```

**Response:**
```json
{ "ok": true, "turnNumber": 15 }
```

### `POST /api/admin/caches/:name/invalidate`

Force invalidate a specific cache.

**Supported names:** `calendar-context`, `caldav-calendars`, `dedup`, `debouncer`

**Response:**
```json
{ "ok": true, "cache": "calendar-context", "previousAge": 45000 }
```

### `POST /api/admin/hatching/reset`

Clear hatching state — return to pre-hatched state.

**Response:**
```json
{ "ok": true, "removed": [".hatched", "brain/CLAUDE.md", "auth.json"] }
```

⚠️ **Destructive** — Requires confirmation header: `X-Confirm-Destructive: true`

### `POST /api/admin/conversation/:id/delete`

Delete a conversation.

**Response:**
```json
{ "ok": true, "conversationId": "abc123" }
```

### `POST /api/admin/conversation/:id/rename`

Rename a conversation.

**Request:**
```json
{ "title": "New title" }
```

**Response:**
```json
{ "ok": true, "conversationId": "abc123", "title": "New title" }
```

### `POST /api/admin/channel/:id/pair`

Trigger channel pairing (QR generation).

**Response:**
```json
{ "ok": true, "channelId": "whatsapp-main" }
```

### `POST /api/admin/channel/:id/disconnect`

Disconnect a channel.

**Response:**
```json
{ "ok": true, "channelId": "whatsapp-main" }
```

### `POST /api/admin/channel/:id/simulate-message`

Inject a fake inbound channel message for testing.

**Request:**
```json
{
  "from": "+1555000000",
  "content": "Test message from channel"
}
```

**Response:**
```json
{ "ok": true, "messageId": "sim-123", "conversationId": "conv-456" }
```

### `POST /api/admin/calendar/create-event`

Create a test calendar event.

**Request:**
```json
{
  "calendarId": "personal",
  "title": "Test event",
  "start": "2026-02-18T14:00:00Z",
  "end": "2026-02-18T15:00:00Z"
}
```

**Response:**
```json
{ "ok": true, "uid": "event-789" }
```

### `POST /api/admin/calendar/delete-event/:uid`

Delete a calendar event.

**Response:**
```json
{ "ok": true, "uid": "event-789" }
```

### `POST /api/admin/notebook/:name/write`

Write to a notebook file.

**Supported names:** `external-communications`, `reminders`, `standing-orders`

**Request:**
```json
{ "content": "# New content\n\nThis replaces the notebook." }
```

**Response:**
```json
{ "ok": true, "notebook": "reminders", "chars": 45 }
```

---

## WebSocket QA Mode

Connect with `?qa=true` query parameter: `ws://localhost:4321/api/chat/ws?qa=true`

### QA Client → Server Messages

#### `qa_send_message`

Send message to a specific conversation (not just "current").

```json
{
  "type": "qa_send_message",
  "conversationId": "abc123",
  "content": "Test message",
  "model": "claude-sonnet-4-5-20250929",
  "reasoning": false
}
```

#### `qa_create_conversation`

Create new conversation and get ID immediately.

```json
{ "type": "qa_create_conversation" }
```

#### `qa_hatching_input`

Submit hatching input (explicit QA variant).

```json
{
  "type": "qa_hatching_input",
  "controlId": "personality-choice",
  "value": "partner"
}
```

#### `qa_wait_for_idle`

Request notification when all streaming completes.

```json
{ "type": "qa_wait_for_idle" }
```

### QA Server → Client Messages

#### `qa_conversation_created`

Immediate ACK with conversation ID.

```json
{
  "type": "qa_conversation_created",
  "conversationId": "abc123"
}
```

#### `qa_turn_complete`

Full turn data after streaming ends (no need to reconstruct from deltas).

```json
{
  "type": "qa_turn_complete",
  "conversationId": "abc123",
  "turn": {
    "role": "assistant",
    "content": "Complete response text",
    "turnNumber": 5,
    "usage": { "input": 100, "output": 50 },
    "cost": 0.001
  }
}
```

#### `qa_idle`

All streams complete, safe to assert.

```json
{ "type": "qa_idle" }
```

---

## Evolution Protocol

When a QA agent needs an endpoint that doesn't exist:

1. **Document** in sprint's `WISHLIST.md`:
   ```markdown
   ### Missing: [endpoint description]
   **Needed:** [HTTP method] [path]
   **Why:** [what test couldn't be done]
   **Workaround:** [if any]
   ```

2. **Implement** via subagent:
   ```
   Add endpoint [description] to the debug/admin API.
   See docs/design/debug-api.md for patterns.
   Follow existing style in packages/dashboard/src/routes/
   ```

3. **Update this doc** with the new endpoint

4. **Continue testing**

---

## File Locations

| File | Purpose |
|------|---------|
| `packages/dashboard/src/routes/debug.ts` | Debug endpoints |
| `packages/dashboard/src/routes/admin.ts` | Admin endpoints |
| `packages/dashboard/src/server.ts` | Route registration, localhost middleware |
| `packages/dashboard/src/ws-handler.ts` | WebSocket QA mode |

---

*Specification created: 2026-02-18*
*Part of: my_agent framework*
