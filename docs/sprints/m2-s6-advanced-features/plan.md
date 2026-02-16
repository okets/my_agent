# Sprint M2-S6: Advanced Chat Features

> **Status:** Active
> **Depends on:** M2-S5 (Naming)
> **Design spec:** This document
> **Design language:** [`docs/design/nina-v1-design-language.md`](../../design/nina-v1-design-language.md)

## Design Language Compliance

**All frontend work in this sprint MUST follow the Nina V1 Design Language.**

Key requirements:
- **Glass panels:** Purple-tinted `rgba(30,30,46,0.8)`, not transparent
- **Send button:** Solid coral `#e07a5f`, not ghost style
- **Model badge:** Purple-tinted with capability icons (Thinking/Vision/Tools)
- **Compose border:** `0.15` normal → `0.35` on focus
- **Capability badges:** `text-[9px]` with `bg-{color}-500/15` backgrounds
- **Toggle active state:** `bg-violet-500/20 text-violet-300 border-violet-500/30`

Reference the full design language doc and `packages/dashboard/CLAUDE.md` before implementing any UI.

---

## Goal

Add power-user features to the chat interface: conversation deletion, per-conversation model selection, extended thinking toggle, and file attachments.

## Features

### Feature 1: Conversation Deletion

Allow users to permanently delete conversations from the sidebar.

**Behavior:**
- Trash icon appears on hover over conversation in sidebar
- Click opens confirmation dialog: "Delete this conversation? This cannot be undone."
- Confirm → full purge (SQLite + FTS + JSONL transcript)
- If deleting active conversation → show empty chat state
- Multi-tab: broadcast deletion to all connected tabs

**Implementation:**

| Layer | File | Changes |
|-------|------|---------|
| DB | `packages/dashboard/src/conversations/db.ts` | Add `deleteConversation(id)` with transaction (conversations + turns_fts) |
| Transcript | `packages/dashboard/src/conversations/transcript.ts` | Add `deleteTranscript(id)` |
| Manager | `packages/dashboard/src/conversations/manager.ts` | Add `delete(id)` coordinating DB + transcript |
| Protocol | `packages/dashboard/src/ws/protocol.ts` | Add `delete_conversation` client msg, `conversation_deleted` server msg |
| Handler | `packages/dashboard/src/ws/chat-handler.ts` | Add `handleDeleteConversation()` with session cleanup + broadcast |
| Frontend | `packages/dashboard/public/index.html` | Delete button in sidebar, confirmation dialog |
| Frontend | `packages/dashboard/public/js/app.js` | Delete handlers, WS message handler |

### Feature 2: Action Bar

