# M2-S7: Responsive Mobile Layout

> **Milestone:** M2 — Web UI
> **Sprint:** S7 (extending M2)
> **Status:** In Progress
> **Date:** 2026-02-23
> **Design spec:** `docs/design/mobile-layout-spec.md`
> **Branch:** `sprint/m2-s7-responsive-mobile`

---

## Goal

Make the dashboard fully responsive with a mobile-first layered sheet model. Desktop layout must remain pixel-perfect — zero regressions.

## Team

| Role | Model | Agent |
|------|-------|-------|
| Tech Lead | Opus | Coordination, architecture, review |
| Mobile Dev | Sonnet | Implements all mobile layout code |
| Desktop Regression Tester | Sonnet | Verifies desktop layout after each change |
| UX Reviewer | Opus | Reviews against spec, catches deviations |

## Design Summary

Three-layer mobile model:
- **Layer 0:** Home screen (always visible base)
- **Layer 1:** Popovers (task detail, calendar, settings) — swipe down to dismiss
- **Layer 2:** Chat bottom sheet (peek 64px / half 50vh / full 100vh) — always on top

Three responsive tiers:
- `< 768px` — Mobile (sheets + popovers)
- `768-1023px` — Tablet (tabs + bottom sheet chat)
- `1024px+` — Desktop (unchanged)

## Tasks

### Phase 1: Foundation (sequential)

| # | Task | Description |
|---|------|-------------|
| 1 | CSS foundation | Create `mobile.css` with custom properties, breakpoint structure, z-index stack, sheet base styles |
| 2 | Alpine mobile store | Create `mobile.js` with `Alpine.store('mobile', {...})` — chatState, popover, keyboardHeight, isMobile |
| 3 | Include files | Add `mobile.css` and `mobile.js` to `index.html` |

### Phase 2: Core Layout (sequential, each verified by regression tester)

| # | Task | Description |
|---|------|-------------|
| 4 | Mobile header | Replace tab bar with simplified header on `< 768px` — agent name, bell, gear. Hide desktop tab bar. |
| 5 | Chat bottom sheet — peek | Restructure chat panel: on mobile, render as fixed bottom bar (64px). Show last message snippet + mini compose. |
| 6 | Chat bottom sheet — expand | Implement half (50vh) and full (100vh) states. Swipe up from peek → half → full. Swipe down to collapse. |
| 7 | Touch gesture engine | Drag-to-dismiss logic with velocity detection, scroll-top conflict resolution, haptic feedback |

### Phase 3: Popover System (parallel with chat refinement)

| # | Task | Description |
|---|------|-------------|
| 8 | Popover component | Sheet component with backdrop, drag handle, slide-up animation, swipe-down dismiss |
| 9 | Task detail popover | Render task detail as popover on mobile. Sticky action footer. |
| 10 | Event detail popover | Render event detail as popover on mobile. |
| 11 | Calendar popover | FullCalendar in popover. listWeek view. Horizontal calendar toggle pills. |
| 12 | Settings popover | Settings content as popover on mobile. |
| 13 | Notebook popover | Quick access items (External Rules, Reminders, Standing Orders) as popovers. |
| 14 | Notification popover | Notification panel as popover on mobile. |

### Phase 4: Home Screen Adaptation

| # | Task | Description |
|---|------|-------------|
| 15 | Home mobile layout | Full-width timeline, horizontal scroll quick access pills, channel status adaptation |
| 16 | Timeline tap → popover | Tapping timeline items opens task/event detail as popover instead of tab |

### Phase 5: Polish & Edge Cases

| # | Task | Description |
|---|------|-------------|
| 17 | Keyboard handling | visualViewport API, compose bar stays above keyboard, popover scroll-to-input |
| 18 | Safe area insets | env(safe-area-inset-*) for notched devices |
| 19 | Accessibility | sr-only close buttons, focus traps, aria labels, reduced motion |
| 20 | Conversation switcher | Full-width sheet in full-expanded chat (replacing dropdown) |

### Phase 6: Verification

| # | Task | Description |
|---|------|-------------|
| 21 | Desktop full regression | Complete walkthrough of all desktop features at 1024px+ |
| 22 | Mobile walkthrough | Complete walkthrough of all mobile features at 375px |
| 23 | Tablet check | Verify tablet hybrid layout at 768px |

## Dependencies

- M5-S10 (Live Dashboard) — COMPLETE (current branch)
- `docs/design/mobile-layout-spec.md` — design spec (complete)

## Risks

- **Gesture conflicts** — scrolling vs dismissing. Mitigated by scroll-top detection pattern.
- **Desktop regression** — mobile CSS leaking. Mitigated by dedicated regression tester + strict breakpoint discipline.
- **FullCalendar in popover** — may need height constraints. Test early.

## Success Criteria

- [ ] All three breakpoints work (mobile, tablet, desktop)
- [ ] Chat peek visible on all mobile screens
- [ ] All popovers dismiss via swipe (no X buttons)
- [ ] Desktop layout pixel-identical to pre-sprint
- [ ] Keyboard doesn't break layout on mobile
- [ ] Accessibility basics (focus trap, screen reader close, reduced motion)
