# M5-S6: Task UI

> **Milestone:** M5 — Task System
> **Sprint:** S6 of 7
> **Status:** Planned
> **Goal:** Visual interface for viewing and managing tasks

---

## Overview

Add dashboard UI for tasks. Users need to see tasks created by the brain, view task details, and manually create tasks. Shared components between Task and ScheduledTask (Event) tabs reduce code duplication.

## Deliverables

### 1. Task List Screen

Add "Tasks" section to sidebar or main navigation:

- List all tasks (default: exclude deleted)
- Filter by status (pending, running, completed, failed)
- Filter by type (scheduled, immediate)
- Sort by created date (newest first)
- Show status badge, title, created date
- Click to open task detail tab

### 2. Task Detail Tab

Reuse patterns from Event detail tab (`openEventTab`):

| Section              | Content                                        |
| -------------------- | ---------------------------------------------- |
| Header               | Title, status badge, type badge                |
| Metadata             | Created, createdBy, scheduledFor (if any)      |
| Instructions         | Full instructions text                         |
| Status History       | Timeline: created → started → completed/failed |
| Linked Conversations | List from `/api/tasks/:id/conversations`       |
| Actions              | Complete, Delete, Re-run (if failed)           |

### 3. Shared Components

Extract common UI between Task and Event tabs:

```
components/
├── StatusBadge.js      — pending/running/completed/failed/deleted
├── DetailHeader.js     — title + badges
├── MetadataList.js     — key-value pairs with icons
├── ActionButtons.js    — complete/delete/edit buttons
└── ConversationLinks.js — list of linked conversations
```

### 4. Entity Tags in Chat

Show context tags under chat input when viewing a task:

```
┌─────────────────────────────────────┐
│ [📋 Task: Call mom] [×]             │
├─────────────────────────────────────┤
│ Type your message...                │
└─────────────────────────────────────┘
```

- Tag appears when task tab is open
- Clicking × removes the tag (clears ViewContext)
- Multiple tags allowed (task + notebook, etc.)

### 5. Create Task Form

Manual task creation (bypasses brain):

| Field         | Type                        | Required     |
| ------------- | --------------------------- | ------------ |
| Title         | text                        | Yes          |
| Instructions  | textarea                    | Yes          |
| Type          | select: immediate/scheduled | Yes          |
| Scheduled For | datetime                    | If scheduled |

Creates task via `POST /api/tasks` with `createdBy: 'user'`.

## Technical Approach

### Alpine.js Data Model

```javascript
// Add to app data
tasks: [],
tasksLoading: false,
tasksFilter: { status: null, type: null },

// Methods
async loadTasks() { ... },
async openTaskTab(task) { ... },
async createTask(form) { ... },
async completeTask(taskId) { ... },
async deleteTask(taskId) { ... },
```

### WebSocket Events

Listen for task updates:

```javascript
// ws-client.js
case 'task:created':
case 'task:updated':
case 'task:deleted':
  // Refresh task list
  break;
```

### ViewContext Update

Extend ViewContext for tasks:

```typescript
interface ViewContext {
  type: "notebook" | "conversation" | "settings" | "task" | "event";
  taskId?: string;
  // ...
}
```

## Team

| Role         | Model  | Responsibility                       |
| ------------ | ------ | ------------------------------------ |
| Frontend Dev | Sonnet | Alpine.js components, HTML templates |
| Backend Dev  | Sonnet | WebSocket events (if needed)         |
| Reviewer     | Opus   | UI consistency, UX review            |

## Success Criteria

- [ ] Task list shows all non-deleted tasks
- [ ] Filters work (status, type)
- [ ] Task detail tab opens on click
- [ ] Linked conversations display correctly
- [ ] Complete/Delete actions work
- [ ] Create task form works
- [ ] Entity tags appear in chat when task tab open
- [ ] Shared components used by both Task and Event tabs

## Dependencies

- S5: Task REST API (complete)
- M2: Dashboard patterns (complete)

---

_Created: 2026-02-20_
