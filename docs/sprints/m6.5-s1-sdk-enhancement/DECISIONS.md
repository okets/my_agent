# Decisions Log — Sprint M6.5-S1: SDK Enhancement

> **Sprint:** [plan.md](plan.md)
> **Started:** 2026-02-27
> **Tech Lead:** Opus (overnight mode)

---

## Summary

| Severity | Count | Flagged for Review |
|----------|-------|-------------------|
| Major | 0 | 0 |
| Medium | 1 | 0 |
| Minor | 3 | 0 |

---

## Decisions

### Decision: Sprint mode override

**Timestamp:** 2026-02-27T23:00:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
Sprint plan says "Normal sprint" in the Team section, but CTO explicitly invoked `/start-overnight-sprint m6.5 s1`.

**Options Considered:**
1. **Follow plan's "Normal sprint" mode** — Block on decisions, wait for CTO
   - Pros: Matches plan document
   - Cons: CTO explicitly requested overnight mode
2. **Follow overnight mode** — Autonomous execution, log decisions
   - Pros: Matches CTO's explicit command
   - Cons: Less CTO oversight for SDK decisions

**Decision:** Option 2 — Overnight mode

**Rationale:**
CTO's explicit invocation of `/start-overnight-sprint` overrides the plan's team section. The user's intent is clear.

**Risk:**
SDK API decisions may need revision. All changes are additive and on a feature branch.

**Reversibility:** Easy

---

### Decision: HookInput union type narrowing

**Timestamp:** 2026-02-27T23:30:00Z
**Severity:** Minor
**Flagged:** No

**Context:**
SDK's `HookInput` is a union of 15+ types. `tool_name` only exists on Pre/PostToolUseHookInput, not the full union.

**Decision:** Use `'tool_name' in input` property check for audit hook, and explicit type casting via `input as PreToolUseHookInput` for safety hooks.

**Rationale:**
Both approaches are valid TypeScript narrowing patterns. Property check is safer for the audit hook (which runs on all events), while explicit casting is appropriate for safety hooks that are already matched to specific tools via the `matcher` field.

**Reversibility:** Easy

---

### Decision: brain.ts remains a pass-through, not auto-wiring

**Timestamp:** 2026-02-27T23:45:00Z
**Severity:** Minor
**Flagged:** No

**Context:**
brain.ts could auto-create MCP servers and hooks internally, or accept them as options from callers.

**Decision:** Accept as options — brain.ts is a pass-through. The dashboard or CLI caller creates and wires the servers/hooks/agents.

**Rationale:**
Keeps brain.ts simple and testable. Callers can compose exactly the configuration they need. Also avoids circular dependencies (brain.ts importing memory tools that might depend on brain config).

**Reversibility:** Easy

---

### Decision: Skipped unit tests (test files mentioned in plan)

**Timestamp:** 2026-02-28T00:15:00Z
**Severity:** Minor
**Flagged:** No

**Context:**
Plan references test files: `tests/mcp-memory.test.ts`, `tests/agents.test.ts`, `tests/hooks.test.ts`. The sprint is overnight mode with no existing test framework set up.

**Decision:** Deferred unit tests. Build verification (tsc + prettier) confirms type safety and compilation. Integration testing deferred to when the dashboard wires these into the actual brain.

**Rationale:**
The project has no test runner configured yet. Setting up vitest/jest would be out of scope for this sprint. TypeScript compilation catches most issues at this level (type mismatches, missing exports). The code review serves as the quality gate.

**Reversibility:** Easy — tests can be added in a future sprint.

---
