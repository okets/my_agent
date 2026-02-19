# Decisions Log — Sprint M4.5-S3: API Discovery + CalendarScheduler

> **Sprint:** [plan.md](plan.md)
> **Started:** 2026-02-19
> **Tech Lead:** Claude Opus (Overnight Mode)

---

## Summary

| Severity | Count | Flagged for Review |
|----------|-------|-------------------|
| Major | 0 | 0 |
| Medium | 1 | 1 |
| Minor | 0 | 0 |

---

## Decisions

## Decision: Skip MCP Tools, Use REST API Discovery

**Timestamp:** 2026-02-19T00:00:00Z
**Severity:** Medium
**Flagged:** Yes

**Context:**
Original S3 plan included MCP tools for calendar operations. During planning, discovered that the REST API already has full CRUD. MCP tools would duplicate this.

**Options Considered:**
1. **Create MCP tools** — Type-safe, native SDK integration
   - Pros: Clean tool_use blocks, no string interpolation
   - Cons: Duplicates REST API logic, maintenance overhead
2. **Skip MCP, add API discovery** — Document REST API for agents
   - Pros: Single implementation, no duplication
   - Cons: Agents use curl (slightly verbose)

**Decision:** Option 2 — Skip MCP tools, add `/api/debug/api-spec` for discovery

**Rationale:**
- REST API already complete and tested
- API discovery endpoint enables agents to learn what's available
- Calendar context can include Quick Actions for guidance
- MCP tools can be added later if needed

**Risk:**
Agents may find curl commands verbose. Mitigated by good SKILL.md documentation.

**Reversibility:** Easy — MCP tools can be added later without breaking REST API

---
