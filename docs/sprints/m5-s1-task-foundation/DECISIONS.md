# Decisions Log — Sprint M5-S1: Task Foundation

> **Sprint:** [plan.md](plan.md)
> **Started:** 2026-02-20
> **Tech Lead:** Claude Opus (overnight mode)

---

## Summary

| Severity | Count | Flagged for Review |
|----------|-------|-------------------|
| Major | 0 | 0 |
| Medium | 1 | 0 |
| Minor | 0 | 0 |

---

## Decisions

## Decision: Database layer stays in dashboard package

**Timestamp:** 2026-02-20T00:15:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
Sprint plan suggests putting database code in `packages/core/src/db/`, but existing ConversationDatabase is in `packages/dashboard/src/conversations/db.ts`. Need to decide where task database code lives.

**Options Considered:**
1. **Move database to core** — Would require refactoring dashboard imports
   - Pros: Clean separation, core becomes reusable
   - Cons: Significant refactoring mid-sprint, risk of breaking changes
2. **Keep database in dashboard, extend existing DB class** — Add tasks table to existing ConversationDatabase
   - Pros: Minimal changes, faster implementation
   - Cons: Dashboard dependency for task infrastructure

**Decision:** Option 2 — Extend existing ConversationDatabase

**Rationale:**
- Overnight sprint should minimize risk
- Both tasks and conversations share the same database file (agent.db)
- ConversationDatabase already handles initialization, migrations, WAL mode
- Can refactor to core in a future sprint if needed

**Risk:**
Database code remains coupled to dashboard package. Future milestones may need to extract this.

**Reversibility:** Easy — can refactor to core later

---

