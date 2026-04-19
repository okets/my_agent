# M9.6-S16: Fix-engine swap to `capability-brainstorming` fix-mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Sonnet+reflect two-job fix path with a single Opus `capability-brainstorming` fix-mode invocation; add `ESCALATE:` marker handling; measure wall-time.

**Architecture:** The orchestrator's `renderPrompt` is replaced by `buildFixModeInvocation` which emits a `MODE: FIX`-prefixed prompt. The `capability-brainstorming` SKILL.md gains a `Step 0: Mode check` that routes `MODE: FIX` prompts to a self-contained fix path, bypassing all authoring-flow steps. `ESCALATE:` markers in the deliverable signal immediate surrender without further attempts. `targetPath` threads from `AutomationSpec` through `app.ts` to `automation-executor.ts`'s `writePaperTrail`.

**Tech Stack:** TypeScript, Vitest, Node.js, packages/core + packages/dashboard.

**Spec:** `docs/sprints/m9.6-capability-resilience/plan-phase3-refinements.md §2.1`

**Phase 2 pre-condition:** S15 architect-approved and merged to master. Verify before starting.

---

## ARCHITECT REVIEW (2026-04-19) — required corrections before start

The Phase 3 architect (Opus 4.7) reviewed v0 of this plan. The TDD structure and code-path mapping are strong, but four required corrections (R1–R4) and two deviation-decisions (S1–S2) must be addressed before the dev starts. All inline edits are marked `[ARCHITECT R#]` or `[ARCHITECT S#]` in the task sections below.

| Tag | What was missing | Where it landed |
|-----|------------------|-----------------|
| **R1** | Wall-time measurement is a gate, not just a script. Plan-phase3 §2.1 / design §6.3 require an actual run + a decision. v0 stopped at the script. | New Task 12 (wall-time measurement run + decision gate) |
| **R2** | Sprint artifacts incomplete per §0.3: `s16-DEVIATIONS.md`, `s16-FOLLOW-UPS.md`, `s16-test-report.md` not authored; CTO notification + "do NOT touch ROADMAP" reminder absent. Phase 2 had three sprints hit the premature-ROADMAP-done anti-pattern; do not repeat. | New Task 13 (sprint artifacts + notification) |
| **R3** | `capability-brainstorming-gate.test.ts` only asserts Step 0 *exists*, not that authoring-mode Steps 1-6 *survived* the edit. Insert that accidentally clobbers the file would not be caught. | Task 7 Step 1 — added Step 1-6 regression assertions |
| **R4** | Sibling-skill Option B (separate `capability-fixing` skill) escape hatch not documented. Phase 3 plan §4 design map names this as an S16 deliverable. | Task 9 — D6 added to DECISIONS.md |
| **S1** | `fix-mode-integration.test.ts` doesn't assert the spec's "no nested `create_automation`" or "paper trail appended via `writePaperTrail`". At unit-test scope, writePaperTrail is called by the automation framework, not the orchestrator — genuine integration-depth limit. | Task 6 — choose: expand mocks **or** file `proposals/s16-integration-test-scope.md` |
| **S2** | `capability-brainstorming-gate.test.ts` is text-coverage, not behavior-coverage. Behavior verification requires real skill invocation (lands in S20 exit gate). | Task 7 — file `proposals/s16-skill-gate-test-scope.md` naming the substitution explicitly |

### Sprint-time verification items (dev should grep before writing the named code)

These are not corrections to the plan — they are facts the dev should confirm at sprint-time before relying on assumed signatures or shapes:

- **`this.surrender(session, failure)` call in Task 4 Step 4.** The existing orchestrator may not have a 2-arg `surrender(...)` method — Phase 1/2 may use `terminalDrain(...)` or a different shape. Grep `private (surrender|terminalDrain|recordSurrender)` in `recovery-orchestrator.ts` first. If the call shape differs, adjust Task 4 Step 4 accordingly.
- **`Capability.path` shape** (Task 9 D3). Task 9 D3 assumes `cap.path` is absolute. Confirm: `grep -n "path:" packages/core/src/capabilities/types.ts`. If relative, `path.resolve(agentDir, "..", targetPath)` math needs revisiting in `automation-executor.ts`.
- **`renderPrompt` callers.** Task 3 Step 3c renames `renderPrompt` → `buildFixModeInvocation`. Confirm zero other callers: `grep -rn "renderPrompt\b" packages/core/src/`. If anything else calls it, rename in two phases or keep both temporarily.

---

## Files changed

| File | Action | What |
|------|--------|------|
| `packages/core/src/capabilities/orchestrator-state-machine.ts` | Modify | Extend `surrenderReason` union on `FixSession` |
| `packages/core/src/capabilities/recovery-orchestrator.ts` | Modify | `AutomationSpec.targetPath`; new `AckKind` values; `JOB_TIMEOUT_MS` 15 min; `buildFixModeInvocation`; ESCALATE handling; `terminalAckKind` logic |
| `packages/core/src/capabilities/resilience-messages.ts` | Modify | Extend `SurrenderReason`; add redesign-needed + insufficient-context copy |
| `packages/dashboard/src/app.ts` | Modify | Pass `target_path: spec.targetPath` in `spawnAutomation` manifest |
| `packages/dashboard/src/app.ts` | Modify | Add `surrender-redesign-needed` / `surrender-insufficient-context` branches in `emitAck` |
| `packages/core/src/capabilities/prompts/fix-automation.md` | Modify | Add deprecation notice atop |
| `packages/core/skills/capability-brainstorming/SKILL.md` | Modify | Insert `## Step 0: Mode check` before existing content; add neutral-identifier convention to Step 5 |
| `packages/core/tests/capabilities/resilience-messages-new-reasons.test.ts` | Create | Copy for redesign-needed + insufficient-context |
| `packages/core/tests/capabilities/fix-mode-invocation.test.ts` | Create | Prompt format, model, targetPath |
| `packages/core/tests/capabilities/fix-mode-escalate.test.ts` | Create | ESCALATE marker → immediate surrender |
| `packages/core/tests/capabilities/fix-mode-integration.test.ts` | Create | Stub plug, targetPath flows to spec, ≤3 spawns |
| `packages/core/tests/capabilities/capability-brainstorming-gate.test.ts` | Create | SKILL.md has Step 0 structure |
| `docs/sprints/m9.6-capability-resilience/s16-DECISIONS.md` | Create | Write-guard status + sprint decisions (incl. D6 Option B per ARCHITECT R4) |
| `scripts/measure-fix-mode-walltime.js` | Create | Wall-time gate script |
| `docs/sprints/m9.6-capability-resilience/s16-walltime-results.md` | Create + Fill | Template (Task 10) + actual results filled in (Task 12) per ARCHITECT R1 |
| `docs/sprints/m9.6-capability-resilience/s16-DEVIATIONS.md` | Create | Sprint deviations index (incl. S1/S2 proposals if filed) per ARCHITECT R2 |
| `docs/sprints/m9.6-capability-resilience/s16-FOLLOW-UPS.md` | Create | Out-of-scope follow-ups noticed during the sprint per ARCHITECT R2 |
| `docs/sprints/m9.6-capability-resilience/s16-test-report.md` | Create | Verification command output per ARCHITECT R2 |
| `docs/sprints/m9.6-capability-resilience/proposals/s16-integration-test-scope.md` | Conditional Create | Per ARCHITECT S1 — only if Task 6 chooses the deviation route |
| `docs/sprints/m9.6-capability-resilience/proposals/s16-skill-gate-test-scope.md` | Create | Per ARCHITECT S2 — text-coverage substitution naming |
| `docs/sprints/m9.6-capability-resilience/proposals/s16-walltime-mitigation.md` | Conditional Create | Per ARCHITECT R1 — only if wall-time falls in 5–10 min band |

---

## Task 1: Extend types — `surrenderReason`, `AckKind`, `AutomationSpec`, `SurrenderReason`

These are prerequisite type changes. `tsc --noEmit` is the test. No vitest tests for types alone.

**Files:**
- Modify: `packages/core/src/capabilities/orchestrator-state-machine.ts:46`
- Modify: `packages/core/src/capabilities/recovery-orchestrator.ts:35,37-44,72`
- Modify: `packages/core/src/capabilities/resilience-messages.ts:17`

- [ ] **Step 1: Extend `surrenderReason` on `FixSession` in `orchestrator-state-machine.ts`**

  Current line 46:
  ```typescript
  surrenderReason?: "budget" | "iteration-3";
  ```

  Replace with:
  ```typescript
  surrenderReason?: "budget" | "iteration-3" | "redesign-needed" | "insufficient-context";
  ```

- [ ] **Step 2: Add `targetPath` to `AutomationSpec` and new `AckKind` values in `recovery-orchestrator.ts`**

  Current line 35:
  ```typescript
  export type AckKind = "attempt" | "status" | "surrender" | "surrender-budget" | "surrender-cooldown" | "terminal-fixed";
  ```
  Replace with:
  ```typescript
  export type AckKind = "attempt" | "status" | "surrender" | "surrender-budget" | "surrender-cooldown" | "terminal-fixed" | "surrender-redesign-needed" | "surrender-insufficient-context";
  ```

  Current `AutomationSpec` (lines 37–44):
  ```typescript
  export interface AutomationSpec {
    name: string;
    model: "opus" | "sonnet";
    autonomy: "cautious" | "standard";
    prompt: string;
    jobType: "capability_modify";
    parent?: { jobId: string; iteration: number };
  }
  ```
  Replace with:
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

  Current line 72 inside `writeAutomationRecovery` args:
  ```typescript
  session: { attempts: FixAttempt[]; surrenderReason?: "budget" | "iteration-3" };
  ```
  Replace with:
  ```typescript
  session: { attempts: FixAttempt[]; surrenderReason?: "budget" | "iteration-3" | "redesign-needed" | "insufficient-context" };
  ```

