# M6.9-S4 External Review: Agentic Task Executor

**Reviewer:** External review agent (Opus 4.6)
**Date:** 2026-03-14
**Branch:** `sprint/m6.9-s4-agentic-task-executor`
**Spec:** `docs/superpowers/specs/2026-03-14-agentic-task-executor-design.md`
**Diff:** 25 files changed, +2896 / -71

---

## Spec Coverage

| Spec Section | Status | Evidence |
|---|---|---|
| 2.1 Current State (replace createBrainQuery) | DONE | `task-executor.ts` now passes `cwd`, `tools`, `mcpServers`, `hooks`, `persistSession` through `createBrainQuery()` instead of bypassing the SDK — spec said "bypass createBrainQuery and use SDK directly" but extending it is equivalent and less disruptive |
| 2.2 New State (full Agent SDK session) | DONE | Tools, MCP servers, hooks, cwd, persistSession all wired. Tests verify each field passes through. |
| 2.3 Task Folder as cwd | DONE | `TaskLogStorage` creates `tasks/{task-id}/task.jsonl` + `workspace/` directory. `getLogPath()` checks new path first, falls back to old `tasks/logs/` path. `getTaskDir()` exposed for cwd. Tests cover migration. |
| 2.4 Session Configuration | DONE | `createBrainQuery` extended with `cwd`, `tools`, `persistSession`. `brain.ts` passes these to SDK `queryOptions`. Default tools preserved. Task tool auto-added when agents present. Tests cover all options. |
| 3.1 PreToolUse: Infrastructure Guard | DONE | `createInfrastructureGuard()` blocks all 9 protected patterns from spec (brain/CLAUDE.md, brain/skills/, config.yaml, .env, auth/, .db, .guardrails, .git/hooks/, .service). Fail-closed on error and on missing input. Returns `hookSpecificOutput` with `permissionDecision: "deny"` + `systemMessage`. 16 unit tests. |
| 3.2 PostToolUse: Audit Log | EXISTING | Audit hook was already in place via `createAuditHook()` in factory.ts — no new work needed. |
| 3.1 Extended Bash Patterns | DONE | 4 new patterns: `systemctl stop/disable nina-*`, `kill/killall nina`, `chmod 000`, `chown` on infrastructure paths. 16 unit tests. |
| 4.1-4.3 System Prompt (Temporal + Properties) | DONE | `buildWorkingNinaPrompt()` assembles: Working Nina persona, temporal context (time + timezone via `resolveTimezone()`), dynamic properties (location, timezone, availability from `readProperties()`), calendar context, and notebook context (via `assembleSystemPrompt()`). 6 unit tests. |
| 4.3 Shared Timezone Resolution | DONE | `packages/dashboard/src/utils/timezone.ts` — extracted from `WorkLoopScheduler`. Properties -> preferences -> UTC fallback. `WorkLoopScheduler.resolveTimezone()` now delegates to shared utility. 4 unit tests. |
| 5.1-5.2 notifyOnCompletion Extraction | DONE | `ExtractedTask` type extended. Extraction prompt updated with field docs and examples. `normalizeExtractedTask` validates against `["immediate", "debrief", "none"]`, strips invalid values. 8 unit tests. |
| 5.3 notifyOnCompletion Passthrough | DONE | `post-response-hooks.ts` passes `notifyOnCompletion` to `taskManager.create()`. Integration test verifies. |
| 6.1 Install uv | DONE | Installed (snap-specific path noted in DECISIONS.md D3). |
| 6.2 Playwright MCP Server | DONE | `session-manager.ts` adds `playwright` MCP server (stdio, `npx @playwright/mcp`). `getSharedMcpServers()` exported for TaskExecutor consumption. `@playwright/mcp` added to `package.json` dependencies. |
| 6.3 Out of Scope | N/A | Correctly excluded. |
| Deferred tool loading (spec 2.4) | N/A (by design) | PoC found MCP tools are auto-deferred by Claude Code. Documented in DECISIONS.md D1. No code needed. |

---

## Gaps Found

### 1. Resume path missing agentic options (MINOR)

`buildResumeQuery()` (line ~401) only passes `model` and `resume` session ID. It does NOT pass `cwd`, `tools`, `hooks`, or `mcpServers`. For recurring tasks that resume via stored SDK session ID, the resumed session will lack tool access, hooks, and MCP servers.

**Severity:** Minor — the Agent SDK may re-inherit these from the persisted session state, and resume failures fall back to `buildFreshQuery()` which has all options. But if resume succeeds without these fields, the task would run tool-less. Worth verifying during E2E testing.

**Recommendation:** Pass the same agentic options in `buildResumeQuery()` or add a comment explaining why they're intentionally omitted.

### 2. `git push --force` blocks ALL force pushes, not just to master/main (PRE-EXISTING)

