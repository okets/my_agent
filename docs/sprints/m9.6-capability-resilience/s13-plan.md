# M9.6-S13 Reflect-Phase Collapse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the REFLECTING state from the CFR recovery orchestrator so every successful execute job goes directly to REVERIFY, reducing max jobs per recovery from 5 to 4 (safety ceiling).

**Architecture:** Two-commit sequence — Commit 1 lands the state machine and type changes with test updates (must be green before Commit 2); Commit 2 deletes the reflect spawn code from the orchestrator and the `renderReflectPrompt` method. The state machine's `MAX_JOBS` drops from 5 to 4. Zero references to `reflect` in production capability code after both commits.

**Tech Stack:** TypeScript, Vitest, `packages/core`

**Design spec:** `docs/sprints/m9.6-capability-resilience/plan-universal-coverage.md` §4.3.1 and §12.5

---

## File Map

**Commit 1 — state + types:**
- Modify: `packages/core/src/capabilities/orchestrator-state-machine.ts` — remove REFLECTING, REFLECT_JOB_DONE, SPAWN_REFLECT_JOB; collapse EXECUTING success → REVERIFY; remove `reflectJobId` from FixSession
- Modify: `packages/core/src/capabilities/cfr-types.ts` — narrow `FixAttempt.phase` to `"execute"` only
- Modify: `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts` — update transition table
- Modify: `packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts` — rewrite budget test: 3 max jobs

**Commit 2 — orchestrator behavior:**
- Modify: `packages/core/src/capabilities/recovery-orchestrator.ts` — delete reflect spawn block + `renderReflectPrompt`; update budget cap to 4
- Modify: `packages/core/src/capabilities/orchestrator-state-machine.ts` — `MAX_JOBS` 5 → 4

---

## Task 1: Update State Machine (Commit 1, part A)

**Files:**
- Modify: `packages/core/src/capabilities/orchestrator-state-machine.ts`

- [ ] **Step 1: Open the file and read the current content**

  Read `packages/core/src/capabilities/orchestrator-state-machine.ts` in full. The file is ~149 lines. Confirm you see:
  - `OrchestratorState` union at line 10
  - `OrchestratorEvent` union at line 19
  - `FixSession.reflectJobId?: string` at line 35
  - `Action` union at line 56
  - `MAX_JOBS = 5` at line 66
  - REFLECTING case handler at lines 113–118
  - EXECUTING success returning `SPAWN_REFLECT_JOB` at line 100

