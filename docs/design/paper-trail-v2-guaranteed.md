# Paper Trail v2: Guaranteed Enforcement

> **Status:** Proposed
> **Created:** 2026-04-05
> **Supersedes:** Sections of [paper-trail.md](paper-trail.md) — Builder Deliverable Frontmatter, Target Path Discovery
> **Context:** M9-S8 testing revealed that the builder ignores deliverable frontmatter requirements. Prompt-based enforcement on worker agents is unreliable — proven across M9 S4-S6 iterations.

---

## Problem

The paper trail design (v1) depends on the builder writing YAML frontmatter in its deliverable with `target_path`, `change_type`, `provider`, and `test_result`. On the first real run, the builder ignored this entirely. The executor's `writePaperTrail()` method never fired because it checks for `target_path` in frontmatter — no frontmatter, no paper trail.

This is not a one-off. M9-S6 documented 5 cases of builders ignoring prompt instructions: wrong provider, inline fallback, .env instructions, off-script questions, template precedence. Prompt enforcement requires 2-3 iterations to stabilize and remains probabilistic.

### What Works vs What Doesn't

| Approach | Reliability | Examples |
|----------|-------------|---------|
| **Executor code** (post-processing) | 100% | Session ID capture, chart generation, deliverable extraction |
| **Safety hooks** (PreToolUse) | 100% | Bash blocker, infrastructure guard, path restrictor |
| **Prompt instructions** | ~60-80% | Frontmatter requirement, provider adherence, no .env instructions |

---

## Solution: Schema-Level `target_path`

Move `target_path` from the builder's deliverable frontmatter to the `AutomationManifest` schema. The `create_automation` MCP tool sets it at creation time. The executor reads it from the manifest — zero LLM dependency.

### Schema Changes

```typescript
// packages/core/src/spaces/automation-types.ts

export interface AutomationManifest {
  name: string;
  status: "active" | "disabled";
  trigger: TriggerConfig[];
  // ... existing fields ...

  /** Path to the artifact this automation creates/modifies (relative to repo root).
   *  When set, the executor writes a DECISIONS.md entry at this path after job completion.
   *  Null for non-artifact jobs (research, summaries, debriefs). */
  target_path?: string;
}

export interface CreateAutomationInput {
  // ... existing fields ...

  /** Path to the artifact this automation creates/modifies */
  target_path?: string;
}
```

### MCP Tool Changes

```typescript
// packages/dashboard/src/mcp/automation-server.ts — create_automation tool

// Add to schema:
target_path: z.string().optional()
  .describe("Path to the artifact folder this job creates or modifies (e.g., .my_agent/capabilities/stt-deepgram). When set, the framework writes a paper trail entry to DECISIONS.md at this path after job completion."),

// Pass through to manifest:
manifest: {
  // ...existing fields...
  target_path: args.target_path,
}
```

### Executor Changes

```typescript
// packages/dashboard/src/automations/automation-executor.ts

// After job completion (replaces current writePaperTrail logic):

// 1. Determine target_path: manifest field (guaranteed) > frontmatter (enrichment)
const targetPath = automation.manifest.target_path
  ?? parseFrontmatterContent(finalDeliverable).data?.target_path;

if (targetPath) {
  this.writePaperTrail(targetPath, finalDeliverable, automation, job);
}
```

The `writePaperTrail()` method changes signature: it receives `targetPath` as a parameter instead of extracting it from frontmatter. Frontmatter fields (`change_type`, `provider`, `test_result`) still enrich the entry when present — but the entry is written regardless.

---

## Two Sources of Truth

The debate established that jobs and artifacts serve different consumers:

| Source | Question It Answers | Consumer | Durability |
|--------|-------------------|----------|------------|
| **JSONL + SQLite** | What jobs ran? Status? Can I resume? | Executor, dashboard, notifications | Permanent (JSONL), derived (SQLite) |
| **DECISIONS.md at artifact** | What happened here? Why? What before modifying? | Brainstorming skill, builder, human | Permanent (survives job pruning) |

These are complementary, not competing. DECISIONS.md is the artifact's institutional memory. JSONL is the system's operational memory.