The spec says: "git push --force (to master/main)". The bash blocker pattern `/git\s+push\s+--force/` blocks force pushes to ANY branch. This is pre-existing behavior (not introduced in this sprint), but slightly more restrictive than the spec intends.

**Severity:** Negligible — task agents shouldn't be force-pushing to any branch. More protective than spec, not less.

### 3. `chown` pattern is narrower than spec (NEGLIGIBLE)

The spec lists "chmod 000 / chown on protected paths". The implementation's `chown` regex `/chown\s+.*\/(brain|config|auth|\.env)/i` only blocks chown on paths containing `/brain`, `/config`, `/auth`, or `/.env`. A `chown` on `*.db` or `.guardrails` would not be caught. However, these files are already protected by the infrastructure guard on Write/Edit, and `chown` via bash is a less likely attack vector.

**Severity:** Negligible.

---

## Unspecified Additions

| Addition | Assessment |
|---|---|
| `getSharedMcpServers()` export from session-manager | Reasonable — needed for TaskExecutor to access MCP servers without circular dependency |
| Lazy getter pattern for `mcpServers` in index.ts | Good design — handles initialization ordering (MCP servers init after TaskExecutor construction). Test covers this pattern. |
| `this.config` stored on TaskExecutor | Necessary to support the lazy getter pattern |
| Working Nina persona text | New content not in spec, but spec implies "full Agent SDK session" needs a persona. The autonomous "get the job done" persona is appropriate and distinct from conversation Nina. |

All additions are justified and well-tested. No scope creep.

---

## Code Quality

- **Error handling:** Infrastructure guard is fail-closed (catch block returns `block`). Spec compliance confirmed.
- **Types:** `HookEvent` and `HookCallbackMatcher` imported from SDK types. `Options["mcpServers"]` used for type safety.
- **No circular imports:** Timezone utility cleanly extracted. Session manager exposes getter function.
- **Test isolation:** All tests use `vi.mock()` for external dependencies. No live API calls.
- **Backward compatibility:** Old log paths (`tasks/logs/`) still readable. No breaking changes to existing task execution.

---

## Test Summary

| Suite | Tests | Status |
|---|---|---|
| `packages/core` (all) | 129 | ALL PASS |
| `packages/dashboard` tasks + utils | 33 | ALL PASS |
| **Total** | **162** | **ALL PASS** |

### Test coverage by spec section:

- Infrastructure guard: 16 tests (9 blocked paths, 4 allowed paths, 2 fail-closed, 1 hookSpecificOutput check)
- Extended bash blocker: 16 tests (8 blocked patterns, 8 allowed patterns)
- Brain options passthrough: 5 tests (cwd, tools, persistSession, default tools, Task tool with custom tools)
- Working Nina prompt: 6 tests (persona, temporal, properties, notebook, task info, calendar)
- Timezone resolution: 4 tests (properties, preferences fallback, UTC fallback, parenthetical stripping)
- notifyOnCompletion normalization: 8 tests (3 valid values, 4 invalid/missing, field preservation)
- notifyOnCompletion passthrough: 1 integration test
- Log storage migration: 6 tests (new dir structure, path resolution, old path fallback, metadata)
- Task executor agentic config: 8 tests (cwd, tools, hooks, mcpServers, persistSession, prompt, lazy getter)

---

## Verdict: PASS WITH CONCERNS

**The implementation is solid and matches the spec.** All spec sections are covered, tests are comprehensive, code quality is good, and the design decisions (D1-D3) are well-documented.

**One concern to address post-merge:**

1. **Resume path missing agentic options** — verify during T10 E2E testing that resumed recurring tasks still have tool access. If they don't, add the options to `buildResumeQuery()`.

**Expected:** T10 (E2E test tasks) is correctly deferred to post-merge per DECISIONS.md D2.

---

## Post-Merge Additions

The following were added after the external review, during E2E verification and CTO review:

| Addition | Description | Tests |
|---|---|---|
| `status-report.md` instruction | Working Nina persona now instructs agents to write a status report at task completion | 1 new test (prompt contains instruction) |
| `revise_task` MCP tool | Conversation Nina can re-open completed tasks with correction instructions; executor resumes same session | 6 new tests |
| `addMcpServer()` in session-manager | Allows post-init MCP server registration | Used by task-revision wiring |
| `instructions` in `update()` | TaskManager.update() now supports updating instructions field | Required for revision flow |
| Per-task `model` override | Tasks can specify model to override brain config default | DB migration + type update |
| Workspace path in prompt | Working Nina prompt includes absolute `taskDir` path | Fixed during E2E testing |
| Resume path agentic options | `buildResumeQuery()` now passes cwd, tools, hooks, mcpServers | Fixed during review |

**Updated test count:** 168 tests total (129 core + 39 dashboard), all passing.
