# M6.8-S4: Curated Library Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 5 curated skills adapted from Superpowers and BMAD, introduce `origin: curated` tier, and wire hatching to copy framework skills to new agent instances.

**Architecture:** Curated skills live in `packages/core/skills/` (committed to repo) and are copied to `.my_agent/.claude/skills/` at hatch time. They use `origin: curated` — a new tier between `system` (infrastructure) and `user` (agent-created). Curated skills are not disableable by users.

**Tech Stack:** TypeScript, Vitest, YAML frontmatter, CSV

**Design spec:** `docs/superpowers/specs/2026-03-15-skills-architecture-design.md` (Section: Curated Skill Library)

---

## Design Decision: `origin: curated`

Three-tier origin model:

| Origin | What | Toggleable | Shipped with | Example |
|--------|------|-----------|-------------|---------|
| `system` | Core infrastructure | No | Framework | task-triage, knowledge-curation |
| `curated` | Framework capabilities | No | Framework | brainstorming, debugging, techniques |
| `user` | Agent-created | Yes | Instance | customer-support, meeting-prep |

`curated` = feature layer. Framework maintainers add capabilities (brainstorming, image generation, code review) that every agent instance gets at hatching. Users cannot disable them. Dashboard (S6) shows them as view-only, same as system skills.

---

## Chunk 1: Curated Skills — Superpowers Adaptations

### Task 1: Create brainstorming skill

**Files:**
- Create: `packages/core/skills/brainstorming/SKILL.md`

Adapted from `superpowers:brainstorming`. Stripped: Visual Companion (M6.10), spec review loop (subagent not available in Nina context), superpowers-specific paths, TodoWrite task tracking, implementation handoff (Nina delegates via create_task). Kept: question flow, approach proposals, design presentation, YAGNI, one-question-at-a-time discipline.

- [ ] **Step 1: Create skill directory**

```bash
mkdir -p packages/core/skills/brainstorming
```

- [ ] **Step 2: Write SKILL.md**

Create `packages/core/skills/brainstorming/SKILL.md`:

```markdown
---
name: brainstorming
description: Collaborative design exploration — use before any creative work, new features, architecture changes, or behavior modifications. Explores intent, requirements, and design before implementation.
origin: curated
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs through natural collaborative dialogue.

Start by understanding the current context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get approval.

<HARD-GATE>
Do NOT begin any implementation until you have presented a design and the user has approved it. This applies to EVERY project regardless of perceived simplicity.
</HARD-GATE>

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every project goes through this process. A todo list, a single-function utility, a config change — all of them. "Simple" projects are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple projects), but you MUST present it and get approval.

## Process

1. **Explore context** — check relevant files, docs, recent changes
2. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
3. **Propose 2-3 approaches** — with trade-offs and your recommendation
4. **Present design** — in sections scaled to complexity, get approval after each section
5. **Document design** — save validated design for implementation reference
6. **Hand off** — delegate implementation to a working agent

## Understanding the Idea

- Check current project state first (files, docs, recent changes)
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems, flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
- If the project is too large for a single design, help decompose into sub-projects: what are the independent pieces, how do they relate, what order should they be built?
- Ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message
- Focus on understanding: purpose, constraints, success criteria

## Exploring Approaches

- Propose 2-3 different approaches with trade-offs
- Present options conversationally with your recommendation and reasoning
- Lead with your recommended option and explain why

## Presenting the Design

- Scale each section to its complexity: a few sentences if straightforward, up to 200-300 words if nuanced
- Ask after each section whether it looks right so far
- Cover: architecture, components, data flow, error handling, testing
- Be ready to go back and clarify if something doesn't make sense

## Design Principles

- **Isolation and clarity** — break systems into smaller units with one clear purpose, well-defined interfaces, testable independently
- **Work in existing codebases** — explore current structure before proposing changes, follow existing patterns
- **YAGNI ruthlessly** — remove unnecessary features from all designs
- **Incremental validation** — present design, get approval before moving on

## Key Rules

- **One question at a time** — don't overwhelm with multiple questions
- **Multiple choice preferred** — easier to answer than open-ended when possible
- **Explore alternatives** — always propose 2-3 approaches before settling
- **Be flexible** — go back and clarify when something doesn't make sense
```

