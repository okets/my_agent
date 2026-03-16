# M6.8-S3: Seed Skills — Design Spec

> **Status:** Draft
> **Author:** CTO + Claude
> **Date:** 2026-03-16
> **Depends on:** M6.8-S2 (SDK Skill Discovery)

---

## Summary

Extract two hardcoded behavioral directives into SKILL.md files: task-triage and knowledge-curation. Critical skills are loaded into the system prompt by our code (same delivery mechanism as today), sourced from the SKILL.md file instead of hardcoded markdown. On-demand skills are discovered by the SDK. Validate with a three-level regression suite proving zero behavioral degradation.

Morning-sequence stays as TypeScript — it's a background job template, not a conversation skill. Scheduling was already migrated in S2.

---

## Key Decision: Delivery Mechanism

**Finding:** The SDK's `skills?: string[]` preload field exists in TypeScript types but has no runtime implementation (no `--skills` CLI flag in `sdk.mjs`, the word "skills" appears zero times in the runtime code). It cannot be relied on.

**Resolution:** Critical always-on skills (task-triage) are loaded by `assembleSystemPrompt()` — the same code path that currently loads `conversation-role.md`. The content moves from being inline in `conversation-role.md` to being sourced from `.my_agent/.claude/skills/task-triage/SKILL.md`. Same words, same prompt position, same delivery. Zero delivery risk.

This gives us the organizational benefit (skills as files with frontmatter, discoverable by SDK, manageable from dashboard in S6) without changing how critical content reaches the LLM.

**When SDK implements `skills` preload:** We can switch the delivery mechanism from `assembleSystemPrompt()` to SDK preload. The SKILL.md files won't change — only the loading code.

---

## Scope

| Directive | Current location | Target | Delivery |
|-----------|-----------------|--------|----------|
| task-triage | `brain/conversation-role.md` (§ Task Delegation through end) | `.my_agent/.claude/skills/task-triage/SKILL.md` | Always-on via `assembleSystemPrompt()` — reads SKILL.md, injects into system prompt |
| knowledge-curation | `debrief-prep.ts` behavioral text + implicit behavior | `.my_agent/.claude/skills/knowledge-curation/SKILL.md` | On-demand via SDK discovery |
| morning-sequence | `debrief-prep.ts` SYSTEM_PROMPT + USER_PROMPT_TEMPLATE | Stays in TypeScript | N/A — background job template, not a conversation skill |
| scheduling | `.my_agent/.claude/skills/scheduling/SKILL.md` | Already done (S2) | On-demand via SDK discovery |

### Out of scope

