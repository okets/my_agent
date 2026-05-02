# M9.4-S4.3: Worker Pipeline Cleanup — Single Writer + Sidecar Metadata

> **For agentic workers:** Use `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Run in a dedicated worktree.

**Opened:** 2026-05-01
**Origin:** Closes the deferred items from S4.2-fu3's redesign ([`worker-pipeline-redesign.md`](../m9.4-s4.2-action-request-delivery/worker-pipeline-redesign.md)) and the corrections from the post-fu3 capability implications audit ([`post-fu3-capability-implications.md`](../m9.4-s4.2-action-request-delivery/post-fu3-capability-implications.md)).
**Goal:** Single writer for `deliverable.md` (no post-run executor mutation), sidecar JSON for worker metadata (capability fields + audit trail), an end-to-end test that locks the contract, AND a fix for the stale empty-deliverable heuristic that's been false-positive-flagging successful side-effect workers since fu1's anti-narration directive landed.
**Effort estimate:** ~1.25 days on a branch (excludes merge wait). +25% over original estimate to fold in items E/F/G surfaced by the May-2 incident report.
**Soak status:** S4.2 is in 7-day soak (Day 4 of 7 today). S4.3 develops on a branch in parallel; merge is gated on probe + tests + soak Day 5+ clean.

---

## Why this sprint exists

The S4.2-fu3 redesign deferred three forward improvements; the post-fu3 capability audit added a fourth. None block the morning brief. All four are correctness-or-cleanliness fixes that close the M9.4 supplemental thread cleanly.

The "all archived, dormant" framing in the original redesign was wrong: `cfr-fix-*` capability workers spawn dynamically at runtime via `recovery-orchestrator.ts:412` + `app.ts:758`. The current pipeline handles them correctly post-fu3, but the migration is still worth doing because:

1. The chart-augmentation block at `automation-executor.ts:649-672` is a third independent writer of `deliverable.md`. fu3 made the worker writer authoritative; this finishes the job.
2. Capability templates instruct workers to write YAML frontmatter into `deliverable.md`. This conflates user-facing markdown with framework telemetry. The user never wants to see `change_type: configure` in their delivery; the framework wants typed fields. Sidecar separates them cleanly.
3. The four frontmatter-aware validators are now defending a contract that's about to change. Without migration they keep working but stay coupled to a deprecated shape.
4. There's no end-to-end test for `capability_modify` post-fu3. The first production capability failure IS the integration test today. Add the test now, before the next failure.
5. **(Added 2026-05-02 from incident report)** `automation-processor.ts:136` carries a stale heuristic from M9-S3.1 (Apr 2) that downgrades successful jobs to `failed` when the model's response stream is short. fu1 (Apr 27) added an explicit anti-narration directive to the worker prompt template. Workers correctly suppress narration → response stream is empty → heuristic false-positive-flags `empty_deliverable` even when `deliverable.md` is fine on disk. Triggered today on the roadmap-update worker; will keep firing until the heuristic reads from the on-disk truth instead of the response stream. See [`post-fu3-side-effect-worker-incident.md`](post-fu3-side-effect-worker-incident.md).
6. **(Added 2026-05-02)** Worker SDK transcripts ARE persisted at `~/.claude/projects/<encoded-cwd>/<sdk-session-id>.jsonl` (full turn-by-turn audit trail), but the brain has no visibility into where they live. For audit purposes (CTO-only), surface the transcript path through the worker → notification → action-request prompt body chain via a new `audit.transcript_path` field on `result.json`.

---

## Design principle

**One writer per file. Markdown is for humans. JSON is for the framework.**

- `deliverable.md` is plain markdown the user sees. The worker writes it via Write tool. Nothing else writes it.
- `result.json` (sidecar in the same `run_dir`) is structured worker telemetry. Workers write capability metadata via Write tool; the framework writes audit metadata (`audit.transcript_path`, `audit.session_id`) post-run. The framework reads the file for validators, paper-trail, recovery-orchestrator, and prompt construction.
- The worker writes BOTH files when it's a capability worker (markdown body + structured fields). The worker writes ONLY `deliverable.md` when it's a generic/research worker; the framework still creates `result.json` with audit fields after the run.

---

## Scope — files changed

| Action | File | Change |
|---|---|---|
| Modify | `packages/dashboard/src/automations/automation-executor.ts:649-672` | DELETE the post-run chart augmentation block. Workers self-serve via existing `chart_tools.create_chart` and embed the URL in their deliverable when writing. |
| Modify | `packages/dashboard/src/automations/todo-templates.ts` (capability_build, capability_modify) | Worker emits BOTH `deliverable.md` (plain markdown) AND `result.json` (typed metadata). Replace "write frontmatter" instructions with explicit two-file pattern. |
| Modify | `packages/dashboard/src/automations/todo-validators.ts` (`completion_report`, `test_executed`, `change_type_set`) | Read structured fields from `result.json` instead of `deliverable.md` frontmatter. |
| Modify | `packages/dashboard/src/automations/automation-executor.ts:1208-1257` (`writePaperTrail`) | Read `change_type` / `test_result` / `provider` / etc. from `result.json` sidecar. |
| Modify | `packages/core/src/capabilities/recovery-orchestrator.ts:766-780` (`readDeliverable`) | Read `change_type` / `test_result` / `hypothesis_confirmed` / `summary` / `surface_required_for_hotreload` from `result.json` sidecar. |
| Modify | `packages/dashboard/CLAUDE.md` | Codify the sidecar convention: structured worker metadata uses `result.json` (JSON, typed). Frontmatter-in-markdown is reserved for static files (capabilities, notebook references, etc.) per the existing normalized metadata standard. |
| Modify | `packages/core/skills/capability-brainstorming/SKILL.md` (and any related capability skill files in `packages/core/skills/`) | Update worker instructions to emit `result.json` alongside `deliverable.md`. **AUDIT BLOCKER 3:** edit the framework source-of-truth, NOT `.my_agent/skills/` (per memory `feedback_framework_skills_source.md` — agent copy gets overwritten on next install). After editing, run the install script (or copy manually) so the agent's `.my_agent/.claude/skills/` reflects the new source. |
| Create | `packages/dashboard/tests/integration/capability-modify-post-fu3.test.ts` | End-to-end test: spawn a capability_modify worker, verify `result.json` written, all four validators pass, paper-trail entry contains correct fields, `recovery-orchestrator.readDeliverable()` returns the right struct. |
| Modify | `packages/dashboard/tests/unit/automations/todo-validators.test.ts` | Update validator tests for the sidecar source. |
| Modify | `packages/dashboard/src/automations/automation-processor.ts:136` | **(Item E — empty-deliverable heuristic fix)** Change `result.work.trim().length < 20` → `result.deliverable.trim().length < 20`. Reads from on-disk truth (already populated by fu3) instead of the response stream that fu1's anti-narration directive correctly silenced. |
| Modify | `packages/dashboard/tests/unit/automations/automation-processor.test.ts` | New tests: success with empty `result.work` + substantive `result.deliverable` → `completed` (not `failed`). Empty both → `failed` (heuristic still works for real misses). |
| Modify | `packages/dashboard/src/automations/automation-executor.ts` (post-`readAndValidateWorkerDeliverable`) | **(Item F — audit metadata in result.json)** After successful worker run, framework writes/merges `result.json` with `audit.transcript_path` (computed: `~/.claude/projects/${encodedCwd}/${sdkSessionId}.jsonl`) and `audit.session_id` (the captured `sdkSessionId`). Encoding rule: `runDir.replace(/[^a-zA-Z0-9-]/g, '-')`. If worker already wrote `result.json` (capability worker), MERGE — don't overwrite. If not (generic/research worker), CREATE `result.json` with just the audit fields. |
| Modify | `packages/dashboard/src/automations/heartbeat-service.ts` (`formatNotification.job_completed`) | **(Item G — surface transcript path in action-request prompt)** Read `result.json` from the run_dir; if `audit.transcript_path` present, append a line to the action-request prompt: `Audit trail: ${audit.transcript_path}`. The brain sees it inline near the deliverable content; available for reference but not used unprompted. |
| Modify | `packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts` | Test: prompt body includes `Audit trail:` line when `result.json` has `audit.transcript_path`. Prompt body omits the line when absent (graceful — no broken `Audit trail: undefined`). |

---

## Testing strategy (CRITICAL — addresses CTO concern about branch-testing)

S4.3 develops on a branch while S4.2 is in soak on master. Three layers of validation pre-merge, **none of which require redirecting the production soak:**

### Layer 1: Unit + integration tests on the branch

```bash
cd packages/dashboard
npx tsc --noEmit && npx vitest run
```

Covers: validator logic (read from `result.json`), template assembly (capability_build/modify emit two files), paper-trail field extraction, recovery-orchestrator readDeliverable, the new e2e test (Task 5 below).

Confidence floor: every code change is tested. If this passes, the branch is unit-correct.

### Layer 2: New end-to-end test (Task 5)

A vitest integration test that exercises the full capability_modify chain:
1. Fresh test harness spawns a `capability_modify` worker via the same code path production uses (`spawnAutomation` → executor → worker MCP)
2. Mock SDK writes both `deliverable.md` (markdown body) and `result.json` (`{change_type, test_result, summary}`) to the run dir
3. Assertions: validator gates pass, paper-trail entry written with correct fields, `readDeliverable()` returns struct with all expected keys

This test was the deferred item the audit flagged. Lands as part of S4.3, locks the new contract long-term, and acts as the integration gate this sprint never had.

### Layer 3: Dev-mode dashboard smoke (optional, recommended)

If the dev wants live-fire confidence beyond mocks, run a SECOND dashboard instance on the branch in dev mode:

```bash
cd packages/dashboard
PORT=4322 npm run dev
```

Production stays at port 4321 on master; dev runs at 4322 on the S4.3 branch. Fire the soak-probe against the dev port:

```bash
DASHBOARD=http://localhost:4322 ./scripts/soak-probe.sh chiang-mai-aqi-worker
```

This exercises the chart-augmentation change (Item A) on real worker output without touching production.

For capability changes (Item B): no live capability is firing today (no STT/TTS/etc. failures observed), so synthetic fires via the dev-mode dashboard's `/api/automations/:id/fire` are the way to exercise the capability_modify path live. Optional; the e2e test in Layer 2 covers correctness.

### What is NOT testable on a branch

- **Production conversational gravity** — only master's soak surfaces this. fu3's existing 7-day soak handles it.
- **Real STT/TTS/etc. capability failures** — these are environmental, infrequent, and not on a schedule. The e2e test mocks the spawn path.

Both gaps are acceptable. The S4.3 changes don't affect the morning brief delivery surface (that's generic/research workers; S4.3 changes capability workers). Production soak signal is orthogonal.

---

## Tasks

### Task 1 — Worktree

- [ ] **1.1: Create worktree**

```bash
cd ~/my_agent
git worktree add ../my_agent-s4.3 -b sprint/m9.4-s4.3-worker-pipeline-cleanup
cd ../my_agent-s4.3
```

---

### Task 2 — Item A: chart augmentation as worker self-service

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts:649-672`
- Modify: `packages/dashboard/src/automations/todo-templates.ts` (`generic` template — add chart-todo; `research` already has it at line 86)

