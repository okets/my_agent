# M9.4-S4: Brief Delivery Pipeline Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken brief delivery pipeline so worker output reaches the user without truncation or re-summarization. Workers summarize their own work, the reporter assembles (no Haiku re-digest), and Conversation Nina presents.

**Architecture:** Three layers replace the current `.slice(0, 500)` truncation: (1) workers write a deliverable as a mandatory todo, (2) the notification path reads from disk artifacts instead of the raw stream, (3) a Haiku fallback summarizes only when both layers fail. The debrief-reporter becomes an assembler — ordering worker deliverables, not re-summarizing them. Both notification delivery paths (heartbeat alert + pending briefing) get framing fixes.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Claude Agent SDK

**Bug doc:** `docs/bugs/2026-04-08-brief-delivery-broken.md`

**Depends on:** M9.4-S2 (channel unification) must land first — S2 modifies `conversation-initiator.ts` and `chat-service.ts`.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/dashboard/src/automations/automation-processor.ts` | Read deliverables from disk instead of `result.work`, remove `.slice(0, 500)` |
| Modify | `packages/dashboard/src/automations/automation-executor.ts` | Replace `.slice(0, 500)` with deliverable-based DB summary |
| Modify | `packages/dashboard/src/automations/todo-templates.ts` | Add mandatory deliverable todo to `generic` and `research` templates |
| Modify | `packages/dashboard/src/automations/todo-validators.ts` | Add `deliverable_written` validator |
| Modify | `packages/dashboard/src/automations/heartbeat-service.ts` | Fix `formatNotification()` framing for job completions |
| Modify | `packages/dashboard/src/agent/system-prompt-builder.ts` | Fix `[Pending Briefing]` framing |
| Modify | `packages/dashboard/src/scheduler/jobs/handler-registry.ts` | Reporter becomes assembler — no Haiku re-digest |
| Modify | `packages/dashboard/src/app.ts` | Pending briefing provider reads deliverable content |
| Modify | `packages/dashboard/tests/unit/automations/automation-processor.test.ts` | Tests for disk-based summary resolution |
| Create | `packages/dashboard/tests/unit/automations/notification-summary.test.ts` | Tests for summary resolution logic |
| Modify | `packages/dashboard/tests/unit/automations/automation-processor.test.ts` | Update existing notification tests |
| Modify | `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts` | Tests for new framing |
| Create | `packages/dashboard/tests/unit/automations/deliverable-validator.test.ts` | Tests for `deliverable_written` validator |

---

## Task 1: Summary Resolution — Read Deliverables from Disk

The notification path currently reads `result.work` (the raw SDK stream) and slices it to 500 chars. Replace with a function that reads the worker's actual artifacts from disk.

**Files:**
- Create: `packages/dashboard/src/automations/summary-resolver.ts`
- Create: `packages/dashboard/tests/unit/automations/notification-summary.test.ts`

- [ ] **Step 1: Write the failing test — prefers deliverable.md**

In `packages/dashboard/tests/unit/automations/notification-summary.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveJobSummary } from "../../../src/automations/summary-resolver.js";

