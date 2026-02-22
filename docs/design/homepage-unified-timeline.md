# Homepage Unified Timeline Design

> **Status:** Implemented (Quick Fix) — Superseded by navigable-timeline.md
> **Sprint:** M5-S9 (Task Steps)
> **Decision Date:** 2026-02-22
> **Next:** See [navigable-timeline.md](navigable-timeline.md) for full redesign

## Overview

Replace the current dual-view (TASKS + UPCOMING sections) with a unified "Active Now + Timeline" layout that eliminates duplication and provides clearer mental model.

## Problem Statement

Current homepage shows scheduled tasks in **two places**:
1. TASKS section — shows all tasks including scheduled ones
2. UPCOMING section — shows calendar events including scheduled task events

This causes confusion: users see the same item twice with different presentations.

## Solution: Unified Timeline with Active Section

### Layout Structure

```
┌─────────────────────────────────────────────────────┐
│  ACTIVE NOW                              [View all] │
│  ┌─────────────────────────────────────────────────┐│
│  │ ● Research Bangkok travel       Running  2h 15m ││
│  │   ████████████████░░░░░░  ~35% remaining        ││
│  └─────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────┐│
│  │ ● Monitor stock prices          Day 3 of 7     ││
│  │   ██████████░░░░░░░░░░░  4 days remaining      ││
│  └─────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│  TIMELINE                          [📅 Calendar →] │
│  ─── Now 2:30 PM ────────────────────              │
│                                                     │
│  3:00  ● Send WhatsApp reminder           [Task]   │
│  3:30  ○ Team standup meeting             [Event]  │
│  5:00  ◐ Review PR #142                   [Reminder]│
│                                                     │
│  ─── Tomorrow, Feb 23 ───────────────────          │
│  9:00  ● Generate weekly report           [Task]   │
│  14:00 ○ Dentist appointment              [Event]  │
└─────────────────────────────────────────────────────┘
```

### Sections

#### 1. Active Now
- **What:** Currently running tasks (status = 'running')
- **Shows:** Title, duration, progress indicator
- **Multi-day tasks:** Show day count (e.g., "Day 3 of 7")
- **Empty state:** Section collapses when no active tasks

#### 2. Timeline
- **What:** Chronological list of upcoming items
- **Includes:**
  - Scheduled tasks (pending, with scheduledFor date)
  - Calendar events (meetings, appointments)
  - Reminders
- **Excludes:**
  - Immediate tasks (no scheduledFor) — these appear in Active when running
  - Completed tasks
- **Grouping:** Date separators for multi-day view
- **Default range:** Today + tomorrow (expandable)

### Visual Differentiation

| Type | Dot Color | Badge |
|------|-----------|-------|
| Task (agent action) | Blue #7aa2f7 | "Task" |
| Event (calendar) | Green #9ece6a | "Event" |
| Reminder | Orange #ff9e64 | "Reminder" |
| Active/Running | Red #f7768e | "Running" |

### Calendar Tab Links

Two subtle paths to the full calendar:

**A. Header Link**
- Position: Right side of "TIMELINE" header
- Style: Muted text link with calendar icon
- Text: `📅 Calendar →`
- Behavior: Opens Calendar tab (default view)

**B. Clickable Date Separators**
- Position: Date separators in timeline (e.g., "Tomorrow, Feb 23")
- Style: Hover highlight, cursor pointer
- Behavior: Opens Calendar tab focused on that specific date

## Task Lifecycle in UI

```
User creates task
        │
        ▼
  ┌─────────────┐
  │  Immediate? │
  └─────────────┘
    │         │
   Yes        No (scheduled)
    │         │
    ▼         ▼
 [Active    [Timeline]
  Now]      at scheduled time
    │         │
    │         ▼
    │      When due:
    │      moves to Active Now
    │         │
    ▼         ▼
  [Completes]
       │
       ▼
  [Removed from view]
  (or "Recently completed" section)
```

## Implementation Notes

### Data Sources
- **Active Now:** `GET /api/tasks?status=running`
- **Timeline:** Merge:
  - `GET /api/tasks?status=pending&type=scheduled`
  - `GET /api/calendar/events`
  - Sort by start time

### Calendar Event Handling
- Events with `taskId` → clicking opens Task view
- Events without `taskId` → clicking opens Event view (legacy calendar entries)

### Empty States
- No active tasks: Hide "Active Now" section entirely
- No timeline items: Show "Nothing scheduled" message

## Migration

1. Remove TASKS section from homepage
2. Remove UPCOMING section from homepage
3. Add Active Now section
4. Add Timeline section
5. Calendar tab remains unchanged (full week/month view)

## Mockup

See: `.playwright_output/option-a-v2-with-active.html`

## Open Questions

1. Should completed tasks appear briefly in a "Just completed" area?
2. Should immediate (non-scheduled) pending tasks appear anywhere on homepage?
3. Timeline default range: today only, or today + tomorrow?