> **AUDIT BLOCKER 1 — read before starting.** Pre-audit, the plan deleted the auto-augmentation block and added a single soft hint to the system prompt. Audit found this would silently break charts on `chiang-mai-aqi-worker` and other `generic` workers in production: the morning brief currently embeds `![chiang-mai-aqi-worker chart](...)` (the literal string from `automation-executor.ts:698`), proving those workers rely on the auto-path, NOT a worker-side `create_chart` call. The `generic` template (`todo-templates.ts:53-69`) has zero chart instructions today. The fix below adds an explicit per-todo chart instruction to `generic` and `research` (research already has it; copy/align), AND requires a soak-probe smoke before merge.

- [ ] **2.1: Delete the post-run chart augmentation block** (`automation-executor.ts:649-672`)

This is the third writer of `deliverable.md`. Workers will self-serve via existing `chart_tools.create_chart` (returns URL); the worker embeds `![chart](url)` in `deliverable.md` when calling Write.

- [ ] **2.2: Add an explicit chart todo to the `generic` template**

In `packages/dashboard/src/automations/todo-templates.ts`, the `generic` template (around lines 53-69) is missing the chart instruction. The `research` template at line 86 already has the right pattern. Copy that pattern into `generic`:

```typescript
// In generic template, add a todo before the final "Write deliverable.md" step:
{
  text: "Does your output contain numeric data, comparisons, or trends? If you have the create_chart tool, call mcp__chart-tools__create_chart with an SVG and embed the returned URL inline in your deliverable.md as ![chart description](url). If no numeric data or no chart tool available, mark done with a note explaining why.",
  mandatory: false,
}
```

If `research` template's exact wording differs, mirror it — keep the two templates in sync on this todo so future refactors don't drift them apart.

- [ ] **2.3: Smoke-test against `chiang-mai-aqi-worker` BEFORE merge** (soak-probe Trigger 1)

Spin up a dev-mode dashboard at port 4322:
```bash
cd packages/dashboard
PORT=4322 npm run dev
```

In another terminal, fire the brief feeder worker against the dev port and inspect its deliverable for an embedded chart:
```bash
DASHBOARD=http://localhost:4322 ./scripts/soak-probe.sh chiang-mai-aqi-worker
# Wait for completion, then:
LATEST_RUN=$(ls -td ~/my_agent/.my_agent/automations/.runs/chiang-mai-aqi-worker/* | head -1)
grep -E '!\[.*chart.*\]\(' "$LATEST_RUN/deliverable.md" || echo "NO CHART — fix before merge"
```

