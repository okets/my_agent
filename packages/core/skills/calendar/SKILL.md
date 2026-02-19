# Scheduling

Manage time-based entries through natural conversation.

## API Discovery

For full API documentation: `curl http://localhost:4321/api/debug/api-spec | jq .calendar`

## Modes

This skill handles two modes based on context:

1. **Create** — User selected a time slot, wants to schedule something new
2. **Edit** — User opened an existing entry, wants to modify or delete it

The context below the command tells you which mode.

## Create Flow

1. **Ask what it's for**: "What's this for?" or "What do you need to do then?"
2. **Confirm details**: Title, time (already provided), any notes/instructions
3. **Create the entry** using the API below
4. **Confirm**: "Done — I've scheduled [title] for [time]."

## Edit Flow

1. **Ask what to change**: "What would you like to update?"
2. **Listen for intent**: Time, title, notes, or deletion
3. **Make the change** using the API below
4. **Confirm**: "Updated — [brief summary]"

## Important Rules

- Frame as "scheduling", "entries", or "reminders" — **NEVER say "calendar event"**
- Keep it natural and brief — don't over-interview
- If they give you everything at once, just confirm and move on
- For deletions, confirm first: "Sure you want to remove this?"
- **Instructions are for YOU to EXECUTE at that time** — write what YOU will do WHEN the entry triggers:
  - "At this time: Research X and prepare summary"
  - "When triggered: Draft email to Y about Z"

## Endpoints

| Method | Path | Required Fields | Description |
|--------|------|-----------------|-------------|
| GET | /api/calendar/events | — | List all scheduled tasks |
| POST | /api/calendar/events | calendarId, title, start | Create scheduled task |
| PUT | /api/calendar/events/:uid | — | Update scheduled task |
| DELETE | /api/calendar/events/:uid | — | Delete scheduled task |

## API Reference

**Create:**
```bash
curl -s -X POST http://localhost:4321/api/calendar/events \
  -H "Content-Type: application/json" \
  -d '{"calendarId": "user", "title": "TITLE", "start": "ISO_DATE", "end": "ISO_DATE", "description": "NOTES"}'
```

**Update:**
```bash
curl -s -X PUT http://localhost:4321/api/calendar/events/EVENT_UID \
  -H "Content-Type: application/json" \
  -d '{"title": "New Title", "start": "ISO_DATE", "description": "NOTES"}'
```

**Delete:**
```bash
curl -s -X DELETE "http://localhost:4321/api/calendar/events/EVENT_UID?calendarId=user"
```

**List:**
```bash
curl -s http://localhost:4321/api/calendar/events
```

Format dates as ISO 8601 (YYYY-MM-DDTHH:MM:SS). Default duration is 1 hour if end omitted.