New UI element below the input text area (OpenClaw style).

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ [Message input textarea]                                    │
├─────────────────────────────────────────────────────────────┤
│ claude-sonnet-4-5 ▼  │  ◇ Reasoning  │  📎  │         [↑]  │
└─────────────────────────────────────────────────────────────┘
```

**Elements:**
- Model selector (dropdown)
- Reasoning toggle (checkbox/switch)
- Attachment button (file picker)
- Send button (existing, repositioned)

**Implementation:**

| File | Changes |
|------|---------|
| `packages/dashboard/public/index.html` | New action bar div below textarea, move send button |
| `packages/dashboard/public/js/app.js` | State for model, reasoning, attachments |
| `packages/dashboard/public/css/app.css` | Action bar styling |

### Feature 3: Per-Conversation Model Selection

Each conversation can use a different Claude model.

**Behavior:**
- New conversations inherit global default from config
- User can change model via action bar dropdown
- Model persists in DB, survives refresh
- Changing model takes effect on next message (no session restart needed)

**Available models:**
- `claude-sonnet-4-5-20250929` (default)
- `claude-haiku-4-5-20251001` (fast, cheap)
- `claude-opus-4-6` (most capable)

**Implementation:**

| Layer | File | Changes |
|-------|------|---------|
| Types | `packages/dashboard/src/conversations/types.ts` | Add `model: string \| null` to Conversation |
| DB | `packages/dashboard/src/conversations/db.ts` | Add `model` column + migration |
| Manager | `packages/dashboard/src/conversations/manager.ts` | Add `setModel(id, model)` |
| Protocol | `packages/dashboard/src/ws/protocol.ts` | Add `set_model` client msg |
| Handler | `packages/dashboard/src/ws/chat-handler.ts` | Add `handleSetModel()`, pass model to session |
| Session | `packages/dashboard/src/agent/session-manager.ts` | Accept model override in `streamMessage()` |
| Frontend | `packages/dashboard/public/index.html` | Model dropdown in action bar |
| Frontend | `packages/dashboard/public/js/app.js` | Model state, change handler |

### Feature 4: Extended Thinking Toggle

Toggle extended thinking (reasoning) per-message.

**Behavior:**
- Toggle in action bar (**off by default**)
- Per-message, session only (not persisted)
- When enabled: adaptive thinking with high effort
- When disabled: no extended thinking
- Thinking blocks already render in UI (from M2-S2)

**Implementation:**

| Layer | File | Changes |
|-------|------|---------|
| Protocol | `packages/dashboard/src/ws/protocol.ts` | Add optional `reasoning: boolean` to message |
| Handler | `packages/dashboard/src/ws/chat-handler.ts` | Pass reasoning flag to session |
| Session | `packages/dashboard/src/agent/session-manager.ts` | Configure thinking when reasoning=true |
| Frontend | `packages/dashboard/public/index.html` | Reasoning toggle in action bar |
| Frontend | `packages/dashboard/public/js/app.js` | Reasoning state (default: false) |

**Agent SDK config:**
```typescript
// In createBrainQuery options:
thinking: reasoning ? { type: 'adaptive' } : { type: 'disabled' },
effort: reasoning ? 'high' : undefined
```

**Note:** Requires extending `packages/core/src/brain.ts` — `BrainSessionOptions` currently lacks thinking/effort fields.

**Haiku incompatibility:** Haiku doesn't support extended thinking. Defense in depth:
- Frontend: disable reasoning toggle when Haiku model selected
- Backend: ignore reasoning flag when model is Haiku

### Feature 5: File Attachments

Upload images and text files to include in messages. **Attachments are persisted locally.**

**Supported types:**
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` → Claude vision (base64)
- Text: `.txt`, `.md`, `.json`, `.yaml`, `.ts`, `.js`, `.py` → code block in message

**Input methods:**
- **Clipboard paste** (Ctrl+V) — images pasted directly into textarea
- **File picker** — click attachment icon, select multiple files
- **Drag-and-drop** — drop files onto input area

**Size handling:**
- **Client-side feedback** — show file size, warn if approaching 5MB limit
- **Image resizing** — compress images >2MB client-side (canvas resize to max 1920px)
- **Server validation** — 5MB hard limit
- **WebSocket config** — `maxPayload: 8MB` to handle base64 overhead

**Storage architecture:**
```
.my_agent/conversations/
├── conversations.db
├── conv-abc123.jsonl              # transcript
├── conv-abc123/                   # attachments folder
│   ├── uuid1.png
│   └── uuid2.ts
└── ...
```

**Flow:**
1. Client sends base64 attachment in WebSocket message
2. Server saves to `.my_agent/conversations/{convId}/{uuid}.{ext}`
3. Server returns `{localPath, url}` for transcript storage
4. Transcript records: `{filename, localPath, type, size}`
5. Chat renders `<img src="/api/attachments/{convId}/{filename}">` for images
6. On conversation delete: remove `{convId}/` folder recursively

**Preview UI:**
- Images: 80x80px thumbnails with X button on hover
- Text files: filename chips with X button
- Chat history: `<img>` tags render stored images

**Implementation:**

| Layer | File | Changes |
|-------|------|---------|
| Protocol | `packages/dashboard/src/ws/protocol.ts` | Add `attachments: Attachment[]` to message |
| Storage | `packages/dashboard/src/conversations/attachments.ts` | **NEW**: Save/delete/serve attachments |
| Routes | `packages/dashboard/src/server.ts` | Add `GET /api/attachments/:convId/:filename` |
| Handler | `packages/dashboard/src/ws/chat-handler.ts` | Save attachments, process into content blocks |
| Session | `packages/dashboard/src/agent/session-manager.ts` | Accept content blocks (not just string) |
| Transcript | `packages/dashboard/src/conversations/transcript.ts` | Store attachment metadata in turns |
| Frontend | `packages/dashboard/public/index.html` | Attachment button, preview area, file input, drop zone |
| Frontend | `packages/dashboard/public/js/app.js` | Paste handler, file picker, drag-drop, image resize, attachment state |
| Frontend | `packages/dashboard/public/css/app.css` | Preview thumbnails, chips styling, drop zone highlight |

