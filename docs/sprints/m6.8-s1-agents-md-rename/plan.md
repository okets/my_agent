# M6.8-S1: AGENTS.md Rename — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Nina's identity file from `brain/CLAUDE.md` to `brain/AGENTS.md` and update all references across the codebase, establishing a clean ownership boundary between SDK territory (CLAUDE.md) and my_agent territory (AGENTS.md).

**Architecture:** Mechanical rename with fallback. Every file referencing `brain/CLAUDE.md` gets updated to `brain/AGENTS.md`. The `assembleSystemPrompt()` function gets a fallback that checks both filenames during the transition period. Infrastructure guard and directory structure get updated to protect the new path and create `.claude/skills/` instead of `brain/skills/`.

**Tech Stack:** TypeScript, Vitest, Node.js fs APIs

**Design spec:** `docs/superpowers/specs/2026-03-15-skills-architecture-design.md`

---

## Chunk 1: Core rename — prompt.ts, hatching, personality

### Task 1: Update BRAIN_FILES in prompt.ts

**Files:**
- Modify: `packages/core/src/prompt.ts:14-15`
- Test: `packages/core/tests/prompt-recursive.test.ts:14`

- [ ] **Step 1: Update BRAIN_FILES array**

In `packages/core/src/prompt.ts`, line 15, change:
```typescript
{ rel: 'CLAUDE.md', header: null },
```
to:
```typescript
{ rel: 'AGENTS.md', header: null },
```

- [ ] **Step 2: Add fallback for transition period**

In `packages/core/src/prompt.ts`, find where `assembleSystemPrompt` reads brain files. Add a fallback: if `AGENTS.md` doesn't exist, try `CLAUDE.md`. This prevents breakage for existing `.my_agent/` instances.

In `assembleSystemPrompt()`, where it reads brain files (the loop over `BRAIN_FILES`), wrap the file read with a fallback:

```typescript
// For AGENTS.md, fall back to CLAUDE.md during transition
let filePath = path.join(brainDir, file.rel)
if (file.rel === 'AGENTS.md' && !existsSync(filePath)) {
  const legacyPath = path.join(brainDir, 'CLAUDE.md')
  if (existsSync(legacyPath)) {
    filePath = legacyPath
  }
}
```

- [ ] **Step 3: Update prompt-recursive test**

In `packages/core/tests/prompt-recursive.test.ts`, line 14, change:
```typescript
writeFileSync(join(brainDir, "CLAUDE.md"), "You are a test agent.");
```
to:
```typescript
writeFileSync(join(brainDir, "AGENTS.md"), "You are a test agent.");
```

- [ ] **Step 4: Run core tests**

Run: `cd packages/core && npx vitest run tests/prompt-recursive.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/prompt.ts packages/core/tests/prompt-recursive.test.ts
git commit -m "feat(core): rename BRAIN_FILES CLAUDE.md → AGENTS.md with fallback"
```

---

### Task 2: Update hatching — both createDirectoryStructure copies

**Files:**
- Modify: `packages/core/src/hatching/index.ts:25-34`
- Modify: `packages/core/src/hatching/logic.ts:9-18`

Both `createDirectoryStructure()` functions currently create `brain/skills/`. Update both to create `.claude/skills/` instead (prep for SDK skill discovery in S2).

- [ ] **Step 1: Update hatching/index.ts**

In `packages/core/src/hatching/index.ts`, lines 26-31, change the `dirs` array:
```typescript
async function createDirectoryStructure(agentDir: string): Promise<void> {
  const dirs = [
    agentDir,
    path.join(agentDir, 'brain'),
    path.join(agentDir, 'brain', 'memory', 'core'),
    path.join(agentDir, '.claude', 'skills'),
  ]
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true })
  }
}
```

- [ ] **Step 2: Update hatching/logic.ts**

In `packages/core/src/hatching/logic.ts`, lines 10-14, same change:
```typescript
export async function createDirectoryStructure(agentDir: string): Promise<void> {
  const dirs = [
    agentDir,
    path.join(agentDir, 'brain'),
    path.join(agentDir, 'brain', 'memory', 'core'),
    path.join(agentDir, '.claude', 'skills'),
  ]
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true })
  }
}
```

