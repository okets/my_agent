# M7-S6.5: Repairs + Polish -- Test Report

**Date:** 2026-03-25
**Branch:** `sprint/m7-s6.5-repairs`

---

## Build Status

| Package | Command | Result |
|---------|---------|--------|
| Core | `npx tsc --noEmit` | PASS (no output) |
| Dashboard | `npx tsc --noEmit` | PASS (no output) |

Both packages compile cleanly with zero type errors.

---

## Test Results

### Core Package

```
Test Files   22 passed | 1 skipped (23)
Tests        226 passed | 7 skipped (233)
Duration     2.65s
```

**Result:** PASS. All 226 tests pass. 7 skipped tests are in `triage-behavioral.test.ts` (pre-existing, unrelated).

### Dashboard Package

```
Test Files   74 passed (74)
Tests        704 passed | 2 skipped (706)
Duration     14.68s
```

**Result:** PASS. All 704 tests pass. 2 skipped tests are pre-existing.

---

## Stale Reference Scan

### `activeTaskContext`

```
Matches: 0
```

CLEAN. Fully removed from session-manager, system-prompt-builder, mock-session.

### `activeAutomationContext`

```
Matches: 0
```

CLEAN. Replaced by `activeViewContext` throughout.

### `task-server`

```
Matches: 0
```

CLEAN. File deleted, exports removed from `mcp/index.ts` and `lib.ts`.

### `delivery` in automation source files

| File | Status |
|------|--------|
| `automation-types.ts` | CLEAN -- `AutomationDeliveryAction` removed, `delivery` field removed |
| `automation-manager.ts` | CLEAN -- all delivery handling removed |
| `automation-server.ts` | CLEAN -- delivery schema and mapping removed |
| `automation-executor.ts` | CLEAN -- deliverable instructions block removed |
| `conversations/db.ts` | CLEAN -- delivery column removed from INSERT, UPDATE, SELECT, and row types |
| `routes/automations.ts` | CLEAN -- delivery removed from API response |

Remaining `delivery` references are in:
- `core/src/tasks/types.ts` -- old task system (separate cleanup scope)
- `automations/automation-extractor.ts` -- uses `DeliveryAction` from task types, different concept
- `automations/deliverable-utils.ts` -- English word in comment
- Test files for extractor -- legitimate

### `taskId` vestigial references

| File | Field | Status |
|------|-------|--------|
| `ws/chat-handler.ts:291` | `taskId?: string` in context type | Vestigial (optional, harmless) |
| `chat/types.ts:57` | `taskId?: string` in ChatMessageOptions | Vestigial (optional, harmless) |
| `app.js` | `taskId: tab.data?.task?.id` | REMOVED in this sprint |

---

## Test Coverage Changes

### Tests updated for delivery removal

- `automation-types.test.ts` -- removed `AutomationDeliveryAction` shape test and delivery from manifest test
- `automation-manager.test.ts` -- removed delivery from round-trip test input and assertion
- `db-schema.test.ts` -- removed delivery from upsert input and read-back assertion

### Tests updated for context unification

- `mock-session.ts` -- removed `taskContext` field and `setTaskContext()` method

### Missing test coverage (not blocking)

- No unit test for `openTimelineItem()` -- this is frontend JS, tested manually
- No unit test for `runToolSpace()` -- frontend JS, sends chat message
- No unit test for `parseFrontmatterContent` in the new core location -- the function is identical to the one that was tested implicitly via SpaceSyncService integration tests
- No test for the referencing automations SQL query -- would require DB fixture setup

---

## Summary

| Category | Status |
|----------|--------|
| Core build | PASS |
| Dashboard build | PASS |
| Core tests (226) | PASS |
| Dashboard tests (704) | PASS |
| Stale reference scan | PASS (minor vestigial `taskId` noted) |
| Test updates for changed interfaces | PASS |

**Overall:** PASS
