# M5-S9: Work + Deliverable Architecture — Review

> **Milestone:** M5 — Task System
> **Sprint:** S9 of 10
> **Status:** Complete
> **Date:** 2026-02-22

---

## Summary

Sprint S9 delivered the Work + Deliverable architecture for clean task delivery, plus two significant bonus features: unified homepage timeline and bidirectional Task↔Calendar linking.

## Planned vs Delivered

### Planned (from plan.md)

| Item | Status |
|------|--------|
| Typed `WorkItem` + `DeliveryAction` interfaces | ✅ Complete |
| Task extractor with `work[]` + `delivery[]` | ✅ Complete |
| Brain template with `<deliverable>` XML tags | ✅ Complete |
| `extractDeliverable()` + `validateDeliverable()` | ✅ Complete |
| DeliveryExecutor (replaces StepExecutor) | ✅ Complete |
| Pre-composed content skips brain | ✅ Complete |
| `needs_review` status for validation failures | ✅ Complete |
| Clean WhatsApp delivery (no metadata) | ✅ Complete |

### Bonus (not in original plan)

| Item | Status |
|------|--------|
| Unified homepage timeline (Active Now + Timeline) | ✅ Complete |
| Past 24h visibility in timeline | ✅ Complete |
| Bidirectional Task↔Calendar linking | ✅ Complete |
| Design spec for full Navigable Timeline (S10) | ✅ Complete |
| Reset test data script fix (user calendar only) | ✅ Complete |

## Success Criteria Check

| Criterion | Result |
|-----------|--------|
| Task model uses typed `work[]` + `delivery[]` | ✅ Pass |
| Brain produces deliverable in `<deliverable>` tags | ✅ Pass |
| Only validated deliverable sent to channels | ✅ Pass |
| Pre-composed content skips brain | ✅ Pass |
| `needs_review` status on validation failure | ✅ Pass |
| Exactly 1 WhatsApp message per delivery (no dupes) | ✅ Pass |
| WhatsApp message is clean (no markers) | ✅ Pass |
| Full work output in conversation + dashboard | ✅ Pass |

## Files Changed

### Core Types
- `packages/core/src/tasks/types.ts` — Added `WorkItem`, `DeliveryAction`, `needs_review` status
- `packages/core/src/lib.ts` — Exported new types

### Task System
- `packages/dashboard/src/tasks/task-extractor.ts` — New extraction with `work[]`/`delivery[]`
- `packages/dashboard/src/tasks/task-executor.ts` — Brain template + deliverable extraction
- `packages/dashboard/src/tasks/delivery-executor.ts` — **NEW** (replaced step-executor.ts)
- `packages/dashboard/src/tasks/task-processor.ts` — Uses DeliveryExecutor
- `packages/dashboard/src/tasks/task-manager.ts` — JSON columns, `sourceRef` update support

### Homepage & Calendar
- `packages/dashboard/public/index.html` — Unified timeline, Active Now section
- `packages/dashboard/public/js/app.js` — `timelineItems` getter, past 24h support
- `packages/dashboard/public/js/calendar.js` — Event fetching for timeline
- `packages/dashboard/src/ws/chat-handler.ts` — Task↔Calendar bidirectional linking
- `packages/dashboard/src/scheduler/event-handler.ts` — Check `taskId` before creating

### Testing
- `packages/dashboard/tests/reset-test-data.ts` — Fixed to only clear user calendar
- `packages/dashboard/tests/test-scheduled-time.ts` — **NEW** — scheduling tests

### Documentation
- `docs/design/homepage-unified-timeline.md` — **NEW** — Quick fix design
- `docs/design/navigable-timeline.md` — **NEW** — Full redesign spec for S10
- `docs/ROADMAP.md` — Updated S9 deliverables, added S10

## Key Decisions

1. **Work vs Deliverable separation** — Brain output stays internal; only validated `<deliverable>` content reaches channels. Prevents task metadata leaking to users.

2. **Unified Timeline over dual-view** — Replaced TASKS + UPCOMING sections with single Timeline showing past (completed) + future (scheduled). Eliminates confusion from duplicate display.

3. **Task as source of truth** — CalendarEvent is just a view/projection. Task.sourceRef ↔ CalendarEvent.taskId provides bidirectional linking.

4. **Navigable Timeline deferred to S10** — Quick fix (past 24h) implemented in S9. Full hero timeline with infinite scroll, expansion, search planned for dedicated sprint.

## Risks Encountered

| Risk | Outcome |
|------|---------|
| Brain not producing `<deliverable>` tags | Not encountered — prompt engineering worked |
| Duplicate task creation from calendar | Fixed — check `event.taskId` before creating |
| Timeline showing duplicates (task + event) | Fixed — unified view eliminates duplication |

## Commits

```
fdef040 M5-S9: Unified Timeline + bidirectional Task↔Calendar linking
aceb8c3 Add reset-test-data script for clearing conversations, tasks, and calendar
7191d9e M5-S9: Work + Deliverable architecture for clean task delivery
5765feb M5-S9: E2E task flow with deterministic extraction and WhatsApp delivery
b681c06 M5-S9: Task Steps — design, plan, and partial implementation
```

## Next Sprint (S10)

**Navigable Timeline** — Full redesign with:
- Hero timeline (70% homepage)
- Infinite scroll (past + future)
- Inline expansion for task details
- Search and filters
- Keyboard navigation

Design spec: [docs/design/navigable-timeline.md](../../design/navigable-timeline.md)

---

*Completed: 2026-02-22*
