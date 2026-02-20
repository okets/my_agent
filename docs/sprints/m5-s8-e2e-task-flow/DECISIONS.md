# Decisions Log — Sprint M5-S8: E2E Task Flow

> **Sprint:** [plan](plan.md)
> **Started:** 2026-02-20
> **Tech Lead:** Opus

---

## Summary

| Severity | Count | Flagged for Review |
|----------|-------|-------------------|
| Major | 0 | 0 |
| Medium | 1 | 0 |
| Minor | 0 | 0 |

---

## Decisions

## Decision: Skill content loading approach

**Timestamp:** 2026-02-20T22:30:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
Plan specified fixing skill loading so `task-api.md` is recognized. However, just adding it to the "Available Commands" list (one-liner) isn't enough — the brain needs the full API documentation to know HOW to call the task API.

**Options Considered:**
1. **Option A — Command list only** — Add task-api.md to Available Commands
   - Pros: Simpler, matches existing pattern
   - Cons: Brain doesn't get API documentation, can't actually create tasks

2. **Option B — Full content loading** — Load task-api.md full content into system prompt
   - Pros: Brain has complete API documentation
   - Cons: Adds ~2k chars to system prompt

**Decision:** Option B

**Rationale:**
The purpose of task-api.md is to teach the brain how to use the REST API. A one-liner command reference doesn't provide the endpoint documentation, example requests, or usage guidelines. The brain MUST have this information to successfully create tasks.

**Risk:**
Slightly larger system prompt. Mitigated by keeping skill content files to a minimum (only task-api.md for now).

**Reversibility:** Easy

---
