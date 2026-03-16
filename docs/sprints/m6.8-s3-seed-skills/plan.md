# M6.8-S3: Seed Skills Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract task-triage and knowledge-curation into SKILL.md files with zero behavioral degradation, validated by a three-level regression suite.

**Architecture:** Critical always-on skills are loaded by `assembleSystemPrompt()` from SKILL.md files (same delivery as today, different source). On-demand skills are discovered by the SDK. A two-phase extraction (add loading THEN shrink source) prevents content loss. Validation at each phase proves equivalence.

**Tech Stack:** TypeScript, Vitest, Debug API

**Design spec:** `docs/superpowers/specs/2026-03-16-seed-skills-design.md`

---

## Chunk 1: Phase 2a — Create Skills + Wire Loading (Before Shrinking)

### Task 1: Create task-triage SKILL.md

**Files:**
- Create: `.my_agent/.claude/skills/task-triage/SKILL.md`

This is a gitignored local operation — no commit.

- [ ] **Step 1: Create skill directory**

```bash
mkdir -p .my_agent/.claude/skills/task-triage
```

- [ ] **Step 2: Write SKILL.md with frontmatter + exact content from conversation-role.md**

Create `.my_agent/.claude/skills/task-triage/SKILL.md` with this exact content:

```markdown
---
name: task-triage
description: When to delegate work to a task vs answer directly — routing rules for create_task, WebSearch, delivery actions, and task corrections
origin: system
---

## Task Delegation

For anything beyond a quick WebSearch, use `create_task` to delegate to a working agent:
- Include ALL relevant context in the instructions — the working agent cannot see this conversation
- You can ask clarifying questions before creating a task
- Convert relative times ("in 30 minutes", "at 2pm") to absolute UTC in `scheduledFor`
- When the user mentions a location, timezone, or availability change, call `update_property` immediately

### When to use WebSearch vs create_task
- WebSearch: single factual question, one search, instant answer
- create_task: research, comparison, multi-step work, file creation, browser automation, scripting

### Delivery actions
- When the user says "send me X on WhatsApp" or "email me the results", include a `delivery` array
- If the user provides exact text to send, include it as `content` on the delivery action
- If the working agent should compose the content, omit `content`

### Task corrections
- When the user asks for changes to task results, use `revise_task` with the task ID and correction instructions
- If you don't know the task ID, use `search_tasks` to find it by description
- For simple factual questions about results you can see in the conversation, answer directly

## Autonomy

**Internal actions (safe to do freely):** Read files, explore, organize, learn, search the web, work within workspace

**External actions (ask first):** Sending emails, tweets, public posts, anything that leaves the machine

## Group Chat Behavior

- Respond when directly mentioned or when you can add genuine value
- Stay silent during casual banter or when conversation flows fine without you
- Use emoji reactions naturally to acknowledge without interrupting flow
- Participate, don't dominate
```

- [ ] **Step 3: Verify file exists**

```bash
cat .my_agent/.claude/skills/task-triage/SKILL.md | head -5
```

Expected: frontmatter header with `name: task-triage`

---

### Task 2: Create knowledge-curation SKILL.md

**Files:**
- Create: `.my_agent/.claude/skills/knowledge-curation/SKILL.md`

Gitignored local operation — no commit.

- [ ] **Step 1: Create skill directory**

```bash
mkdir -p .my_agent/.claude/skills/knowledge-curation
```

- [ ] **Step 2: Write SKILL.md**

Create `.my_agent/.claude/skills/knowledge-curation/SKILL.md`:

```markdown
---
name: knowledge-curation
description: How to propose, enrich, and manage staged knowledge facts during conversations and morning briefs
origin: system
---

# Knowledge Curation

When you learn new facts about the user during conversation, propose them for permanent storage.

## When to Propose Facts

- During natural conversation when the user shares personal information (location, travel, preferences, relationships)
- During morning briefs when staged facts are pending approval
- NOT for trivial or transient information (greetings, small talk, momentary states)

## How to Propose

- Weave proposals naturally into conversation: "I noted you mentioned Noa and Maya — shall I add them to your profile?"
- Don't interrogate — one proposal at a time, at natural moments
- If the user confirms, use `manage_staged_knowledge` with action "approve"
- If the user declines, use `manage_staged_knowledge` with action "reject"
- If uncertain, skip and propose again later

## Handling Ignored Facts

- Facts have an "attempts" counter — how many times they've been proposed
- High attempts (3+) = lower priority. Mention briefly or skip.
- Very high attempts (5+) = stop proposing. The user clearly doesn't want this stored.

## Enrichment Questions

When a fact is vague, ask one clarifying question before storing:
- "You mentioned a trip — is that for work or personal?"
- "Should I remember that as a preference or just for this time?"

## MCP Tools (provided by knowledge server)

| Tool | When to use |
|------|-------------|
| `manage_staged_knowledge` action: "approve" | User confirms a proposed fact |
| `manage_staged_knowledge` action: "reject" | User declines or corrects a fact |
| `manage_staged_knowledge` action: "skip" | Not the right moment, try later |

These tools are available when the knowledge MCP server is connected. If the tools are not available, skip knowledge curation silently.
```

- [ ] **Step 3: Verify**

```bash
cat .my_agent/.claude/skills/knowledge-curation/SKILL.md | head -5
```

---

### Task 3: Add ALWAYS_ON_SKILLS loading to prompt.ts

**Files:**
- Modify: `packages/core/src/prompt.ts` (lines 33-35, 490-496)
- Test: `packages/core/tests/prompt-always-on.test.ts`

This task adds the new loading path without changing conversation-role.md. After this task, the system prompt will temporarily contain triage content TWICE (from conversation-role.md AND from the SKILL.md). That's expected — Task 5 removes the duplicate.

- [ ] **Step 1: Write failing tests**

Add to `packages/core/tests/prompt-always-on.test.ts`:

```typescript
describe('assembleSystemPrompt — always-on skills from .claude/skills/', () => {
  const testDir = join(tmpdir(), `prompt-skills-test-${Date.now()}`)
  const brainDir = join(testDir, 'brain')
  const skillsDir = join(testDir, '.claude', 'skills', 'task-triage')

  beforeEach(() => {
    mkdirSync(brainDir, { recursive: true })
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(join(brainDir, 'AGENTS.md'), '# Test Agent\nYou are a test agent.')
    writeFileSync(
      join(skillsDir, 'SKILL.md'),
      '---\nname: task-triage\ndescription: test\norigin: system\n---\n\n## Task Delegation\n\nFor anything beyond a quick WebSearch, use `create_task`.'
    )
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('loads always-on skill content from .claude/skills/', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('For anything beyond a quick WebSearch, use `create_task`')
  })

  it('strips YAML frontmatter before injection', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('name: task-triage')
    expect(prompt).not.toContain('origin: system')
  })

  it('does not load non-always-on skills (scheduling)', async () => {
    const otherSkillDir = join(testDir, '.claude', 'skills', 'scheduling')
    mkdirSync(otherSkillDir, { recursive: true })
    writeFileSync(
      join(otherSkillDir, 'SKILL.md'),
      '---\nname: scheduling\ndescription: test\norigin: system\n---\n\n# Scheduling\n\nThis should NOT appear.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('This should NOT appear')
  })

  it('does not load knowledge-curation into always-on prompt', async () => {
    const kcDir = join(testDir, '.claude', 'skills', 'knowledge-curation')
    mkdirSync(kcDir, { recursive: true })
    writeFileSync(
      join(kcDir, 'SKILL.md'),
      '---\nname: knowledge-curation\ndescription: test\norigin: system\n---\n\n# Knowledge Curation\n\nKC content should NOT be always-on.'
    )

    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('KC content should NOT be always-on')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/prompt-always-on.test.ts`
