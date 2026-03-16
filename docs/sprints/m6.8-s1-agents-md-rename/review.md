# External Verification Report

**Sprint:** M6.8-S1 AGENTS.md Rename
**Reviewer:** External Opus (independent)
**Date:** 2026-03-16

## Spec Coverage

| Spec Requirement | Status | Evidence |
|-----------------|--------|----------|
| `prompt.ts:15` — BRAIN_FILES `CLAUDE.md` → `AGENTS.md` | COVERED | `packages/core/src/prompt.ts:15` now reads `{ rel: 'AGENTS.md', header: null }` |
| `prompt.ts` — fallback to `CLAUDE.md` during transition | COVERED | `packages/core/src/prompt.ts:453-459` checks `existsSync` and falls back. Test at `prompt-recursive.test.ts:50-71` verifies fallback behavior. |
| `hatching/logic.ts:157,168` — `claudeMdPath` → `agentsMdPath` | COVERED | `packages/core/src/hatching/logic.ts:157,162,168,174` all use `agentsMdPath` writing to `AGENTS.md` |
| `hatching/logic.ts` + `hatching/index.ts` — `createDirectoryStructure` creates `.claude/skills/` | COVERED | Both copies at `logic.ts:14` and `index.ts:30` create `path.join(agentDir, '.claude', 'skills')` |
| `hatching/steps/personality.ts:69,78` — template copy target + log message | COVERED | `personality.ts:69` uses `agentsMdPath` pointing to `AGENTS.md`; line 78 log says `brain/AGENTS.md` |
| `hatching/steps/operating-rules.ts` — comment references | PARTIAL | Comment at line 72 still says `not CLAUDE.md` (bare filename, not `brain/CLAUDE.md`). Minor — contextually the comment contrasts with `standing-orders` and the meaning is clear, but spec listed this file for update. |
| `hooks/safety.ts:80-85` — guard `brain/AGENTS.md` + `.claude/skills/` | COVERED | `safety.ts:80` guards `brain/AGENTS\\.md$`; line 84 guards `\\.claude/skills/` |
| `debug.ts:228-237` — personality reads `brain/AGENTS.md` with fallback | COVERED | `debug.ts:228-242` tries `AGENTS.md` first, catches and reads `CLAUDE.md` as fallback |
| `debug.ts:376-395` — skill listing reads from `.claude/skills/` | COVERED | `debug.ts:393-394` reads from `join(agentDir, ".claude", "skills")` |
| `admin.ts:133-136` — unhatch deletes `brain/AGENTS.md` with fallback | COVERED | `admin.ts:133-142` loops over `["brain/AGENTS.md", "brain/CLAUDE.md"]` with break |
| SDK config plumbing (`brain.ts`, `session-manager.ts`, `task-executor.ts`, `chat-handler.ts`) | N/A — S2+ scope | S1 scope explicitly says "No SDK changes." These items in the spec's file list are for later sprints. |
| Tests — `infrastructure-guard.test.ts` | COVERED | Tests at lines 31-38 updated to `brain/AGENTS.md` and `.claude/skills/`; line 109 updated |
| Tests — `bash-blocker-extended.test.ts` | COVERED | Line 49 updated to `brain/AGENTS.md` path |
| Tests — `context-foundation.test.ts` | COVERED | Line 77 comment updated to reference `brain/AGENTS.md` |
| Tests — `prompt-recursive.test.ts` | COVERED | Line 14 writes `AGENTS.md`; new describe block (lines 50-71) tests CLAUDE.md fallback |
| Framework SKILL.md files reference correct paths | COVERED | `personality/SKILL.md` says `brain/AGENTS.md`; `operating-rules/SKILL.md` correctly says `notebook/reference/standing-orders.md` |

## Test Results

- Core: 130 passed, 0 failed, 0 skipped (10 test files)
- Dashboard: 466 passed, 0 failed, 2 skipped (48 test files)
- TypeScript: not run separately (tests compile and execute cleanly)

## Browser Verification

Skipped — sprint modifies no UI files, no route handler behavior, and no server startup code. All changes are internal path references and guard patterns.

## Stale Reference Check

**`brain/CLAUDE.md` in `*.ts` files:**

All remaining references are intentional fallback/transition code:
- `packages/core/src/prompt.ts:453,456` — fallback logic (by design)
- `packages/core/tests/prompt-recursive.test.ts:50,64,65` — tests the fallback
- `packages/core/src/hatching/steps/operating-rules.ts:72` — comment says "not CLAUDE.md" (see gap below)
- `packages/dashboard/src/routes/debug.ts:228,234` — fallback read (by design)
- `packages/dashboard/src/routes/admin.ts:133,134` — delete both filenames (by design)

**`brain/skills/` in `*.ts` files:** No matches found. Clean.

**`brain/CLAUDE.md` in `*.md` files:** No matches found. Clean.

## Gaps Found

1. **Minor: `operating-rules.ts` comment not updated** — The spec lists `packages/core/src/hatching/steps/operating-rules.ts — comment references` as a file to update. Line 72 still reads `write to standing-orders, not CLAUDE.md`. The plan did not include a task for this file. Impact is cosmetic — the comment is about the conceptual distinction (identity file vs standing orders), not a path reference, and the code behavior is correct. Severity: low.

2. **Note: `prompt.ts` still loads skills from `brain/skills/`** — Line 531 reads `path.join(brainDir, 'skills')` as a skills directory for `loadSkillContent` and `loadSkillDescriptions`. This is intentional per the plan (S2 scope handles skill migration), and `createDirectoryStructure` no longer creates this directory. No action needed in S1.

## Verdict

**PASS WITH CONCERNS**

All functional requirements are met. Tests pass clean (596 total). The rename, fallback logic, guard patterns, debug routes, admin routes, and directory structure changes are all correctly implemented. One cosmetic spec item was missed: the `operating-rules.ts` comment still says `CLAUDE.md` instead of `AGENTS.md`. This does not affect behavior.
