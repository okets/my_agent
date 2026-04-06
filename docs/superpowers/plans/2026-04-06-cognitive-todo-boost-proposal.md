# Cognitive Todo Boost — Proposal

> **Status:** Proposal — pending CTO review. See **Verdict** section at the bottom for analysis.

**Goal:** Replace prose instructions with structured thinking frameworks wherever hooks currently compensate for unreliable prompt compliance — making hooks true safety nets instead of the primary path.

**Architecture:** Three layers of change: (1) brain-level cognitive checklists injected into the system prompt that structure the brain's *thinking* before responding, (2) worker-level todo template expansions that give every job a baseline checklist, (3) skill rewrites that replace vague directives with structured decision trees. All changes are additive — existing hook enforcement stays as safety nets.

**Tech Stack:** TypeScript (prompt assembly, templates, validators), Markdown (skills, standing orders)

**Principle from M9.1:** "Any flow that MUST happen needs code enforcement, not prompt enforcement." This proposal extends that to: "Any *thinking* that MUST happen needs structured steps, not prose."

---

## File Structure

| File | Responsibility | Change Type |
|------|---------------|-------------|
| `packages/dashboard/src/agent/cognitive-checklist.ts` | Pre-response structured thinking framework for the brain | **Create** |
| `packages/dashboard/src/agent/system-prompt-builder.ts` | Inject cognitive checklist into Layer 2 | Modify |
| `packages/dashboard/src/automations/todo-templates.ts` | Add `generic`, `research` templates + meta-item | Modify |
| `packages/dashboard/src/automations/working-nina-prompt.ts` | Replace vague "Principles" with structured self-check | Modify |
| `packages/dashboard/src/automations/automation-executor.ts` | Replace prose autonomy with checklist format | Modify |
| `skills/visual-presenter.md` | Rewrite as structured decision tree | Modify |
| `.my_agent/brain/conversation-role.md` | Add delegation self-check gate | Modify |
| `.my_agent/.claude/skills/task-triage/SKILL.md` | Rewrite routing as decision tree, add automation design checklist | Modify |
| `.my_agent/brain/notebook.md` | Rewrite memory decisions as triage gate | Modify |
| `packages/dashboard/src/agent/cognitive-checklist.test.ts` | Unit tests for checklist assembly | **Create** |
| `packages/dashboard/src/automations/todo-templates.test.ts` | Unit tests for new templates | **Create** |

---

### Task 1: Cognitive Pre-Response Checklist (Brain-Level)

This is the highest-impact change. The brain currently receives personality + context + skills and reasons freely. This task adds a structured "pre-flight checklist" that the brain should mentally walk through before composing every response.

**Files:**
- Create: `packages/dashboard/src/agent/cognitive-checklist.ts`
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts:67-80` (the `build()` method)

- [ ] **Step 1: Write test for checklist assembly**

Create `packages/dashboard/src/agent/cognitive-checklist.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildCognitiveChecklist } from "./cognitive-checklist.js";

