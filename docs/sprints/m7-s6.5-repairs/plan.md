# M7-S6.5: Repairs + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix gaps and deviations found during post-implementation design review.

**Architecture:** Repair sprint — no new architecture, fixing existing code to match the design spec.

**Tech Stack:** TypeScript, Alpine.js, Tailwind CSS, Fastify

**Spec:** `docs/superpowers/specs/2026-03-22-m7-spaces-automations-jobs.md`

---

## Task 1: Wire `openTimelineItem()`

**Problem:** `openTimelineItem()` is called at lines ~1218 and ~6155 of `index.html` but never defined. Clicking timeline items does nothing.

**Files:**
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Define `openTimelineItem(item)` in the app methods**

Add near the existing `openAutomationDetail()` method (~line 4933):

```javascript
openTimelineItem(item) {
  if (item.itemType === 'event') {
    // Calendar events — open calendar tab with event selected
    this.switchTab('calendar');
    return;
  }
  // Jobs and projected items — open parent automation detail
  if (item.automationId) {
    this.openAutomationDetail(item.automationId);
  }
},
```

The `item` object has `itemType` ('job' | 'projected' | 'event'), `automationId` (for jobs/projected), and `status`.

**Test approach:**
1. Restart dashboard service
2. Click a job item in the timeline — should open the parent automation detail tab
3. Click a projected future item — should open the parent automation detail tab
4. Click a calendar event — should switch to the calendar tab

**Commit:** `fix(m7-s6.5): wire openTimelineItem() for timeline click navigation`

---

## Task 2: Drop `delivery` field

**Problem:** The `delivery` field on automations is dead weight — no automation uses it, and the execution pipeline uses ConversationInitiator for all user notification, not channel delivery actions.

**Files:**
- Modify: `packages/core/src/spaces/automation-types.ts`
- Modify: `packages/dashboard/src/conversations/db.ts`
- Modify: `packages/dashboard/src/mcp/automation-server.ts`
- Modify: `packages/dashboard/src/automations/automation-manager.ts`

- [ ] **Step 1: Remove types from `automation-types.ts`**

Delete the `AutomationDeliveryAction` interface (lines 26-30). Remove `delivery` field from `AutomationManifest` (line 42) and `CreateAutomationInput` (line 95).

- [ ] **Step 2: Remove from DB schema in `db.ts`**

