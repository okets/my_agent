# M6.8-S2: SDK Skill Discovery — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable SDK-native skill discovery so Nina loads skills from `.my_agent/.claude/skills/` via `settingSources: ['project']`, migrate existing skills there, and remove legacy skill loading from prompt.ts.

**Architecture:** Add SDK skill discovery options (`settingSources`, `Skill` tool, `additionalDirectories`) to the brain query pipeline. `claudeMdExcludes` is configured via `.my_agent/.claude/settings.json` (loaded by `settingSources: ['project']`). Skill-tool filtering at session startup disables skills incompatible with the session's tool set. Conversation Nina discovers skills via `cwd: agentDir`. Working Nina discovers skills via `additionalDirectories: [agentDir]`. Legacy `loadSkillDescriptions()` is removed from prompt.ts. Always-on content (`conversation-role.md`, `notebook.md`) stays in the system prompt via `assembleSystemPrompt()`.

**Tech Stack:** TypeScript, Claude Agent SDK, Vitest

**Design spec:** `docs/superpowers/specs/2026-03-15-skills-architecture-design.md`

---

## Chunk 1: SDK Config Plumbing (brain.ts + BrainSessionOptions)

### Task 1: Add SDK skill discovery options to BrainSessionOptions and createBrainQuery

**Files:**
- Modify: `packages/core/src/brain.ts:25-47` (BrainSessionOptions interface)
- Modify: `packages/core/src/brain.ts:88-101` (queryOptions construction)
- Modify: `packages/core/src/lib.ts:9-16` (re-export new types)
- Test: `packages/core/tests/brain-options.test.ts`

- [ ] **Step 1: Write failing tests for new SDK options**

Add tests to `packages/core/tests/brain-options.test.ts`:

```typescript
it('passes settingSources to SDK options', () => {
  createBrainQuery('test', {
    model: 'claude-sonnet-4-6',
    settingSources: ['project'],
  });
  expect(capturedOptions.settingSources).toEqual(['project']);
});

it('passes additionalDirectories to SDK options', () => {
  createBrainQuery('test', {
    model: 'claude-sonnet-4-6',
    additionalDirectories: ['/home/user/.my_agent'],
  });
  expect(capturedOptions.additionalDirectories).toEqual(['/home/user/.my_agent']);
});

it('includes Skill in allowedTools when settingSources is set', () => {
  createBrainQuery('test', {
    model: 'claude-sonnet-4-6',
    settingSources: ['project'],
  });
  expect(capturedOptions.allowedTools).toContain('Skill');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/brain-options.test.ts`
Expected: 4 new tests FAIL

- [ ] **Step 3: Add new fields to BrainSessionOptions interface**

In `packages/core/src/brain.ts`, add to the `BrainSessionOptions` interface (after line 46):

```typescript
/** SDK skill discovery: which setting sources to scan (e.g., ['project']) */
settingSources?: Options['settingSources']
/** Additional directories for SDK skill discovery (for Working Nina) */
additionalDirectories?: string[]
```

- [ ] **Step 4: Wire new fields into queryOptions in createBrainQuery**

In `packages/core/src/brain.ts`, after the `if (options.cwd)` block (after line 118), add:

```typescript
if (options.settingSources) {
  queryOptions.settingSources = options.settingSources
  // Auto-add Skill tool when SDK skill discovery is enabled
  if (!allowedTools.includes('Skill')) {
    allowedTools.push('Skill')
  }
}
if (options.additionalDirectories) {
  queryOptions.additionalDirectories = options.additionalDirectories
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/brain-options.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/brain.ts packages/core/tests/brain-options.test.ts
git commit -m "feat(brain): add settingSources, settings, additionalDirectories to BrainSessionOptions"
```

---

## Chunk 2: Wire SDK Skills into Conversation Nina (SessionManager)

### Task 2: Add SDK skill discovery options to SessionManager.buildQuery

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts:318-336` (opts in buildQuery)
- Test: `packages/dashboard/tests/system-prompt-builder.test.ts` (existing, verify no regression)

The `SessionManager` needs to pass `settingSources`, `settings`, and `cwd` to `createBrainQuery` so the SDK discovers skills from `.my_agent/.claude/skills/`.

- [ ] **Step 1: Write failing test**

Create `packages/dashboard/tests/session-manager-skills.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedOptions: any = null;

// Mock the Agent SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((params: any) => {
    capturedOptions = params.options;
    return (async function* () {})();
  }),
}));

// Mock @my-agent/core
vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      model: "claude-sonnet-4-6",
      brainDir: "/tmp/test-agent/brain",
    }),
    createHooks: vi.fn().mockReturnValue({}),
    createMemoryServer: vi.fn().mockReturnValue({}),
    assembleSystemPrompt: vi
      .fn()
      .mockResolvedValue("## Identity\nYou are Nina."),
    loadCalendarConfig: vi.fn().mockReturnValue(null),
    loadCalendarCredentials: vi.fn().mockReturnValue(null),
    loadProperties: vi.fn().mockResolvedValue(null),
  };
});

import {
  SessionManager,
  initPromptBuilder,
} from "../src/agent/session-manager.js";

