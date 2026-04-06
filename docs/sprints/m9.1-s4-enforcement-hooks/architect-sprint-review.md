# M9.1-S4 Architect Sprint Review

> **Reviewer:** CTO + Claude Code (architects)
> **Date:** 2026-04-06
> **Verdict:** FAIL — critical production bug, fix before S5

---

## Summary

Hook logic is correct. Trust levels are right. Tests are thorough (33 new tests). The Stop hook gracefully handles edge cases. The fix commit (`9e211b3`) addressing the resume path gap shows good attention to review feedback.

But the most important hook — source code protection — **doesn't work in production**.

---

## Critical: Source Code Protection Bypassed in Production

`createSourceCodeProtection()` falls back to `process.cwd()` when `projectRoot` is not provided. Neither call site passes it:

- `session-manager.ts` line 271: `createHooks("brain", { agentDir })` — no `projectRoot`
- `app.ts` line 1244: `createHooks("task", { agentDir })` — no `projectRoot`

The dashboard runs with `WorkingDirectory=/home/nina/my_agent/packages/dashboard` (systemd). So `process.cwd()` = `/home/nina/my_agent/packages/dashboard`.

When Nina writes to `packages/core/src/brain.ts`:
```
path.relative('/home/nina/my_agent/packages/dashboard', '/home/nina/my_agent/packages/core/src/brain.ts')
→ '../core/src/brain.ts'
→ starts with '..' → hook returns {} (allows write)
```

Every protected path resolves to `../` from the dashboard's cwd. The hook allows all writes.

**Tests didn't catch it** because they pass `projectRoot: '/home/nina/my_agent'` explicitly. Production never does.

### Fix required

Pass `projectRoot` at both call sites. Consider making `projectRoot` mandatory in `HookFactoryOptions` to prevent this class of error.

---

## Important: Two additional fixes needed

### 1. `buildJobHooks` overwrites Stop hooks instead of merging

`automation-executor.ts` lines 84-91:
```typescript
Stop: [{ hooks: [createStopReminder(todoPath)] }]
```

This replaces any existing Stop hooks. Should merge:
```typescript
Stop: [...(this.config.hooks?.Stop ?? []), { hooks: [createStopReminder(todoPath)] }]
```

Not a bug today (no other Stop hooks exist), but will silently break when someone adds one.

### 2. Factory JSDoc is stale

`factory.ts` lines 1-12 still document the pre-S4 trust model (brain = audit only). Update to match the current trust model table from the design spec.

---

## What passed

- Source code protection pattern matching: correct (when projectRoot is provided)
- Capability routing: brain-only, correct patterns, task/subagent not blocked
- Stop hook: reads todos.json, reminds about incomplete mandatory items, handles missing file gracefully, treats blocked items as acceptable
- Trust model wiring in factory: correct structure
- Acceptance tests: 11 tests verify trust-level matrix
- No regressions in existing hooks (bash blocker, infrastructure guard, path restrictor)
- Fix commit for resume path + undefined hooks: good catch

---

## Action items for developer

| # | Priority | Fix | File |
|---|----------|-----|------|
| 1 | **Critical** | Pass `projectRoot` to `createHooks()` at both call sites | `session-manager.ts`, `app.ts` |
| 2 | **Critical** | Add a production-path test that uses dashboard cwd, not project root | `enforcement-acceptance.test.ts` |
| 3 | Important | Merge existing Stop hooks instead of overwriting | `automation-executor.ts` |
| 4 | Important | Update factory JSDoc to current trust model | `factory.ts` |

Items 1-2 are blocking. The hook must work in production before we proceed. Items 3-4 are important but not blocking.

---

## Recommendation

Fix all 4 items, then re-run the acceptance test suite with a test case that simulates production cwd. Once the source code protection hook blocks writes from a `packages/dashboard/` working directory, S4 is approved.