- [ ] **Step 3: Extend `SurrenderReason` in `resilience-messages.ts`**

  Current line 17:
  ```typescript
  export type SurrenderReason = "budget" | "iteration-3" | "surrender-cooldown";
  ```
  Replace with:
  ```typescript
  export type SurrenderReason = "budget" | "iteration-3" | "surrender-cooldown" | "redesign-needed" | "insufficient-context";
  ```

- [ ] **Step 4: Verify tsc is clean**

  ```bash
  cd packages/core && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/core/src/capabilities/orchestrator-state-machine.ts \
          packages/core/src/capabilities/recovery-orchestrator.ts \
          packages/core/src/capabilities/resilience-messages.ts
  git commit -m "types(m9.6-s16): extend surrender/ack types for fix-mode escalate paths"
  ```

---

## Task 2 (TDD): New surrender copy — `redesign-needed` and `insufficient-context`

**Files:**
- Create: `packages/core/tests/capabilities/resilience-messages-new-reasons.test.ts`
- Modify: `packages/core/src/capabilities/resilience-messages.ts`

- [ ] **Step 1: Write the failing test**

  Create `packages/core/tests/capabilities/resilience-messages-new-reasons.test.ts`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { createResilienceCopy } from "../../src/capabilities/resilience-messages.js";
  import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";
  import { conversationOrigin } from "../../src/capabilities/cfr-helpers.js";
  import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

  function makeStubRegistry(): CapabilityRegistry {
    return {
      isMultiInstance: () => false,
      getFallbackAction: () => "could you resend as text",
    } as unknown as CapabilityRegistry;
  }

  function failure(capabilityType: string): CapabilityFailure {
    return {
      id: "f-1",
      capabilityType,
      symptom: "execution-error",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-1", sender: "+100" },
          "conv-A",
          1,
        ),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: "2026-04-19T00:00:00.000Z",
    };
  }

  describe("createResilienceCopy — redesign-needed", () => {
    const copy = createResilienceCopy(makeStubRegistry());

    it("audio-to-text renders redesign-needed copy with fallback action", () => {
      expect(copy.surrender(failure("audio-to-text"), "redesign-needed")).toBe(
        "I tried to fix voice transcription but the design needs a bigger rework — I've flagged it, could you resend as text for now.",
      );
    });

    it("unknown type uses raw type name in redesign-needed copy", () => {
      expect(copy.surrender(failure("custom-plug"), "redesign-needed")).toBe(
        "I tried to fix custom-plug but the design needs a bigger rework — I've flagged it, could you resend as text for now.",
      );
    });
  });

  describe("createResilienceCopy — insufficient-context", () => {
    const copy = createResilienceCopy(makeStubRegistry());

    it("audio-to-text renders insufficient-context copy with fallback action", () => {
      expect(copy.surrender(failure("audio-to-text"), "insufficient-context")).toBe(
        "I couldn't fix voice transcription — I didn't have enough to go on. could you resend as text.",
      );
    });

    it("unknown type uses raw type name in insufficient-context copy", () => {
      expect(copy.surrender(failure("custom-plug"), "insufficient-context")).toBe(
        "I couldn't fix custom-plug — I didn't have enough to go on. could you resend as text.",
      );
    });
  });
  ```

- [ ] **Step 2: Run to confirm it fails**

  ```bash
  cd packages/core && npx vitest run tests/capabilities/resilience-messages-new-reasons
  ```
  Expected: FAIL — `SurrenderReason` doesn't include the new values yet (or `surrender()` lacks the cases).

- [ ] **Step 3: Add new surrender cases to `resilience-messages.ts`**

  In `packages/core/src/capabilities/resilience-messages.ts`, inside `createResilienceCopy`, locate the `surrender` method. After the existing `if (reason === "surrender-cooldown")` block and before the `// iteration-3` comment, insert:

  ```typescript
  if (reason === "redesign-needed") {
    return `I tried to fix ${name}${suffix} but the design needs a bigger rework — I've flagged it, ${fallback} for now.`;
  }
  if (reason === "insufficient-context") {
    return `I couldn't fix ${name}${suffix} — I didn't have enough to go on. ${fallback}.`;
  }
  ```

  Full `surrender` method after the change:
  ```typescript
  surrender(failure: CapabilityFailure, reason: SurrenderReason): string {
    const name = friendlyName(failure.capabilityType);
    const suffix = instanceSuffix(failure, registry);
    const fallback = registry.getFallbackAction(failure.capabilityType);

    if (reason === "budget") {
      return `I've hit the fix budget for this turn. ${fallback} while I look into it? I've logged the issue.`;
    }
    if (reason === "surrender-cooldown") {
      return `I already tried fixing ${name}${suffix} recently — ${fallback} for now. I've logged it.`;
    }
    if (reason === "redesign-needed") {
      return `I tried to fix ${name}${suffix} but the design needs a bigger rework — I've flagged it, ${fallback} for now.`;
    }
    if (reason === "insufficient-context") {
      return `I couldn't fix ${name}${suffix} — I didn't have enough to go on. ${fallback}.`;
    }
    // iteration-3
    return `I tried three fixes and ${name}${suffix} isn't working today. ${fallback}? I've logged the issue.`;
  },
  ```

- [ ] **Step 4: Run to confirm it passes**

  ```bash
  cd packages/core && npx vitest run tests/capabilities/resilience-messages-new-reasons
  ```
  Expected: PASS — 4 tests.

- [ ] **Step 5: Verify tsc still clean**

  ```bash
  cd packages/core && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core/src/capabilities/resilience-messages.ts \
          packages/core/tests/capabilities/resilience-messages-new-reasons.test.ts
  git commit -m "feat(m9.6-s16): add redesign-needed + insufficient-context surrender copy"
  ```

---

## Task 3 (TDD): `buildFixModeInvocation` — fix-mode prompt, opus model, targetPath, 15 min timeout

**Files:**
- Create: `packages/core/tests/capabilities/fix-mode-invocation.test.ts`
- Modify: `packages/core/src/capabilities/recovery-orchestrator.ts`

- [ ] **Step 1: Write the failing test**

  Create `packages/core/tests/capabilities/fix-mode-invocation.test.ts`:

  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
  import type { OrchestratorDeps, AutomationSpec } from "../../../src/capabilities/recovery-orchestrator.js";
  import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";
  import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
  import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
  import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

  const CAP_PATH = ".my_agent/capabilities/stt-deepgram";

  function makeFailure(): CapabilityFailure {
    return {
      id: "f-1",
      capabilityType: "audio-to-text",
      capabilityName: "stt-deepgram",
      symptom: "execution-error",
      detail: "exit code 1",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
          "conv-A",
          1,
        ),
        artifact: { type: "audio", rawMediaPath: "/tmp/test.ogg", mimeType: "audio/ogg" },
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };
  }

  function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
    const mockRegistry = {
      get: vi.fn().mockReturnValue({ name: "stt-deepgram", path: CAP_PATH, status: "unavailable" }),
      isMultiInstance: vi.fn().mockReturnValue(false),
      getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
    } as unknown as CapabilityRegistry;
    const mockWatcher = { rescanNow: vi.fn().mockResolvedValue([]) } as unknown as CapabilityWatcher;
    return {
      spawnAutomation: vi.fn().mockRejectedValue(new Error("spawn not expected")),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      getJobRunDir: vi.fn().mockReturnValue(null),
      capabilityRegistry: mockRegistry,
      watcher: mockWatcher,
      emitAck: vi.fn().mockResolvedValue(undefined),
      reprocessTurn: vi.fn().mockResolvedValue(undefined),
      now: () => new Date().toISOString(),
      ...overrides,
    };
  }

  describe("fix-mode-invocation — buildFixModeInvocation", () => {
    it("spawned prompt starts with MODE: FIX", async () => {
      const captured: AutomationSpec[] = [];
      const deps = makeDeps({
        spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
          captured.push(spec);
          return { jobId: "j-1", automationId: "a-1" };
        }),
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(captured.length).toBeGreaterThan(0);
      expect(captured[0].prompt.trimStart()).toMatch(/^MODE: FIX/);
    });

    it("prompt does not contain fix-automation template text", async () => {
      const captured: AutomationSpec[] = [];
      const deps = makeDeps({
        spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
          captured.push(spec);
          return { jobId: "j-1", automationId: "a-1" };
        }),
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      // Old template anchor text
      expect(captured[0].prompt).not.toContain("Fix Automation —");
    });

    it("prompt carries capability folder path", async () => {
      const captured: AutomationSpec[] = [];
      const deps = makeDeps({
        spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
          captured.push(spec);
          return { jobId: "j-1", automationId: "a-1" };
        }),
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(captured[0].prompt).toContain(CAP_PATH);
    });

    it("spec.model is opus", async () => {
      const captured: AutomationSpec[] = [];
      const deps = makeDeps({
        spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
          captured.push(spec);
          return { jobId: "j-1", automationId: "a-1" };
        }),
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(captured[0].model).toBe("opus");
    });

    it("spec.targetPath equals cap.path from registry", async () => {
      const captured: AutomationSpec[] = [];
      const deps = makeDeps({
        spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
          captured.push(spec);
          return { jobId: "j-1", automationId: "a-1" };
        }),
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(captured[0].targetPath).toBe(CAP_PATH);
    });

    it("spec.targetPath is undefined when registry has no cap for the type", async () => {
      const captured: AutomationSpec[] = [];
      const registryWithNoMatch = {
        get: vi.fn().mockReturnValue(undefined),
        isMultiInstance: vi.fn().mockReturnValue(false),
        getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
      } as unknown as CapabilityRegistry;
      const deps = makeDeps({
        capabilityRegistry: registryWithNoMatch,
        spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
          captured.push(spec);
          return { jobId: "j-1", automationId: "a-1" };
        }),
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(captured[0].targetPath).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run to confirm it fails**

  ```bash
  cd packages/core && npx vitest run tests/capabilities/fix-mode-invocation
  ```
  Expected: FAIL — prompt still starts with "# Fix Automation", model is still `"sonnet"`, no `targetPath`.

- [ ] **Step 3: Implement `buildFixModeInvocation`, update `spawnAutomation` call, raise timeout**

  In `packages/core/src/capabilities/recovery-orchestrator.ts`:

  **3a. Raise `JOB_TIMEOUT_MS` (line 80):**
  ```typescript
  const JOB_TIMEOUT_MS = 15 * 60 * 1000;
  ```

  **3b. In `runOneAttempt`, replace the `renderPrompt` call and the `spawnAutomation` spec:**

  Current lines 353–383 (within `runOneAttempt`, before the budget check):
  ```typescript
  const executePrompt = this.renderPrompt(failure, session);

  // Budget check before spawning execute job ...
  if (session.totalJobsSpawned >= 5) { ... }

  // Spawn execute-phase automation (Sonnet)
  let executeJobId: string;
  let executeAutomationId: string;
  try {
    const spawned = await this.deps.spawnAutomation({
      name: `cfr-fix-${failure.capabilityType}-a${session.attemptNumber}-exec-${randomUUID().slice(0, 8)}`,
      model: "sonnet",
      autonomy: "standard",
      prompt: executePrompt,
      jobType: "capability_modify",
      parent: session.executeJobId
        ? { jobId: session.executeJobId, iteration: session.attemptNumber }
        : undefined,
    });
  ```

  Replace the prompt variable declaration line and the `model`/`prompt`/no-`targetPath` spawn spec with:
  ```typescript
  const cap = this.deps.capabilityRegistry.get(failure.capabilityType);
  const fixPrompt = this.buildFixModeInvocation(failure, session, cap?.path);

  // Budget check before spawning execute job (M9.6-S6 D3: tag the session so
  // surrender() knows this was a budget-exhaustion bail, not a 3-attempts bail).
  if (session.totalJobsSpawned >= 5) {
    session.surrenderReason = "budget";
    return { recovered: false };
  }

  // Spawn fix-mode automation (Opus — fix-mode uses capability-brainstorming skill)
  let executeJobId: string;
  let executeAutomationId: string;
  try {
    const spawned = await this.deps.spawnAutomation({
      name: `cfr-fix-${failure.capabilityType}-a${session.attemptNumber}-exec-${randomUUID().slice(0, 8)}`,
      model: "opus",
      autonomy: "standard",
      prompt: fixPrompt,
      jobType: "capability_modify",
      targetPath: cap?.path,
      parent: session.executeJobId
        ? { jobId: session.executeJobId, iteration: session.attemptNumber }
        : undefined,
    });
  ```

  **3c. Rename `renderPrompt` to `buildFixModeInvocation` and replace its body:**

  Locate the private `renderPrompt` method (currently around line 704). Replace the entire method with:

  ```typescript
  /**
   * Build the fix-mode invocation prompt for the capability-brainstorming skill.
   * Prompt begins with "MODE: FIX" so Step 0 of the skill routes to fix-only path.
   * Cold Opus run on an unfamiliar plug is projected at 5–12 min — JOB_TIMEOUT_MS is 15 min.
   */
  private buildFixModeInvocation(
    failure: CapabilityFailure,
    session: FixSession,
    capPath: string | undefined,
  ): string {
    const { capabilityType, capabilityName, symptom, detail, previousAttempts } = failure;

    const previousAttemptsTable =
      previousAttempts.length === 0 && session.attempts.length === 0
        ? "_No previous attempts._"
        : [...previousAttempts, ...session.attempts]
            .map(
              (a) =>
                `| ${a.attempt} | ${a.hypothesis} | ${a.verificationResult} | ${a.failureMode ?? "—"} |`,
            )
            .join("\n");

    const attemptsSection =
      previousAttempts.length === 0 && session.attempts.length === 0
        ? "_No previous attempts._"
        : `| Attempt | Hypothesis | Result | Failure mode |\n|---|---|---|---|\n${previousAttemptsTable}`;

    const capDirLine = capPath
      ? `- **Capability folder:** \`${capPath}\``
      : `- **Capability folder:** (not found in registry — use \`.my_agent/capabilities/${capabilityName ?? capabilityType}\` if it exists)`;

    return `MODE: FIX

You have been invoked by the recovery orchestrator because a capability failed.

## Failure Context

${capDirLine}
- **Capability:** ${capabilityName ?? capabilityType} (type: ${capabilityType})
- **Symptom:** ${symptom}
- **Detail:** ${detail ?? "—"}
- **Attempt:** ${session.attemptNumber}/3

## Previous Attempts

${attemptsSection}`;
  }
  ```

- [ ] **Step 4: Run to confirm it passes**

  ```bash
  cd packages/core && npx vitest run tests/capabilities/fix-mode-invocation
  ```
  Expected: PASS — 6 tests.

- [ ] **Step 5: Verify tsc clean**

  ```bash
  cd packages/core && npx tsc --noEmit
  ```
  Expected: no errors. If tsc complains about `renderPrompt` missing, confirm you renamed it completely and there are no other callers. (The only caller is `runOneAttempt` — now uses `buildFixModeInvocation`.)

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core/src/capabilities/recovery-orchestrator.ts \
          packages/core/tests/capabilities/fix-mode-invocation.test.ts
  git commit -m "feat(m9.6-s16): buildFixModeInvocation — MODE:FIX prompt, opus model, 15-min timeout"
  ```

---

## Task 4 (TDD): ESCALATE marker handling — skip reverify, surrender immediately

**Files:**
- Create: `packages/core/tests/capabilities/fix-mode-escalate.test.ts`
- Modify: `packages/core/src/capabilities/recovery-orchestrator.ts`

- [ ] **Step 1: Write the failing test**

  Create `packages/core/tests/capabilities/fix-mode-escalate.test.ts`:

  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { mkdtempSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import { tmpdir } from "node:os";
  import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
  import type { OrchestratorDeps } from "../../../src/capabilities/recovery-orchestrator.js";
  import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";
  import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
  import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
  import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

  function makeFailure(): CapabilityFailure {
    return {
      id: "f-1",
      capabilityType: "audio-to-text",
      capabilityName: "stt-deepgram",
      symptom: "execution-error",
      detail: "exit code 1",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
          "conv-A",
          1,
        ),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };
  }

  function makeRunDir(deliverableBody: string): string {
    const dir = mkdtempSync(join(tmpdir(), "cfr-escalate-"));
    const frontmatter = `---\nchange_type: script\ntest_result: fail\nhypothesis_confirmed: false\nsummary: escalating\n---\n`;
    writeFileSync(join(dir, "deliverable.md"), frontmatter + deliverableBody);
    return dir;
  }

  function makeDeps(runDir: string, overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
    const mockRegistry = {
      get: vi.fn().mockReturnValue(undefined),
      isMultiInstance: vi.fn().mockReturnValue(false),
      getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
    } as unknown as CapabilityRegistry;
    const mockWatcher = { rescanNow: vi.fn().mockResolvedValue([]) } as unknown as CapabilityWatcher;
    return {
      spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "done" }),
      getJobRunDir: vi.fn().mockReturnValue(runDir),
      capabilityRegistry: mockRegistry,
      watcher: mockWatcher,
      emitAck: vi.fn().mockResolvedValue(undefined),
      reprocessTurn: vi.fn().mockResolvedValue(undefined),
      now: () => new Date().toISOString(),
      ...overrides,
    };
  }

  describe("ESCALATE: redesign-needed", () => {
    it("stops after one spawn — no second or third attempt", async () => {
      const runDir = makeRunDir("ESCALATE: redesign-needed\n\nNeeds bigger rework.");
      const spawnAutomation = vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" });
      const deps = makeDeps(runDir, { spawnAutomation });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(spawnAutomation.mock.calls.length).toBe(1);
    });

    it("emits surrender-redesign-needed ack", async () => {
      const runDir = makeRunDir("ESCALATE: redesign-needed");
      const emitAck = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps(runDir, { emitAck });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      const surrenderKinds = emitAck.mock.calls
        .map((c: unknown[]) => c[1] as string)
        .filter((k) => k.startsWith("surrender"));
      expect(surrenderKinds).toContain("surrender-redesign-needed");
    });

    it("skips reverify — watcher.rescanNow not called", async () => {
      const runDir = makeRunDir("ESCALATE: redesign-needed");
      const mockWatcher = { rescanNow: vi.fn().mockResolvedValue([]) } as unknown as CapabilityWatcher;
      const mockRegistry = {
        get: vi.fn().mockReturnValue(undefined),
        isMultiInstance: vi.fn().mockReturnValue(false),
        getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
      } as unknown as CapabilityRegistry;
      const deps = makeDeps(runDir, { watcher: mockWatcher, capabilityRegistry: mockRegistry });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(mockWatcher.rescanNow).not.toHaveBeenCalled();
    });
  });

  describe("ESCALATE: insufficient-context", () => {
    it("stops after one spawn", async () => {
      const runDir = makeRunDir("ESCALATE: insufficient-context\n\nNot enough info.");
      const spawnAutomation = vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" });
      const deps = makeDeps(runDir, { spawnAutomation });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(spawnAutomation.mock.calls.length).toBe(1);
    });

    it("emits surrender-insufficient-context ack", async () => {
      const runDir = makeRunDir("ESCALATE: insufficient-context");
      const emitAck = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps(runDir, { emitAck });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      const surrenderKinds = emitAck.mock.calls
        .map((c: unknown[]) => c[1] as string)
        .filter((k) => k.startsWith("surrender"));
      expect(surrenderKinds).toContain("surrender-insufficient-context");
    });
  });

  describe("non-ESCALATE deliverable — no early bail", () => {
    it("proceeds to second attempt when deliverable has no ESCALATE marker", async () => {
      const runDir = makeRunDir("Tried patching config. Still failing.");
      const spawnAutomation = vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" });
      const deps = makeDeps(runDir, {
        spawnAutomation,
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      // 3 attempts → 3 spawns (fix-mode has no reflect spawn)
      expect(spawnAutomation.mock.calls.length).toBe(3);
    });
  });
  ```

- [ ] **Step 2: Run to confirm it fails**

  ```bash
  cd packages/core && npx vitest run tests/capabilities/fix-mode-escalate
  ```
  Expected: FAIL — no ESCALATE handling exists yet; `surrender-redesign-needed` ack kind never fires; all 3 attempts still run.

- [ ] **Step 3: Add ESCALATE check to `runOneAttempt`**

  In `packages/core/src/capabilities/recovery-orchestrator.ts`, the private `runOneAttempt` method returns `{ recovered: boolean; recoveredContent?: string }`. Change the return type to also allow an `escalate` flag:

  Find the private method signature (around line 346):
  ```typescript
  private async runOneAttempt(
    session: FixSession,
    failure: CapabilityFailure,
  ): Promise<{ recovered: boolean; recoveredContent?: string }> {
  ```
  Replace with:
  ```typescript
  private async runOneAttempt(
    session: FixSession,
    failure: CapabilityFailure,
  ): Promise<{ recovered: boolean; recoveredContent?: string; escalate?: boolean }> {
  ```

  Then find the block after `const deliverable = this.readDeliverable(executeJobId);` (currently reads hypothesis and change on the next two lines). After those two lines, insert the ESCALATE check:

  ```typescript
  const deliverable = this.readDeliverable(executeJobId);
  const hypothesis = deliverable?.frontmatter.summary ?? "(no deliverable)";
  const change = deliverable?.body.slice(0, 500) ?? "";

  // ESCALATE: marker — fix-mode signals that the problem requires redesign or lacks context.
  // Skip reverify and remaining attempts; surrender immediately with the appropriate reason.
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

- [ ] **Step 4: Handle `escalate` in `runFixLoop`**

  In `runFixLoop`, the while-loop calls `runOneAttempt` and checks `attemptResult.recovered`. Add an escalate check immediately after:

  ```typescript
  const attemptResult = await this.runOneAttempt(session, failure);

  if (attemptResult.escalate) {
    // ESCALATE: marker — skip remaining attempts and surrender with the pre-set reason.
    await this.surrender(session, failure);
    return;
  }
  ```

- [ ] **Step 5: Extend `terminalAckKind` in `terminalDrain` for new surrender reasons**

  Find lines 594–595 in `terminalDrain`:
  ```typescript
  const terminalAckKind: AckKind =
    session.surrenderReason === "budget" ? "surrender-budget" : "surrender";
  ```
  Replace with:
  ```typescript
  const terminalAckKind: AckKind =
    session.surrenderReason === "budget" ? "surrender-budget" :
    session.surrenderReason === "redesign-needed" ? "surrender-redesign-needed" :
    session.surrenderReason === "insufficient-context" ? "surrender-insufficient-context" :
    "surrender";
  ```

- [ ] **Step 6: Run to confirm it passes**

  ```bash
  cd packages/core && npx vitest run tests/capabilities/fix-mode-escalate
  ```
  Expected: PASS — 8 tests.

- [ ] **Step 7: Run the full invocation test suite to catch regressions**

  ```bash
  cd packages/core && npx vitest run tests/capabilities/fix-mode-invocation tests/capabilities/fix-mode-escalate tests/capabilities/resilience-messages-new-reasons
  ```
  Expected: all pass.

- [ ] **Step 8: Verify tsc clean**

  ```bash
  cd packages/core && npx tsc --noEmit
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add packages/core/src/capabilities/recovery-orchestrator.ts \
          packages/core/tests/capabilities/fix-mode-escalate.test.ts
  git commit -m "feat(m9.6-s16): handle ESCALATE markers — redesign-needed + insufficient-context → immediate surrender"
  ```

---

## Task 5: Wire `target_path` in `app.ts` + new `emitAck` branches

**Files:**
- Modify: `packages/dashboard/src/app.ts`

No vitest test needed here — the orchestrator unit tests (Task 3) already verify `spec.targetPath` is set correctly. The `app.ts` change just passes it to the manifest. `tsc` is the gate.

- [ ] **Step 1: Add `target_path` to the manifest in `spawnAutomation`**

  In `packages/dashboard/src/app.ts`, find the `spawnAutomation` closure (around line 675). The current manifest object:
  ```typescript
  manifest: {
    name: spec.name,
    model: spec.model === "sonnet" ? models.sonnet : models.opus,
    autonomy: spec.autonomy === "cautious" ? "cautious" : "full",
    trigger: [{ type: "manual" }],
    once: true,
    job_type: spec.jobType,
  },
  ```
  Add `target_path` as the last field:
  ```typescript
  manifest: {
    name: spec.name,
    model: spec.model === "sonnet" ? models.sonnet : models.opus,
    autonomy: spec.autonomy === "cautious" ? "cautious" : "full",
    trigger: [{ type: "manual" }],
    once: true,
    job_type: spec.jobType,
    target_path: spec.targetPath,
  },
  ```

- [ ] **Step 2: Add `surrender-redesign-needed` and `surrender-insufficient-context` branches to `emitAck`**

  In the `emitAck` closure in `app.ts`, find the surrender branch section (around lines 735–744):
  ```typescript
  } else if (kind === "surrender") {
    text = rc.surrender(failure, "iteration-3");
  } else if (kind === "surrender-cooldown") {
    text = rc.surrender(failure, "surrender-cooldown");
  } else if (kind === "surrender-budget") {
    text = rc.surrender(failure, "budget");
  } else {
    console.warn(`[CFR] emitAck: unhandled AckKind '${kind as string}' — falling back to terminalAck`);
  ```
  Add two new branches before the `else`:
  ```typescript
  } else if (kind === "surrender") {
    text = rc.surrender(failure, "iteration-3");
  } else if (kind === "surrender-cooldown") {
    text = rc.surrender(failure, "surrender-cooldown");
  } else if (kind === "surrender-budget") {
    text = rc.surrender(failure, "budget");
  } else if (kind === "surrender-redesign-needed") {
    text = rc.surrender(failure, "redesign-needed");
  } else if (kind === "surrender-insufficient-context") {
    text = rc.surrender(failure, "insufficient-context");
  } else {
    console.warn(`[CFR] emitAck: unhandled AckKind '${kind as string}' — falling back to terminalAck`);
  ```

- [ ] **Step 3: Verify tsc clean in both packages**

  ```bash
  cd packages/core && npx tsc --noEmit
  cd packages/dashboard && npx tsc --noEmit
  ```
  Expected: no errors in either package.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/dashboard/src/app.ts
  git commit -m "feat(m9.6-s16): wire target_path + new surrender ack kinds in app.ts"
  ```

---

## Task 6 (TDD): `fix-mode-integration.test.ts` — stub plug, targetPath, spawn count

**Files:**
- Create: `packages/core/tests/capabilities/fix-mode-integration.test.ts`

- [ ] **Step 1: Write the test**

  Create `packages/core/tests/capabilities/fix-mode-integration.test.ts`:

  ```typescript
  import { describe, it, expect, vi } from "vitest";
  import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
  import { join } from "node:path";
  import { tmpdir } from "node:os";
  import { RecoveryOrchestrator } from "../../../src/capabilities/recovery-orchestrator.js";
  import type { OrchestratorDeps, AutomationSpec } from "../../../src/capabilities/recovery-orchestrator.js";
  import type { CapabilityFailure } from "../../../src/capabilities/cfr-types.js";
  import { conversationOrigin } from "../../../src/capabilities/cfr-helpers.js";
  import type { CapabilityRegistry } from "../../../src/capabilities/registry.js";
  import type { CapabilityWatcher } from "../../../src/capabilities/watcher.js";

  function makeCapDir(): string {
    const capDir = mkdtempSync(join(tmpdir(), "stt-deepgram-"));
    mkdirSync(join(capDir, "scripts"));
    writeFileSync(join(capDir, "CAPABILITY.md"), "---\nname: Test STT\nprovides: audio-to-text\n---\n");
    writeFileSync(join(capDir, "config.yaml"), "model: nova-2\n");
    writeFileSync(join(capDir, "DECISIONS.md"), "# Decisions\n\n");
    return capDir;
  }

  function makeFailure(): CapabilityFailure {
    return {
      id: "f-1",
      capabilityType: "audio-to-text",
      capabilityName: "stt-deepgram",
      symptom: "execution-error",
      detail: "DEEPGRAM_API_KEY not set",
      triggeringInput: {
        origin: conversationOrigin(
          { transportId: "whatsapp", channelId: "ch-1", sender: "+10000000001" },
          "conv-A",
          1,
        ),
      },
      attemptNumber: 1,
      previousAttempts: [],
      detectedAt: new Date().toISOString(),
    };
  }

  function makeDeps(capPath: string, overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
    const mockRegistry = {
      get: vi.fn().mockReturnValue({ name: "stt-deepgram", path: capPath, status: "unavailable" }),
      isMultiInstance: vi.fn().mockReturnValue(false),
      getFallbackAction: vi.fn().mockReturnValue("could you resend as text"),
    } as unknown as CapabilityRegistry;
    const mockWatcher = { rescanNow: vi.fn().mockResolvedValue([]) } as unknown as CapabilityWatcher;
    return {
      spawnAutomation: vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" }),
      awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      getJobRunDir: vi.fn().mockReturnValue(null),
      capabilityRegistry: mockRegistry,
      watcher: mockWatcher,
      emitAck: vi.fn().mockResolvedValue(undefined),
      reprocessTurn: vi.fn().mockResolvedValue(undefined),
      now: () => new Date().toISOString(),
      ...overrides,
    };
  }

  describe("fix-mode integration", () => {
    it("spawnAutomation receives targetPath equal to cap.path", async () => {
      const capDir = makeCapDir();
      const captured: AutomationSpec[] = [];
      const deps = makeDeps(capDir, {
        spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
          captured.push(spec);
          return { jobId: "j-1", automationId: "a-1" };
        }),
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(captured.length).toBeGreaterThan(0);
      expect(captured[0].targetPath).toBe(capDir);
    });

    it("no nested create_automation — spawnAutomation called at most 3 times across all attempts", async () => {
      const capDir = makeCapDir();
      const spawnAutomation = vi.fn().mockResolvedValue({ jobId: "j-1", automationId: "a-1" });
      const deps = makeDeps(capDir, {
        spawnAutomation,
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      // Fix-mode: 1 spawn per attempt, max 3 attempts.
      // Old path: execute + reflect × 3 = 6 spawns. Exceeding 3 means the reflect path is still live.
      expect(spawnAutomation.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it("prompt contains cap folder path for stub plug", async () => {
      const capDir = makeCapDir();
      const captured: AutomationSpec[] = [];
      const deps = makeDeps(capDir, {
        spawnAutomation: vi.fn().mockImplementation(async (spec: AutomationSpec) => {
          captured.push(spec);
          return { jobId: "j-1", automationId: "a-1" };
        }),
        awaitAutomation: vi.fn().mockResolvedValue({ status: "failed" }),
      });
      const orch = new RecoveryOrchestrator(deps);
      await orch.handle(makeFailure());

      expect(captured[0].prompt).toContain(capDir);
    });
  });
  ```

- [ ] **Step 2: Run to confirm it passes** (should already pass since Task 3 implemented the behaviour)

  ```bash
  cd packages/core && npx vitest run tests/capabilities/fix-mode-integration
  ```
  Expected: PASS — 3 tests. If any fail, diagnose against Task 3 changes before proceeding.

- [ ] **Step 2b [ARCHITECT S1]: Decide integration-test depth — choose A or B**

  The plan v0 test asserts `targetPath` capture and spawn count ≤ 3, but the spec also asks for "no nested `create_automation`" and "paper trail appended via `writePaperTrail` (target_path correctly set on manifest)." At unit-test scope `writePaperTrail` is called by the automation framework, not by the orchestrator — so it can't be asserted directly without mocking the framework. **Pick one:**

  **Option A — Expand the test.** Add two more `it()` blocks:
  - `"manifest target_path equals capDir when threaded through spawnAutomation closure"`: assert by replicating the closure logic in the test (compose the manifest from `spec`, check `manifest.target_path === capDir`). This duplicates the closure shape from `app.ts:~675` — coupling cost is low because the shape is small.
  - `"spawnAutomation never receives a child spec referencing the same plug"`: capture all `spawnAutomation` calls; assert no spec has a `parent` field whose `jobId` matches another captured spec's returned `jobId`. This catches a hypothetical "fix mode tries to nest" without invoking the real skill.

  **Option B — File a deviation proposal.** Create `docs/sprints/m9.6-capability-resilience/proposals/s16-integration-test-scope.md`:
  ```markdown
  # Deviation Proposal — Sprint S16: integration test depth

  **Blocker:** Spec asks fix-mode-integration.test.ts to assert "no nested create_automation"
  and "paper trail appended via writePaperTrail." Both behaviors live outside the orchestrator —
  in the automation framework (`automation-executor.ts`) called on job completion. At
  unit-test scope, the orchestrator only sees `spawnAutomation` (a dep injection); writePaperTrail
  is not reachable without mocking the entire automation framework.

  **Original plan says:** [quote from plan-phase3-refinements.md §2.1]

  **What I found:** The orchestrator's surface to verify these behaviors is limited to:
  (a) `spec.targetPath` is set correctly (already covered in Task 3), and (b) total spawn
  count ≤ 3 (covered in Task 6). True integration verification requires either invoking
  the real `automation-executor` (out of unit scope) or running fix-mode end-to-end against
  a real Opus session (S20 exit-gate territory).

  **Options I considered:**
  1. Expand mocks to include automation-executor stub → couples the orchestrator test to
     framework internals. Maintenance cost > coverage benefit.
  2. Defer behavior verification to S20's `cfr-exit-gate-conversation.test.ts` which exercises
     the full stack end-to-end. Unit tests stay scoped to orchestrator behavior.

  **My recommendation:** Option 2. Document the substitution; rely on S20 for end-to-end coverage.

  **Blast radius:** none — Task 6's existing assertions remain valid orchestrator-level checks.

  **Question for the architect:** Approve substitution (Option 2)?
  ```

  Default recommendation: **Option B** unless the dev sees a clean way to add Option A's two `it()` blocks without coupling. Architect resolves before merge.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/core/tests/capabilities/fix-mode-integration.test.ts
  # If Option B chosen, also add:
  # git add docs/sprints/m9.6-capability-resilience/proposals/s16-integration-test-scope.md
  git commit -m "test(m9.6-s16): fix-mode integration — targetPath, ≤3 spawns, cap path in prompt"
  ```

---

## Task 7 (TDD): SKILL.md — Step 0 gate + neutral-identifier convention

**Files:**
- Create: `packages/core/tests/capabilities/capability-brainstorming-gate.test.ts`
- Modify: `packages/core/skills/capability-brainstorming/SKILL.md`

- [ ] **Step 1: Write the failing gate test**

  Create `packages/core/tests/capabilities/capability-brainstorming-gate.test.ts`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { readFileSync } from "node:fs";
  import { fileURLToPath } from "node:url";
  import { join, dirname } from "node:path";

  const SKILL_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../skills/capability-brainstorming/SKILL.md",
  );
  const content = readFileSync(SKILL_PATH, "utf-8");

  describe("capability-brainstorming SKILL.md — Step 0 gate", () => {
    it("has a Step 0: Mode check section", () => {
      expect(content).toContain("## Step 0: Mode check");
    });

    it("Step 0 gates on MODE: FIX prefix", () => {
      expect(content).toContain("MODE: FIX");
    });

    it("Step 0 disables the authoring flow steps in fix mode", () => {
      expect(content).toContain("Steps 1, 2, 3, 4, 5, and 6 of the authoring flow");
      expect(content).toContain("DISABLED in fix mode");
    });

    it("fix-mode documents the ESCALATE: redesign-needed marker", () => {
      expect(content).toContain("ESCALATE: redesign-needed");
    });

    it("fix-mode documents the ESCALATE: insufficient-context marker", () => {
      expect(content).toContain("ESCALATE: insufficient-context");
    });

    it("fix-mode instructs reading CAPABILITY.md, config.yaml, DECISIONS.md, scripts/", () => {
      expect(content).toContain("CAPABILITY.md");
      expect(content).toContain("config.yaml");
      expect(content).toContain("DECISIONS.md");
    });

    it("fix-mode instructs not to spawn a nested builder automation", () => {
      expect(content).toContain("Do NOT spawn a nested builder automation");
    });

    it("Step 5 has the neutral-identifier convention", () => {
      expect(content).toContain("capability `name:` must be a neutral identifier");
    });

    // [ARCHITECT R3] — regression assertions: the Step 0 insert must NOT clobber Steps 1-6.
    // Without these, the test would pass even if the dev accidentally deleted authoring steps.
    it("authoring-mode Steps 1 through 6 headings still exist after Step 0 insert", () => {
      expect(content).toContain("## Step 1");
      expect(content).toContain("## Step 2");
      expect(content).toContain("## Step 3");
      expect(content).toContain("## Step 4");
      expect(content).toContain("## Step 5");
      expect(content).toContain("## Step 6");
    });

    it("authoring-flow body still references core authoring concepts", () => {
      // Loose smoke check — these phrases come from the existing authoring flow.
      // If the dev's insert deletes them, the regression fires.
      expect(content).toContain("create_automation");
      expect(content).toContain("Spawn the Builder");
    });
  });
  ```

  **[ARCHITECT S2] note:** This entire test file is text-coverage, not behavior-coverage. Behavior-level verification of Step 0 gating (does the skill actually skip Steps 1-6 when the prompt starts with `MODE: FIX`?) requires invoking the real skill against a live Opus session — that lands in S20's `cfr-exit-gate-conversation.test.ts`. File the substitution proposal as Step 1b below.

- [ ] **Step 1b [ARCHITECT S2]: File skill-gate test scope deviation**

  Create `docs/sprints/m9.6-capability-resilience/proposals/s16-skill-gate-test-scope.md`:

  ```markdown
  # Deviation Proposal — Sprint S16: SKILL.md gate test scope

  **Blocker:** Plan-phase3 §2.1 acceptance test wording — "authoring-mode prompt still runs
  full Steps 1-6; fix-mode prompt runs fix-only path" — implies behavior verification.
  At unit-test scope this requires invoking the real skill against an Opus session, which
  is out of unit scope.

  **What I found:** The achievable unit-level verification is:
  (a) SKILL.md contains the Step 0 mode-check section + ESCALATE markers + neutral-identifier
      convention (text presence).
  (b) Authoring-mode Steps 1-6 headings + key authoring phrases ("create_automation",
      "Spawn the Builder") survive the Step 0 insert (regression check, ARCHITECT R3).

  Behavior-level verification ("did Step 0 actually gate Opus to skip Steps 1-6?") lands
  in S20's exit-gate-conversation test which invokes fix-mode end-to-end against a real
  broken plug.

  **My recommendation:** Approve text-coverage substitution at unit level; behavior verification
  deferred to S20.

  **Blast radius:** none if S20 covers behavior. If S20 slips, S16's gate test becomes a
  weaker safety net; revisit at S20-time.

  **Question for the architect:** Approve substitution? S20 takes responsibility for behavior verification?

  **Self-answered:** APPROVE — agreed by Phase 3 architect during plan review (R3+S2 frame).
  ```

- [ ] **Step 2: Run to confirm it fails**

  ```bash
  cd packages/core && npx vitest run tests/capabilities/capability-brainstorming-gate
  ```
  Expected: FAIL — SKILL.md has no Step 0 section. The R3 regression assertions (Steps 1-6 still exist) should currently PASS — they only need to *continue* passing after the Step 3 edit.

- [ ] **Step 3: Edit `SKILL.md` — insert Step 0 before the existing heading**

  In `packages/core/skills/capability-brainstorming/SKILL.md`, insert the following block after the YAML frontmatter closing `---` (line 13) and before the `# Capability Brainstorming` heading (line 15):

  ```markdown
  ## Step 0: Mode check

  If the invocation prompt starts with `MODE: FIX`, follow the Fix Mode path ONLY.
  Steps 1, 2, 3, 4, 5, and 6 of the authoring flow, and the `.enabled` write step, are
  DISABLED in fix mode. Do not run them. Do not `create_automation`. Do not write
  user-facing copy. Do not ask clarifying questions — if you do not have enough info,
  write `ESCALATE: insufficient-context` atop your deliverable and stop.

  ### Fix Mode

  You have been invoked by the recovery orchestrator because a capability failed during a
  user turn or automation. The capability folder already exists at `<capDir>` (passed in the
  prompt).

  1. Read `<capDir>/CAPABILITY.md`, `<capDir>/config.yaml`, `<capDir>/DECISIONS.md`, and the
     relevant files under `<capDir>/scripts/`. Form a hypothesis from the symptom, detail,
     and previous-attempt history in the invocation prompt.
  2. Write a one-line "why this change is being made" context entry to
     `<capDir>/DECISIONS.md` (appending, with a timestamp). Mirrors authoring-flow Step 1.
  3. Make a targeted change to the plug in-process (config tweak, script patch, env fix,
     dep bump). Do NOT spawn a nested builder automation. Do NOT rewrite from scratch.
     If the existing design cannot be repaired, write `ESCALATE: redesign-needed` atop
     your deliverable and stop.
  4. Run `<capDir>/scripts/smoke.sh`. Record the result.
  5. Write `deliverable.md` in your run directory with frontmatter (`change_type`,
     `test_result`, `hypothesis_confirmed`, `summary`, `surface_required_for_hotreload`) + body.
  6. Do NOT append the paper-trail entry to `DECISIONS.md` yourself — the automation
     framework's `writePaperTrail` does that on job completion (`target_path` is set).

  ---

  ```

- [ ] **Step 4: Edit `SKILL.md` — add neutral-identifier convention to Step 5**

  In Step 5 ("Spawn the Builder as a Tracked Job"), locate the list item that starts with `1. Produce a clear spec for the builder agent.` (which includes `**Provider name and library/package**`). Add a new bullet at the end of that numbered item's spec requirements:

  Find the text that ends with:
  ```
     - **Template reference** — if a template exists, include it so the builder follows the contract exactly
  ```
  After that line (within the same bullet), add:
  ```
     - **Neutral identifier:** capability `name:` must be a neutral identifier (provider/variant/model), never user-identifiable content (no real names, phone numbers, emails). The name surfaces in user-facing ack copy for multi-instance types.
  ```

- [ ] **Step 5: Run to confirm the test passes**

  ```bash
  cd packages/core && npx vitest run tests/capabilities/capability-brainstorming-gate
  ```
  Expected: PASS — 10 tests (8 original + 2 R3 regression assertions). If the R3 regression assertions fail, the Step 0 insert clobbered Steps 1-6 — revert and re-do the edit more carefully.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/core/skills/capability-brainstorming/SKILL.md \
          packages/core/tests/capabilities/capability-brainstorming-gate.test.ts \
          docs/sprints/m9.6-capability-resilience/proposals/s16-skill-gate-test-scope.md
  git commit -m "feat(m9.6-s16): add Step 0 fix-mode gate + neutral-identifier convention + R3 regression assertions"
  ```

---

## Task 8: Deprecate `fix-automation.md`

**Files:**
- Modify: `packages/core/src/capabilities/prompts/fix-automation.md`

- [ ] **Step 1: Add deprecation notice**

  Prepend the following to `packages/core/src/capabilities/prompts/fix-automation.md` (before the existing `# Fix Automation` heading):

  ```markdown
  > **DEPRECATED (M9.6-S16):** This template is no longer invoked by the recovery orchestrator.
  > The orchestrator now calls `capability-brainstorming` in `MODE: FIX` (see `buildFixModeInvocation`
  > in `recovery-orchestrator.ts`). This file is retained until S17 confirms one sprint of green
  > fix-mode operation, then deleted.

  ```

- [ ] **Step 2: Commit**

  ```bash
  git add packages/core/src/capabilities/prompts/fix-automation.md
  git commit -m "deprecate(m9.6-s16): mark fix-automation.md — replaced by capability-brainstorming fix-mode"
  ```

---

## Task 9: Sprint decisions log + write-guard check

**Files:**
- Create: `docs/sprints/m9.6-capability-resilience/s16-DECISIONS.md`

- [ ] **Step 1: Check for `.my_agent/` write-guard hook**

  ```bash
  cat .claude/settings.json | python3 -m json.tool | grep -A10 "hooks"
  ```

  Verify whether a hook blocking writes to `.my_agent/` (for `job_type !== "capability_modify"`) exists. Per MEMORY.md, this was planned post-M9.2 but is likely absent — only the `check-private-data.sh` PostToolUse hook should be present.

- [ ] **Step 2: Create `s16-DECISIONS.md`**

  Create `docs/sprints/m9.6-capability-resilience/s16-DECISIONS.md`:

  ```markdown
  ---
  sprint: M9.6-S16
  title: Fix-engine swap decisions
  ---

  # S16 Decisions

  ## D1 — Write-guard hook: not yet in place

  **Decision:** The `.my_agent/` write-guard hook (blocking unauthorized writes to `.my_agent/`
  scoped to `job_type !== "capability_modify"`) is absent in `.claude/settings.json`. Only
  the private-data `check-private-data.sh` PostToolUse hook exists.

  **Why:** MEMORY.md records "post-M9.2, add hook" as a TODO, not a completed feature.

  **Impact on S16:** The `.my_agent/` write-guard exemption for `capability_modify` (spec §3.5)
  has nothing to exempt yet. No code change needed in S16; document for the implementing sprint
  when the hook is added (likely a dedicated hook-setup sprint before or during M10).

  ## D2 — `buildFixModeInvocation` previous-attempts format: table not prose

  **Decision:** Previous attempts rendered as a markdown table (`| Attempt | Hypothesis | Result | Failure mode |`)
  rather than prose sections. Denser and easier for Opus to scan under the 15-min constraint.

  ## D3 — `targetPath` uses absolute `cap.path` directly

  **Decision:** `spec.targetPath` receives the `Capability.path` value from the registry, which
  is an absolute path (e.g., `.my_agent/capabilities/stt-deepgram`).
  `automation-executor.ts` calls `path.resolve(agentDir, "..", targetPath)` — `path.resolve` with
  an absolute argument ignores prior args, so the absolute path flows through correctly without
  conversion. If `registry.get()` returns `undefined` (cap not found), `targetPath` is `undefined`
  and `writePaperTrail` silently skips — correct behaviour.

  ## D4 — Reflect spawn removed entirely; no dead code retained in S16

  **Decision:** `runOneAttempt` no longer spawns a reflect job. The reflect branch code (lines
  ~447–482 in the pre-S16 orchestrator) still exists but is unreachable because `executeSuccess`
  leads directly to `doReverify` with no reflect path. S17 will delete it. This is intentional
  per phase-3 ordering rationale (§0.2): reflect stays at full quality (Opus) during the
  transition; fix-mode bypasses it entirely; S17 removes the dead code once fix-mode is green.

  ## D5 — Wall-time measurement: requires real broken plugs on dev machine

  **Decision:** `scripts/measure-fix-mode-walltime.js` is authored in S16 but requires the
  dev machine's `.my_agent/capabilities/` plugs and live Opus API calls to produce meaningful
  timing data. The script is written and documented; actual results go into `s16-walltime-results.md`
  after a dev-machine run. Per the wall-time decision gate (plan §2.1), results determine whether
  a mitigation commit is needed before S16 closes. **Task 12 executes the measurement and
  records the gate decision; without it, S16 cannot close.**

  ## D6 — Sibling-skill Option B remains the documented escape hatch [ARCHITECT R4]

  **Decision:** Per design v2 §3.5 + Phase 3 plan §4 design map (`§3.5 | Sibling-skill escape
  hatch documented | S16`), this entry exists to capture the architectural choice in writing.

  **Option A (chosen, implemented in S16):** mode-flag on `capability-brainstorming` SKILL.md
  via the `MODE: FIX` Step 0 gate. Reflects the CTO's "Nina fixes it the same way she built
  it" framing.

  **Option B (escape hatch, not implemented):** a sibling skill — `capability-fixing` —
  living at `packages/core/skills/capability-fixing/SKILL.md` that imports the same helpers
  but has its own instruction set. Cleaner isolation: a wrong copy-paste in one skill can't
  break the other.

  **When to revisit Option B:**
  - SKILL.md mode-gating proves brittle in S20 exit gate (Step 0 routes incorrectly under
    real Opus invocation).
  - A future regression breaks fix-mode because of an authoring-mode edit, OR vice versa.
  - The Step 0 gate's text grows beyond ~50 lines (signal that the two modes have diverged
    enough that a sibling skill is structurally cleaner).

  **Cost of switching:** small — fix-mode logic is already self-contained in Step 0's
  body. Move the body to `capability-fixing/SKILL.md`, change `buildFixModeInvocation` to
  reference the new skill, keep Step 0 in `capability-brainstorming/SKILL.md` as a one-liner
  pointing at the sibling. Roughly a half-day refactor.

  **Status at S16 close:** Option A in production. Option B unused but documented here so
  future sessions know the escape exists without re-deriving it.
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add docs/sprints/m9.6-capability-resilience/s16-DECISIONS.md
  git commit -m "docs(m9.6-s16): sprint decisions log — write-guard status, targetPath, reflect removal"
  ```

---

## Task 10: Wall-time measurement script

**Files:**
- Create: `scripts/measure-fix-mode-walltime.js`

This script is a dev-machine operational tool, not a unit test. It produces `s16-walltime-results.md`. Run it **after loading `.env`** per §0.4 env-mismatch protocol.

- [ ] **Step 1: Write the script**

  Create `scripts/measure-fix-mode-walltime.js`:

  ```javascript
  #!/usr/bin/env node
  /**
   * M9.6-S16 wall-time gate: measure fix-mode Opus run time against at least two plug types.
   *
   * Pre-conditions:
   *   1. source packages/dashboard/.env (or set -a && . packages/dashboard/.env && set +a)
   *   2. Dashboard service running (or App.create() available headlessly)
   *   3. At least two plugs present in .my_agent/capabilities/ with smoke.sh
   *
   * Usage:
   *   node scripts/measure-fix-mode-walltime.js
   *
   * Output:
   *   docs/sprints/m9.6-capability-resilience/s16-walltime-results.md
   *
   * Wall-time decision gate (plan §2.1):
   *   ≤5 min: ship as-is
   *   5–10 min: file proposals/s16-walltime-mitigation.md and choose mitigation
   *   >10 min: escalate to architect
   */

  import { readdirSync, existsSync, writeFileSync } from "node:fs";
  import { join } from "node:path";

  const CAPABILITIES_DIR = join(process.cwd(), ".my_agent", "capabilities");
  const OUTPUT_PATH = join(
    process.cwd(),
    "docs/sprints/m9.6-capability-resilience/s16-walltime-results.md",
  );

  function findPlugsWithSmoke() {
    if (!existsSync(CAPABILITIES_DIR)) {
      console.error(`Capabilities dir not found: ${CAPABILITIES_DIR}`);
      process.exit(1);
    }
    const entries = readdirSync(CAPABILITIES_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => existsSync(join(CAPABILITIES_DIR, name, "scripts", "smoke.sh")))
      .map((name) => ({ name, path: join(CAPABILITIES_DIR, name) }));
  }

  async function main() {
    const plugs = findPlugsWithSmoke();
    console.log(`Found ${plugs.length} plug(s) with smoke.sh:`, plugs.map((p) => p.name));

    if (plugs.length < 2) {
      console.warn("Warning: fewer than 2 plugs found. Wall-time results will be incomplete.");
      console.warn("Install at least one more plug before running this gate.");
    }

    // This script documents the MANUAL steps required on the dev machine.
    // Automated timing requires a live App instance + Opus API key.
    // Steps to run manually:
    //   1. Break a plug surgically (e.g., corrupt config.yaml or revoke an env var).
    //   2. Send a triggering message via the dashboard or headless App.
    //   3. Record wall-time from CFR emit to RESTORED_TERMINAL or SURRENDER.
    //   4. Restore the plug and repeat for a second type.

    const content = `---
  sprint: M9.6-S16
  gate: wall-time measurement
  generated: ${new Date().toISOString()}
  ---

  # S16 Wall-Time Results

  **Gate:** plan-phase3-refinements.md §2.1 / design §6.3

  ## Plugs found at measurement time

  ${plugs.map((p) => `- \`${p.name}\` (${p.path})`).join("\n")}

  ## Results

  | Plug | Type | Break method | Wall-time (s) | Outcome | Decision |
  |------|------|-------------|---------------|---------|----------|
  | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
  | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ |

  ## Gate decision

  - [ ] ≤5 min consistently: ship as-is
  - [ ] 5–10 min consistently: file \`proposals/s16-walltime-mitigation.md\`, architect picks mitigation
  - [ ] >10 min consistently: escalate — may need architectural change

  ## How to run

  \`\`\`bash
  # 1. Load env
  set -a && . packages/dashboard/.env && set +a

  # 2. For each plug to test:
  #    a. Introduce a surgical break (e.g., edit config.yaml to use wrong API key)
  #    b. Send a triggering message via dashboard
  #    c. Time from CFR ack ("hold on — ...") to restoration or surrender
  #    d. Record in the table above
  #    e. Verify plug restored (or restore manually if surrendered)

  # 3. Fill in the table above and commit
  \`\`\`
  `;

    writeFileSync(OUTPUT_PATH, content);
    console.log(`Wall-time results template written to: ${OUTPUT_PATH}`);
    console.log("\nNext steps:");
    console.log("  1. Load .env: set -a && . packages/dashboard/.env && set +a");
    console.log("  2. Follow the 'How to run' instructions in the output file.");
    console.log("  3. Fill in the results table and commit.");
  }

  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
  ```

- [ ] **Step 2: Make the script executable**

  ```bash
  chmod +x scripts/measure-fix-mode-walltime.js
  ```

- [ ] **Step 3: Verify the script runs without error**

  ```bash
  node scripts/measure-fix-mode-walltime.js
  ```
  Expected: outputs plug list, writes `s16-walltime-results.md` template.

- [ ] **Step 4: Commit**

  ```bash
  git add scripts/measure-fix-mode-walltime.js \
          docs/sprints/m9.6-capability-resilience/s16-walltime-results.md
  git commit -m "feat(m9.6-s16): add wall-time measurement script + results template"
  ```

---

## Task 11: Full test suite verification

- [ ] **Step 1: Run all S16 acceptance tests**

  ```bash
  cd packages/core && npx vitest run \
    tests/capabilities/fix-mode-invocation \
    tests/capabilities/fix-mode-integration \
    tests/capabilities/fix-mode-escalate \
    tests/capabilities/capability-brainstorming-gate \
    tests/capabilities/resilience-messages-new-reasons
  ```
  Expected: all pass.

- [ ] **Step 2: Run the full core test suite**

  ```bash
  cd packages/core && npx vitest run
  ```
  Expected: no regressions. Specifically verify the orchestrator suite still passes:
  ```bash
  cd packages/core && npx vitest run tests/capabilities/orchestrator
  ```

- [ ] **Step 3: Run the full dashboard test suite**

  ```bash
  cd packages/core && npx tsc && cd ../dashboard && npx vitest run
  ```
  Expected: 214/214 (or current baseline) pass.

- [ ] **Step 4: Final tsc check**

  ```bash
  cd packages/core && npx tsc --noEmit
  cd packages/dashboard && npx tsc --noEmit
  ```

---

## Task 12 [ARCHITECT R1]: Wall-time measurement gate — actually run the measurement

This task is the wall-time **decision gate** from plan-phase3-refinements.md §2.1 + design v2 §6.3. **S16 cannot close without this task.** The script from Task 10 is the tool; this task is the actual run + decision.

**Files:**
- Modify: `docs/sprints/m9.6-capability-resilience/s16-walltime-results.md` (fill in the table)
- Conditional Create: `docs/sprints/m9.6-capability-resilience/proposals/s16-walltime-mitigation.md` (only if 5–10 min branch)

- [ ] **Step 1: Confirm preconditions per §0.4 env-mismatch protocol**

  ```bash
  set -a && . packages/dashboard/.env && set +a
  # Verify env loaded:
  echo "ANTHROPIC_API_KEY set: $([ -n "$ANTHROPIC_API_KEY" ] && echo YES || echo NO)"
  # Verify ≥2 plugs with smoke.sh:
  ls .my_agent/capabilities/*/scripts/smoke.sh
  # Verify all installed plugs are healthy at start:
  for s in .my_agent/capabilities/*/scripts/smoke.sh; do bash "$s" || echo "FAIL: $s"; done
  ```
  Expected: env loaded, ≥2 plugs, smoke green (or exit 2 SMOKE_SKIPPED with clear reason).

- [ ] **Step 2: Run the measurement against ≥2 plug types**

  Per `scripts/measure-fix-mode-walltime.js` instructions (Task 10), measure two plugs:
  - **Plug 1 — script type** (e.g., `stt-deepgram`): break surgically (e.g., `mv config.yaml config.yaml.bak`), trigger via dashboard or headless App, time from CFR ack to RESTORED_TERMINAL or SURRENDER, restore plug if surrendered.
  - **Plug 2 — MCP type** (e.g., `browser-chrome`): same shape with an MCP-appropriate break.

  Record raw times; run each plug at least twice to spot variance.

- [ ] **Step 3: Fill `s16-walltime-results.md` table**

  Open the file Task 10 created and fill in the rows. Each row: plug, type, break method, wall-time (s), outcome (RESTORED_TERMINAL / SURRENDER / TIMEOUT), and per-row decision contribution (≤300s = under-5min, 300–600s = 5–10min, >600s = over-10min).

- [ ] **Step 4: Hit the decision gate (mandatory, exactly one branch)**

  - [ ] **Branch A — ≤5 min consistently:** ship as-is. Add a final summary line to `s16-walltime-results.md`: `## Gate decision: SHIP — wall-times consistently under 5 minutes (X.X min mean across N runs).`
  - [ ] **Branch B — 5–10 min consistently:** file `docs/sprints/m9.6-capability-resilience/proposals/s16-walltime-mitigation.md` proposing **one** of:
    - (b1) Add a 60s status ack (in addition to the existing 20s ack from Phase 1 S6) — `resilience-messages.ts` + `recovery-orchestrator.ts` timer changes.
    - (b2) Sonnet for simple symptom classes (`not-enabled`, configuration errors) + Opus for hard diagnosis (`execution-error`, `timeout`) — `recovery-orchestrator.ts` model selection per symptom.
    Architect picks; mitigation lands in a separate commit before S16 closes.
  - [ ] **Branch C — >10 min consistently:** STOP. File `proposals/s16-walltime-escalation.md` with the data and escalate to the architect. May require revisiting fix-engine architecture (e.g., Option B sibling skill per D6, or splitting fix-mode invocation into a smaller scope).

- [ ] **Step 5: Commit results (and mitigation if Branch B)**

  ```bash
  git add docs/sprints/m9.6-capability-resilience/s16-walltime-results.md
  # If Branch B chosen:
  # git add docs/sprints/m9.6-capability-resilience/proposals/s16-walltime-mitigation.md
  # If mitigation lands: separate commit per the architect's pick
  git commit -m "test(m9.6-s16): wall-time measurement results + gate decision"
  ```

  **Do NOT mark S16 done in ROADMAP.md here.** Per §0.3, that's the architect's commit, post-review.

---

## Task 13 [ARCHITECT R2]: Sprint artifacts + CTO notification

Required by plan-phase2-coverage.md §0.3 (carried into Phase 3). The dev writes these; the architect writes `s16-architect-review.md` separately. **Do NOT touch ROADMAP.md. Do NOT use "APPROVED" framing in commit messages.** Phase 2 had three sprints (S9/S11/S15) violate this rule and the dev had to revert; do not repeat.

**Files:**
- Create: `docs/sprints/m9.6-capability-resilience/s16-DEVIATIONS.md`
- Create: `docs/sprints/m9.6-capability-resilience/s16-FOLLOW-UPS.md`
- Create: `docs/sprints/m9.6-capability-resilience/s16-test-report.md`

- [ ] **Step 1: Create `s16-DEVIATIONS.md`**

  Index of every `proposals/s16-*.md` file authored. At minimum it should list:
  - `s16-skill-gate-test-scope.md` (ARCHITECT S2 — unconditional, filed in Task 7)
  - `s16-integration-test-scope.md` (ARCHITECT S1 — only if Task 6 chose Option B)
  - `s16-walltime-mitigation.md` (ARCHITECT R1 — only if Task 12 hit Branch B)
  - `s16-walltime-escalation.md` (only if Task 12 hit Branch C)

  Format per Phase 1 / Phase 2 sprints:
  ```markdown
  ---
  sprint: m9.6-s16
  ---

  # S16 Deviations

  ## DEV-1 / DEV-2 / ... — <title>
  - **What:** <one line>
  - **Proposal:** [proposals/s16-<slug>.md](proposals/s16-<slug>.md)
  - **Resolution:** <approved | rejected | self-answered>

  ## (none) — if no deviations were filed
  ```

- [ ] **Step 2: Create `s16-FOLLOW-UPS.md`**

  Out-of-scope items noticed during the sprint. Per §0.1 universal-coverage rule: every plug type in `.my_agent/capabilities/` not exercised by the wall-time measurement must be named here with rationale + receiving sprint (likely S20 exit gate). Every architectural smell that surfaced but wasn't fixed (`this.surrender` signature drift, `path.resolve` corner cases, etc.) goes here.

  Format per Phase 1 / Phase 2:
  ```markdown
  ---
  sprint: m9.6-s16
  ---

  # S16 Follow-Ups

  ## FU-1 — <title>
  - **What:** <one line>
  - **Why deferred:** <reason>
  - **Target sprint:** S<N>
  ```

- [ ] **Step 3: Create `s16-test-report.md`**

  Verification command output for every test added in S16 (Tasks 2/3/4/6/7) + the wall-time measurement (Task 12) + the regression-gate runs (Task 11). Format per Phase 1 / Phase 2 sprints — capture command lines, test counts, and any noted variance. Architect re-runs these independently at review time; mismatches are blocking.

- [ ] **Step 4: External auditor (optional, recommended for fix-mode novelty)**

  Per §0.3, the dev MAY run an external auditor for an independent technical read on S16. Fix-mode is structurally novel (skill-mode-gating, ESCALATE markers, wall-time gate) — high signal-to-noise for an audit. If used, the auditor's artifact lands at `s16-review.md` with frontmatter `reviewer: External auditor (dev-contracted)` and `recommended: APPROVE | REJECT | CONDITIONAL`. **Never** `reviewer: Architect`. **Never** `verdict: APPROVED` — those framings claim a role the dev does not hold.

- [ ] **Step 5: Stop the trip-sprint and notify the CTO**

  Notify CTO: "S16 dev is done; artifacts ready for architect review."

  **Do NOT:**
  - Commit `APPROVED` in any commit message.
  - Mark S16 Done in `docs/ROADMAP.md`.
  - Write `s16-architect-review.md` (that file is the architect's exclusively).

  Per Phase 1 §0.3 (carried verbatim): the roadmap-done commit is the LAST commit on the sprint branch, landed AFTER the architect-review commit. Three Phase 2 sprints violated this and required reverts. Don't repeat.

- [ ] **Step 6: Commit the artifacts**

  ```bash
  git add docs/sprints/m9.6-capability-resilience/s16-DEVIATIONS.md \
          docs/sprints/m9.6-capability-resilience/s16-FOLLOW-UPS.md \
          docs/sprints/m9.6-capability-resilience/s16-test-report.md
  # If external auditor used:
  # git add docs/sprints/m9.6-capability-resilience/s16-review.md
  git commit -m "docs(m9.6-s16): sprint artifacts — deviations, follow-ups, test report"
  ```

---

## Self-review

### Spec coverage

| Spec item | Task |
|-----------|------|
| `SKILL.md` Step 0: Mode check section | Task 7 |
| Fix-mode steps 1-6 + ESCALATE paths in SKILL.md | Task 7 |
| Authoring neutral-identifier convention in Step 5 | Task 7 |
| `buildFixModeInvocation` (replaces `renderPrompt`) | Task 3 |
| Prompt starts with `MODE: FIX` | Task 3 |
| `targetPath` on `AutomationSpec` | Task 1 |
| `spec.targetPath = cap.path` on spawn | Task 3 |
| `target_path` wired in `app.ts` manifest | Task 5 |
| `JOB_TIMEOUT_MS` = 15 min | Task 3 |
| `model: "opus"` for fix-mode | Task 3 |
| `ESCALATE: redesign-needed` → skip reverify, SURRENDER | Task 4 |
| `ESCALATE: insufficient-context` → skip reverify, SURRENDER | Task 4 |
| `surrenderReason = "redesign-needed" / "insufficient-context"` | Task 4 |
| New `AckKind` values `surrender-redesign-needed/insufficient-context` | Task 1 |
| New `emitAck` branches in `app.ts` | Task 5 |
| Surrender copy for `redesign-needed` | Task 2 |
| Surrender copy for `insufficient-context` | Task 2 |
| `fix-automation.md` deprecation notice | Task 8 |
| Write-guard check + documentation | Task 9 |
| Test: `fix-mode-invocation.test.ts` | Task 3 |
| Test: `fix-mode-integration.test.ts` | Task 6 |
| Test: `fix-mode-escalate.test.ts` | Task 4 |
| Test: `capability-brainstorming-gate.test.ts` | Task 7 |
| Test: `resilience-messages-new-reasons.test.ts` | Task 2 |
| Wall-time measurement script + results template | Task 10 |
| **[ARCHITECT R1]** Wall-time measurement *executed* + decision gate hit | **Task 12** |
| **[ARCHITECT R2]** `s16-DEVIATIONS.md` + `s16-FOLLOW-UPS.md` + `s16-test-report.md` + CTO notification | **Task 13** |
| **[ARCHITECT R3]** Authoring-mode Steps 1-6 regression assertions | Task 7 (added to test) |
| **[ARCHITECT R4]** Sibling-skill Option B escape hatch documented | Task 9 (D6) |
| **[ARCHITECT S1]** Integration test depth — expand mocks OR file deviation | Task 6 (Step 2b) |
| **[ARCHITECT S2]** Skill gate test scope deviation filed | Task 7 (Step 1b) |

### Universal coverage check

Per §0.1: fix-mode must work for every plug type in `.my_agent/capabilities/`. The orchestrator change is type-agnostic — it uses `capabilityRegistry.get(failure.capabilityType)?.path` regardless of type. The smoke run is `<capDir>/scripts/smoke.sh` which every installed plug provides (enforced by S11). Explicit per-type check is part of the wall-time measurement (Task 10 results table).

---

*Created: 2026-04-19*
*Sprint: M9.6-S16*
