# Mobile Popover Overhaul + Chat Background + Emoji Purge

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Dashboard mobile popovers, chat message areas (mobile + desktop), emoji replacement

---

## Summary

Overhaul 4 mobile popovers (conversations browser, notebook browser, automations browser, conversation preview) for polished native-feel UX. Add distinctive chat background to all message areas. Replace all emojis with Tokyo Night SVG icons across the entire dashboard.

## 1. Conversations Browser Popover

**Current:** Flat list of glass-strong cards, no grouping, no channel indicators.

**New design:**
- Date-grouped sections: "Today", "This week", "Earlier" headers
- Each conversation row: title, relative time, message count, optional channel badge (whatsapp/email)
- Tapping opens conversation preview popover
- "+ New chat" button in header (opens chat in full mode)
- No glass-strong cards per item — use borderless rows with subtle hover/active states for density

**Grouping logic (JS):**
- "Today": `updated` is same calendar day
- "This week": `updated` within last 7 days, not today
- "Earlier": everything else

## 2. Notebook Browser Popover

**Current:** Collapsible accordion with grey document icons, plain section headers.

**New design:**
- Category cards with colored icons matching the home widget colors:
  - Operations: blue (#7aa2f7)
  - Lists & Reference: purple (#bb9af7)
  - Daily: green (#9ece6a)
  - Knowledge: coral (#e07a5f)
  - Skills: orange (#ff9e64)
- Each card shows: colored icon (32x32 on tinted bg), category name, subtitle description, count pill
- Tapping expands inline to show files (same as current, but within the card)
- Collapsed cards show chevron `›`, expanded show `▼`
- File items within expanded card get subtle category-tinted hover background

## 3. Automations Browser Popover

**Current:** Non-interactive div cards showing name + trigger badges + job count.

**New design:**
- Tappable cards that expand/collapse inline
- Collapsed: status dot icon (32x32 on green-tinted bg), name, trigger badges, job count, chevron
- Expanded (one at a time): reveals detail panel below the header:
  - Two stat boxes: "Last run" (time) and "Status" (completed/failed + duration)
  - Truncated last job result text (2 lines)
  - Two action buttons: "Fire Now" (gradient CTA) and "N jobs →" (ghost button)
- Tapping another item collapses the current one
- Uses Alpine `x-data="{ expanded: null }"` pattern with `expanded === automation.id`

## 4. Conversation Preview Popover

**Current:** Chat bubbles with Resume button + close button in top-right corner.

**New design:**
- Header area:
  - Back arrow (← returns to conversations-browser popover)
  - Title + metadata (message count, relative time)
  - Full-width "Resume conversation" button with play icon, immediately visible
- Transcript area below scrolls independently
- "Transcript preview" label above messages
- Chat bubbles get the midnight purple background (see section 5)
- Bubble styling: user = translucent purple, assistant = darker purple-tinted surface

## 5. Chat Background (All Screens)

**Applied to:** Mobile chat panel messages area, desktop chat messages area, conversation preview popover transcript.

**Design:**
- Base: gradient `linear-gradient(170deg, #1e1a2e 0%, #1a1630 50%, #211b35 100%)`
- Pattern: diagonal lines via SVG pattern, purple stroke (#bb9af7), 7% opacity, 45° rotation, 16px spacing
- Bubble adjustments:
  - User bubble: `rgba(120, 90, 180, 0.35)` with text `#e0daf0`
  - Assistant bubble: `rgba(28, 24, 48, 0.8)` with border `rgba(187, 154, 247, 0.1)` and text `#c8c0e0`

**CSS implementation:** New `.chat-bg-pattern` class applied to message container elements.

## 6. Emoji Purge (Mobile + Desktop)

Replace ALL emoji usage with inline SVG icons in Tokyo Night colors. Complete mapping:

| Context | Emoji | Replacement |
|---------|-------|-------------|
| Home tab (desktop) | 🏠 | SVG home icon, #7aa2f7 |
| Automations tab/badge | 🔥 | SVG fire icon, #ff9e64 |
| Conversations tab | 💬 | SVG chat bubble icon, #7aa2f7 |
| Spaces tab | 📁 | SVG folder icon, #7aa2f7 |
| Settings tab | ⚙️ | SVG gear icon (already SVG in mobile) |
| Timeline heading | 📅 | SVG calendar icon, #9ece6a |
| Calendar link | 📅 | SVG calendar icon, #9ece6a |
| Notebook heading | 📓 | SVG book icon, #7aa2f7 |
| File icons in notebook | 📄 📋 | SVG document icon, category color |
| Skills | ✨ | SVG sparkle icon, #bb9af7 |

**Scope:** Search all HTML for emoji characters, replace with `<svg>` elements. This includes:
- Tab bar icons (openTabs entries)
- Timeline section heading
- Calendar links
- Notebook browser heading
- Any hardcoded emoji in templates

**JS tab icons:** Tab definitions in app.js use emoji strings for `icon` property. These render in the tab bar. Replace with SVG HTML strings or a class-based icon system.

## Implementation Notes

- All changes are in `packages/dashboard/public/` (HTML, CSS, JS)
- No backend changes needed
- Chat background CSS goes in `app.css` (shared by mobile + desktop)
- Mobile popover templates are in `index.html` inside the popover-sheet section (~lines 7900-8100)
- Desktop tab icons are defined in `app.js` in `openTab()` calls and the initial `openTabs` array
- Test at 390x844 (mobile) and 1280x800 (desktop) after changes
