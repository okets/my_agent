# Mobile Popover Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul 4 mobile popovers for native-feel UX, add midnight purple chat background to all message areas, replace all emojis with SVG icons across desktop and mobile.

**Architecture:** Pure frontend changes — HTML templates, CSS, and JS. No backend modifications. Chat background uses CSS custom properties + SVG pattern. Emoji replacement uses a JS icon registry mapping icon keys to SVG HTML strings, referenced from both tab definitions and HTML templates.

**Tech Stack:** Alpine.js, Tailwind CSS (CDN), vanilla CSS, inline SVG icons

**Spec:** `docs/superpowers/specs/2026-03-25-mobile-popover-overhaul-design.md`

---

### Task 1: Chat Background — CSS + SVG Pattern

**Files:**
- Modify: `packages/dashboard/public/css/app.css:41-42,417-424,1037-1052`

This is the foundation — the chat background and bubble colors affect all chat areas and the conversation preview popover (Task 4).

- [ ] **Step 1: Add chat background CSS**

Add after the existing bubble variables (~line 42) in `app.css`:

```css
/* ── Chat background (midnight purple + diagonal lines) ──── */
.chat-bg-pattern {
  background: linear-gradient(170deg, #1e1a2e 0%, #1a1630 50%, #211b35 100%);
  position: relative;
}

.chat-bg-pattern::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    45deg,
    transparent,
    transparent 15px,
    rgba(187, 154, 247, 0.07) 15px,
    rgba(187, 154, 247, 0.07) 16px
  );
  pointer-events: none;
  z-index: 0;
}

.chat-bg-pattern > * {
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 2: Update bubble color variables**

Replace the existing dark-mode bubble variables:

```css
--bubble-assistant: rgba(28, 24, 48, 0.8);
--bubble-user: rgba(120, 90, 180, 0.35);
```

- [ ] **Step 3: Update bubble hover states**

Replace the hover rules (~lines 1037-1052):

```css
.user-bubble:hover {
  background: rgba(120, 90, 180, 0.45);
}

.assistant-bubble:hover {
  background: rgba(28, 24, 48, 0.9);
}
```

- [ ] **Step 4: Add bubble border for assistant**

Add below `.assistant-bubble`:

```css
.assistant-bubble {
  background: var(--bubble-assistant);
  border: 1px solid rgba(187, 154, 247, 0.1);
}
```

- [ ] **Step 5: Apply chat-bg-pattern to message containers in HTML**

In `packages/dashboard/public/index.html`:

- Desktop messages container (~line 5258): Add `chat-bg-pattern` to the class list of the element with `x-ref="messagesContainer"`
- Mobile messages container (~line 8375): Add `chat-bg-pattern` to the class list of the element with `x-ref="mobileMessagesContainer"`

- [ ] **Step 6: Restart dashboard and verify**

```bash
systemctl --user restart nina-dashboard.service
```

Check at 1280x800 (desktop) and 390x844 (mobile) that:
- Chat area has purple gradient background with diagonal lines
- User bubbles are translucent purple
- Assistant bubbles are dark purple with subtle border
- Text is readable in both bubble types

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/public/css/app.css packages/dashboard/public/index.html
git commit -m "feat(dashboard): add midnight purple chat background with diagonal line pattern"
```

---

### Task 2: SVG Icon Registry + Emoji Purge

**Files:**
- Create: `packages/dashboard/public/js/icons.js`
- Modify: `packages/dashboard/public/index.html` (script tag + all emoji references)
- Modify: `packages/dashboard/public/js/app.js:71-73,269,1859,1873,1909,2020,3574,3635,3826,4073,4184,4836,4847,4965,4976,5105,5169`

- [ ] **Step 1: Create icon registry**

Create `packages/dashboard/public/js/icons.js` with a global `ICONS` object mapping icon keys to SVG HTML strings. Each SVG is 16x16, uses `currentColor` by default but some have explicit fills:

```javascript
/**
 * SVG icon registry — replaces all emoji usage in the dashboard.
 * Usage: ICONS.home, ICONS.fire, etc.
 * Each returns an HTML string for inline SVG.
 */
const ICONS = {
  home: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#7aa2f7" class="w-4 h-4"><path fill-rule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 10.414V17a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6.586a1 1 0 0 1 .293-.707l7-7Z" clip-rule="evenodd"/></svg>',
  fire: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#ff9e64" class="w-4 h-4"><path fill-rule="evenodd" d="M8.074.945A4.993 4.993 0 0 0 6 5v.032c.004.6.114 1.176.311 1.709.16.428-.204.91-.61.7a5.023 5.023 0 0 1-1.868-1.677c-.202-.304-.648-.363-.848-.058a6 6 0 1 0 8.017-1.901l-.004-.007a4.98 4.98 0 0 1-2.18-2.574c-.116-.31-.477-.472-.744-.28Zm.78 6.178a3.001 3.001 0 1 1-3.473 4.341c-.205-.365.215-.694.62-.59a4.008 4.008 0 0 0 1.828.047c.96-.2 1.747-.918 2.08-1.36a.55.55 0 0 0-.054-.678Z" clip-rule="evenodd"/></svg>',
  chat: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#7aa2f7" class="w-4 h-4"><path d="M3.505 2.365A41.369 41.369 0 0 1 9 2c1.863 0 3.697.124 5.495.365 1.247.167 2.18 1.108 2.435 2.268a4.45 4.45 0 0 0-.577-.069 43.141 43.141 0 0 0-4.706 0C9.229 4.696 7.5 6.727 7.5 8.998v2.24c0 1.413.67 2.735 1.76 3.562l-2.98 2.98A.75.75 0 0 1 5 17.25v-3.443c-.501-.048-1-.106-1.495-.172C2.033 13.438 1 12.162 1 10.72V5.28c0-1.441 1.033-2.717 2.505-2.914Z"/><path d="M14 6c.762 0 1.52.02 2.272.06 1.207.068 2.228.95 2.228 2.274v3.267c0 1.323-1.02 2.205-2.228 2.273-.56.032-1.124.053-1.69.063-.253.166-.547.28-.862.395l-2.285 2.285A.75.75 0 0 1 10 15.883V13.13c-.584-.075-1.162-.167-1.732-.273.115-.372.178-.767.178-1.178V8.998c0-1.514 1.083-2.85 2.613-2.94A42.8 42.8 0 0 1 14 6Z"/></svg>',
  folder: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#7aa2f7" class="w-4 h-4"><path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75ZM3.75 9A1.75 1.75 0 0 0 2 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-4.5A1.75 1.75 0 0 0 16.25 9H3.75Z"/></svg>',
  calendar: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#9ece6a" class="w-4 h-4"><path fill-rule="evenodd" d="M5.75 2a.75.75 0 0 1 .75.75V4h7V2.75a.75.75 0 0 1 1.5 0V4h.25A2.75 2.75 0 0 1 18 6.75v8.5A2.75 2.75 0 0 1 15.25 18H4.75A2.75 2.75 0 0 1 2 15.25v-8.5A2.75 2.75 0 0 1 4.75 4H5V2.75A.75.75 0 0 1 5.75 2Zm-1 5.5c-.69 0-1.25.56-1.25 1.25v6.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25v-6.5c0-.69-.56-1.25-1.25-1.25H4.75Z" clip-rule="evenodd"/></svg>',
  gear: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#a9b1d6" class="w-4 h-4"><path fill-rule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clip-rule="evenodd"/></svg>',
  notebook: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#7aa2f7" class="w-4 h-4"><path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06V3.94a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.34A.75.75 0 0 0 2 4.06v11.12a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z"/></svg>',
  document: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z" clip-rule="evenodd"/></svg>',
  sparkle: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#bb9af7" class="w-4 h-4"><path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"/></svg>',
  search: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#a9b1d6" class="w-4 h-4"><path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clip-rule="evenodd"/></svg>',
  edit: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#a9b1d6" class="w-4 h-4"><path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z"/><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z"/></svg>',
  knowledge: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#e07a5f" class="w-4 h-4"><path d="M10 1a6 6 0 0 0-3.815 10.631C7.237 12.5 8 13.443 8 14.456v.644a.75.75 0 0 0 .572.729 6.016 6.016 0 0 0 2.856 0A.75.75 0 0 0 12 15.1v-.644c0-1.013.762-1.957 1.815-2.825A6 6 0 0 0 10 1ZM8.863 17.414a.75.75 0 0 0-.226 1.483 9.066 9.066 0 0 0 2.726 0 .75.75 0 0 0-.226-1.483 7.553 7.553 0 0 1-2.274 0Z"/></svg>',
  listref: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#bb9af7" class="w-4 h-4"><path d="M7 3a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2H7ZM4 7a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1ZM2 11a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4Z"/></svg>',
  operations: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#7aa2f7" class="w-4 h-4"><path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Z" clip-rule="evenodd"/></svg>',
};
```