If the deliverable has no `![...chart...](url)` line: the prompt isn't strong enough OR the worker isn't calling `create_chart`. Iterate on the template wording until charts appear consistently. Block merge until 3 consecutive runs all embed a chart.

> **Why this is a merge gate:** the morning brief has been embedding charts daily since this code shipped. Pre-merge verification is the only way to know post-Item-A workers still produce them. The soak signal on master would catch a regression but only AFTER one or more morning briefs land chartless — too late.

- [ ] **2.4: Run unit tests + typecheck**

- [ ] **2.5: Commit**

```bash
git add packages/dashboard/src/automations/automation-executor.ts \
        packages/dashboard/src/automations/todo-templates.ts
git commit -m "fix(s4.3): chart augmentation as worker self-service

DELETE the post-run chart code at automation-executor.ts:649-672.
This was the third independent writer of deliverable.md (after the
worker via Write tool and — pre-fu3 — the executor via overwrite).
Post-fu3 it was enrichment-not-corruption (read worker's clean file
and appended), but it still violated the single-writer principle.

Add explicit chart todo to the 'generic' template (the 'research'
template already has it). Workers self-serve via existing
mcp__chart-tools__create_chart and embed the returned URL inline
when writing deliverable.md.

Smoke-tested against chiang-mai-aqi-worker on a dev-mode dashboard:
3+ consecutive runs all embed ![chart](url) in deliverable.md.

One write path per file."
```

---

### Task 3 — Item B: capability template + validator migration to result.json sidecar

**Files:**
- Modify: `packages/dashboard/src/automations/todo-templates.ts` (capability_build, capability_modify)
- Modify: `packages/dashboard/src/automations/todo-validators.ts` (completion_report, test_executed, change_type_set)
- Test: `packages/dashboard/tests/unit/automations/todo-validators.test.ts`

- [ ] **3.1: Write failing tests for the new validator behavior**

For each of `completion_report`, `test_executed`, `change_type_set`:
- Test that the validator reads from `${runDir}/result.json` (not from `deliverable.md` frontmatter)
- Test that it returns `pass: false` with a clear message when `result.json` is missing
- Test that it returns `pass: false` when the required field is absent or invalid

```typescript
// Example test for completion_report
it("completion_report reads change_type from result.json sidecar", () => {
  fs.writeFileSync(path.join(runDir, "result.json"),
    JSON.stringify({ change_type: "configure", test_result: "pass", summary: "..." }));
  const result = runValidation("completion_report", runDir);
  expect(result.pass).toBe(true);
});

it("completion_report fails when result.json is missing", () => {
  // No result.json
  const result = runValidation("completion_report", runDir);
  expect(result.pass).toBe(false);
  expect(result.message).toMatch(/result\.json/);
});

it("completion_report fails when change_type is unknown", () => {
  fs.writeFileSync(path.join(runDir, "result.json"),
    JSON.stringify({ change_type: "unknown" }));
  const result = runValidation("completion_report", runDir);
  expect(result.pass).toBe(false);
});
```

- [ ] **3.2: Run, confirm FAIL** (validators currently read from deliverable.md frontmatter)

- [ ] **3.3: Implement the validator changes**

Each of the three validators: replace `readFrontmatter(path.join(runDir, "deliverable.md"))` with `readJson(path.join(runDir, "result.json"))`. Update error messages accordingly.

`capability_frontmatter` validator stays unchanged — it validates `CAPABILITY.md` in the target dir, not the deliverable.

- [ ] **3.4: Update `capability_build` and `capability_modify` templates**

Replace todos that say "write deliverable.md frontmatter" with two separate todos:
1. "Use the Write tool to emit `deliverable.md` as plain markdown — the user-facing change summary, what to do next, etc. No frontmatter."
2. "Use the Write tool to emit `result.json` with `{change_type, test_result, summary}` (capability_modify) or `{change_type, test_result, summary, files_changed}` (capability_build)."

- [ ] **3.5: Update the capability-brainstorming skill source**

> **AUDIT BLOCKER 3:** Edit `packages/core/skills/capability-brainstorming/SKILL.md` (framework source), NOT `.my_agent/skills/capability-brainstorming/SKILL.md` (agent copy). Per memory `feedback_framework_skills_source.md`: agent copies get overwritten on next install. The framework `packages/core/skills/` is the source-of-truth.

Find the section that instructs the worker to write YAML frontmatter into `deliverable.md` (search for `change_type` or `frontmatter` in the SKILL.md file). Replace with:

> *"Emit two files in the run dir:*
> - *`deliverable.md` — plain markdown for the user. The change summary, what was done, what to do next. No YAML header.*
> - *`result.json` — typed framework metadata. Object with `change_type` (one of: `configure`, `upgrade`, `fix`, `replace`), `test_result` (one of: `pass`, `fail`, `skipped`), `summary` (1-2 sentence string), and (capability_build only) `files_changed` (array of relative paths). Use the Write tool for both."*

After editing, sync to the agent install:

```bash
# Run the project's skill-install script if one exists, or copy manually:
cp -r packages/core/skills/capability-brainstorming/* ~/my_agent/.my_agent/.claude/skills/capability-brainstorming/
```

Verify the agent copy now reflects the framework source:
```bash
diff packages/core/skills/capability-brainstorming/SKILL.md ~/my_agent/.my_agent/.claude/skills/capability-brainstorming/SKILL.md
# Should be empty (no diff)
```

- [ ] **3.6: Run tests, confirm PASS**

- [ ] **3.7: Commit**

```bash
git add packages/dashboard/src/automations/todo-templates.ts \
        packages/dashboard/src/automations/todo-validators.ts \
        packages/dashboard/tests/unit/automations/todo-validators.test.ts
git commit -m "feat(s4.3): capability metadata migrates to result.json sidecar

Templates: capability_build and capability_modify workers now write
TWO files — deliverable.md (plain markdown for the user) and
result.json (typed metadata for the framework).

Validators: completion_report, test_executed, change_type_set now
read from result.json sidecar. capability_frontmatter unchanged
(validates CAPABILITY.md in target dir, not deliverable).

Worker contract: deliverable.md is for humans, result.json is for
the framework. One writer per file. The post-fu3 capability audit
confirmed the existing frontmatter path works — this migration is
code-cleanliness, not a correctness fix."
```

---

### Task 4 — Item B continued: paper-trail + recovery-orchestrator

**Files:**
- Modify: `packages/dashboard/src/automations/automation-executor.ts:1208-1257` (`writePaperTrail`)
- Modify: `packages/core/src/capabilities/recovery-orchestrator.ts:766-780` (`readDeliverable`)

- [ ] **4.1: Write failing tests** (or update existing) — assert paper trail and recovery-orchestrator read from `result.json`

- [ ] **4.2: Update `writePaperTrail`** — replace `parseFrontmatterContent(deliverableString)` with `JSON.parse(fs.readFileSync(path.join(runDir, "result.json"), "utf-8"))`. Same field names; same DECISIONS.md format.