describe("SessionManager — SDK skill discovery", () => {
  process.env.ANTHROPIC_API_KEY = "test-key";

  beforeEach(() => {
    capturedOptions = null;
    initPromptBuilder("/tmp/test-agent/brain", "/tmp/test-agent");
  });

  it("passes settingSources to SDK query options", async () => {
    const sm = new SessionManager("conv-TEST");
    const gen = sm.streamMessage("hello");
    // Consume the generator to trigger the query
    for await (const _ of gen) {
      // drain
    }

    expect(capturedOptions.settingSources).toEqual(["project"]);
  });

  it("passes cwd as agentDir for skill discovery", async () => {
    const sm = new SessionManager("conv-TEST2");
    const gen = sm.streamMessage("hello");
    for await (const _ of gen) {
      // drain
    }

    expect(capturedOptions.cwd).toBe("/tmp/test-agent");
  });

  it("includes Skill in allowedTools", async () => {
    const sm = new SessionManager("conv-TEST3");
    const gen = sm.streamMessage("hello");
    for await (const _ of gen) {
      // drain
    }

    expect(capturedOptions.allowedTools).toContain("Skill");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/session-manager-skills.test.ts`
Expected: FAIL — settingSources/settings/cwd not present in options

- [ ] **Step 3: Modify SessionManager.buildQuery to add SDK skill options**

In `packages/dashboard/src/agent/session-manager.ts`, modify the `buildQuery` method. The `opts` object (lines 318-336) needs three new fields.

First, extract `agentDir`. The `doInitialize` method already computes it (line 200). Store it as a class field:

Add a private field to the class (after line 166):
```typescript
private agentDir: string | null = null;
```

In `doInitialize` (after line 200), store it:
```typescript
this.agentDir = agentDir;
```

Then in `buildQuery`, use it:
```typescript
const agentDir = this.agentDir!;
```

Then add to the `opts` object (after `reasoning` on line 333):

```typescript
cwd: agentDir,
settingSources: ["project"] as Options["settingSources"],
```

Also update the tools array to include `"Skill"` (line 321):

```typescript
tools: ["WebSearch", "WebFetch", "Skill"],
```

**Note:** The `cwd` here replaces whatever default cwd the SDK uses. Conversation Nina's cwd is `.my_agent/` so SDK discovers `.my_agent/.claude/skills/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run tests/session-manager-skills.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd packages/dashboard && npx vitest run tests/system-prompt-builder.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/agent/session-manager.ts packages/dashboard/tests/session-manager-skills.test.ts
git commit -m "feat(session-manager): wire SDK skill discovery for Conversation Nina"
```

---

### Task 3: Add SDK skill discovery to Working Nina (TaskExecutor)

**Files:**
- Modify: `packages/dashboard/src/tasks/task-executor.ts:396-416` (buildResumeQuery)
- Modify: `packages/dashboard/src/tasks/task-executor.ts:445-486` (buildFreshQuery)
- Test: `packages/dashboard/tests/tasks/task-executor-agentic.test.ts` (extend)

Working Nina uses `cwd: taskDir` (the task workspace). Skills are discovered via `additionalDirectories: [agentDir]` — test this approach first.

- [ ] **Step 1: Write failing tests**

**Important:** Read `packages/dashboard/tests/tasks/task-executor-agentic.test.ts` first and adapt the test harness from it. The test below is a reference — the mock setup must match the existing test patterns (TaskManager, LogStorage, DB mocks, etc.) to actually trigger `buildFreshQuery` and capture options.

Create `packages/dashboard/tests/tasks/task-executor-skills.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let capturedOptions: any = null;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((params: any) => {
    capturedOptions = params.options;
    return (async function* () {
      yield {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "<deliverable>test</deliverable>" }],
        },
      };
    })();
  }),
}));

vi.mock("@my-agent/core", async () => {
  const actual = await vi.importActual("@my-agent/core");
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      model: "claude-sonnet-4-6",
      brainDir: "/tmp/test-agent/brain",
    }),
    assembleSystemPrompt: vi
      .fn()
      .mockResolvedValue("## Identity\nYou are Nina."),
    loadCalendarConfig: vi.fn().mockReturnValue(null),
    loadCalendarCredentials: vi.fn().mockReturnValue(null),
    loadProperties: vi.fn().mockResolvedValue(null),
  };
});

// Import TaskExecutor and set up mocks matching task-executor-agentic.test.ts patterns.
// The key requirement: call executor.run(task) to trigger buildFreshQuery,
// then assert on capturedOptions.
//
// Adapt the mock TaskManager, LogStorage, and DB from task-executor-agentic.test.ts.
// The test structure below shows what to assert — the mock setup must come from
// reading the existing test file.

import { TaskExecutor } from "../../src/tasks/task-executor.js";

describe("TaskExecutor — SDK skill discovery", () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const testDir = join(tmpdir(), `te-skills-test-${Date.now()}`);

  beforeEach(() => {
    capturedOptions = null;
    mkdirSync(join(testDir, "tasks", "test-task"), { recursive: true });
  });

  // NOTE: This test requires proper TaskExecutor instantiation.
  // Copy the mock setup from task-executor-agentic.test.ts, then:
  //
  // const executor = new TaskExecutor({ taskManager, logStorage, agentDir: "/tmp/test-agent", db, ... });
  // await executor.run(testTask);
  //
  // Then assert:

  it("passes additionalDirectories with agentDir in fresh query", async () => {
    // After executor.run(task):
    expect(capturedOptions?.additionalDirectories).toContain("/tmp/test-agent");
  });

  it("passes settingSources in fresh query", async () => {
    expect(capturedOptions?.settingSources).toEqual(["project"]);
  });

  it("includes Skill in allowedTools for Working Nina", async () => {
    expect(capturedOptions?.allowedTools).toContain("Skill");
  });
});
```

**Critical:** This test is a skeleton. The implementer MUST read `packages/dashboard/tests/tasks/task-executor-agentic.test.ts` and copy the mock harness (TaskManager, LogStorage, ConversationDatabase mocks) to make `executor.run(task)` actually call `buildFreshQuery`. Without that, `capturedOptions` will be null.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run tests/tasks/task-executor-skills.test.ts`
Expected: FAIL