- [ ] **Step 2: Add script tag to index.html**

Add before the app.js script tag in `index.html` (search for `app.js` script tag):

```html
<script src="/js/icons.js"></script>
```

- [ ] **Step 3: Replace emoji icon properties in app.js**

Replace all emoji `icon:` properties in `openTab()` calls with `ICONS.xxx` references. Change the tab bar rendering from `x-text` (which renders text) to `x-html` (which renders HTML):

- Line 71: `icon: "🏠"` → `icon: ICONS.home`
- Line 1859: `icon: "📝"` → `icon: ICONS.edit`
- Line 1873: `icon: "💬"` → `icon: ICONS.chat`
- Line 1909: `icon: "💬"` → `icon: ICONS.chat`
- Line 2020: `icon: "🏠"` → `icon: ICONS.home`
- Line 3574: `icon: "📅"` → `icon: ICONS.calendar`
- Line 3635: `icon: "📅"` → `icon: ICONS.calendar`
- Line 3826: `icon: "📅"` → `icon: ICONS.calendar`
- Line 4073: `icon: "📅"` → `icon: ICONS.calendar`
- Line 4184: `icon: "⚙️"` → `icon: ICONS.gear`
- Line 4836: `icon: "\u{1F4C1}"` → `icon: ICONS.folder`
- Line 4847: `icon: "\u{1F4C1}"` → `icon: ICONS.folder`
- Line 4965: `icon: "\u{1F525}"` → `icon: ICONS.fire`
- Line 4976: `icon: "\u{1F525}"` → `icon: ICONS.fire`
- Line 5105: `icon: "📓"` → `icon: ICONS.notebook`
- Line 5169: `icon: "🔍"` → `icon: ICONS.search`

- [ ] **Step 4: Update tab bar rendering in index.html**

Change `x-text` to `x-html` for tab icon rendering:

- Line 254: `x-text="openTabs.find(t => t.id === 'home')?.icon || '🏠'"` → `x-html="openTabs.find(t => t.id === 'home')?.icon || ICONS.home"`
- Line 269: `x-text="tab.icon"` → `x-html="tab.icon"`

- [ ] **Step 5: Replace emojis in HTML templates**

- Timeline heading (line 1093): Replace `<span class="text-base">📅</span>` with the calendar SVG inline
- Calendar link (line 1101): Replace `📅 Calendar` with calendar SVG + text

- [ ] **Step 6: Restart and verify**

Check that all tab icons render as SVG icons, not emojis, on both desktop and mobile.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/public/js/icons.js packages/dashboard/public/js/app.js packages/dashboard/public/index.html
git commit -m "feat(dashboard): replace all emojis with Tokyo Night SVG icons"
```

---

### Task 3: Notebook Browser Popover Overhaul

**Files:**
- Modify: `packages/dashboard/public/index.html:7363-7830` (notebook-browser popover template)

Replace the entire notebook-browser popover template with colored category cards.

- [ ] **Step 1: Replace notebook-browser popover template**

Replace the template at lines 7363-7830 (`$store.mobile.popover?.type === 'notebook-browser'`) with the new design using colored category cards. Each category gets:
- 32x32 icon on tinted background (Operations=blue, Lists=purple, Daily=green, Knowledge=coral, Skills=orange)
- Category name + subtitle description
- Count pill in category color
- Tap to expand/collapse showing files inline
- Use `x-data="{ expanded: null }"` on the outer div, toggle with `@click="expanded = expanded === 'cat' ? null : 'cat'"`

The file items inside expanded categories use the same `@click` to open notebook-file popover as current code.

- [ ] **Step 2: Restart and verify**

Open the notebook popover on mobile (390x844). Verify:
- 5 colored category cards visible
- Tapping expands to show files
- Tapping a file opens the notebook-file popover
- Only one category expanded at a time

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(dashboard): redesign notebook browser popover with colored category cards"
```

---

### Task 4: Conversation Preview Popover Overhaul

**Files:**
- Modify: `packages/dashboard/public/index.html:8035-8115` (conversation popover template)