- [ ] **4.3: Update `recovery-orchestrator.readDeliverable()`** — same shape. Read from `result.json`.

- [ ] **4.4: Run tests, confirm PASS**

- [ ] **4.5: Commit**

```bash
git add packages/dashboard/src/automations/automation-executor.ts \
        packages/core/src/capabilities/recovery-orchestrator.ts \
        packages/dashboard/tests/unit/automations/automation-executor.test.ts \
        packages/dashboard/tests/unit/capabilities/recovery-orchestrator.test.ts
git commit -m "feat(s4.3): paper trail + recovery orchestrator read result.json sidecar"
```

---

### Task 5 — Item D: end-to-end test for capability_modify post-fu3

**Files:**
- Create: `packages/dashboard/tests/integration/capability-modify-post-fu3.test.ts`

> **AUDIT BLOCKER 2 — read before starting.** The pre-audit version of this test called `AppHarness.create({ withCfr: true })` and `harness.app.cfr.spawnAutomation(...)`. **Neither exists.** `AppHarnessOptions` (at `app-harness.ts:83-90`) defines `withMemory`, `withAutomations`, `agentDir` only. `spawnAutomation` is a `RecoveryOrchestrator` constructor arg (per `app.ts:758`), not a `CfrEmitter` method. The harness wires `cfr: new CfrEmitter()` inline at line 184 but does NOT create a `RecoveryOrchestrator` for tests.
>
> **The fix:** rewrite the test to use existing harness APIs. Spawn the capability worker via `harness.automationManager.create({...})` directly with the `capability_modify` manifest, then `harness.automationProcessor.fire(automation.id)`. This proves the same chain (`assembleJobTodos` → `runValidation` → `readAndValidateWorkerDeliverable` → `writePaperTrail` → `recovery-orchestrator.readDeliverable`) without needing a non-existent `spawnAutomation` API.

- [ ] **5.1: Write the e2e test using existing harness APIs**

```typescript
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AppHarness } from "./app-harness.js";
import { installMockSession } from "./mock-session.js";
import { readDeliverable } from "../../../core/src/capabilities/recovery-orchestrator.js";

describe("capability_modify post-fu3 end-to-end (Item D)", () => {
  it("worker emits deliverable.md + result.json → validators pass → paper trail records fields → readDeliverable returns the struct", async () => {
    const harness = await AppHarness.create({ withAutomations: true });

    // 1. Stage a target capability folder under the harness's agent dir
    const targetPath = path.join(harness.agentDir, "capabilities", "stt-deepgram");
    fs.mkdirSync(targetPath, { recursive: true });
    fs.writeFileSync(path.join(targetPath, "CAPABILITY.md"),
      "---\nname: stt-deepgram\nprovides: audio-to-text\ninterface: tool\n---\n");

    // 2. Install mock SDK that writes BOTH files when the worker runs
    installMockSession(harness, {
      onWorkerRun: async (job) => {
        // capability_modify worker writes two files (post-S4.3 contract):
        fs.writeFileSync(
          path.join(job.run_dir, "deliverable.md"),
          "## STT Deepgram fix\n\nReverted the API key rotation that broke transcription. Tested with a 12s sample; output JSON is well-formed.",
        );
        fs.writeFileSync(
          path.join(job.run_dir, "result.json"),
          JSON.stringify({
            change_type: "configure",
            test_result: "pass",
            summary: "API key rotation reverted; transcription verified.",
          }),
        );
        // status-report.md (status_report validator)
        fs.writeFileSync(
          path.join(job.run_dir, "status-report.md"),
          "# Job complete\n\nDelivered.",
        );
      },
    });

    // 3. Create the capability_modify automation manifest directly
    const auto = await harness.automationManager.create({
      manifest: {
        name: "test-capability-modify",
        job_type: "capability_modify",
        target_path: targetPath,
        notify: "none",
        trigger: [{ type: "manual" }],
        once: true,
      },
    });

    // 4. Fire via the production processor path
    await harness.automationProcessor.fire(auto.id);

    // 5. Wait for the job to settle
    const job = await harness.waitForJobStatus(auto.id, "completed");

    // 6. Assertions

    // Files exist
    expect(fs.existsSync(path.join(job.run_dir, "deliverable.md"))).toBe(true);
    expect(fs.existsSync(path.join(job.run_dir, "result.json"))).toBe(true);

    // Paper trail wrote a DECISIONS.md entry into the target dir
    const decisions = fs.readFileSync(path.join(targetPath, "DECISIONS.md"), "utf-8");
    expect(decisions).toMatch(/change_type.*configure/);
    expect(decisions).toMatch(/test_result.*pass/);

    // recovery-orchestrator.readDeliverable returns the struct from result.json
    const result = readDeliverable(job.run_dir);
    expect(result.change_type).toBe("configure");
    expect(result.test_result).toBe("pass");
    expect(result.summary).toContain("API key rotation");

    await harness.shutdown();
  });

  it("fails loud when result.json is missing (validator rejects)", async () => {
    const harness = await AppHarness.create({ withAutomations: true });
    const targetPath = path.join(harness.agentDir, "capabilities", "test-cap");
    fs.mkdirSync(targetPath, { recursive: true });
    fs.writeFileSync(path.join(targetPath, "CAPABILITY.md"),
      "---\nname: test-cap\nprovides: foo\ninterface: tool\n---\n");

    installMockSession(harness, {
      onWorkerRun: async (job) => {
        // Worker writes ONLY deliverable.md, no result.json
        fs.writeFileSync(
          path.join(job.run_dir, "deliverable.md"),
          "## Cap fix\n\nDid the work but forgot to emit result.json.",
        );
      },
    });

    const auto = await harness.automationManager.create({
      manifest: { name: "test-missing-result", job_type: "capability_modify", target_path: targetPath, notify: "none", trigger: [{ type: "manual" }], once: true },
    });

    await harness.automationProcessor.fire(auto.id);
    const job = await harness.waitForJobStatus(auto.id);
    expect(["failed", "needs_review"]).toContain(job.status);
    await harness.shutdown();
  });

  it("fails loud when result.json has unknown change_type", async () => {
    const harness = await AppHarness.create({ withAutomations: true });
    const targetPath = path.join(harness.agentDir, "capabilities", "test-cap-2");
    fs.mkdirSync(targetPath, { recursive: true });
    fs.writeFileSync(path.join(targetPath, "CAPABILITY.md"),
      "---\nname: test-cap-2\nprovides: foo\ninterface: tool\n---\n");

    installMockSession(harness, {
      onWorkerRun: async (job) => {
        fs.writeFileSync(path.join(job.run_dir, "deliverable.md"), "## Cap fix\n\nBody text.");
        fs.writeFileSync(path.join(job.run_dir, "result.json"),
          JSON.stringify({ change_type: "unknown", test_result: "pass", summary: "..." }));
      },
    });

    const auto = await harness.automationManager.create({
      manifest: { name: "test-bad-change-type", job_type: "capability_modify", target_path: targetPath, notify: "none", trigger: [{ type: "manual" }], once: true },
    });

    await harness.automationProcessor.fire(auto.id);
    const job = await harness.waitForJobStatus(auto.id);
    expect(["failed", "needs_review"]).toContain(job.status);
    await harness.shutdown();
  });
});
```

