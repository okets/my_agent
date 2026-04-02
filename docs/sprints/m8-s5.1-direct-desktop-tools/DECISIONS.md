# Decisions: M8-S5.1 Direct Desktop Tools

## Decision: Direct MCP tools instead of subagent

**Timestamp:** 2026-04-02T15:45:00Z
**Severity:** Major (course correction)
**Context:** M8-S5 spawned a hidden Agent SDK subagent for desktop_task. CTO ruled: "if an agent does work, it should leave a paper trail." Adversary agent debate concluded both advocates converging on direct tools.

**Decision:** Promote desktop actions to direct MCP tools on the shared pool (like Playwright). Remove the subagent entirely.

**Rationale:** Playwright already establishes the pattern — both Ninas get browser tools directly. Desktop tools should work the same way. No subagent means no hidden work, and Working Ninas already have paper trails via the job system.

**Reversibility:** Easy — the subagent code is in git history if needed.
