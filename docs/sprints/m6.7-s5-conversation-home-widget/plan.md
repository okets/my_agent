# M6.7-S5: Conversation Home Widget — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the conversation dropdown and any remaining tab-based switching with a Conversations widget on the Home tab. Chat area becomes a single-conversation workspace. Past conversations are browsed from the Home widget, opened as read-only previews, and resumed with an explicit button.

**Prerequisites:** S4 complete (search infrastructure, REST API for conversation data)

**Recovery context:** [recovery/m6.7-conversations/](../../recovery/m6.7-conversations/) — This sprint reconstructs the lost S6 from branch `sprint/m6.7-s6-s7`. The transcript contains the full before-state of all modified files, the widget HTML that was inserted, and corrections made during review.

**Tech Stack:** Alpine.js, Tailwind CSS (CDN), Fastify (WebSocket)

**Design doc:** `docs/plans/2026-03-04-conversation-nina-design.md`

---

## ⚠️ Critical Design Constraints (from user review)

These were discovered during the original sprint and MUST be followed:

1. **Home widget, NOT tab bar.** Past conversations live on the Home tab as a widget, following the same pattern as Timeline. NOT a browser-style tab bar above the chat. NOT a dropdown menu.
2. **Read-only preview before resume.** Clicking a conversation opens a read-only preview (desktop: left-panel tab with transcript, mobile: popover). Only clicking "Resume conversation" makes it active in the chat.
3. **Current conversation filtered from widget.** The active conversation lives in the chat panel. It does NOT appear in the Home widget. Only inactive conversations with `turnCount > 0` are shown.
4. **Live updates are inherent.** When the user clicks "New chat", the old conversation must instantly appear in the widget. This is a requirement of the widget, not a separate feature.
5. **Empty conversations should not exist.** Filter `turnCount > 0` in widget. Auto-delete empty conversations on leave. Startup cleanup for any existing empty ones.

## ⚠️ Pitfalls from Previous Attempt