**Content block format (to Claude):**
```typescript
// Image → Claude vision
{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '...' } }

// Text file → code block with filename
{ type: 'text', text: '```config.json\n{"key": "value"}\n```' }
```

**Transcript format:**
```typescript
// Stored in JSONL turn
{
  type: 'turn',
  role: 'user',
  content: 'Check this image',
  attachments: [
    { filename: 'photo.png', localPath: 'conv-abc123/uuid1.png', type: 'image/png', size: 123456 }
  ]
}
```

## Tasks

### Task 1: Database Schema Updates

Add `model` column to conversations table. Update ConversationMeta type.

**Files:**
- `packages/dashboard/src/conversations/types.ts` — Add `model: string | null` to Conversation
- `packages/dashboard/src/conversations/db.ts` — Add `model` column + migration
- `packages/dashboard/src/ws/protocol.ts` — Add `model` to ConversationMeta

**Done when:** Migration adds column, types updated, ConversationMeta includes model, CRUD methods handle model field.

### Task 2: Conversation Deletion Backend

Implement delete across all layers with proper cleanup.

**Files:**
- `packages/dashboard/src/conversations/db.ts` — Delete conversation + FTS entries
- `packages/dashboard/src/conversations/transcript.ts` — Delete JSONL file
- `packages/dashboard/src/conversations/attachments.ts` — Delete attachments folder
- `packages/dashboard/src/conversations/manager.ts` — Coordinate all deletions
- `packages/dashboard/src/ws/protocol.ts` — Add `delete_conversation` client msg, `conversation_deleted` server msg
- `packages/dashboard/src/ws/chat-handler.ts` — Handle deletion with cleanup

**Cleanup requirements:**
- Cancel pending abbreviation task (`abbreviationQueue.remove(id)`)
- Clear idle timer (`idleTimerManager.clear(id)`)
- Remove from SessionRegistry (`sessionRegistry.remove(id)`)
- Delete attachments folder recursively
- Accept orphaned FTS entries (filtered at query time)

**Done when:** `delete_conversation` WebSocket message fully deletes conversation (DB + FTS + transcript + attachments), cleans up in-memory state, and broadcasts to all tabs.

### Task 3: Action Bar UI

Create the action bar below input with all controls.

**Files:**
- `packages/dashboard/public/index.html`
- `packages/dashboard/public/css/app.css`
- `packages/dashboard/public/js/app.js`

**Done when:** Action bar renders with model dropdown, reasoning toggle, attachment button, send button.

### Task 4: Model Selection

Wire model selection end-to-end.

**Files:**
- `packages/dashboard/src/ws/protocol.ts`
- `packages/dashboard/src/ws/chat-handler.ts`
- `packages/dashboard/src/agent/session-manager.ts`
- `packages/dashboard/public/js/app.js`

**Done when:** Changing model in dropdown persists and affects next message's model.

### Task 5: Extended Thinking

Wire reasoning toggle end-to-end. **Requires changes to packages/core.**

**Files:**
- `packages/core/src/brain.ts` — Add `thinking` and `effort` to BrainSessionOptions, pass through to SDK
- `packages/dashboard/src/ws/protocol.ts` — Add `reasoning: boolean` to message
- `packages/dashboard/src/ws/chat-handler.ts` — Pass reasoning flag to session
- `packages/dashboard/src/agent/session-manager.ts` — Pass thinking/effort to createBrainQuery
- `packages/dashboard/public/js/app.js` — Reasoning state, disable toggle for Haiku

**Done when:** Toggling reasoning on causes extended thinking in response. Haiku model disables toggle.

### Task 6: File Attachments

Implement attachment upload, local storage, and serving.