Expected: 3 new tests FAIL (always-on skill loading doesn't exist yet)

- [ ] **Step 3: Add ALWAYS_ON_SKILLS constant and loading to prompt.ts**

In `packages/core/src/prompt.ts`, add after the `SKILL_CONTENT_FILES` constant (around line 35):

```typescript
// Always-on skills: sourced from .claude/skills/ but injected into system prompt.
// SDK skills preload (Options.skills) is not yet implemented in the runtime —
// we load these ourselves via assembleSystemPrompt() until the SDK adds support.
const ALWAYS_ON_SKILLS = ['task-triage']
```

In `assembleSystemPrompt()`, after the `loadSkillContent` block (after line 494), add:

```typescript
  // Load always-on skills from SDK skills directory
  const sdkSkillsDir = path.join(agentDir, '.claude', 'skills')
  for (const skillName of ALWAYS_ON_SKILLS) {
    const skillPath = path.join(sdkSkillsDir, skillName, 'SKILL.md')
    const content = await readOptionalFile(skillPath)
    if (content) {
      // Strip YAML frontmatter before injecting into system prompt
      const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '')
      if (body.trim()) {
        sections.push(body.trim())
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/prompt-always-on.test.ts`
Expected: All tests PASS (including 3 new + 3 existing)

- [ ] **Step 5: Run full test suite**

Run: `cd packages/core && npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/prompt.ts packages/core/tests/prompt-always-on.test.ts
git commit -m "feat(prompt): load always-on skills from .claude/skills/ (task-triage)"
```

---

### Task 4: Level 1 validation — verify triage content appears (doubled)

**Files:**
- Create: `packages/core/tests/prompt-triage-regression.test.ts`

At this point, triage content is in BOTH conversation-role.md AND the SKILL.md. This test verifies the SKILL.md content is reaching the prompt. After Task 5 (shrink), this test verifies it appears exactly once.

- [ ] **Step 1: Write Level 1 regression tests**

Create `packages/core/tests/prompt-triage-regression.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assembleSystemPrompt } from '../src/prompt.js'

// Key sentences from task-triage that MUST appear in the system prompt
const TRIAGE_DIRECTIVES = [
  'For anything beyond a quick WebSearch, use `create_task`',
  'WebSearch: single factual question, one search, instant answer',
  'create_task: research, comparison, multi-step work',
  'Include ALL relevant context in the instructions',
  'When the user says "send me X on WhatsApp"',
  'use `revise_task` with the task ID',
  'Internal actions (safe to do freely)',
  'External actions (ask first)',
  'Respond when directly mentioned or when you can add genuine value',
]

// Identity sentences that MUST stay in conversation-role.md
const IDENTITY_SENTENCES = [
  'You are the conversation layer',
  'What you do directly',
  'What you delegate',
]

describe('Level 1: task-triage content preserved in system prompt', () => {
  const testDir = join(tmpdir(), `triage-regression-${Date.now()}`)
  const brainDir = join(testDir, 'brain')
  const skillsDir = join(testDir, '.claude', 'skills', 'task-triage')

  beforeEach(() => {
    mkdirSync(brainDir, { recursive: true })
    mkdirSync(skillsDir, { recursive: true })
    writeFileSync(join(brainDir, 'AGENTS.md'), '# Test Agent\nYou are a test agent.')

    // Reduced conversation-role.md (identity only, after extraction)
    writeFileSync(
      join(brainDir, 'conversation-role.md'),
      `## Your Role: Conversation Agent

You are the conversation layer. You talk, think, plan, brainstorm, advise, clarify, and decide. You do not do work yourself — working agents do the work.

When the user asks you to research something, compare options, write code, analyze data, or produce any artifact — delegate it to a working agent via \`create_task\`. You can discuss the approach, ask clarifying questions, refine the scope, and review the results. But the execution is always delegated.

You have a read-only research helper for quick context gathering (reading files, searching code). Use it freely for understanding context. But if the answer requires multi-step work, creation, or external actions — create a task.

### What you do directly
- Conversation: discuss, clarify, advise, brainstorm, plan
- Quick lookups: WebSearch for simple facts, research helper for reading files
- Memory: recall, daily logs, notebook reads/writes
- Task management: create tasks, search past tasks, revise completed tasks, update properties

### What you delegate
- Research and analysis
- File creation and editing
- Code writing and execution
- Browser automation
- Multi-step comparisons
- Anything that produces artifacts`
    )

    // task-triage SKILL.md (extracted content)
    writeFileSync(
      join(skillsDir, 'SKILL.md'),
      `---
name: task-triage
description: When to delegate work to a task vs answer directly
origin: system
---

## Task Delegation

For anything beyond a quick WebSearch, use \`create_task\` to delegate to a working agent:
- Include ALL relevant context in the instructions — the working agent cannot see this conversation
- You can ask clarifying questions before creating a task
- Convert relative times ("in 30 minutes", "at 2pm") to absolute UTC in \`scheduledFor\`
- When the user mentions a location, timezone, or availability change, call \`update_property\` immediately

### When to use WebSearch vs create_task
- WebSearch: single factual question, one search, instant answer
- create_task: research, comparison, multi-step work, file creation, browser automation, scripting

### Delivery actions
- When the user says "send me X on WhatsApp" or "email me the results", include a \`delivery\` array
- If the user provides exact text to send, include it as \`content\` on the delivery action
- If the working agent should compose the content, omit \`content\`

### Task corrections
- When the user asks for changes to task results, use \`revise_task\` with the task ID and correction instructions
- If you don't know the task ID, use \`search_tasks\` to find it by description
- For simple factual questions about results you can see in the conversation, answer directly

## Autonomy

**Internal actions (safe to do freely):** Read files, explore, organize, learn, search the web, work within workspace

**External actions (ask first):** Sending emails, tweets, public posts, anything that leaves the machine

## Group Chat Behavior

- Respond when directly mentioned or when you can add genuine value
- Stay silent during casual banter or when conversation flows fine without you
- Use emoji reactions naturally to acknowledge without interrupting flow
- Participate, don't dominate`
    )
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('contains ALL triage directives after extraction', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    for (const directive of TRIAGE_DIRECTIVES) {
      expect(prompt, `Missing directive: "${directive}"`).toContain(directive)
    }
  })

  it('contains identity sentences from conversation-role.md', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    for (const sentence of IDENTITY_SENTENCES) {
      expect(prompt, `Missing identity: "${sentence}"`).toContain(sentence)
    }
  })

  it('does NOT double-include triage content', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    const count = (prompt.match(/For anything beyond a quick WebSearch/g) || []).length
    expect(count, 'Triage content appears more than once').toBe(1)
  })

  it('does NOT include YAML frontmatter in prompt', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).not.toContain('name: task-triage')
    expect(prompt).not.toContain('origin: system')
  })
})
```

- [ ] **Step 2: Run tests**

Run: `cd packages/core && npx vitest run tests/prompt-triage-regression.test.ts`
Expected: All PASS (the reduced conversation-role.md + SKILL.md together produce exactly one copy of each directive)

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/prompt-triage-regression.test.ts
git commit -m "test(prompt): Level 1 triage regression — validates zero content degradation"
```