describe("resolveJobSummary", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-resolver-"));
  });

  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("returns deliverable.md content when it exists", () => {
    fs.writeFileSync(
      path.join(runDir, "deliverable.md"),
      "## Research Results\n\nFound 3 VPN providers suitable for Thailand.",
    );
    fs.writeFileSync(
      path.join(runDir, "status-report.md"),
      "Searched 5 sources, wrote deliverable.",
    );

    const result = resolveJobSummary(runDir, "This is the raw stream output that is very long...");
    expect(result).toBe("## Research Results\n\nFound 3 VPN providers suitable for Thailand.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/notification-summary.test.ts
```

Expected: FAIL — `resolveJobSummary` not found.

- [ ] **Step 3: Write `resolveJobSummary` — minimal implementation for first test**

Create `packages/dashboard/src/automations/summary-resolver.ts`:

```typescript
/**
 * Summary Resolver — Read worker artifacts from disk for notification content.
 *
 * Priority: deliverable.md → status-report.md → result.work (with size guard).
 * This replaces the .slice(0, 500) truncation with artifact-based resolution.
 */

import fs from "node:fs";
import path from "node:path";
import { readFrontmatter } from "../metadata/frontmatter.js";

const MAX_FALLBACK_CHARS = 4000;

/**
 * Resolve a human-readable summary for a completed job.
 *
 * @param runDir - The job's workspace directory (contains deliverable.md, status-report.md, etc.)
 * @param fallbackWork - The raw result.work from the SDK stream (last resort)
 * @returns The best available summary content
 */
export function resolveJobSummary(
  runDir: string | null | undefined,
  fallbackWork: string,
): string {
  if (runDir) {
    // Layer 1: deliverable.md — the worker's clean output
    const deliverablePath = path.join(runDir, "deliverable.md");
    if (fs.existsSync(deliverablePath)) {
      const raw = fs.readFileSync(deliverablePath, "utf-8").trim();
      if (raw.length > 0) {
        // Strip YAML frontmatter if present — we want the content, not metadata
        const { content } = readFrontmatter<Record<string, unknown>>(deliverablePath);
        const body = content.trim();
        if (body.length > 0) return body;
        // Frontmatter-only file — fall through
      }
    }

    // Layer 2: status-report.md — operational summary
    const reportPath = path.join(runDir, "status-report.md");
    if (fs.existsSync(reportPath)) {
      const content = fs.readFileSync(reportPath, "utf-8").trim();
      if (content.length > 0) return content;
    }
  }

  // Layer 3: raw result.work with size guard
  if (fallbackWork.length <= MAX_FALLBACK_CHARS) {
    return fallbackWork;
  }
  return fallbackWork.slice(0, MAX_FALLBACK_CHARS) +
    "\n\n[Output truncated — full results in job workspace]";
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/notification-summary.test.ts
```

Expected: PASS

- [ ] **Step 5: Add remaining tests**

Append to `notification-summary.test.ts`:

```typescript
  it("falls back to status-report.md when no deliverable.md", () => {
    fs.writeFileSync(
      path.join(runDir, "status-report.md"),
      "Searched 5 sources. Found 3 relevant results. No issues.",
    );

    const result = resolveJobSummary(runDir, "raw stream...");
    expect(result).toBe("Searched 5 sources. Found 3 relevant results. No issues.");
  });

  it("falls back to result.work when no artifacts exist", () => {
    const result = resolveJobSummary(runDir, "Short direct answer.");
    expect(result).toBe("Short direct answer.");
  });

  it("truncates long result.work fallback with message", () => {
    const longStream = "x".repeat(5000);

    const result = resolveJobSummary(runDir, longStream);
    expect(result.length).toBeLessThan(5000);
    expect(result).toContain("[Output truncated");
    expect(result).toContain("x".repeat(4000));
  });

  it("strips YAML frontmatter from deliverable.md", () => {
    fs.writeFileSync(
      path.join(runDir, "deliverable.md"),
      "---\nchange_type: fix\ntest_result: pass\n---\n\nFixed the authentication bug by updating the token refresh logic.",
    );

    const result = resolveJobSummary(runDir, "raw stream...");
    expect(result).toBe("Fixed the authentication bug by updating the token refresh logic.");
  });

  it("skips frontmatter-only deliverable.md (no body content)", () => {
    fs.writeFileSync(
      path.join(runDir, "deliverable.md"),
      "---\nchange_type: fix\n---\n",
    );
    fs.writeFileSync(
      path.join(runDir, "status-report.md"),
      "Work completed successfully.",
    );

    const result = resolveJobSummary(runDir, "raw stream...");
    expect(result).toBe("Work completed successfully.");
  });

  it("handles null runDir gracefully", () => {
    const result = resolveJobSummary(null, "Direct result.");
    expect(result).toBe("Direct result.");
  });

  it("handles empty deliverable.md — falls through to status-report", () => {
    fs.writeFileSync(path.join(runDir, "deliverable.md"), "");
    fs.writeFileSync(path.join(runDir, "status-report.md"), "Completed the task.");

    const result = resolveJobSummary(runDir, "raw stream...");
    expect(result).toBe("Completed the task.");
  });
```

- [ ] **Step 6: Run full test suite for the new file**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/notification-summary.test.ts
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/automations/summary-resolver.ts packages/dashboard/tests/unit/automations/notification-summary.test.ts
git commit -m "feat(s4): summary resolver — read worker artifacts from disk instead of raw stream"
```

---

## Task 2: Wire Summary Resolver into Notification Path

Replace `.slice(0, 500)` in `automation-processor.ts` with the summary resolver.

**Files:**
- Modify: `packages/dashboard/src/automations/automation-processor.ts:222-227`
- Modify: `packages/dashboard/tests/unit/automations/automation-processor.test.ts`

- [ ] **Step 1: Write the failing test — notification uses deliverable.md content**

Append to `packages/dashboard/tests/unit/automations/automation-processor.test.ts`:

```typescript
  it("should use deliverable.md content for notification summary when available", async () => {
    const automation = createTestAutomation({ notify: "immediate" });

    const notifDir = join(tempDir, "notifications");
    const { PersistentNotificationQueue } = await import(
      "../../../src/notifications/persistent-queue.js"
    );
    const queue = new PersistentNotificationQueue(notifDir);

    // Mock executor that writes deliverable.md to run_dir
    (mockExecutor.run as any).mockImplementation(
      async (_auto: any, job: any): Promise<ExecutionResult> => {
        // Simulate worker writing deliverable.md
        if (job.run_dir) {
          const { mkdirSync, writeFileSync } = await import("fs");
          mkdirSync(job.run_dir, { recursive: true });
          writeFileSync(
            join(job.run_dir, "deliverable.md"),
            "## VPN Research\n\nNordVPN is the best option for Thailand. It has 10 servers in Bangkok.",
          );
        }
        jobService.updateJob(job.id, {
          status: "completed",
          completed: new Date().toISOString(),
          summary: "done",
        });
        return {
          success: true,
          work: "Let me search for VPNs... I found several options... Reading reviews... " + "x".repeat(20000),
          deliverable: null,
        };
      },
    );

    const processorWithQueue = new AutomationProcessor({
      automationManager: manager,
      executor: mockExecutor,
      jobService,
      agentDir: tempDir,
      onJobEvent,
      notificationQueue: queue,
    });

    await processorWithQueue.fire(automation);

    const pending = queue.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].summary).toContain("VPN Research");
    expect(pending[0].summary).toContain("NordVPN");
    // Must NOT contain raw stream
    expect(pending[0].summary).not.toContain("Let me search");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/automation-processor.test.ts
```

Expected: FAIL — summary still contains truncated `result.work`.

- [ ] **Step 3: Wire summary resolver into `handleNotification()`**

In `packages/dashboard/src/automations/automation-processor.ts`, add import at top:

```typescript
import { resolveJobSummary } from "./summary-resolver.js";
```

Replace lines 222-227 (the summary construction):

```typescript
    const summary =
      type === "job_needs_review"
        ? (job.summary ?? "A job requires your review.")
        : type === "job_failed"
          ? `Failed: ${result.error ?? "unknown error"}`
          : resolveJobSummary(job.run_dir, result.work ?? "Completed successfully.");
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/automation-processor.test.ts
```

Expected: All tests PASS (including the new one and existing ones).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/automations/automation-processor.ts packages/dashboard/tests/unit/automations/automation-processor.test.ts
git commit -m "fix(s4): notification path reads deliverables from disk, removes .slice(0, 500)"
```

---

## Task 3: Wire Summary Resolver into DB Summary Path

Replace `.slice(0, 500)` in `automation-executor.ts` (3 sites) with the summary resolver. The DB summary is used for dashboard job cards and as a fallback input for the debrief-reporter.

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts:148, 457, 632`

- [ ] **Step 1: Add import**

In `packages/dashboard/src/automations/automation-executor.ts`, add import:

```typescript
import { resolveJobSummary } from "./summary-resolver.js";
```

- [ ] **Step 2: Replace handler path truncation (line 148)**

Replace:
```typescript
          summary: (result.deliverable ?? result.work).slice(0, 500),
```

With:
```typescript
          summary: resolveJobSummary(job.run_dir, result.deliverable ?? result.work),
```

- [ ] **Step 3: Replace SDK execution path truncation (line 457)**

Replace:
```typescript
        summary: todoGatingSummary ?? (deliverable ?? work).slice(0, 500),
```

With:
```typescript
        summary: todoGatingSummary ?? resolveJobSummary(job.run_dir, deliverable ?? work),
```

- [ ] **Step 4: Replace resume path truncation (line 632)**

Replace:
```typescript
          const summary = (deliverable ?? work).slice(0, 500);
```

With:
```typescript
          const summary = resolveJobSummary(job.run_dir, deliverable ?? work);
```

- [ ] **Step 5: Run existing tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/ tests/integration/e2e-agentic-flow.test.ts tests/integration/todo-lifecycle-acceptance.test.ts
```

Expected: All PASS — the resolver returns the same content for short `result.work` values (which is what the mocks produce).

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/automations/automation-executor.ts
git commit -m "fix(s4): DB job summary uses artifact resolver instead of .slice(0, 500)"
```

---

## Task 4: Add Mandatory Deliverable Todo to Templates

Workers should write a deliverable as part of their work. Add the todo item and a validator to enforce it.

**Files:**
- Modify: `packages/dashboard/src/automations/todo-templates.ts`
- Modify: `packages/dashboard/src/automations/todo-validators.ts`
- Create: `packages/dashboard/tests/unit/automations/deliverable-validator.test.ts`

- [ ] **Step 1: Write the failing validator test**

Create `packages/dashboard/tests/unit/automations/deliverable-validator.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runValidation } from "../../../src/automations/todo-validators.js";

describe("deliverable_written validator", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "deliv-validator-"));
  });

  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("passes when deliverable.md exists with substantive content", () => {
    fs.writeFileSync(
      path.join(runDir, "deliverable.md"),
      "## Results\n\nFound 3 options. NordVPN is the best for Thailand because of server coverage.",
    );
    const result = runValidation("deliverable_written", runDir);
    expect(result.pass).toBe(true);
  });

  it("fails when deliverable.md does not exist", () => {
    const result = runValidation("deliverable_written", runDir);
    expect(result.pass).toBe(false);
    expect(result.message).toContain("deliverable.md");
  });

  it("fails when deliverable.md is too short", () => {
    fs.writeFileSync(path.join(runDir, "deliverable.md"), "Done.");
    const result = runValidation("deliverable_written", runDir);
    expect(result.pass).toBe(false);
    expect(result.message).toContain("too short");
  });

  it("fails when deliverable.md is frontmatter-only", () => {
    fs.writeFileSync(
      path.join(runDir, "deliverable.md"),
      "---\nchange_type: fix\n---\n",
    );
    const result = runValidation("deliverable_written", runDir);
    expect(result.pass).toBe(false);
    expect(result.message).toContain("body content");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/deliverable-validator.test.ts
```

Expected: FAIL — `deliverable_written` validator returns `{ pass: true }` (unknown rule passthrough).

- [ ] **Step 3: Add the validator**

In `packages/dashboard/src/automations/todo-validators.ts`, add inside the `VALIDATORS` record (after the `status_report` entry):

```typescript
  deliverable_written: (runDir) => {
    const delPath = path.join(runDir, "deliverable.md");
    if (!fs.existsSync(delPath)) {
      return {
        pass: false,
        message:
          "deliverable.md not found. Write a summary of your work: key findings, outcomes, and any recommendations.",
      };
    }
    const raw = fs.readFileSync(delPath, "utf-8").trim();
    if (raw.length < 80) {
      return {
        pass: false,
        message:
          "deliverable.md is too short (< 80 chars). Include a substantive summary of your work — not just 'done' or a title.",
      };
    }
    // Check for frontmatter-only files
    const { content } = readFrontmatter<Record<string, unknown>>(delPath);
    if (content.trim().length < 50) {
      return {
        pass: false,
        message:
          "deliverable.md has no body content after frontmatter. Write a summary below the frontmatter.",
      };
    }
    return { pass: true };
  },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/deliverable-validator.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Add deliverable todo to `generic` and `research` templates**

In `packages/dashboard/src/automations/todo-templates.ts`, update the `generic` template:

```typescript
  generic: {
    items: [
      {
        text: "Verify output matches the requested format and content — re-read your deliverable before marking done",
        mandatory: true,
      },
      {
        text: "Write deliverable.md summarizing your work: what you did, key findings or outcomes, and any recommendations. This is what gets presented to the user — write it for them, not for yourself",
        mandatory: true,
        validation: "deliverable_written",
      },
      {
        text: "Write status-report.md with: what you did, what you found, artifacts created, any issues",
        mandatory: true,
        validation: "status_report",
      },
    ],
  },
```

Update the `research` template — replace the existing `status_report` item and add deliverable:

```typescript
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
        text: "Does your output contain numeric data, comparisons, or trends? If you have the create_chart tool, call it with an SVG and embed the result inline in your deliverable. If no numeric data or no chart tool available, mark done with a note explaining why",
        mandatory: true,
      },
      {
        text: "Write deliverable.md summarizing your research: key findings, source quality assessment, actionable recommendations. This is what gets presented to the user — write it for them, not for yourself",
        mandatory: true,
        validation: "deliverable_written",
      },
      {
        text: "Write status-report.md with: findings summary, sources list, confidence assessment, any gaps",
        mandatory: true,
        validation: "status_report",
      },
    ],
  },
```

- [ ] **Step 6: Run all todo-related tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/deliverable-validator.test.ts tests/integration/todo-lifecycle-acceptance.test.ts
```

Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/automations/todo-templates.ts packages/dashboard/src/automations/todo-validators.ts packages/dashboard/tests/unit/automations/deliverable-validator.test.ts
git commit -m "feat(s4): mandatory deliverable todo with validator for generic and research jobs"
```

---

## Task 5: Haiku Fallback in Summary Resolver

When no artifacts exist and `result.work` is too long, summarize with Haiku instead of hard-truncating. This is the safety net — should rarely fire.

**Files:**
- Modify: `packages/dashboard/src/automations/summary-resolver.ts`
- Modify: `packages/dashboard/tests/unit/automations/notification-summary.test.ts`

- [ ] **Step 1: Add async `resolveJobSummaryAsync` alongside the sync version**

The sync `resolveJobSummary` is used in the DB path (executor) and must stay sync. Add an async variant for the notification path that can call Haiku.

In `packages/dashboard/src/automations/summary-resolver.ts`, add:

```typescript
import { queryModel } from "../scheduler/query-model.js";

const SUMMARIZE_PROMPT = `You are summarizing a background task's output for the user. Write a concise summary (under 1500 chars) of what was done and what was found. Output ONLY the summary — no preamble, no explanation.`;

/**
 * Async variant that can call Haiku as a last resort when result.work
 * is too long and no disk artifacts exist.
 *
 * Use this in the notification path where async is acceptable.
 * The sync resolveJobSummary is still used for DB writes.
 */
export async function resolveJobSummaryAsync(
  runDir: string | null | undefined,
  fallbackWork: string,
): Promise<string> {
  // Layers 1 and 2 are identical to sync version
  const diskResult = resolveJobSummary(runDir, "");
  if (diskResult.length > 0) return diskResult;

  // Layer 3: short stream — use as-is
  if (fallbackWork.length <= MAX_FALLBACK_CHARS) {
    return fallbackWork || "Completed successfully.";
  }

  // Layer 4: long stream, no artifacts — Haiku summarize
  try {
    return await queryModel(
      `Summarize this task output:\n\n${fallbackWork.slice(0, 8000)}`,
      SUMMARIZE_PROMPT,
      "haiku",
    );
  } catch {
    // Haiku failed — fall back to truncation with notice
    return fallbackWork.slice(0, MAX_FALLBACK_CHARS) +
      "\n\n[Output truncated — full results in job workspace]";
  }
}
```

Update `resolveJobSummary` to handle the empty-string sentinel. Replace the Layer 3 block:

```typescript
  // Layer 3: raw result.work with size guard
  if (!fallbackWork) return "";
  if (fallbackWork.length <= MAX_FALLBACK_CHARS) {
    return fallbackWork;
  }
  return fallbackWork.slice(0, MAX_FALLBACK_CHARS) +
    "\n\n[Output truncated — full results in job workspace]";
```

- [ ] **Step 2: Write test for async Haiku path**

Append to `notification-summary.test.ts`:

```typescript
import { resolveJobSummaryAsync } from "../../../src/automations/summary-resolver.js";

// Mock queryModel to avoid real API calls
vi.mock("../../../src/scheduler/query-model.js", () => ({
  queryModel: vi.fn(async () => "Haiku summary: researched VPNs, found NordVPN best for Thailand."),
}));

describe("resolveJobSummaryAsync", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "summary-async-"));
  });

  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("returns deliverable.md when it exists (no Haiku call)", async () => {
    fs.writeFileSync(
      path.join(runDir, "deliverable.md"),
      "## Results\n\nNordVPN is best.",
    );

    const result = await resolveJobSummaryAsync(runDir, "x".repeat(10000));
    expect(result).toBe("## Results\n\nNordVPN is best.");
  });

  it("calls Haiku when no artifacts and long stream", async () => {
    const { queryModel } = await import("../../../src/scheduler/query-model.js");
    const result = await resolveJobSummaryAsync(runDir, "x".repeat(10000));
    expect(queryModel).toHaveBeenCalled();
    expect(result).toContain("Haiku summary");
  });

  it("uses raw stream when short (no Haiku call)", async () => {
    const { queryModel } = await import("../../../src/scheduler/query-model.js");
    vi.mocked(queryModel).mockClear();

    const result = await resolveJobSummaryAsync(runDir, "Short direct answer.");
    expect(queryModel).not.toHaveBeenCalled();
    expect(result).toBe("Short direct answer.");
  });
});
```

Add `vi` import at top of file if not present:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
```

