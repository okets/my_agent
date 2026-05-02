# M9.4-S4.3 Plan — Pre-Execution Audit

**Auditor:** External / read-only.
**Date:** 2026-04-26.
**Scope:** `plan.md` at master HEAD. Items A-G, Tasks 1-11.
**Result:** APPROVE-WITH-CHANGES — three concrete corrections required before execution; the rest are tightening.

---

## 1. Top findings (priority order)

### Finding 1 — Item A will silently break charts on `chiang-mai-aqi-worker` and any `generic` workers (HIGH)

**File:** `packages/dashboard/src/automations/automation-executor.ts:649-672`, `todo-templates.ts:53-69` (generic), `todo-templates.ts:70-95` (research).

The plan deletes the post-run chart augmentation block and adds a single line to the worker prompt's tool-use section ("If your deliverable has numeric data worth visualizing, call `chart_tools.create_chart`…"). Two problems:

1. **The `generic` template (lines 53-69) has zero chart instructions today.** Workers using `job_type: generic` (e.g. `update-relocation-roadmap`, `daily-thailand-relocation-check-in`) currently get charts via the auto-augmentation block. Item A removes that. Step 2.2 of Task 2 only edits the system-prompt assembly — that's a coarse, easily-ignored hint compared to a per-todo cadence directive.
2. **Empirical evidence of reliance:** all 10+ `chiang-mai-aqi-worker` runs in `.my_agent/automations/.runs/chiang-mai-aqi-worker/` embed `![chiang-mai-aqi-worker chart](...)` — the literal string the executor's auto-augmentation produces (line 698: `![${automation.manifest.name} chart](${parsed.url})`). The aqi worker has been getting its chart from the augmentation path, not from a worker-side `create_chart` call.

**Recommendation:** Update the `generic` and `research` templates to include an explicit "if you have numeric data, call `mcp__chart-tools__create_chart` and embed the URL" todo (the `research` template already does this at line 86 — copy that into `generic`). Run the soak-probe Trigger 1 against `chiang-mai-aqi-worker` after the change to confirm a chart is still embedded BEFORE merge. The plan's "Layer 3 dev-mode smoke is optional" framing understates this risk.

### Finding 2 — Item E is brittle on the handler path (MEDIUM)

**File:** `packages/dashboard/src/automations/automation-executor.ts:312-352` (handler return), `automation-processor.ts:136`.

The handler-based `monthly-summary` returns `{ success: true, work: "Quiet month.", deliverable: null }` (handler-registry.ts:568). Pre-Item E, this passes the heuristic only by accident — `result.work.trim().length` is 12, which is `< 20`, so the heuristic ALREADY downgrades it to failed today. Post-Item E, `result.deliverable` is null, `!result.deliverable` is true → still fails. Not a regression but a missed opportunity.