- [ ] **Step 2: Apply all Commit-1 state-machine changes in one edit**

  > **Compile-safety note:** `REFLECT_JOB_DONE` and `reflectJobId` are kept in the Commit-1 types even though they will be unused. Removing them now would break `recovery-orchestrator.ts` at `tsc` before Commit 2 lands. They are deleted in Task 6 alongside the orchestrator code that references them.

  Replace the entire file content with:

  ```typescript
  /**
   * orchestrator-state-machine.ts — Pure state machine for the CFR recovery loop.
   *
   * No I/O. All transitions are deterministic given (session, event).
   * Created in M9.6-S4. M9.6-S13: reflect phase removed; EXECUTING success
   * goes directly to REVERIFY. REFLECT_JOB_DONE and reflectJobId are dead
   * after this commit and removed in the accompanying orchestrator commit.
   */

  import type { FixAttempt, TriggeringOrigin } from "./cfr-types.js";

  export type OrchestratorState =
    | "IDLE"
    | "ACKED"
    | "EXECUTING"
    | "REVERIFYING"
    | "DONE"
    | "SURRENDER";

  export type OrchestratorEvent =
    | { type: "CFR_RECEIVED" }
    | { type: "ACK_SENT" }
    | { type: "EXECUTE_JOB_SPAWNED"; jobId: string }
    | { type: "EXECUTE_JOB_DONE"; success: boolean }
    // REFLECT_JOB_DONE: dead after S13 — removed with renderReflectPrompt in the orchestrator commit
    | { type: "REFLECT_JOB_DONE"; nextHypothesis: string }
    | { type: "REVERIFY_PASS"; recoveredContent: string }
    | { type: "REVERIFY_FAIL" }
    | { type: "REPROCESS_SENT" };

  export interface FixSession {
    failureId: string;
    capabilityType: string;
    attemptNumber: 1 | 2 | 3;
    state: OrchestratorState;
    executeJobId?: string;
    // reflectJobId: dead after S13 — removed with the reflect spawn code in the orchestrator commit
    reflectJobId?: string;
    attempts: FixAttempt[];
    totalJobsSpawned: number;
    /**
     * When a surrender is about to be emitted, set to "budget" if the job
     * safety ceiling forced an early bail, or "iteration-3" if all three
     * attempts ran and reverify still failed. Consumed by
     * RecoveryOrchestrator.surrender() to pick the right user-facing copy.
     */
    surrenderReason?: "budget" | "iteration-3";
    /**
     * All triggering origins that have coalesced onto this fix session (M9.6-S12
     * Task 6a — D7). Initialized with the first CFR's origin; late-arriving CFRs
     * for the same capability type append (N-aware, no second spawn, no duplicate
     * ack). The terminal drain iterates this list so every attached origin gets
     * its recovery delivery.
     */
    attachedOrigins: TriggeringOrigin[];
  }

  export type Action =
    | { action: "SEND_ACK"; kind: "attempt" | "status" | "surrender" }
    | { action: "SPAWN_EXECUTE_JOB" }
    | { action: "REVERIFY" }
    | { action: "REPROCESS_TURN"; recoveredContent: string }
    | { action: "SURRENDER" }
    | { action: "ITERATE"; nextAttemptNumber: 2 | 3 }
    | { action: "NOOP" };

  /**
   * Safety ceiling: 3 attempts × 1 job each = 3 max in normal operation.
   * Cap is 4 as defence-in-depth against runaway nesting (fix-mode forbids
   * nested spawns, but this prevents any future regression from causing
   * unbounded job spawning).
   */
  const MAX_JOBS = 4;

  /**
   * Compute the next action given the current session state and an incoming event.
   *
   * Returns SURRENDER immediately if the job budget is already exhausted
   * (checked before any state-specific logic).
   */
  export function nextAction(session: FixSession, event: OrchestratorEvent): Action {
    if (session.totalJobsSpawned >= MAX_JOBS) {
      return { action: "SURRENDER" };
    }

    const { state, attemptNumber } = session;

    switch (state) {
      case "IDLE": {
        if (event.type === "CFR_RECEIVED") {
          return { action: "SEND_ACK", kind: "attempt" };
        }
        break;
      }

      case "ACKED": {
        if (event.type === "ACK_SENT") {
          return { action: "SPAWN_EXECUTE_JOB" };
        }
        break;
      }

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

      case "REVERIFYING": {
        if (event.type === "REVERIFY_PASS") {
          return { action: "REPROCESS_TURN", recoveredContent: event.recoveredContent };
        }
        if (event.type === "REVERIFY_FAIL") {
          if (attemptNumber < 3) {
            return { action: "ITERATE", nextAttemptNumber: (attemptNumber + 1) as 2 | 3 };
          } else {
            return { action: "SURRENDER" };
          }
        }
        break;
      }

      case "DONE": {
        if (event.type === "REPROCESS_SENT") {
          return { action: "NOOP" };
        }
        break;
      }

      case "SURRENDER": {
        break;
      }
    }

    return { action: "NOOP" };
  }
  ```

---

## Task 2: Narrow FixAttempt.phase (Commit 1, part B)

**Files:**
- Modify: `packages/core/src/capabilities/cfr-types.ts`

- [ ] **Step 1: Find the FixAttempt interface**

  Search for `FixAttempt` in `packages/core/src/capabilities/cfr-types.ts`. The `phase` field is currently `"execute" | "reflect"`.