- [ ] **Step 3: Verify file**

```bash
head -5 packages/core/skills/brainstorming/SKILL.md
```

Expected: frontmatter with `name: brainstorming`, `origin: curated`

---

### Task 2: Create systematic-debugging skill

**Files:**
- Create: `packages/core/skills/systematic-debugging/SKILL.md`

Adapted from `superpowers:systematic-debugging`. Supporting techniques (root-cause-tracing, defense-in-depth, condition-based-waiting) inlined as sections instead of external file references. Removed references to other superpowers skills. Kept: all 4 phases, iron law, red flags, rationalizations table.

- [ ] **Step 1: Create skill directory**

```bash
mkdir -p packages/core/skills/systematic-debugging
```

- [ ] **Step 2: Write SKILL.md**

Create `packages/core/skills/systematic-debugging/SKILL.md`:

```markdown
---
name: systematic-debugging
description: Methodical 4-phase debugging — root cause investigation, pattern analysis, hypothesis testing, implementation. Use for any bug, test failure, or unexpected behavior before proposing fixes.
origin: curated
allowed-tools: [Read, Grep, Glob, Write, Edit, Bash]
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue: test failures, bugs, unexpected behavior, performance problems, build failures, integration issues.

**Use this ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work

**Don't skip when:**
- Issue seems simple (simple bugs have root causes too)
- You're in a hurry (systematic is faster than thrashing)

## The Four Phases

Complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce Consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - If not reproducible, gather more data — don't guess

3. **Check Recent Changes**
   - What changed that could cause this?
   - Git diff, recent commits
   - New dependencies, config changes

4. **Gather Evidence in Multi-Component Systems**

   WHEN system has multiple components (CI -> build -> signing, API -> service -> database):

   BEFORE proposing fixes, add diagnostic instrumentation:
   - For EACH component boundary: log what data enters, log what exits
   - Verify environment/config propagation
   - Run once to gather evidence showing WHERE it breaks
   - THEN analyze evidence to identify failing component
   - THEN investigate that specific component

5. **Trace Data Flow (Root Cause Tracing)**

   When error is deep in the call stack, trace backward:

   - **Observe the symptom** — what error appears?
   - **Find immediate cause** — what code directly causes this?
   - **Ask: what called this?** — trace up through the call chain
   - **Keep tracing up** — what value was passed? Where did it come from?
   - **Find original trigger** — fix at the source, not the symptom

   When you can't trace manually, add stack trace instrumentation:
   ```typescript
   const stack = new Error().stack;
   console.error('DEBUG:', { value, cwd: process.cwd(), stack });
   ```

   **NEVER fix just where the error appears.** Trace back to the original trigger.

### Phase 2: Pattern Analysis

1. **Find Working Examples** — locate similar working code in same codebase
2. **Compare Against References** — read reference implementations COMPLETELY, don't skim
3. **Identify Differences** — list every difference, however small
4. **Understand Dependencies** — what components, settings, environment does this need?

### Phase 3: Hypothesis and Testing

1. **Form Single Hypothesis** — "I think X is the root cause because Y"
2. **Test Minimally** — smallest possible change, one variable at a time
3. **Verify Before Continuing** — worked? Phase 4. Didn't work? New hypothesis. DON'T add more fixes on top.

### Phase 4: Implementation

1. **Create Failing Test Case** — simplest reproduction, automated if possible
2. **Implement Single Fix** — address root cause, ONE change at a time, no "while I'm here" improvements
3. **Verify Fix** — test passes? No other tests broken? Issue resolved?
4. **If Fix Doesn't Work:**
   - Count: how many fixes have you tried?
   - If < 3: return to Phase 1 with new information
   - If >= 3: STOP and question the architecture (see below)

5. **If 3+ Fixes Failed: Question Architecture**

   Pattern indicating architectural problem: each fix reveals new coupling, requires massive refactoring, or creates new symptoms elsewhere.

   STOP and question fundamentals:
   - Is this pattern fundamentally sound?
   - Should we refactor architecture vs continue fixing symptoms?
   - Discuss with the user before attempting more fixes

   This is NOT a failed hypothesis — this is a wrong architecture.

## Defense-in-Depth

After fixing a root cause, add validation at EVERY layer data passes through:

| Layer | Purpose | Example |
|-------|---------|---------|
| Entry point | Reject invalid input at API boundary | Validate params exist, correct type |
| Business logic | Ensure data makes sense for operation | Operation-specific checks |
| Environment guards | Prevent dangerous ops in specific contexts | Refuse destructive ops outside tmpdir in tests |
| Debug instrumentation | Capture context for forensics | Stack trace logging before dangerous operations |

All four layers are often necessary — different code paths bypass different layers.

## Condition-Based Waiting (for flaky tests)

When debugging flaky tests with arbitrary delays:

```typescript
// BAD: guessing at timing
await new Promise(r => setTimeout(r, 50));