More important: the plan's test 1 (Task 7.1) uses `result.deliverable: "## Report..."` — substantive — and asserts success. It does NOT cover `deliverable: null` with `success: true` from a handler. The handler path returns `result` directly to the processor; the processor's check fires on it. **Add a test:** `success: true, deliverable: null, work: "..."` from a handler → should NOT downgrade (the handler is authoritative; handlers don't write `deliverable.md`).

**Recommended fix to the patch itself:** make the heuristic skip when `automation.manifest.handler` is set. Handler-based jobs never go through the SDK worker path — the executor wrote whatever it wrote, and the processor should trust the handler's `success` flag. The current fix is "deliverable on disk is truth"; for handlers, there may be no on-disk deliverable.

### Finding 3 — Item F's encoding rule is correct for ASCII paths but the plan does not document its limits (MEDIUM)

**File:** `packages/dashboard/src/automations/automation-executor.ts` (new helper), Task 8.

Verified empirically:
```
$ node -e "console.log('~/my_agent/.my_agent/automations/.runs/update-relocation-roadmap/job-7ed578ce-…'.replace(/[^a-zA-Z0-9-]/g, '-'))"
-home-nina-my-agent--my-agent-automations--runs-update-relocation-roadmap-job-7ed578ce-…
```
Matches the actual SDK directory `~/.claude/projects/-home-nina-my-agent--my-agent-automations--runs-update-relocation-roadmap-job-7ed578ce-…/`. **Encoding rule holds for ASCII paths.**

**However:** the rule collapses non-ASCII to `-`. Tested:
- `'/path/with/utf8-café/x'` → `-path-with-utf8-caf--x` (the `é` becomes `-`).

If a future user has a Unicode path (or a SDK release changes the encoding), `audit.transcript_path` will silently point to a non-existent file. The plan asserts the rule is correct "verified empirically" but doesn't add a verification step in the helper itself. **Recommendation:** in `buildTranscriptPath()` (or `writeAuditMetadata`), `fs.existsSync(transcriptPath)` after computing — log a warning if false; do NOT fail the job. This makes the assumption falsifiable in production telemetry rather than silently rotting.

### Finding 4 — Plan's e2e test (Task 5) calls APIs that don't exist on AppHarness (HIGH)

**File:** `packages/dashboard/tests/integration/app-harness.ts:83-90` (AppHarnessOptions).

The plan's example test code uses `AppHarness.create({ withAutomations: true, withCfr: true })` and `harness.app.cfr.spawnAutomation(...)`. Reading `app-harness.ts`:

- `AppHarnessOptions` defines `withMemory`, `withAutomations`, `agentDir` only. **No `withCfr`.**
- The harness creates `cfr: new CfrEmitter()` inline at line 184 but does NOT wire a `RecoveryOrchestrator`, which is what owns `spawnAutomation` (per `app.ts:757-797`).
- `harness.app.cfr.spawnAutomation` does not exist — it's on `RecoveryOrchestrator`, not `CfrEmitter`.

The Task 5 test as written will fail to compile. The dev will discover this on first run, but it forces a non-trivial harness extension mid-sprint. **Recommendation:** either (a) extend `AppHarness` first as a sub-task with `withCfr` wiring `RecoveryOrchestrator`, or (b) drop the e2e to `harness.automationManager.create(...)` + `harness.automationProcessor.fire(...)` — the `automation_processor` path already works in tests, and the test still proves capability_modify's full chain.

### Finding 5 — Item G read-consistency: notification queue is persistent; result.json may be GC'd or moved (MEDIUM)

**File:** `packages/dashboard/src/automations/heartbeat-service.ts:392-440`, `notifications/persistent-queue.ts`.

`PersistentNotification` carries `run_dir` as a string path. Pending notifications survive restarts; `delivered/` is also persistent (verified `.my_agent/notifications/delivered/` has hundreds of files). Item G reads `result.json` from `n.run_dir` at format-time. If the heartbeat tick is delayed (busy session, restart, drainNow failure → 30s tick retry), the run-dir could be archived or pruned. The plan's test 2 (Task 9.1) covers absent `result.json` — graceful — but doesn't cover **stale or archived run-dir paths**. Acceptable risk, but worth a one-liner test or an explicit log warning when `n.run_dir` is set but doesn't exist.

### Finding 6 — Item B updates the wrong skill source (LOW)

**File:** Plan Task 3.4 mentions `.my_agent/skills/capability-brainstorming/SKILL.md`.

Per project memory `feedback_framework_skills_source.md` and `claude-md-management` instructions: "Edit source, copy to agent — always edit `packages/core/skills/`, never the `.my_agent/` copy". The framework's source-of-truth skill is at `packages/core/skills/capability-brainstorming/SKILL.md` and gets copied to `.my_agent/.claude/skills/`. Editing only the agent copy means the next install_skills run overwrites it. **Recommendation:** flip Task 3.4 / Risk-log row 1 to edit `packages/core/skills/capability-brainstorming/`, then re-run install if needed.

### Finding 7 — Plan claims Item F write happens "AFTER `readAndValidateWorkerDeliverable` and BEFORE chart augmentation" — sequencing question (LOW)

**File:** `automation-executor.ts:660` (deliverable read) → `:666-714` (chart) → `:744-751` (session ID stored) → `:766-773` (paper trail).

After Item A lands, the chart block is gone — fine. After Item F lands at line ~661, the audit write happens before the paper-trail write at line 767. With Item B (Task 4), `writePaperTrail` reads from `result.json`. If Item F creates `result.json` with only `{ audit: {...} }` (generic worker case) and Item B's `writePaperTrail` then tries to read `change_type` from that JSON — it's missing. This is fine for generic workers (paper-trail probably only fires on capability workers anyway via `target_path` containing `capabilities/`), but the plan's Done-state row claims "Paper trail and recovery orchestrator read from `result.json`" — verify `writePaperTrail` gracefully handles missing fields when run on a non-capability target_path. The audit confirmed it's only invoked via `if (targetPath)` and capability targets contain `capabilities/`, so the practical risk is low — but there's no test asserting "non-capability targetPath → paper trail does not throw on missing change_type."

---

## 2. Per-item review

| Item | Spec | Tests | Integration | Verdict |
|---|---|---|---|---|
| A — delete chart augmentation | Clear | Manual smoke only | Worker prompt update is too soft (Finding 1) | **Partial** — needs template-level instruction, not just prompt hint |
| B — sidecar migration | Clear | Tasks 3-4 unit tests cover the validators + paper-trail + recovery-orchestrator | Edge case: `writePaperTrail` reading `result.json` missing fields (Finding 7) | **Yes (with note)** |
| C — codify in CLAUDE.md | Clear, well-scoped | N/A — docs change | Done-state coherent | **Yes** |
| D — e2e test for capability_modify post-fu3 | Spec is good | Test API doesn't exist on AppHarness (Finding 4) | Needs harness extension first | **Gap-flagged** |
| E — heuristic fix | Clear, two-line patch | Three tests in Task 7 | Misses handler-based path (Finding 2) | **Partial** — add handler test + skip-when-handler logic |
| F — audit metadata | Clear | Encoding rule verified for ASCII (Finding 3); race + null sdkSessionId paths covered in plan (try/catch on JSON.parse, "after success only" assertion) | Should add `fs.existsSync` post-write probe to make encoding falsifiable | **Yes (with note)** |
| G — surface in prompt | Clear | Three tests in Task 9 | Stale-run-dir case missing (Finding 5) | **Yes (with note)** |

---

## 3. Cross-cutting concerns

**Sequencing.** Tasks 7/8/9 touch overlapping files (`automation-executor.ts`, `automation-processor.ts`, `heartbeat-service.ts`) but different functions — no merge conflicts. No ordering dependency between E/F/G logically (E reads in-memory `result`; F writes file; G reads file). Plan order is fine.

**Race condition in `writeAuditMetadata`.** The plan's `read → JSON.parse → spread → writeFileSync` is not atomic. For capability workers: the worker writes `result.json` via Write tool (during the SDK loop, line 597-637). The framework's audit write happens at line ~660 — AFTER the SDK loop completes. By then, the worker's last Write has settled. **No racy interleaving in practice.** But the plan should use `writeFileSync` with `{ flag: 'w' }` (default; OK) and accept that any concurrent external writer (e.g. a debug script) loses. Mention this in a code comment.

**Soak interaction.** Pre-E, the bug fired today (May 2) on `update-relocation-roadmap` (a manual `notify: immediate` job). It will continue to fire on any silent-worker job that runs during the soak. The plan's claim that S4.3 development "doesn't disturb the soak" is correct *only because S4.3 lives on a branch and master continues to false-flag*. Important: post-merge of S4.3, the morning brief soak gains a real behavioral change (silent workers no longer false-fail). **The plan should explicitly call out this is a behavioral change for the soak, not a no-op,** and state the expected delta (zero `job_failed` notifications for jobs whose `deliverable.md` is non-empty, where pre-E there was at least one).

**Encoding correctness.** Confirmed for ASCII paths via empirical match against `~/.claude/projects/-home-nina-my-agent--my-agent-automations--runs-update-relocation-roadmap-job-7ed578ce-…`. Unverifiable for non-ASCII (Finding 3).

---

## 4. Test coverage assessment

| Test | What it tests | Verdict |
|---|---|---|
| Task 5: e2e capability_modify happy path | Full chain | Cannot run as written (Finding 4); fix harness, then good |
| Task 5: missing `result.json` | Validator failure | Good |
| Task 5: invalid `change_type` | Validator failure | Good |
| Task 7.1 test 1: empty `work`, substantive `deliverable` | The actual May-2 incident | **Hits the right bug** |
| Task 7.1 test 2: empty both | Heuristic still catches real misses | Good |
| Task 7.1 test 3: whitespace-only deliverable | Whitespace edge | Synthetic but cheap; keep |
| Task 7.1 (missing) | Handler returns `deliverable: null, success: true` | **Add this** (Finding 2) |
| Task 8.1 test 1: generic worker, framework creates `result.json` | Yes | Good |
| Task 8.1 test 2: capability worker MERGES | Tests `change_type` + `test_result` survive — property-by-property check | Good — but assert NO collision: e.g. worker writes `audit: { foo: 1 }` and framework merges — the framework MUST overwrite, since framework owns the `audit` field. Add a test for this collision. |
| Task 8.1 test 3: encoding helper | ASCII-only — see Finding 3 | Good as far as it goes |
| Task 8.1 test 4: failure path | Audit not touched | Good |
| Task 9.1 test 1: prompt includes Audit trail | Good | Good |
| Task 9.1 test 2: graceful absence | No `result.json` | Good |
| Task 9.1 test 3: present but no audit field | Good | Good |
| Task 9.1 (missing) | Stale run_dir (file moved/archived between completion and delivery) | Add (Finding 5) |

Overall: solid coverage with three fillable gaps (handler null deliverable, audit-field collision, stale run_dir).

---

## 5. Couldn't verify

- **The dev-mode dashboard smoke (Layer 3, Task 10.2).** Cannot run dashboard during audit (read-only constraint). Verifying that a dev-mode dashboard at port 4322 exists and works as the plan describes is outside this audit's scope — but the plan correctly marks it "optional".
- **Whether `app.cfr.spawnAutomation` could be plumbed through CfrEmitter** rather than RecoveryOrchestrator. The plan's API call shape `harness.app.cfr.spawnAutomation` looks like wishful thinking from someone who saw `app.ts:758` (`spawnAutomation: async (spec) => {...}`) without noticing it's a `RecoveryOrchestrator` constructor arg, not an `app.cfr` method. Confirming this is purely the plan author's typo (not an existing harness method I missed) needs running `npx tsc --noEmit` on the proposed test, which the audit cannot do without modifying files.
- **Whether `result.json` is in `.gitignore`.** Likely is via `.runs/` exclusion, but if any test fixture or e2e creates a `result.json` outside `.runs/`, it could leak. Cosmetic.

---

## 6. Verdict

**APPROVE-WITH-CHANGES.**

The seven items are correctly scoped; the patches are surgical; the tests are mostly the right ones. The blockers before execution are Finding 1 (chart augmentation deletion + brief workers), Finding 4 (e2e test compiles), and Finding 6 (skill source-of-truth). Finding 2 (handler null deliverable) is one extra test + a one-line guard. Findings 3/5/7 are tightening that should land in the same sprint but won't gate it.

Land the three blockers as plan amendments before Task 1; ship the rest as-is.