- Morning-sequence extraction (it's a `queryModel()` job template — SDK skills require a full Claude Code subprocess)
- Daily-summary extraction (same reason)
- New skills not in the design spec (brainstorming, debugging — those are S4)

---

## Skill Definitions

### task-triage

Extracted from `brain/conversation-role.md` — everything from `## Task Delegation` through `## Group Chat Behavior` (end of file).

```yaml
---
name: task-triage
description: When to delegate work to a task vs answer directly — routing rules for create_task, WebSearch, delivery actions, and task corrections
origin: system
---
```

**Content (exact text from conversation-role.md):**

```markdown
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

**What stays in conversation-role.md:** The identity section — `## Your Role: Conversation Agent` through `### What you delegate`. This defines what Nina *is*. The triage skill defines *how* she routes.

**Delivery:** Always-on. `assembleSystemPrompt()` reads this SKILL.md and injects the content into the system prompt, same position as today. See "Implementation: Always-On Skill Loading" below.

### knowledge-curation

New skill — behavioral guidance currently implicit in the debrief flow.

```yaml
---
name: knowledge-curation
description: How to propose, enrich, and manage staged knowledge facts during conversations and morning briefs
origin: system
---
```

**Content:**

```markdown
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

**Not extracted from TypeScript:** `formatStagedFactsSection()` and `formatStalePropertiesSection()` stay in `debrief-prep.ts` — they format data for the prompt. The skill teaches behavior.

**Delivery:** On-demand via SDK discovery. Knowledge curation is contextual — only relevant when facts are pending.

---

## What Changes in conversation-role.md

After extraction, `.my_agent/brain/conversation-role.md` shrinks to identity only:

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

---

## Implementation: Always-On Skill Loading

### How it works today (S2)

`assembleSystemPrompt()` in `prompt.ts` loads always-on content from `SKILL_CONTENT_FILES`:

```typescript
const SKILL_CONTENT_FILES = ['conversation-role.md', 'notebook.md']
const skillsDirs = [brainDir]
// Reads brain/conversation-role.md and brain/notebook.md
const skillContent = await loadSkillContent(skillsDirs)
```

### How it works after S3

Add a new constant for always-on skills loaded from the SDK skills directory:

```typescript
// Always-on skills: sourced from .claude/skills/ but injected into system prompt
// (SDK skills preload is not yet implemented — we load these ourselves)
const ALWAYS_ON_SKILLS = ['task-triage']
```

In `assembleSystemPrompt()`, after loading `SKILL_CONTENT_FILES`, also load always-on skills from `.my_agent/.claude/skills/`:

```typescript
// Load always-on skills from SDK skills directory
const sdkSkillsDir = path.join(agentDir, '.claude', 'skills')
for (const skillName of ALWAYS_ON_SKILLS) {
  const skillPath = path.join(sdkSkillsDir, skillName, 'SKILL.md')
  const content = await readOptionalFile(skillPath)
  if (content) {
    // Strip YAML frontmatter before injecting
    const body = content.replace(/^---\n[\s\S]*?\n---\n*/, '')
    sections.push(body.trim())
  }
}
```

**Result:** The system prompt contains the exact same task-triage text as before. The only difference is the source file path.

### Why this is zero risk

1. Same content — extracted verbatim from conversation-role.md
2. Same delivery — `assembleSystemPrompt()` injects it into the system prompt
3. Same position — appears in the same prompt section (Layer 1: identity + skills)
4. Same every-turn behavior — loaded on every query, no on-demand invocation needed
5. Testable — Level 1 validation compares prompt content character-by-character

### Future migration path

When the SDK implements `skills` preload:
1. Remove `ALWAYS_ON_SKILLS` loading from `assembleSystemPrompt()`
2. Add `skills: ["task-triage"]` to `BrainSessionOptions`
3. Run Level 1 validation to confirm prompt equivalence
4. No SKILL.md changes needed

---

## Three-Level Validation Suite

### Level 1: System Prompt Content (Deterministic)

**Test:** Snapshot the system prompt before and after extraction. Assert identical content for all triage directive sentences.

```typescript
describe('system prompt — task-triage content preserved', () => {
  // Key sentences that MUST appear in the system prompt
  const TRIAGE_DIRECTIVES = [
    'For anything beyond a quick WebSearch, use `create_task`',
    'WebSearch: single factual question, one search, instant answer',
    'create_task: research, comparison, multi-step work',
    'Include ALL relevant context in the instructions',
    'When the user says "send me X on WhatsApp"',
    'use `revise_task` with the task ID',
    'Internal actions (safe to do freely)',
    'External actions (ask first)',
  ]

  it('contains all triage directives after extraction', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    for (const directive of TRIAGE_DIRECTIVES) {
      expect(prompt).toContain(directive)
    }
  })

  it('contains conversation-role identity section', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    expect(prompt).toContain('You are the conversation layer')
    expect(prompt).toContain('What you do directly')
  })

  it('does NOT double-include triage content', async () => {
    const prompt = await assembleSystemPrompt(brainDir)
    const count = (prompt.match(/For anything beyond a quick WebSearch/g) || []).length
    expect(count).toBe(1)
  })
})
```

**Implementation:** Run via `vitest` against `assembleSystemPrompt()` with real files. No mocks — uses the actual brain directory with the actual SKILL.md files.

### Level 2: Skill Discovery (Deterministic)

**Test:** Verify skills are properly configured via debug API.

```typescript
it('task-triage appears in SDK skills directory', async () => {
  const res = await fetch('http://localhost:4321/api/debug/brain/skills')
  const skills = await res.json()
  expect(skills.user).toContainEqual(
    expect.objectContaining({ name: 'task-triage' })
  )
})

it('knowledge-curation appears in SDK skills directory', async () => {
  const res = await fetch('http://localhost:4321/api/debug/brain/skills')
  const skills = await res.json()
  expect(skills.user).toContainEqual(
    expect.objectContaining({ name: 'knowledge-curation' })
  )
})
```

### Level 3: Behavioral Scenarios (Integration)

**Test:** Verify Nina's routing decisions haven't changed by running scripted messages and checking tool use.

**Method:** Use `queryModel()` with the full assembled system prompt. This tests the LLM's routing decisions with the actual prompt content. It doesn't go through the SDK skill mechanism (which isn't the delivery path anyway — we use `assembleSystemPrompt()`), but it proves the LLM makes the same decisions with the same prompt.

| # | Scenario | Input message | Expected routing | Verification |
|---|----------|--------------|-----------------|--------------|
| 1 | Delegate research | "Research the best flights to Tokyo next week" | `create_task` | Response mentions creating a task |
| 2 | Direct answer | "What time is it in Tokyo?" | Direct / WebSearch | No task creation mentioned |
| 3 | Delegate code | "Write a script to backup my notebook daily" | `create_task` | Response mentions creating a task |
| 4 | Quick factual | "Who is the president of France?" | Direct / WebSearch | No task creation mentioned |
| 5 | Delegate analysis | "Compare the top 3 project management tools" | `create_task` | Response mentions creating a task |
| 6 | Direct memory | "Do you remember where I'm traveling next?" | Direct recall | No task creation mentioned |
| 7 | Delegate with delivery | "Research Tokyo restaurants and send me the list on WhatsApp" | `create_task` with delivery | Response mentions task + delivery |

**Knowledge-curation scenarios** (tested via debrief prep endpoint):

| # | Scenario | Input | Expected | Verification |
|---|----------|-------|----------|--------------|
| 8 | Facts present | Debrief trigger with staged facts | Output proposes facts naturally | Contains fact proposal language |
| 9 | No facts | Debrief trigger with empty staging | No knowledge section | Does NOT contain "pending knowledge" |

**Important:** Level 3 tests are probabilistic. We assert on structural decisions (does the response mention creating a task or not?) rather than exact text. Run each scenario 3 times; if 2/3 match the expected routing, it passes.

### Validation Execution

```
Phase 1: Baseline (before extraction, on master)
  ├── Capture system prompt via debug API → baseline-prompt.txt
  ├── Run Level 3 scenarios → baseline-routing.json
  └── Record results

