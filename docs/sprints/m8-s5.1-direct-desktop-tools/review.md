# Sprint M8-S5.1 Review: Direct Desktop Tools

> **Reviewer:** Claude Opus 4.6 (self-review, trip sprint)
> **Date:** 2026-04-02
> **Verdict:** PASS

## Summary

Course correction on M8-S5. Replaced desktop subagent (`AgentComputerUseService`) with direct MCP tools registered on the shared pool, matching the Playwright pattern. Both Conversation Nina and Working Nina use `desktop_click`, `desktop_screenshot`, etc. directly.

## Plan Adherence

| Task | Planned | Delivered | Notes |
|------|---------|-----------|-------|
| desktop-action-server.ts | 6 tools | Done | screenshot, click, type, key, scroll, wait |
| Wire + clean up | Remove subagent | Done | -715 lines deleted, +277 added (net simplification) |
| Skill update | Direct tool guidance | Done | Screenshot sharing via markdown |
| E2E (Conversation) | Dashboard chat test | Passed | Nina uses direct tools, screenshot inline |
| MCP factory fix | Not planned | Added | Concurrent session support |
| E2E (Working Nina) | Not planned | CTO verified | One-off job with desktop screenshot works |

## Decisions Made

1 decision logged (direct MCP tools instead of subagent). 0 flagged.

## Deviations

1 deviation: MCP server factory pattern (addition). Kept — systemic fix for concurrent in-process MCP servers.

## Code Quality

- Security: No regressions, rate limiter + audit logger still active per-action
- Architecture: Clean — follows Playwright precedent exactly
- Readability: `desktop-action-server.ts` is self-contained, 234 lines

## Net Impact

| Metric | Before (S5) | After (S5.1) |
|--------|-------------|--------------|
| Subprocess per desktop interaction | 1 (Agent SDK) | 0 |
| MCP tools exposed to brain | 3 (task, screenshot, info) | 7 (screenshot, click, type, key, scroll, wait, info) |
| Lines of code | 715 (agent service + handlers) | 277 (action server) |
| Working Nina support | Broken (transport conflict) | Working (factory pattern) |

## Recommendation

Merge to master. Both Ninas verified working with direct desktop tools.