- [ ] **Step 2: Narrow the phase field and update the comment**

  Find and replace the header comment and the `phase` line:

  Old:
  ```typescript
   * FixAttempt.phase stays as-is (Phase 3 narrows in S17).
  ```
  New:
  ```typescript
   * M9.6-S13: FixAttempt.phase narrowed to "execute" only (reflect phase removed).
  ```

  Old:
  ```typescript
    phase: "execute" | "reflect";
  ```
  New:
  ```typescript
    phase: "execute";
  ```

---

## Task 3: Update State Machine Tests (Commit 1, part C)

**Files:**
- Modify: `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts`

- [ ] **Step 1: Read the current test file**

  Read the full file (`~169 lines`). Identify:
  - Line 49: test case `"EXECUTING + EXECUTE_JOB_DONE(success=true) → SPAWN_REFLECT_JOB"` — needs to change to `REVERIFY`
  - Lines 54–59: test case `"REFLECTING + REFLECT_JOB_DONE → REVERIFY"` — delete entirely
  - Lines 126–131: test case `"REFLECTING + REFLECT_JOB_DONE with 5 jobs → SURRENDER"` — delete entirely

- [ ] **Step 2: Fix the EXECUTING success test case**

  Old:
  ```typescript
    {
      label: "EXECUTING + EXECUTE_JOB_DONE(success=true) → SPAWN_REFLECT_JOB",
      session: { state: "EXECUTING", attemptNumber: 1 },
      event: { type: "EXECUTE_JOB_DONE", success: true },
      expected: { action: "SPAWN_REFLECT_JOB" },
    },
  ```
  New:
  ```typescript
    {
      label: "EXECUTING + EXECUTE_JOB_DONE(success=true) → REVERIFY",
      session: { state: "EXECUTING", attemptNumber: 1 },
      event: { type: "EXECUTE_JOB_DONE", success: true },
      expected: { action: "REVERIFY" },
    },
  ```

- [ ] **Step 3: Remove the REFLECTING → REVERIFY test case**

  Delete this block entirely (lines ~54–59):
  ```typescript
    {
      label: "REFLECTING + REFLECT_JOB_DONE → REVERIFY",
      session: { state: "REFLECTING", attemptNumber: 1 },
      event: { type: "REFLECT_JOB_DONE", nextHypothesis: "try reinstalling deps" },
      expected: { action: "REVERIFY" },
    },
  ```

- [ ] **Step 4: Remove the REFLECTING budget test case**

  Delete this block entirely (lines ~126–131):
  ```typescript
    {
      label: "REFLECTING + REFLECT_JOB_DONE with 5 jobs → SURRENDER",
      session: { state: "REFLECTING", attemptNumber: 2, totalJobsSpawned: 5 },
      event: { type: "REFLECT_JOB_DONE", nextHypothesis: "anything" },
      expected: { action: "SURRENDER" },
    },
  ```

- [ ] **Step 5: Update the budget test cases**

  The two existing budget test cases use `totalJobsSpawned: 5` as the trigger. With MAX_JOBS=4, these need to be updated to use `4`:

  Old:
  ```typescript
    {
      label: "ACKED + ACK_SENT with 5 jobs already spawned → SURRENDER",
      session: { state: "ACKED", attemptNumber: 1, totalJobsSpawned: 5 },
      event: { type: "ACK_SENT" },
      expected: { action: "SURRENDER" },
    },
    {
      label: "EXECUTING + EXECUTE_JOB_DONE(success) with 5 jobs → SURRENDER",
      session: { state: "EXECUTING", attemptNumber: 1, totalJobsSpawned: 5 },
      event: { type: "EXECUTE_JOB_DONE", success: true },
      expected: { action: "SURRENDER" },
    },
  ```
  New:
  ```typescript
    {
      label: "ACKED + ACK_SENT with 4 jobs already spawned → SURRENDER",
      session: { state: "ACKED", attemptNumber: 1, totalJobsSpawned: 4 },
      event: { type: "ACK_SENT" },
      expected: { action: "SURRENDER" },
    },
    {
      label: "EXECUTING + EXECUTE_JOB_DONE(success) with 4 jobs → SURRENDER",
      session: { state: "EXECUTING", attemptNumber: 1, totalJobsSpawned: 4 },
      event: { type: "EXECUTE_JOB_DONE", success: true },
      expected: { action: "SURRENDER" },
    },
  ```

  Also update the over-budget test case:
  Old:
  ```typescript
    {
      label: "budget: totalJobsSpawned=6 (over) → SURRENDER regardless",
      session: { state: "IDLE", attemptNumber: 1, totalJobsSpawned: 6 },
      event: { type: "CFR_RECEIVED" },
      expected: { action: "SURRENDER" },
    },
  ```
  New (keep the label honest but the value is still valid — 6 > 4 so it surrenders):
  ```typescript
    {
      label: "budget: totalJobsSpawned=6 (over ceiling of 4) → SURRENDER regardless",
      session: { state: "IDLE", attemptNumber: 1, totalJobsSpawned: 6 },
      event: { type: "CFR_RECEIVED" },
      expected: { action: "SURRENDER" },
    },
  ```

