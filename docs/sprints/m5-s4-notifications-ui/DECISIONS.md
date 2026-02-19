# Decisions Log — Sprint M5-S4: Notifications UI

> **Sprint:** [plan.md](plan.md)
> **Started:** 2026-02-20
> **Tech Lead:** Claude Opus (overnight mode)

---

## Summary

| Severity | Count | Flagged for Review |
|----------|-------|-------------------|
| Major | 1 | 1 |
| Medium | 1 | 0 |
| Minor | 0 | 0 |

---

## Decisions

### D1: NotificationService instead of Comms MCP Server

**Severity:** Major | **Flagged:** Yes

**Context:** Plan calls for a "Comms MCP server" with notify/request_input/escalate tools. MCP servers are separate processes that need to be spawned and managed.

**Decision:** Implement NotificationService class (not MCP) that:
- Provides same API: notify(), requestInput(), escalate()
- Runs in-process within dashboard server
- Delivers via WebSocket to dashboard
- Can be easily wrapped as MCP server in future sprint

**Rationale:**
1. MCP server setup adds complexity (process management, IPC)
2. Core functionality (notification routing + dashboard delivery) is what matters
3. Agent SDK brain queries don't currently use MCP tool calls
4. In-process service is simpler to test and debug
5. API remains identical — can wrap as MCP later without changes

**Risks:**
- Doesn't match plan exactly
- MCP integration deferred

**Recommendation:** Accept this deviation. The core value (notifications + dashboard UI) is delivered. MCP wrapping can be a follow-up task.

---

### D2: Skip timeout-based request_input for MVP

**Severity:** Medium | **Flagged:** No

**Context:** Plan shows request_input with timeout (30 minutes). This requires:
- Persistent storage of pending requests
- Background timeout checking
- State cleanup on timeout

**Decision:** Implement request_input without automatic timeout for MVP:
- Pending requests stored in memory
- User responds via dashboard when ready
- No automatic expiration
- Task executor doesn't block (fires notification, continues)

**Rationale:**
1. Timeout handling adds complexity
2. Real-time blocking in task executor is problematic (what does the task do while waiting?)
3. Async notification + user response is cleaner model
4. Can add timeout in future with minimal API changes

**Risks:**
- Pending requests could accumulate if user doesn't respond
- Differs from blocking request_input in plan

**Recommendation:** Accept for MVP. Add timeout + persistence in future sprint if needed.

---
