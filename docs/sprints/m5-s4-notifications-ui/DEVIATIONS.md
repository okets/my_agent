# Deviations Log — Sprint M5-S4: Notifications UI

> **Sprint:** [plan.md](plan.md)
> **Started:** 2026-02-20

---

## Summary

| Type | Count | Recommendation |
|------|-------|----------------|
| Additions | 0 | — |
| Removals | 1 | Accept |
| Changes | 1 | Accept |
| Dependencies | 0 | — |

**Overall Assessment:** Scope reduced for MVP, core value delivered

---

## Deviations

### DEV-1: Comms MCP Server → NotificationService

**Type:** Change

**Plan said:** Create MCP server at packages/core/src/comms/ with tools

**Actual:** Created NotificationService class with equivalent API, no MCP wrapping

**Impact:** Same functionality, different integration mechanism. MCP can be added later.

**Recommendation:** Accept. See DECISIONS.md D1.

---

### DEV-2: request_input timeout deferred

**Type:** Removal (partial)

**Plan said:** request_input with 30-minute timeout, blocking

**Actual:** request_input fires notification, doesn't block, no automatic timeout

**Impact:** User must respond manually. No automatic cleanup of stale requests.

**Recommendation:** Accept for MVP. See DECISIONS.md D2.

---