> **Note on `installMockSession.onWorkerRun`:** if this hook doesn't exist in the current mock-session API, extend it as a small sub-task. The mock should expose a callback that runs INSIDE the SDK loop where the worker would normally call its tools. This is a one-helper extension, not the full `withCfr` harness build the original plan implied.

- [ ] **5.2: Verify `harness.waitForJobStatus` exists** (the existing tests use this pattern; confirm by grep). If it doesn't, the equivalent is a polling loop on `harness.automationJobService.getJob(autoId)` checking `status`. ~10 lines of helper code at the top of the test file.

- [ ] **5.3: Run test, confirm PASS**

- [ ] **5.4: Commit**

```bash
git add packages/dashboard/tests/integration/capability-modify-post-fu3.test.ts \
        packages/dashboard/tests/integration/mock-session.ts  # if extended
git commit -m "test(s4.3): e2e for capability_modify with result.json sidecar

Locks the post-fu3 capability worker contract. Was a deferred item
from the post-fu3 capability implications audit (no e2e test
existed for the full spawn → deliverable + result.json → validators
→ paper trail → recovery orchestrator chain).

Three cases: happy path, missing result.json, invalid change_type.

Uses existing harness APIs (automationManager.create +
automationProcessor.fire + waitForJobStatus) rather than the
non-existent withCfr/spawnAutomation pair the original plan
projected. Same chain coverage; smaller harness extension."
```

---

### Task 6 — Item C: codify sidecar convention

**Files:**
- Modify: `packages/dashboard/CLAUDE.md`

- [ ] **6.1: Add a "Worker output contract" section**

```markdown
## Worker Output Contract (M9.4-S4.3)

Each worker run produces:

| File | Format | Purpose | Reader |
|---|---|---|---|
| `deliverable.md` | Plain markdown | User-facing content | summary-resolver, debrief aggregator, dashboard UI |
| `result.json` | JSON | Typed framework telemetry | validators (completion_report, test_executed, change_type_set), paper-trail writer, recovery-orchestrator |
| `status-report.md` | Markdown | Internal post-mortem | status_report validator |
| `todos.json` | JSON | Worker-runtime task tracking | todo MCP server |

**Rules:**

- One writer per file. Workers write `deliverable.md` and (for capability workers) `result.json` via the Write tool. The framework never overwrites them.
- Markdown is for humans. JSON is for the framework. Don't conflate by writing structured fields as YAML frontmatter inside markdown.
- Frontmatter-in-markdown remains the standard for STATIC files (CAPABILITY.md, notebook references, automation manifests). Sidecar JSON is for STRUCTURED-DATA-NEXT-TO-MARKDOWN at runtime.
```

- [ ] **6.2: Update Migration plan section in worker-pipeline-redesign.md** to point at S4.3 closeout

- [ ] **6.3: Commit**

```bash
git add packages/dashboard/CLAUDE.md \
        docs/sprints/m9.4-s4.2-action-request-delivery/worker-pipeline-redesign.md
git commit -m "docs(s4.3): codify the worker output contract — markdown for humans, JSON for framework"
```

---

### Task 7 — Item E: empty-deliverable heuristic reads from on-disk truth

**File:** `packages/dashboard/src/automations/automation-processor.ts:136`
**Test:** `packages/dashboard/tests/unit/automations/automation-processor.test.ts`

The pre-fu3 heuristic (added 2026-04-02 in commit `ec948f8`, M9-S3.1) checks `result.work.trim().length < 20` to detect "empty deliverable" jobs. fu1 (Apr 27) added an explicit anti-narration directive (`Do NOT narrate your process — emit the report only`). Workers correctly suppress narration → `result.work` empty → heuristic false-positive-flags `empty_deliverable`. Today (2026-05-02) it fired on the roadmap-update worker; the file was on disk and substantive, but the job ended `status: failed`.

The on-disk `deliverable.md` is the source of truth post-fu3. `result.deliverable` is already populated by `readAndValidateWorkerDeliverable` (`automation-executor.ts:75`). Point the heuristic at the truth.

- [ ] **7.1: Write failing test**

```typescript
// tests/unit/automations/automation-processor.test.ts (extend if exists; create if not)
import { describe, it, expect, vi } from "vitest";
import { AutomationProcessor } from "../../../src/automations/automation-processor.js";

describe("AutomationProcessor — empty-deliverable heuristic (M9.4-S4.3 Item E)", () => {
  it("does NOT downgrade success when result.work is empty but result.deliverable is substantive", async () => {
    // Worker correctly suppressed narration (per fu1 directive); deliverable on disk is good.
    const mockExecutor = {
      run: vi.fn(async () => ({
        success: true,
        work: "",  // anti-narration directive working
        deliverable: "## Report\n\n**AQI: 145**\n\nFull body content here, well over 20 chars.",
        error: null,
      })),
    };
    const mockJobService = makeMockJobService();
    const processor = new AutomationProcessor({ executor: mockExecutor, jobService: mockJobService, /* ... */ });

    await processor.process(automation, job);

    expect(mockJobService.getJob(job.id).status).toBe("completed");
    expect(mockJobService.getJob(job.id).status).not.toBe("failed");
  });

  it("DOES downgrade when both result.work AND result.deliverable are empty (heuristic still catches real misses)", async () => {
    const mockExecutor = {
      run: vi.fn(async () => ({
        success: true,
        work: "",
        deliverable: "",
        error: null,
      })),
    };
    const mockJobService = makeMockJobService();
    const processor = new AutomationProcessor({ executor: mockExecutor, jobService: mockJobService, /* ... */ });

    await processor.process(automation, job);

    expect(mockJobService.getJob(job.id).status).toBe("failed");
    expect(mockJobService.getJob(job.id).summary).toMatch(/empty deliverable/i);
  });

  it("DOES downgrade when result.deliverable is whitespace-only (≤20 chars after trim)", async () => {
    const mockExecutor = {
      run: vi.fn(async () => ({
        success: true,
        work: "verbose model thinking that doesn't matter",
        deliverable: "    \n  \n",
        error: null,
      })),
    };
    const mockJobService = makeMockJobService();
    const processor = new AutomationProcessor({ executor: mockExecutor, jobService: mockJobService, /* ... */ });

    await processor.process(automation, job);

    expect(mockJobService.getJob(job.id).status).toBe("failed");
  });

  // AUDIT TIGHTENING 1: handler-based automations don't go through the SDK worker
  // path; they return result.deliverable from code (potentially null for
  // empty-by-design summaries). The heuristic should NOT fire for handlers.
  it("does NOT downgrade handler-based automation with success: true and deliverable: null (handler-skip)", async () => {
    const handlerAutomation = {
      ...automation,
      manifest: { ...automation.manifest, handler: "monthly-summary" },  // handler-based
    };
    const mockExecutor = {
      run: vi.fn(async () => ({
        success: true,
        work: "Quiet month.",         // legitimately short
        deliverable: null,            // handler returns no on-disk deliverable
        error: null,
      })),
    };
    const mockJobService = makeMockJobService();
    const processor = new AutomationProcessor({ executor: mockExecutor, jobService: mockJobService, /* ... */ });

    await processor.process(handlerAutomation, job);

    // Handler is authoritative; processor must NOT second-guess via the heuristic
    expect(mockJobService.getJob(job.id).status).toBe("completed");
  });
});
```

