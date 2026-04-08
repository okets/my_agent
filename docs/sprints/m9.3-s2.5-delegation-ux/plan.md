# M9.3-S2.5: Delegation UX — Sprint Plan

**Goal:** Make delegation fast and visible. Auto-fire ad-hoc automations, optimize hook messaging, add live progress bar for delegated tasks.

**Branch:** `sprint/m9.3-s2.5-delegation-ux`
**Source plan:** `docs/plans/2026-04-07-m9.3-delegation-compliance.md` (Tasks 6.1-6.5)

---

## Tasks

| # | Name | Owner | Depends On | Files |
|---|------|-------|------------|-------|
| 6.1 | Optimize budget hook message | backend-dev | — | `packages/core/src/hooks/delegation.ts`, `packages/core/tests/delegation-hook.test.ts` |
| 6.2 | Auto-fire once:true manual automations | backend-dev | — | `packages/dashboard/src/mcp/automation-server.ts`, tests |
| 6.3 | Add onProgress callback to todo server | backend-dev | — | `packages/dashboard/src/mcp/todo-server.ts`, tests |
| 6.4 | Wire progress executor → processor → WebSocket | backend-dev | 6.3 | `automation-executor.ts`, `automation-processor.ts`, `state-publisher.ts`, `protocol.ts`, `app.ts` |
| 6.5 | Inline progress bar in chat UI | frontend-dev | 6.4 | `packages/dashboard/public/js/app.js`, `packages/dashboard/public/css/app.css` |

## Success Criteria

- [ ] Budget hook message includes `once: true` and pre-acknowledge instruction
- [ ] `once:true` manual automations fire immediately at creation (no `fire_automation` call needed)
- [ ] Todo server emits progress callbacks on status changes
- [ ] Progress flows from worker → executor → processor → WebSocket → browser
- [ ] Chat UI shows live progress bar for `once:true` delegated tasks
- [ ] Progress bar works on both desktop and mobile (375px)
- [ ] All existing tests pass, no regressions
- [ ] TypeScript compiles clean on both packages

## Design

- Progress bar: accent-blue (`#7aa2f7`) fill on panel (`#292e42`) background
- 4px height, rounded corners
- Text below: muted (`#565f89`), shows "3/5 — Cross-checking sources"
- Smooth width transition (`transition: width 0.3s ease`)
- Fades on completion after 2s
- Only for `once:true` jobs, not recurring automations