- [ ] **Step 3: Run tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/notification-summary.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Wire async resolver into notification path**

In `packages/dashboard/src/automations/automation-processor.ts`, update the import:

```typescript
import { resolveJobSummaryAsync } from "./summary-resolver.js";
```

Update `handleNotification()` — make it use the async variant. Replace the summary line:

```typescript
    const summary =
      type === "job_needs_review"
        ? (job.summary ?? "A job requires your review.")
        : type === "job_failed"
          ? `Failed: ${result.error ?? "unknown error"}`
          : await resolveJobSummaryAsync(job.run_dir, result.work ?? "Completed successfully.");
```

Note: `handleNotification` is already `async`, so this requires no signature change.

- [ ] **Step 5: Run full processor tests**

```bash
cd packages/dashboard && npx vitest run tests/unit/automations/automation-processor.test.ts
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/automations/summary-resolver.ts packages/dashboard/src/automations/automation-processor.ts packages/dashboard/tests/unit/automations/notification-summary.test.ts
git commit -m "feat(s4): Haiku fallback summarization when no worker artifacts exist"
```

---

## Task 6: Fix `formatNotification()` Framing

The heartbeat wraps every notification in "A working agent completed a task" + "present naturally" — causing the brain to paraphrase already-good content. Replace with verbatim-forward instructions.

