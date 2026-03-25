# M7-S6.5: Repairs + Polish -- External Review

**Reviewer:** Claude Opus 4.6 (External)
**Date:** 2026-03-25
**Branch:** `sprint/m7-s6.5-repairs`
**Base:** `master`
**Verdict:** PASS WITH CONCERNS

---

## Plan Coverage

All 9 tasks from the plan have corresponding commits. Every step within each task was completed.

| Task | Plan | Commit | Status |
|------|------|--------|--------|
| 1. Wire `openTimelineItem()` | Define method, route by itemType | `5077881` | Done |
| 2. Drop `delivery` field | Remove types, DB, MCP, manager | `262120b` | Done |
| 3. Desktop Home 2x2 grid | Wrap widgets in CSS grid | `a181d37` | Done |
| 4. Unify chat tag injection | `activeViewContext` replaces two fields | `36256e8` | Done |
| 5. Dead code sweep | Remove task-server, taskId ref, stubs | `30d7d75` | Done |
| 6. Referenced automations on space detail | API query + UI list | `08db79f` | Done |
| 7. Space property view polish | Editable name, runtime dropdown, run button, maintenance rules | `f455087` | Done |
| 8. `parseFrontmatterContent` extraction | Core utility, SpaceSyncService updated | `bda2afb` | Done |
| 9. Timeline polish | One-off badge, spinner, blue dots | `5178f7e` | Done |
| -- | Test fixes for delivery removal | `8b8d48f` | Done |

10 commits total (9 tasks + 1 test fix). Clean commit history with conventional commit messages.

---

## CTO Override Verification: Task 7 Step 3 (Run Button)

The CTO instructed: inject "Run {spaceName}" into chat instead of using `browser prompt()`.

**Implementation in `app.js`:**

```javascript
runToolSpace(spaceName) {
  this.sendMessage(`Run ${spaceName}`);
},
```

This correctly sends a chat message instead of using `prompt()`. The plan originally specified `prompt('Input JSON...')` but the CTO override was applied. The implementation is clean -- no leftover `prompt()` call.

**Verdict:** CTO override correctly implemented.

---

## Code Quality Assessment

### What was done well

- Clean separation of concerns: types removed from core, DB, MCP, and manager in coordinated fashion
- Generic `activeViewContext` replaces two specific fields with proper type union
- `parseFrontmatterContent` extracted to a reusable core utility with proper generics and documentation
- Test files updated to match interface changes (delivery removed from tests)
- Timeline items correctly wire `automationId` and `isOneOff` from parent automation data

### Important Issues

**1. SQL injection risk in spaces route (Important)**

File: `/home/nina/my_agent/packages/dashboard/src/routes/spaces.ts`, line 87

```typescript
referencingAutomations = db.prepare(
  `SELECT id, name, status FROM automations WHERE spaces LIKE ?`
).all(`%"${name}"%`) as ...;
```

The `name` parameter comes from `request.params` and is interpolated into the LIKE pattern string. While this uses a parameterized query (the `?`), the `name` is embedded inside the string passed to `?`, not as a separate parameter binding. If a space name contained a `"` character, it could break the LIKE pattern. In practice, space names are filesystem directory names which limits the risk, but this should use proper escaping or a JSON-aware query.

**2. Vestigial `taskId` in WebSocket context type (Suggestion)**

File: `/home/nina/my_agent/packages/dashboard/src/ws/chat-handler.ts`, line 291

The `taskId` field remains in the context type definition. The chat-service no longer handles task context, and `app.js` no longer sends `taskId`. This is dead weight. Not a functional problem since it is optional, but it should be cleaned up.

**3. Vestigial `taskId` in chat types (Suggestion)**

File: `/home/nina/my_agent/packages/dashboard/src/chat/types.ts`, line 57

Same issue -- `taskId?: string` remains in `ChatMessageOptions.context`.

### Remaining `delivery` References (Not in scope)

The `delivery` field was correctly removed from `automation-types.ts`, `automation-manager.ts`, `automation-server.ts`, `automation-executor.ts`, `db.ts`, and `automations.ts` route. Remaining `delivery` references exist in:

- `packages/core/src/tasks/types.ts` -- old task system types (separate cleanup)
- `packages/dashboard/src/automations/automation-extractor.ts` -- uses `DeliveryAction` from task types, not automation types. Different concept.
- `packages/dashboard/src/automations/deliverable-utils.ts` -- English word "delivery" in comments
- Test files -- legitimate test coverage for the extractor

These are correctly out of scope for this sprint.

---

## Deferred Follow-ups (Noted, Not Blocking)

**`conversation-role.md` still references dead task tools.** As stated in the review instructions, this was intentionally deferred. The file at `/home/nina/my_agent/packages/core/skills/conversation-role.md` contains references to `create_task` and `revise_task` on lines 5, 27, 34, 37, and 47. These tools no longer exist. This should be addressed in a future sprint to avoid confusing the brain when this skill is loaded.

---

## Architecture Assessment

- The `activeViewContext` unification follows the Open/Closed principle -- new view types can be added without modifying the system-prompt-builder or session-manager code
- The `parseFrontmatterContent` extraction follows DRY properly by creating one utility in core instead of duplicating across packages
- The 2x2 grid uses Tailwind's responsive grid which is the correct approach for the existing tech stack
- The referencing automations feature correctly uses the existing DB rather than introducing new infrastructure

---

## Recommendation

**PASS WITH CONCERNS.** All 9 planned tasks are complete and correctly implemented. The CTO override was applied properly. Builds pass, tests pass, dead code was removed.

The SQL pattern interpolation in the spaces route (Issue 1) should be addressed but is low risk given space names come from filesystem paths. The vestigial `taskId` fields (Issues 2-3) are cosmetic. Neither blocks merging.

Suggested follow-up items for the next sprint:
1. Sanitize space name in LIKE query or use a JSON-aware SQLite query
2. Remove `taskId` from `chat-handler.ts` and `chat/types.ts` context types
3. Update `conversation-role.md` to remove dead `create_task`/`revise_task` references