---

## Chunk 2: Phase 2b — Shrink conversation-role.md + Level 2

### Task 5: Shrink conversation-role.md to identity only

**Files:**
- Modify: `.my_agent/brain/conversation-role.md`

Gitignored local operation. **Take a backup first.**

- [ ] **Step 1: Backup current file**

```bash
cp .my_agent/brain/conversation-role.md .my_agent/brain/conversation-role.md.bak
```

- [ ] **Step 2: Replace with identity-only content**

Overwrite `.my_agent/brain/conversation-role.md` with lines 1-22 only (everything before `## Task Delegation`):

```markdown
## Your Role: Conversation Agent

You are the conversation layer. You talk, think, plan, brainstorm, advise, clarify, and decide. You do not do work yourself — working agents do the work.

When the user asks you to research something, compare options, write code, analyze data, or produce any artifact — delegate it to a working agent via `create_task`. You can discuss the approach, ask clarifying questions, refine the scope, and review the results. But the execution is always delegated.

You have a read-only research helper for quick context gathering (reading files, searching code). Use it freely for understanding context. But if the answer requires multi-step work, creation, or external actions — create a task.

### What you do directly
- Conversation: discuss, clarify, advise, brainstorm, plan
- Quick lookups: WebSearch for simple facts, research helper for reading files
- Memory: recall, daily logs, notebook reads/writes
- Task management: create tasks, search past tasks, revise completed tasks, update properties

### What you delegate
- Research and analysis
- File creation and editing
- Code writing and execution
- Browser automation
- Multi-step comparisons
- Anything that produces artifacts
```

