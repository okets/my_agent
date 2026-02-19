# Decisions Log — Sprint M4.5-S4: Event Dispatch

> **Sprint:** [plan.md](plan.md)
> **Started:** 2026-02-19
> **Tech Lead:** Claude Opus (Overnight Mode)

---

## Summary

| Severity | Count | Flagged for Review |
|----------|-------|-------------------|
| Major | 0 | 0 |
| Medium | 0 | 0 |
| Minor | 1 | 0 |

---

## Decisions

### Decision: Single Scheduler Conversation

**Timestamp:** 2026-02-19T02:18:00Z
**Severity:** Minor
**Flagged:** No

**Context:**
Plan suggested using a consistent conversation ID for scheduler events. Needed to decide how to manage this.

**Options Considered:**
1. **Fixed conversation ID** — Always use "scheduler-events"
   - Pro: Predictable, easy to find
   - Con: Doesn't work well with existing ConversationManager (uses ULID)

2. **Find by title** — Look for "Scheduled Events" in system channel
   - Pro: Works with existing system
   - Con: Slightly slower (list + filter)

**Decision:** Option 2 — Find existing conversation by title, create if not found

**Rationale:**
- Works naturally with ConversationManager's ULID-based IDs
- Conversation is created on first event, then reused
- Title-based lookup is fast enough (single channel filter)

**Risk:** None

---