describe("buildCognitiveChecklist", () => {
  it("returns the structured pre-response checklist", () => {
    const result = buildCognitiveChecklist({ channel: "whatsapp-transport-1" });
    // Must contain the 5 gates
    expect(result).toContain("Delegation gate");
    expect(result).toContain("Visual gate");
    expect(result).toContain("Channel gate");
    expect(result).toContain("Memory gate");
    expect(result).toContain("Deliverable gate");
  });

  it("includes WhatsApp constraints for whatsapp channel", () => {
    const result = buildCognitiveChecklist({ channel: "whatsapp-transport-1" });
    expect(result).toContain("300 chars");
    expect(result).toContain("no markdown");
  });

  it("includes full formatting for dashboard channel", () => {
    const result = buildCognitiveChecklist({ channel: "dashboard" });
    expect(result).toContain("full markdown");
  });

  it("includes voice constraints for voice mode", () => {
    const result = buildCognitiveChecklist({ channel: "dashboard", isVoice: true });
    expect(result).toContain("write for the ear");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run src/agent/cognitive-checklist.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement cognitive checklist builder**

Create `packages/dashboard/src/agent/cognitive-checklist.ts`:

```typescript
/**
 * Cognitive Checklist — Pre-Response Structured Thinking
 *
 * Injected into the brain's system prompt so it "thinks in steps"
 * before composing a response. Each gate corresponds to a behavior
 * that was previously enforced only by post-response hooks.
 *
 * When the brain follows these gates, the hooks become true safety nets.
 * When it doesn't, the hooks catch it — same as before, no regression.
 */

export interface ChecklistContext {
  channel: string;
  isVoice?: boolean;
}

export function buildCognitiveChecklist(ctx: ChecklistContext): string {
  const channelGate = getChannelGate(ctx);

  return `## Pre-Response Checklist (THINK before responding)

Before composing your response, run through these gates mentally. This is not optional — it takes 2 seconds and prevents the failures that hooks currently catch for you.

### 1. Delegation gate
Am I about to do work myself (edit files, run multi-step research, produce an artifact)?
- YES → stop. Use \`create_task\` to delegate. You are the conversation layer.
- NO → continue.

### 2. Visual gate
Does my response contain 3+ data points, numeric comparisons, trends, or scores?
- YES → I MUST call \`create_chart\` with an SVG before responding. Do not skip this — a fallback hook will generate a worse chart if I don't.
- Does my response reference something with a visual component (place, product, weather)?
- YES → call \`fetch_image\` for a relevant image.

### 3. Channel gate
${channelGate}

### 4. Memory gate
Did the user share a durable fact (preference, plan, relationship, location)?
- YES → call \`remember\` or propose via knowledge curation. Do not defer.
- Is the user asking about something I might have stored?
- YES → call \`recall\` BEFORE answering. Do not guess from memory.

### 5. Deliverable gate
Did the user ask for actionable work (not a question)?
- YES → my response MUST contain structured content (steps, code, plan, list). A conversational acknowledgment alone is insufficient.
- Did I promise content ("here's the plan:", "let me break this down:")?
- YES → I MUST deliver that content in this response. Do not end without it.`;
}

function getChannelGate(ctx: ChecklistContext): string {
  if (ctx.isVoice) {
    return `Channel: voice mode
- Write for the ear, not the eye: natural sentences, no bullet points, no tables
- Keep it conversational and concise`;
  }

  if (ctx.channel.includes("whatsapp")) {
    return `Channel: WhatsApp (mobile)
- Max ~300 chars per message. Be concise.
- No markdown formatting (no bullets, headers, code blocks) — plain text only
- Split long content into multiple short messages via delivery actions`;
  }

  return `Channel: dashboard (desktop)
- Full markdown allowed: headers, bullets, code blocks, tables
- No artificial length limit — be as thorough as the question requires`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/dashboard && npx vitest run src/agent/cognitive-checklist.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Inject checklist into system prompt builder**

Modify `packages/dashboard/src/agent/system-prompt-builder.ts`. Add import at top:

```typescript
import { buildCognitiveChecklist } from "./cognitive-checklist.js";
```

In the `build()` method, after the `[Inbound Metadata]` block (around line 113), add the cognitive checklist:

```typescript
    // Cognitive pre-response checklist
    const cognitiveChecklist = buildCognitiveChecklist({
      channel: context.channel,
    });
    dynamicParts.push(cognitiveChecklist);
```

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/agent/cognitive-checklist.ts \
      packages/dashboard/src/agent/cognitive-checklist.test.ts \
      packages/dashboard/src/agent/system-prompt-builder.ts
git commit -m "feat: add cognitive pre-response checklist for brain

Structured thinking gates that replace post-response hook reliance:
- Delegation gate (prevents inline work)
- Visual gate (prevents skipped charts)  
- Channel gate (WhatsApp/dashboard/voice formatting)
- Memory gate (prevents forgotten recall/remember)
- Deliverable gate (prevents empty acknowledgments)"
```

---

### Task 2: Visual Presenter Skill Rewrite

Replace the prose-based visual-presenter skill with a structured decision tree. Currently the brain skips `create_chart` ~50% of the time, and the Haiku fallback does the work. This rewrite makes the brain's decision explicit.

**Files:**
- Modify: `skills/visual-presenter.md`

- [ ] **Step 1: Read current skill content**

Run: `cat skills/visual-presenter.md`
Verify it contains the current prose version (~75 lines).

- [ ] **Step 2: Rewrite as structured decision tree**

Replace the full content of `skills/visual-presenter.md` with:

```markdown
---
name: visual-presenter
description: Proactive visual communication — charts for data, images for visual topics. Structured decision tree.
level: brain
allowed-tools:
  - create_chart
  - fetch_image
---

# Visual Expression

You have two tools for visual communication. Use them **proactively** — don't wait to be asked. Text-only responses for data-rich content are incomplete.

## Decision Tree (run on every response)

```
Is my response data-rich?
├── 3+ numeric data points (counts, scores, measurements, prices) → create_chart
├── Comparison across categories or time periods → create_chart  
├── Status with numeric values (progress, ratings) → create_chart
└── No numeric data
    ├── Topic has a visual component (place, product, weather, person) → fetch_image
    └── Purely conversational → no visual needed
```

## create_chart Protocol

1. Generate SVG following the rules below
2. Call `create_chart` with the SVG
3. Embed the returned URL as `![description](url)` in your response text
4. If you skip this when data exists, a fallback hook generates a worse chart — own it yourself

### SVG Rules
- Dimensions: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="350">`
- Inline `style=""` attributes only — NO `<style>` blocks
- Font: `sans-serif` only — no custom or web fonts
- No `<foreignObject>` elements
- Round corners on background: `rx="12"`

### Color Palette (Tokyo Night)
| Token | Hex | Use |
|-------|-----|-----|
| background | `#1a1b26` | Chart background |
| panel | `#292e42` | Data area, legend bg |
| text | `#c0caf5` | Labels, values |
| muted | `#565f89` | Grid lines, axes |
| accent | `#7aa2f7` | Primary data series |
| purple | `#bb9af7` | Secondary series |
| pink | `#f7768e` | Negative/alert values |
| green | `#9ece6a` | Positive/success values |
| yellow | `#e0af68` | Warning/third series |

## fetch_image Protocol

1. Call `fetch_image` with the image URL
2. Embed the returned URL as `![description](url)` in your response text
3. Use for: weather maps, product photos, location images, news photos
4. Do NOT use for: generic stock photos, decorative images

## Constraints
- Max 3 images per response
- Images augment text — always include a text explanation alongside
- If unsure whether a chart adds value, skip silently
```

- [ ] **Step 3: Copy updated skill to agent skills directory**

```bash
cp skills/visual-presenter.md .my_agent/.claude/skills/visual-presenter.md 2>/dev/null || true
```

(The skill is brain-level and loaded from `skills/`, but if a copy exists in `.claude/skills/`, keep it in sync.)

- [ ] **Step 4: Commit**

```bash
git add skills/visual-presenter.md
git commit -m "refactor: rewrite visual-presenter skill as structured decision tree

Replaces prose instructions with explicit decision tree and protocols.
Brain should now own chart generation instead of relying on Haiku fallback."
```

---

### Task 3: Generic and Research Todo Templates

Currently only `capability_build` and `capability_modify` have templates. Every other job type gets zero mandatory framework items. This adds a `generic` baseline and a `research` template.

**Files:**
- Modify: `packages/dashboard/src/automations/todo-templates.ts`
- Create: `packages/dashboard/src/automations/todo-templates.test.ts`

- [ ] **Step 1: Write tests for new templates**

Create `packages/dashboard/src/automations/todo-templates.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getTemplate, assembleJobTodos } from "./todo-templates.js";

describe("getTemplate", () => {
  it("returns generic template for unknown job types", () => {
    const tpl = getTemplate("generic");
    expect(tpl).toBeDefined();
    expect(tpl!.items.length).toBeGreaterThanOrEqual(2);
    expect(tpl!.items.every((i) => i.mandatory)).toBe(true);
  });

  it("returns research template", () => {
    const tpl = getTemplate("research");
    expect(tpl).toBeDefined();
    expect(tpl!.items.some((i) => i.text.includes("sources"))).toBe(true);
  });

  it("still returns capability templates", () => {
    expect(getTemplate("capability_build")).toBeDefined();
    expect(getTemplate("capability_modify")).toBeDefined();
  });
});

describe("assembleJobTodos", () => {
  it("falls back to generic template when no job type specified", () => {
    const items = assembleJobTodos([{ text: "Do the thing" }]);
    // Should have delegator item + generic template items
    expect(items[0].text).toBe("Do the thing");
    expect(items[0].created_by).toBe("delegator");
    // Last item should be the meta self-check from generic template
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.length).toBeGreaterThanOrEqual(2);
    expect(frameworkItems.at(-1)!.text).toContain("status-report.md");
  });

  it("uses specific template over generic when job type provided", () => {
    const items = assembleJobTodos([], "capability_build");
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.some((i) => i.text.includes("CAPABILITY.md"))).toBe(true);
  });

  it("uses research template for research job type", () => {
    const items = assembleJobTodos([{ text: "Research X" }], "research");
    const frameworkItems = items.filter((i) => i.created_by === "framework");
    expect(frameworkItems.some((i) => i.text.includes("sources"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run src/automations/todo-templates.test.ts`
Expected: FAIL — `generic` template not found, `assembleJobTodos` doesn't fall back

- [ ] **Step 3: Add generic and research templates**

Modify `packages/dashboard/src/automations/todo-templates.ts`. Add new templates to the `TEMPLATES` record:

```typescript
  generic: {
    items: [
      {
        text: "Verify output matches the requested format and content — re-read your deliverable before marking done",
        mandatory: true,
      },
      {
        text: "Write status-report.md with: what you did, what you found, artifacts created, any issues",
        mandatory: true,
      },
    ],
  },
  research: {
    items: [
      {
        text: "Identify and document at least 3 sources — list URLs or file paths consulted",
        mandatory: true,
      },
      {
        text: "Cross-check key claims across sources — flag any contradictions",
        mandatory: true,
      },
      {
        text: "Write status-report.md with: findings summary, sources list, confidence assessment, any gaps",
        mandatory: true,
      },
    ],
  },
```

Then modify `assembleJobTodos` to fall back to `generic` when no job type is specified or the job type has no template:

```typescript
export function assembleJobTodos(
  delegatorTodos?: Array<{ text: string }>,
  jobType?: string,
): TodoItem[] {
  const items: TodoItem[] = [];
  let nextId = 1;

  // Layer 1: Delegator's items
  if (delegatorTodos) {
    for (const todo of delegatorTodos) {
      items.push({
        id: `t${nextId++}`,
        text: todo.text,
        status: "pending",
        mandatory: true,
        created_by: "delegator",
      });
    }
  }

  // Layer 2: Job-type template items (fall back to generic)
  const template = (jobType ? getTemplate(jobType) : undefined) ?? getTemplate("generic");
  if (template) {
    for (const tplItem of template.items) {
      items.push({
        id: `t${nextId++}`,
        text: tplItem.text,
        status: "pending",
        mandatory: tplItem.mandatory,
        validation: tplItem.validation,
        created_by: "framework",
      });
    }
  }

  return items;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run src/automations/todo-templates.test.ts`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/automations/todo-templates.ts \
      packages/dashboard/src/automations/todo-templates.test.ts
git commit -m "feat: add generic and research todo templates, fallback to generic

Every job now gets at minimum a verify-output + write-status-report checklist.
Research jobs get source documentation and cross-check items.
assembleJobTodos falls back to generic when no job_type template exists."
```

---

### Task 4: Working Nina Principles — Replace Prose with Self-Check

The "Principles" section in the Working Nina prompt says "Be thorough. Verify your work." — exactly the kind of vague prose M9.1 proved unreliable. Replace with a concrete pre-completion self-check.

**Files:**
- Modify: `packages/dashboard/src/automations/working-nina-prompt.ts:88-104`

- [ ] **Step 1: Replace the Principles section**

In `packages/dashboard/src/automations/working-nina-prompt.ts`, replace lines 88-104 (from `## Principles` to the end of the status-report description) with:

```typescript
## Pre-Completion Self-Check

Before ending your session, verify ALL of the following:

1. **Todo check:** Call \`todo_list\` — are all mandatory items marked "done"? If not, go back and complete them.
2. **Output check:** Re-read any files you created. Does the content match what was requested? Is it complete, not truncated?
3. **Status report:** Write \`status-report.md\` to your workspace with these sections:
   - **Actions taken** — what you did (key steps, tools used)
   - **Results** — what you found or produced (data, conclusions)
   - **Artifacts** — file names and one-line descriptions
   - **Issues** — anything unresolved, unexpected, or needing follow-up
4. **Format check:** If the task specified an output format, verify your deliverable matches it exactly.

Do not assume your work is correct — verify by re-reading output files.
Do not waste tokens on pleasantries or narration. Be autonomous — make decisions, don't ask questions.`;
```

- [ ] **Step 2: Verify the prompt still builds correctly**

Run: `cd packages/dashboard && npx tsx -e "import { buildWorkingNinaPrompt } from './src/automations/working-nina-prompt.js'; buildWorkingNinaPrompt('/tmp/test', { taskTitle: 'test', taskId: 't1' }).then(p => { console.log(p.includes('Pre-Completion Self-Check') ? 'OK' : 'MISSING'); })"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/automations/working-nina-prompt.ts
git commit -m "refactor: replace prose principles with structured pre-completion self-check

Replaces 'Be thorough. Verify your work.' with a 4-step verification
checklist: todo check, output check, status report, format check."
```

---

### Task 5: Autonomy Instructions — Checklist Format

Replace the 3-line prose autonomy instructions with structured checklists that name specific actions.

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts:722-749`

- [ ] **Step 1: Replace getAutonomyInstructions**

In `automation-executor.ts`, replace the `getAutonomyInstructions` method body with:

```typescript
  private getAutonomyInstructions(
    level: "full" | "cautious" | "review",
  ): string {
    switch (level) {
      case "full":
        return [
          "## Autonomy: Full",
          "Decide everything. Execute without asking.",
          "Log every significant decision in your status report.",
        ].join("\n");
      case "cautious":
        return [
          "## Autonomy: Cautious",
          "",
          "Execute most actions independently. Before ANY of the following, stop and mark this job as `needs_review` with a clear question:",
          "",
          "- [ ] Deleting files outside your workspace directory",
          "- [ ] Sending messages to external services (email, WhatsApp, APIs)",
          "- [ ] Modifying production configuration files",
          "- [ ] Spending money via paid API calls",
          "- [ ] Any action you cannot undo",
          "",
          "If unsure whether an action is irreversible, treat it as irreversible.",
        ].join("\n");
      case "review":
        return [
          "## Autonomy: Review Only",
          "",
          "Do NOT execute any actions. Your deliverable is a plan:",
          "",
          "1. Analyze the task requirements",
          "2. Write your proposed plan in deliverable.md (specific steps, files to modify, expected outcomes)",
          "3. Mark this job as `needs_review`",
          "4. A human will approve before execution proceeds",
          "",
          "Do not make changes, run scripts, or produce artifacts beyond the plan document.",
        ].join("\n");
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/automations/automation-executor.ts
git commit -m "refactor: autonomy instructions as structured checklists

Cautious mode now names specific action types to gate on instead of
vague 'irreversible decisions'. Review mode has explicit numbered steps."
```

---

### Task 6: Task Triage Skill — Decision Tree Rewrite

The task-triage skill currently uses prose rules for routing decisions. Rewrite as a structured decision tree that the brain walks through step-by-step.

**Files:**
- Modify: `.my_agent/.claude/skills/task-triage/SKILL.md`

- [ ] **Step 1: Rewrite the skill**

Replace the content of `.my_agent/.claude/skills/task-triage/SKILL.md` with:

```markdown
---
name: task-triage
description: Structured decision tree for routing every user message — interview, delegate, search, or answer directly
origin: system
---

## Message Routing (run on every user message)

Walk through this tree. Stop at the first match.

```
User message received
│
├── Is it a greeting, acknowledgment, or small talk?
│   └── Respond directly. No tools needed.
│
├── Is it a single factual question with a clear answer?
│   └── WebSearch. Return the answer directly.
│
├── Is the user asking about something I might have stored?
│   └── Call `recall` FIRST, then respond with what I find.
│
├── Is it a correction ("that's wrong", "didn't work", "fix it")?
│   └── Go to **Corrections Flow** below.
│
├── Is it a request to teach me something reusable?
│   └── Go to **Skill Lifecycle** below.
│
├── Is it actionable work (research, create, build, analyze, compare)?
│   └── Does it need an interview first?
│       ├── Ambiguous scope, unclear success criteria, or multi-faceted → YES, interview
│       └── Completely unambiguous AND atomic → skip interview
│   └── Then **design the task** using the Automation Design Checklist below.
│
└── Everything else → respond conversationally.
```

## Interview Protocol

Short: 2-4 questions, one at a time. Gathering:
- **What** they want (the outcome, not the method)
- **Why** they want it (context shapes the approach)
- **Constraints** (timeline, format, audience)
- **Success criteria** (how they'll know it's right)

After: summarize what you'll do, get a "yes" before acting.

## Automation Design Checklist

Before calling `create_task`, mentally fill in every field:

1. **Name:** short descriptive title for the job
2. **Instructions:** ALL context the worker needs — it cannot see this conversation
3. **Todos:** break the work into concrete steps. Each becomes a mandatory checklist item. Without todos, the worker only gets generic baseline items.
4. **Model:** sonnet for most work, opus for complex reasoning/planning
5. **Notify:** "immediate" if user is waiting, "debrief" for background work
6. **Autonomy:** "full" for safe work, "cautious" for anything with side effects, "review" for high-risk
7. **Job type:** "research" for research tasks, "capability_build"/"capability_modify" for capabilities
8. **Delivery:** if user wants results sent somewhere (WhatsApp, email), include delivery actions

Do not fire `create_task` until you can fill in items 1-3 confidently. If you can't, interview first.

## Corrections Flow

When the user says something "didn't work" or "was wrong":

1. **Investigate** — read the task results, check what happened
2. **Diagnose** — form a hypothesis about what went wrong
3. **Clarify** — if the diagnosis is ambiguous, ask ONE focused question
4. **Route the fix:**
   - Capability correction → `update_skill`
   - Task output correction → `revise_task(taskId, correction)`
   - New approach needed → `create_task` with the corrected spec
   - Simple factual fix → answer directly

Do not skip step 1. Do not guess without investigating.

## Skill Lifecycle

Skills are persistent capabilities. Treat them with weight.

- **Always interview first** — skills shape behavior permanently. Never create from a single message.
- Check existing skills with `list_skills` before creating (avoid duplicates)
- Read current content with `get_skill` before updating
- The user calls these "responsibilities" — "I want you to handle X" = skill

## Autonomy

**Internal (safe):** read files, search web, explore, organize, recall/remember
**External (ask first):** send emails, post publicly, anything that leaves the machine
```

- [ ] **Step 2: Commit**

```bash
git add .my_agent/.claude/skills/task-triage/SKILL.md
git commit -m "refactor: rewrite task-triage skill as structured decision tree

Replaces prose routing rules with explicit decision tree the brain
walks through on every message. Adds Automation Design Checklist —
8-field pre-flight for create_task calls."
```

---

### Task 7: Notebook/Memory Skill — Triage Gate Rewrite

Replace the prose "when to recall / when to remember" with a structured triage gate.

**Files:**
- Modify: `.my_agent/brain/notebook.md`

- [ ] **Step 1: Rewrite the skill**

Replace the content of `.my_agent/brain/notebook.md` with:

```markdown
# Memory & Notebook

You have MCP tools for persistent memory. **Use them proactively** — you wake up fresh each session.

## Memory Triage Gate (run on every user message)

```
Does this message contain or ask about stored information?
│
├── User is ASKING about a fact (location, plan, preference, history)?
│   └── Call `recall` BEFORE answering. Do not guess.
│   └── "Do you know/remember X?" → ALWAYS `recall` first.
│
├── User SHARED a durable fact?
│   ├── Location, travel plans, schedule → `remember` immediately
│   ├── Preference, opinion, decision → `remember` immediately  
│   ├── New contact, relationship → propose via knowledge curation
│   └── Transient state (mood, greeting, small talk) → skip
│
├── You're about to answer and might be wrong?
│   └── Call `recall` to check before committing to an answer.
│
└── None of the above → no memory action needed.
```

## Tool Reference

| Tool | When |
|------|------|
| `recall` | Search before answering factual questions about the user |
| `remember` | Save durable facts immediately when shared |
| `daily_log` | Log notable events, decisions, milestones during the day |
| `notebook_read` | Read a specific notebook file by path |
| `notebook_write` | Write/update a specific notebook file |

## Rules

- **Search before saying "I don't know"** — the answer might be in your notebook
- **Save before forgetting** — if it matters, write it down immediately
- Keep entries concise and searchable: `remember("Hanan is in Chiang Mai as of 2026-03-11")`
```

- [ ] **Step 2: Commit**

```bash
git add .my_agent/brain/notebook.md
git commit -m "refactor: rewrite notebook skill with structured memory triage gate

Replaces prose 'when to recall/remember' with decision tree the brain
walks through on every message. Makes recall-before-answering explicit."
```

---

### Task 8: Conversation Role — Delegation Self-Check

Add an explicit self-check to the conversation role that prevents the brain from doing work inline.

**Files:**
- Modify: `.my_agent/brain/conversation-role.md`

- [ ] **Step 1: Add delegation self-check**

Append to the end of `.my_agent/brain/conversation-role.md`:

```markdown

### Delegation Self-Check

Before responding to any actionable request, ask yourself:

- Am I about to edit a file? → **delegate**
- Am I about to run more than 2 tools? → **probably delegate** (unless it's recall + quick lookup)
- Am I about to produce an artifact (report, code, analysis)? → **delegate**
- Will this take more than one conversational turn of work? → **delegate**

If you catch yourself doing work, stop mid-response and create a task instead. It's better to delegate late than to complete the work inline — inline work has no paper trail, no todo tracking, and no status report.
```

- [ ] **Step 2: Commit**

```bash
git add .my_agent/brain/conversation-role.md
git commit -m "refactor: add delegation self-check gate to conversation role

Explicit 4-question self-check prevents brain from doing work inline.
Complements the capability routing hook (which blocks writes) with
cognitive-level awareness for all types of work."
```

---

### Task 9: Standing Orders — Visual Section Upgrade

Replace the prose visual communication directive with a pointer to the structured skill, reinforcing the decision tree pattern.

**Files:**
- Modify: `.my_agent/notebook/reference/standing-orders.md` (lines 93-98)

- [ ] **Step 1: Replace the Visual Communication section**

Replace the existing `## Visual Communication` section with:

```markdown
## Visual Communication

Follow the visual-presenter skill's decision tree on every response:
- 3+ data points → call `create_chart` (do not skip — a fallback hook generates worse charts)
- Visual topic → call `fetch_image`
- Text-only responses for data-rich content are incomplete responses

If you're unsure, err toward generating a chart. Max 3 images per response.
```

- [ ] **Step 2: Commit**

```bash
git add .my_agent/notebook/reference/standing-orders.md
git commit -m "refactor: standing orders visual section points to skill decision tree

Replaces vague 'express data visually whenever possible' with
explicit reference to visual-presenter skill's decision tree."
```

---

### Task 10: Integration Verification

Verify all changes work together: the system prompt assembles correctly, templates produce expected todos, and skills are properly loaded.

**Files:**
- All modified files from Tasks 1-9

- [ ] **Step 1: Run all existing tests**

Run: `cd packages/dashboard && npx vitest run`
Expected: all existing tests pass (no regressions)

- [ ] **Step 2: Verify system prompt includes cognitive checklist**

```bash
cd packages/dashboard && npx tsx -e "
import { SystemPromptBuilder } from './src/agent/system-prompt-builder.js';
const builder = new SystemPromptBuilder({
  brainDir: '../../.my_agent/brain',
  agentDir: '../../.my_agent',
});
const blocks = await builder.build({
  channel: 'whatsapp-transport-1',
  conversationId: 'test',
  messageIndex: 1,
});
const full = blocks.map(b => b.text).join('\\n');
console.log('Has cognitive checklist:', full.includes('Pre-Response Checklist'));
console.log('Has delegation gate:', full.includes('Delegation gate'));
console.log('Has visual gate:', full.includes('Visual gate'));
console.log('Has WhatsApp constraint:', full.includes('300 chars'));
"
```
Expected: all `true`

- [ ] **Step 3: Verify todo template fallback**

```bash
cd packages/dashboard && npx tsx -e "
import { assembleJobTodos } from './src/automations/todo-templates.js';
const noType = assembleJobTodos([{ text: 'Do research' }]);
console.log('Generic fallback items:', noType.filter(i => i.created_by === 'framework').length);
console.log('Has status-report item:', noType.some(i => i.text.includes('status-report')));
const research = assembleJobTodos([{ text: 'Research X' }], 'research');
console.log('Research template items:', research.filter(i => i.created_by === 'framework').length);
console.log('Has sources item:', research.some(i => i.text.includes('sources')));
"
```
Expected: Generic fallback items: 2, Has status-report: true, Research template items: 3, Has sources: true

- [ ] **Step 4: Verify skill files are valid markdown**

```bash
head -5 skills/visual-presenter.md
head -5 .my_agent/.claude/skills/task-triage/SKILL.md
head -5 .my_agent/brain/notebook.md
head -5 .my_agent/brain/conversation-role.md
```
Expected: all start with valid YAML frontmatter (`---`) or valid markdown headings

- [ ] **Step 5: Commit (if any fixups needed)**

Only if previous steps revealed issues that required fixes.

---

## Verification Summary

After all tasks complete, the system should exhibit these behavioral changes:

| Before | After | Safety Net |
|--------|-------|-----------|
| Brain skips `create_chart` → Haiku fallback generates chart | Brain follows visual decision tree → generates chart itself | Visual augmentation hook (unchanged, rarely fires) |
| Brain acknowledges request without deliverable → watchdog nudges | Brain checks deliverable gate → includes structured content | Response watchdog (unchanged, rarely fires) |
| Brain does research with 8+ tools, writes 50 chars → watchdog nudges | Brain follows deliverable gate → synthesizes findings | Tool-heavy silence detector (unchanged) |
| Brain does work inline → capability routing hook blocks writes | Brain checks delegation self-check → delegates proactively | Capability routing hook (unchanged) |
| Workers get 0 mandatory items for non-capability jobs | Workers get generic baseline checklist (verify + status report) | Todo completion gate (unchanged) |
| "Be thorough. Verify your work." (prose) | 4-step pre-completion self-check | Stop reminder hook (unchanged) |
| "For irreversible decisions, stop" (prose) | Explicit checklist of action types to gate on | Autonomy is prompt-level (no code gate yet) |
| "Express data visually whenever possible" (prose) | Decision tree with explicit data-point thresholds | Visual augmentation hook (unchanged) |

---

## Verdict (CTO Review — 2026-04-06)

### Core Finding

This proposal conflates two different things: **structured prompts** and **code-enforced checklists**. M9.1 proved that code enforcement (validators, completion gating, mandatory items) is what makes the Todo system work. Most tasks in this proposal are prompt restructuring — they make prompts clearer but don't add code enforcement.

### The Working Nina / Conversation Nina Split

The Todo system is a natural fit for **Working Nina** — she's autonomous, has no user in the loop, and executes jobs to completion. Code-enforced checklists are the only way to ensure process compliance.

**Conversation Nina** is conversational, not task-oriented. She responds to a user in real-time. The user IS the feedback loop. Shoehorning a "pre-response checklist" (T1) into her system prompt is prompt enforcement for a conversational agent — exactly what M9.1 proved unreliable.

### The Visual Inline Gap

The visual augmentation hook produces a **degraded outcome**: Haiku-quality chart in a **separate follow-up message**. When the brain or worker calls `create_chart` itself, the chart is Opus-quality and **inline** in the response. Almost all charts today come from the Haiku fallback — layers 1 (standing order) and 2 (skill) of the three-reinforcement-layer design are failing.

For workers, this is solvable with a mandatory todo item — code-enforced, fits the M9.1 pattern. For the brain, better skill structure (T2) is the only lever, and it's worth trying because the hook can't match the ideal outcome.

### Task-by-Task Verdict

| Task | Verdict | Reasoning |
|------|---------|-----------|
| **T1** Cognitive Pre-Response Checklist | **Drop** | Prompt enforcement on a conversational agent. Contradicts M9.1. Duplicates existing hooks. Adds system prompt bloat. |
| **T2** Visual Presenter Skill Rewrite | **Keep** | The Haiku fallback is degraded UX (separate message, lower quality). Better skill is the only lever for brain-side improvement. |
| **T3** Generic & Research Todo Templates | **Keep + Extend** | Core M9.1 extension. Every worker gets a baseline. Add chart/visual todo item for data-rich output. |
| **T4** Working Nina Pre-Completion Self-Check | **Keep** | Direct worker improvement. Replaces proven-unreliable prose with concrete steps referencing `todo_list`. |
| **T5** Autonomy Instructions → Checklist | **Drop** | Cosmetic formatting. No code enforcement added. Workers can still ignore it. |
| **T6** Task Triage → Decision Tree | **Keep (partial)** | The Automation Design Checklist (8 fields before `create_task`) addresses D7 — Conversation Nina leaving `todos` empty. The decision tree rewrite is nice-to-have. |
| **T7** Notebook/Memory → Triage Gate | **Drop** | Pure prompt formatting. No code enforcement. Brain already has memory hooks and tools. |
| **T8** Delegation Self-Check | **Drop** | Redundant with capability routing hook. Prompt-level duplicate of existing code enforcement. |
| **T9** Standing Orders Visual Upgrade | **Drop** | Trivial pointer change. Won't change behavior. |
| **T10** Integration Verification | **Keep** | Verification is essential. Adapt to M9.1-S8 pattern (real LLM smoke tests). |

### What Moves to M9.2

The filtered tasks form **M9.2: Worker Todo Coverage** — extending M9.1's proven code-enforced Todo system to all worker job types, with real LLM verification after each task (M9.1's validated methodology).

See: `docs/plans/2026-04-06-m9.2-worker-todo-coverage.md`