- [ ] **7.2: Run, confirm 2-of-3 FAIL** (the empty-both case may already pass; the substantive-deliverable case definitely fails today)

- [ ] **7.3: Apply the patch**

> **AUDIT TIGHTENING 1:** original two-line patch left handler-based automations exposed (handlers can legitimately return `deliverable: null` with `success: true`). Add a handler-skip clause so the heuristic only fires for SDK-worker automations.

```diff
- if (result.success && (!result.work || result.work.trim().length < 20)) {
+ // M9.4-S4.3 Item E: heuristic reads on-disk truth (result.deliverable),
+ // not the response stream (result.work, which fu1's anti-narration
+ // directive correctly silences). Handlers (manifest.handler set) are
+ // authoritative — they don't go through the worker-deliverable contract,
+ // so skip the heuristic for them.
+ const isHandlerBased = !!automation.manifest.handler;
+ if (
+   !isHandlerBased &&
+   result.success &&
+   (!result.deliverable || result.deliverable.trim().length < 20)
+ ) {
```

- [ ] **7.4: Run, confirm PASS** (all 3 tests + existing tests in the file)

- [ ] **7.5: Commit**

```bash
git add packages/dashboard/src/automations/automation-processor.ts \
        packages/dashboard/tests/unit/automations/automation-processor.test.ts
git commit -m "fix(s4.3-itemE): empty-deliverable heuristic reads on-disk file, not response stream

The check at automation-processor.ts:136 (added 2026-04-02 in
ec948f8, M9-S3.1) was downgrading successful jobs to status:failed
because it inspected result.work (the assistant text-block stream).
fu1 (Apr 27) added an anti-narration directive to worker prompts;
workers correctly suppress narration → result.work empty →
heuristic false-positive on every silent worker.

Post-fu3, deliverable.md on disk is the source of truth. result.deliverable
is populated by readAndValidateWorkerDeliverable. The heuristic now
reads the on-disk content via that field. Empty-real-deliverable
detection still works (test 2 + test 3); silent-worker-with-good-
deliverable is no longer false-flagged (test 1).

Surfaced by 2026-05-02 incident with the update-relocation-roadmap
worker. See post-fu3-side-effect-worker-incident.md for the full
investigation."
```

---

### Task 8 — Item F: audit metadata in result.json

**File:** `packages/dashboard/src/automations/automation-executor.ts` (post-`readAndValidateWorkerDeliverable`)
**Test:** `packages/dashboard/tests/unit/automations/automation-executor.test.ts`

After a successful worker run, the framework writes `audit.transcript_path` and `audit.session_id` into `result.json` so the brain can reference the SDK transcript for audit. The transcript itself lives at `~/.claude/projects/${encoded(runDir)}/${sdkSessionId}.jsonl` (Agent SDK convention; verified empirically against `~/.claude/projects/-home-nina-my-agent--my-agent-automations--runs-update-relocation-roadmap-job-7ed578ce.../552f10ca-....jsonl` — encoding rule: `runDir.replace(/[^a-zA-Z0-9-]/g, '-')`).

If the worker already wrote `result.json` (capability worker, post-Task 3), MERGE the audit fields into the existing JSON. If not (generic/research worker), CREATE `result.json` with just the audit fields.

- [ ] **8.1: Write failing test**

```typescript
describe("AutomationExecutor — audit metadata in result.json (M9.4-S4.3 Item F)", () => {
  it("creates result.json with audit fields when worker didn't write one (generic/research worker)", () => {
    // Worker writes only deliverable.md (Strategy B mock)
    // After run completes, expect result.json with audit.transcript_path + audit.session_id
    // ...
    expect(fs.existsSync(path.join(runDir, "result.json"))).toBe(true);
    const result = JSON.parse(fs.readFileSync(path.join(runDir, "result.json"), "utf-8"));
    expect(result.audit).toBeDefined();
    expect(result.audit.session_id).toBe(capturedSdkSessionId);
    expect(result.audit.transcript_path).toMatch(/\.claude\/projects\/.*\.jsonl$/);
  });

  it("MERGES audit fields when worker already wrote result.json (capability worker)", () => {
    // Worker writes both deliverable.md AND result.json with capability fields
    // result.json before merge: { change_type: "configure", test_result: "pass" }
    // After framework merge: { change_type: "configure", test_result: "pass", audit: { ... } }
    // ...
    const result = JSON.parse(fs.readFileSync(path.join(runDir, "result.json"), "utf-8"));
    expect(result.change_type).toBe("configure");  // worker's data preserved
    expect(result.test_result).toBe("pass");       // worker's data preserved
    expect(result.audit.transcript_path).toBeDefined();  // framework added
  });

  it("computes the encoded transcript path per SDK convention (non-alphanumeric → dash)", () => {
    const runDir = "/home/test/my_agent/.my_agent/automations/.runs/foo/job-abc";
    const expectedEncoded = "-home-test-my-agent--my-agent-automations--runs-foo-job-abc";
    const sdkSessionId = "deadbeef-cafe-1234-5678-abcdefabcdef";
    const expectedPath = `${HOME}/.claude/projects/${expectedEncoded}/${sdkSessionId}.jsonl`;
    expect(buildTranscriptPath(runDir, sdkSessionId)).toBe(expectedPath);
  });

  it("does NOT touch result.json on job failure (audit only on success)", () => {
    // Worker run throws; readAndValidateWorkerDeliverable not called; result.json unchanged
  });

  // AUDIT TIGHTENING 2 (collision case): if a worker writes its OWN audit field,
  // the framework's audit field MUST overwrite it. Framework owns the session_id;
  // worker doesn't have authoritative knowledge of the SDK session.
  it("framework's audit field overwrites worker-written audit (no merge of audit subkeys)", () => {
    // Worker writes result.json with both real metadata AND a bogus audit object
    fs.writeFileSync(
      path.join(runDir, "result.json"),
      JSON.stringify({
        change_type: "configure",
        audit: { foo: "worker-bogus", session_id: "worker-fabricated-id" },
      }),
    );
    // Framework runs writeAuditMetadata with the real sdkSessionId
    writeAuditMetadata(runDir, "real-sdk-session-id");
    const result = JSON.parse(fs.readFileSync(path.join(runDir, "result.json"), "utf-8"));
    expect(result.change_type).toBe("configure");           // worker's data preserved
    expect(result.audit.session_id).toBe("real-sdk-session-id");  // framework's wins
    expect(result.audit.foo).toBeUndefined();               // worker's bogus subkeys gone
  });
});
```

