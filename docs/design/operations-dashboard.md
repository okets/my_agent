# Operations Dashboard — Design Specification

> **Status:** Design Complete
> **Date:** 2026-02-14
> **Scope:** Task browser, memory viewer, settings, agent operations
> **Milestone:** M5
> **Dependencies:** M4a (Task System), M4b (Memory), M2 (Web UI)

---

## Table of Contents

1. [Context and Motivation](#context-and-motivation)
2. [Dashboard Structure](#dashboard-structure)
3. [Task Browser](#task-browser)
4. [Project Detail View](#project-detail-view)
5. [Memory Viewer](#memory-viewer)
6. [Daily Summaries](#daily-summaries)
7. [Settings](#settings)
8. [Deep Links](#deep-links)
9. [Navigation and Layout](#navigation-and-layout)
10. [Implementation Notes](#implementation-notes)

---

## Context and Motivation

### The Problem

After M4a and M4b, the agent manages:

- **Tasks:** inbox, projects, ongoing routines (folders, status, review requests)
- **Memory:** entities, observations, relations, daily summaries
- **Conversations:** transcripts, search, multi-channel history

The M2 web UI provides chat. But users need visibility into:

1. **What is the agent working on?** (task browser)
2. **What does the agent know?** (memory viewer)
3. **What happened recently?** (daily summaries)
4. **How is the agent configured?** (settings)

### Design Principles

- **Dashboard, not admin panel.** Focus on operational visibility, not deep configuration.
- **Actions are conversational.** Complex actions (approve, reject, provide feedback) happen via chat, not forms.
- **Read-heavy, write-light.** Most interactions are viewing state, not modifying it.
- **Agent builds this.** M5 is designed to be built by the agent (with human review) after M4a unlocks self-development.

---

## Dashboard Structure

### Information Architecture

```
Dashboard
├── Chat (default, existing from M2)
│
├── Tasks
│   ├── Inbox (ad-hoc tasks)
│   ├── Projects (multi-phase work)
│   ├── Ongoing (recurring routines)
│   └── Archive (completed)
│
├── Memory
│   ├── Entities (people, orgs, projects)
│   ├── Daily Summaries
│   └── Search
│
└── Settings
    ├── Auth & Models
    ├── Channels
    └── Preferences
```

### URL Structure

```
/                    → Chat (default)
/tasks               → Task browser (inbox view)
/tasks/inbox         → Inbox tasks
/tasks/projects      → Projects
/tasks/ongoing       → Ongoing routines
/tasks/archive       → Archive
/tasks/:id           → Project detail view
/memory              → Memory overview (entity list)
/memory/entity/:id   → Entity detail
/memory/daily        → Daily summaries
/memory/daily/:date  → Specific day's summary
/settings            → Settings overview
/settings/auth       → Auth configuration
/settings/channels   → Channel configuration
```

---

## Task Browser

### Overview

Shows all tasks across inbox, projects, and ongoing. Quick scanning of status and pending actions.

### List View

```
┌──────────────────────────────────────────────────────────────────────┐
│  Tasks                                                               │
├──────────────────────────────────────────────────────────────────────┤
│  [Inbox] [Projects] [Ongoing] [Archive]          [Search tasks...]   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ● AWAITING REVIEW                                                   │
│  ├── 2026-02-14-login-bug           Project    Awaiting Review       │
│  │   "Auth module refactor ready for review"                         │
│  │   [View] [Open in VS Code]                                        │
│  │                                                                   │
│  ├── 2026-02-14-pricing-email       Inbox      Awaiting Review       │
│  │   "Draft email to Sarah ready"                                    │
│  │   [View] [Open in VS Code]                                        │
│                                                                      │
│  ● IN PROGRESS                                                       │
│  ├── 2026-02-14-feature-x           Project    Executing (2h)        │
│  │   "Implementation 60% complete"                                   │
│  │   [View] [Open in VS Code]                                        │
│                                                                      │
│  ● COMPLETED (today)                                                 │
│  ├── 2026-02-14-server-check        Inbox      Completed             │
│  │   "Server healthy, 230ms response"                                │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Filtering

| Filter | Options |
|--------|---------|
| Type | Inbox, Projects, Ongoing, Archive |
| Status | Awaiting Review, In Progress, Completed, All |
| Date Range | Today, This Week, All Time |
| Search | Full-text search across task.md content |

### Sorting

| Sort | Description |
|------|-------------|
| Status Priority | Awaiting Review first, then In Progress, then Completed |
| Recent First | By updated timestamp |
| Created First | By creation timestamp |
| Alphabetical | By task slug |

### Quick Actions

| Action | Where | Effect |
|--------|-------|--------|
| View | List row | Navigate to project detail |
| Open in VS Code | List row | Opens folder in VS Code (deep link) |
| Archive | Project detail | Move to archive |

---

## Project Detail View

### Purpose

Full view of a single task/project: status, plan, history, files, and actions.

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Back to Tasks                                                     │
│                                                                      │
│  2026-02-14-login-bug                                    Project     │
│  ══════════════════════════════════════════════════════════════════  │
│                                                                      │
│  Status: Awaiting Review                                             │
│  Created: Feb 14, 2026 9:00am                                        │
│  Requested by: user (via WhatsApp)                                   │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ PLAN                                                            │ │
│  │                                                                 │ │
│  │ ## Auth Module Refactor                                         │ │
│  │                                                                 │ │
│  │ 1. Update token refresh logic in auth.ts                        │ │
│  │ 2. Add retry with exponential backoff                           │ │
│  │ 3. Unit tests for edge cases                                    │ │
│  │                                                                 │ │
│  │ Files affected: src/auth.ts, src/token.ts, tests/auth.test.ts   │ │
│  │ Estimated effort: 2 hours                                       │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  [Approve] [Reject with Feedback] [Open in VS Code]                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ HISTORY                                                         │ │
│  │                                                                 │ │
│  │ • Feb 14, 2:30pm — Plan submitted for review                    │ │
│  │ • Feb 14, 11:00am — Investigation complete                      │ │
│  │ • Feb 14, 9:00am — Created from WhatsApp request                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ FILES                                                           │ │
│  │                                                                 │ │
│  │ CLAUDE.md              (context)                                │ │
│  │ task.md                (status)                                 │ │
│  │ plan.md                (implementation plan)                    │ │
│  │ src/                   (working files)                          │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Actions

| Action | Availability | Effect |
|--------|--------------|--------|
| **Approve** | When Awaiting Review | Sends approval to agent, triggers `claude --continue` |
| **Reject with Feedback** | When Awaiting Review | Opens feedback input, sends rejection + feedback |
| **Open in VS Code** | Always | Opens project folder in VS Code |
| **Archive** | When Completed | Moves to archive folder |
| **Resume** | When Paused/Idle | Sends continuation prompt to agent |

### Approve/Reject Flow

When user clicks "Approve":

1. Dashboard sends approval via WebSocket
2. Brain receives approval event
3. Brain spawns `claude --continue --cwd {folder}` with approval message
4. Task status updates to "Executing"
5. Dashboard updates in real-time

When user clicks "Reject with Feedback":

1. Dashboard shows feedback input modal
2. User types feedback
3. Dashboard sends rejection + feedback via WebSocket
4. Brain receives rejection event
5. Brain spawns `claude --continue` with feedback
6. Task status updates to "Planning" (re-planning based on feedback)

---

## Memory Viewer

### Entity List

```
┌──────────────────────────────────────────────────────────────────────┐
│  Memory                                                              │
├──────────────────────────────────────────────────────────────────────┤
│  [Entities] [Daily Summaries]                [Search memory...]      │
├──────────────────────────────────────────────────────────────────────┤
│  [All] [People] [Organizations] [Projects] [Concepts]                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Sarah Chen                                              Person      │
│  Works at Acme Corp • Prefers email • Last seen: today               │
│                                                                      │
│  Acme Corp                                          Organization     │
│  Enterprise customer • 3 contacts • Active project: Platform Migr.. │
│                                                                      │
│  Project Atlas                                           Project     │
│  Active • Owner: Acme Corp • 5 related conversations                 │
│                                                                      │
│  Bob Martinez                                            Person      │
│  Works at Acme Corp • Sarah's manager • Last seen: 2 days ago        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Entity Detail

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Back to Memory                                                    │
│                                                                      │
│  Sarah Chen                                              Person      │
│  ══════════════════════════════════════════════════════════════════  │
│                                                                      │
│  Contact Info                                                        │
│  • Email: sarah@acmecorp.com                                         │
│  • WhatsApp: +1555123456                                             │
│                                                                      │
│  Relations                                                           │
│  • works_at → Acme Corp (engineering)                                │
│  • reports_to → Bob Martinez                                         │
│  • contact_for → Project Atlas                                       │
│                                                                      │
│  Observations                                                        │
│  • Prefers email over WhatsApp (confidence: 0.9)                     │
│  • Prefers meetings before 10am (confidence: 0.7)                    │
│  • Technical background, understands API details (confidence: 0.8)   │
│                                                                      │
│  Conversation History                                                │
│  • autumn-wind-drifts (web) — today                                  │
│  • pricing-discussion (email) — 3 days ago                           │
│  • project-kickoff (web) — 1 week ago                                │
│                                                                      │
│  First seen: Feb 7, 2026                                             │
│  Last seen: today                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Memory Actions

| Action | Effect |
|--------|--------|
| Click entity | Navigate to entity detail |
| Click conversation | Navigate to conversation in chat |
| Search | Semantic search across all entities and observations |

---

## Daily Summaries

### List View

```
┌──────────────────────────────────────────────────────────────────────┐
│  Memory                                                              │
├──────────────────────────────────────────────────────────────────────┤
│  [Entities] [Daily Summaries]                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  February 14, 2026                                           Today   │
│  3 conversations • 2 tasks completed • 1 new contact                 │
│                                                                      │
│  February 13, 2026                                       Yesterday   │
│  5 conversations • 1 task completed • pricing proposal sent          │
│                                                                      │
│  February 12, 2026                                                   │
│  2 conversations • server migration completed                        │
│                                                                      │
│  ...                                                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Summary Detail

Shows the full daily summary markdown rendered in a readable format.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Back to Daily Summaries                                           │
│                                                                      │
│  February 14, 2026                                                   │
│  ══════════════════════════════════════════════════════════════════  │
│                                                                      │
│  ## Conversations                                                    │
│  - 3 web conversations (45 turns total)                              │
│  - 5 WhatsApp messages from Sarah                                    │
│                                                                      │
│  ## Key Events                                                       │
│  - Completed server migration project                                │
│  - Sarah approved the pricing proposal                               │
│  - New contact: Bob from Acme Corp (Sarah's manager)                 │
│                                                                      │
│  ## Learnings                                                        │
│  - Sarah prefers meetings before 10am                                │
│  - Acme Corp's fiscal year ends in March                             │
│                                                                      │
│  ## Tasks                                                            │
│  - Completed: server-migration                                       │
│  - In progress: feature-x (waiting on review)                        │
│                                                                      │
│  ## Tomorrow                                                         │
│  - Follow up with Sarah on timeline                                  │
│  - Project review meeting at 2pm                                     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Settings

### Structure

```
Settings
├── Auth & Models
│   ├── API Key (masked, change option)
│   ├── Default Model (selector)
│   └── Max tokens, temperature, etc.
│
├── Channels
│   ├── Web (always enabled)
│   ├── WhatsApp (connected/disconnected, QR flow)
│   └── Email (connected/disconnected, OAuth flow)
│
└── Preferences
    ├── Notifications (where to send alerts)
    ├── Daily Summary (enabled/disabled, time)
    └── Auto-enrichment (enabled/disabled)
```

### Auth & Models

```
┌──────────────────────────────────────────────────────────────────────┐
│  Settings › Auth & Models                                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  API Key                                                             │
│  sk-ant-api03...abc                          [Change]                │
│                                                                      │
│  Default Model                                                       │
│  [Opus 4.6 ▾]                                                        │
│                                                                      │
│  Haiku Model (for summaries, extraction)                             │
│  [Haiku 4.5 ▾]                                                       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Channels

```
┌──────────────────────────────────────────────────────────────────────┐
│  Settings › Channels                                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Web Dashboard                                    ● Connected         │
│  Primary interface                                                   │
│                                                                      │
│  WhatsApp                                         ● Connected         │
│  +1555000001 (agent)                        [Disconnect]             │
│                                                                      │
│  Email (Microsoft 365)                         ○ Not Connected       │
│  Connect agent email account                     [Connect]           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Preferences

```
┌──────────────────────────────────────────────────────────────────────┐
│  Settings › Preferences                                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Notifications                                                       │
│  Where to send alerts about tasks and reviews                        │
│  [x] Web Dashboard                                                   │
│  [x] WhatsApp                                                        │
│  [ ] Email                                                           │
│                                                                      │
│  Daily Summary                                                       │
│  [x] Generate daily summary                                          │
│  Time: [23:59 ▾]                                                     │
│  Send to WhatsApp: [x]                                               │
│                                                                      │
│  Auto-Enrichment                                                     │
│  [x] Enrich incoming messages with memory context                    │
│  Max entities: [5 ▾]                                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Deep Links

### VS Code Integration

"Open in VS Code" links use VS Code's URL scheme:

```
vscode://file/{absolute_path_to_folder}
```

Example:
```
vscode://file/path/to/project/.my_agent/projects/2026-02-14-login-bug
```

### Implementation

```typescript
function openInVSCode(folderPath: string): void {
  const url = `vscode://file${folderPath}`;
  window.open(url, '_blank');
}
```

### Requirements

- User must have VS Code installed with URL handling enabled
- Works on macOS, Windows, Linux
- Falls back to displaying path if VS Code not available

---

## Navigation and Layout

### Layout Structure

```
┌──────────────────────────────────────────────────────────────────────┐
│  ┌────────┐                                              [Settings]  │
│  │  Logo  │   [Chat]   [Tasks]   [Memory]                            │
│  └────────┘                                                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                          Content Area                                │
│                                                                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Navigation Behavior

| Section | Default View |
|---------|--------------|
| Chat | Most recent conversation (existing M2 behavior) |
| Tasks | Task list filtered to "Awaiting Review" + "In Progress" |
| Memory | Entity list sorted by last seen |
| Settings | Settings overview |

### Responsive Design

| Viewport | Layout |
|----------|--------|
| Desktop (>1024px) | Full layout with sidebar |
| Tablet (768-1024px) | Collapsible sidebar |
| Mobile (<768px) | Bottom nav, stacked content |

---

## Implementation Notes

### M5 Scope

| Feature | Included |
|---------|----------|
| Task browser (inbox, projects, ongoing, archive) | Yes |
| Project detail view with approve/reject | Yes |
| Memory viewer (entities, relations, observations) | Yes |
| Daily summaries viewer | Yes |
| Settings (auth, channels, preferences) | Yes |
| VS Code deep links | Yes |
| Search across tasks and memory | Yes |

### Out of Scope

| Feature | Notes |
|---------|-------|
| Task creation from dashboard | Tasks are created conversationally or by the agent |
| Memory editing from dashboard | Memory is maintained by the agent |
| Channel setup wizards | Basic connect/disconnect only; setup via chat |
| Real-time Claude Code session view | Future enhancement |

### Tech Stack

Same as M2:

- **Frontend:** Alpine.js + Tailwind CSS (CDN, no build step)
- **Backend:** Fastify
- **Data:** REST APIs reading from task folders + SQLite (memory, conversations)

### API Endpoints

```
# Tasks
GET  /api/tasks                     # List all tasks
GET  /api/tasks/:id                 # Get task details
POST /api/tasks/:id/approve         # Approve a task
POST /api/tasks/:id/reject          # Reject with feedback

# Memory
GET  /api/memory/entities           # List entities
GET  /api/memory/entities/:id       # Get entity details
GET  /api/memory/search?q=...       # Search memory
GET  /api/memory/daily              # List daily summaries
GET  /api/memory/daily/:date        # Get specific summary

# Settings
GET  /api/settings                  # Get all settings
PUT  /api/settings/preferences      # Update preferences
POST /api/settings/channels/:id/connect     # Connect channel
POST /api/settings/channels/:id/disconnect  # Disconnect channel
```

### Agent-Built

M5 is designed to be built by the agent after M4a unlocks self-development:

1. Agent receives task: "Implement operations dashboard per design/operations-dashboard.md"
2. Agent reads the spec, creates project folder
3. Agent plans implementation, requests review
4. User approves plan
5. Agent implements, tests, requests final review
6. User approves, agent completes

Human review remains required for production changes.

---

_Design specification created: 2026-02-14_