- [ ] **Step 3: Verify via debug API — triage content still in prompt**

```bash
curl -s http://localhost:4321/api/debug/brain/prompt | python3 -c "
import sys, json
prompt = json.load(sys.stdin).get('systemPrompt', '')
directives = [
  'For anything beyond a quick WebSearch, use \`create_task\`',
  'WebSearch: single factual question',
  'create_task: research, comparison',
  'use \`revise_task\` with the task ID',
  'Internal actions (safe to do freely)',
]
for d in directives:
  assert d in prompt, f'MISSING: {d}'
print('All triage directives present. PASS')

# Verify no double inclusion
count = prompt.count('For anything beyond a quick WebSearch')
assert count == 1, f'Double inclusion! count={count}'
print('No double inclusion. PASS')
"
```

- [ ] **Step 4: Verify identity still present**

```bash
curl -s http://localhost:4321/api/debug/brain/prompt | python3 -c "
import sys, json
prompt = json.load(sys.stdin).get('systemPrompt', '')
assert 'You are the conversation layer' in prompt, 'Identity missing!'
assert 'What you do directly' in prompt, 'Identity section missing!'
print('Identity present. PASS')
"
```

---

### Task 6: Level 2 validation — skill discovery

**Files:**
- None (debug API verification only)

- [ ] **Step 1: Verify task-triage in skills list**

```bash
curl -s http://localhost:4321/api/debug/brain/skills | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [s['name'] for s in data.get('user', [])]
assert 'task-triage' in names, f'task-triage not found! Found: {names}'
print('task-triage found in SDK skills. PASS')
"
```

- [ ] **Step 2: Verify knowledge-curation in skills list**

```bash
curl -s http://localhost:4321/api/debug/brain/skills | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [s['name'] for s in data.get('user', [])]
assert 'knowledge-curation' in names, f'knowledge-curation not found! Found: {names}'
print('knowledge-curation found in SDK skills. PASS')
"
```

- [ ] **Step 3: Verify health check count increased**

```bash
# Should now report 7 skills (was 5 in S2: identity, personality, operating-rules, auth, scheduling + 2 new)
curl -s http://localhost:4321/api/debug/brain/status | python3 -c "
import sys, json
# Or just restart dashboard and check logs:
" || echo "Check journalctl for: [Skills] 7 skill(s) discovered"
```

---

## Chunk 3: Level 3 Behavioral Validation

### Task 7: Level 3 validation — behavioral scenario tests

**Files:**
- Create: `packages/core/tests/triage-behavioral.test.ts`

These tests verify the LLM makes the same routing decisions with the extracted skill content. They build the full system prompt via `assembleSystemPrompt()`, then use the Anthropic SDK directly (not `queryModel()` — avoids circular cross-package imports).

**Important:** Integration tests that call a real LLM. Slow (5-10s each), probabilistic. Run manually, not in CI.