- [ ] **Step 3: Run hatching-related tests (if any)**

Run: `cd packages/core && npx vitest run`
Expected: PASS (all core tests)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hatching/index.ts packages/core/src/hatching/logic.ts
git commit -m "feat(hatching): create .claude/skills/ instead of brain/skills/"
```

---

### Task 3: Update personality step — CLAUDE.md → AGENTS.md

**Files:**
- Modify: `packages/core/src/hatching/steps/personality.ts:69,78`
- Modify: `packages/core/src/hatching/logic.ts:157,162,168,174`

- [ ] **Step 1: Update personality.ts (CLI step)**

In `packages/core/src/hatching/steps/personality.ts`:

Line 69 — rename variable and path:
```typescript
const agentsMdPath = path.join(brainDir, 'AGENTS.md')
```

Line 73 — use new variable:
```typescript
await copyFile(selected.filePath, agentsMdPath)
```

Line 77 — use new variable:
```typescript
await copyFile(customPath, agentsMdPath)
```

Line 78 — update log message:
```typescript
console.log('\nCustom template copied to brain/AGENTS.md — edit it to make it yours.')
```

- [ ] **Step 2: Update logic.ts personality functions**

In `packages/core/src/hatching/logic.ts`:

`applyPersonality()` (line 154-163) — rename `claudeMdPath` to `agentsMdPath`:
- Line 157: `const agentsMdPath = path.join(brainDir, 'AGENTS.md')`
- Line 162: `await copyFile(sourcePath, agentsMdPath)`

`writeCustomPersonality()` (line 165-175) — same rename:
- Line 168: `const agentsMdPath = path.join(brainDir, 'AGENTS.md')`
- Line 174: `await writeFile(agentsMdPath, content, 'utf-8')`

- [ ] **Step 3: Update logic.ts comments**

In `packages/core/src/hatching/logic.ts`, lines 199-200, update the comment:
```typescript
// They live in notebook/reference/standing-orders.md, NOT in brain/AGENTS.md.
// brain/AGENTS.md is for identity only: who you are, your voice, your philosophy.
```

- [ ] **Step 4: Run core tests**

Run: `cd packages/core && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hatching/steps/personality.ts packages/core/src/hatching/logic.ts
git commit -m "feat(hatching): personality writes to brain/AGENTS.md"
```

---

### Task 4: Update framework skill descriptions

**Files:**
- Modify: `packages/core/skills/personality/SKILL.md:5`
- Modify: `packages/core/skills/operating-rules/SKILL.md:5`

- [ ] **Step 1: Update personality SKILL.md**

In `packages/core/skills/personality/SKILL.md`, line 5, change:
```
When the user types `/my-agent:personality`, this presents the personality menu and overwrites `brain/CLAUDE.md` with the selected archetype.
```
to:
```
When the user types `/my-agent:personality`, this presents the personality menu and overwrites `brain/AGENTS.md` with the selected archetype.
```

- [ ] **Step 2: Update operating-rules SKILL.md**

In `packages/core/skills/operating-rules/SKILL.md`, line 5, change:
```
When the user types `/my-agent:operating-rules`, this launches an interactive Q&A and appends operating rules to `brain/CLAUDE.md`.
```
to:
```
When the user types `/my-agent:operating-rules`, this launches an interactive Q&A and configures operating rules in `notebook/reference/standing-orders.md`.
```

Note: This also fixes the outdated description — operating rules actually write to `standing-orders.md`, not `brain/CLAUDE.md`. The old description was wrong.

- [ ] **Step 3: Commit**

```bash
git add packages/core/skills/personality/SKILL.md packages/core/skills/operating-rules/SKILL.md
git commit -m "docs(skills): update SKILL.md references to brain/AGENTS.md"
```

---

## Chunk 2: Safety hooks, debug routes, admin routes

### Task 5: Update infrastructure guard

**Files:**
- Modify: `packages/core/src/hooks/safety.ts:80-85`
- Modify: `packages/core/tests/hooks/infrastructure-guard.test.ts`

- [ ] **Step 1: Update the guard patterns**

In `packages/core/src/hooks/safety.ts`, lines 78-86, update two patterns:

Pattern 1 (line 80) — rename identity file guard:
```typescript
{
  pattern: new RegExp(`${escapeRegex(agentDir)}/brain/AGENTS\\.md$`),
  reason: "Identity file — conversation Nina's domain",
},
```

Pattern 2 (line 84) — update skills guard to protect `.claude/skills/` system skills:
```typescript
{
  pattern: new RegExp(`${escapeRegex(agentDir)}/\\.claude/skills/`),
  reason: 'SDK skills directory — not modifiable by tasks',
},
```

- [ ] **Step 2: Update infrastructure guard tests**

In `packages/core/tests/hooks/infrastructure-guard.test.ts`:

Line 31 — update test name:
```typescript
it('blocks Write to brain/AGENTS.md', async () => {
```

Line 32 — update path:
```typescript
const result = await guard(makeInput(`${AGENT_DIR}/brain/AGENTS.md`), 'id1', undefined as never)
```

Lines 36-38 — update skills test:
```typescript
it('blocks Write to a file inside .claude/skills/', async () => {
  const result = await guard(
    makeInput(`${AGENT_DIR}/.claude/skills/scheduling/SKILL.md`),
    'id2',
    undefined as never,
  )
```

Line 109 — update hookSpecificOutput test:
```typescript
const result = await guard(makeInput(`${AGENT_DIR}/brain/AGENTS.md`), 'idX', undefined as never)
```

- [ ] **Step 3: Update bash blocker test**

In `packages/core/tests/hooks/bash-blocker-extended.test.ts`, line 49, change:
```typescript
const result = await blocker(makeInput('chmod 000 /home/user/.my_agent/brain/AGENTS.md'), 'id6', undefined as never)
```

Note: The bash blocker regex (`/chmod\s+000\s/i`) matches on the command pattern, not the filename, so this test still works regardless of the path. But update for consistency.

- [ ] **Step 4: Run hook tests**

Run: `cd packages/core && npx vitest run tests/hooks/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/hooks/safety.ts packages/core/tests/hooks/infrastructure-guard.test.ts packages/core/tests/hooks/bash-blocker-extended.test.ts
git commit -m "feat(hooks): guard brain/AGENTS.md and .claude/skills/ instead of old paths"
```

---

### Task 6: Update debug routes

**Files:**
- Modify: `packages/dashboard/src/routes/debug.ts:228-237`
- Modify: `packages/dashboard/src/routes/debug.ts:376-395`

- [ ] **Step 1: Update personality component read**

In `packages/dashboard/src/routes/debug.ts`, lines 228-237:

Line 230 — try AGENTS.md first, fall back to CLAUDE.md:
```typescript
// Personality (AGENTS.md, with CLAUDE.md fallback for transition)
try {
  let content: string;
  try {
    content = await readFile(join(brainDir, "AGENTS.md"), "utf-8");
  } catch {
    content = await readFile(join(brainDir, "CLAUDE.md"), "utf-8");
  }
  components.personality = {
    source: "brain/AGENTS.md",
    chars: content.length,
  };
} catch {
  components.personality = null;
}
```

- [ ] **Step 2: Update skill listing route**

In `packages/dashboard/src/routes/debug.ts`, lines 376-395:

Update the user skills directory from `brain/skills` to `.claude/skills`:
```typescript
// User/SDK skills
const sdkSkillsDir = join(agentDir, ".claude", "skills");
const userSkills = await loadSkills(sdkSkillsDir, "sdk");
```

- [ ] **Step 3: Run dashboard tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/routes/debug.ts
git commit -m "feat(debug): read brain/AGENTS.md with fallback, skills from .claude/skills/"
```

---

### Task 7: Update admin unhatch route

**Files:**
- Modify: `packages/dashboard/src/routes/admin.ts:133-136`

- [ ] **Step 1: Update unhatch to delete both filenames**

In `packages/dashboard/src/routes/admin.ts`, lines 133-136, update to delete AGENTS.md (with fallback to CLAUDE.md for existing agents):

```typescript
// Remove brain/AGENTS.md (or legacy brain/CLAUDE.md)
for (const identityFile of ["brain/AGENTS.md", "brain/CLAUDE.md"]) {
  try {
    await unlink(join(agentDir, identityFile));
    removed.push(identityFile);
    break; // Only one should exist
  } catch {
    // Doesn't exist, try next
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/routes/admin.ts
git commit -m "feat(admin): unhatch deletes brain/AGENTS.md (with CLAUDE.md fallback)"
```

---

## Chunk 3: Dashboard tests and final validation

### Task 8: Update dashboard test references

**Files:**
- Modify: `packages/dashboard/tests/context-foundation.test.ts:77`

Note: `packages/dashboard/tests/system-prompt-builder.test.ts` was checked — it uses mocks only, no `brain/CLAUDE.md` references. No changes needed.

Note: `packages/dashboard/src/ws/chat-handler.ts` uses `FRAMEWORK_SKILLS_DIR` pointing to `core/skills/` for `/my-agent:*` commands. This stays as-is in S1 — the skill migration to `.claude/skills/` is S2 scope.

- [ ] **Step 1: Update comment in context-foundation test**

In `packages/dashboard/tests/context-foundation.test.ts`, line 77, update comment from:
```typescript
// assembleSystemPrompt is responsible for loading skills from brain/skills/
```
to:
```typescript
// assembleSystemPrompt is responsible for loading identity from brain/AGENTS.md
```

- [ ] **Step 2: Run all dashboard tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/tests/context-foundation.test.ts
git commit -m "docs(tests): update brain/skills/ comment to brain/AGENTS.md"
```

---

### Task 9: Rename the actual file in .my_agent

**Files:**
- Rename: `.my_agent/brain/CLAUDE.md` → `.my_agent/brain/AGENTS.md`

This is the actual rename of Nina's identity file. Done last so existing code doesn't break mid-sprint.

- [ ] **Step 1: Rename the file**

```bash
mv .my_agent/brain/CLAUDE.md .my_agent/brain/AGENTS.md
```

Note: `.my_agent/` is gitignored — this is a local-only operation.

- [ ] **Step 2: Verify brain loads correctly**

Run: `cd packages/core && npx vitest run tests/prompt-recursive.test.ts`
Expected: PASS (confirms AGENTS.md is loaded)

---

### Task 10: Run full test suite and verify

- [ ] **Step 1: Run all core tests**

Run: `cd packages/core && npx vitest run`
Expected: All PASS

- [ ] **Step 2: Run all dashboard tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: All PASS

- [ ] **Step 3: Verify no remaining CLAUDE.md references in packages/**

Run: `grep -r 'brain/CLAUDE\.md' packages/ --include='*.ts' --include='*.md' -l`
Expected: No results (or only the fallback code in prompt.ts and debug.ts)

- [ ] **Step 4: Commit any remaining changes**

If clean, no commit needed. Otherwise:
```bash
git commit -m "chore: final cleanup of brain/CLAUDE.md references"
```

---

## Success Criteria

- [ ] `BRAIN_FILES` in `prompt.ts` references `AGENTS.md` with `CLAUDE.md` fallback
- [ ] Both `createDirectoryStructure()` copies create `.claude/skills/` not `brain/skills/`
- [ ] Hatching personality step writes to `brain/AGENTS.md`
- [ ] Infrastructure guard protects `brain/AGENTS.md` and `.claude/skills/`
- [ ] Debug routes read `brain/AGENTS.md` with `CLAUDE.md` fallback
- [ ] Admin unhatch deletes `brain/AGENTS.md` (with fallback)
- [ ] All framework SKILL.md files reference correct paths
- [ ] All tests pass
- [ ] No stale `brain/CLAUDE.md` references remain (except fallback code)
- [ ] `.my_agent/brain/CLAUDE.md` renamed to `.my_agent/brain/AGENTS.md` locally