**Files:**
- Modify: `packages/dashboard/src/automations/heartbeat-service.ts:162-178`
- Modify: `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts` (find the existing test file and add a new test case):

```typescript
  it("formatNotification uses verbatim framing for job_completed", () => {
    // Access private method via prototype for testing
    const service = new HeartbeatService({
      jobService: mockJobService as any,
      notificationQueue: queue,
      conversationInitiator: { alert: vi.fn(async () => true), initiate: vi.fn() },
      jobsDir: tmpDir,
      runDirBase: tmpDir,
    });

    const notification = {
      job_id: "j1",
      automation_id: "a1",
      type: "job_completed" as const,
      summary: "[Debrief Reporter] ## Morning Brief\n\nAQI is 42, good air today.",
      created: new Date().toISOString(),
      delivery_attempts: 0,
    };

    // Use bracket notation to access private method
    const formatted = (service as any).formatNotification(notification);
    expect(formatted).toContain("## Morning Brief");
    expect(formatted).toContain("AQI is 42");
    // Must NOT contain the old generic framing
    expect(formatted).not.toContain("A working agent completed a task");
    // Must contain verbatim instruction
    expect(formatted).toContain("verbatim");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts
```

Expected: FAIL — still contains "A working agent completed a task".

- [ ] **Step 3: Update `formatNotification()`**

