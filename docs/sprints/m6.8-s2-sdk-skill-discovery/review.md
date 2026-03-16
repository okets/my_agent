# M6.8-S2: SDK Skill Discovery -- External Review

**Reviewer:** Claude (External)
**Date:** 2026-03-16
**Branch:** sprint/m6.8-s2-sdk-skill-discovery

## Verdict: PASS WITH CONCERNS

The core SDK plumbing is solid and well-tested. The code changes are clean, follow existing patterns, and all 623 tests pass (147 core + 476 dashboard). However, two planned deliverables are missing: the `.my_agent/.claude/settings.json` file (which provides `claudeMdExcludes`) and the actual skill migration to `.my_agent/.claude/skills/`. These are both gitignored local-only operations, so they don't appear in the diff, but they are critical for the feature to function end-to-end.

---

## Spec Compliance

### Covered

| Requirement | Status | Files |
|-------------|--------|-------|
| `settingSources: ['project']` in brain.ts | Done | `packages/core/src/brain.ts:121-126` |
| `Skill` tool in allowedTools | Done | `packages/core/src/brain.ts:123-125` (auto-added when settingSources set) |
| `additionalDirectories` for Working Nina | Done | `packages/core/src/brain.ts:127-129`, `packages/dashboard/src/tasks/task-executor.ts:490,421` |
| Conversation Nina: `cwd: agentDir` | Done | `packages/dashboard/src/agent/session-manager.ts:329` |
| Conversation Nina: `settingSources: ['project']` | Done | `packages/dashboard/src/agent/session-manager.ts:330` |
| Working Nina: `settingSources + additionalDirectories` | Done | `packages/dashboard/src/tasks/task-executor.ts:490-492,421-423` |
| Working Nina: `Skill` in tools | Done | `packages/dashboard/src/tasks/task-executor.ts:489,420` |
| Developer skills removed from `.claude/skills/` | Done | 5 SKILL.md files deleted from repo |
| `install-dev-skills.sh` script | Done | `scripts/install-dev-skills.sh` (executable) |
| `prompt.ts` cleanup: remove `loadSkillDescriptions` | Done | Function and `FRAMEWORK_SKILLS_DIR` constant removed |
| `prompt.ts` cleanup: remove `task-api.md`, `channels.md` from SKILL_CONTENT_FILES | Done | Only `conversation-role.md` and `notebook.md` remain |
| Always-on content loads from `brain/` | Done | `skillsDirs` changed to `[brainDir]` in assembleSystemPrompt |
| Startup health check | Done | `packages/core/src/skills-health.ts`, called from `packages/dashboard/src/index.ts:770` |
| Frontmatter validation | Done | `checkSkillsHealth` validates required fields (name, description, origin) |
| Skill-tool filtering | Done | `packages/core/src/skill-filter.ts` with cleanup on session end |
| Skill-tool filtering cleanup in SessionManager | Done | `packages/dashboard/src/agent/session-manager.ts:379-382` |
| Skill-tool filtering cleanup in TaskExecutor | Done | `packages/dashboard/src/tasks/task-executor.ts:269-271` (finally block) |
| chat-handler: `/my-agent:*` updated for new skill locations | Done | `packages/dashboard/src/ws/chat-handler.ts:25-48` searches SDK skills dir first, framework fallback |
| lib.ts re-exports | Done | `filterSkillsByTools`, `cleanupSkillFilters`, `checkSkillsHealth` exported |

### NOT Covered (Spec Gaps)

| Requirement | Status | Impact |
|-------------|--------|--------|
| `.my_agent/.claude/settings.json` with `claudeMdExcludes: ["**/CLAUDE.md"]` | **Missing** | Without this file, the SDK will load all CLAUDE.md files it finds (including the repo root `CLAUDE.md`), injecting developer instructions into Nina's context. This is the primary mechanism for blocking CLAUDE.md leakage. |
| Skill migration to `.my_agent/.claude/skills/` | **Missing** | The directory does not exist. The startup health check will log "Warning: Skills directory not found" and the SDK will discover zero skills. |
| Always-on files in `.my_agent/brain/` | **Not verified** | `conversation-role.md` and `notebook.md` should exist in `brain/` for `loadSkillContent` to find them. These are gitignored, so they're not in the diff, but the tests assume they exist. |
| AGENTS.md soft fallback guardrail text | **Not verified** | Plan Task 5 Step 5 calls for appending a "## Skills" section to AGENTS.md with the delegation guardrail. |