---

## Task 4: Rewrite Budget Test (Commit 1, part D)

**Files:**
- Modify: `packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts`

- [ ] **Step 1: Locate the budget test at line ~178**

  Find the `describe("RecoveryOrchestrator — job budget")` block. The test label is `"no more than 5 automation jobs are spawned across 3 attempts (execute + reflect = 2 per attempt)"`.

- [ ] **Step 2: Rewrite the test**

  Replace the entire describe block:

  Old:
  ```typescript
  describe("RecoveryOrchestrator — job budget", () => {
    it("no more than 5 automation jobs are spawned across 3 attempts (execute + reflect = 2 per attempt)", async () => {
      let spawnCount = 0;
      const spawnAutomation = vi.fn().mockImplementation(async (_spec: AutomationSpec) => {
        spawnCount++;
        return { jobId: `j-${spawnCount}`, automationId: `a-${spawnCount}` };
      });

      const awaitAutomation = vi.fn().mockImplementation(async (jobId: string) => {
        // execute jobs succeed, reflect jobs also succeed
        return { status: "done" } as AutomationResult;
      });

      // Reverify always fails so we iterate
      const mockRegistry = {
        get: vi.fn().mockReturnValue({ status: "available", path: "/fake", provides: "audio-to-text" }),
      } as unknown as CapabilityRegistry;

      const mockWatcher = {
        rescanNow: vi.fn().mockResolvedValue([]),
      } as unknown as CapabilityWatcher;

      // Patch: make reverify fail (capability unavailable from registry.get perspective for actual script)
      // We'll mock the whole registry.get to return something that passes availability but fails script execution
      // by pointing to a nonexistent script path
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

      expect(spawnCount).toBeLessThanOrEqual(5);
    });
  });
  ```

  New:
  ```typescript
  describe("RecoveryOrchestrator — job budget", () => {
    it("no more than 3 automation jobs are spawned across 3 attempts (1 execute job per attempt, no reflect)", async () => {
      let spawnCount = 0;
      const spawnAutomation = vi.fn().mockImplementation(async (_spec: AutomationSpec) => {
        spawnCount++;
        return { jobId: `j-${spawnCount}`, automationId: `a-${spawnCount}` };
      });

      const awaitAutomation = vi.fn().mockImplementation(async (_jobId: string) => {
        // execute jobs succeed but reverify always fails — causes iteration
        return { status: "done" } as AutomationResult;
      });

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
      });

      const orchestrator = new RecoveryOrchestrator(deps);
      await orchestrator.handle(makeFailure());

      // 3 attempts × 1 execute job each = 3 max. Safety ceiling is 4.
      expect(spawnCount).toBeLessThanOrEqual(3);
    });
  });
  ```

---

## Task 5: Run Commit-1 Tests (Gate Before Commit 2)