**Files:**
- `packages/dashboard/src/conversations/attachments.ts` — **NEW**: AttachmentService (save, delete, get path)
- `packages/dashboard/src/server.ts` — Configure WebSocket maxPayload 8MB, add GET /api/attachments/:convId/:filename
- `packages/dashboard/src/ws/protocol.ts` — Add Attachment type, add to message
- `packages/dashboard/src/ws/chat-handler.ts` — Save attachments via AttachmentService, build content blocks
- `packages/dashboard/src/conversations/transcript.ts` — Store attachment metadata in turns
- `packages/dashboard/src/agent/session-manager.ts` — Accept content blocks (not just string)
- `packages/dashboard/public/index.html` — Attachment button, preview area, file input, drop zone
- `packages/dashboard/public/js/app.js` — Paste handler, file picker, drag-drop, image resize
- `packages/dashboard/public/css/app.css` — Preview thumbnails, chips, drop zone highlight

**Done when:**
- Clipboard paste adds image attachments
- File picker allows selecting images + text files
- Drag-and-drop onto input area works
- Preview shows thumbnails/chips with remove button + file size
- Large images auto-resized client-side (>2MB → max 1920px)
- Size warning shown if file approaches limit
- Server validates 5MB limit
- Attachments saved to `.my_agent/conversations/{convId}/`
- GET /api/attachments/:convId/:filename serves stored files
- Chat history renders `<img>` tags for stored images
- Images sent to Claude as base64 vision blocks
- Text files sent as code blocks with filename

### Task 7: Conversation Deletion Frontend

Add delete button and confirmation dialog.

**Files:**
- `packages/dashboard/public/index.html`
- `packages/dashboard/public/js/app.js`
- `packages/dashboard/public/js/ws-client.js`

**Done when:** Can delete conversations from sidebar with confirmation. Multi-tab sync works.

### Task 8: Integration & Verification

Verify all features work together.

**Verification:**
1. Start dashboard, create conversation
2. **Deletion:** Delete button on hover, confirmation dialog, full purge
3. **Deletion:** Delete active conversation → empty state
4. **Deletion:** Multi-tab sync (delete in tab A, disappears in tab B)
5. **Deletion:** Attachments folder deleted with conversation
6. **Model:** Dropdown shows 3 models, selection persists across refresh
7. **Model:** Switching model affects response style
8. **Reasoning:** Toggle off by default, enables thinking blocks when on
9. **Reasoning:** Toggle disabled when Haiku selected
10. **Attachments:** Ctrl+V pastes image, shows thumbnail preview
11. **Attachments:** File picker allows multi-select images + text
12. **Attachments:** Drag-and-drop files onto input area works
13. **Attachments:** File size shown in preview, warning near limit
14. **Attachments:** Large image (>2MB) auto-resized, size reduced
15. **Attachments:** Remove button (X) removes attachment
16. **Attachments:** Image saved to `.my_agent/conversations/{convId}/`
17. **Attachments:** Chat history renders `<img>` tags for past images
18. **Attachments:** Image → Claude describes it (vision working)
19. **Attachments:** .ts file → Claude sees code block with filename
20. **Attachments:** >5MB file rejected with error message
21. **Integration:** All features work in combination

## Dependencies

```
Task 1 (Schema) ─────────────────────────┐
                                         │
Task 2 (Delete Backend) ─────────────────┼──► Task 7 (Delete Frontend)
                                         │
Task 3 (Action Bar UI) ──┬──► Task 4 (Model Selection)
                         ├──► Task 5 (Extended Thinking)
                         └──► Task 6 (File Attachments)
                                         │
                                         └──► Task 8 (Integration)
```

Tasks 1-3 can run in parallel. Tasks 4-7 depend on Task 3. Task 8 is final.

## Out of Scope

- Voice/audio input (deferred to S7 — needs transcription service research)
- Text-to-speech / voice output
- Model cost estimation display

---

## Sprint Execution (Normal Mode)

**This is a normal sprint with CTO review between features.**

### Review Checkpoints

After completing each feature group, **STOP for CTO review** before proceeding:

| Checkpoint | After Tasks | Review Focus |
|------------|-------------|--------------|
| **Review 1** | Tasks 1-2 | Schema + deletion backend working |
| **Review 2** | Task 3 | Action bar UI renders correctly |
| **Review 3** | Tasks 4-5 | Model selection + reasoning toggle work end-to-end |
| **Review 4** | Task 6 | Attachments upload, store, render, serve |
| **Review 5** | Tasks 7-8 | Deletion frontend + full integration test |

At each checkpoint:
1. Demo the completed functionality
2. Show test results from verification list
3. Get CTO approval before proceeding
4. Note any deviations or decisions made
