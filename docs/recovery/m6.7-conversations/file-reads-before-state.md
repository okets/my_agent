# File Reads — Before State (Pre-S6 Changes)

Recovered from OCR of tool call screenshots (2026-03-09).
These show the state of files BEFORE the S6 Conversation Home Widget changes were applied.
Line numbers reference the pre-S6 state (on the `sprint/m6.7-s4-s5` branch).

---

## index.html — Key Sections

### Home Tab Header (lines 315-374)
- Dashboard header with status icons (channels, memory)
- Shows when `activeTab === 'home' || $store.mobile.isMobile`

### Notebook Widget (lines 376-598)
- Glass-strong panel, 4-tab widget (Operations, Lists & Reference, Daily, Knowledge)
- Ends at line 598

### Insertion Point (lines 598-601)
- Line 598: End of Notebook widget (`</div>`)
- Line 601: Start of Timeline section (`<!-- Timeline Section -->`)
- **Conversations widget was inserted between these two lines**

### Timeline Widget (lines 601-841)
- Timeline section with legend
- Ends at line 841 (closing `</div>` of Home tab content)
- Settings tab starts at line 843

### Chat Header — Desktop (lines 3503-3578)
**After S4 changes (already had "New chat" button):**
- Agent avatar (lines 3507-3514)
- Conversation title + New chat button (lines 3516-3578)
- Title display with rename pencil button
- Title edit mode (input with Enter/Escape/Blur handlers)
- "New chat" button with `@click="createNewConversation()"`

### Orphaned Dropdown (lines 3580-3801) — REMOVED IN S6
- Dropdown menu with transition animations
- "New conversation" button (lines 3597-3613)
- Search input with 300ms debounce (lines 3616-3625)
- Search results (lines 3627-3665)
- Channel conversations section (lines 3670-3718)
- Web conversations list with:
  - Channel icon for non-web (lines 3739-3745)
  - Status dot green/transparent (lines 3746-3749)
  - Title + timestamp row (lines 3752-3763)
  - Preview + count row (lines 3764-3774)
  - Delete button on hover (lines 3777-3801)

### Notification Bell + Connection Status (lines 3804-3834)
- Kept in S6 (not removed)

### Desktop Conversation Tab Bar (lines 4025-4067) — REMOVED IN S6
- Shows when `convTabs.length > 1`
- Status dot, title, close button per tab
- Active tab: `bg-tokyo-blue/15 text-tokyo-blue`

### Calendar Tab (lines 3412-3482)
- Calendar with sidebar toggles, FullCalendar container

### Mobile Chat Panel (lines 6462-6889)
- Always in DOM, height via CSS custom property `--chat-ratio`
- Three states: peek (8%), half (50%), full (92%)

### Mobile Conversation Switcher (lines 6566-6802) — REMOVED IN S6
- Header with conv title + dropdown toggle (lines 6566-6593)
- Backdrop (lines 6596-6603)
- Dropdown with:
  - "New conversation" button (lines 6615-6635)
  - Search input (lines 6637-6650)
  - Search results (lines 6652-6693)
  - Channel conversations (lines 6698-6740)
  - Web conversations list (lines 6742-6802)

### Mobile Conversation Tab Bar (lines 6804-6844) — REMOVED IN S6
- Same as desktop but smaller (`text-[11px]`)

### Mobile Messages + Compose (lines 6846-6889)
- Message bubbles with markdown rendering
- Typing indicator
- Compose bar with textarea

---

## app.js — Key Sections

### State Variables (lines 1-100)
- `conversations: []` (line 29)
- `channelConversations: []` (line 30)
- `currentConversationId: null` (line 31)
- `convTabs: []` (line 34) — **REMOVED IN S6**
- `activeConvTabId: null` (line 35) — **REMOVED IN S6**
- `convSearchQuery: ''` (line 37)
- `convSearchResults: []` (line 38)
- `convSearchLoading: false` (line 39)
- `openTabs: [{ id: "home", ... }]` (lines 62-64)
- `activeTab: "home"` (line 65)
- `chatContext: null` (line 68)

### currentTitle Getter (lines 317-323)
```javascript
get currentTitle() {
  if (!this.currentConversationId) return null;
  const conv = this.conversations.find(c => c.id === this.currentConversationId);
  return conv?.title || null;
}
```

### Alpine.effect — Store Sync (lines 382-387)
```javascript
Alpine.effect(() => {
  const store = Alpine.store("conversations");
  if (store && store.items) {
    self.conversations = store.items;
  }
});
```

### Conversation Tab Methods (lines 555-698) — REMOVED/REPLACED IN S6
- `openConvTab(conversationId)` (564-598) — max 8 tabs, LRU eviction
- `switchToConvTab(conversationId)` (603-608)
- `closeConvTab(conversationId)` (613-622)
- `ensureCurrentConvTab(conversationId, title, status)` (628-645)
- `syncConvTabs()` (650-658)
- `searchConversations()` (660-684) — **KEPT in S6**
- `formatRelativeTime(isoString)` (686-698) — **KEPT in S6**

### S6 Replacement: `resumeConversation(convId)` method added in place of tab methods

### Message Handlers (lines 1000-1134)
- `conversation_loaded` (1006-1050): had `ensureCurrentConvTab()` call at line 1015 — **REMOVED IN S6**
- `conversation_list` (1052-1065): had `syncConvTabs()` call at line 1060 — **REMOVED IN S6**
- `conversation_created` (1067-1095): kept
- `conversation_updated` (1097-1134): kept

### Tab System Methods (lines 1670-1769) — KEPT
- `switchTab(id)` (1673-1720)
- `clearChatContext()` (1722-1724)
- `openTab(tab)` (1726-1736)
- `closeTab(id)` (1738-1756)
- `openNotebookTab(name)` (1758-1769)

---

## Post-S6 State — Conversations Widget (confirmed reads)

### Widget HTML (lines 601-769+)
- Glass-strong panel with header ("Conversations" + search icon)
- Collapsible search input with debounce
- Search results mode with "Resume →" buttons
- Normal list mode with conversation rows:
  - Status dot (green/transparent)
  - Title + relative time
  - Preview + message count
  - "Resume →" on hover

### Note: Later Corrections Changed
- `resumeConversation()` → `openConversationPreview()` (read-only preview first)
- Status dot removed (current conversation filtered out of list entirely)
- "Resume →" → "View →"
- Filter: `c.turnCount > 0` added (hide empty conversations)