- [ ] **Step 1: Create behavioral test file**

Create `packages/core/tests/triage-behavioral.test.ts`:

```typescript
/**
 * Level 3: Behavioral Regression Tests
 *
 * Verifies that Nina's routing decisions (delegate vs direct) are unchanged
 * after extracting task-triage into a SKILL.md.
 *
 * Uses the Anthropic SDK directly (not queryModel from dashboard — avoids
 * circular cross-package dependency). Calls claude-haiku for fast, cheap
 * classification.
 *
 * Run: cd packages/core && npx vitest run tests/triage-behavioral.test.ts --timeout 120000
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { assembleSystemPrompt } from '../src/prompt.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

// Skip entirely if .my_agent doesn't exist (CI / fresh clone)
const AGENT_DIR = join(import.meta.dirname, '../../../.my_agent')
const BRAIN_DIR = join(AGENT_DIR, 'brain')
const HAS_AGENT = existsSync(BRAIN_DIR)

// Skip if no API key
const HAS_AUTH = !!process.env.ANTHROPIC_API_KEY

const describeIf = HAS_AGENT && HAS_AUTH ? describe : describe.skip

describeIf('Level 3: triage routing decisions (live LLM)', () => {
  let systemPrompt: string
  let client: Anthropic

  beforeAll(async () => {
    systemPrompt = await assembleSystemPrompt(BRAIN_DIR)
    client = new Anthropic()
  })

  async function queryRouting(userMessage: string): Promise<string> {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Respond with ONLY one word — "DELEGATE" if you would use create_task for this, or "DIRECT" if you would answer directly or use WebSearch/recall.\n\nUser message: "${userMessage}"`,
      }],
    })

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('')
    return text.trim().toUpperCase()
  }

  // Run each scenario 3x, expect 2/3 match (per spec)
  async function assertRouting(message: string, expected: 'DELEGATE' | 'DIRECT') {
    const results: string[] = []
    for (let i = 0; i < 3; i++) {
      results.push(await queryRouting(message))
    }
    const matches = results.filter(r => r.includes(expected)).length
    expect(matches, `Expected ${expected} for "${message}" but got: ${results}`).toBeGreaterThanOrEqual(2)
  }

  it('delegates research requests', async () => {
    await assertRouting('Research the best flights to Tokyo next week', 'DELEGATE')
  }, 30000)

  it('answers time questions directly', async () => {
    await assertRouting('What time is it in Tokyo?', 'DIRECT')
  }, 30000)

  it('delegates code writing', async () => {
    await assertRouting('Write a script to backup my notebook daily', 'DELEGATE')
  }, 30000)

  it('answers factual questions directly', async () => {
    await assertRouting('Who is the president of France?', 'DIRECT')
  }, 30000)

  it('delegates comparative analysis', async () => {
    await assertRouting('Compare the top 3 project management tools', 'DELEGATE')
  }, 30000)

  it('delegates tasks with delivery actions', async () => {
    await assertRouting('Research Tokyo restaurants and send me the list on WhatsApp', 'DELEGATE')
  }, 30000)
})
```

- [ ] **Step 2: Run behavioral tests (manual, requires LLM)**

Run: `cd packages/core && npx vitest run tests/triage-behavioral.test.ts --timeout 60000`

**Note:** This will be slow (~30-60s total) and requires auth. If running inside Claude Code, it will fail due to nested session limitation. In that case, run it outside Claude Code or accept Level 1+2 as sufficient and test Level 3 manually by chatting with Nina.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/triage-behavioral.test.ts
git commit -m "test(triage): Level 3 behavioral regression — live LLM routing validation"
```

---

## Chunk 4: Cleanup + Final Verification

### Task 8: Update existing tests for reduced conversation-role.md

**Files:**
- Modify: `packages/core/tests/prompt-always-on.test.ts` (update test data if needed)