- [ ] **Step 1: Replace conversation preview popover template**

Replace the template at lines 8035-8115 (`$store.mobile.popover?.type === 'conversation'`) with:
- Header: back arrow (navigates to conversations-browser), title, metadata (message count + time)
- Full-width "Resume conversation" gradient button with play icon, immediately below header
- "Transcript preview" label
- Scrollable transcript area with `chat-bg-pattern` class on the messages container
- Chat bubbles use existing user-bubble/assistant-bubble classes (which now have the purple styling from Task 1)

- [ ] **Step 2: Restart and verify**

Open a conversation from the conversations browser on mobile. Verify:
- Resume button is visible immediately (not at bottom)
- Back arrow returns to conversations list
- Transcript has midnight purple background with diagonal lines
- Bubbles are purple-tinted

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(dashboard): redesign conversation preview with resume-in-header and chat background"
```

---

### Task 5: Conversations Browser Popover — Date Grouping

**Files:**
- Modify: `packages/dashboard/public/index.html` (conversations-browser popover template, ~lines 7929-7961)
- Modify: `packages/dashboard/public/js/app.js` (add date grouping helper)

- [ ] **Step 1: Add date grouping helper to app.js**

Add a method to the Alpine component (inside the component's method section):

```javascript
groupConversationsByDate(conversations) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const groups = { today: [], thisWeek: [], earlier: [] };
  for (const conv of conversations) {
    if (!conv.turnCount || conv.turnCount === 0) continue;
    const d = new Date(conv.updated);
    if (d >= today) groups.today.push(conv);
    else if (d >= weekAgo) groups.thisWeek.push(conv);
    else groups.earlier.push(conv);
  }
  return groups;
},
```

- [ ] **Step 2: Replace conversations-browser popover template**

Replace with date-grouped layout:
- Header: "Conversations" title + "+ New chat" button (tinted pill)
- Date group headers: "Today", "This week", "Earlier" — uppercase, small, muted, only shown if group has items
- Conversation rows: borderless, with title, relative time, message count, optional channel badge
- Tapping calls `openConversationPreview(conv)` after closing popover

- [ ] **Step 3: Restart and verify**

Open the conversations popover. Verify:
- Conversations are grouped under date headers
- Empty groups are hidden
- Tapping opens conversation preview
- "+ New chat" works

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/public/index.html packages/dashboard/public/js/app.js
git commit -m "feat(dashboard): add date-grouped conversations browser popover"
```

---

### Task 6: Automations Browser Popover — Expandable Items

**Files:**
- Modify: `packages/dashboard/public/index.html` (automations-browser popover template, ~lines 7996-8033)

- [ ] **Step 1: Replace automations-browser popover template**

Replace with expandable card design using `x-data="{ expanded: null }"`:
- Collapsed: 32x32 status icon on green-tinted bg, name, trigger badges, job count, chevron
- Expanded: detail panel with:
  - Two stat boxes (last run time, status + duration) — pull from `automation.lastJob` if available from store
  - Truncated last job result (2 lines, CSS line-clamp)
  - "Fire Now" gradient button (calls existing `fireAutomation(automation.id)` if it exists, or closes popover and opens chat with context)
  - "N jobs" ghost button

- [ ] **Step 2: Restart and verify**

Open automations popover. Verify:
- Items are tappable and expand/collapse
- Only one expanded at a time
- Detail panel shows last run info
- Fire Now button works

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(dashboard): add expandable automation cards with Fire Now action"
```

---

### Task 7: Final Verification + Cleanup

- [ ] **Step 1: Full mobile walkthrough at 390x844**

Test each popover: Spaces, Automations (expand an item), Notebook (expand a category, open a file), Conversations (check date groups, open a conversation preview, resume)

- [ ] **Step 2: Full desktop walkthrough at 1280x800**

Verify: chat background visible, SVG tab icons render correctly, 2x2 widget grid still works, no broken emojis anywhere

- [ ] **Step 3: Check for remaining emojis**

```bash
grep -rn '[🏠🔥💬📁📅📓📝📋📄⚙️✨🔍]' packages/dashboard/public/ --include='*.html' --include='*.js'
```

If any found, replace with appropriate ICONS.xxx reference.

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A packages/dashboard/public/
git commit -m "fix(dashboard): final emoji cleanup and verification"
```
