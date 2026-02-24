# Mobile Layout Specification

> **Status:** Design Complete
> **Target:** my_agent Dashboard (packages/dashboard)
> **Approach:** Layered sheet model -- bottom-sheet chat + swipe-dismissable popovers
> **Breakpoint:** < 768px (Tailwind `md:`)
> **References:** Apple Maps bottom sheet, Uber ride panel, Google Tasks, Slack mobile

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Screen Layouts](#2-screen-layouts)
3. [Navigation Model](#3-navigation-model)
4. [Gesture System](#4-gesture-system)
5. [Chat Bottom Sheet](#5-chat-bottom-sheet)
6. [Popover System](#6-popover-system)
7. [Responsive Breakpoints](#7-responsive-breakpoints)
8. [Component Adaptations](#8-component-adaptations)
9. [Edge Cases & Concerns](#9-edge-cases--concerns)
10. [Design Patterns & References](#10-design-patterns--references)
11. [Implementation Notes](#11-implementation-notes)

---

## 1. Design Principles

1. **Home is gravity.** Every navigation path returns to the home screen. Dismissing anything brings you back to home + chat peek.
2. **Chat is ambient.** The chat peek is always visible at the bottom edge. The user never loses awareness of the agent.
3. **One popover at a time.** Opening a new popover replaces the current one. No stacking, no back-stack complexity.
4. **Gestures over buttons.** Swipe down to dismiss. Swipe up to expand. No tiny X close buttons on any sheet or popover.
5. **Touch-first sizing.** Minimum tap target 44x44px. Generous spacing. Text no smaller than 12px for body content.
6. **Same design language.** Tokyo Night theme, glassmorphism, Catppuccin colors -- unchanged from desktop. Only layout shifts.

---

## 2. Screen Layouts

### 2.1 Home Screen with Chat Peek (Default State)

This is the resting state. The user sees the home content (timeline, channels, quick access) with the chat peek bar fixed at the bottom.

```
┌──────────────────────────────┐
│ ● Dashboard         [🔔][⚙] │  <- Status bar + header (44px)
├──────────────────────────────┤
│                              │
│  Quick access:               │
│  [External Rules] [Reminders]│  <- Horizontal scroll pills
│  [Standing Orders]           │
│                              │
│  Channels: [WA ● connected]  │  <- Inline channel status
│                              │
│ ─────────────────────────────│
│  📅 TIMELINE       [+] [📅] │
│  ── Now 2:30 PM ──────────── │
│  │                           │
│  3:00  ● Send reminder [Task]│
│  3:30  ○ Team standup [Event]│
│  5:00  ◐ Review PR   [Task] │
│  │                           │
│  ── Tomorrow, Feb 24 ─────── │
│  9:00  ● Weekly report [Task]│
│  14:00 ○ Dentist      [Event]│
│                              │
│         [Load later ↓]       │
│                              │
├──────────────────────────────┤
│ 💬 "I've scheduled the..."  │  <- Chat peek (64px)
│ [Message...            ] [↑] │  <- Compose input + send
└──────────────────────────────┘
```

**Dimensions:**
- Header: 44px fixed
- Home content: fills remaining space, scrollable
- Chat peek: 64px fixed at bottom (above safe area inset)

### 2.2 Home Screen with Popover Open

When the user taps a timeline item, settings gear, or calendar link, a popover slides up covering ~85% of the screen. Home content is dimmed underneath. Chat peek remains visible at the very bottom.

```
┌──────────────────────────────┐
│ ● Dashboard         [🔔][⚙] │  <- Dimmed (visible but inactive)
├──────────────────────────────┤
│░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  <- Dimmed home content (~15%)
│░░░░░ (home content dimmed) ░░│
├─────────────────────────── ──┤
│  ┌────────────────────────┐  │
│  │  ═══ (drag handle) ═══ │  │  <- 4px rounded pill, 40px wide
│  │                        │  │
│  │  TASK DETAIL           │  │  <- Popover content
│  │  ● Research Bangkok    │  │     (~85% of screen)
│  │  Status: Running       │  │
│  │  Created: Feb 23       │  │
│  │                        │  │
│  │  Work Items:           │  │
│  │  ✓ Find flights        │  │
│  │  ○ Compare hotels      │  │
│  │                        │  │
│  │  Instructions:         │  │
│  │  Look into travel...   │  │
│  │                        │  │
│  └────────────────────────┘  │
├──────────────────────────────┤
│ 💬 "I've scheduled the..."  │  <- Chat peek (still visible)
│ [Message...            ] [↑] │
└──────────────────────────────┘
```

### 2.3 Chat Half-Expanded State

User swipes up on the chat peek. The chat expands to ~50% of the screen height, showing recent messages. Home content is still partially visible above.

```
┌──────────────────────────────┐
│ ● Dashboard         [🔔][⚙] │
├──────────────────────────────┤
│                              │
│  📅 TIMELINE       [+] [📅] │  <- Home content visible (~50%)
│  ── Now 2:30 PM ──────────── │
│  3:00  ● Send reminder       │
│  3:30  ○ Team standup        │
│                              │
├══════════════════════════════┤  <- Drag handle (swipe zone)
│  ═══ (drag handle) ═══      │
│                              │
│  🤖 I've completed the      │  <- Recent messages
│  research task. Here are     │
│  the results...              │
│                      2:28 PM │
│                              │
│  👤 Thanks! Can you also     │
│  check hotel prices?         │
│                      2:29 PM │
│                              │
│  🤖 Sure, I'll look into    │
│  hotels now.                 │
│                      2:30 PM │
│                              │
├──────────────────────────────┤
│ [Message...            ] [↑] │  <- Compose bar
│ [Sonnet 4.5] [Reasoning] 📎 │  <- Action bar
└──────────────────────────────┘
```

### 2.4 Chat Full-Expanded State

User continues swiping up, or taps the chat area when half-expanded. Chat goes full screen. A back/collapse button appears in the header.

```
┌──────────────────────────────┐
│ [↓] Chat with Nina  [🔔][⚙]│  <- Header with collapse arrow
├──────────────────────────────┤
│  ▾ Conversation name ▾      │  <- Conversation switcher
├──────────────────────────────┤
│                              │
│  🤖 Hey! How can I help     │
│  you today?                  │
│                              │
│  👤 Research Bangkok travel  │
│  options for next month      │
│                      2:15 PM │
│                              │
│  🤖 I'll create a task for  │
│  that. Let me research       │
│  flights and hotels...       │
│                      2:16 PM │
│                              │
│  🤖 [Thinking...]           │
│  ● ● ●                      │
│                              │
│                              │
│                              │
│                              │
├──────────────────────────────┤
│ [Attachment previews]        │  <- If attachments present
│ [Message...            ] [↑] │  <- Compose bar
│ [Sonnet 4.5] [Reasoning] 📎 │  <- Action bar (full)
└──────────────────────────────┘
```

### 2.5 Task Detail Popover

```
┌──────────────────────────────┐
│░░░░░ (dimmed header) ░░░░░░░│
├──────────────────────────────┤
│  ═══ (drag handle) ═══      │
│                              │
│  ● Research Bangkok Travel   │  <- Title
│  ┌──────┐ ┌────────┐        │
│  │Running│ │ Project│        │  <- Status + type badges
│  └──────┘ └────────┘        │
│                              │
│  ┌────────────────────────┐  │
│  │ 📅 Created   Feb 23   │  │  <- Metadata card
│  │ 👤 Created by  Agent  │  │
│  │ ▶ Started     2:15 PM │  │
│  └────────────────────────┘  │
│                              │
│  WORK ITEMS                  │
│  ┌────────────────────────┐  │
│  │ ✓ Find flights         │  │
│  │ ○ Compare hotels       │  │
│  │ ○ Check visa needs     │  │
│  └────────────────────────┘  │
│                              │
│  INSTRUCTIONS                │
│  ┌────────────────────────┐  │
│  │ Look into travel       │  │
│  │ options for Bangkok... │  │
│  └────────────────────────┘  │
│                              │
│  [Complete]     [Delete]     │  <- Action buttons at bottom
│                              │
├──────────────────────────────┤
│ 💬 peek                     │  <- Chat peek
└──────────────────────────────┘
```

### 2.6 Event Detail Popover

```
┌──────────────────────────────┐
│░░░░░ (dimmed header) ░░░░░░░│
├──────────────────────────────┤
│  ═══ (drag handle) ═══      │
│                              │
│  ● Team Standup Meeting      │  <- Title
│  Personal Calendar           │  <- Calendar source
│                              │
│  ┌────────────────────────┐  │
│  │ 📅 Feb 23, 3:30 PM    │  │  <- Date/time
│  │    to 4:00 PM          │  │
│  └────────────────────────┘  │
│                              │
│  INSTRUCTIONS                │
│  ┌────────────────────────┐  │
│  │ Weekly standup with    │  │
│  │ the engineering team.  │  │
│  │ Cover sprint progress. │  │
│  └────────────────────────┘  │
│                              │
│  ┌─────────┐┌──────┐┌─────┐ │
│  │ Ask Nina ││ Edit ││ Del │ │  <- Actions
│  └─────────┘└──────┘└─────┘ │
│                              │
├──────────────────────────────┤
│ 💬 peek                     │  <- Chat peek
└──────────────────────────────┘
```

### 2.7 Calendar Popover

```
┌──────────────────────────────┐
│░░░░░ (dimmed header) ░░░░░░░│
├──────────────────────────────┤
│  ═══ (drag handle) ═══      │
│                              │
│  CALENDAR          [+ New]   │
│                              │
│  ┌────────────────────────┐  │
│  │  ☐ Personal    ●      │  │  <- Calendar toggles
│  │  ☐ Work        ●      │  │     (horizontal row on mobile)
│  └────────────────────────┘  │
│                              │
│  ┌────────────────────────┐  │
│  │    February 2026       │  │  <- FullCalendar
│  │  < ──────────────── >  │  │     (listWeek or 3-day view)
│  │                        │  │
│  │  Mon 23                │  │
│  │  ● 2:00 Send reminder  │  │
│  │  ○ 3:30 Team standup   │  │
│  │                        │  │
│  │  Tue 24                │  │
│  │  ● 9:00 Weekly report  │  │
│  │  ○ 14:00 Dentist       │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
├──────────────────────────────┤
│ 💬 peek                     │  <- Chat peek
└──────────────────────────────┘
```

### 2.8 Settings Popover

```
┌──────────────────────────────┐
│░░░░░ (dimmed header) ░░░░░░░│
├──────────────────────────────┤
│  ═══ (drag handle) ═══      │
│                              │
│  SETTINGS                    │
│                              │
│  Appearance                  │
│  ┌────────────────────────┐  │
│  │ Theme    [Mocha Dark ▾]│  │
│  └────────────────────────┘  │
│                              │
│  Channels                    │
│  ┌────────────────────────┐  │
│  │ 📱 whatsapp_main       │  │
│  │ dedicated ● connected  │  │
│  │ [Disconnect]           │  │
│  ├────────────────────────┤  │
│  │ [+ Add Channel]        │  │
│  └────────────────────────┘  │
│                              │
│  More settings coming soon   │
│                              │
├──────────────────────────────┤
│ 💬 peek                     │  <- Chat peek
└──────────────────────────────┘
```

---

## 3. Navigation Model

### 3.1 Primary Navigation

There is **no bottom tab bar** and **no hamburger menu**. The home screen IS the navigation hub.

| To reach... | Action |
|-------------|--------|
| Home | Dismiss any popover (swipe down) or collapse chat |
| Chat | Tap the peek bar, or swipe up on it |
| Calendar | Tap "Calendar" link in timeline header |
| Settings | Tap gear icon in header |
| Task detail | Tap any task in the timeline |
| Event detail | Tap any event in the timeline |
| Notifications | Tap bell icon in header |
| Notebook (External Rules, etc.) | Tap quick access pill on home screen |

**Rationale:** This app is primarily an AI chat assistant with a supporting dashboard. A bottom tab bar would compete with the chat peek bar for the most valuable screen real estate. Instead, the home screen acts as a spatial hub -- everything is one tap away.

### 3.2 Quick Access Buttons on Mobile

The "External Rules," "Reminders," and "Standing Orders" buttons become horizontally scrollable pills. Tapping one opens a **notebook popover** (same sheet model as task detail).

```
 ← [External Rules] [Reminders] [Standing Orders] →
    (horizontally scrollable, overflow hidden)
```

Each pill: `min-width: auto`, `padding: 8px 16px`, `border-radius: 9999px`, `white-space: nowrap`.

### 3.3 Conversation Switcher on Mobile

In **chat full-expanded state**, the conversation title becomes a tappable bar that opens a dropdown. On mobile, this dropdown becomes a **full-width sheet** sliding down from the header rather than a small positioned dropdown.

```
┌──────────────────────────────┐
│ [↓] Chat with Nina          │
├──────────────────────────────┤
│  ▾ Current conversation ▾   │  <- Tap to expand
├──────────────────────────────┤  ── sheet slides down ──
│  [+ New conversation]        │
│ ──────────────────────────── │
│  Active Channels             │
│  📱 ● WhatsApp chat  r/o    │
│ ──────────────────────────── │
│  Conversations               │
│  💬 Bangkok research   2m    │  <- Active (highlighted)
│  💬 Weekly planning   1h    │
│  💬 Project setup     2d    │
│ ──────────────────────────── │
│            (tap to select)   │
└──────────────────────────────┘
```

This conversation sheet covers the message area but not the compose bar. Tapping a conversation or tapping outside dismisses it.

### 3.4 Tab Concept Translation

Desktop uses a tab bar at the top of the workspace. On mobile, **tabs do not exist**. Instead:

| Desktop tab | Mobile equivalent |
|------------|-------------------|
| Home tab | Base layer (always visible when no popover) |
| Settings tab | Settings popover |
| Calendar tab | Calendar popover |
| Task detail tab | Task detail popover |
| Event detail tab | Event detail popover |
| Notebook tab | Notebook popover |
| Conversation tab | Not needed (chat is full-screen) |

When a popover is open and the user opens a different content type (e.g., taps a linked conversation from a task detail), the current popover is **replaced** with the new one. No stack. The user can always swipe down to return to home.

### 3.5 Header Bar

The mobile header is simplified from the desktop tab bar:

```
┌──────────────────────────────────────────┐
│  ● agent_name              [🔔 2] [⚙]  │
│     Dashboard                            │
└──────────────────────────────────────────┘
```

- Left: Green status dot + agent name (truncated if long)
- Right: Notification bell (with badge count) + settings gear
- Height: 44px
- Both icons are 44x44px tap targets (visual size 20x20px with padding)

When chat is **full-expanded**, the header changes:

```
┌──────────────────────────────────────────┐
│  [↓] Chat with agent_name   [🔔 2] [⚙] │
└──────────────────────────────────────────┘
```

- Left: Collapse arrow (↓) replaces the status dot
- Title changes to "Chat with {agent_name}"
- Tapping the collapse arrow OR swiping down on messages collapses chat to peek

---

## 4. Gesture System

### 4.1 Complete Gesture Map

| Context | Swipe Up | Swipe Down | Swipe Left | Swipe Right | Tap |
|---------|----------|------------|------------|-------------|-----|
| **Home screen** | -- (scroll) | -- (scroll) | -- | -- | Tap item = open popover |
| **Chat peek bar** | Expand to half | -- | -- | -- | Expand to half |
| **Chat half-expanded** | Expand to full | Collapse to peek | -- | -- | -- (scroll messages) |
| **Chat full-expanded** | -- (scroll) | Collapse to half | -- | -- | -- |
| **Popover open** | -- (scroll content) | Dismiss popover | -- | -- | -- |
| **Popover, scrolled to top** | -- | Dismiss popover | -- | -- | -- |
| **Dimmed backdrop** | -- | -- | -- | -- | Dismiss popover |

### 4.2 Preventing Gesture Conflicts

The primary conflict is **scrolling content inside a sheet vs. dismissing the sheet**. Resolution:

**Rule: Swipe-to-dismiss only activates when content is scrolled to the very top.**

Implementation:
```
if (sheet.scrollTop === 0 && swipeDirection === 'down' && swipeDelta > 20px) {
  // Begin dismiss gesture
} else {
  // Normal scroll behavior
}
```

This is the same pattern used by Apple Maps, Uber, and iOS share sheets.

### 4.3 Swipe Zones

```
┌──────────────────────────────┐
│         HEADER (44px)        │  <- Not swipeable (tap targets only)
├──────────────────────────────┤
│                              │
│      CONTENT AREA            │  <- Vertical scroll only
│      (scrollable)            │     Swipe-down-to-dismiss when
│                              │     scrollTop === 0
│                              │
├──────────────────────────────┤
│  ═══ DRAG HANDLE (32px) ═══ │  <- Always triggers drag gesture
│      (on popovers/sheets)    │     regardless of scroll position
├──────────────────────────────┤
│      CHAT PEEK (64px)        │  <- Swipe up to expand chat
│      (compose bar)           │     Tap to expand chat
└──────────────────────────────┘
```

The **drag handle** at the top of popovers and the chat sheet is a dedicated swipe zone. It always initiates a drag gesture, never scrolls content. This is the fail-safe for when the scroll-top detection is ambiguous.

### 4.4 Haptic & Visual Feedback

| Gesture stage | Feedback |
|--------------|----------|
| Drag begins (> 10px movement) | Light haptic tick. Sheet begins following finger. |
| Drag past dismiss threshold (> 33% of sheet height) | Medium haptic tick. Sheet background dims. |
| Release past threshold | Sheet animates out. Home content un-dims. |
| Release before threshold | Sheet snaps back to original position (spring animation). |

**Visual feedback during drag:**
- The popover/sheet follows the finger with a 1:1 ratio
- Opacity of the dimmed backdrop decreases proportionally as the sheet is dragged down
- The drag handle pill changes from `bg-tokyo-muted/40` to `bg-tokyo-blue/60` when actively dragging
- A subtle scale-down (0.98) is applied to the sheet during drag to create a "lifting" sensation

### 4.5 Velocity-Based Dismiss

If the user flicks down quickly (velocity > 500px/s), dismiss the sheet regardless of how far it has been dragged. This makes the interaction feel responsive.

---

## 5. Chat Bottom Sheet

### 5.1 Three States

| State | Height | Trigger |
|-------|--------|---------|
| **Peek** | 64px | Default. Collapse from half/full. |
| **Half** | 50vh | Swipe up from peek. Tap peek bar. |
| **Full** | 100vh (full screen) | Swipe up from half. Tap when half-expanded. |

### 5.2 Peek State Content (64px)

The peek bar must communicate three things in a very small space: (1) that chat exists, (2) the latest message, and (3) a way to compose.

```
┌──────────────────────────────────────────┐
│ 🤖 "I've scheduled the Bangkok re..."   │  <- 24px: last message snippet
│ [Message...                      ] [↑]  │  <- 40px: mini compose bar
└──────────────────────────────────────────┘
```

**Layout details:**
- Top row (24px): Agent avatar (16x16 circle) + last message text (single line, truncated, `text-xs`, `text-tokyo-muted`)
- Bottom row (40px): Simplified compose input (no action bar, just input + send button)
- The send button is the coral `#e07a5f` circle, 32x32px
- The compose input has `text-sm`, transparent background, placeholder "Message..."
- No model selector, no reasoning toggle, no attachment button in peek state
- If the agent is currently responding, the top row shows a pulsing "Typing..." indicator instead of the last message

**Active response indicator in peek:**
```
┌──────────────────────────────────────────┐
│ 🤖 ● ● ●  Typing...                     │  <- Animated dots
│ [Message...                      ] [■]   │  <- Stop button replaces send
└──────────────────────────────────────────┘
```

### 5.3 Transition: Peek to Half

- Duration: 300ms
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (spring-like ease-out)
- The chat area expands upward from the peek position
- Messages scroll container appears, auto-scrolled to bottom
- Action bar (model selector, reasoning, attachment) fades in below the compose input
- Home content above compresses/scrolls out of view proportionally

### 5.4 Transition: Half to Full

- Duration: 250ms
- Same easing
- The header transforms: "Dashboard" becomes "Chat with {name}", collapse arrow appears
- Conversation switcher bar slides in below the header
- The chat occupies the full screen below the header

### 5.5 Compose Bar Across States

| State | Compose input | Model selector | Reasoning toggle | Attachment button | Send/Stop |
|-------|--------------|----------------|-----------------|-------------------|-----------|
| Peek | Simplified, single-line | Hidden | Hidden | Hidden | 32px circle |
| Half | Full textarea, auto-resize | Visible | Visible | Visible | Full send button |
| Full | Full textarea, auto-resize | Visible | Visible | Visible | Full send button |

### 5.6 Chat Controls in Messages

In full-expanded state, inline chat controls (buttons, card grids) work as on desktop. In half-expanded state, the message area is narrower but controls still render -- card grids switch from 2-column to 1-column if the available width is < 300px.

### 5.7 Chat State Persistence

- If the user has chat half-expanded and taps a timeline item (opening a popover), the **chat collapses to peek** to make room for the popover.
- If the user has chat full-expanded and taps a notification or settings gear, the **chat collapses to peek** and the popover opens.
- The chat message scroll position is preserved across state changes.
- If the user dismisses the popover, the chat returns to **peek** state (not to the previous expanded state). This avoids jarring transitions.

---

## 6. Popover System

### 6.1 Animation Specs

| Property | Value |
|----------|-------|
| Slide origin | Bottom of screen, starting from just above the chat peek |
| Slide distance | From off-screen bottom to final position (covering 85% of viewport) |
| Duration | 300ms enter, 200ms exit |
| Easing (enter) | `cubic-bezier(0.16, 1, 0.3, 1)` (decelerate, overshoots slightly) |
| Easing (exit) | `cubic-bezier(0.5, 0, 0.75, 0)` (accelerate out) |
| Border radius | `20px 20px 0 0` (top corners only) |

### 6.2 Backdrop Behavior

- A semi-transparent overlay covers everything above the popover
- Dark mode: `rgba(0, 0, 0, 0.5)` with `backdrop-filter: blur(4px)`
- Light mode: `rgba(0, 0, 0, 0.25)` with `backdrop-filter: blur(4px)`
- Tapping the backdrop dismisses the popover
- The backdrop fades in over 200ms concurrent with the popover slide-up

### 6.3 Drag Handle

Every popover has a drag handle at the top:

```css
.popover-handle {
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-muted);
  opacity: 0.4;
  margin: 12px auto 8px;
}
```

The drag handle serves as both a visual affordance and a dedicated swipe zone (the entire top 32px of the popover is the drag hit area, not just the visible 4px pill).

### 6.4 Scroll Behavior Inside Popovers

- Content inside the popover scrolls independently (`overflow-y: auto`)
- The popover itself has `max-height: 85vh` (or `85dvh` for dynamic viewport on mobile)
- When content is shorter than the popover height, the popover shrinks to fit (minimum 40vh)
- When content is scrolled to the top, pulling down further initiates the dismiss gesture
- Momentum scrolling (`-webkit-overflow-scrolling: touch`) is enabled

### 6.5 Navigation Depth Inside Popovers

Popovers support **one level of internal navigation** only. Examples:

| Starting popover | Internal navigation | Behavior |
|-----------------|---------------------|----------|
| Task detail | Tap "View conversation" | **Replace** popover content with conversation view. Add a back arrow `[←]` at the top. |
| Calendar | Tap a calendar event | **Replace** popover content with event detail. Add a back arrow. |
| Settings | Tap a channel to configure | Expand inline (accordion) -- no navigation. |

The back arrow is a 44x44px tap target in the top-left of the popover content area.

```
┌──────────────────────────────┐
│  ═══ (drag handle) ═══      │
│  [← Back]                    │  <- Back navigation within popover
│                              │
│  CONVERSATION VIEW           │
│  ...                         │
```

If the user swipes down to dismiss, they return to **home** (not to the previous popover content). The back arrow is the only way to go "back" within a popover.

### 6.6 Oversized Content

If content exceeds the 85vh popover (e.g., long task instructions with many work items), the user simply scrolls within the popover. The popover never expands beyond 85vh. For forms that need more space (like the calendar event editor with date pickers), the keyboard push-up behavior described in section 9.1 handles it.

---

## 7. Responsive Breakpoints

### 7.1 Breakpoint Strategy

| Range | Layout | Tailwind prefix |
|-------|--------|-----------------|
| 0--767px | **Mobile**: Layered sheets, chat peek, popovers | Default (no prefix) |
| 768--1023px | **Tablet**: Two-column with chat bottom sheet | `md:` |
| 1024px+ | **Desktop**: Side-by-side panels, resizable chat | `lg:` |

### 7.2 Mobile (< 768px)

Full mobile layout as described in this spec. Features:
- Single column
- Chat as bottom sheet (peek/half/full)
- Popovers instead of tabs
- No resize handles
- No sidebar
- No tab bar

### 7.3 Tablet (768--1023px)

A hybrid layout:
- **Left**: Full workspace content (home, calendar, task detail, settings) -- same as desktop workspace panel
- **Right**: Chat as a bottom sheet that overlays the right portion of the screen
- Tab bar is present at the top (same as desktop)
- Chat peek is at the bottom-right, chat expands upward over the right column only
- No popover system -- tabs work as on desktop
- Calendar sidebar is hidden; calendar toggles become a horizontal row above the calendar

```
┌─────────────────┬────────────────┐
│  [Home][Cal][⚙] │                │
├─────────────────┤                │
│                 │  (workspace    │
│  Home/Calendar/ │   continues    │
│  Task detail    │   or empty)    │
│                 │                │
│                 ├────────────────┤
│                 │ 💬 Chat peek   │
│                 │ [Message...][↑]│
└─────────────────┴────────────────┘
```

### 7.4 Desktop (1024px+)

Current layout unchanged:
- Left panel: workspace with tab bar
- Right panel: always-visible chat with resize handle
- Min chat width: 300px

### 7.5 Tailwind Implementation

Use the standard Tailwind responsive prefixes. Mobile-first approach means:
- Write mobile styles as the default (no prefix)
- Add `md:` for tablet overrides
- Add `lg:` for desktop overrides

Key utility classes:
```html
<!-- Example: hide on mobile, show on desktop -->
<div class="hidden lg:flex">Desktop tab bar</div>

<!-- Example: show on mobile, hide on desktop -->
<div class="flex lg:hidden">Mobile header</div>

<!-- Example: mobile full-width, desktop side panel -->
<div class="w-full lg:w-auto lg:min-w-[300px]">Chat panel</div>
```

---

## 8. Component Adaptations

### 8.1 Timeline

The timeline is the hero component on mobile home. Adaptations:

| Aspect | Desktop | Mobile |
|--------|---------|--------|
| Width | Shares space with chat panel | Full screen width |
| Vertical line | `left: 3.65rem` | `left: 3rem` (narrower time column) |
| Time column | `w-14` (56px) | `w-12` (48px) |
| Item cards | `max-w-sm` | `max-w-none` (full width) |
| Font sizes | `text-xs` title, `text-[10px]` time | Same (already compact) |
| Tap targets | Click opens tab | Tap opens popover |
| Load earlier/later | Button | Same, but also support pull-to-refresh for "load earlier" |

The "TIMELINE" header on mobile includes the same "+New task" and "Calendar" buttons, but they become icon-only to save space:

```
📅 TIMELINE                    [+] [📅→]
```

### 8.2 Calendar (FullCalendar)

FullCalendar is already responsive, but the view and sidebar need adaptation.

| Aspect | Desktop | Mobile (in popover) |
|--------|---------|---------------------|
| Default view | `timeGridWeek` | `listWeek` (list layout) |
| Alternative view | `dayGridMonth` | `timeGrid3Day` (3-day grid) |
| Sidebar | 192px left sidebar with toggles | No sidebar. Calendar toggles as horizontal pills above the calendar. |
| Height | Full tab height | ~65vh (within 85vh popover minus header) |
| Event click | Opens tab | Replaces popover content with event detail (with back arrow) |
| New task button | In sidebar | In popover header, right-aligned |

Calendar toggles on mobile:
```
[● Personal] [● Work] [● Agent Tasks]
   (horizontally scrollable pills, checkbox-toggleable)
```

### 8.3 Task Detail Metadata Panels

The desktop layout uses horizontal metadata rows. On mobile, these stack vertically but remain compact:

```
┌──────────────────────────────┐
│ 📅  Created      Feb 23, 2:15│
│ 👤  Created by   Agent       │
│ ▶   Started      2:15 PM     │
│ ✓   Completed    2:30 PM     │
└──────────────────────────────┘
```

Each row: icon (20px) + label (`text-xs text-tokyo-muted`, 80px fixed width) + value (`text-xs text-tokyo-text`, flexible). Rows separated by `border-b border-white/5`. Padding `py-2.5 px-3`.

Action buttons (Complete, Delete, Edit) move to the **bottom of the popover** as a sticky footer:

```css
.popover-actions {
  position: sticky;
  bottom: 0;
  padding: 12px 16px;
  background: var(--color-bg);
  border-top: 1px solid var(--border-subtle);
}
```

Buttons are full-width on mobile, stacked vertically if there are more than two:
```
[         Complete          ]   <- Primary (green)
[    Delete    ]                <- Danger (red), smaller
```

### 8.4 Compose Bar Adaptation

The compose bar in half/full chat states needs to be mobile-optimized.

**Desktop layout:**
```
[Sonnet 4.5 ▾] [✨ Reasoning] | 📎  ─── / [↑]
```

**Mobile layout (half/full state):**
```
[Sonnet 4.5 ▾] [✨] 📎                    [↑]
```

Changes:
- Reasoning toggle shows icon only (no label). Tooltip on long-press.
- The slash `/` command trigger is removed (use typing `/` in the input instead).
- The pipe dividers are removed.
- Model badge is the same but may truncate the model name to just "Sonnet" if space is tight.
- The attachment icon becomes a 44x44 tap target.
- The send button becomes a 44x44 tap target.

**Attachment preview strip:** On mobile, attachment thumbnails are 48x48 instead of 64x64 to save vertical space.

### 8.5 Message Controls (Inline Buttons, Card Grids)

Chat messages sometimes contain interactive controls (buttons, card selections).

| Control type | Desktop | Mobile |
|-------------|---------|--------|
| Button row | `flex-wrap gap-1.5` | Same, but buttons get `min-height: 44px` |
| Card grid (2-col) | `grid-template-columns: 1fr 1fr` | Same if width > 300px, else `1fr` |
| Card grid (1-col) | `grid-template-columns: 1fr` | Same |

Card descriptions (`card-desc`) may be hidden on mobile to save space -- show only `card-emoji` and `card-label`.

### 8.6 Notifications Panel

On desktop, the notification panel is an absolute-positioned dropdown. On mobile, it becomes a **popover** (same sheet system as everything else):

- Slides up from bottom, same 85vh max-height
- Drag handle at top
- Swipe down to dismiss
- Notification items are full-width with larger tap targets (48px row height minimum)

### 8.7 Conversation Dropdown

On desktop, the conversation dropdown is a small positioned menu. On mobile (chat full-expanded), it becomes a full-width sheet that slides down from the header bar.

---

## 9. Edge Cases & Concerns

### 9.1 Keyboard Open State

When the user taps the compose input (in any chat state), the virtual keyboard opens and pushes content up.

**Behavior:**
- The compose bar stays pinned above the keyboard (using `visualViewport` API or `position: fixed` with dynamic bottom offset)
- In peek state: the peek bar rises above the keyboard. The home content is pushed up.
- In half/full state: the message list shrinks to accommodate the keyboard. Auto-scroll to the latest message.
- On keyboard dismiss: everything returns to previous position.

**Implementation approach:**
```javascript
// Use visualViewport API for accurate keyboard detection
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const keyboardHeight = window.innerHeight - window.visualViewport.height;
    document.documentElement.style.setProperty('--keyboard-height', keyboardHeight + 'px');
  });
}
```

CSS:
```css
.chat-peek, .compose-bar {
  bottom: calc(env(safe-area-inset-bottom) + var(--keyboard-height, 0px));
  transition: bottom 100ms ease-out;
}
```

**Popover with keyboard:** If the user is editing an event (textarea in popover), the popover should not be dismissed by the keyboard appearance. The popover content scrolls to keep the focused input visible.

### 9.2 Notification Badges

| Location | Badge position |
|----------|---------------|
| Header bell icon | Top-right of the bell icon, same as desktop: `absolute -top-0.5 -right-0.5`, min-width 16px, coral background |
| Chat peek (when chat has unread in collapsed state) | Left side of peek bar, small blue dot next to the agent avatar |

If the user is on the home screen and a new message arrives while chat is in peek state:
1. The peek bar updates its snippet text
2. A blue dot appears on the agent avatar in the peek bar
3. The dot clears when the user expands chat to half or full

### 9.3 Long-Running Agent Responses

When the agent is processing (thinking, executing a task), the user needs feedback even in peek state.

**Peek state indicators:**
- Snippet text changes to "Thinking..." or "Working on task..." with animated dots
- The agent avatar in the peek bar gets a subtle purple pulse ring animation
- If a task is running, the snippet shows: "Running: {task_title}..."

**Half/full state:** Same as desktop -- typing indicator with bouncing dots, or "Thinking..." label if extended thinking is active.

### 9.4 Orientation Change (Portrait to Landscape)

| State | Portrait | Landscape |
|-------|----------|-----------|
| Home + peek | Normal layout | Same layout, more horizontal space. Timeline items may show 2 columns if width > 640px. |
| Chat full | Full-screen portrait chat | Full-screen landscape chat. Messages area is wider. |
| Popover | 85vh height | 85vh height (which is wider in landscape). Content reflows. |

The layout does not fundamentally change between orientations. The `vh`/`dvh` units and percentage-based widths handle the reflow. FullCalendar in the calendar popover may switch from `listWeek` to `timeGrid3Day` in landscape if width > 600px.

### 9.5 Accessibility

**Screen readers:**
- Popovers announce themselves: `role="dialog"` with `aria-label="Task detail"` (or appropriate label)
- The drag handle has `aria-hidden="true"` (it is a visual affordance; screen reader users dismiss via a "Close" button)
- **Add a visually hidden close button** inside each popover for screen reader users: `sr-only` class, `aria-label="Close"`, positioned at the top. This satisfies accessibility without adding a visible close button.
- Chat states announced: "Chat expanded" / "Chat collapsed" via `aria-live="polite"` region
- All interactive elements have `aria-label` attributes

**Reduced motion:**
```css
@media (prefers-reduced-motion: reduce) {
  .popover-sheet,
  .chat-sheet,
  .backdrop-overlay {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
  }
}
```

When reduced motion is preferred:
- Sheets appear/disappear instantly (no slide animation)
- No haptic feedback on drag
- No spring animations
- Drag-to-dismiss still works but the sheet teleports to dismissed state on release

**Focus management:**
- When a popover opens, focus moves to the popover content (first focusable element or the heading)
- When a popover closes, focus returns to the element that triggered it
- The chat compose input retains focus across state transitions (peek to half to full)
- Tab order is confined within the active sheet (popover or expanded chat) using a focus trap

### 9.6 Safe Area Insets

For devices with notches, rounded corners, or home indicators:

```css
.mobile-header {
  padding-top: env(safe-area-inset-top);
}

.chat-peek {
  padding-bottom: env(safe-area-inset-bottom);
}

.popover-actions {
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
}
```

---

## 10. Design Patterns & References

### 10.1 Borrowed Patterns

| Pattern | Source | How we use it |
|---------|--------|---------------|
| Bottom sheet with peek/half/full states | **Apple Maps** (route card), **Google Maps** (place details) | Chat sheet with three snap points |
| Popover sheets from bottom | **Uber** (ride details), **Apple Music** (now playing) | Task detail, calendar, settings as popovers |
| Swipe-to-dismiss sheets | **iOS Share Sheet**, **Apple Maps** | All popovers and chat half-expanded |
| Backdrop dim on sheet open | **iOS modal presentation** | Dim + blur behind popovers |
| Drag handle affordance | **iOS native sheets**, **Google Sheets mobile** | Top of every popover and chat sheet |
| Conversation switcher as full-width dropdown | **Slack mobile** (workspace switcher) | Conversation list in full-expanded chat |
| Persistent compose bar | **iMessage**, **WhatsApp** | Chat peek always shows compose input |
| Quick access pills | **Google Tasks** (category chips), **Notion mobile** | Quick access buttons as horizontal scroll pills |

### 10.2 What Makes This Different from a Generic Chat App

1. **Chat is secondary to the dashboard.** Unlike WhatsApp or Telegram where chat is the entire UI, our chat is an always-available assistant that lives alongside a workspace. The peek state communicates this: chat is there, but the dashboard is the home.

2. **Popovers replace navigation.** Instead of a tab bar or drawer, content surfaces as sheets over the home screen. This keeps the user spatially anchored -- they never "leave" the dashboard. They are always one swipe away from home.

3. **The timeline is the hub.** The vertical timeline on the home screen is the primary navigation surface. Everything connects through it: tasks, events, and the agent's activity. Tapping anything in the timeline surfaces its detail as a popover.

4. **Agent awareness is ambient.** The chat peek bar provides constant awareness of the agent's state (responding, thinking, idle) without requiring the user to enter the chat. This is more like a smart home control panel than a messaging app.

---

## 11. Implementation Notes

### 11.1 CSS Architecture

Add a new file: `packages/dashboard/public/css/mobile.css`

This file contains:
- Chat sheet positioning and transitions
- Popover sheet styles
- Backdrop overlay
- Drag handle styles
- Mobile-specific overrides for existing components
- Safe area handling
- Keyboard-aware positioning

Include it in `index.html` after `app.css`:
```html
<link rel="stylesheet" href="css/app.css" />
<link rel="stylesheet" href="css/calendar.css" />
<link rel="stylesheet" href="css/mobile.css" />
```

### 11.2 JavaScript Architecture

Add a new file: `packages/dashboard/public/js/mobile.js`

This module handles:
- Sheet state management (peek/half/full for chat, open/closed for popovers)
- Touch gesture detection and handling
- Drag-to-dismiss logic with velocity detection
- Visual viewport tracking for keyboard
- `prefers-reduced-motion` detection

The module exposes an Alpine.js mixin or store:
```javascript
Alpine.store('mobile', {
  chatState: 'peek',  // 'peek' | 'half' | 'full'
  popover: null,       // null | { type: 'task', data: {...} } | { type: 'calendar' } | etc.
  keyboardHeight: 0,
  isMobile: window.innerWidth < 768,

  expandChat(state) { ... },
  collapseChat() { ... },
  openPopover(type, data) { ... },
  closePopover() { ... },
});
```

### 11.3 Key CSS Custom Properties

```css
:root {
  --chat-peek-height: 64px;
  --chat-half-height: 50vh;
  --mobile-header-height: 44px;
  --popover-max-height: 85dvh;
  --popover-border-radius: 20px;
  --sheet-transition-duration: 300ms;
  --sheet-transition-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --keyboard-height: 0px;
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
}
```

### 11.4 Z-Index Stack

| Layer | Z-index | Content |
|-------|---------|---------|
| Home content | 0 | Timeline, channels, quick access |
| Mobile header | 10 | Agent name, bell, gear |
| Popover backdrop | 20 | Semi-transparent dim overlay |
| Popover sheet | 30 | Task detail, calendar, settings, notebook |
| Chat sheet (all states) | 40 | Chat peek, half, full |
| Conversation dropdown | 50 | Conversation switcher (within full chat) |
| Notification panel | 50 | Notification popover |

Chat is always the topmost interactive layer. Even when a popover is open, the chat peek bar renders above the popover.

### 11.5 Touch Performance

- Use `will-change: transform` on sheets during drag gestures, remove after animation completes
- Use `transform: translateY()` for sheet positioning (GPU-accelerated), not `top` or `height`
- Set `touch-action: none` on the drag handle zone to prevent browser scroll interference
- Debounce `visualViewport` resize events to 16ms (one frame)
- Use `requestAnimationFrame` for drag position updates

### 11.6 Feature Detection

Wrap mobile features in a detection guard:
```javascript
const isMobileLayout = () => window.innerWidth < 768;

// Re-evaluate on resize (debounced)
window.addEventListener('resize', debounce(() => {
  Alpine.store('mobile').isMobile = isMobileLayout();
}, 150));
```

When `isMobile` changes (e.g., user rotates tablet past 768px threshold), the layout should seamlessly switch between mobile and tablet/desktop modes. Close any open popovers, collapse chat to its desktop panel state, and show the tab bar.

---

*Created: 2026-02-23*
*Design language: Nina V1 (Tokyo Night / Catppuccin)*
*Framework: Alpine.js + Tailwind CSS (CDN)*