// GOOD: waiting for actual condition
await waitFor(() => getResult() !== undefined);
```

Wait for the actual condition you care about, not a guess about how long it takes.

## Red Flags — STOP and Follow Process

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "One more fix attempt" (when already tried 2+)
- Proposing solutions before tracing data flow

**ALL of these mean: STOP. Return to Phase 1.**

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "Multiple fixes at once saves time" | Can't isolate what worked. Causes new bugs. |
| "I see the problem, let me fix it" | Seeing symptoms != understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question pattern, don't fix again. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, reproduce, check changes, gather evidence, trace data flow | Understand WHAT and WHY |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Form theory, test minimally | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify, defense-in-depth | Bug resolved, tests pass |
```

- [ ] **Step 3: Verify file**

```bash
head -5 packages/core/skills/systematic-debugging/SKILL.md
```

Expected: frontmatter with `name: systematic-debugging`, `origin: curated`, `allowed-tools`

---

### Task 3: Create writing-plans skill

**Files:**
- Create: `packages/core/skills/writing-plans/SKILL.md`

Adapted from `superpowers:writing-plans`. Stripped: superpowers-specific paths (`docs/superpowers/plans/`), plan review loop (subagent dispatch), execution handoff to other superpowers skills. Kept: zero-context assumption, file structure mapping, bite-sized TDD tasks, complete code examples, DRY/YAGNI/TDD principles.

- [ ] **Step 1: Create skill directory**

```bash
mkdir -p packages/core/skills/writing-plans
```

- [ ] **Step 2: Write SKILL.md**

Create `packages/core/skills/writing-plans/SKILL.md`:

```markdown
---
name: writing-plans
description: Create comprehensive implementation plans for multi-step tasks — assumes zero codebase context, bite-sized TDD steps, exact file paths, complete code examples
origin: curated
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob]
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for the codebase. Document everything they need to know: which files to touch, code, testing, docs to check, how to verify. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about the toolset or problem domain. Assume they don't know good test design very well.

## Scope Check

If the spec covers multiple independent subsystems, suggest breaking into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" — step
- "Run it to make sure it fails" — step
- "Implement the minimal code to make the test pass" — step
- "Run the tests and make sure they pass" — step
- "Commit" — step

## Plan Document Header

Every plan MUST start with:

```markdown
# [Feature Name] Implementation Plan

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts:123-145`
- Test: `tests/exact/path/to/test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('does specific thing', () => {
  const result = fn(input)
  expect(result).toBe(expected)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/path/test.ts`
Expected: FAIL with "fn is not defined"

- [ ] **Step 3: Write minimal implementation**

```typescript
export function fn(input: Type): ReturnType {
  return expected
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/path/test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.ts src/path/file.ts
git commit -m "feat: add specific feature"
```
````

## Remember

- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits
- Steps use checkbox (`- [ ]`) syntax for tracking
```

- [ ] **Step 3: Verify file**

```bash
head -5 packages/core/skills/writing-plans/SKILL.md
```

Expected: frontmatter with `name: writing-plans`, `origin: curated`, `allowed-tools`

---

## Chunk 2: Curated Skills — BMAD Technique Libraries

### Task 4: Create brainstorming-techniques skill

**Files:**
- Create: `packages/core/skills/brainstorming-techniques/SKILL.md`
- Create: `packages/core/skills/brainstorming-techniques/data/brain-methods.csv`

Wraps the BMAD brainstorming techniques CSV (56 techniques across 10 categories) as reference data. The skill instructs the agent to select techniques silently based on context — never announce technique names to the user.

- [ ] **Step 1: Create skill directories**

```bash
mkdir -p packages/core/skills/brainstorming-techniques/data
```

- [ ] **Step 2: Write SKILL.md**

Create `packages/core/skills/brainstorming-techniques/SKILL.md`:

```markdown
---
name: brainstorming-techniques
description: 56 brainstorming techniques across 10 categories (creative, structured, deep, collaborative, theatrical, wild, introspective, biomimetic, quantum, cultural) — reference data for enriching brainstorming sessions
origin: curated
---

# Brainstorming Techniques Library

A library of 56 brainstorming techniques for enriching creative exploration. These are reference data — select and apply techniques silently based on the conversation context.

## Usage Rules

1. **Silent application** — select techniques internally based on context. Do NOT announce technique names to the user. Do NOT present technique menus.
2. **Context-driven selection** — match techniques to the situation:
   - Stuck on an approach? Try Reversal Inversion or First Principles
   - Need creative ideas? Try Cross-Pollination or Concept Blending
   - Exploring risks? Try Failure Analysis or Chaos Engineering
   - Need structure? Try SCAMPER, Six Thinking Hats, or Morphological Analysis
   - Want depth? Try Five Whys or Question Storming
3. **Combine freely** — use multiple techniques in a single session when useful
4. **Natural conversation** — weave technique patterns into natural dialogue, not formulaic steps

## Technique Reference

Read `data/brain-methods.csv` for the complete library. CSV columns: `category`, `technique_name`, `description`.

Categories: collaborative, creative, deep, introspective_delight, structured, theatrical, wild, biomimetic, quantum, cultural
```

- [ ] **Step 3: Download and save CSV**

Fetch `brain-methods.csv` from BMAD-METHOD repo and save to `packages/core/skills/brainstorming-techniques/data/brain-methods.csv`.

- [ ] **Step 4: Verify**

```bash
wc -l packages/core/skills/brainstorming-techniques/data/brain-methods.csv
head -3 packages/core/skills/brainstorming-techniques/data/brain-methods.csv
```

Expected: ~57 lines (header + 56 techniques), CSV format with category,technique_name,description

---

### Task 5: Create elicitation-techniques skill

**Files:**
- Create: `packages/core/skills/elicitation-techniques/SKILL.md`
- Create: `packages/core/skills/elicitation-techniques/data/methods.csv`

Wraps the BMAD elicitation techniques CSV (50 methods across 11 categories). Same silent-application pattern.

- [ ] **Step 1: Create skill directories**

```bash
mkdir -p packages/core/skills/elicitation-techniques/data
```

- [ ] **Step 2: Write SKILL.md**

Create `packages/core/skills/elicitation-techniques/SKILL.md`:

```markdown
---
name: elicitation-techniques
description: 50 advanced elicitation methods across 11 categories (collaboration, creative, risk, technical, research, core, advanced, competitive, learning, philosophical, retrospective) — reference data for requirement gathering, analysis, and problem-solving
origin: curated
---

# Elicitation Techniques Library

A library of 50 elicitation methods for enriching requirement gathering, analysis, and problem-solving. These are reference data — select and apply methods silently based on the conversation context.

## Usage Rules

1. **Silent application** — select methods internally based on context. Do NOT announce method names or present menus.
2. **Context-driven selection** — match methods to the situation:
   - Gathering requirements? Try Stakeholder Round Table or User Persona Focus Group
   - Analyzing risk? Try Pre-mortem Analysis or Failure Mode Analysis
   - Need depth? Try First Principles Analysis, 5 Whys, or Socratic Questioning
   - Complex reasoning? Try Tree of Thoughts or Graph of Thoughts
   - Competitive analysis? Try Red Team vs Blue Team or Shark Tank Pitch
   - Technical decisions? Try Architecture Decision Records or Algorithm Olympics
3. **Combine freely** — use multiple methods in a single session when useful
4. **Natural conversation** — weave method patterns into natural dialogue

## Technique Reference

Read `data/methods.csv` for the complete library. CSV columns: `num`, `category`, `method_name`, `description`, `output_pattern`.

Categories: collaboration, advanced, competitive, technical, creative, research, risk, core, learning, philosophical, retrospective
```

- [ ] **Step 3: Download and save CSV**

Fetch `methods.csv` from BMAD-METHOD repo and save to `packages/core/skills/elicitation-techniques/data/methods.csv`.

- [ ] **Step 4: Verify**

```bash
wc -l packages/core/skills/elicitation-techniques/data/methods.csv
head -3 packages/core/skills/elicitation-techniques/data/methods.csv
```

Expected: 51 lines (header + 50 methods), CSV format

---

## Chunk 3: Hatching Integration

### Task 6: Add curated skill copying to hatching

**Files:**
- Modify: `packages/core/src/hatching/index.ts` (lines 25-35)
- Modify: `packages/core/src/hatching/logic.ts` (lines 9-19, if duplicate exists)
- Test: `packages/core/tests/hatching-skills-copy.test.ts`

Add a step after `createDirectoryStructure()` that copies all skill directories from `packages/core/skills/` to `.my_agent/.claude/skills/`. Only copies directories containing `SKILL.md` (skips `conversation-role.md` which is a flat file, not a skill directory).

- [ ] **Step 1: Write failing test**

Create `packages/core/tests/hatching-skills-copy.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyFrameworkSkills } from '../src/hatching/skills-copy.js'

describe('copyFrameworkSkills', () => {
  const testDir = join(tmpdir(), `hatching-skills-test-${Date.now()}`)
  const skillsTarget = join(testDir, '.claude', 'skills')

  beforeEach(() => {
    mkdirSync(skillsTarget, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('copies skill directories with SKILL.md', async () => {
    await copyFrameworkSkills(testDir)

    // Check at least one curated skill was copied
    expect(existsSync(join(skillsTarget, 'brainstorming', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillsTarget, 'systematic-debugging', 'SKILL.md'))).toBe(true)
  })

  it('copies subdirectories (data/ with CSVs)', async () => {
    await copyFrameworkSkills(testDir)

    expect(existsSync(join(skillsTarget, 'brainstorming-techniques', 'data', 'brain-methods.csv'))).toBe(true)
    expect(existsSync(join(skillsTarget, 'elicitation-techniques', 'data', 'methods.csv'))).toBe(true)
  })

  it('does not copy non-skill files (conversation-role.md)', async () => {
    await copyFrameworkSkills(testDir)

    expect(existsSync(join(skillsTarget, 'conversation-role.md'))).toBe(false)
  })

  it('preserves existing skills (does not overwrite)', async () => {
    // Create an existing skill with custom content
    const existingDir = join(skillsTarget, 'brainstorming')
    mkdirSync(existingDir, { recursive: true })
    writeFileSync(join(existingDir, 'SKILL.md'), 'custom content')

    await copyFrameworkSkills(testDir)

    // Should NOT overwrite
    expect(readFileSync(join(existingDir, 'SKILL.md'), 'utf-8')).toBe('custom content')
  })

  it('copies framework skills with correct origin in frontmatter', async () => {
    await copyFrameworkSkills(testDir)

    const content = readFileSync(join(skillsTarget, 'brainstorming', 'SKILL.md'), 'utf-8')
    expect(content).toContain('origin: curated')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/core && npx vitest run tests/hatching-skills-copy.test.ts
```

Expected: FAIL — `copyFrameworkSkills` doesn't exist yet

- [ ] **Step 3: Implement copyFrameworkSkills**

Create `packages/core/src/hatching/skills-copy.ts`:

```typescript
import { existsSync } from 'node:fs'
import { readdir, cp, mkdir } from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Copy framework skills from packages/core/skills/ to the agent's .claude/skills/ directory.
 * Only copies directories containing a SKILL.md file.
 * Does NOT overwrite existing skills (preserves user customizations).
 */
export async function copyFrameworkSkills(agentDir: string): Promise<void> {
  const frameworkSkillsDir = path.resolve(
    import.meta.dirname,
    '../../skills',
  )
  const targetDir = path.join(agentDir, '.claude', 'skills')

  if (!existsSync(frameworkSkillsDir)) {
    console.warn('[Skills] Framework skills directory not found:', frameworkSkillsDir)
    return
  }

  await mkdir(targetDir, { recursive: true })

  const entries = await readdir(frameworkSkillsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const srcSkillMd = path.join(frameworkSkillsDir, entry.name, 'SKILL.md')
    if (!existsSync(srcSkillMd)) continue

    const targetSkillDir = path.join(targetDir, entry.name)
    const targetSkillMd = path.join(targetSkillDir, 'SKILL.md')

    // Do not overwrite existing skills
    if (existsSync(targetSkillMd)) {
      continue
    }

    await cp(
      path.join(frameworkSkillsDir, entry.name),
      targetSkillDir,
      { recursive: true },
    )
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/core && npx vitest run tests/hatching-skills-copy.test.ts
```

Expected: All PASS

- [ ] **Step 5: Wire into hatching**

In `packages/core/src/hatching/index.ts`, after `createDirectoryStructure(agentDir)` (line 57), add:

```typescript
import { copyFrameworkSkills } from './skills-copy.js'

// In runHatching(), after createDirectoryStructure:
await copyFrameworkSkills(agentDir)
```

- [ ] **Step 6: Run full test suite**

```bash
cd packages/core && npx vitest run
```

Expected: All PASS

---

## Chunk 4: Deploy to Current Instance + Validation

### Task 7: Copy curated skills to current .my_agent instance

**Files:**
- `.my_agent/.claude/skills/` (gitignored, local operation)

Since the current instance was hatched before S4, we need to manually copy the new curated skills.

- [ ] **Step 1: Copy skills using the new function**

```bash
cd packages/core && npx tsx -e "
import { copyFrameworkSkills } from './src/hatching/skills-copy.js'
const agentDir = '../../.my_agent'
await copyFrameworkSkills(agentDir)
console.log('Done')
"
```

Or manually copy:
```bash
for skill in brainstorming systematic-debugging writing-plans brainstorming-techniques elicitation-techniques; do
  if [ ! -f ".my_agent/.claude/skills/$skill/SKILL.md" ]; then
    cp -r "packages/core/skills/$skill" ".my_agent/.claude/skills/"
    echo "Copied: $skill"
  else
    echo "Skipped (exists): $skill"
  fi
done
```

- [ ] **Step 2: Verify files exist**

```bash
for skill in brainstorming systematic-debugging writing-plans brainstorming-techniques elicitation-techniques; do
  if [ -f ".my_agent/.claude/skills/$skill/SKILL.md" ]; then
    echo "OK: $skill"
  else
    echo "MISSING: $skill"
  fi
done
```

Expected: All 5 OK

---

### Task 8: Full validation

- [ ] **Step 1: TypeScript compiles**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 2: All tests pass**

```bash
cd packages/core && npx vitest run
cd packages/dashboard && npx vitest run
```

Expected: All PASS

- [ ] **Step 3: Skills health check — restart dashboard and verify discovery**

```bash
systemctl --user restart nina-dashboard.service
sleep 5
curl -s http://localhost:4321/api/debug/brain/skills | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [s['name'] for s in data.get('user', [])]
expected_existing = ['task-triage', 'knowledge-curation', 'identity', 'personality', 'operating-rules', 'auth', 'scheduling']
expected_new = ['brainstorming', 'systematic-debugging', 'writing-plans', 'brainstorming-techniques', 'elicitation-techniques']
for name in expected_existing + expected_new:
  status = 'PASS' if name in names else 'FAIL'
  print(f'  {status}: {name}')
print(f'\nTotal: {len(names)} skills discovered')
"
```

Expected: 12 skills discovered (7 existing + 5 new)

- [ ] **Step 4: Skill-tool filtering verification**

Verify that skills with `allowed-tools` are hidden from Conversation Nina (which lacks Write/Edit/Bash):

```bash
curl -s http://localhost:4321/api/debug/brain/skills | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [s['name'] for s in data.get('user', [])]
# These should be filtered out for Conversation Nina:
should_be_filtered = ['systematic-debugging', 'writing-plans']
for name in should_be_filtered:
  if name not in names:
    print(f'  PASS: {name} correctly filtered (not visible to Conversation Nina)')
  else:
    print(f'  INFO: {name} visible — verify tool filtering is active')
"
```

Note: This depends on whether the current debug API reflects Conversation Nina's filtered view or the full skill list. If it shows all skills, verify filtering by checking session logs.

- [ ] **Step 5: Content audit — no personas, no superpowers paths**

```bash
cd packages/core/skills
grep -r "superpowers:" brainstorming/ systematic-debugging/ writing-plans/ || echo "PASS: no superpowers references"
grep -ri "Mary\|John\|Barry\|BMAD" brainstorming-techniques/ elicitation-techniques/ || echo "PASS: no BMAD personas"
grep -r "docs/superpowers/" brainstorming/ systematic-debugging/ writing-plans/ || echo "PASS: no superpowers paths"
```

Expected: All PASS

- [ ] **Step 6: Prettier**

```bash
cd packages/core && npx prettier --write skills/
```

---

## Summary

| Task | Description | Output |
|------|-------------|--------|
| 1 | Brainstorming skill | `packages/core/skills/brainstorming/SKILL.md` |
| 2 | Systematic-debugging skill | `packages/core/skills/systematic-debugging/SKILL.md` |
| 3 | Writing-plans skill | `packages/core/skills/writing-plans/SKILL.md` |
| 4 | Brainstorming-techniques skill + CSV | `packages/core/skills/brainstorming-techniques/` |
| 5 | Elicitation-techniques skill + CSV | `packages/core/skills/elicitation-techniques/` |
| 6 | Hatching skill copy | `packages/core/src/hatching/skills-copy.ts` + tests |
| 7 | Deploy to current instance | `.my_agent/.claude/skills/` (local) |
| 8 | Full validation | TypeScript, tests, discovery, filtering, content audit |

**Dependencies:**
- Tasks 1-5 are independent (skill file creation)
- Task 6 depends on Tasks 1-5 (needs skill files to copy)
- Task 7 depends on Tasks 1-5 and 6
- Task 8 depends on all others

**Design decisions:**
- `origin: curated` — new tier for framework-shipped capabilities, non-disableable
- BMAD review-pr and root-cause-analysis dropped — not found in current BMAD repo
- Supporting debugging techniques (root-cause-tracing, defense-in-depth, condition-based-waiting) inlined into systematic-debugging SKILL.md
- Hatching copies with no-overwrite semantics — preserves existing customizations