1. **`currentTitle` is a getter** — cannot be assigned directly. It derives from `currentConversationId` + `conversations` array.
2. **Alpine store sync** — `ws-client.js` updates `Alpine.store("conversations").items`, and `Alpine.effect` at ~line 382 syncs it to the component's `conversations` property. The widget works reactively through this chain.
3. **Mobile popover reactivity** — Set `mobile.popover.data = newData` on the Alpine proxy directly. Do NOT replace the entire popover store object. Use `x-show` (not `x-if`) in the popover template and reference `$store.mobile.popover.data` directly (no getter `x-data`). **Proven fix from recovered transcript:** `docs/recovery/whatsapp-stability/dashboard-reactivity-fixes.md`
4. **Desktop tab reactivity** — `_fetchConversationTabData()` must reassign `tab.data` as a new object (`tab.data = { ...tab.data, turns, loading: false }`) AND trigger array reactivity with `this.openTabs = [...this.openTabs]`. Deep property mutation (`tab.data.turns = x`) is invisible to Alpine because tab is nested inside the openTabs array.
5. **Tab restore from localStorage** — Conversation preview tabs restored on page load need to re-fetch transcript data via `_fetchConversationTabData()` (using the same reactivity-safe pattern from pitfall #4).
6. **Scroll to visible container** — `scrollToBottom()` must check `offsetHeight > 0` to pick the visible container (desktop vs mobile — only one is rendered at a time). Mobile needs a 350ms delayed scroll after `conversation_loaded` to wait for the chat sheet CSS transition.
7. **`x-show` over `x-if` for async data** — `x-if` destroys/recreates DOM. If data arrives after creation, the template may not re-evaluate. Use `x-show` for sections that toggle based on loading/loaded state.
8. **Push after every commit.** `git push origin <branch>` immediately. The last sprint's work was lost because branches weren't pushed.

## ⚠️ Opus Review Corrections (post-plan)

These were found by comparing the plan against the actual codebase state:

1. **Lost-branch state vs master.** The plan references removing `convTabs`, `activeConvTabId`, `openConvTab`, `switchToConvTab`, `closeConvTab`, `ensureCurrentConvTab`, `syncConvTabs` — **these do NOT exist on current master**. They were on the lost branch. Task 1's "What to Remove (app.js)" for these items is a no-op. Focus removal on: conversation dropdown (`convDropdownOpen`, lines ~3456-3668) and mobile switcher (`convSwitcherOpen`, lines ~6627-6784).
2. **`searchConversations()` and search state must be CREATED.** `convSearchQuery`, `convSearchResults`, `convSearchLoading` do not exist on master. Plan says "keep" but they need to be written from scratch in Task 2.
3. **Wrong API URLs.** Conversation transcript: use `/api/admin/conversations/:id` (not `/api/conversations/:id`). Search: use `/api/memory/conversations/search` (not `/api/conversations/search`). OR: S4 creates new non-admin routes and these URLs change — coordinate with S4's REST API task.
4. **`mobile.js` cleanup needed.** Remove dead code: `convSwitcherOpen`, `openConvSwitcher()`, `closeConvSwitcher()`, `toggleConvSwitcher()` (lines ~106-107, 121, 208-227, 738-739).
5. **Existing conversation tab placeholder.** `index.html` line ~2593-2616 has a stub for `type === 'conversation'` tabs saying "External conversation view will be implemented in a future sprint." Replace this with the actual transcript preview in Task 3.
6. **Use landmarks, not line numbers.** Current master line numbers differ from before-state doc. Search for `<!-- Timeline Section -->`, `<!-- Notebook -->`, etc. instead of hardcoded line numbers.
7. **`deleteIfEmpty` needs `await`.** `conversationManager.get()` is async — the plan's code snippet is missing `await`.

---

## Wireframes

### Desktop Layout (1440x900)

```
┌──────────────────────────────────────┬─────────────────────────┐
│ [Home] [Calendar] [Settings]         │ [Avatar] Title [✎] [+]  │
├──────────────────────────────────────┤─────────────────────────┤
│                                      │                         │
│  Dashboard              🕐 12:34 PM  │  Welcome! How can I     │
│                                      │  help you today?        │
│  ┌─ Notebook Widget ──────────────┐  │                         │
│  │ [Ops] [Lists] [Daily] [Know]   │  │                         │
│  │ ...                            │  │                         │
│  └────────────────────────────────┘  │                         │
│                                      │                         │
│  ┌─ Conversations ─────── [🔍] ──┐  │                         │
│  │ ┌──────────────────────────┐   │  │                         │
│  │ │ Task Decision M...  2d   │   │  │                         │
│  │ │ Preview text...  4 msgs  │   │  │                         │
│  │ │                 [View →] │   │  │                         │
│  │ ├──────────────────────────┤   │  │                         │
│  │ │ Weather Chat      3d    │   │  │                         │
│  │ │ Hello Nina...    2 msgs  │   │  │                         │
│  │ │                 [View →] │   │  │                         │
│  │ └──────────────────────────┘   │  │                         │
│  └────────────────────────────────┘  │  [Message input...]     │
│                                      │                         │
│  ┌─ Timeline ─────────────────────┐  │                         │
│  │ ...                            │  │                         │
│  └────────────────────────────────┘  │                         │
└──────────────────────────────────────┴─────────────────────────┘
```

**Chat header:** `[Avatar] [Current Conversation Title] [Rename ✎] [+ New chat]`
- NO dropdown. NO tab bar.
- Title is read-only text (not clickable).
- "New chat" button creates new conversation.

### Desktop Conversation Preview (opened from widget)

```
┌──────────────────────────────────────┬─────────────────────────┐
│ [Home] [Calendar] [Task Decision ×]  │ Chat panel (unchanged)  │
├──────────────────────────────────────┤                         │
│                                      │                         │
│  Task Creation Decision Making       │                         │
│  4 messages  [Resume conversation]   │                         │
│  ─────────────────────────────────   │                         │
│  🧑 What should I do about...        │                         │
│  🤖 I'd suggest considering...       │                         │
│  🧑 That makes sense, but...         │                         │
│  🤖 Good point. Here's an...         │                         │
│                                      │                         │
└──────────────────────────────────────┴─────────────────────────┘
```

### Mobile Layout (390x844)

```
┌──────────────────────────┐
│ [≡] Dashboard    [⚙] [🔔]│
├──────────────────────────┤
│  Notebook Widget         │
│  ...                     │
│                          │
│  ┌─ Conversations ─ [🔍]│
│  │ Task Decision  2d     │
│  │ Preview...    [View →]│
│  │──────────────────────│
│  │ Weather Chat   3d     │
│  │ Hello...      [View →]│
│  └───────────────────────│
│                          │
│  Timeline                │
│  ...                     │
├──────────────────────────┤
│ 🟣 Nina · Start a conv..│  ← Peek bar
└──────────────────────────┘
```

Mobile "View →" opens a popover (same as task detail popover pattern):
```
┌──────────────────────────┐
│  Task Creation Decision  │
│  4 msgs [Resume conv] [×]│
│  ─────────────────────── │
│  🧑 What should I...     │
│  🤖 I'd suggest...       │
│  ...                     │
└──────────────────────────┘
```

---

## Task 1: Remove Conversation Tab Bar + Simplify Chat Header

Remove the conversation tab bar (desktop + mobile) and simplify the chat header.

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js`

### What to Remove (index.html)

1. **Desktop conversation tab bar** — Find `conv-tab-bar` class, remove the entire `<div>` block with `x-show="convTabs.length > 1"`
2. **Mobile conversation tab bar** — Same pattern in the mobile chat panel section
3. **Conversation dropdown menu** — Find `convDropdownOpen`, remove the dropdown `<div>` (keep the title display, remove the dropdown trigger and menu)
4. **Mobile conversation switcher** — Find `convSwitcherOpen`, remove the full-height switcher sheet

### What to Simplify (index.html)

Replace the chat header with:
```html
<!-- Chat header: title + New chat button -->
<header class="flex items-center gap-2 px-3 h-12 shrink-0 divider-bottom">
  <!-- Agent avatar -->
  <div class="w-7 h-7 rounded-full ..." x-text="headerInitial"></div>

  <!-- Title (read-only) + Rename + New chat -->
  <div class="flex-1 min-w-0 flex items-center gap-1.5">
    <div x-show="!editingTitle" class="flex items-center gap-1.5 min-w-0 flex-1">
      <span class="text-sm font-medium truncate" x-text="currentTitle || 'New conversation'"></span>
      <!-- Rename pencil (keep existing) -->
      <button @click="startTitleEdit()" ...>...</button>
    </div>
    <!-- Title edit input (keep existing) -->
    <input x-show="editingTitle" ... />
    <!-- New chat button -->
    <button @click="createNewConversation()" class="..." title="New conversation">
      <!-- Plus icon -->
      <span class="hidden sm:inline">New chat</span>
    </button>
  </div>
</header>
```

### What to Remove (app.js)

1. State variables: `convTabs: []`, `activeConvTabId: null`
2. Methods: `openConvTab()`, `switchToConvTab()`, `closeConvTab()`, `ensureCurrentConvTab()`, `syncConvTabs()`
3. In `conversation_loaded` handler: remove `ensureCurrentConvTab()` call
4. In `conversation_list` handler: remove `syncConvTabs()` call

### What to Keep

- `searchConversations()` method — used by widget search
- `formatRelativeTime()` method — used by widget
- `switchConversation()` method — used by resume flow
- `createNewConversation()` method — used by "New chat" button
- Title editing (editingTitle, startTitleEdit, etc.)

### Acceptance
- [ ] No tab bar visible on desktop or mobile
- [ ] No dropdown menu in chat header
- [ ] Chat header shows: avatar, title, rename button, "New chat" button
- [ ] No JS errors from removed state/methods
- [ ] `createNewConversation()` still works

### Commit
```bash
git add packages/dashboard/public/index.html packages/dashboard/public/js/app.js
git commit -m "feat(m6.7-s5): remove conversation tabs + simplify chat header"
git push origin <branch>
```

---

## Task 2: Conversations Widget on Home Tab

Add the widget between the Notebook widget and the Timeline section.

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js` — add `convWidgetSearchOpen` state

### Insertion Point

Find the end of the Notebook widget (`</div>` before `<!-- Timeline Section -->`). Insert the Conversations widget between them.

### Widget Structure

Follow the **glass-strong panel** pattern (same as Notebook widget):

```html
<!-- Conversations Widget -->
<div class="glass-strong rounded-xl overflow-hidden mb-4 mt-4">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
    <h2 class="text-sm font-semibold text-tokyo-text flex items-center gap-2">
      <!-- Chat bubble icon -->
      Conversations
    </h2>
    <!-- Search toggle button -->
  </div>

  <!-- Collapsible search input -->
  <div x-show="convWidgetSearchOpen" ...>
    <input x-ref="convWidgetSearchInput" x-model="convSearchQuery"
           @input.debounce.300ms="searchConversations()" ... />
  </div>

  <!-- Conversation list (max-h-[320px] overflow-y-auto) -->
  <div class="max-h-[320px] overflow-y-auto">
    <!-- Search results mode -->
    <!-- Search no results -->
    <!-- Search loading -->
    <!-- Normal list mode (when not searching) -->
  </div>
</div>
```

### Conversation Row Template

Each row in the normal list:

```html
<template x-for="conv in conversations.filter(c => c.id !== currentConversationId && c.turnCount > 0)"
          :key="conv.id">
  <button @click="openConversationPreview(conv)"
          class="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors flex items-start gap-3 group">
    <div class="flex-1 min-w-0">
      <!-- Row 1: title + time -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-tokyo-text/80 truncate" x-text="conv.title || 'New conversation'"></span>
        <span class="text-[10px] text-tokyo-muted shrink-0" x-text="conv.updated ? formatRelativeTime(conv.updated) : ''"></span>
      </div>
      <!-- Row 2: preview + count -->
      <div x-show="conv.preview || conv.turnCount" class="flex items-center gap-2 mt-0.5">
        <span class="text-[11px] text-tokyo-muted truncate flex-1" x-text="conv.preview || ''"></span>
        <span class="text-[10px] text-tokyo-muted/70 shrink-0" x-text="conv.turnCount + ' msgs'"></span>
      </div>
    </div>
    <!-- View arrow -->
    <span class="text-[10px] text-tokyo-blue opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1">View &rarr;</span>
  </button>
</template>
```

**Key filters:**
- `c.id !== currentConversationId` — current conversation is in the chat panel
- `c.turnCount > 0` — empty conversations are not shown

### Search Results Row

Same structure but uses `convSearchResults` and calls `openConversationPreview()` with a constructed conv object from the search result.

### State to Add (app.js)

```javascript
convWidgetSearchOpen: false,
```

### Acceptance
- [ ] Widget appears on Home tab between Notebook and Timeline
- [ ] Shows only inactive conversations with messages
- [ ] Current conversation NOT in the list
- [ ] Search toggle opens/closes input
- [ ] Search filters inline (same list area)
- [ ] Two-line rows: title + time, preview + count
- [ ] "View →" label on hover
- [ ] Glass-strong panel with Tokyo Night styling
- [ ] Clicking opens preview (Task 3), not direct resume

### Commit
```bash
git add packages/dashboard/public/index.html packages/dashboard/public/js/app.js
git commit -m "feat(m6.7-s5): add Conversations widget to Home tab"
git push origin <branch>
```

---

## Task 3: Conversation Preview (Read-Only)

Clicking a conversation in the widget opens a read-only preview. Desktop: left-panel tab. Mobile: popover.

**Files:**
- Modify: `packages/dashboard/public/index.html` — preview tab template + popover template
- Modify: `packages/dashboard/public/js/app.js` — `openConversationPreview()`, `_fetchConversationTabData()`, `resumeConversation()`

### Desktop: Left-Panel Tab

Add a conversation tab type to the existing tab content area:

```html
<!-- Conversation preview tab (read-only) -->
<template x-for="tab in openTabs.filter(t => t.type === 'conversation')" :key="tab.id">
  <div x-show="activeTab === tab.id" class="p-6 h-full overflow-y-auto">
    <div class="max-w-2xl mx-auto">
      <!-- Header: title + resume button -->
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-lg font-semibold" x-text="tab.data?.title || 'Conversation'"></h2>
          <span class="text-xs text-tokyo-muted" x-text="(tab.data?.turns?.length || 0) + ' messages'"></span>
        </div>
        <button @click="resumeConversation(tab.data?.conversationId); closeTab(tab.id)"
                class="px-3 py-1.5 text-xs bg-tokyo-blue/15 text-tokyo-blue rounded-lg hover:bg-tokyo-blue/25">
          Resume conversation
        </button>
      </div>
      <!-- Transcript -->
      <div x-show="tab.data?.loading" class="text-center py-8 text-tokyo-muted text-sm">Loading...</div>
      <template x-for="turn in (tab.data?.turns || [])" :key="turn.timestamp">
        <!-- Render as chat bubbles (user right, assistant left) -->
      </template>
    </div>
  </div>
</template>
```

### Mobile: Popover

Add a conversation popover type after the existing notification popover:

```html
<template x-if="$store.mobile.popover?.type === 'conversation'">
  <div x-data="{ get conv() { return $store.mobile.popover?.data } }">
    <!-- Header: title + resume + close -->
    <!-- Transcript (same bubble rendering) -->
  </div>
</template>
```

**Reactivity fix:** When updating popover data after fetch, reassign the entire object:
```javascript
// WRONG: $store.mobile.popover.data.turns = turns;
// RIGHT:
$store.mobile.popover = {
  type: 'conversation',
  data: { ...popoverData, turns, loading: false }
};
```

### Methods (app.js)

```javascript
openConversationPreview(conv) {
  if ($store.mobile.isMobile) {
    // Mobile: open popover
    const popoverData = { conversationId: conv.id, title: conv.title, turns: [], loading: true };
    $store.mobile.openPopoverWithFocus('conversation', popoverData, null);
    // Fetch and update
    this._fetchConversationTabData({ data: popoverData }).then(() => {
      // Reassign entire popover object for reactivity
      $store.mobile.popover = { type: 'conversation', data: { ...popoverData } };
    });
  } else {
    // Desktop: open left-panel tab
    const tabId = `conv-${conv.id}`;
    const tab = {
      id: tabId, type: 'conversation', title: conv.title,
      icon: '💬', closeable: true,
      data: { conversationId: conv.id, title: conv.title, turns: [], loading: true }
    };
    this.openTab(tab);
    this._fetchConversationTabData(tab);
  }
},

async _fetchConversationTabData(tab) {
  try {
    const res = await fetch(`/api/conversations/${tab.data.conversationId}`);
    const data = await res.json();
    tab.data.turns = data.turns || [];
    tab.data.loading = false;
  } catch (err) {
    console.error('[App] Failed to load conversation:', err);
    tab.data.loading = false;
  }
},

resumeConversation(conversationId) {
  this.switchConversation(conversationId);
  // On mobile, expand chat
  if (this.$store.mobile.isMobile) {
    this.$store.mobile.closePopover();
    this.$store.mobile.expandChat('half');
  }
},
```

### Tab Restore

In `restoreUIState()`, add re-fetch logic for conversation tabs:
```javascript
// After restoring tabs from localStorage
for (const tab of this.openTabs) {
  if (tab.type === 'conversation' && tab.data) {
    tab.data.loading = true;
    this._fetchConversationTabData(tab);
  }
}
```

### Acceptance
- [ ] Desktop: click widget row → left-panel tab opens with transcript
- [ ] Desktop: "Resume conversation" button → chat loads conversation, tab closes
- [ ] Mobile: click widget row → popover opens with transcript
- [ ] Mobile: "Resume conversation" → popover closes, chat expands to half, conversation loads
- [ ] Tab persists across page refresh (re-fetches transcript)
- [ ] Loading state shown while fetching

### Commit
```bash
git add packages/dashboard/public/index.html packages/dashboard/public/js/app.js
git commit -m "feat(m6.7-s5): add read-only conversation preview (tab + popover)"
git push origin <branch>
```

---

## Task 4: Empty Conversation Cleanup

Prevent empty conversations from accumulating.

**Files:**
- Modify: `packages/dashboard/src/ws/chat-handler.ts` — `deleteIfEmpty()` helper
- Modify: `packages/dashboard/src/index.ts` — startup cleanup

### Implementation

```typescript
// chat-handler.ts
async function deleteIfEmpty(conversationManager, conversationId: string): Promise<void> {
  if (!conversationId) return;
  const conv = conversationManager.get(conversationId);
  if (conv && conv.turnCount === 0) {
    await conversationManager.delete(conversationId);
  }
}
```

Call `deleteIfEmpty()` for the **previous** conversation in:
- `handleNewConversation()` — before creating the new one
- `handleSwitchConversation()` — before switching

### Startup Cleanup

In `index.ts`, after ConversationManager is created:
```typescript
const emptyConvs = conversationManager.getAll().filter(c => c.turnCount === 0);
for (const conv of emptyConvs) {
  conversationManager.delete(conv.id);
}
if (emptyConvs.length > 0) {
  logger.info(`Cleaned up ${emptyConvs.length} empty conversations`);
}
```

### Acceptance
- [ ] Creating "New chat" then creating another "New chat" → first empty one is deleted
- [ ] Server restart cleans up any existing empty conversations
- [ ] Widget never shows conversations with 0 messages

### Commit
```bash
git add packages/dashboard/src/ws/chat-handler.ts packages/dashboard/src/index.ts
git commit -m "feat(m6.7-s5): auto-delete empty conversations"
git push origin <branch>
```

---

## Task 5: Live Updates + Mobile Polish

Verify live updates work and polish mobile experience.

**Files:**
- Possibly modify: `packages/dashboard/public/js/ws-client.js` (if needed)
- Modify: `packages/dashboard/public/index.html` (mobile header adjustments)

### Live Update Verification

The widget should already update reactively via:
1. `state:conversations` WebSocket → `Alpine.store("conversations").items`
2. `Alpine.effect` → component `conversations` property
3. Widget template re-renders

Test:
- [ ] Click "New chat" → old conversation appears in widget instantly
- [ ] Send a message → conversation preview updates in widget
- [ ] Resume a conversation → it disappears from widget, previous active appears

If any of these fail, check the reactive chain and fix.

### Mobile Header

The mobile chat header (half/full states) should show:
- Current conversation title
- "New" button (replaces conversation switcher)

Ensure the old `convSwitcherOpen` / `toggleConvSwitcher()` references are removed from mobile templates.

### Acceptance
- [ ] Desktop: all live updates work
- [ ] Mobile: all live updates work
- [ ] Mobile header clean (no switcher remnants)
- [ ] No console errors

### Commit
```bash
git add packages/dashboard/public/
git commit -m "feat(m6.7-s5): verify live updates + mobile polish"
git push origin <branch>
```

---

## Task 6: Verification + Review

### Desktop (1280x800)
- [ ] No tab bar visible
- [ ] "New chat" button works
- [ ] Conversations widget on Home tab
- [ ] Current conversation NOT in widget
- [ ] Search filters list inline
- [ ] Click opens read-only preview tab
- [ ] "Resume" in preview → chat loads, tab closes
- [ ] Live updates when creating new conversation

### Mobile (390x844)
- [ ] No tab bar visible
- [ ] "New chat" accessible
- [ ] Conversations widget renders well
- [ ] Touch targets adequate (48px min)
- [ ] Click opens popover with transcript
- [ ] "Resume" works → popover closes, chat expands
- [ ] Search input usable on mobile

### Code Quality
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx prettier --check` — clean
- [ ] No console errors
- [ ] Server restart → page works, empty conversations cleaned up

### Sprint Docs
- [ ] Create `review.md` in this sprint folder
- [ ] Update E2E scenarios: `docs/sprints/m6.7-s4-e2e-scenarios.md`

---

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Tech Lead | Opus | Architecture, integration, review corrections |
| Frontend Dev | Sonnet | Widget HTML/CSS/JS, preview templates |
| Mobile UI Expert | Opus | Mobile popover, touch targets, scroll behavior |
| Reviewer | Opus | Plan adherence, code quality, wireframe match |

## Recovery Reference

- Transcript: `docs/recovery/m6.7-conversations/transcript-raw.md` (Parts 5, 5a, 7)
- Analysis: `docs/recovery/m6.7-conversations/analysis.md` (Sections 1, 4, 5)
- Before state: `docs/recovery/m6.7-conversations/file-reads-before-state.md` (full pre-S6 file state)
- UX decisions: Analysis Section 4 (View vs Resume labels, two-line rows, etc.)
- **Alpine reactivity fixes (proven):** `docs/recovery/whatsapp-stability/dashboard-reactivity-fixes.md` — desktop tab, mobile popover, and scroll fixes with exact code patterns
