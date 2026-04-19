# M9.6-S17 Reflect-Phase Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead reflect phase from the CFR recovery orchestrator, fix the orchestrator's 3-attempt iteration bug (which makes every single-attempt fix run at 3× cost), and pre-populate smoke output in fix-mode prompts to save ~60–90 s per attempt.

**Architecture:** Six commits in strict order: (0) investigation findings, (1) Item B status fix (adapter or source per Step 1.4a), (2) state-machine + cfr-types cleanup, (3) orchestrator behavior + Item A smoke output + FU-1/FU-2, (4) fix-automation.md deletion, (5) sprint artifacts (DECISIONS / DEVIATIONS / FOLLOW-UPS / test-report) per §0.3. The reflect-collapse is purely mechanical; the iteration fix is behavioral and tested independently.

**Tech Stack:** TypeScript, Vitest, Node.js. Core package: `packages/core/`. Dashboard package: `packages/dashboard/src/app.ts`.

---

## §0.3 Compliance Rules (READ BEFORE STARTING)

These rules are non-negotiable. Violations caused a rejected review in S16.

- **Do NOT merge to master.** All work stays on `sprint/m9.6-s17-reflect-collapse` until the architect approves.
- **Do NOT update `docs/ROADMAP.md`.** The architect authors the ROADMAP-Done commit as the *last* commit after approval.
- **Do NOT write "APPROVED" or "all tasks complete" in any commit message.** The dev does not hold the role that decides "complete."
- **File `proposals/s17-<slug>.md` for any deviation** before changing course.

---

## ARCHITECT REVIEW (2026-04-19) — required corrections before start

Phase 3 architect (Opus 4.7) reviewed v0 of this plan. The §0.3 compliance section, TDD structure, investigation diagnosis, and reflect-collapse mechanics are all strong. One required correction (R1) blocks start; five suggestions (S1–S5) improve quality. Inline edits below are marked `[ARCHITECT R#]` or `[ARCHITECT S#]`.

| Tag | What was missing / weak | Where it landed |
|-----|------------------------|-----------------|
| **R1** | Sprint artifacts task missing per §0.3 — `s17-DECISIONS.md`, `s17-DEVIATIONS.md`, `s17-FOLLOW-UPS.md`, `s17-test-report.md` not authored. Same gap S16 originally had. Without these, re-trips the §0.3 violation pattern. | New Task 8 (sprint artifacts) — replaces Task 7.7 notify step |
| **S1** | `failure.detail` is being wired straight into `smokeOutput`, but `cfr-types.ts` defines `detail?` as "human-readable tail from the origin error" — not specifically smoke stderr. If the invoker doesn't populate `detail` from smoke output, M1 silently produces empty `## Smoke Output` sections and the projected 60-90s improvement doesn't materialize. | Task 5 Step 5.4a — verify before implementing |
| **S2** | `normaliseJobStatus` test is a parallel implementation of inline closure logic. If the dev forgets to update both, test passes while production breaks. | Task 2 — extract function OR add integration test asserting orchestrator stops at 1 attempt |
| **S3** | Step 5.7 test bodies are stubs (`// ... stub runOneAttempt`). Less-disciplined dev may leave them as stubs. | Task 5 Step 5.7 — replace with real test code matching `fix-mode-escalate.test.ts` pattern |
| **S4** | Step 5.1 offers two replacement versions (with/without `nextAction` call). Pick one. | Task 5 Step 5.1 — omit `nextAction`, cleaner |
| **S5** | Source-vs-adapter tradeoff for Item B not justified. Adapter fix is the dev's pick; source fix may be cleaner if `automation-executor`'s `"completed"` is only consumed by `awaitAutomation`. | Task 1 Step 1.4a — verify other consumers before adapter-fix; document choice in DECISIONS |

### Sprint-time verification items (grep before relying on)

- **Confirm line numbers at sprint-start.** Plan references `recovery-orchestrator.ts:~437–504` for the reflect block, `~452` for `session.state = "REFLECTING"`, `~772` for `renderReflectPrompt`. These may have drifted since plan-writing. `grep -n "REFLECTING\|reflectJobId\|renderReflect" packages/core/src/capabilities/recovery-orchestrator.ts` first, then edit.
- **`attemptStartedAt` and `executeJobId` scope** in FU-1's synthetic attempt — they should be in scope at the ESCALATE check point (after `readDeliverable(executeJobId)`), but verify.
- **Historical implication.** Item B's bug has likely existed since Phase 1 — every CFR fix-mode run has been iterating 3 times. Note this in DECISIONS: "Item B bug pre-dates S16 but was unobserved until S16 wall-time measurement surfaced it. Phase 1 S7 STT exit gate (142s) is roughly consistent with 3 iterations of ~50s each."
- **Five-commit count.** The header mentions "Four commits"; with the new Task 8 sprint-artifacts commit, the actual count is 6: investigation + status-fix + 3 reflect-collapse commits + artifacts. Update the count in the header at sprint-end.

---

## Background

S16 swapped the fix engine to `capability-brainstorming` fix-mode (Opus, one-shot). This made the existing reflect phase dead code — it still runs but it's the same model doing redundant work. S17 removes it. Two items are inherited from the S16 wall-time measurement:

**Item A (M1 mitigation):** The current `buildFixModeInvocation` carries `symptom` and `detail` from the failure record, but not the actual `smoke.sh` stderr output. Opus spends ~60–90 s per attempt re-running diagnostics that CFR already captured. Adding the smoke output to the prompt eliminates that redundant run.

**Item B (HIGH PRIORITY — investigate first):** S16's wall-time runs showed Opus landing a correct, smoke-passing fix at attempt 1, but the orchestrator iterating to attempts 2 and 3. The architect suspects `executeResult.status === "failed"` from `awaitAutomation` even when the deliverable says `test_result: pass`. Investigate this root cause before touching the reflect-collapse code — if the investigation changes the iterate/reverify path, the state-machine rewrite needs to account for it.

**FU-1:** When `runOneAttempt` hits an ESCALATE marker and returns early, `session.attempts` stays `[]`. The terminal drain writes a CFR_RECOVERY.md with no attempt history. Add a synthetic `FixAttempt` record so ESCALATE surrenders have a paper trail.

**FU-2:** If `deliverable.body` starts with `ESCALATE: gibberish`, the orchestrator sets no `surrenderReason`, falls back to plain `"surrender"` ack, and logs nothing. Add a `console.warn`.

---

## File Map

| File | Change |
|---|---|
| `packages/dashboard/src/app.ts` | Fix `awaitAutomation`: add `"completed"` to `KNOWN_TERMINAL`, map it to `"done"` in return |
| `packages/core/src/capabilities/orchestrator-state-machine.ts` | Remove `"REFLECTING"`, `REFLECT_JOB_DONE`, `SPAWN_REFLECT_JOB`, `reflectJobId`, change `MAX_JOBS` 5→4, change success edge to `REVERIFY` |
| `packages/core/src/capabilities/cfr-types.ts` | Narrow `FixAttempt.phase` to `"execute"` only |
| `packages/core/src/capabilities/recovery-orchestrator.ts` | Delete reflect spawn/await block + `renderReflectPrompt`; add `AutomationSpec.smokeOutput?`; extend `buildFixModeInvocation`; fix FU-1 (ESCALATE paper trail) + FU-2 (warn) |
| `packages/core/src/capabilities/prompts/fix-automation.md` | **Delete file** |
| `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts` | Update 3 test cases (remove reflect cases, fix success→REVERIFY) |
| `packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts` | Rewrite budget test: 1 job/attempt, ceiling 4 |
| `packages/dashboard/tests/...` or `packages/core/tests/...` | New test for `awaitAutomation` status mapping |
| `proposals/s17-orchestrator-iteration-investigation.md` | Investigation findings (own commit) |
| `docs/sprints/m9.6-capability-resilience/s17-DECISIONS.md` | **[ARCHITECT R1]** Sprint decisions log — Task 8 |
| `docs/sprints/m9.6-capability-resilience/s17-DEVIATIONS.md` | **[ARCHITECT R1]** Index of any `proposals/s17-*.md` filed — Task 8 |
| `docs/sprints/m9.6-capability-resilience/s17-FOLLOW-UPS.md` | **[ARCHITECT R1]** Out-of-scope items noticed; per §0.1 name any uncovered plug type — Task 8 |
| `docs/sprints/m9.6-capability-resilience/s17-test-report.md` | **[ARCHITECT R1]** Verification command output — Task 8 |

