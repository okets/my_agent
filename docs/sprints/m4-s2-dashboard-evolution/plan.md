# M4-S2: Dashboard Evolution (Workspace Layout)

> **Status:** Planned
> **Date:** 2026-02-18
> **Depends on:** M4-S1 (Notebook Infrastructure)

---

## Objectives

Transform the dashboard from chat-centric to a workspace model:

1. **Tab system** — Dynamic tabs for Notebook files, conversations, settings
2. **Permanent chat** — Right panel always showing owner ↔ Nina conversation
3. **Context awareness** — Chat knows which tab user is viewing
4. **Session storage** — UI state persists across page refresh

---

## Reference

OpenClaw Nina dashboard (path in `.my_agent/docs/references.md`)

Key patterns to adapt:
- `openTabs[]` array with tab state
- `activeTab` tracking
- `getCurrentTabContext()` for context injection
- `contentChanged` flag for dirty tracking
- Resizable split panel

---

## Layout Transformation

**Current:**
```
┌─────────────────────────────────────────────┐
│  Tabs: Conversations | External | Settings  │
├─────────────────────────────────────────────┤
│                                             │
│           Single View Area                  │
│           (conversation OR settings)        │
│                                             │
└─────────────────────────────────────────────┘
```

**New:**
```
┌──────────────────────────────────────────┬───────────────────────────┐
│  [Home] [external-comms.md] [Settings]   │ [▼ Conversation dropdown] │
├──────────────────────────────────────────┼───────────────────────────┤
│                                          │                           │
│         Active Tab Content               │   Owner ↔ Nina Chat       │
│                                          │   (permanent, always on)  │
│  • Home (quick actions, channels)        │                           │
│  • Notebook files (read-only for now)    │   Context badge shows     │
│  • External conversations (read-only)    │   active tab title        │
│  • Settings panel                        │                           │
│                                          │                           │
└──────────────────────────────────────────┴───────────────────────────┘
```

**Key distinction:**
- **Owner ↔ Nina conversations** — Primary interface, accessed via dropdown above chat. Not managed like objects.
- **Tabs** — For browsing/managing content: Notebook files, external conversations, settings.

---

## Tasks

### T1: Layout Structure

**File:** `packages/dashboard/public/index.html`

Restructure HTML:
- Main container with flexbox (left panel + right panel)
- Left panel: tab bar + content area
- Right panel: permanent chat (resizable width)
- Drag handle between panels for resizing

```html
<div class="flex h-screen">
  <!-- Left: Workspace -->
  <div class="flex-1 flex flex-col min-w-0">
    <!-- Tab bar -->
    <div class="tab-bar flex items-center border-b">
      <template x-for="tab in openTabs" :key="tab.id">
        <button @click="switchTab(tab.id)"
                :class="{ 'active': activeTab === tab.id }">
          <span x-text="tab.title"></span>
          <span x-show="tab.closeable" @click.stop="closeTab(tab.id)">×</span>
        </button>
      </template>
    </div>
    <!-- Content area -->
    <div class="flex-1 overflow-auto">
      <!-- Render active tab content -->
    </div>
  </div>

  <!-- Resize handle -->
  <div class="resize-handle w-1 bg-gray-300 cursor-col-resize"></div>

  <!-- Right: Permanent chat -->
  <div class="chat-panel flex flex-col" :style="{ width: chatWidth + 'px' }">
    <!-- Header: conversation dropdown + context badge -->
    <div class="chat-header">
      <!-- Conversation dropdown (owner ↔ Nina conversations) -->
      <!-- Context badge showing active tab -->
    </div>
    <!-- Chat messages -->
    <!-- Compose area -->
  </div>
</div>
```

### T2: Tab State Management

**File:** `packages/dashboard/public/js/app.js`

Add tab state to Alpine data:

```javascript
// Tab state
openTabs: [
  { id: 'home', type: 'home', title: 'Home', icon: '🏠', closeable: false }
],
activeTab: 'home',

// Tab methods
switchTab(id) {
  this.activeTab = id;
  this.saveUIState();
},

openTab(tab) {
  const existing = this.openTabs.find(t => t.id === tab.id);
  if (existing) {
    this.switchTab(tab.id);
    return;
  }
  this.openTabs.push(tab);
  this.switchTab(tab.id);
  this.saveUIState();
},

closeTab(id) {
  const tab = this.openTabs.find(t => t.id === id);
  if (tab?.contentChanged && !confirm('Discard unsaved changes?')) return;

  this.openTabs = this.openTabs.filter(t => t.id !== id);
  if (this.activeTab === id) {
    this.activeTab = this.openTabs[this.openTabs.length - 1]?.id || 'home';
  }
  this.saveUIState();
},
```

Tab types:
- `home` — Dashboard home (not closeable)
- `notebook` — Notebook file (closeable, has `data.file` and `data.content`)
- `conversation` — Contact conversation (closeable, has `data.conversationId`)
- `settings` — Settings panel (closeable)

### T3: Context Awareness

**File:** `packages/dashboard/public/js/app.js`

Add context tracking:

```javascript
getCurrentTabContext() {
  if (this.activeTab === 'home') return null;
  const tab = this.openTabs.find(t => t.id === this.activeTab);
  if (!tab) return null;
  return {
    type: tab.type,
    title: tab.title,
    file: tab.data?.file,  // For notebook tabs
    conversationId: tab.data?.conversationId  // For conversation tabs
  };
},
```

Modify WebSocket send to include context:

```javascript
sendMessage(content) {
  const context = this.getCurrentTabContext();
  this.ws.send(JSON.stringify({
    type: 'message',
    conversationId: this.ownerConversationId,
    content,
    context  // NEW: Include tab context
  }));
}
```

### T4: Chat Handler Context

**File:** `packages/dashboard/src/ws/chat-handler.ts`

Accept and log context from messages:

```typescript
// In message handler
if (data.context) {
  fastify.log.info(`[Context] User viewing: ${data.context.title}`);
  // Context is passed to brain via system prompt injection
  // Brain can reference it: "I see you're looking at external-communications.md"
}
```

### T5: Session Storage

**File:** `packages/dashboard/public/js/app.js`

Persist UI state:

```javascript
// State to persist
saveUIState() {
  const state = {
    openTabs: this.openTabs.map(t => ({
      id: t.id, type: t.type, title: t.title,
      icon: t.icon, closeable: t.closeable,
      data: t.data  // Includes file path, conversation ID, etc.
    })),
    activeTab: this.activeTab,
    chatWidth: this.chatWidth,
  };
  sessionStorage.setItem('dashboardState', JSON.stringify(state));
},

loadUIState() {
  const saved = sessionStorage.getItem('dashboardState');
  if (!saved) return;

  try {
    const state = JSON.parse(saved);
    this.openTabs = state.openTabs || [{ id: 'home', type: 'home', title: 'Home', icon: '🏠', closeable: false }];
    this.activeTab = state.activeTab || 'home';
    this.chatWidth = state.chatWidth || 400;
  } catch (e) {
    console.error('Failed to load UI state:', e);
  }
},

// Call on init
init() {
  this.loadUIState();
  // ... rest of init
}
```

### T6: Resizable Chat Panel

**File:** `packages/dashboard/public/js/app.js`

Add resize handling:

```javascript
chatWidth: 400,
isResizing: false,

startResize(e) {
  this.isResizing = true;
  document.addEventListener('mousemove', this.handleResize);
  document.addEventListener('mouseup', this.stopResize);
},

handleResize(e) {
  if (!this.isResizing) return;
  const newWidth = window.innerWidth - e.clientX;
  this.chatWidth = Math.max(300, Math.min(800, newWidth));
},

stopResize() {
  this.isResizing = false;
  document.removeEventListener('mousemove', this.handleResize);
  document.removeEventListener('mouseup', this.stopResize);
  this.saveUIState();
},
```

### T7: Home Tab Content

**File:** `packages/dashboard/public/index.html`

Create Home tab content:

```html
<div x-show="activeTab === 'home'" class="p-6">
  <h1 class="text-2xl font-bold mb-6">Dashboard</h1>

  <!-- Quick actions -->
  <div class="grid grid-cols-3 gap-4 mb-8">
    <button @click="openNotebookTab('external-communications')"
            class="p-4 border rounded hover:bg-gray-50">
      📋 External Rules
    </button>
    <button @click="openNotebookTab('reminders')"
            class="p-4 border rounded hover:bg-gray-50">
      ✅ Reminders
    </button>
    <button @click="openNotebookTab('standing-orders')"
            class="p-4 border rounded hover:bg-gray-50">
      📜 Standing Orders
    </button>
  </div>

  <!-- Channel status -->
  <h2 class="text-lg font-semibold mb-4">Channels</h2>
  <div class="space-y-2">
    <template x-for="channel in channels" :key="channel.id">
      <div class="flex items-center justify-between p-3 border rounded">
        <span x-text="channel.id"></span>
        <span :class="channel.status === 'connected' ? 'text-green-600' : 'text-red-600'"
              x-text="channel.status"></span>
      </div>
    </template>
  </div>
</div>
```

### T8: Migrate Existing Views

Migrate current views to new layout:
- **Owner conversations** → Dropdown above right-panel chat (not tabs, these are primary interface)
- **Channel/external conversations** → Clicking in Home tab opens as read-only tab
- **Settings** → Opens as tab in left panel

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/dashboard/public/index.html` | Complete layout restructure |
| `packages/dashboard/public/js/app.js` | Tab state, context, session storage, resize |
| `packages/dashboard/src/ws/chat-handler.ts` | Accept context in messages |
| `packages/dashboard/src/ws/protocol.ts` | Add context field to ClientMessage |

---

## Verification

1. **Layout:** Tabs on left, permanent chat on right
2. **Tab system:** Can open/close tabs, switch between them
3. **Home tab:** Shows quick actions and channel status
4. **Context badge:** Chat shows "Viewing: [tab title]" when not on Home
5. **Resize:** Can drag chat panel width, persists across refresh
6. **Session storage:** Refresh page → tabs and state restored
7. **Close warning:** Closing tab with unsaved changes prompts confirmation

---

## Dependencies

- **Upstream:** M4-S1 (Notebook files must exist for quick actions)
- **Downstream:** M4-S3 (Editing Tool), M4-S6 (Dashboard Integration)

---

## Risk: Sprint Size

This sprint has 8 tasks covering significant UI restructuring. If progress stalls:

**Consider splitting into S2a + S2b:**
- **S2a: Layout + Tabs** (T1, T2, T5, T7) — Split panel, tab state, session storage, Home tab
- **S2b: Context + Migration** (T3, T4, T6, T8) — Context awareness, chat handler, resize, view migration

Review at mid-sprint and split if needed.

---

## Not in Scope

- Notebook file editing UI (M4-S6)
- Notebook editing tool for Nina (M4-S3)
- Contact conversation tab content (uses existing conversation view)