Phase 2a: Add loading (sprint branch, BEFORE shrinking)
  ├── Create SKILL.md files
  ├── Update prompt.ts (ALWAYS_ON_SKILLS)
  ├── Run Level 1 — triage content now appears TWICE (old + new)
  └── Commit

Phase 2b: Shrink source (sprint branch, AFTER loading verified)
  ├── Backup conversation-role.md (can't git restore — .my_agent/ is gitignored)
  ├── Reduce conversation-role.md to identity-only
  ├── Run Level 1 — triage content appears exactly ONCE (from SKILL.md)
  └── Commit

Phase 3: Regression (sprint branch, after extraction)
  ├── Run Level 1: prompt content assertions (vitest)
  ├── Run Level 2: skill discovery via debug API
  ├── Run Level 3: behavioral scenarios
  ├── Compare against baseline
  └── Report: PASS or FAIL with specifics
```

---

## Files Affected

| File | Change |
|------|--------|
| `packages/core/src/prompt.ts` | Add `ALWAYS_ON_SKILLS` constant, load from `.claude/skills/` in `assembleSystemPrompt()` |
| `packages/core/tests/prompt-always-on.test.ts` | Add triage directive assertions, no-double-include test |
| `.my_agent/.claude/skills/task-triage/SKILL.md` | New — extracted from conversation-role.md |
| `.my_agent/.claude/skills/knowledge-curation/SKILL.md` | New — behavioral guidance for fact management |
| `.my_agent/brain/conversation-role.md` | Shrink — remove § Task Delegation through end of file |
| `packages/core/tests/prompt-triage-regression.test.ts` | New — Level 1 validation (prompt content assertions) |
| `packages/dashboard/tests/skill-discovery-regression.test.ts` | New — Level 2 validation (debug API skill listing) |

---

## Rollback Plan

If validation reveals degradation:
1. Restore `brain/conversation-role.md` from backup copy (`.my_agent/` is gitignored — cannot git restore). The backup is taken in Phase 2b. Alternatively, the original content lives in `task-triage/SKILL.md` and can be manually recombined.
2. Remove `ALWAYS_ON_SKILLS` loading from `prompt.ts`
3. SKILL.md files can stay (no harm — they're just files on disk)
4. Re-run Level 1 to confirm prompt is back to baseline

---

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Prompt content changes after extraction | LOW | Level 1 catches this — same words, same delivery |
| Nina stops delegating correctly | LOW | Level 3 catches routing changes. Rollback available. |
| SKILL.md frontmatter leaks into prompt | LOW | Strip frontmatter before injection (regex) |
| Knowledge-curation skill never invoked | MEDIUM | Acceptable — debrief job still formats facts via TypeScript |
| Double-loading (conversation-role.md + SKILL.md both have triage) | MEDIUM | Level 1 no-double-include test catches this |
| Morning-sequence/daily-summary accidentally extracted | LOW | Success criteria includes negative check |

---

## Success Criteria

- [ ] task-triage SKILL.md created with exact content from conversation-role.md
- [ ] knowledge-curation SKILL.md created with behavioral guidance
- [ ] `ALWAYS_ON_SKILLS` loading in `assembleSystemPrompt()` reads from `.claude/skills/`
- [ ] conversation-role.md reduced to identity-only content
- [ ] Level 1: all triage directive sentences present in system prompt (before = after)
- [ ] Level 1: no double-inclusion of triage content
- [ ] Level 2: both skills appear in debug API `/brain/skills`
- [ ] Level 3: 7 triage scenarios produce same routing decisions (before = after)
- [ ] Level 3: 2 knowledge scenarios produce expected output patterns
- [ ] All existing tests pass (623+)
- [ ] Morning-sequence and daily-summary remain in TypeScript (not extracted)

---

*Design approved: 2026-03-16*
*Reviewed: 2 passes — critical issues resolved (SDK skills preload unimplemented, delivery mechanism redesigned)*