- [ ] **8.2: Run, confirm FAIL**

- [ ] **8.3: Implement the audit metadata write**

Add a helper function in `automation-executor.ts`:

```typescript
import os from "node:os";

/**
 * Compute the path to the SDK session transcript for a given run dir + session id.
 * Agent SDK encoding: ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 * Where encoded-cwd = cwd with every non-alphanumeric character (except dash) replaced by dash.
 *
 * Verified empirically against actual SDK output 2026-05-02.
 */
export function buildTranscriptPath(runDir: string, sdkSessionId: string): string {
  const encoded = runDir.replace(/[^a-zA-Z0-9-]/g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded, `${sdkSessionId}.jsonl`);
}

/**
 * Merge audit fields into result.json. If the file exists (capability worker wrote
 * structured metadata), preserve those fields and add audit. If not (generic/research
 * worker), create a new file with just audit.
 *
 * M9.4-S4.3 AUDIT TIGHTENING 2: probe the computed transcript_path with
 * fs.existsSync. If the SDK encoding rule drifts (e.g. release change, non-ASCII
 * path), the file we point to won't exist. Log a warning so this is detectable
 * in production telemetry; do NOT fail the job (the path is reference-only).
 */
export function writeAuditMetadata(runDir: string, sdkSessionId: string): void {
  const resultJsonPath = path.join(runDir, "result.json");
  const transcriptPath = buildTranscriptPath(runDir, sdkSessionId);

  // Falsifiability probe — SDK encoding rule could drift; don't silently rot.
  if (!fs.existsSync(transcriptPath)) {
    console.warn(
      `[AutomationExecutor] audit.transcript_path computed but file does not exist: ` +
      `${transcriptPath}. SDK encoding rule may have changed; investigate.`,
    );
  }

  const audit = {
    session_id: sdkSessionId,
    transcript_path: transcriptPath,
  };

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(resultJsonPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(resultJsonPath, "utf-8"));
    } catch (err) {
      console.warn(`[AutomationExecutor] result.json malformed at ${resultJsonPath}, overwriting:`, err);
    }
  }

  // Framework owns the audit field — overwrite if the worker wrote one too
  // (collision case; framework has the authoritative session_id).
  const merged = { ...existing, audit };
  fs.writeFileSync(resultJsonPath, JSON.stringify(merged, null, 2), "utf-8");
}
```

Wire it into the executor's success path, AFTER `readAndValidateWorkerDeliverable` succeeds and BEFORE the chart augmentation (so the chart code path doesn't have to know about audit metadata):

```typescript
// In runWorker, around line 660:
if (job.run_dir) {
  deliverablePath = path.join(job.run_dir, "deliverable.md");
  finalDeliverable = readAndValidateWorkerDeliverable(job.run_dir);
  // M9.4-S4.3 Item F: audit metadata for brain visibility into SDK transcripts
  if (sdkSessionId) {
    writeAuditMetadata(job.run_dir, sdkSessionId);
  }
}
```

- [ ] **8.4: Run, confirm PASS**

- [ ] **8.5: Commit**

```bash
git add packages/dashboard/src/automations/automation-executor.ts \
        packages/dashboard/tests/unit/automations/automation-executor.test.ts
git commit -m "feat(s4.3-itemF): write audit metadata to result.json (transcript path + session id)

Workers' SDK transcripts are persisted at ~/.claude/projects/<encoded>/<sid>.jsonl
(full turn-by-turn audit trail). The brain has had no way to know
where they live. This adds an audit.transcript_path + audit.session_id
field to result.json post-run.

For capability workers (already write result.json with structured
metadata): MERGE the audit fields, preserving change_type/test_result/etc.
For generic/research workers (only write deliverable.md): CREATE
result.json with just the audit fields.

Encoding rule for the transcript path: cwd.replace(/[^a-zA-Z0-9-]/g, '-')
matches the Agent SDK's convention (verified empirically 2026-05-02)."
```

---

### Task 9 — Item G: surface transcript path in action-request prompt

**File:** `packages/dashboard/src/automations/heartbeat-service.ts` (`formatNotification.job_completed`)
**Test:** `packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts`

The heartbeat reads `result.json` from the run dir at notification-format time and appends a line to the action-request prompt body if `audit.transcript_path` is present. The brain receives the path in its prompt context — available for reference, not used unprompted.

- [ ] **9.1: Write failing test**

```typescript
it("includes 'Audit trail:' line in prompt body when result.json has audit.transcript_path (Item G)", () => {
  // Stage a temp run_dir with deliverable.md + result.json containing audit fields
  const runDir = mkTmpRunDir({
    "deliverable.md": "## Brief\nBody content...",
    "result.json": JSON.stringify({
      audit: { transcript_path: "/home/test/.claude/projects/encoded/sid.jsonl", session_id: "sid" }
    }),
  });
  const prompt = format({
    job_id: "j1",
    automation_id: "morning-brief",
    type: "job_completed",
    summary: "summary",
    run_dir: runDir,
    created: "2026-05-02T07:00:00Z",
    delivery_attempts: 0,
  });
  expect(prompt).toMatch(/Audit trail:.*\.claude\/projects\/.*\.jsonl/);
});

it("omits 'Audit trail:' line when result.json absent (graceful fallback)", () => {
  const runDir = mkTmpRunDir({ "deliverable.md": "## Brief\nBody content..." });
  // No result.json
  const prompt = format({ /* ... run_dir: runDir, ... */ });
  expect(prompt).not.toMatch(/Audit trail:/);
  expect(prompt).not.toMatch(/undefined/);  // no broken interpolation
});

it("omits 'Audit trail:' line when result.json present but lacks audit field", () => {
  const runDir = mkTmpRunDir({
    "deliverable.md": "## Brief\nBody...",
    "result.json": JSON.stringify({ change_type: "configure" }),  // no audit
  });
  const prompt = format({ /* ... */ });
  expect(prompt).not.toMatch(/Audit trail:/);
});

// AUDIT TIGHTENING 3: notification queue is persistent (delivered/ has hundreds
// of files); run_dir on a notification could be archived/pruned between
// job-end and delivery format-time. Format must not crash, must not interpolate
// undefined into the prompt body.
it("omits 'Audit trail:' line gracefully when run_dir no longer exists on disk (stale)", () => {
  const prompt = format({
    job_id: "j1",
    automation_id: "morning-brief",
    type: "job_completed",
    summary: "Body content...",
    run_dir: "/tmp/this-path-was-archived-and-pruned-long-ago",  // doesn't exist
    created: "2026-05-02T07:00:00Z",
    delivery_attempts: 0,
  });
  expect(prompt).not.toMatch(/Audit trail:/);
  expect(prompt).not.toMatch(/undefined/);
  expect(prompt).not.toMatch(/null/);
  // body still delivered:
  expect(prompt).toContain("Body content...");
});
```