---

## Code Quality

### Well Done

- **Error handling:** All new code has appropriate try/catch with graceful fallbacks. `filterSkillsByTools` returns `[]` on missing directory. `checkSkillsHealth` returns 0 and warns. No crashes on missing files.
- **Cleanup pattern:** The filter/cleanup lifecycle is implemented correctly in both `SessionManager.interrupt()` and `TaskExecutor.run()` (via finally block). The TaskExecutor uses `finally` which is the right pattern for guaranteed cleanup.
- **Concurrency documentation:** The `filterSkillsByTools` header comment explicitly documents the concurrency limitation (single Conversation Nina session assumption) and when to revisit. This is exactly the kind of documentation that prevents future bugs.
- **Test quality:** Tests are isolated (temp directories with cleanup), cover happy paths and edge cases, and mock at the right level. The `task-executor-skills.test.ts` covers both fresh and resume query paths.
- **Existing test compatibility:** The existing `task-executor-agentic.test.ts` was updated to include `Skill` in the expected tools list, preventing regression.

### Important Issues

1. **`settingSources` cast to `as any` in session-manager.ts line 330:**
   ```typescript
   settingSources: ["project"] as any,
   ```
   The `as any` cast suggests the SDK type does not match. This should either be typed correctly (if the SDK expects a different shape) or the core `BrainSessionOptions` type should be adjusted to match what the SDK actually accepts. The cast works at runtime but masks potential type mismatches.

   **Recommendation:** Investigate whether `Options['settingSources']` accepts string arrays. If the SDK type is `readonly ['project' | 'user']` or similar, use a const assertion instead of `as any`.

### Suggestions

1. **Developer skills not present in repo after deletion:** The `install-dev-skills.sh` script sources from `.claude/skills/` (the repo directory), but those files were deleted in this branch. The script will fail with "Error: Source skills directory not found" if run. This is likely intentional (skills moved to `~/.claude/skills/` at user level and the source is gone), but the script needs a different source or should be a no-op when the source is absent.

   **Recommendation:** Either (a) keep the developer skill files in a templates directory that the script copies from, or (b) update the script to explain that skills are already at `~/.claude/skills/` and only need installing on a fresh machine.

2. **Hardcoded tool lists in session-manager:** The `filterSkillsByTools` call in `SessionManager.initialize()` passes `["WebSearch", "WebFetch", "Skill"]` as a hardcoded list. This duplicates the tool list from `buildQuery()` (line 331). If tools are added later, both lists must be updated.

   **Recommendation:** Extract Conversation Nina's tool list to a constant shared between `initialize()` and `buildQuery()`.

---

## Concerns for CTO

1. **The gitignored deliverables are the most important part.** The code plumbing is done and correct, but the system will not function until:
   - `.my_agent/.claude/settings.json` is created with `claudeMdExcludes`
   - `.my_agent/.claude/skills/` is populated with migrated skills
   - `brain/conversation-role.md` and `brain/notebook.md` exist

   These are one-time local setup operations. The CTO should either run them manually or verify they'll be done as part of S3 (Seed Skills).

2. **The `install-dev-skills.sh` script has a broken source directory.** The developer skills were deleted from `.claude/skills/` (moved to `~/.claude/skills/` user-level), but the script reads from the now-deleted `.claude/skills/`. On this branch, running `scripts/install-dev-skills.sh` will exit with error. This needs fixing before merge.

3. **CLAUDE.md leakage is not yet blocked.** Without `settings.json`, the SDK will inject CLAUDE.md content into Nina's context. This includes the root-level `CLAUDE.md` (developer instructions) and `packages/dashboard/CLAUDE.md`. This is a functional correctness issue, not just a nice-to-have.
