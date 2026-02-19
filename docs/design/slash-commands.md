# Slash Commands

How slash commands work in the my_agent dashboard.

## Overview

Slash commands (`/my-agent:*`) inject contextual instructions into conversations. They let UI interactions trigger specific agent behaviors without embedding lengthy prompts in the frontend.

## Architecture

```
┌─────────────────┐       ┌──────────────────┐       ┌─────────────────┐
│   Frontend      │       │   Server         │       │   Brain         │
│   (app.js)      │       │   (chat-handler) │       │   (Agent SDK)   │
├─────────────────┤       ├──────────────────┤       ├─────────────────┤
│ User clicks     │       │ Intercepts       │       │ Receives full   │
│ "Ask Nina"      │──────▶│ /my-agent:*      │──────▶│ skill content   │
│                 │       │ Loads SKILL.md   │       │ + context       │
│ Sends:          │       │ Expands message  │       │                 │
│ /my-agent:skill │       │                  │       │ Follows         │
│ + context       │       │ Saves original   │       │ instructions    │
│                 │       │ to transcript    │       │                 │
└─────────────────┘       └──────────────────┘       └─────────────────┘
```

## Flow

1. **Frontend injects command** — UI action (like clicking a time slot) sends `/my-agent:calendar` + structured context
2. **Server intercepts** — `expandSkillCommand()` detects `/my-agent:*` at message start
3. **Skill loaded** — Reads `packages/core/skills/{name}/SKILL.md`
4. **Message expanded** — Skill content + context sent to brain
5. **Original saved** — Transcript stores clean slash command (user sees concise message)
6. **Brain follows skill** — Agent executes according to SKILL.md instructions

## Creating a Skill

1. Create directory: `packages/core/skills/{skill-name}/`
2. Add `SKILL.md` with:
   - First non-header line = description (shown in help)
   - Instructions for the agent
   - API references if needed
   - Context parsing guidance

### Example: Calendar Skill

```markdown
# Scheduling

Manage time-based instructions through natural conversation.

## Modes

This skill handles two modes based on context:
1. **Create** — User selected a time slot
2. **Edit** — User opened an existing entry

## Create Flow

1. Ask what it's for: "What's this for?"
2. Confirm details
3. Create via API
4. Confirm creation

## API Reference

**Create:**
\`\`\`bash
curl -s -X POST http://localhost:4321/api/calendar/events \
  -H "Content-Type: application/json" \
  -d '{"calendarId": "user", "title": "TITLE", ...}'
\`\`\`
```

## Frontend Integration

In `app.js`, inject commands with structured context:

```javascript
// Clean slash command + context
const prompt = `/my-agent:calendar

**Create new entry**
Time: ${timeInfo}
Start: ${startISO}
End: ${endISO}`;

this._pendingEventPrompt = prompt;
```

## Key Design Decisions

### Why server-side expansion?

- **Clean transcripts** — Users see `/my-agent:calendar`, not walls of API docs
- **Single source of truth** — Skills maintained in one place
- **Dynamic loading** — Skills can be updated without frontend changes

### Why not embed in system prompt?

- **Token efficiency** — Only load skills when invoked
- **Focused context** — Brain sees relevant instructions at the right time
- **Maintainability** — Clear separation between framework skills and user brain

### Why framework skills vs user skills?

| Location | Purpose |
|----------|---------|
| `packages/core/skills/` | Framework capabilities (calendar, auth, etc.) |
| `.my_agent/brain/skills/` | User-specific skills (custom workflows) |

Both are loaded from `loadSkillContent()` — framework skills take precedence.

## Lessons Learned

1. **Server restart required** — tsx doesn't hot-reload. Always restart after skill changes.
2. **Path resolution** — Use `import.meta.dirname` for reliable relative paths in ESM.
3. **Transcript vs brain content** — Save original to transcript, send expanded to brain.
4. **Framing matters** — Skills should specify language constraints (e.g., "NEVER say calendar event").

## See Also

- [packages/core/skills/](../../packages/core/skills/) — Framework skills
- [chat-handler.ts](../../packages/dashboard/src/ws/chat-handler.ts) — Expansion logic
- [prompt.ts](../../packages/core/src/prompt.ts) — Skill listing for system prompt
