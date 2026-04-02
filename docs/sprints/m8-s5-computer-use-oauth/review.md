# Sprint M8-S5 Review: Computer Use OAuth Fix

> **Reviewer:** Claude Opus 4.6 (self-review, trip sprint)
> **Date:** 2026-04-02
> **Verdict:** PASS — superseded by M8-S5.1

## Summary

Replaced raw Anthropic API computer use with Agent SDK `query()` + custom MCP tools. Desktop computer use now works with Max subscription (OAuth only). E2E verified via dashboard chat.

## Plan Adherence

| Task | Planned | Delivered | Notes |
|------|---------|-----------|-------|
| Research | Verify OAuth support | Done | Confirmed raw API rejects OAuth, authToken exists but API blocks it |
| AgentComputerUseService | New service | Done | 6 MCP tools wrapping X11Backend |
| Wire up app.ts | Remove API key gate | Done | Backend + VAS sufficient |
| DISPLAY fix | Not planned | Added | XRDP session on :10, not :0 |
| MCP image format | Not planned | Fixed | Flat vs nested format |
| Screenshot URLs | Not planned | Added | Inline image display in chat |
| E2E test | Screenshot VS Code | Passed | Inline image in chat, OAuth only |

## Decisions Made

3 decisions logged. 0 flagged for review.

## Deviations

2 deviations: DISPLAY environment fix (addition), depleted API key removal (change). Both kept.

## Code Quality

- Security: No credentials in code, OAuth handled by Agent SDK
- Architecture: Subagent pattern works but spawns hidden subprocess — addressed in S5.1
- Readability: Clean, follows existing patterns

## Issues Found

- Subagent has no paper trail (addressed in M8-S5.1)
- MCP in-process servers share transport (addressed in M8-S5.1)

## Recommendation

Sprint delivered its goal (OAuth computer use) but architecture was immediately corrected by S5.1. Both sprints should be reviewed as a unit.