- [ ] **Step 3: Modify buildFreshQuery to include SDK skill options**

In `packages/dashboard/src/tasks/task-executor.ts`, modify the `createBrainQuery` call in `buildFreshQuery` (lines 476-485):

```typescript
return createBrainQuery(fullPrompt, {
  model: brainConfig.model,
  systemPrompt,
  cwd: taskDir,
  tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"],
  mcpServers: this.config.mcpServers,
  hooks: this.config.hooks,
  persistSession: !!task.recurrenceId,
  includePartialMessages: false,
  settingSources: ["project"],
  additionalDirectories: [this.agentDir],
});
```

- [ ] **Step 4: Modify buildResumeQuery similarly**

In `packages/dashboard/src/tasks/task-executor.ts`, modify the `createBrainQuery` call in `buildResumeQuery` (lines 407-415):

```typescript
return createBrainQuery(this.buildUserMessage(task), {
  model: brainConfig.model,
  resume: sessionId,
  cwd: taskDir,
  tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"],
  mcpServers: this.config.mcpServers,
  hooks: this.config.hooks,
  includePartialMessages: false,
  settingSources: ["project"],
  additionalDirectories: [this.agentDir],
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/tasks/task-executor-skills.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/tasks/task-executor.ts packages/dashboard/tests/tasks/task-executor-skills.test.ts
git commit -m "feat(task-executor): wire SDK skill discovery for Working Nina via additionalDirectories"
```

---

### Task 4: Skill-tool filtering at session startup

**Files:**
- Create: `packages/core/src/skill-filter.ts` (filtering logic)
- Modify: `packages/core/src/lib.ts` (export)
- Modify: `packages/dashboard/src/agent/session-manager.ts` (call before query)
- Modify: `packages/dashboard/src/tasks/task-executor.ts` (call before query)
- Test: `packages/core/tests/skill-filter.test.ts`

Conversation Nina has restricted tools (WebSearch, WebFetch, Skill). If she invokes a skill that requires Write/Bash/etc., she'll produce confused output. At session startup, we scan skills and set `disable-model-invocation: true` on skills whose `allowed-tools` require tools the session doesn't have. After the session, we clean up those flags.

- [ ] **Step 1: Write failing tests**

Create `packages/core/tests/skill-filter.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { filterSkillsByTools, cleanupSkillFilters } from '../src/skill-filter.js'

describe('filterSkillsByTools', () => {
  const testDir = join(tmpdir(), `skill-filter-test-${Date.now()}`)
  const skillsDir = join(testDir, '.claude', 'skills')

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('disables skills whose allowed-tools are not in session tools', async () => {
    mkdirSync(join(skillsDir, 'debugging'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'debugging', 'SKILL.md'),
      '---\nname: debugging\ndescription: Debug issues\norigin: system\nallowed-tools:\n  - Bash\n  - Read\n  - Grep\n---\n# Debugging'
    )

    const disabled = await filterSkillsByTools(testDir, ['WebSearch', 'WebFetch', 'Skill'])

    expect(disabled).toEqual(['debugging'])
    const content = readFileSync(join(skillsDir, 'debugging', 'SKILL.md'), 'utf-8')
    expect(content).toContain('disable-model-invocation: true')
  })

  it('keeps skills whose allowed-tools are all available', async () => {
    mkdirSync(join(skillsDir, 'research'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'research', 'SKILL.md'),
      '---\nname: research\ndescription: Research topics\norigin: system\nallowed-tools:\n  - WebSearch\n---\n# Research'
    )

    const disabled = await filterSkillsByTools(testDir, ['WebSearch', 'WebFetch', 'Skill'])

    expect(disabled).toEqual([])
    const content = readFileSync(join(skillsDir, 'research', 'SKILL.md'), 'utf-8')
    expect(content).not.toContain('disable-model-invocation')
  })

  it('keeps skills without allowed-tools field (backwards compatible)', async () => {
    mkdirSync(join(skillsDir, 'legacy'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'legacy', 'SKILL.md'),
      '---\nname: legacy\ndescription: Legacy skill\norigin: system\n---\n# Legacy'
    )

    const disabled = await filterSkillsByTools(testDir, ['WebSearch'])

    expect(disabled).toEqual([])
  })

  it('keeps skills when session has all required tools (Working Nina)', async () => {
    mkdirSync(join(skillsDir, 'debugging'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'debugging', 'SKILL.md'),
      '---\nname: debugging\ndescription: Debug issues\norigin: system\nallowed-tools:\n  - Bash\n  - Read\n  - Grep\n---\n# Debugging'
    )

    const disabled = await filterSkillsByTools(testDir, [
      'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'
    ])

    expect(disabled).toEqual([])
  })
})

describe('cleanupSkillFilters', () => {
  const testDir = join(tmpdir(), `skill-cleanup-test-${Date.now()}`)
  const skillsDir = join(testDir, '.claude', 'skills')

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('removes disable-model-invocation from previously filtered skills', async () => {
    mkdirSync(join(skillsDir, 'debugging'), { recursive: true })
    writeFileSync(
      join(skillsDir, 'debugging', 'SKILL.md'),
      '---\nname: debugging\ndescription: Debug issues\norigin: system\nallowed-tools:\n  - Bash\ndisable-model-invocation: true\n---\n# Debugging'
    )

    await cleanupSkillFilters(testDir, ['debugging'])

    const content = readFileSync(join(skillsDir, 'debugging', 'SKILL.md'), 'utf-8')
    expect(content).not.toContain('disable-model-invocation')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/skill-filter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement skill-filter.ts**

Create `packages/core/src/skill-filter.ts`:

```typescript
import { existsSync } from 'node:fs'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/**
 * Filter skills based on tool compatibility.
 *
 * Scans .my_agent/.claude/skills/, reads allowed-tools from each skill's
 * YAML frontmatter, and sets disable-model-invocation: true on skills whose
 * required tools aren't in the session's allowedTools list.
 *
 * Returns the list of skill names that were disabled.
 *
 * LIMITATION: Writes directly to SKILL.md on disk. If concurrent sessions
 * run with different tool sets, one session's cleanup could re-enable a skill
 * that another session disabled. Safe in current architecture because Working
 * Nina has all tools (never disables anything) and only one Conversation Nina
 * session runs at a time. Revisit if multi-session support is needed.
 */