---

## Task 0: Branch setup

- [ ] **Step 0.1: Create sprint branch**

```bash
cd /home/nina/my_agent
git checkout master
git pull
git checkout -b sprint/m9.6-s17-reflect-collapse
```

- [ ] **Step 0.2: Confirm S16 is on master and tests pass**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -5
cd packages/core && npx vitest run tests/capabilities/fix-mode-invocation tests/capabilities/fix-mode-escalate 2>&1 | tail -5
```

Expected: zero tsc errors, tests pass. If they don't, stop and file a proposal — something regressed.

---

## Task 1: Investigate Item B (orchestrator iteration bug)

**Goal:** Determine why `awaitAutomation` returns `{status: "failed"}` for successful fix-mode jobs. Write findings. Commit. The fix lands in Task 2.

- [ ] **Step 1.1: Trace `awaitAutomation` in `app.ts`**

Read the closure at `packages/dashboard/src/app.ts` around line 695. Key question: what values are in `KNOWN_TERMINAL`, and what job status does a successful automation job get?

```bash
grep -n "KNOWN_TERMINAL\|awaitAutomation\|finalStatus\|completed" packages/dashboard/src/app.ts | head -20
```

Expected finding: `KNOWN_TERMINAL = new Set(["done", "failed", "needs_review", "interrupted", "cancelled"])` — note `"completed"` is NOT present.

- [ ] **Step 1.2: Trace what job status automation-executor sets on success**

```bash
grep -n "finalStatus\|status.*completed\|updateJob.*status" packages/dashboard/src/automations/automation-executor.ts | head -20
```

Expected finding: `finalStatus = hasNeedsReview ? "needs_review" : "completed"` (line ~671), set via `this.config.jobService.updateJob(job.id, { status: finalStatus })`.

- [ ] **Step 1.3: Confirm the status-name mismatch**

The executor sets `job.status = "completed"`. The `awaitAutomation` loop checks `KNOWN_TERMINAL.has(job.status)`. Since `"completed"` ∉ KNOWN_TERMINAL, it falls to the `else` branch: logs a warning and returns `{status: "failed"}`. This means **every successful fix-mode run returns `{status: "failed"}` to the orchestrator**, causing `executeSuccess = false`, causing spurious iterations 2 and 3.

Confirm the warning log is in app.ts:

```bash
grep -n "Unknown terminal status" packages/dashboard/src/app.ts
```

- [ ] **Step 1.4: Check if stale-watcher is a secondary concern**

`doReverify` calls `dispatchReverify`, which starts with `watcher.rescanNow()`. Confirm:

```bash
grep -n "rescanNow" packages/core/src/capabilities/reverify.ts
```

Expected: line 334 `await watcher.rescanNow()`. This means reverify always rescans before reading capability state — stale watcher is NOT an independent bug. The sole root cause is the status mismatch.

- [ ] **Step 1.4a [ARCHITECT S5]: Source-vs-adapter — find other consumers of `"completed"`**

Before committing to the adapter fix (normalize at `awaitAutomation`), check whether the source fix (change `automation-executor.ts:671` to set `finalStatus = "done"`) is cleaner. The cleaner choice depends on how many other consumers depend on `job.status === "completed"`:

```bash
rg "status === ['\"]completed['\"]\|status:.*['\"]completed['\"]" packages/ --type ts | head -20
rg "\.status\s*===\s*['\"]completed['\"]\|finalStatus.*completed" packages/ --type ts | head -20
```

**Decision rule:**
- If `awaitAutomation` is the ONLY consumer of `job.status === "completed"` → **source fix preferred**: change `automation-executor.ts:671` and `:979` to `"done"` instead. One-line change × 2 sites. No `KNOWN_TERMINAL` or normalization logic needed in `app.ts`. Cleaner type alignment with `AutomationResult`.
- If multiple consumers depend on `"completed"` (dashboard UI, job listings, etc.) → **adapter fix is correct** (the dev's original choice). Normalize at `awaitAutomation`.

Document the choice in `s17-DECISIONS.md` D1 with the grep evidence. Both fixes work; the choice is about code locality vs source-truth alignment.

If source fix is chosen, Task 2 below changes accordingly (no `KNOWN_TERMINAL` edit needed; just `automation-executor.ts:671` and `:979` updated; tests assert the executor sets `"done"` not `"completed"`).

- [ ] **Step 1.5: Write investigation findings**

```bash
mkdir -p docs/sprints/m9.6-capability-resilience/proposals
```

Create `proposals/s17-orchestrator-iteration-investigation.md`:

```markdown
# S17 — Orchestrator Iteration Investigation

**Date:** 2026-04-19
**Finding:** Root cause confirmed — single issue, not compound.

## Root Cause

`automation-executor.ts` sets `job.status = "completed"` for successful SDK runs (line ~671). `awaitAutomation` in `app.ts` recognises `KNOWN_TERMINAL = {"done", "failed", "needs_review", "interrupted", "cancelled"}` — `"completed"` is absent. Result: the loop hits the unknown-status branch, logs a warning, and returns `{status: "failed"}`.

The orchestrator receives `executeResult.status === "failed"` for every successful fix-mode attempt. `executeSuccess = false`. The attempt is recorded as `verificationResult: "fail"`, `nextAction(session, {type: "EXECUTE_JOB_DONE", success: false})` is called, and the loop iterates. All three attempts run even when attempt 1 landed a correct fix.

## Secondary hypothesis ruled out

`dispatchReverify` calls `watcher.rescanNow()` at line 334 before reading capability state. Stale-watcher is NOT a contributing factor — reverify always gets current state.

## Fix scope

One change in `packages/dashboard/src/app.ts`:
1. Add `"completed"` to `KNOWN_TERMINAL`.
2. In the return mapping, normalise `"completed"` → `"done"` (the `AutomationResult` type only includes `"done"`, not `"completed"`).

This does not require touching `automation-executor.ts` or any orchestrator logic. The fix is purely in the `awaitAutomation` adapter closure.

## Expected impact

Per-attempt wall-time drops to single-attempt territory: ~122 s (TTS) and ~113 s (browser-chrome) instead of 480 s / 652 s accumulated over 3 spurious attempts. Both plugs were Branch B/C only because of this bug.
```

- [ ] **Step 1.6: Commit investigation**

```bash
git add proposals/s17-orchestrator-iteration-investigation.md
git commit -m "docs(m9.6-s17): orchestrator-iteration investigation — completed-status KNOWN_TERMINAL mismatch"
```

---

## Task 2: Fix Item B — `awaitAutomation` status mapping (or `automation-executor.ts` source)

**Files:** depends on Step 1.4a outcome:
- **Adapter fix (default):** `packages/dashboard/src/app.ts` (around line 657–718)
- **Source fix (if Step 1.4a confirms `awaitAutomation` is sole consumer):** `packages/dashboard/src/automations/automation-executor.ts:671` and `:979`

**[ARCHITECT S2] Test strategy** — `normaliseJobStatus` is currently inline closure logic, not an exported function. The default test (Steps 2.1–2.4) re-implements the mapping in the test file (parallel implementation). This catches mapping logic bugs but NOT regressions where the inline closure drifts from the test. **Strongly preferred:** add an integration test that exercises the actual closure path (Step 2.4a below). Keep the unit test as a smaller signal too.

- [ ] **Step 2.1: Write a failing test first**

Create `packages/dashboard/tests/capabilities/await-automation-status.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Test the status-normalisation contract in isolation.
// The real awaitAutomation is a closure; we extract the mapping logic here.

function normaliseJobStatus(
  raw: string,
): "done" | "failed" | "needs_review" | "interrupted" | "cancelled" | null {
  const KNOWN_TERMINAL = new Set([
    "done",
    "completed",
    "failed",
    "needs_review",
    "interrupted",
    "cancelled",
  ]);
  if (!KNOWN_TERMINAL.has(raw)) return null;
  if (raw === "completed") return "done";
  return raw as "done" | "failed" | "needs_review" | "interrupted" | "cancelled";
}