- [ ] **Step 1: Run full test suites**

```bash
cd packages/core && npx vitest run
cd packages/dashboard && npx vitest run
```

Expected: All existing tests PASS. The only files that changed in git are `prompt.ts` and test files.

- [ ] **Step 2: Verify no morning-sequence or daily-summary extraction**

```bash
# These should NOT exist as skills
ls .my_agent/.claude/skills/morning-sequence 2>/dev/null && echo "FAIL: morning-sequence was extracted" || echo "PASS: morning-sequence stays in TypeScript"
ls .my_agent/.claude/skills/daily-summary 2>/dev/null && echo "FAIL: daily-summary was extracted" || echo "PASS: daily-summary stays in TypeScript"
```

- [ ] **Step 3: Final commit if any fixups needed**

```bash
git add -p  # Stage only relevant changes
git commit -m "fix: S3 integration fixups"
```

---

### Task 9: Full validation summary

Run all three levels and produce a summary:

- [ ] **Step 1: Level 1 — prompt content**

```bash
cd packages/core && npx vitest run tests/prompt-triage-regression.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 2: Level 2 — skill discovery (requires running dashboard)**

```bash
# Restart dashboard to pick up new skills
systemctl --user restart nina-dashboard.service
sleep 5

curl -s http://localhost:4321/api/debug/brain/skills | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [s['name'] for s in data.get('user', [])]
expected = ['task-triage', 'knowledge-curation', 'identity', 'personality', 'operating-rules', 'auth', 'scheduling']
for name in expected:
  status = 'PASS' if name in names else 'FAIL'
  print(f'  {status}: {name}')
"
```

- [ ] **Step 3: Level 3 — behavioral (manual or skip)**

If running outside Claude Code:
```bash
cd packages/core && npx vitest run tests/triage-behavioral.test.ts --timeout 60000
```

Otherwise: chat with Nina via dashboard, verify she still delegates correctly.

- [ ] **Step 4: Record results**

Create `docs/sprints/m6.8-s3-seed-skills/validation-results.md` with:
- Level 1: X/4 tests pass
- Level 2: X/7 skills discovered
- Level 3: X/6 routing scenarios correct (or "manual verification: PASS/FAIL")

---

## Summary

| Task | Description | Touches |
|------|-------------|---------|
| 1 | Create task-triage SKILL.md | `.my_agent/.claude/skills/` (gitignored) |
| 2 | Create knowledge-curation SKILL.md | `.my_agent/.claude/skills/` (gitignored) |
| 3 | Add ALWAYS_ON_SKILLS loading to prompt.ts | `core/prompt.ts`, tests |
| 4 | Level 1 regression tests | `core/tests/prompt-triage-regression.test.ts` |
| 5 | Shrink conversation-role.md | `.my_agent/brain/` (gitignored) |
| 6 | Level 2 validation via debug API | Verification only |
| 7 | Level 3 behavioral tests | `core/tests/triage-behavioral.test.ts` |
| 8 | Run full test suite + negative checks | Verification only |
| 9 | Full validation summary | `docs/sprints/m6.8-s3-seed-skills/validation-results.md` |

**Dependencies:**
- Tasks 1-2 are independent (file creation)
- Task 3 depends on Task 1 (needs SKILL.md to load)
- Task 4 depends on Task 3 (tests the loading)
- Task 5 depends on Task 4 (shrink only after loading verified)
- Task 6 depends on Tasks 1, 2, 5 (all files in place)
- Task 7 is independent (can run anytime after Task 3)
- Task 8 depends on Tasks 3, 5
- Task 9 depends on all others

**Two-phase safety:**
- After Task 3: triage content appears TWICE (old + new). Level 1 confirms new path works.
- After Task 5: triage content appears ONCE (new only). Level 1 confirms no loss.
- If anything breaks: restore `conversation-role.md.bak`, remove `ALWAYS_ON_SKILLS` from prompt.ts.
