# M6.8-S2: SDK Skill Discovery -- Test Report

**Date:** 2026-03-16
**Branch:** sprint/m6.8-s2-sdk-skill-discovery

## Test Results

### packages/core

```
Test Files:  13 passed (13)
Tests:       147 passed (147)
Duration:    1.51s
```

All 147 tests pass, including 4 new test files added in this sprint.

### packages/dashboard

```
Test Files:  50 passed (50)
Tests:       476 passed, 2 skipped (478)
Duration:    42.43s
```

All 476 tests pass (2 skipped are pre-existing SDK-only tests, not related to this sprint). Two new test files added.

### Summary

| Package | Pass | Fail | Skip | Total |
|---------|------|------|------|-------|
| core | 147 | 0 | 0 | 147 |
| dashboard | 476 | 0 | 2 | 478 |
| **Total** | **623** | **0** | **2** | **625** |

---

## New Tests Added

### packages/core/tests/brain-options.test.ts (3 new tests, 8 total)

| Test | What it verifies |
|------|-----------------|
| `passes settingSources to SDK options` | `settingSources: ['project']` flows through to SDK query options |
| `passes additionalDirectories to SDK options` | `additionalDirectories` flows through to SDK query options |
| `includes Skill in allowedTools when settingSources is set` | Auto-adds `Skill` tool when skill discovery is enabled |

### packages/core/tests/skill-filter.test.ts (5 tests, new file)

| Test | What it verifies |
|------|-----------------|
| `disables skills whose allowed-tools are not in session tools` | Conversation Nina: skills requiring Bash/Read/etc. get `disable-model-invocation: true` |
| `keeps skills whose allowed-tools are all available` | Skills whose tools are present remain enabled |
| `keeps skills without allowed-tools field` | Backwards compatibility -- no `allowed-tools` means always visible |
| `keeps skills when session has all required tools` | Working Nina: all tools present means nothing is disabled |
| `removes disable-model-invocation from previously filtered skills` | Cleanup after session ends restores skills |

### packages/core/tests/skills-health.test.ts (6 tests, new file)

| Test | What it verifies |
|------|-----------------|
| `returns 0 and warns when skills directory does not exist` | Graceful handling of missing directory |
| `returns 0 when skills directory is empty` | Warning logged when no skills found |
| `counts skills with SKILL.md files` | Correct counting of discoverable skills |
| `ignores directories without SKILL.md` | Only counts directories containing SKILL.md |
| `warns when SKILL.md has missing frontmatter fields` | Validates required fields: name, description, origin |
| `warns when SKILL.md has no frontmatter at all` | Catches skills without any YAML frontmatter |

### packages/core/tests/prompt-always-on.test.ts (3 tests, new file)

| Test | What it verifies |
|------|-----------------|
| `includes conversation-role.md content from brain/` | Always-on content loads from brain directory |
| `includes notebook.md content from brain/` | Always-on memory behavior content loads from brain directory |
| `does NOT include an Available Commands section` | Confirms `loadSkillDescriptions` removal -- no legacy command list |

### packages/dashboard/tests/session-manager-skills.test.ts (3 tests, new file)

| Test | What it verifies |
|------|-----------------|
| `passes settingSources to SDK query options` | SessionManager wires settingSources through to createBrainQuery |
| `passes cwd as agentDir for skill discovery` | SessionManager sets cwd to agentDir (not brainDir) |
| `includes Skill in allowedTools` | Skill tool is in Conversation Nina's tool list |

### packages/dashboard/tests/tasks/task-executor-skills.test.ts (7 tests, new file)

| Test | What it verifies |
|------|-----------------|
| `passes additionalDirectories containing agentDir (fresh query)` | Working Nina gets agentDir in additionalDirectories |
| `passes settingSources = ['project'] (fresh query)` | Working Nina gets settingSources |
| `passes allowedTools containing 'Skill' (fresh query)` | Working Nina has Skill tool |
| `passes all three skill discovery options together (fresh query)` | Integration: all options wired correctly with custom agentDir |
| `passes additionalDirectories containing agentDir (resume query)` | Resume path also gets additionalDirectories |
| `passes settingSources = ['project'] (resume query)` | Resume path also gets settingSources |
| `passes allowedTools containing 'Skill' (resume query)` | Resume path also has Skill tool |

### packages/dashboard/tests/tasks/task-executor-agentic.test.ts (1 test updated)

| Test | Change |
|------|--------|
| `passes tools = [Bash, Read, Write, Edit, Glob, Grep, Skill]` | Updated expected tools list to include `Skill` |

---

## Coverage Assessment

### Well Covered

- **brain.ts SDK options pass-through:** All three new options (settingSources, additionalDirectories, Skill auto-add) tested
- **Skill filtering logic:** Happy paths, edge cases, backwards compatibility, and cleanup all tested
- **Health check:** Missing directory, empty directory, valid skills, invalid frontmatter all covered
- **Prompt changes:** Always-on content loading and legacy removal both verified
- **SessionManager integration:** SDK options wire-through tested via mock capture
- **TaskExecutor integration:** Both fresh and resume query paths tested for all three options

### Not Covered (by tests)

- **`cleanupSkillFilters` in SessionManager.interrupt():** The session-manager-skills test mocks `cleanupSkillFilters` but does not verify it is called on interrupt. This is a minor gap since the code path is straightforward.
- **chat-handler skill search order:** The updated `loadSkillContent` searches SDK skills dir first, then framework skills. No test verifies the priority order (SDK over framework). Existing behavior is unchanged since framework skills still exist.
- **End-to-end skill discovery:** No test verifies that the SDK actually discovers skills from the filesystem with these options. This is expected -- the SDK is mocked in all tests. E2E validation would require a live SDK session.
- **`install-dev-skills.sh` script:** No automated test. Script is executable and syntactically correct (verified by inspection).