export async function filterSkillsByTools(
  agentDir: string,
  sessionTools: string[],
): Promise<string[]> {
  const skillsDir = path.join(agentDir, '.claude', 'skills')
  if (!existsSync(skillsDir)) return []

  let entries: string[]
  try {
    entries = await readdir(skillsDir)
  } catch {
    return []
  }

  const toolSet = new Set(sessionTools)
  const disabled: string[] = []

  for (const entry of entries) {
    const skillMdPath = path.join(skillsDir, entry, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    try {
      const content = await readFile(skillMdPath, 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) continue

      const fm = parseYaml(fmMatch[1])
      const allowedTools = fm['allowed-tools'] as string[] | undefined
      if (!allowedTools || !Array.isArray(allowedTools)) continue

      // Check if all required tools are available in the session
      const missingTools = allowedTools.filter((t) => !toolSet.has(t))
      if (missingTools.length === 0) continue

      // Disable this skill — add disable-model-invocation to frontmatter
      fm['disable-model-invocation'] = true
      const body = content.slice(fmMatch[0].length)
      const newContent = `---\n${stringifyYaml(fm).trim()}\n---${body}`
      await writeFile(skillMdPath, newContent)
      disabled.push(entry)

      console.log(
        `[Skills] Disabled "${entry}" — requires tools not in session: ${missingTools.join(', ')}`,
      )
    } catch {
      // Skip skills with parse errors
      continue
    }
  }

  return disabled
}

/**
 * Clean up disable-model-invocation flags set by filterSkillsByTools.
 * Call after a session ends to restore skills for future sessions.
 */
export async function cleanupSkillFilters(
  agentDir: string,
  disabledSkills: string[],
): Promise<void> {
  const skillsDir = path.join(agentDir, '.claude', 'skills')

  for (const entry of disabledSkills) {
    const skillMdPath = path.join(skillsDir, entry, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    try {
      const content = await readFile(skillMdPath, 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) continue

      const fm = parseYaml(fmMatch[1])
      if (!fm['disable-model-invocation']) continue

      delete fm['disable-model-invocation']
      const body = content.slice(fmMatch[0].length)
      const newContent = `---\n${stringifyYaml(fm).trim()}\n---${body}`
      await writeFile(skillMdPath, newContent)
    } catch {
      continue
    }
  }
}
```

- [ ] **Step 4: Export from lib.ts**

Add to `packages/core/src/lib.ts`:

```typescript
export { filterSkillsByTools, cleanupSkillFilters } from './skill-filter.js'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/skill-filter.test.ts`
Expected: All PASS

- [ ] **Step 6: Wire into SessionManager (Conversation Nina)**

In `packages/dashboard/src/agent/session-manager.ts`, import and call `filterSkillsByTools` before the first query:

In `doInitialize()` (after hooks initialization, around line 211):

```typescript
import { filterSkillsByTools, cleanupSkillFilters } from "@my-agent/core";

// In the class, add a field:
private disabledSkills: string[] = [];

// In doInitialize(), after hooks setup:
// Filter skills that require tools Conversation Nina doesn't have
this.disabledSkills = await filterSkillsByTools(agentDir, [
  "WebSearch", "WebFetch", "Skill",
]);
```

Add a cleanup method or wire cleanup in the `abort()` method / session teardown:

```typescript
// In abort() or a new cleanup method:
if (this.disabledSkills.length > 0) {
  const agentDir = this.agentDir!;
  await cleanupSkillFilters(agentDir, this.disabledSkills);
  this.disabledSkills = [];
}
```

**Note:** Cleanup must also happen if the session ends normally (generator exhausted). Consider adding a `dispose()` method called by the chat handler when the session ends.

- [ ] **Step 7: Wire into TaskExecutor (Working Nina) — verify no-op**

Working Nina has all tools (`Bash, Read, Write, Edit, Glob, Grep, Skill`), so `filterSkillsByTools` should return an empty list. Wire it anyway for correctness:

In `TaskExecutor.executeQuery()`, before the query call:

```typescript
const disabledSkills = await filterSkillsByTools(this.agentDir, [
  "Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill",
]);
```

And in the `finally` block of `run()`:

```typescript
if (disabledSkills.length > 0) {
  await cleanupSkillFilters(this.agentDir, disabledSkills);
}
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skill-filter.ts packages/core/src/lib.ts packages/core/tests/skill-filter.test.ts packages/dashboard/src/agent/session-manager.ts packages/dashboard/src/tasks/task-executor.ts
git commit -m "feat(skills): skill-tool filtering — disable skills incompatible with session tools"
```

---

## Chunk 2: Skill Migration + Always-On Content

### Task 5: Migrate framework skills to .my_agent/.claude/skills/

**Files:**
- Create: `.my_agent/.claude/skills/` directory structure
- Move (as copies): `packages/core/skills/{identity,personality,operating-rules,auth,calendar}/SKILL.md` → `.my_agent/.claude/skills/{identity,personality,operating-rules,auth,scheduling}/SKILL.md`
- Modify skill frontmatter: add `origin: system` to each

The framework skills in `packages/core/skills/` currently serve two purposes:
1. **On-demand skills** (identity, personality, operating-rules, auth, calendar) — these become SDK-discovered skills
2. **Always-on content** (conversation-role.md, notebook.md) — these stay in the system prompt

**Important:** Skills must be flat under `.claude/skills/<name>/SKILL.md` (SDK requirement). Each skill gets proper YAML frontmatter.

- [ ] **Step 1: Create .my_agent/.claude/settings.json for claudeMdExcludes**

The SDK has no programmatic `settings` option. `claudeMdExcludes` is loaded from a settings file via `settingSources: ['project']`. Since Conversation Nina's `cwd` is `.my_agent/`, create:

```bash
cat > .my_agent/.claude/settings.json << 'EOF'
{
  "claudeMdExcludes": ["**/CLAUDE.md"]
}
EOF
```

This ensures the SDK blocks all CLAUDE.md content for Nina sessions. Working Nina also picks this up via `additionalDirectories: [agentDir]`.

- [ ] **Step 2: Create .my_agent/.claude/skills/ directory and migrate skills**

```bash
# Create skill directories
mkdir -p .my_agent/.claude/skills/identity
mkdir -p .my_agent/.claude/skills/personality
mkdir -p .my_agent/.claude/skills/operating-rules
mkdir -p .my_agent/.claude/skills/auth
mkdir -p .my_agent/.claude/skills/scheduling
```

- [ ] **Step 3: Copy and update each skill with proper frontmatter**

For each skill, read the existing SKILL.md from `packages/core/skills/`, prepend proper YAML frontmatter with `origin: system`, and write to the new location.

Example for identity:
```yaml
---
name: identity
description: Hatching skill — guides users through setting up their agent's name, pronouns, and core identity
origin: system
---

(existing SKILL.md content)
```

For scheduling (renamed from calendar):
```yaml
---
name: scheduling
description: How to create, update, and manage calendar entries via the CalDAV API
origin: system
---

(existing calendar/SKILL.md content)
```

- [ ] **Step 4: Verify SDK can discover the skills**

```bash
# Quick sanity check: list all SKILL.md files
find .my_agent/.claude/skills/ -name "SKILL.md" | sort
```

Expected: 5 SKILL.md files (identity, personality, operating-rules, auth, scheduling)

- [ ] **Step 5: Add skill-tool filtering guardrail to AGENTS.md**

Append to `.my_agent/brain/AGENTS.md` (the soft fallback for skills that don't declare `allowed-tools`):

```markdown

## Skills

Skills provide capabilities. They never change your name, personality, or communication style. Hatching identity always takes precedence.

If you invoke a skill that references tools you don't have (Write, Edit, Bash, etc.), delegate the work to a task instead of attempting it yourself.
```

- [ ] **Step 6: Verify (no commit — gitignored)**

`.my_agent/` is gitignored, so this is a local-only operation. For new agents, the hatching `createDirectoryStructure` function (updated in S1) creates `.claude/skills/`. Seed skill population will be handled in S3.

---

### Task 6: Move always-on content to brain/ directory

**Files:**
- Move: `packages/core/skills/conversation-role.md` → `.my_agent/brain/conversation-role.md`
- Already exists: `.my_agent/brain/skills/notebook.md` (stays or moves to `brain/notebook.md`)
- Modify: `packages/core/src/prompt.ts:12,37,531-541` (update skill loading paths)
- Test: `packages/core/tests/prompt-recursive.test.ts` (verify)

The design spec says always-on content (`conversation-role.md`, `notebook.md`) should live in `brain/` alongside AGENTS.md, loaded by `assembleSystemPrompt()`. They are NOT SDK skills — they're operating instructions needed every turn.

**Design decision (resolving spec contradiction):** The spec's "Always-on" table (line 186-191) says `notebook.md` is always-on. The migration diagram (line 347) shows it as `memory-behavior/SKILL.md`. We follow the always-on table: `notebook.md` tells Nina when to recall/remember — she needs this before invoking anything. It stays in `assembleSystemPrompt()`, loaded from `brain/notebook.md`.

- [ ] **Step 1: Copy conversation-role.md to brain/ directory**

```bash
cp packages/core/skills/conversation-role.md .my_agent/brain/conversation-role.md
```

- [ ] **Step 2: Move notebook.md from brain/skills/ to brain/**

```bash
mv .my_agent/brain/skills/notebook.md .my_agent/brain/notebook.md
rmdir .my_agent/brain/skills/  # Remove now-empty directory
```

- [ ] **Step 3: Update SKILL_CONTENT_FILES and skillsDirs in prompt.ts**

In `packages/core/src/prompt.ts`:

a) Update `SKILL_CONTENT_FILES` (line 37) — these are the files loaded as always-on content:
```typescript
const SKILL_CONTENT_FILES = ['conversation-role.md', 'notebook.md']
```

Remove `task-api.md` and `channels.md` from the list — they don't exist and aren't needed for S2.

b) Update `skillsDirs` in `assembleSystemPrompt` (line 531) — change from framework + brain/skills to just brain directory:
```typescript
const skillsDirs = [brainDir]
```

The brain directory now contains `conversation-role.md` and `notebook.md` directly.

- [ ] **Step 4: Remove loadSkillDescriptions call from assembleSystemPrompt**

In `packages/core/src/prompt.ts`, remove lines 537-541 (the skill commands list):
```typescript
// REMOVE these lines — SDK now handles skill discovery and listing
// const skills = await loadSkillDescriptions(skillsDirs)
// if (skills) {
//   sections.push(skills)
// }
```

Also remove the `loadSkillDescriptions` function (lines 387-424) and `FRAMEWORK_SKILLS_DIR` constant (line 12) since they're no longer used.

- [ ] **Step 5: Write test to verify always-on content loads from brain/**

Create `packages/core/tests/prompt-always-on.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assembleSystemPrompt } from '../src/prompt.js'

describe('assembleSystemPrompt — always-on content from brain/', () => {
  const testDir = join(tmpdir(), `prompt-always-on-test-${Date.now()}`)
  const brainDir = join(testDir, 'brain')

  beforeEach(() => {
    mkdirSync(brainDir, { recursive: true })
    // Minimal AGENTS.md so assembleSystemPrompt doesn't fall back to default
    writeFileSync(join(brainDir, 'AGENTS.md'), '# Test Agent\nYou are a test agent.')
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('includes conversation-role.md content from brain/', async () => {
    writeFileSync(
      join(brainDir, 'conversation-role.md'),
      '## Your Role: Conversation Agent\nYou are the conversation layer.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('Conversation Agent')
    expect(prompt).toContain('conversation layer')
  })

  it('includes notebook.md content from brain/', async () => {
    writeFileSync(
      join(brainDir, 'notebook.md'),
      '# Memory & Notebook\nUse MCP tools for persistent memory.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('Memory & Notebook')
    expect(prompt).toContain('persistent memory')
  })

  it('does NOT include an "Available Commands" section (SDK handles discovery)', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('Available Commands')
    expect(prompt).not.toContain('/my-agent:')
  })
})
```

- [ ] **Step 6: Run tests**

Run: `cd packages/core && npx vitest run`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/prompt.ts
git commit -m "refactor(prompt): load always-on content from brain/, remove SDK skill loading"
```

---

### Task 7: Update chat-handler.ts expandSkillCommand for new skill locations

**Files:**
- Modify: `packages/dashboard/src/ws/chat-handler.ts:24-66` (loadSkillContent, FRAMEWORK_SKILLS_DIR)

The `/my-agent:*` commands in chat need to find skills in the new location. After migration, hatching skills live in `.my_agent/.claude/skills/`. The `loadSkillContent` function currently only looks in `packages/core/skills/`.

- [ ] **Step 1: Update loadSkillContent to search .my_agent/.claude/skills/**

Modify `packages/dashboard/src/ws/chat-handler.ts`:

Replace the `FRAMEWORK_SKILLS_DIR` constant and `loadSkillContent` function (lines 24-41):

```typescript
// Skills directories: SDK skills (primary) + framework skills (fallback)
function getSkillsDirs(agentDir: string): string[] {
  return [
    path.join(agentDir, ".claude", "skills"),
    path.resolve(import.meta.dirname, "../../../core/skills"),
  ];
}

/**
 * Load skill content for /my-agent:* commands
 * Searches SDK skills first, then framework skills
 */
async function loadSkillContent(
  skillName: string,
  agentDir: string,
): Promise<string | null> {
  for (const dir of getSkillsDirs(agentDir)) {
    const skillPath = path.join(dir, skillName, "SKILL.md");
    try {
      return await readFile(skillPath, "utf-8");
    } catch {
      continue;
    }
  }
  return null;
}
```

Update the `expandSkillCommand` function to accept `agentDir`:

```typescript
async function expandSkillCommand(
  content: string,
  agentDir: string,
): Promise<string> {
  const match = content.match(/^\/my-agent:(\S+)/);
  if (!match) return content;

  const skillName = match[1];
  const skillContent = await loadSkillContent(skillName, agentDir);
  // ... rest stays the same
```

- [ ] **Step 2: Update the expandSkillCommand call site**

Find where `expandSkillCommand(content)` is called (around line 981) and pass `agentDir`:

```typescript
const expandedContent = await expandSkillCommand(content, fastify.agentDir);
```

**Note:** `fastify.agentDir` should be available — verify via the Fastify instance's decorated properties. If not directly available in the handler, thread it from the websocket setup.

- [ ] **Step 3: Run existing tests + manual verification**

Run: `cd packages/dashboard && npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/ws/chat-handler.ts
git commit -m "refactor(chat-handler): search SDK skills dir for /my-agent:* commands"
```

---

## Chunk 3: Developer Skill Migration + Health Check

### Task 8: Create install-dev-skills.sh and move developer skills to ~/.claude/skills/

**Files:**
- Create: `scripts/install-dev-skills.sh`

Developer skills (start-sprint, whats-next, etc.) currently live at `.claude/skills/` in the project root. They need to move to `~/.claude/skills/` (user-level) so they don't appear as Nina's skills when `settingSources: ['project']` scans `.my_agent/.claude/skills/`.

- [ ] **Step 1: Create install script**

Create `scripts/install-dev-skills.sh`:

```bash
#!/usr/bin/env bash
#
# Install developer skills to user-level ~/.claude/skills/
# These skills are for Claude Code (the developer), not for Nina.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$PROJECT_DIR/.claude/skills"
TARGET_DIR="$HOME/.claude/skills"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Error: Source skills directory not found: $SOURCE_DIR"
  exit 1
fi

mkdir -p "$TARGET_DIR"

for skill_dir in "$SOURCE_DIR"/*/; do
  skill_name="$(basename "$skill_dir")"
  target="$TARGET_DIR/$skill_name"

  if [ -d "$target" ]; then
    echo "  Updating: $skill_name"
    rm -rf "$target"
  else
    echo "  Installing: $skill_name"
  fi

  cp -r "$skill_dir" "$target"
done

echo ""
echo "Developer skills installed to $TARGET_DIR"
echo "These are visible to Claude Code but NOT to Nina."
```

- [ ] **Step 2: Make executable**

```bash
chmod +x scripts/install-dev-skills.sh
```

- [ ] **Step 3: Run the script to move developer skills**

```bash
./scripts/install-dev-skills.sh
```

Expected: Skills copied to `~/.claude/skills/`

- [ ] **Step 4: Verify developer skills exist at user level**

```bash
ls ~/.claude/skills/
```

Expected: `start-sprint/`, `start-overnight-sprint/`, `start-trip-sprint/`, `trip-review/`, `whats-next/`

- [ ] **Step 5: Remove project-level developer skills**

After confirming they're installed at user level, remove from project:

```bash
rm -rf .claude/skills/start-sprint
rm -rf .claude/skills/start-overnight-sprint
rm -rf .claude/skills/start-trip-sprint
rm -rf .claude/skills/trip-review
rm -rf .claude/skills/whats-next
```

**Important:** Keep the `.claude/skills/` directory itself — it may contain other project-level skills or be needed for future use.

- [ ] **Step 6: Commit**

```bash
git add scripts/install-dev-skills.sh
git commit -m "feat(scripts): install-dev-skills.sh — moves developer skills to ~/.claude/skills/"
```

**Note:** The removal of `.claude/skills/*` directories needs to be committed separately since they may be tracked. Check `git status` to see if they're tracked or gitignored.

---

### Task 9: Add startup health check for skill discovery

**Files:**
- Modify: `packages/dashboard/src/index.ts` (or wherever the dashboard starts)
- Create: `packages/core/src/skills-health.ts` (simple utility)

A startup check that logs how many skills the SDK will discover. If zero, log a warning.

- [ ] **Step 1: Create skills health check utility**

Create `packages/core/src/skills-health.ts`:

```typescript
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'

const REQUIRED_FRONTMATTER_FIELDS = ['name', 'description', 'origin']

/**
 * Count discoverable SDK skills in the agent's .claude/skills/ directory.
 * Validates YAML frontmatter on each skill. Returns the count and logs results.
 * Warns if zero skills found or if frontmatter is invalid.
 */
export async function checkSkillsHealth(agentDir: string): Promise<number> {
  const skillsDir = path.join(agentDir, '.claude', 'skills')

  if (!existsSync(skillsDir)) {
    console.warn(`[Skills] Warning: Skills directory not found: ${skillsDir}`)
    return 0
  }

  let entries: string[]
  try {
    entries = await readdir(skillsDir)
  } catch {
    console.warn(`[Skills] Warning: Cannot read skills directory: ${skillsDir}`)
    return 0
  }

  // Count directories that contain a SKILL.md, validate frontmatter
  let count = 0
  for (const entry of entries) {
    const skillMdPath = path.join(skillsDir, entry, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    count++

    // Validate frontmatter
    try {
      const content = await readFile(skillMdPath, 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (!fmMatch) {
        console.warn(`[Skills] Warning: ${entry}/SKILL.md missing YAML frontmatter`)
        continue
      }
      const fm = parseYaml(fmMatch[1])
      const missing = REQUIRED_FRONTMATTER_FIELDS.filter((f) => !fm[f])
      if (missing.length > 0) {
        console.warn(`[Skills] Warning: ${entry}/SKILL.md missing frontmatter fields: ${missing.join(', ')}`)
      }
    } catch {
      console.warn(`[Skills] Warning: ${entry}/SKILL.md frontmatter parse error`)
    }
  }

  if (count === 0) {
    console.warn(`[Skills] Warning: No skills found in ${skillsDir}. SDK skill discovery will find nothing.`)
  } else {
    console.log(`[Skills] ${count} skill(s) discovered in ${skillsDir}`)
  }

  return count
}
```

- [ ] **Step 2: Export from lib.ts**

Add to `packages/core/src/lib.ts`:

```typescript
export { checkSkillsHealth } from './skills-health.js'
```

- [ ] **Step 3: Write test**

Create `packages/core/tests/skills-health.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkSkillsHealth } from '../src/skills-health.js'

describe('checkSkillsHealth', () => {
  const testDir = join(tmpdir(), `skills-health-test-${Date.now()}`)
  const skillsDir = join(testDir, '.claude', 'skills')

  beforeEach(() => {
    mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns 0 and warns when skills directory does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const count = await checkSkillsHealth('/nonexistent/path')
    expect(count).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not found'))
    warn.mockRestore()
  })

  it('returns 0 when skills directory is empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const count = await checkSkillsHealth(testDir)
    expect(count).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No skills found'))
    warn.mockRestore()
  })

  it('counts skills with SKILL.md files', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    // Create two valid skills
    mkdirSync(join(skillsDir, 'identity'), { recursive: true })
    writeFileSync(join(skillsDir, 'identity', 'SKILL.md'), '# Identity')
    mkdirSync(join(skillsDir, 'scheduling'), { recursive: true })
    writeFileSync(join(skillsDir, 'scheduling', 'SKILL.md'), '# Scheduling')

    const count = await checkSkillsHealth(testDir)
    expect(count).toBe(2)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2 skill(s)'))
    log.mockRestore()
  })

  it('ignores directories without SKILL.md', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    mkdirSync(join(skillsDir, 'valid'), { recursive: true })
    writeFileSync(join(skillsDir, 'valid', 'SKILL.md'), '---\nname: valid\ndescription: test\norigin: system\n---\n# Valid')
    mkdirSync(join(skillsDir, 'empty-dir'), { recursive: true })

    const count = await checkSkillsHealth(testDir)
    expect(count).toBe(1)
    log.mockRestore()
  })

  it('warns when SKILL.md has missing frontmatter fields', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    mkdirSync(join(skillsDir, 'bad'), { recursive: true })
    writeFileSync(join(skillsDir, 'bad', 'SKILL.md'), '---\nname: bad\n---\n# Bad')

    await checkSkillsHealth(testDir)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing frontmatter fields: description, origin'))
    warn.mockRestore()
    log.mockRestore()
  })

  it('warns when SKILL.md has no frontmatter at all', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    mkdirSync(join(skillsDir, 'nofm'), { recursive: true })
    writeFileSync(join(skillsDir, 'nofm', 'SKILL.md'), '# No Frontmatter')

    await checkSkillsHealth(testDir)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing YAML frontmatter'))
    warn.mockRestore()
    log.mockRestore()
  })
})
```

- [ ] **Step 4: Run test**

Run: `cd packages/core && npx vitest run tests/skills-health.test.ts`
Expected: All PASS

- [ ] **Step 5: Wire into dashboard startup**

Find the dashboard startup (likely `packages/dashboard/src/index.ts`) where `initMcpServers` and `initPromptBuilder` are called. Add after them:

```typescript
import { checkSkillsHealth } from "@my-agent/core";

// ... during startup sequence:
await checkSkillsHealth(agentDir);
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/skills-health.ts packages/core/src/lib.ts packages/core/tests/skills-health.test.ts packages/dashboard/src/index.ts
git commit -m "feat(skills): startup health check logs discovered skill count"
```

---

## Chunk 4: Verification

### Task 10: Full integration verification

- [ ] **Step 1: Run all tests across both packages**

```bash
cd packages/core && npx vitest run
cd packages/dashboard && npx vitest run
```

Expected: All PASS in both packages

- [ ] **Step 2: Verify skill files are in place**

```bash
# SDK-discovered skills
ls .my_agent/.claude/skills/*/SKILL.md

# Always-on content in brain/
ls .my_agent/brain/conversation-role.md
ls .my_agent/brain/notebook.md

# Developer skills at user level
ls ~/.claude/skills/

# Install script
ls scripts/install-dev-skills.sh
```

- [ ] **Step 3: Verify the startup health check output**

Start the dashboard briefly and check logs for the skills health check line:
```bash
cd packages/dashboard && timeout 5 npm run dev 2>&1 | grep -i skill || true
```

Expected: `[Skills] N skill(s) discovered in ...`

- [ ] **Step 4: Final commit (if any fixups needed)**

```bash
git add -A && git commit -m "fix: integration fixups for M6.8-S2 SDK skill discovery"
```

---

## Summary

| Task | Description | Touches |
|------|-------------|---------|
| 1 | BrainSessionOptions + createBrainQuery plumbing | `core/brain.ts` |
| 2 | SessionManager wiring for Conversation Nina | `dashboard/session-manager.ts` |
| 3 | TaskExecutor wiring for Working Nina | `dashboard/task-executor.ts` |
| 4 | Skill-tool filtering at session startup | `core/skill-filter.ts`, session-manager, task-executor |
| 5 | Migrate framework skills to `.my_agent/.claude/skills/` | Skill files (gitignored) |
| 6 | Move always-on content to `brain/`, remove dead code from prompt.ts | `core/prompt.ts`, brain files |
| 7 | Update chat-handler.ts skill resolution | `dashboard/chat-handler.ts` |
| 8 | Developer skill migration + install script | `scripts/install-dev-skills.sh` |
| 9 | Startup health check + frontmatter validation | `core/skills-health.ts` |
| 10 | Full integration verification | All |

**Dependencies:**
- Task 1 must complete before Tasks 2, 3, and 4
- Tasks 2 and 3 are independent of each other
- Task 4 depends on Task 1 (needs settingSources types) and is wired into Tasks 2+3 files
- Tasks 5 and 6 are independent of Tasks 1-4 (file operations, not code)
- Task 7 depends on Task 5 (needs skills in new location)
- Task 8 is independent
- Task 9 depends on Task 5 (needs skills to count)
- Task 10 depends on all others