- [ ] **Step 1: Type-check**

  ```bash
  cd /home/nina/my_agent/packages/core && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 2: Run orchestrator tests**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator
  ```
  Expected: all tests pass. If any test fails due to the removed `REFLECTING` state or types, fix it before proceeding.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/nina/my_agent
  git add packages/core/src/capabilities/orchestrator-state-machine.ts \
          packages/core/src/capabilities/cfr-types.ts \
          packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts \
          packages/core/tests/capabilities/orchestrator/orchestrator-budget.test.ts
  git commit -m "refactor(m9.6-s13): collapse reflect phase — state machine + types"
  ```

---

## Task 6: Delete Reflect Code from Orchestrator (Commit 2, part A)

**Files:**
- Modify: `packages/core/src/capabilities/recovery-orchestrator.ts`

- [ ] **Step 1: Update the file-level docstring**

  Find and replace in the top-level comment block:

  Old:
  ```
   *   3. Spawns an execute-phase automation (Sonnet) per attempt.
   *   4. Spawns a reflect-phase automation (Opus) after each successful execute.
   *   5. Reverifies the fix against the user's actual triggering artifact.
  ```
  New:
  ```
   *   3. Spawns an execute-phase automation (Sonnet) per attempt.
   *   4. Reverifies the fix against the user's actual triggering artifact.
  ```

- [ ] **Step 2: Update the runOneAttempt docstring**

  Find:
  ```typescript
    /**
     * Run one execute+reflect+reverify cycle.
     * Returns { recovered: true, recoveredContent } on success, or { recovered: false } on failure.
     */
  ```
  Replace with:
  ```typescript
    /**
     * Run one execute+reverify cycle.
     * Returns { recovered: true, recoveredContent } on success, or { recovered: false } on failure.
     */
  ```

- [ ] **Step 3: Replace the reflect spawn block with a direct doReverify call**

  The block to remove starts after `session.attempts.push(executeAttempt)` (where execute succeeded) and ends at the final `return await this.doReverify(...)`. Replace the entire block:

  Old (from just after `session.attempts.push(executeAttempt);`):
  ```typescript
      session.state = "REFLECTING";
      nextAction(session, { type: "EXECUTE_JOB_DONE", success: true });

      // Budget check before spawning reflect job
      if (session.totalJobsSpawned >= 5) {
        // Budget exhausted — still attempt reverify without reflect. If the
        // reverify passes, we recover normally; if it fails, runFixLoop will
        // drop through to surrender — tag the reason here so surrender picks
        // the "budget" copy rather than "iteration-3".
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
        // Still attempt reverify — execute may have been sufficient
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

      // Update the execute attempt with the next hypothesis from reflect
      executeAttempt.nextHypothesis = nextHypothesis;

      return await this.doReverify(failure, session, executeAttempt);
    }
  ```

  New (replace all of the above):
  ```typescript
      session.state = "REVERIFYING";
      nextAction(session, { type: "EXECUTE_JOB_DONE", success: true });

      return await this.doReverify(failure, session, executeAttempt);
    }
  ```

- [ ] **Step 4: Update the pre-execute budget cap from 5 to 4**

  Find in `runOneAttempt`, the budget check before the execute spawn:

  Old:
  ```typescript
      if (session.totalJobsSpawned >= 5) {
        session.surrenderReason = "budget";
        return { recovered: false };
      }
  ```
  New:
  ```typescript
      if (session.totalJobsSpawned >= 4) {
        session.surrenderReason = "budget";
        return { recovered: false };
      }
  ```

- [ ] **Step 5: Remove the dead REFLECT_JOB_DONE event and reflectJobId field**

  In `packages/core/src/capabilities/orchestrator-state-machine.ts`, remove the two items kept alive for compile safety in Commit 1:

  Remove from `OrchestratorEvent`:
  ```typescript
    // REFLECT_JOB_DONE: dead after S13 — removed with renderReflectPrompt in the orchestrator commit
    | { type: "REFLECT_JOB_DONE"; nextHypothesis: string }
  ```

  Remove from `FixSession`:
  ```typescript
    // reflectJobId: dead after S13 — removed with the reflect spawn code in the orchestrator commit
    reflectJobId?: string;
  ```

  Update the file comment to drop the "dead after this commit" note:
  ```typescript
   * M9.6-S13: reflect phase removed; EXECUTING success goes directly to REVERIFY.
  ```

- [ ] **Step 6: Delete the renderReflectPrompt method**

  Delete the entire `renderReflectPrompt` method. It starts at the comment:
  ```typescript
    /**
     * Render the reflect-phase prompt — Opus summarises what happened and proposes a better hypothesis.
     */
    private renderReflectPrompt(
  ```
  ...and ends at the closing `}` of the method (before the `}` that closes the class), which is approximately:
  ```typescript
      return `# Reflect — ${capabilityType} Fix Attempt ${session.attemptNumber}
  ...
      Body: reasoning about what the execute agent did and what should be tried next.\``;
    }
  ```

  Delete the entire method from the doc-comment through the closing brace.

---

## Task 7: Verify Zero Reflect References + Final Checks (Commit 2)

- [ ] **Step 1: Verify no reflect references remain in production capability code**

  ```bash
  rg -i 'reflect' /home/nina/my_agent/packages/core/src/capabilities/
  ```
  Expected: **zero hits**. If any match appears, investigate and remove.

- [ ] **Step 2: Type-check both packages**

  ```bash
  cd /home/nina/my_agent/packages/core && npx tsc --noEmit
  cd /home/nina/my_agent/packages/dashboard && npx tsc --noEmit
  ```
  Expected: zero errors in both. Common issue: if any code still references `FixSession.reflectJobId` or `SPAWN_REFLECT_JOB`, it will fail here.

- [ ] **Step 3: Run full orchestrator test suite**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator
  ```
  Expected: all tests pass.