---

## Three Writers, Two Guarantee Tiers

| Writer | When | What | Guarantee |
|--------|------|------|-----------|
| **Executor** | After job completes | Date, automation name, job link, change_type + test_result (from frontmatter if available) | **Code — guaranteed** |
| **Brainstorming skill** | Before spawning builder | Strategic context: why this provider, alternatives considered, user rationale | **Best-effort enrichment** |
| **Builder** | During job | Implementation notes, workarounds, decisions made during build | **Optional enrichment** |

### Guaranteed Minimum Entry (executor)

Even if both the brainstorming skill and builder write nothing, the executor produces:

```markdown
## 2026-04-05 — build-deepgram-stt-capability
- **Change type:** unknown
- **Job:** [build-deepgram-stt-capability/job-0d0f5e2f](../../automations/.runs/build-deepgram-stt-capability/job-0d0f5e2f/)
```

The job link leads to `deliverable.md` which contains the builder's full output — provider choice, test results, implementation details. The three-level detail chain works: DECISIONS.md (summary) -> deliverable.md (detail) -> status-report.md (scratch).

### Enriched Entry (when frontmatter present)

```markdown
## 2026-04-05 — build-deepgram-stt-capability
- **Change type:** create
- **Provider:** Deepgram Nova-2
- **Test:** healthy (1.4s)
- **Files:** CAPABILITY.md, scripts/transcribe.sh, config.yaml
- **Job:** [build-deepgram-stt-capability/job-0d0f5e2f](../../automations/.runs/build-deepgram-stt-capability/job-0d0f5e2f/)
```

### With Brainstorming Context (pre-job)

```markdown
## 2026-04-05 — Add multilingual support
- **Change type:** configure
- **Why:** User requested Hebrew support. Deepgram Nova-2 supports auto language detection.
- **Test:** healthy (1.3s)
- **Job:** [modify-stt-deepgram/job-a1b2c3d4](../../automations/.runs/modify-stt-deepgram/job-a1b2c3d4/)
```

---

## Modify Flow (unchanged from v1)

The modify flow from the original design spec remains the same. The brainstorming skill:

1. Reads DECISIONS.md for history
2. Determines change type (configure/upgrade/fix/replace)
3. Writes strategic context to DECISIONS.md (best-effort)
4. Calls `create_automation` with `target_path` set to existing capability folder
5. Includes `resume_from_job` in instructions for session continuity
6. Executor appends structured metadata after job completes (guaranteed)

---

## Non-Artifact Jobs

Jobs without `target_path` in their manifest (research, daily summaries, debriefs) skip the paper trail entirely. No DECISIONS.md is written. Their paper trail remains in `.runs/` as before.

This is the clean discriminator: `automation.manifest.target_path != null` means "this job produces a durable artifact that needs institutional memory."

---

## Files Changed

| File | Change | Scope |
|------|--------|-------|
| `packages/core/src/spaces/automation-types.ts` | Add `target_path?: string` to `AutomationManifest` and `CreateAutomationInput` | 2 lines |
| `packages/dashboard/src/mcp/automation-server.ts` | Add `target_path` to `create_automation` tool schema + pass through | 5 lines |
| `packages/dashboard/src/automations/automation-manager.ts` | Pass `target_path` through manifest creation | 1 line |
| `packages/dashboard/src/automations/automation-executor.ts` | Read `target_path` from manifest first, frontmatter second. Pass to `writePaperTrail()` | ~10 lines |
| `packages/core/src/agents/definitions.ts` | Keep frontmatter section (optional enrichment), demote from "MUST" to "SHOULD" | Prompt update |

**Estimated scope:** ~20 lines of code changes + prompt adjustment.

---

## What This Does NOT Change

- **DECISIONS.md format** — same as v1
- **Session resumption** — same as v1 (fixed cross-automation lookup from reviewer feedback)
- **Brainstorming skill modify flow** — same as v1
- **Job infrastructure** (JSONL, .runs/, pruning) — untouched
- **Builder prompt** — frontmatter stays as optional enrichment