In `packages/dashboard/src/automations/heartbeat-service.ts`, replace the `formatNotification` method (lines 162-178):

```typescript
  private formatNotification(n: PersistentNotification): string {
    const verbatimFraming =
      "Forward these results to the user verbatim. Adjust tone for conversation but do not summarize, paraphrase, or editorialize the content. Don't acknowledge the system message itself.";
    const naturalFraming =
      "You are the conversation layer — present what matters to the user naturally. Don't acknowledge the system message itself.";

    switch (n.type) {
      case "job_completed":
        return `Background work results:\n\n${n.summary}\n\n${verbatimFraming}`;
      case "job_failed":
        return `A background task failed.\n\nError: ${n.summary}\n\n${naturalFraming} If the error seems transient, suggest re-triggering.`;
      case "job_interrupted":
        return `A background task was interrupted (stale — no activity for 5+ minutes).\n\nProgress: ${n.todos_completed ?? 0}/${n.todos_total ?? 0} items done.\nIncomplete: ${n.incomplete_items?.join(", ") || "unknown"}\nResumable: ${n.resumable ? "yes" : "no"}\n\n${naturalFraming}`;
      case "job_needs_review":
        return `A background task needs your review.\n\n${n.summary}\n\n${naturalFraming}`;
      default:
        return `[Notification] ${n.summary}\n\n${naturalFraming}`;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts
git commit -m "fix(s4): formatNotification uses verbatim framing for job completions"
```

