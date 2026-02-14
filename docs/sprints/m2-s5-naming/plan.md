# Sprint M2-S5: Conversation Naming

> **Status:** Planned
> **Depends on:** M2-S4 (Conversation Persistence)
> **Design spec:** `docs/design/conversation-system.md`

## Goal

Conversations get meaningful haiku names automatically after turn 5.

## Key Principles

- **Haiku format:** 3-word lowercase phrase (e.g., `autumn-wind-drifts`)
- **Turn 5 trigger:** Enough substance to name meaningfully
- **Topics array:** Metadata for search, not user-facing categories
- **Cost:** ~$0.001 per naming call (Haiku is cheap)

## Tasks

### Task 1: Naming Service

Create the service that calls Haiku to generate conversation names.

**Files:**
- `packages/dashboard/src/conversations/naming.ts` — NEW: NamingService class

**NamingService API:**
```typescript
interface NamingResult {
  title: string;       // "autumn-wind-drifts"
  topics: string[];    // ["server-monitoring", "deployment"]
}

class NamingService {
  constructor(apiKey: string)

  async generateName(turns: TranscriptTurn[]): Promise<NamingResult>
}
```

**Haiku prompt:**
```
Given this conversation, generate:
1. A 3-word haiku-style title (lowercase, hyphenated): e.g., "morning-code-flows"
2. Topic tags (kebab-case): e.g., ["server-monitoring", "deployment"]

Return JSON: { "title": "...", "topics": [...] }
```

**Done when:** `generateName()` returns valid haiku titles from conversation turns.

### Task 2: Naming Trigger Integration

Integrate naming into the conversation flow — trigger at turn 5, update transcript and DB.

**Files:**
- `packages/dashboard/src/conversations/manager.ts` — MODIFY: add naming trigger
- `packages/dashboard/src/ws/chat-handler.ts` — MODIFY: send title update to client

**Flow:**
1. User sends 5th message
2. After agent response completes:
   a. Load last N turns
   b. Call `namingService.generateName()`
   c. Append `title_assigned` event to transcript
   d. Update `title` and `topics` in DB
   e. Send `conversation_renamed` to client

**Manager additions:**
```typescript
class ConversationManager {
  // ...existing...

  setTitle(id: string, title: string, topics: string[]): Promise<void>
  getTurnCount(id: string): Promise<number>
}
```

**Done when:** Conversations get named at turn 5. Title appears in sidebar.

### Task 3: Frontend Title Display + Manual Rename

Update frontend to show titles and allow manual renaming.

**Files:**
- `packages/dashboard/public/index.html` — MODIFY: title display, rename UI
- `packages/dashboard/public/js/app.js` — MODIFY: handle rename
- `packages/dashboard/public/css/app.css` — MODIFY: title styles

**Sidebar update:**
- Show haiku title or "New conversation" (if null)
- Click title to edit inline
- Enter to confirm, Escape to cancel

**Chat header:**
- Show current conversation title
- Click to edit (same inline edit pattern)

**App.js additions:**
```javascript
{
  editingTitle: false,
  editTitleValue: '',
}

renameConversation() {
  this.ws.send(JSON.stringify({
    type: 'rename_conversation',
    title: this.editTitleValue
  }));
}
```

**Handle `conversation_renamed`:**
```javascript
case 'conversation_renamed':
  const conv = this.conversations.find(c => c.id === data.conversationId);
  if (conv) conv.title = data.title;
  if (this.currentConversationId === data.conversationId) {
    this.currentTitle = data.title;
  }
  break;
```

**Done when:** Titles display in sidebar and header. Can click to rename.

### Task 4: Integration + Verification

Wire everything together, verify naming flow.

**Verification:**
1. `npx tsc --noEmit` — clean compilation
2. `npx prettier --write packages/dashboard/src/`
3. Start conversation, send 4 messages → title stays "New conversation"
4. Send 5th message → title updates to haiku (e.g., "morning-code-flows")
5. Sidebar updates in real-time
6. Click title in sidebar → inline edit
7. Type new name, press Enter → title updates
8. Press Escape → edit cancelled
9. Check cost: ~$0.001 per naming (verify in logs)

## Dependencies

```
Task 1 (NamingService)
  └── Task 2 (trigger integration)
        └── Task 3 (frontend title display)
              └── Task 4 (integration)
```

Task 1 must complete first. Task 3 needs Task 2. Task 4 needs all.

## Out of Scope

- Topic-based search (M4b)
- Rename history / undo
