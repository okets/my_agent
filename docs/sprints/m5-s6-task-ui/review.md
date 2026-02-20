# M5-S6: Task UI — Review

> **Verdict:** PASS
> **Reviewed:** 2026-02-20

---

## Summary

Task UI sprint delivered all planned components. User testing revealed three bugs which were fixed before completion.

## Deliverables

| Deliverable | Status | Notes |
|-------------|--------|-------|
| Task List Screen | ✓ | Filters by status/type, sort by date |
| Task Detail Tab | ✓ | Matches Event tab patterns |
| Shared Components | ✓ | `components.js` — StatusBadge, TypeBadge, etc. |
| Entity Tags in Chat | ✓ | Shows context tags for active task |
| Create Task Form | ✓ | Manual creation with validation |

## Bugs Found & Fixed

### 1. Duplicate Entity Tags

**Issue:** Entity context tags appeared twice above the chat input — once in the action bar (existing), once in a new location (added by mistake).

**Fix:** Removed duplicate code block (30 lines at lines 2235-2265 in index.html).

### 2. Auto-linking on Manual Task Creation

**Issue:** Tasks created via UI were auto-linked to the current conversation. Design intent: only brain-created tasks or explicit user actions should create links.

**Fix:** Removed `if (this.currentConversationId)` block in `createTask()` method. Manual tasks now create without conversation links.

### 3. Linked Conversations Showing Truncated IDs

**Issue:** Linked conversations displayed as `conv-01KHXAD...` instead of conversation titles. Not clickable.

**Fix:**
- Updated `GET /api/tasks/:id/conversations` to enrich with conversation titles
- Updated template to use clickable buttons with proper titles
- Clicking now switches to that conversation

## Files Changed

| File | Change |
|------|--------|
| `packages/dashboard/public/index.html` | Task list, detail tab, create form, entity tags |
| `packages/dashboard/public/js/app.js` | Task state, methods, filtering |
| `packages/dashboard/public/js/components.js` | NEW: Shared UI components |
| `packages/dashboard/src/routes/tasks.ts` | Enrich conversations with titles |

## Success Criteria

- [x] Task list shows all non-deleted tasks
- [x] Filters work (status, type)
- [x] Task detail tab opens on click
- [x] Linked conversations display correctly (with titles, clickable)
- [x] Complete/Delete actions work
- [x] Create task form works
- [x] Entity tags appear in chat when task tab open
- [x] Shared components used by both Task and Event tabs

## User Stories for Testing

### View Tasks
1. Open dashboard → Click "Tasks" in sidebar
2. Task list shows with status badges and titles
3. Use filter dropdowns to filter by status/type
4. Click a task → detail tab opens on right

### Create Task
1. Click "New Task" button
2. Fill title and instructions → Create button enables
3. Select type (immediate/scheduled)
4. If scheduled, pick date/time
5. Click Create → task appears in list

### Task Detail
1. Open any task
2. View metadata (created date, type, source)
3. See linked conversations (if any) with titles
4. Click conversation link → switches to that chat
5. Use Complete/Delete actions

### Entity Context
1. Open a task detail tab
2. Look at chat input area
3. Entity tag shows: "📋 Task: [title]"
4. Click × on tag → tag removed

---

*Reviewed: 2026-02-20*