---

## Task 7: Fix Pending Briefing Framing

The system prompt builder's `[Pending Briefing]` section also has "present naturally" framing. Update to match the verbatim approach.

**Files:**
- Modify: `packages/dashboard/src/agent/system-prompt-builder.ts:139-145`

- [ ] **Step 1: Update the pending briefing framing**

In `packages/dashboard/src/agent/system-prompt-builder.ts`, replace lines 139-145:

```typescript
    // Pending briefing: events that occurred since last interaction (restart, job completions)
    const briefing = context.pendingBriefing ?? [];
    if (briefing.length > 0) {
      dynamicParts.push(
        `[Pending Briefing]\nThe following background work completed since your last interaction:\n${briefing.map((b) => `- ${b}`).join("\n")}\n\nForward these results to the user verbatim. Adjust tone for conversation but do not summarize or paraphrase the content. For interrupted jobs, ask whether to resume or discard.\n[End Pending Briefing]`,
      );
    }
```

- [ ] **Step 2: Run existing tests**

```bash
cd packages/dashboard && npx vitest run tests/integration/notification-delivery.test.ts tests/integration/e2e-agentic-flow.test.ts
```

Expected: All PASS — tests check delivery behavior, not exact framing text.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/agent/system-prompt-builder.ts
git commit -m "fix(s4): pending briefing framing uses verbatim instruction, not re-summarize"
```

---

## Task 8: Debrief Reporter Becomes Assembler

Remove the Haiku re-digest step. The reporter collects already-summarized worker deliverables and assembles them into an ordered document. Zero-worker case skips the debrief entirely.

**Files:**
- Modify: `packages/dashboard/src/scheduler/jobs/handler-registry.ts:279-399`

- [ ] **Step 1: Replace the reporter handler**

In `packages/dashboard/src/scheduler/jobs/handler-registry.ts`, replace the `REPORTER_SYSTEM_PROMPT`, `REPORTER_USER_TEMPLATE`, and the `debrief-reporter` handler registration (lines 279-399) with:

```typescript
// ─── Handler: debrief-reporter ───────────────────────────────────────────
// Assembles the debrief by:
// 1. Running debrief-context to refresh current-state.md
// 2. Collecting completed worker deliverables (notify=debrief jobs)
// 3. Ordering by relevance (actionable items first)
// 4. Writing assembled digest to disk — NO Haiku re-summarization
// M9.4-S4: Reporter is an assembler, not a summarizer.