describe("normaliseJobStatus", () => {
  it("maps 'completed' to 'done'", () => {
    expect(normaliseJobStatus("completed")).toBe("done");
  });

  it("passes through 'done' unchanged", () => {
    expect(normaliseJobStatus("done")).toBe("done");
  });

  it("passes through 'failed' unchanged", () => {
    expect(normaliseJobStatus("failed")).toBe("failed");
  });

  it("passes through 'needs_review' unchanged", () => {
    expect(normaliseJobStatus("needs_review")).toBe("needs_review");
  });

  it("returns null for non-terminal statuses ('running', 'pending')", () => {
    expect(normaliseJobStatus("running")).toBeNull();
    expect(normaliseJobStatus("pending")).toBeNull();
  });

  it("returns null for unknown statuses rather than 'failed'", () => {
    expect(normaliseJobStatus("in_progress")).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run to confirm it fails (normaliseJobStatus doesn't exist yet)**

```bash
cd packages/dashboard && npx vitest run tests/capabilities/await-automation-status 2>&1 | tail -10
```

Expected: test file not importable / `normaliseJobStatus` not found error.

Note: this test validates the mapping logic in isolation. The integration fix is in app.ts below.

- [ ] **Step 2.3: Apply the fix to `app.ts`**

Locate the `KNOWN_TERMINAL` set and the `awaitAutomation` return in `packages/dashboard/src/app.ts`. The target section is around lines 657–718 (confirmed in pre-flight grep):

Find:
```typescript
      const KNOWN_TERMINAL = new Set([
        "done",
        "failed",
        "needs_review",
        "interrupted",
        "cancelled",
      ]);
```

Replace with:
```typescript
      const KNOWN_TERMINAL = new Set([
        "done",
        "completed", // automation-executor sets "completed" for success; normalised to "done" below
        "failed",
        "needs_review",
        "interrupted",
        "cancelled",
      ]);
```

Find (inside the loop, the terminal return):
```typescript
            if (job && KNOWN_TERMINAL.has(job.status)) {
              return {
                status: job.status as
                  | "done"
                  | "failed"
                  | "needs_review"
                  | "interrupted"
                  | "cancelled",
              };
            }
```

Replace with:
```typescript
            if (job && KNOWN_TERMINAL.has(job.status)) {
              // "completed" is how automation-executor marks success; AutomationResult uses "done"
              const normalisedStatus = job.status === "completed" ? "done" : job.status;
              return {
                status: normalisedStatus as
                  | "done"
                  | "failed"
                  | "needs_review"
                  | "interrupted"
                  | "cancelled",
              };
            }
```

- [ ] **Step 2.4: Move the normalisation test to match the actual logic**

Update `packages/dashboard/tests/capabilities/await-automation-status.test.ts` — replace the stub `normaliseJobStatus` with the real inline logic extracted from app.ts (since it's a closure, we verify the logic pattern):

```typescript
import { describe, it, expect } from "vitest";

// Mirrors the normalisation logic in app.ts awaitAutomation closure.
// KNOWN_TERMINAL determines when polling stops; the mapping determines what
// status the orchestrator sees.

const KNOWN_TERMINAL = new Set([
  "done",
  "completed",
  "failed",
  "needs_review",
  "interrupted",
  "cancelled",
]);

function normalise(
  raw: string,
): "done" | "failed" | "needs_review" | "interrupted" | "cancelled" | null {
  if (!KNOWN_TERMINAL.has(raw)) return null;
  if (raw === "completed") return "done";
  return raw as "done" | "failed" | "needs_review" | "interrupted" | "cancelled";
}

describe("awaitAutomation status normalisation", () => {
  it("maps 'completed' to 'done' — automation-executor success path", () => {
    expect(normalise("completed")).toBe("done");
  });

  it("passes 'done' through unchanged", () => {
    expect(normalise("done")).toBe("done");
  });

  it("passes 'failed' through unchanged", () => {
    expect(normalise("failed")).toBe("failed");
  });

  it("passes 'needs_review' through unchanged", () => {
    expect(normalise("needs_review")).toBe("needs_review");
  });

  it("returns null for non-terminal 'running' (polling continues)", () => {
    expect(normalise("running")).toBeNull();
  });

  it("returns null for non-terminal 'pending' (polling continues)", () => {
    expect(normalise("pending")).toBeNull();
  });
});
```

- [ ] **Step 2.4a [ARCHITECT S2]: Integration test asserting orchestrator stops at 1 attempt on `"completed"`**

The unit test above mirrors the mapping but doesn't test the actual closure. Add an integration test that proves the orchestrator iterates exactly once when the executor returns `"completed"`. This is the regression-proof gate.

Create `packages/dashboard/tests/integration/orchestrator-completed-status.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { RecoveryOrchestrator } from "@my-agent/core";
import type { OrchestratorDeps, AutomationSpec } from "@my-agent/core";
// ... import test helpers from existing fix-mode-invocation.test.ts pattern

describe("orchestrator + 'completed' job status — Item B regression", () => {
  it("stops at attempt 1 when executor returns 'completed' (post-fix)", async () => {
    let spawnCount = 0;

    // Build a real RecoveryOrchestrator with deps that mirror app.ts wiring:
    //   - spawnAutomation: counts and returns a fake jobId
    //   - awaitAutomation: replicates the real KNOWN_TERMINAL+normalize logic
    //     using the FIXED mapping (i.e., includes "completed", maps to "done")
    //   - jobService: returns {status: "completed"} for the spawned job
    const stubJobs = new Map<string, { status: string }>();

    const orch = new RecoveryOrchestrator({
      spawnAutomation: vi.fn().mockImplementation(async () => {
        spawnCount++;
        const jobId = `j-${spawnCount}`;
        stubJobs.set(jobId, { status: "completed" });
        return { jobId, automationId: `a-${spawnCount}` };
      }),
      awaitAutomation: async (jobId) => {
        // Inline-mirror the real awaitAutomation closure logic from app.ts:
        const KNOWN_TERMINAL = new Set([
          "done", "completed", "failed", "needs_review", "interrupted", "cancelled",
        ]);
        const job = stubJobs.get(jobId);
        if (job && KNOWN_TERMINAL.has(job.status)) {
          const normalised = job.status === "completed" ? "done" : job.status;
          return { status: normalised as "done" };
        }
        return { status: "failed" };
      },
      // ... rest of deps from existing test patterns (registry, watcher, emitAck, etc.)
    });

    await orch.handle(makeFailure());

    // Pre-fix: spawnCount === 3 (orchestrator iterated because awaitAutomation returned 'failed')
    // Post-fix: spawnCount === 1 (executeSuccess=true, doReverify runs, no iteration)
    expect(spawnCount).toBe(1);
  });
});
```

Adapt to the existing test helpers (look at `packages/core/tests/capabilities/fix-mode-invocation.test.ts`'s `makeDeps` / `makeFailure` patterns). The key assertion is `spawnCount === 1` — that's what was 3 pre-fix.

If Step 1.4a chose the source fix path instead, this test still applies — it just exercises the post-fix mapping (which is now: executor returns `"done"` directly, no normalization needed).

- [ ] **Step 2.5: Run tests**

```bash
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -5
cd packages/dashboard && npx vitest run tests/capabilities/await-automation-status tests/integration/orchestrator-completed-status 2>&1 | tail -10
```

Expected: zero tsc errors, 6/6 unit + 1/1 integration tests pass.

- [ ] **Step 2.6: Run full core + dashboard suites for regressions**

```bash
cd packages/core && npx vitest run 2>&1 | tail -5
cd packages/dashboard && npx vitest run 2>&1 | tail -5
```

Expected: same pass counts as pre-sprint (core ~629, dashboard ~1267; exact counts may vary).

- [ ] **Step 2.7: Commit**

```bash
git add packages/dashboard/src/app.ts packages/dashboard/tests/capabilities/await-automation-status.test.ts
git commit -m "fix(m9.6-s17): awaitAutomation maps 'completed'→'done' — orchestrator iteration bug

automation-executor sets job.status='completed' on success, but KNOWN_TERMINAL
only contained 'done'. Every successful fix-mode run returned {status:'failed'},
causing executeSuccess=false and spurious 2nd+3rd attempts. Per-attempt wall-time
was Branch A (~120s); accumulated wall-time was Branch B/C only because of this bug."
```

---

## Task 3: FU-1 and FU-2 (ESCALATE paper-trail + warn)

These are small additions to `recovery-orchestrator.ts`. They land alongside the orchestrator behavior cleanup in Task 5 (Commit 2), but write and verify them now while the context is fresh.

**FU-1:** When `runOneAttempt` hits an ESCALATE marker and returns `{recovered: false, escalate: true}`, `session.attempts` is empty. `terminalDrain` → `writeAutomationRecovery` produces a `CFR_RECOVERY.md` with no attempt history.

Fix: before returning from the ESCALATE branch, push a synthetic `FixAttempt`:

```typescript
// In runOneAttempt, after setting session.surrenderReason and before return:
const escalateAttempt: FixAttempt = {
  attempt: session.attemptNumber,
  startedAt: attemptStartedAt,
  endedAt: this.deps.now(),
  hypothesis: deliverable?.frontmatter.summary ?? "(ESCALATE — no hypothesis)",
  change: deliverable?.body.slice(0, 500) ?? "",
  verificationInputPath: failure.triggeringInput.artifact?.rawMediaPath ?? "",
  verificationResult: "fail",
  failureMode: `ESCALATE: ${session.surrenderReason ?? "unknown"}`,
  jobId: executeJobId,
  modelUsed: "opus",
  phase: "execute",
};
session.attempts.push(escalateAttempt);
return { recovered: false, escalate: true };
```

**FU-2:** If the deliverable body starts with `ESCALATE: gibberish`, the code sets no `surrenderReason` and the surrender uses plain `"surrender"` ack copy. Add a warn:

```typescript
// After the if/else if block checking "redesign-needed" / "insufficient-context":
} else {
  console.warn(
    `[RecoveryOrchestrator] Unrecognised ESCALATE reason in deliverable — defaulting to plain surrender. First line: ${firstLine}`,
  );
}
```

These changes go into the orchestrator file **in Task 5**, not now. Note them here for completeness; verify tests cover them in Task 5.

---

## Task 4: Commit 1 — State machine + cfr-types cleanup

Remove `"REFLECTING"`, `REFLECT_JOB_DONE`, `SPAWN_REFLECT_JOB`, `reflectJobId` from the type system. Narrow `FixAttempt.phase`. Adjust `MAX_JOBS`.

**Files:**
- Modify: `packages/core/src/capabilities/orchestrator-state-machine.ts`
- Modify: `packages/core/src/capabilities/cfr-types.ts`
- Modify: `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts`
- Modify: `packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts`

- [ ] **Step 4.1: Update `orchestrator-state-machine.ts`**

Open `packages/core/src/capabilities/orchestrator-state-machine.ts`. Make these changes:

**(a)** Remove `"REFLECTING"` from `OrchestratorState` union (line ~14):
```typescript
// Before:
export type OrchestratorState =
  | "IDLE"
  | "ACKED"
  | "EXECUTING"
  | "REFLECTING"
  | "REVERIFYING"
  | "RESTORED_WITH_REPROCESS"
  | "RESTORED_TERMINAL"
  | "SURRENDER";

// After:
export type OrchestratorState =
  | "IDLE"
  | "ACKED"
  | "EXECUTING"
  | "REVERIFYING"
  | "RESTORED_WITH_REPROCESS"
  | "RESTORED_TERMINAL"
  | "SURRENDER";
```

**(b)** Remove `{ type: "REFLECT_JOB_DONE"; nextHypothesis: string }` from `OrchestratorEvent` union (line ~25). The full union becomes:
```typescript
export type OrchestratorEvent =
  | { type: "CFR_RECEIVED" }
  | { type: "ACK_SENT" }
  | { type: "EXECUTE_JOB_SPAWNED"; jobId: string }
  | { type: "EXECUTE_JOB_DONE"; success: boolean }
  | { type: "REVERIFY_PASS_RECOVERED"; recoveredContent: string }
  | { type: "REVERIFY_PASS_TERMINAL" }
  | { type: "REVERIFY_FAIL" }
  | { type: "REPROCESS_SENT" };
```

**(c)** Remove `{ action: "SPAWN_REFLECT_JOB" }` from `Action` union (line ~61). The full union becomes:
```typescript
export type Action =
  | { action: "SEND_ACK"; kind: "attempt" | "status" | "surrender" }
  | { action: "SPAWN_EXECUTE_JOB" }
  | { action: "REVERIFY" }
  | { action: "REPROCESS_TURN"; recoveredContent: string }
  | { action: "TERMINAL_ACK" }
  | { action: "SURRENDER" }
  | { action: "ITERATE"; nextAttemptNumber: 2 | 3 }
  | { action: "NOOP" };
```

**(d)** Remove `reflectJobId?: string` from `FixSession` interface (line ~37). The interface becomes:
```typescript
export interface FixSession {
  failureId: string;
  capabilityType: string;
  attemptNumber: 1 | 2 | 3;
  state: OrchestratorState;
  executeJobId?: string;
  attempts: FixAttempt[];
  totalJobsSpawned: number;
  surrenderReason?: "budget" | "iteration-3" | "redesign-needed" | "insufficient-context";
  attachedOrigins: TriggeringOrigin[];
}
```

**(e)** Change `MAX_JOBS = 5` → `MAX_JOBS = 4` (line ~69):
```typescript
const MAX_JOBS = 4;
```

**(f)** In the `EXECUTING` case, change the success branch from `SPAWN_REFLECT_JOB` to `REVERIFY` (line ~103):
```typescript
case "EXECUTING": {
  if (event.type === "EXECUTE_JOB_DONE") {
    if (event.success) {
      return { action: "REVERIFY" };
    } else {
      if (attemptNumber < 3) {
        return { action: "ITERATE", nextAttemptNumber: (attemptNumber + 1) as 2 | 3 };
      } else {
        return { action: "SURRENDER" };
      }
    }
  }
  break;
}
```

**(g)** Remove the entire `REFLECTING` case (lines ~116-121):
```typescript
// Delete this block:
case "REFLECTING": {
  if (event.type === "REFLECT_JOB_DONE") {
    return { action: "REVERIFY" };
  }
  break;
}
```

- [ ] **Step 4.2: Update `cfr-types.ts`**

In `packages/core/src/capabilities/cfr-types.ts`, narrow `FixAttempt.phase` (line ~58):

```typescript
// Before:
phase: "execute" | "reflect";

// After:
phase: "execute";
```

- [ ] **Step 4.3: Verify tsc catches nothing else**

```bash
cd packages/core && npx tsc --noEmit 2>&1
```

Expected: errors about `REFLECTING`, `REFLECT_JOB_DONE`, `SPAWN_REFLECT_JOB`, `reflectJobId` still used in `recovery-orchestrator.ts`. That's correct — those are removed in Task 5 (Commit 2). For now, the type errors confirm the types have been cleaned up.

If errors appear in TEST files, fix them now (next step). If errors appear in unexpected production files, stop and file a proposal.

- [ ] **Step 4.4: Update `orchestrator-state-machine.test.ts`**

Open `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts`. Make three changes:

**(a)** Replace the `"EXECUTING + success → SPAWN_REFLECT_JOB"` case with `"EXECUTING + success → REVERIFY"` (lines ~49–53):
```typescript
// Before:
{
  label: "EXECUTING + EXECUTE_JOB_DONE(success=true) → SPAWN_REFLECT_JOB",
  session: { state: "EXECUTING", attemptNumber: 1 },
  event: { type: "EXECUTE_JOB_DONE", success: true },
  expected: { action: "SPAWN_REFLECT_JOB" },
},

// After:
{
  label: "EXECUTING + EXECUTE_JOB_DONE(success=true) → REVERIFY",
  session: { state: "EXECUTING", attemptNumber: 1 },
  event: { type: "EXECUTE_JOB_DONE", success: true },
  expected: { action: "REVERIFY" },
},
```

**(b)** Remove the `"REFLECTING + REFLECT_JOB_DONE → REVERIFY"` test case entirely (lines ~55–59):
```typescript
// Delete:
{
  label: "REFLECTING + REFLECT_JOB_DONE → REVERIFY",
  session: { state: "REFLECTING", attemptNumber: 1 },
  event: { type: "REFLECT_JOB_DONE", nextHypothesis: "try reinstalling deps" },
  expected: { action: "REVERIFY" },
},
```

**(c)** Remove the `"REFLECTING + REFLECT_JOB_DONE with 5 jobs → SURRENDER"` budget test case (lines ~127–131):
```typescript
// Delete:
{
  label: "REFLECTING + REFLECT_JOB_DONE with 5 jobs → SURRENDER",
  session: { state: "REFLECTING", attemptNumber: 2, totalJobsSpawned: 5 },
  event: { type: "REFLECT_JOB_DONE", nextHypothesis: "anything" },
  expected: { action: "SURRENDER" },
},
```

**(d)** Update the budget-exhaustion test for EXECUTING success (lines ~121–125). Since `MAX_JOBS` is now 4, update the fixture to use `totalJobsSpawned: 4`:
```typescript
// Before:
{
  label: "EXECUTING + EXECUTE_JOB_DONE(success) with 5 jobs → SURRENDER",
  session: { state: "EXECUTING", attemptNumber: 1, totalJobsSpawned: 5 },
  event: { type: "EXECUTE_JOB_DONE", success: true },
  expected: { action: "SURRENDER" },
},

// After:
{
  label: "EXECUTING + EXECUTE_JOB_DONE(success) with 4 jobs → SURRENDER",
  session: { state: "EXECUTING", attemptNumber: 1, totalJobsSpawned: 4 },
  event: { type: "EXECUTE_JOB_DONE", success: true },
  expected: { action: "SURRENDER" },
},
```

**(e)** Update the `"ACKED + ACK_SENT with 5 jobs → SURRENDER"` case (line ~115) — still uses 5, which is still valid (5 >= MAX_JOBS=4). Keep as-is; no change needed.

- [ ] **Step 4.5: Update `orchestrator-budget.test.ts`**

Open `packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts`. Rewrite the budget test (lines ~177–221):

```typescript
describe("RecoveryOrchestrator — job budget", () => {
  it("no more than 4 automation jobs are spawned across 3 attempts (1 execute per attempt, no reflect)", async () => {
    let spawnCount = 0;
    const spawnAutomation = vi.fn().mockImplementation(async (_spec: AutomationSpec) => {
      spawnCount++;
      return { jobId: `j-${spawnCount}`, automationId: `a-${spawnCount}` };
    });

    const awaitAutomation = vi.fn().mockImplementation(async (_jobId: string) => {
      // All execute jobs succeed — with reflect gone, each attempt is 1 job
      return { status: "done" } as AutomationResult;
    });

    const mockWatcher = {
      rescanNow: vi.fn().mockResolvedValue([]),
    } as unknown as CapabilityWatcher;

    const deps = makeDeps({
      spawnAutomation,
      awaitAutomation,
      capabilityRegistry: {
        get: vi.fn().mockReturnValue({
          status: "available",
          path: "/nonexistent-cap-path",
          provides: "audio-to-text",
          enabled: true,
        }),
      } as unknown as CapabilityRegistry,
      watcher: mockWatcher,
    });

    const orchestrator = new RecoveryOrchestrator(deps);
    await orchestrator.handle(makeFailure());

    // 3 attempts × 1 execute job = 3; ceiling at MAX_JOBS=4
    expect(spawnCount).toBeLessThanOrEqual(4);
    expect(spawnCount).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 4.6: Run state machine tests**

```bash
cd packages/core && npx vitest run tests/capabilities/orchestrator/orchestrator-state-machine tests/capabilities/orchestrator/orchestrator-budget 2>&1 | tail -10
```

Expected: all pass. tsc will still show errors for the orchestrator file (fixed in Task 5).

- [ ] **Step 4.7: Commit**

```bash
git add \
  packages/core/src/capabilities/orchestrator-state-machine.ts \
  packages/core/src/capabilities/cfr-types.ts \
  packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts \
  packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts
git commit -m "refactor(m9.6-s17): commit 1 — remove reflect state + types (REFLECTING/SPAWN_REFLECT_JOB/REFLECT_JOB_DONE)

State machine: EXECUTING+success now edges to REVERIFY (not SPAWN_REFLECT_JOB).
FixAttempt.phase narrowed to 'execute'. MAX_JOBS 5→4 (reflect gone; max actual=3).
Tests updated. orchestrator-state-machine.ts intentionally shows tsc errors until commit 2."
```

---

## Task 5: Commit 2 — Orchestrator behavior + Item A smoke output + FU-1 + FU-2

Remove the reflect spawn/await/deliver block from `recovery-orchestrator.ts`. Add smoke output to the fix-mode prompt (Item A). Wire FU-1 and FU-2.

**File:** `packages/core/src/capabilities/recovery-orchestrator.ts`

- [ ] **Step 5.1: Remove `reflectJobId` from the execute block**

Locate line ~452: `session.state = "REFLECTING";` and nearby state references. Find the full reflect block starting after `session.attempts.push(executeAttempt)` through `return await this.doReverify(failure, session, executeAttempt)`. The block spans lines ~437–504.

The current code after the attempt push:
```typescript
    session.state = "REFLECTING";
    nextAction(session, { type: "EXECUTE_JOB_DONE", success: true });

    // Budget check before spawning reflect job
    if (session.totalJobsSpawned >= 5) {
      const result = await this.doReverify(failure, session, executeAttempt);
      if (!result.recovered) {
        session.surrenderReason = "budget";
      }
      return result;
    }

    // Spawn reflect-phase automation (Opus)
    let reflectJobId: string;
    try {
      const reflectPrompt = this.renderReflectPrompt(failure, session, deliverable);
      const spawned = await this.deps.spawnAutomation({
        name: `cfr-fix-${failure.capabilityType}-a${session.attemptNumber}-reflect-${randomUUID().slice(0, 8)}`,
        model: "opus",
        autonomy: "cautious",
        prompt: reflectPrompt,
        jobType: "capability_modify",
        parent: { jobId: executeJobId, iteration: session.attemptNumber },
      });
      reflectJobId = spawned.jobId;
      session.reflectJobId = reflectJobId;
      session.totalJobsSpawned += 1;
    } catch (err) {
      console.error("[RecoveryOrchestrator] Failed to spawn reflect job:", err);
      return await this.doReverify(failure, session, executeAttempt);
    }

    // Await reflect job
    await this.deps.awaitAutomation(reflectJobId, JOB_TIMEOUT_MS);
    const reflectDeliverable = this.readDeliverable(reflectJobId);
    const nextHypothesis =
      reflectDeliverable?.frontmatter.summary ??
      reflectDeliverable?.body.slice(0, 200) ??
      "no hypothesis from reflect phase";

    session.state = "REVERIFYING";
    nextAction(session, { type: "REFLECT_JOB_DONE", nextHypothesis });

    executeAttempt.nextHypothesis = nextHypothesis;

    return await this.doReverify(failure, session, executeAttempt);
```

Replace the entire section (from `session.state = "REFLECTING"` through the last `return await this.doReverify`) with **[ARCHITECT S4]**:

```typescript
    // Reflect phase removed — S16 fix-mode is already Opus; reflect was redundant.
    // doReverify fires REVERIFY_PASS_RECOVERED / REVERIFY_PASS_TERMINAL / REVERIFY_FAIL
    // internally. No nextAction call here.
    session.state = "REVERIFYING";
    return await this.doReverify(failure, session, executeAttempt);
```

(v0 of this plan offered two versions with/without a `nextAction` call. ARCHITECT S4: pick the omit-nextAction version above. `doReverify` fires the real reverify event; an extra `nextAction` call here would be misleading at best — it'd suggest the orchestrator transitions to a definite terminal state before reverify decides which.)

- [ ] **Step 5.2: Delete `renderReflectPrompt`**

Locate the `private renderReflectPrompt` method at line ~772 through the closing brace (line ~803). Delete the entire method.

Confirm it's gone:
```bash
grep -n "renderReflectPrompt" packages/core/src/capabilities/recovery-orchestrator.ts
```
Expected: zero results.

- [ ] **Step 5.3: Remove `session.reflectJobId` references**

```bash
grep -n "reflectJobId" packages/core/src/capabilities/recovery-orchestrator.ts
```

Expected: zero results (the field was removed from `FixSession` in Task 4; any remaining reference here would be a type error).

- [ ] **Step 5.4a [ARCHITECT S1]: Verify smoke output source BEFORE wiring `failure.detail`**

The plan wires `failure.detail` into `smokeOutput`, but `cfr-types.ts` defines `detail?: string` as "human-readable tail from the origin error" — not specifically smoke stderr. Verify that what populates `failure.detail` is actually the smoke output.

```bash
grep -n "detail:" packages/core/src/capabilities/invoker.ts packages/core/src/capabilities/mcp-cfr-detector.ts packages/dashboard/src/chat/chat-service.ts
```

**Decision rule:**
- If `failure.detail` is populated from `execFile`'s `stderr` in the invoker → wiring it as `smokeOutput` is correct. Document in `s17-DECISIONS.md` D2.
- If `failure.detail` carries something else (e.g., a generic error message that doesn't include the smoke output) → choose:
  - (a) **Extend the invoker** to capture stderr in `detail` (or a new `stderr` field). Small change, ensures M1 actually delivers the projected 60-90s improvement.
  - (b) **Capture smoke separately** in `runOneAttempt`: before spawn, re-run `<capDir>/scripts/smoke.sh` once and capture the stderr into a local variable, pass that to `buildFixModeInvocation`. Small but adds one extra smoke run per attempt (negligible cost vs Opus saving).

If (a) or (b), document the choice in `s17-DECISIONS.md` D2 and update Step 5.4 below to use the new field/variable instead of `failure.detail`.

**Without this verification:** M1 may silently produce empty `## Smoke Output` sections — Opus would still re-run smoke, the projected 60-90s improvement wouldn't materialize, and S17's wall-time gain would be smaller than expected. Item B's fix would still land the major win (3x → 1x iteration), but Item A's incremental gain would be lost.

- [ ] **Step 5.4: Add Item A — `AutomationSpec.smokeOutput?` and render in prompt**

In `recovery-orchestrator.ts`, find the `AutomationSpec` interface (line ~37):

```typescript
export interface AutomationSpec {
  name: string;
  model: "opus" | "sonnet";
  autonomy: "cautious" | "standard";
  prompt: string;
  jobType: "capability_modify";
  parent?: { jobId: string; iteration: number };
  targetPath?: string;
}
```

Add the optional field:
```typescript
export interface AutomationSpec {
  name: string;
  model: "opus" | "sonnet";
  autonomy: "cautious" | "standard";
  prompt: string;
  jobType: "capability_modify";
  parent?: { jobId: string; iteration: number };
  targetPath?: string;
  smokeOutput?: string; // pre-populated smoke stderr; Opus skips redundant diagnostic run
}
```

Find `buildFixModeInvocation` (around line 729). The current method builds the prompt from `failure` and `session`. Extend it to accept an optional `smokeOutput` parameter and append a `## Smoke Output` section:

Locate the method signature and find where it currently ends the prompt string. Add after the attempts table (or at the end of the prompt body):

The current signature is `buildFixModeInvocation(failure, session, capPath)` (3 args). Add `smokeOutput` as the 4th optional parameter:

```typescript
  private buildFixModeInvocation(
    failure: CapabilityFailure,
    session: FixSession,
    capPath: string | undefined,
    smokeOutput?: string,
  ): string {
    // ... existing body unchanged up to the final return ...

    // Append smoke output section if provided
    const smokeSection =
      smokeOutput && smokeOutput.trim()
        ? `\n\n## Smoke Output\n\n\`\`\`\n${smokeOutput.trim()}\n\`\`\`\n\nThis is the stderr/stdout from the last smoke run. Use it to form your hypothesis — do not re-run smoke to gather diagnostics.`
        : "";

    return `MODE: FIX\n\n...existing prompt body...\n\n${attemptsSection}${smokeSection}`;
  }
```

Concretely: keep all the existing template string unchanged, and concatenate `smokeSection` at the very end of the return value.

Update the call site at line ~361 to pass `failure.detail` as the 4th arg, and update the `spawnAutomation` call to also include `smokeOutput` on the spec:

```typescript
    const fixPrompt = this.buildFixModeInvocation(failure, session, cap?.path, failure.detail ?? undefined);

    // ...

    const spawned = await this.deps.spawnAutomation({
      name: `cfr-fix-${failure.capabilityType}-a${session.attemptNumber}-exec-${randomUUID().slice(0, 8)}`,
      model: "opus",
      autonomy: "standard",
      prompt: fixPrompt,
      jobType: "capability_modify",
      targetPath: cap?.path,
      smokeOutput: failure.detail ?? undefined,
      parent: session.executeJobId
        ? { jobId: session.executeJobId, iteration: session.attemptNumber }
        : undefined,
    });
```

Note: `smokeOutput` on the spec is informational (the dashboard doesn't consume it separately). The content is injected via the prompt. The field exists on `AutomationSpec` per spec §2.2.1 Item A.

- [ ] **Step 5.5: Wire FU-1 (ESCALATE paper trail)**

Locate the ESCALATE branch in `runOneAttempt` (around line 406). Currently:
```typescript
    if (deliverable?.body && deliverable.body.trimStart().startsWith("ESCALATE:")) {
      const firstLine = deliverable.body.trimStart().split("\n")[0] ?? "";
      if (firstLine.includes("redesign-needed")) {
        session.surrenderReason = "redesign-needed";
      } else if (firstLine.includes("insufficient-context")) {
        session.surrenderReason = "insufficient-context";
      }
      return { recovered: false, escalate: true };
    }
```

Replace with:
```typescript
    if (deliverable?.body && deliverable.body.trimStart().startsWith("ESCALATE:")) {
      const firstLine = deliverable.body.trimStart().split("\n")[0] ?? "";
      if (firstLine.includes("redesign-needed")) {
        session.surrenderReason = "redesign-needed";
      } else if (firstLine.includes("insufficient-context")) {
        session.surrenderReason = "insufficient-context";
      } else {
        console.warn(
          `[RecoveryOrchestrator] Unrecognised ESCALATE reason in deliverable — defaulting to plain surrender. First line: ${firstLine}`,
        );
      }
      // FU-1: push a synthetic attempt so terminalDrain has a paper trail for ESCALATE surrenders
      const escalateAttempt: FixAttempt = {
        attempt: session.attemptNumber,
        startedAt: attemptStartedAt,
        endedAt: this.deps.now(),
        hypothesis: deliverable.frontmatter.summary ?? "(ESCALATE — no hypothesis)",
        change: deliverable.body.slice(0, 500),
        verificationInputPath: failure.triggeringInput.artifact?.rawMediaPath ?? "",
        verificationResult: "fail",
        failureMode: `ESCALATE: ${session.surrenderReason ?? "unknown"}`,
        jobId: executeJobId,
        modelUsed: "opus",
        phase: "execute",
      };
      session.attempts.push(escalateAttempt);
      return { recovered: false, escalate: true };
    }
```

- [ ] **Step 5.6: Run tsc — expect zero errors**

```bash
cd packages/core && npx tsc --noEmit 2>&1
```

Expected: zero errors. If any errors remain, they'll be about remaining `reflectJobId` or `REFLECTING` references — grep for them and fix:

```bash
grep -n "reflectJobId\|REFLECTING\|renderReflect\|REFLECT_JOB_DONE\|SPAWN_REFLECT" packages/core/src/capabilities/recovery-orchestrator.ts
```

Expected: zero hits.

- [ ] **Step 5.7 [ARCHITECT S3]: Write new tests for FU-1, FU-2, and Item A**

Use the existing `fix-mode-escalate.test.ts` test patterns from S16 — `makeRunDir(deliverableBody)` + `makeDeps(runDir, overrides)` + `makeFailure()` are already defined there. The test bodies below are real implementations, not stubs.

Add to `packages/core/tests/capabilities/fix-mode-escalate.test.ts` (extends the existing suite):

```typescript
// FU-1: ESCALATE surrender has a paper trail in session.attempts
describe("ESCALATE — FU-1 paper trail", () => {
  it("ESCALATE: redesign-needed pushes a synthetic FixAttempt with the right fields", async () => {
    const runDir = makeRunDir("ESCALATE: redesign-needed\n\nThis needs a redesign.");

    // Capture the orchestrator's session by intercepting terminalDrain via
    // ack-delivery's writeAutomationRecovery dep — that call receives the session.
    let capturedAttempts: FixAttempt[] | undefined;
    const ackDelivery = {
      writeAutomationRecovery: vi
        .fn()
        .mockImplementation(async (_failure, session, _outcome) => {
          capturedAttempts = [...session.attempts];
        }),
      handleAck: vi.fn().mockResolvedValue(undefined),
    } as unknown as AckDelivery;

    const deps = makeDeps(runDir, { ackDelivery });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(capturedAttempts).toBeDefined();
    expect(capturedAttempts).toHaveLength(1);
    expect(capturedAttempts![0].failureMode).toBe("ESCALATE: redesign-needed");
    expect(capturedAttempts![0].verificationResult).toBe("fail");
    expect(capturedAttempts![0].phase).toBe("execute");
    expect(capturedAttempts![0].attempt).toBe(1);
  });

  it("ESCALATE: insufficient-context also pushes a synthetic FixAttempt", async () => {
    const runDir = makeRunDir("ESCALATE: insufficient-context\n\nNot enough info.");
    let capturedAttempts: FixAttempt[] | undefined;
    const ackDelivery = {
      writeAutomationRecovery: vi
        .fn()
        .mockImplementation(async (_failure, session, _outcome) => {
          capturedAttempts = [...session.attempts];
        }),
      handleAck: vi.fn().mockResolvedValue(undefined),
    } as unknown as AckDelivery;

    const deps = makeDeps(runDir, { ackDelivery });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(capturedAttempts).toHaveLength(1);
    expect(capturedAttempts![0].failureMode).toBe("ESCALATE: insufficient-context");
  });
});

// FU-2: Unrecognised ESCALATE reason logs a console.warn
describe("ESCALATE — FU-2 unrecognised reason warn", () => {
  it("ESCALATE: gibberish logs a console.warn with the offending first line", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const runDir = makeRunDir("ESCALATE: some-garbage-reason\n\nBody.");
      const deps = makeDeps(runDir);
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unrecognised ESCALATE reason"),
      );
      // The warn message should also include the offending first line
      const warnCall = warnSpy.mock.calls.find((c) =>
        String(c[0]).includes("Unrecognised ESCALATE"),
      );
      expect(warnCall?.[0]).toContain("some-garbage-reason");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("ESCALATE: gibberish still produces a paper-trail attempt (FU-1+FU-2 interplay)", async () => {
    const runDir = makeRunDir("ESCALATE: gibberish\n\nBody.");
    let capturedAttempts: FixAttempt[] | undefined;
    const ackDelivery = {
      writeAutomationRecovery: vi
        .fn()
        .mockImplementation(async (_failure, session, _outcome) => {
          capturedAttempts = [...session.attempts];
        }),
      handleAck: vi.fn().mockResolvedValue(undefined),
    } as unknown as AckDelivery;

    const deps = makeDeps(runDir, { ackDelivery });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(makeFailure());

    expect(capturedAttempts).toHaveLength(1);
    expect(capturedAttempts![0].failureMode).toBe("ESCALATE: unknown");
  });
});
```

Add to `packages/core/tests/capabilities/fix-mode-invocation.test.ts` (extends the S16 suite):

```typescript
// Item A: smokeOutput appended to fix-mode prompt when set
describe("Item A — smoke output in MODE: FIX prompt", () => {
  it("spec.smokeOutput populated on spawn when failure.detail is non-empty", async () => {
    const captured: AutomationSpec[] = [];
    const failure = makeFailure();
    failure.detail = "edge-tts failed: ValueError: 'en-XX-BrokenVoiceXXX' is not a valid voice";

    const deps = makeDeps({
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(failure);

    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].smokeOutput).toBe(failure.detail);
  });

  it("prompt contains '## Smoke Output' section with the detail content", async () => {
    const captured: AutomationSpec[] = [];
    const failure = makeFailure();
    failure.detail = "stderr line 1\nstderr line 2";

    const deps = makeDeps({
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(failure);

    expect(captured[0].prompt).toContain("## Smoke Output");
    expect(captured[0].prompt).toContain("stderr line 1");
    expect(captured[0].prompt).toContain("stderr line 2");
  });

  it("prompt OMITS '## Smoke Output' section when detail is empty/undefined", async () => {
    const captured: AutomationSpec[] = [];
    const failure = makeFailure();
    failure.detail = undefined;

    const deps = makeDeps({
      spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
        captured.push(spec);
        return { jobId: "j-1", automationId: "a-1" };
      }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
    });
    const orch = new RecoveryOrchestrator(deps);
    await orch.handle(failure);

    expect(captured[0].prompt).not.toContain("## Smoke Output");
    expect(captured[0].smokeOutput).toBeUndefined();
  });
});
```

If Step 5.4a chose to capture smoke from a source other than `failure.detail` (e.g., separate stderr capture), update the `failure.detail = ...` lines above to set whichever field/variable feeds `smokeOutput`. The assertions on `## Smoke Output` and `smokeOutput` field shape stay the same.

- [ ] **Step 5.8: Run all orchestrator tests**

```bash
cd packages/core && npx vitest run tests/capabilities/orchestrator tests/capabilities/fix-mode-invocation tests/capabilities/fix-mode-escalate tests/capabilities/fix-mode-integration 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 5.9: Run full core suite**

```bash
cd packages/core && npx vitest run 2>&1 | tail -5
```

Expected: same or better pass count vs pre-sprint.

- [ ] **Step 5.10: Verify no reflect references remain in production code**

```bash
rg "reflect|REFLECTING|reflectJobId|renderReflectPrompt|REFLECT_JOB_DONE|SPAWN_REFLECT" packages/core/src/capabilities/
```

Expected: zero hits.

- [ ] **Step 5.11: Commit**

```bash
git add packages/core/src/capabilities/recovery-orchestrator.ts
git add packages/core/tests/capabilities/fix-mode-invocation.test.ts
git commit -m "refactor(m9.6-s17): commit 2 — remove reflect behavior, add smoke output in prompt (M1), wire FU-1/FU-2

Reflect spawn/await block deleted. renderReflectPrompt deleted. Execute success
now goes directly to doReverify. AutomationSpec.smokeOutput added; buildFixModeInvocation
appends ## Smoke Output section from failure.detail — eliminates Opus redundant
diagnostic run (~60-90s per attempt). FU-1: ESCALATE path pushes synthetic
FixAttempt for paper trail. FU-2: unrecognised ESCALATE reason logs console.warn."
```

---

## Task 6: Commit 3 — Delete `fix-automation.md`

S16 added a deprecation notice to `packages/core/src/capabilities/prompts/fix-automation.md`. This sprint deletes it.

- [ ] **Step 6.1: Confirm nothing imports or reads the file**

```bash
rg "fix-automation" packages/core/src/ packages/dashboard/src/
```

Expected: zero hits (the deprecation notice in S16 should have ensured nothing depends on it).

- [ ] **Step 6.2: Delete the file**

```bash
rm packages/core/src/capabilities/prompts/fix-automation.md
```

- [ ] **Step 6.3: Confirm it's gone**

```bash
ls packages/core/src/capabilities/prompts/fix-automation.md 2>/dev/null || echo "DELETED"
```

Expected: `DELETED`.

- [ ] **Step 6.4: Run tsc + test suite**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -5
cd packages/core && npx vitest run 2>&1 | tail -5
```

Expected: zero errors, same pass count.

- [ ] **Step 6.5: Commit**

```bash
git add -A
git commit -m "chore(m9.6-s17): commit 3 — delete fix-automation.md (deprecated in S16, unreachable)"
```

---

## Task 7: Final verification

- [ ] **Step 7.1: Full reflect purge check**

```bash
rg "reflect|REFLECTING|reflectJobId|renderReflect|REFLECT_JOB_DONE|SPAWN_REFLECT_JOB" \
  packages/core/src/capabilities/ \
  packages/dashboard/src/
```

Expected: zero hits in production code.

- [ ] **Step 7.2: fix-automation.md absent**

```bash
ls packages/core/src/capabilities/prompts/
```

Expected: no `fix-automation.md` in the listing.

- [ ] **Step 7.3: tsc both packages clean**

```bash
cd packages/core && npx tsc --noEmit 2>&1 | head -10
cd packages/dashboard && npx tsc --noEmit 2>&1 | head -10
```

Expected: zero errors both packages.

- [ ] **Step 7.4: Full test suites**

```bash
cd packages/core && npx vitest run 2>&1 | tail -5
cd packages/dashboard && npx vitest run 2>&1 | tail -5
```

Expected: core ≥629 pass, dashboard ≥1267 pass. No new failures.

- [ ] **Step 7.5: Run S16 acceptance tests to confirm no regressions**

```bash
cd packages/core && npx vitest run \
  tests/capabilities/fix-mode-invocation \
  tests/capabilities/fix-mode-integration \
  tests/capabilities/fix-mode-escalate \
  tests/skills/capability-brainstorming-gate \
  tests/capabilities/resilience-messages-new-reasons \
  2>&1 | tail -10
```

Expected: 29/29 pass (same as S16 architect re-verification).

- [ ] **Step 7.6: Six-commit log check [ARCHITECT update]**

```bash
git log --oneline sprint/m9.6-s17-reflect-collapse ^master
```

Expected: **6 commits** in this order (newest first):
```
docs(m9.6-s17): sprint artifacts — decisions, deviations, follow-ups, test report
chore(m9.6-s17): commit 3 — delete fix-automation.md
refactor(m9.6-s17): commit 2 — remove reflect behavior, add smoke output in prompt (M1), wire FU-1/FU-2
refactor(m9.6-s17): commit 1 — remove reflect state + types
fix(m9.6-s17): awaitAutomation maps 'completed'→'done' — orchestrator iteration bug
                (or: fix(m9.6-s17): automation-executor sets 'done' not 'completed' — Item B source fix)
docs(m9.6-s17): orchestrator-iteration investigation — completed-status KNOWN_TERMINAL mismatch
```

The Item B commit message depends on Step 1.4a's source-vs-adapter choice.

- [ ] **Step 7.7: Proceed to Task 8 (sprint artifacts) before notifying architect**

The architect-review process requires `s17-DECISIONS.md`, `s17-DEVIATIONS.md`, `s17-FOLLOW-UPS.md`, and `s17-test-report.md` to be present at notify time. **Do not notify the architect until Task 8 is complete.**

---

## Task 8 [ARCHITECT R1]: Sprint artifacts + CTO notification

Required by `plan-phase2-coverage.md §0.3` (carried into Phase 3). The dev writes these; the architect writes `s17-architect-review.md` separately. **Do NOT touch ROADMAP.md. Do NOT use "APPROVED" framing in commit messages.** S16 had two §0.3 violations (premature merge + premature ROADMAP-Done); do not repeat.

**Files:**
- Create: `docs/sprints/m9.6-capability-resilience/s17-DECISIONS.md`
- Create: `docs/sprints/m9.6-capability-resilience/s17-DEVIATIONS.md`
- Create: `docs/sprints/m9.6-capability-resilience/s17-FOLLOW-UPS.md`
- Create: `docs/sprints/m9.6-capability-resilience/s17-test-report.md`

- [ ] **Step 8.1: Create `s17-DECISIONS.md`**

Format per Phase 1 / Phase 2 sprints. At minimum, capture:

- **D1 — Item B fix path:** source vs adapter (per Step 1.4a). Quote the grep evidence; explain the pick.
- **D2 — Item A smoke source:** per Step 5.4a — `failure.detail` direct, invoker-extension to capture stderr, or separate smoke run in `runOneAttempt`. Quote the grep evidence; explain the pick.
- **D3 — Reflect dead-code removal scope:** confirm `renderReflectPrompt` is the only reflect-related private method removed; confirm no consumer outside `runOneAttempt` referenced it.
- **D4 — FU-1 synthetic FixAttempt shape:** which fields are populated vs left default; rationale for `verificationResult: "fail"` and `phase: "execute"` choices.
- **D5 — Item B historical implication:** "Item B bug pre-dates S16 but was unobserved until S16 wall-time measurement surfaced it. Phase 1 S7 STT exit gate (142s) is roughly consistent with 3 iterations of ~50s each. Pre-S17, every CFR fix-mode (and pre-S16 reflect+execute) run iterated to attempt 3 even when the fix landed at attempt 1. S17 closes this silently — no migration needed because nothing persists fix-attempt history beyond the in-memory orchestrator session."

- [ ] **Step 8.2: Create `s17-DEVIATIONS.md`**

Index of every `proposals/s17-*.md` filed. At minimum:
- `s17-orchestrator-iteration-investigation.md` (filed in Task 1; not strictly a "deviation" but a required investigation artifact — index it).
- Any deviation proposals filed during sprint execution.

If no deviations were filed beyond the investigation, the file just notes that with one line.

Format:
```markdown
---
sprint: m9.6-s17
---

# S17 Deviations

## Investigation artifact (Task 1)
- [proposals/s17-orchestrator-iteration-investigation.md](proposals/s17-orchestrator-iteration-investigation.md) — Item B root cause analysis

## DEV-1 / DEV-2 / ... — <title>  (only if filed)
- **What:** <one line>
- **Proposal:** [proposals/s17-<slug>.md](proposals/s17-<slug>.md)
- **Resolution:** <approved | rejected | self-answered>
```

- [ ] **Step 8.3: Create `s17-FOLLOW-UPS.md`**

Per §0.1 universal-coverage rule: S17 doesn't add new generic layers (it removes one), but it touches the orchestrator's iteration path. Confirm in this file:
- "S17 removes the reflect phase (no new layer added). §0.1 universal-coverage rule technically N/A. The Item B fix and Item A smoke-output enhancement apply uniformly to every plug type registered in `.my_agent/capabilities/` because they live in the orchestrator's gate path."

Then list any out-of-scope items noticed:
- Anything found during the source-vs-adapter investigation (Step 1.4a) that suggests broader status-enum cleanup is needed.
- Anything found during the smoke-source investigation (Step 5.4a) that suggests CapabilityInvoker should evolve.
- Any tests that were marked skip / xit during the sprint and need to be revisited.

If nothing notable, the file just states the universal-coverage rationale.

- [ ] **Step 8.4: Create `s17-test-report.md`**

Verification command output for every test added/touched in S17:
- New tests from Tasks 2, 5: `await-automation-status`, `orchestrator-completed-status`, FU-1/FU-2 in `fix-mode-escalate`, Item A in `fix-mode-invocation`.
- Updated tests from Task 4: `orchestrator-state-machine`, `orchestrator-budget`.
- Regression sweep: full core + dashboard suites.
- S16 acceptance tests still green: 29/29.
- tsc clean both packages.

Capture command lines + counts. Architect re-runs these independently at review; mismatches block approval.

- [ ] **Step 8.5: External auditor (optional)**

Per §0.3, the dev MAY run an external auditor. S17's surface (state-machine refactor + behavior change + new test patterns) is large enough that an audit pays off. If used, lands at `s17-review.md` with frontmatter `reviewer: External auditor (dev-contracted)` and `recommended: APPROVE | REJECT | CONDITIONAL`. **Never** `reviewer: Architect`. **Never** `verdict: APPROVED`.

- [ ] **Step 8.6: Stop the trip-sprint and notify CTO**

Notify CTO: "S17 dev is done; artifacts ready for architect review."

**Do NOT:**
- Commit `APPROVED` in any commit message.
- Mark S17 Done in `docs/ROADMAP.md`.
- Write `s17-architect-review.md` (architect's exclusively).
- Merge `sprint/m9.6-s17-reflect-collapse` to master.

S16 had both the premature-merge and premature-ROADMAP-Done violations. The architect will check both first thing at re-review.

- [ ] **Step 8.7: Commit the artifacts**

```bash
git add docs/sprints/m9.6-capability-resilience/s17-DECISIONS.md \
        docs/sprints/m9.6-capability-resilience/s17-DEVIATIONS.md \
        docs/sprints/m9.6-capability-resilience/s17-FOLLOW-UPS.md \
        docs/sprints/m9.6-capability-resilience/s17-test-report.md
# If external auditor used:
# git add docs/sprints/m9.6-capability-resilience/s17-review.md
git commit -m "docs(m9.6-s17): sprint artifacts — decisions, deviations, follow-ups, test report"
```

---

## Deviation triggers

If any of these situations arise, do NOT change course — file `proposals/s17-<slug>.md` and wait:

- The reflect code turns out to be reachable by a path not visible in `runOneAttempt` (e.g., a direct call from outside the orchestrator).
- `FixAttempt.phase: "execute"` narrows TypeScript but breaks a test fixture that can't be mechanically migrated (that test is wrong; propose fixing the fixture, not widening the type).
- `buildFixModeInvocation`'s prompt already contains a smoke section from a prior change not visible in this plan.
- `failure.detail` is not the right source for smoke output (e.g., it doesn't contain stderr — the invoker might store it elsewhere). Verify before implementing; propose the right field if different.
- The full dashboard test suite has pre-existing failures beyond the 7 pre-existing ones documented in S16. Identify them as pre-existing (re-run on master to confirm) before reporting.

---

*Created: 2026-04-19*
*Sprint: M9.6-S17 — Reflect-Phase Collapse*
*Spec: docs/sprints/m9.6-capability-resilience/plan-phase3-refinements.md §2.2 + §2.2.1*