Remove `delivery` from the INSERT statement (line 792), the ON CONFLICT SET clause (line 804), the parameter binding (line 821), and the row type interfaces (lines 785, 844, 871, 905). Keep the column in CREATE TABLE for now (SQLite doesn't support DROP COLUMN easily) but stop reading/writing it. In the upsert, pass `null` for delivery to keep column count consistent, or remove it from the SQL entirely.

- [ ] **Step 3: Remove from MCP schema in `automation-server.ts`**

Remove the `delivery` property from the `create_automation` zod schema (line 66) and the delivery mapping in the handler (line 87).

- [ ] **Step 4: Remove from `automation-manager.ts`**

Remove delivery handling at lines 55, 170, 200, 258-259, 286, 306. These are spread across `createFromInput()`, `loadFromDb()`, `parseManifest()`, `toDbRow()`, and `manifestToFrontmatter()`.

- [ ] **Step 5: Verify no automation manifest uses `delivery`**

```bash
grep -r "delivery" ~/.my_agent/automations/ 2>/dev/null || echo "No delivery fields found"
```

**Test approach:**
1. TypeScript compiles without errors (`npx tsc --noEmit`)
2. Dashboard starts successfully
3. Creating an automation via MCP tool works without delivery field
4. Existing automations load correctly

**Commit:** `refactor(m7-s6.5): remove dead delivery field from automations`

---

## Task 3: Desktop Home 2x2 grid

**Problem:** Desktop Home tab shows widgets stacked full-width. Spec calls for a 2x2 grid layout.

**Files:**
- Modify: `packages/dashboard/public/index.html`

- [ ] **Step 1: Wrap the four desktop widgets in a CSS grid container**

The four widgets (Spaces ~line 422, Automations ~line 476, Notebook ~line 538, Conversations ~line 882) each have `class="hidden sm:block glass-strong rounded-xl overflow-hidden mb-4"`. Wrap them in a grid container:

```html
<!-- Home 2x2 grid (desktop only) -->
<div class="hidden sm:grid sm:grid-cols-2 gap-4 mb-4">
  <!-- Spaces Widget -->
  <div class="glass-strong rounded-xl overflow-hidden">
    ...existing spaces widget content...
  </div>
  <!-- Automations Widget -->
  <div class="glass-strong rounded-xl overflow-hidden">
    ...existing automations widget content...
  </div>
  <!-- Notebook Widget -->
  <div class="glass-strong rounded-xl overflow-hidden">
    ...existing notebook widget content...
  </div>
  <!-- Conversations Widget -->
  <div class="glass-strong rounded-xl overflow-hidden">
    ...existing conversations widget content...
  </div>
</div>
```

Remove `hidden sm:block` and `mb-4` from each individual widget div (the grid container handles visibility and spacing). Keep mobile compact cards unchanged (they're in a separate section).

**Test approach:**
1. Desktop (>640px): Four widgets in 2x2 grid — Spaces top-left, Automations top-right, Notebook bottom-left, Conversations bottom-right
2. Mobile (<640px): Widgets hidden (mobile uses separate compact cards)
3. All widget content and click handlers still work

**Commit:** `fix(m7-s6.5): arrange Home tab widgets in 2x2 grid on desktop`

---

## Task 4: Unify chat tag injection

**Problem:** Three separate hardcoded context injection mechanisms — `activeTaskContext` (dead code), `activeAutomationContext` (works but specific), and space context (frontend sends `spaceName` but backend ignores it). Should be one generic system.

**Files:**
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts`
- Modify: `packages/dashboard/src/agent/session-manager.ts`
- Modify: `packages/dashboard/src/chat/chat-service.ts`

- [ ] **Step 1: Replace `BuildContext` fields in `system-prompt-builder.ts`**

Replace lines 32-36:
```typescript
// OLD
activeTaskContext?: { taskId: string; title: string } | null;
activeAutomationContext?: { automationId: string; name: string } | null;

// NEW
activeViewContext?: {
  type: 'space' | 'automation' | 'conversation' | 'notebook' | 'calendar';
  id: string;
  name: string;
} | null;
```

- [ ] **Step 2: Replace the if-blocks in `build()` method (~lines 127-139)**

Replace the two separate `activeTaskContext` and `activeAutomationContext` blocks with one generic block:

```typescript
if (context.activeViewContext) {
  const v = context.activeViewContext;
  const typeLabel = v.type.charAt(0).toUpperCase() + v.type.slice(1);
  dynamicParts.push(
    `[Active ${typeLabel} View]\nThe user is viewing ${v.type}: "${v.name}" (${v.id})\nIf they ask about "this ${v.type}" or want changes, use the relevant ${v.type} tools.\n[End Active ${typeLabel} View]`,
  );
}
```

- [ ] **Step 3: Replace session-manager properties (~lines 171-197)**

Remove `activeTaskContext` and `activeAutomationContext` properties plus `setTaskContext()` and `setAutomationContext()` methods. Replace with:

```typescript
private activeViewContext: {
  type: 'space' | 'automation' | 'conversation' | 'notebook' | 'calendar';
  id: string;
  name: string;
} | null = null;

setViewContext(type: string, id: string, name: string): void {
  this.activeViewContext = { type: type as any, id, name };
}
```

Update `getBuildContext()` (~line 331) to pass `activeViewContext` instead of the two old fields. Update the null-reset after use (~lines 335-336).

- [ ] **Step 4: Update `chat-service.ts` context wiring (~lines 405-421)**

Replace the two type-specific blocks with one generic handler:

```typescript
// ── View context (generic) ────────────────────────────────
if (options?.context) {
  const ctx = options.context;
  if (ctx.type === 'automation' && ctx.automationId) {
    sessionManager.setViewContext('automation', ctx.automationId, ctx.automationName || ctx.title || '');
  } else if (ctx.type === 'space' && ctx.spaceName) {
    sessionManager.setViewContext('space', ctx.spaceName, ctx.title || ctx.spaceName);
  } else if (ctx.type === 'conversation' && ctx.conversationId) {
    sessionManager.setViewContext('conversation', ctx.conversationId, ctx.title || '');
  } else if (ctx.type === 'notebook' && ctx.file) {
    sessionManager.setViewContext('notebook', ctx.file, ctx.title || '');
  } else if (ctx.type === 'calendar') {
    sessionManager.setViewContext('calendar', 'calendar', ctx.title || 'Calendar');
  }
}
```

- [ ] **Step 5: Update the WebSocket context type in `chat-handler.ts` (~line 291)**

Add `spaceName` to the context type if not already present:
```typescript
context?: {
  type: string;
  title: string;
  file?: string;
  taskId?: string;
  automationId?: string;
  automationName?: string;
  spaceName?: string;
  conversationId?: string;
} | null;
```

**Test approach:**
1. TypeScript compiles
2. Open a space detail tab, send a chat message — brain should see `[Active Space View]` in prompt
3. Open an automation detail tab, send a chat message — brain should see `[Active Automation View]`
4. Open a notebook file, send a chat message — brain should see `[Active Notebook View]`

**Commit:** `refactor(m7-s6.5): unify chat context injection into generic activeViewContext`

---

## Task 5: Dead code sweep

**Problem:** Remaining task system references from the old system that were missed by the S5 cleanup.

**Files:**
- Modify: `packages/dashboard/public/js/app.js`
- Delete: `packages/core/src/mcp/task-server.ts`
- Modify: `packages/core/src/mcp/index.ts`
- Possibly others found by grep

- [ ] **Step 1: Remove `taskId` reference in `app.js` (~line 1756)**

```javascript
// OLD
taskId: tab.data?.task?.id,

// NEW — remove this line entirely
```

The chatContext object no longer needs a `taskId` field since tasks are deleted.

- [ ] **Step 2: Delete `packages/core/src/mcp/task-server.ts`**

This is a stub file that returns "Not implemented yet" for all tools. Fully dead.

- [ ] **Step 3: Remove task-server export from `packages/core/src/mcp/index.ts`**

Remove the `createTaskServer` re-export if present.

- [ ] **Step 4: Comprehensive grep for remaining task references**

```bash
grep -rn "task" packages/dashboard/src/ packages/core/src/ --include="*.ts" --include="*.js" | grep -v node_modules | grep -v ".test." | grep -v "// " | grep -v "taskId.*undefined"
```

Classify each as legitimate (English word "task" in comments, `activeWorkingAgents` descriptions) or dead code. Remove dead code.

Common false positives to keep:
- "task" in English comments about background work
- `TaskExecutor` references if AutomationExecutor extends it
- `activeWorkingAgents` descriptions mentioning "tasks"
- Test files (separate concern)

- [ ] **Step 5: Check for old test files referencing tasks**

Review test files and remove any that test deleted task functionality (e.g., triage tests mentioning delivery actions, task creation tests).

**Test approach:**
1. TypeScript compiles in both core and dashboard packages
2. Dashboard starts and functions normally
3. `grep -rn "activeTaskContext\|revise_task\|setTaskContext\|task-server" packages/` returns no hits outside tests/comments

**Commit:** `chore(m7-s6.5): remove remaining dead task system references`

---

## Task 6: Referenced automations on space detail

**Problem:** Space detail shows static "No automations reference this space yet." text. Should query and display actual referencing automations.

**Files:**
- Modify: `packages/dashboard/src/routes/spaces.ts`
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js`

- [ ] **Step 1: Extend the space detail API response**

In `packages/dashboard/src/routes/spaces.ts`, in the `GET /api/spaces/:name` handler (~line 59), add a query for referencing automations after loading the manifest:

```typescript
// Query automations that reference this space
const referencingAutomations = db.prepare(
  `SELECT id, name, status FROM automations WHERE spaces LIKE ?`
).all(`%"${spaceName}"%`);
```

Include `referencingAutomations` in the response object.

- [ ] **Step 2: Store referencing automations in tab data**

In `app.js`, in the `openSpaceDetail()` method (or wherever the space detail data is fetched), store the `referencingAutomations` array in `tab.data`.

- [ ] **Step 3: Replace placeholder text in `index.html`**

Replace the static placeholder at lines ~4371-4373 and ~4513-4515 with:

```html
<!-- Referenced Automations -->
<div class="mt-6 pt-4 border-t border-white/5">
  <label class="text-[10px] font-semibold uppercase text-tokyo-muted tracking-wider block mb-2">Referenced By</label>
  <template x-if="!tab.data.referencingAutomations?.length">
    <p class="text-xs text-tokyo-muted/60 italic">No automations reference this space yet</p>
  </template>
  <div class="space-y-1">
    <template x-for="auto in (tab.data.referencingAutomations || [])" :key="auto.id">
      <button
        @click="openAutomationDetail(auto.id)"
        class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-tokyo-blue/10 transition-colors group text-left"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5 text-tokyo-muted group-hover:text-tokyo-blue shrink-0">
          <path fill-rule="evenodd" d="M8.074.945A4.993 4.993 0 0 0 6 5v.032c.004.6.114 1.176.311 1.709.16.428-.204.91-.61.7a5.023 5.023 0 0 1-1.868-1.677c-.202-.304-.648-.363-.848-.058a6 6 0 1 0 8.017-1.901l-.004-.007a4.98 4.98 0 0 1-2.18-2.574c-.116-.31-.477-.472-.744-.28Zm.78 6.178a3.001 3.001 0 1 1-3.473 4.341c-.205-.365.215-.694.62-.59a4.008 4.008 0 0 0 1.828.047c.96-.2 1.747-.918 2.08-1.36a.55.55 0 0 0-.054-.678Z" clip-rule="evenodd"/>
        </svg>
        <span class="text-xs text-tokyo-text truncate" x-text="auto.name"></span>
        <span
          class="text-[9px] px-1 py-px rounded ml-auto"
          :class="auto.status === 'active' ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'"
          x-text="auto.status"
        ></span>
      </button>
    </template>
  </div>
</div>
```

Apply this replacement in both the overview panel (~line 4371) and the SPACE.md property view (~line 4513).

**Test approach:**
1. Create a test automation that references a space in its `spaces` array
2. Open that space's detail tab
3. Verify the automation appears as a clickable link
4. Click it — should open the automation detail tab

**Commit:** `feat(m7-s6.5): show referencing automations on space detail tab`

---

## Task 7: Space property view polish

**Problem:** Four missing features from the design mockup: editable name in header, runtime as dropdown, run button for tools, maintenance rules as left-bordered list.

**Files:**
- Modify: `packages/dashboard/public/index.html`
- Modify: `packages/dashboard/public/js/app.js` (for run button handler)

- [ ] **Step 1: Name editable in header**

At line ~4380, change the static `x-text` header to an inline input:

```html
<!-- OLD -->
<h2 class="text-xl font-bold text-tokyo-text mb-4" x-text="tab.data.name"></h2>

<!-- NEW -->
<div class="flex items-center gap-3 mb-4">
  <input
    type="text"
    :value="tab.data.name"
    @blur="if ($el.value !== tab.data.name) updateSpaceField(tab.data.name, 'name', $el.value)"
    class="text-xl font-bold text-tokyo-text bg-transparent border-b border-transparent hover:border-white/10 focus:border-tokyo-blue/50 outline-none py-0.5 transition-colors flex-1"
  />
</div>
```

- [ ] **Step 2: Runtime as dropdown**

Replace the text input at lines ~4420-4428 with a `<select>`:

```html
<select
  :value="tab.data.manifest?.runtime || ''"
  @change="updateSpaceField(tab.data.name, 'runtime', $el.value || undefined)"
  class="text-sm text-tokyo-text bg-transparent border-b border-transparent hover:border-white/10 focus:border-tokyo-blue/50 outline-none py-0.5 transition-colors font-mono appearance-none cursor-pointer"
>
  <option value="" class="bg-[#1f2335]">none</option>
  <option value="uv" class="bg-[#1f2335]">uv</option>
  <option value="node" class="bg-[#1f2335]">node</option>
  <option value="bash" class="bg-[#1f2335]">bash</option>
</select>
```

- [ ] **Step 3: Run button for tool spaces**

Add to the header area (Step 1's `<div>`) after the name input, conditionally shown for tool spaces:

```html
<button
  x-show="tab.data.manifest?.runtime && tab.data.manifest?.entry && tab.data.manifest?.io"
  @click="runToolSpace(tab.data.name)"
  class="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors flex items-center gap-1.5"
>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3">
    <path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z"/>
  </svg>
  Run
</button>
```

In `app.js`, add the handler:

```javascript
runToolSpace(spaceName) {
  // For now, fire via the automation system or show an input prompt
  const input = prompt('Input JSON (or leave empty for default):');
  if (input === null) return; // cancelled
  // Send via WebSocket or call fire_automation
  this.sendMessage(`Run the ${spaceName} tool${input ? ` with input: ${input}` : ''}`);
},
```

- [ ] **Step 4: Maintenance rules as left-bordered list**

Replace the plain `<pre>` for the body content (~line 4508-4511). Parse maintenance rules from the markdown body and render them with left-border styling:

```html
<div x-show="tab.data.body" class="mt-4 glass-strong rounded-xl p-5">
  <label class="text-[10px] font-semibold uppercase text-tokyo-muted tracking-wider block mb-2">Notes & Maintenance Rules</label>
  <div class="border-l-2 border-tokyo-blue/30 pl-3 space-y-1.5">
    <template x-for="line in (tab.data.body || '').split('\n').filter(l => l.trim())" :key="line">
      <p class="text-xs text-tokyo-text/80 leading-relaxed" x-text="line.replace(/^[-*#]+\s*/, '')"></p>
    </template>
  </div>
</div>
```

**Test approach:**
1. Open a tool space detail (one with runtime + entry + io)
2. Verify name is editable inline (underline on focus)
3. Verify runtime shows as a dropdown with uv/node/bash/none options
4. Verify Run button appears for tool spaces, not for plain data spaces
5. Verify maintenance rules render with left blue border
6. Edit the name, blur — verify it saves (check API call in network tab)

**Commit:** `feat(m7-s6.5): polish space property view — editable name, runtime dropdown, run button, maintenance rules`

---

## Task 8: SpaceSyncService use shared `readFrontmatter()`

**Problem:** `packages/core/src/spaces/space-sync-service.ts` implements its own `parseFrontmatter()` (lines 104-120) using raw `yaml.parse()`. Should use the shared utility per CLAUDE.md convention.

**Files:**
- Create: `packages/core/src/metadata/frontmatter.ts`
- Modify: `packages/core/src/spaces/space-sync-service.ts`
- Modify: `packages/core/src/index.ts` (export new utility)

- [ ] **Step 1: Create `readFrontmatter` in core package**

The utility lives in `packages/dashboard/src/metadata/frontmatter.ts` but SpaceSyncService is in core. Since this is a framework-level utility, create a lightweight copy in core:

```typescript
// packages/core/src/metadata/frontmatter.ts
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export interface FrontmatterResult<T = Record<string, unknown>> {
  data: T;
  body: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Use this for content already in memory (e.g., from FileWatcher).
 */
export function parseFrontmatterContent<T = Record<string, unknown>>(
  content: string,
): FrontmatterResult<T> {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { data: {} as T, body: content };
  }
  const closingIndex = content.indexOf("\n---", 4);
  if (closingIndex === -1) {
    return { data: {} as T, body: content };
  }
  const yamlStr = content.slice(4, closingIndex);
  let body = content.slice(closingIndex + 4);
  if (body.startsWith("\n")) body = body.slice(1);
  const data = (parse(yamlStr) as T) ?? ({} as T);
  return { data, body };
}

/**
 * Read and parse YAML frontmatter from a markdown file on disk.
 */
export function readFrontmatter<T = Record<string, unknown>>(
  filePath: string,
): FrontmatterResult<T> {
  const content = readFileSync(filePath, "utf-8");
  return parseFrontmatterContent<T>(content);
}
```

Note: SpaceSyncService receives content from FileWatcher (already read), so it needs `parseFrontmatterContent()` (from string), not `readFrontmatter()` (from file path).

- [ ] **Step 2: Update `space-sync-service.ts`**

Replace the private `parseFrontmatter()` method (lines 104-120) with an import:

```typescript
import { parseFrontmatterContent } from '../metadata/frontmatter.js'
```

Update the call site at line 74:
```typescript
// OLD
const { data, body } = this.parseFrontmatter(change.content)

// NEW
const { data, body } = parseFrontmatterContent(change.content)
```

Delete the private `parseFrontmatter` method.

- [ ] **Step 3: Check AutomationSyncService for the same issue**

```bash
grep -n "parseFrontmatter\|yaml.parse\|parse(yaml" packages/dashboard/src/automations/automation-sync-service.ts 2>/dev/null
grep -n "parseFrontmatter\|yaml.parse" packages/core/src/ -r
```

If AutomationSyncService has its own parser, update it to use `parseFrontmatterContent` as well.

- [ ] **Step 4: Export from core package**

Add to `packages/core/src/index.ts`:
```typescript
export { readFrontmatter, parseFrontmatterContent } from './metadata/frontmatter.js'
```

**Test approach:**
1. TypeScript compiles in core package
2. Dashboard starts — SpaceSyncService indexes spaces correctly
3. Add/modify a SPACE.md — verify it syncs to agent.db correctly

**Commit:** `refactor(m7-s6.5): extract shared parseFrontmatterContent to core, use in SpaceSyncService`

---

## Task 9: Timeline polish

**Problem:** Three minor visual deviations from the design spec.

**Files:**
- Modify: `packages/dashboard/public/index.html`

- [ ] **Step 1: "one-off" trigger badge**

At lines ~1246-1256 (desktop timeline) and ~6191-6200 (mobile timeline), the trigger badge currently renders `item.triggerType` text directly. For one-off automations, the trigger type is "manual" but should display as "one-off".

Replace the `x-text` on the trigger badge:
```html
<!-- OLD -->
x-text="item.triggerType"

<!-- NEW -->
x-text="item.isOneOff ? 'one-off' : item.triggerType"
```

This requires the timeline item data to include an `isOneOff` field. Check if it's already present; if not, add it in the timeline data builder in `app.js` where items are constructed from job/automation data. The `once` field from the automation manifest indicates this.

In `app.js`, where timeline items are built from jobs, add:
```javascript
isOneOff: automation?.once === true || automation?.once === 1,
```

- [ ] **Step 2: Spinner badge for running jobs**

After the trigger badge template in both desktop (~line 1256) and mobile (~line 6200), add a spinner for running items:

```html
<template x-if="item.status === 'running'">
  <span class="flex items-center gap-1 text-[9px] px-1 py-px rounded bg-blue-500/15 text-blue-400">
    <svg class="animate-spin w-2.5 h-2.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    running
  </span>
</template>
```

- [ ] **Step 3: Blue dots for scheduled (not cyan)**

The spec says "blue (scheduled/running)" but implementation uses cyan for scheduled. At line ~1211 and ~6168+:

```html
<!-- OLD -->
'bg-cyan-400/60': item.status === 'scheduled' || item.itemType === 'projected',

<!-- NEW -->
'bg-blue-400/60': item.status === 'scheduled' || item.itemType === 'projected',
```

Also update the trigger badge color for schedule type at lines ~1251 and ~6195:

```html
<!-- OLD -->
'bg-cyan-500/15 text-cyan-400': item.triggerType === 'schedule',

<!-- NEW -->
'bg-blue-500/15 text-blue-400': item.triggerType === 'schedule',
```

**Test approach:**
1. View timeline with a running job — should show spinner badge next to "running" text
2. View timeline with a one-off automation job — should show "one-off" badge instead of "manual"
3. View timeline with scheduled future items — dots should be blue (not cyan)

**Commit:** `fix(m7-s6.5): timeline polish — one-off badge, running spinner, blue scheduled dots`