- [ ] **9.2: Run, confirm FAIL**

- [ ] **9.3: Update `formatNotification.job_completed`**

```typescript
case "job_completed": {
  // ... existing prompt body construction ...

  // M9.4-S4.3 Item G: surface SDK transcript path for audit (CTO can ask for it)
  let auditLine = "";
  if (n.run_dir) {
    const resultJsonPath = path.join(n.run_dir, "result.json");
    if (fs.existsSync(resultJsonPath)) {
      try {
        const result = JSON.parse(fs.readFileSync(resultJsonPath, "utf-8"));
        if (result?.audit?.transcript_path) {
          auditLine = `\n\nAudit trail: ${result.audit.transcript_path}`;
        }
      } catch {
        // result.json malformed — silently skip; not worth failing the delivery
      }
    }
  }

  return (
    `It's time to deliver TODAY's results from a scheduled background task you (past-you) set up. ` +
    /* ... existing framing ... */
    `\n\nDeliverable content:\n\n---\n${n.summary}\n---\n\n` +
    `Render this in your voice — pick what matters, structure it, voice it — but do not silently drop sections. ` +
    `The content above is what to deliver; do not invoke any tools to fetch additional context for it.` +
    auditLine  // empty string if no audit metadata
  );
}
```

- [ ] **9.4: Run, confirm PASS**

- [ ] **9.5: Commit**

```bash
git add packages/dashboard/src/automations/heartbeat-service.ts \
        packages/dashboard/tests/unit/automations/heartbeat-action-request-prompt.test.ts
git commit -m "feat(s4.3-itemG): surface SDK transcript path in action-request prompt body

Reads result.json (written by Item F) at notification-format time;
appends 'Audit trail: <path>' to the action-request prompt body if
audit.transcript_path is present. The brain has the path in its
context — available for reference, not used unprompted.

Graceful: missing result.json or malformed JSON or absent audit
field all skip the line silently. No undefined interpolation
hazards."
```

---

### Task 10 — Sweep + push

- [ ] **10.1: Full test suite (was Task 7.1)**

```bash
cd packages/dashboard
npx tsc --noEmit && npx vitest run 2>&1 | tail -10
```

Expected: typecheck clean. **All tests pass.** Including the new e2e test from Task 5.

- [ ] **10.2: Optional dev-mode smoke**

If desired:

```bash
PORT=4322 npm run dev    # in one terminal
DASHBOARD=http://localhost:4322 ./scripts/soak-probe.sh chiang-mai-aqi-worker
```

Validates chart-augmentation change (Item A) end-to-end on real worker output.

- [ ] **10.3: Push**

```bash
git push -u origin sprint/m9.4-s4.3-worker-pipeline-cleanup
```

Open PR titled `feat(m9.4-s4.3): worker pipeline cleanup — single writer + sidecar metadata`.

---

### Task 11 — Merge gate

S4.3 merges to master when ALL of the following are true:

1. **Branch tests green:** typecheck clean, full vitest run passes (the existing 1455 plus the new e2e test from Task 5).
2. **S4.2 morning soak Day-5 (or later) is clean:** the morning of merge, the brief and relocation session both deliver cleanly per the soak gate. Demonstrates S4.2 stays solid.
3. **Probe loop on dev-mode dashboard:** at least one Trigger 1 PASS on the dev-mode instance (verifies Item A doesn't regress the brief path).
4. **CTO approval.**

**Earliest sensible merge:** 2026-05-03 (Day 6 of S4.2 soak, after Day 5 morning observation passes).
**Latest reasonable merge:** before 2026-05-04 (Day 7) so the merged code rides at least one soak-day on master.

After merge, S4.3 inherits the remaining S4.2 soak days as bonus gravity testing. If the brief or relocation session regresses post-S4.3-merge, flip `PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0` and triage.

> **AUDIT TIGHTENING 4 — soak signal change post-merge:** Item E's heuristic fix is **NOT a no-op** for the soak signal. Pre-merge, silent workers (anti-narration directive working as intended) have been false-failing — at least one `job_failed` notification fired during S4.2 soak Days 4-5 (the May-2 roadmap incident). Post-merge, silent workers correctly end `status: completed`. The expected delta:
>
> - **Before merge:** soak observations include occasional `job_failed` notifications for jobs whose `deliverable.md` is on disk and substantive (false positives from the stale heuristic).
> - **After merge:** zero such false positives. Real failures (worker didn't write `deliverable.md`, validator caught contamination) still fire as `job_failed` correctly.
>
> Soak Day-N reports after merge should explicitly note the absence of false-failed notifications as a positive signal, NOT misread their absence as "soak unchanged." If a `job_failed` fires after merge, it's now load-bearing — investigate it as a real failure, not a heuristic artifact.

---

## Risk log

| Risk | Likelihood | Mitigation |
|---|---|---|
| Capability skill (`capability-brainstorming/SKILL.md`) tells workers to write frontmatter; not updated in this sprint | Medium | Update the skill in **`packages/core/skills/`** (framework source-of-truth) as part of Task 3.4. Per memory `feedback_framework_skills_source.md` editing `.my_agent/skills/` directly is wrong — the agent copy gets overwritten on next install. Re-copy/re-install after the framework edit so the agent's `.my_agent/.claude/skills/` reflects the change. |
| A live capability failure fires during the merge gap (branch ready but not merged) | Low | The pre-merge state is just S4.2-fu3 master, which the audit confirmed handles capability_modify correctly. No regression risk during the gap. |
| The e2e test in Task 5 takes longer than expected and gates the sprint | Medium | The test is the deferred item the audit flagged. Worth taking the time. If it bogs down, defer Item D specifically and ship A/B/C without it; track D as its own follow-up. |
| Item A's chart change breaks brief content rendering | Low | Probe-run on dev-mode dashboard before merge (Task 7.2). Briefs without charts are degraded, not broken. |
| recovery-orchestrator changes interact with M9.6 (already-closed milestone) | Low | The implications audit verified `recovery-orchestrator.readDeliverable()` is the only frontmatter reader in core. Surgical change. |

---

## Out of scope

- M10 (memory perfection) prep. Different milestone, parallel branch.
- Validator regex extension (ongoing maintenance).
- Handler-based automation cleanup (`debrief-reporter` writes `result.deliverable` directly). Per audit recommendation: keep as-is.
- The `validation_attempts: 1` cosmetic. Already auto-fixed by fu3 Task 5 (per soak observation).

---

## Done state

After S4.3 lands:

- One writer per file (`deliverable.md`: worker only; `result.json`: worker only; chart augmentation deleted).
- Capability metadata is JSON sidecar, not markdown frontmatter.
- All four capability validators read from `result.json`.
- Paper trail and recovery orchestrator read from `result.json`.
- New e2e test locks the contract.
- Sidecar convention codified in `CLAUDE.md`.

This closes the M9.4 supplemental thread.