registerHandler("debrief-reporter", async ({ agentDir, db }) => {
  const notebookDir = join(agentDir, "notebook");

  // Step 1: Run debrief-context to refresh current-state.md
  const contextHandler = getHandler("debrief-context");
  if (contextHandler) {
    await contextHandler({ agentDir, jobId: `context-${Date.now()}` });
  }

  // Step 2: Read the refreshed current-state.md (notebook context)
  const currentStatePath = join(notebookDir, "operations", "current-state.md");
  let notebookContext = "";
  if (existsSync(currentStatePath)) {
    notebookContext = await readFile(currentStatePath, "utf-8");
  }

  // Step 3: Collect worker results since last debrief reporter run
  const workerSections: string[] = [];
  const fullReports: Array<{ name: string; content: string }> = [];
  if (db) {
    const since = new Date(Date.now() - 86400000).toISOString();

    console.log(`[debrief-reporter] Collecting worker results since: ${since}`);
    const pendingJobs = db.getDebriefPendingJobs(since);
    console.log(
      `[debrief-reporter] Found ${pendingJobs.length} worker reports`,
    );

    for (const job of pendingJobs) {
      const prefix = job.needsReview ? "\u26a0\ufe0f INCOMPLETE \u2014 " : "";
      let content = job.summary ?? "No output available.";

      // Prefer full deliverable → status-report.md → summary
      if (job.deliverablePath && existsSync(job.deliverablePath)) {
        try {
          content = await readFile(job.deliverablePath, "utf-8");
        } catch {
          // Fall through to status-report.md
        }
      }
      if (content === (job.summary ?? "No output available.") && job.runDir) {
        const reportPath = join(job.runDir, "status-report.md");
        if (existsSync(reportPath)) {
          try {
            content = await readFile(reportPath, "utf-8");
          } catch {
            // Fall back to summary
          }
        }
      }

      workerSections.push(`## ${prefix}${job.automationName}\n\n${content}`);
      fullReports.push({ name: `${prefix}${job.automationName}`, content });
    }
  }

  // Step 4: No workers completed — skip the debrief
  if (workerSections.length === 0) {
    const msg = "No background work to report since the last debrief.";
    await appendToDailyLog(notebookDir, `- Debrief reporter: no workers to report`);
    return { success: true, work: msg, deliverable: msg };
  }

  // Step 5: Write full reports to disk (for follow-up queries via MCP tool)
  const opsDir = join(notebookDir, "operations");
  if (!existsSync(opsDir)) {
    await mkdir(opsDir, { recursive: true });
  }

  const fullBrief = [
    notebookContext,
    "---\n\n# Worker Reports\n\n" + workerSections.join("\n\n---\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  await writeFile(join(opsDir, "debrief-full.md"), fullBrief, "utf-8");

  // Step 6: Assemble digest — worker deliverables ordered, not re-summarized
  const digest = workerSections.join("\n\n---\n\n") +
    "\n\n---\n*Ask me for details on any of these.*";

  // Write the digest (this is what gets delivered)
  await writeFile(join(opsDir, "debrief-digest.md"), digest, "utf-8");

  await appendToDailyLog(
    notebookDir,
    `- Debrief reporter: assembled ${workerSections.length} worker reports (${digest.length} chars), no re-digest`,
  );

  return { success: true, work: digest, deliverable: digest };
});
```

- [ ] **Step 2: Run existing tests**

```bash
cd packages/dashboard && npx vitest run src/automations/__tests__/heartbeat-service.test.ts tests/integration/e2e-agentic-flow.test.ts
```

Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/scheduler/jobs/handler-registry.ts
git commit -m "refactor(s4): debrief-reporter assembles worker deliverables, no Haiku re-digest"
```

---

## Task 9: Verification

End-to-end verification that the pipeline works. Manual trigger of a debrief cycle and verification of each layer.

**Files:**
- No new files — manual verification steps

- [ ] **Step 1: Run full test suite**

```bash
cd packages/dashboard && npx vitest run
```

Expected: All tests PASS. Zero regressions.

- [ ] **Step 2: Type check**

```bash
cd packages/core && npx tsc --noEmit && cd ../dashboard && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Verify the bug doc scenario**

Review the fix against the original bug doc (`docs/bugs/2026-04-08-brief-delivery-broken.md`):

1. Issue 1 (500-char truncation): **Fixed** — replaced with `resolveJobSummary` / `resolveJobSummaryAsync` in all 4 sites
2. Issue 2 (generic mediator framing): **Fixed** — `formatNotification()` uses verbatim framing for `job_completed`
3. Issue 3 (conversation contamination): **Fixed** — verbatim framing prevents brain from blending topics

- [ ] **Step 4: Update bug doc status**

Add to `docs/bugs/2026-04-08-brief-delivery-broken.md` frontmatter:

```yaml
status: fixed
fixed_in: M9.4-S4
```

- [ ] **Step 5: Commit**

```bash
git add docs/bugs/2026-04-08-brief-delivery-broken.md
git commit -m "docs(s4): mark brief delivery bug as fixed in M9.4-S4"
```