- [ ] **Step 4: Run CFR phase regression**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities
  ```
  Expected: pass. The pre-existing `integration.test.ts` MCP-spawn flake (Connection closed, predates S13) is not in scope — note its presence but do not investigate.

- [ ] **Step 7: Commit**

  ```bash
  cd /home/nina/my_agent
  git add packages/core/src/capabilities/recovery-orchestrator.ts \
          packages/core/src/capabilities/orchestrator-state-machine.ts
  git commit -m "refactor(m9.6-s13): collapse reflect phase — orchestrator behavior"
  ```

---

## Task 8: Acceptance Verification

- [ ] **Step 1: Confirm the acceptance grep**

  ```bash
  rg 'reflect' /home/nina/my_agent/packages/core/src/capabilities/
  ```
  Expected: zero production hits. Test files may still mention "reflect" in comments — those are fine. Only `src/capabilities/` must be clean.

- [ ] **Step 2: Audit orchestrator-timing.test.ts for reflect**

  ```bash
  rg -i 'reflect' /home/nina/my_agent/packages/core/tests/capabilities/orchestrator/orchestrator-timing.test.ts
  ```
  Expected: zero hits (timing tests don't touch reflect; confirm nothing slipped in).

- [ ] **Step 3: Final full vitest run**

  ```bash
  cd /home/nina/my_agent/packages/core && npx vitest run tests/capabilities/orchestrator
  ```
  Confirm pass. Record test counts in `s13-test-report.md`.

---

## Sprint Artifacts Checklist

- [ ] `docs/sprints/m9.6-capability-resilience/s13-plan.md` — this file
- [ ] `docs/sprints/m9.6-capability-resilience/s13-DECISIONS.md` — create if any non-trivial decision is made during execution
- [ ] `docs/sprints/m9.6-capability-resilience/s13-DEVIATIONS.md` — create if any deviation from this plan occurs
- [ ] `docs/sprints/m9.6-capability-resilience/s13-test-report.md` — created by external reviewer
- [ ] `docs/sprints/m9.6-capability-resilience/s13-review.md` — created by external reviewer
