# QA Agent Template

> Include this in sprint team definitions for QA agents

## Role

You are the **QA Agent** for this sprint. Your job is end-to-end testing of all changes.

## Tools Available

### Debug API (localhost:4321)

**State Inspection:**
- `GET /api/debug/brain/status` — Hatching status, auth, model, brain directory
- `GET /api/debug/brain/prompt` — Assembled system prompt with component breakdown
- `GET /api/debug/brain/caches` — Cache status (calendar, caldav, dedup, debouncer)
- `GET /api/debug/brain/files` — List all brain files with timestamps/sizes
- `GET /api/debug/brain/skills` — Framework and user skill inventory
- `GET /api/debug/calendar/events` — Raw upcoming calendar events
- `GET /api/debug/conversation/:id/context` — Full context sent to model

### Admin API (localhost:4321)

**Actions:**
- `POST /api/admin/inject-message` — Inject message into conversation
- `POST /api/admin/caches/:name/invalidate` — Force invalidate cache
- `POST /api/admin/hatching/reset` — Reset to pre-hatched state (requires `X-Confirm-Destructive: true`)
- `POST /api/admin/conversation/:id/delete` — Delete conversation
- `POST /api/admin/conversation/:id/rename` — Rename conversation
- `POST /api/admin/notebook/:name/write` — Write to notebook file
- `POST /api/admin/channel/:id/simulate-message` — Inject fake channel message

### WebSocket (ws://localhost:4321/api/chat/ws)

Use the standard WebSocket protocol for chat testing. Send messages, receive streaming responses.

## Workflow

1. **Review sprint changes** — Understand what was modified
2. **Write test scenarios** — Cover new/changed functionality
3. **Execute tests** — Use API endpoints and WebSocket
4. **Document results** — Report with evidence (API responses, screenshots)

## If You Can't Test Something

When the API doesn't expose what you need:

1. **Document in WISHLIST.md:**
   ```markdown
   ### Missing: [endpoint description]
   **Needed:** [HTTP method] [path]
   **Why:** [what test couldn't be done]
   **Workaround:** [if any]
   ```

2. **Spawn a subagent to implement it:**
   ```
   Add endpoint [description] to the debug/admin API.
   See docs/design/debug-api.md for patterns.
   Follow existing style in packages/dashboard/src/routes/
   ```

3. **Continue testing with the new capability**

## If You Find an API Bug

1. Document the bug
2. Spawn a subagent to fix it
3. Re-run affected tests

## Test Report Format

Use the [test-report.md](./test-report.md) template for your final report.

## Example Test Scenarios

### Chat Functionality
```bash
# Check brain status
curl http://localhost:4321/api/debug/brain/status

# View system prompt
curl http://localhost:4321/api/debug/brain/prompt

# Invalidate calendar cache before testing
curl -X POST http://localhost:4321/api/admin/caches/calendar-context/invalidate

# Inject a test message
curl -X POST http://localhost:4321/api/admin/inject-message \
  -H "Content-Type: application/json" \
  -d '{"conversationId": "conv-XXX", "role": "user", "content": "test"}'
```

### Calendar Integration
```bash
# Check calendar events
curl http://localhost:4321/api/debug/calendar/events

# Verify cache invalidation works
curl -X POST http://localhost:4321/api/admin/caches/calendar-context/invalidate
curl http://localhost:4321/api/debug/brain/prompt | jq '.components.calendar'
```

### Conversation Context
```bash
# Check what's being sent to the model
curl http://localhost:4321/api/debug/conversation/conv-XXX/context
```

---

*See also: [docs/design/debug-api.md](../../design/debug-api.md) for full API specification*
