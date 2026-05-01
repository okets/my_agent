# M9.4-S4.3: Worker Pipeline Cleanup — Single Writer + Sidecar Metadata

> **For agentic workers:** Use `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Run in a dedicated worktree.

**Opened:** 2026-05-01
**Origin:** Closes the deferred items from S4.2-fu3's redesign ([`worker-pipeline-redesign.md`](../m9.4-s4.2-action-request-delivery/worker-pipeline-redesign.md)) and the corrections from the post-fu3 capability implications audit ([`post-fu3-capability-implications.md`](../m9.4-s4.2-action-request-delivery/post-fu3-capability-implications.md)).
**Goal:** Single writer for `deliverable.md` (no post-run executor mutation), sidecar JSON for capability metadata, and an end-to-end test that locks the contract.
**Effort estimate:** 1 day on a branch (excludes merge wait).
**Soak status:** S4.2 is in 7-day soak (Day 4 of 7 today). S4.3 develops on a branch in parallel; merge is gated on probe + tests + soak Day 5+ clean.

---

## Why this sprint exists

The S4.2-fu3 redesign deferred three forward improvements; the post-fu3 capability audit added a fourth. None block the morning brief. All four are correctness-or-cleanliness fixes that close the M9.4 supplemental thread cleanly.

The "all archived, dormant" framing in the original redesign was wrong: `cfr-fix-*` capability workers spawn dynamically at runtime via `recovery-orchestrator.ts:412` + `app.ts:758`. The current pipeline handles them correctly post-fu3, but the migration is still worth doing because:

1. The chart-augmentation block at `automation-executor.ts:649-672` is a third independent writer of `deliverable.md`. fu3 made the worker writer authoritative; this finishes the job.
2. Capability templates instruct workers to write YAML frontmatter into `deliverable.md`. This conflates user-facing markdown with framework telemetry. The user never wants to see `change_type: configure` in their delivery; the framework wants typed fields. Sidecar separates them cleanly.
3. The four frontmatter-aware validators are now defending a contract that's about to change. Without migration they keep working but stay coupled to a deprecated shape.
4. There's no end-to-end test for `capability_modify` post-fu3. The first production capability failure IS the integration test today. Add the test now, before the next failure.

---

## Design principle

**One writer per file. Markdown is for humans. JSON is for the framework.**

- `deliverable.md` is plain markdown the user sees. The worker writes it via Write tool. Nothing else writes it.
- `result.json` (sidecar in the same `run_dir`) is structured worker telemetry. The worker writes it via Write tool. The framework reads it.
- The worker writes BOTH files when it's a capability worker. The worker writes ONLY `deliverable.md` when it's a generic/research worker.

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
| Modify | `.my_agent/skills/capability-brainstorming/SKILL.md` (and any related capability skill files) | Update worker instructions to emit `result.json` alongside `deliverable.md`. (Local data; gitignored.) |
| Create | `packages/dashboard/tests/integration/capability-modify-post-fu3.test.ts` | End-to-end test: spawn a capability_modify worker, verify `result.json` written, all four validators pass, paper-trail entry contains correct fields, `recovery-orchestrator.readDeliverable()` returns the right struct. |
| Modify | `packages/dashboard/tests/unit/automations/todo-validators.test.ts` | Update validator tests for the sidecar source. |

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
- Modify: worker prompt sections that mention chart generation

- [ ] **2.1: Delete the post-run chart augmentation block** (`:649-672`)

This is the third writer of `deliverable.md`. Workers already have `chart_tools.create_chart` available; they get back a URL on call. Workers that want a chart should embed `![chart](url)` in their `deliverable.md` content when they Write it.

- [ ] **2.2: Update the worker prompt's tool-use section** to mention the chart pattern explicitly

In `automation-executor.ts` system prompt assembly (the section that lists allowed tools and their use), add: "If your deliverable has numeric data worth visualizing, call `chart_tools.create_chart` and embed the returned URL inline in your deliverable.md content."

- [ ] **2.3: Run unit tests + typecheck**

- [ ] **2.4: Commit**

```bash
git add packages/dashboard/src/automations/automation-executor.ts
git commit -m "fix(s4.3): chart augmentation as worker self-service

DELETE the post-run chart code at automation-executor.ts:649-672.
This was the third independent writer of deliverable.md (after the
worker via Write tool and — pre-fu3 — the executor via overwrite).
Post-fu3 it was enrichment-not-corruption (read worker's clean file
and appended), but it still violated the single-writer principle.

Workers self-serve via existing chart_tools.create_chart and embed
the returned URL inline when writing deliverable.md.

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

- [ ] **3.5: Run tests, confirm PASS**

- [ ] **3.6: Commit**

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

- [ ] **5.1: Write the e2e test**

Test outline:

```typescript
describe("capability_modify post-fu3 end-to-end", () => {
  it("worker spawn → deliverable.md + result.json written → validators pass → paper trail + recovery orchestrator read fields correctly", async () => {
    const harness = await AppHarness.create({ withAutomations: true, withCfr: true });

    // Configure mock SDK to:
    //  1. write deliverable.md (clean markdown body, ≥50 chars)
    //  2. write result.json ({change_type: "configure", test_result: "pass", summary: "..."})
    //  3. call todo_done for each todo

    // Spawn via the same path production uses
    const { jobId, automationId } = await harness.app.cfr.spawnAutomation({
      jobType: "capability_modify",
      capability: "stt-deepgram",
      targetPath: harness.tmpDir + "/capabilities/stt-deepgram",
    });

    await harness.app.automations.fire(automationId);

    // Wait for completion
    const job = await harness.waitForJobStatus(jobId, "completed");

    // Assertions
    expect(fs.existsSync(path.join(job.run_dir, "deliverable.md"))).toBe(true);
    expect(fs.existsSync(path.join(job.run_dir, "result.json"))).toBe(true);

    // Paper trail
    const decisions = fs.readFileSync(
      path.join(harness.tmpDir, "capabilities/stt-deepgram/DECISIONS.md"),
      "utf-8",
    );
    expect(decisions).toMatch(/change_type.*configure/);
    expect(decisions).toMatch(/test_result.*pass/);

    // Recovery orchestrator readDeliverable
    const result = harness.app.cfr.readDeliverable(job.run_dir);
    expect(result.change_type).toBe("configure");
    expect(result.test_result).toBe("pass");

    await harness.shutdown();
  });

  it("fails loud when result.json is missing", async () => {
    // Mock SDK writes only deliverable.md (no result.json)
    // Expect: validator rejects, job ends 'failed' or 'needs_review'
  });

  it("fails loud when result.json has invalid change_type", async () => {
    // Mock SDK writes result.json with change_type: "unknown"
    // Expect: completion_report validator rejects
  });
});
```

- [ ] **5.2: Run test, confirm PASS**

- [ ] **5.3: Commit**

```bash
git add packages/dashboard/tests/integration/capability-modify-post-fu3.test.ts
git commit -m "test(s4.3): e2e for capability_modify with result.json sidecar

Locks the post-fu3 capability worker contract. Was a deferred item
from the post-fu3 capability implications audit (no e2e test
existed for the full spawn → deliverable + result.json → validators
→ paper trail → recovery orchestrator chain).

Three cases: happy path, missing result.json, invalid change_type."
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

### Task 7 — Sweep + push

- [ ] **7.1: Full test suite**

```bash
cd packages/dashboard
npx tsc --noEmit && npx vitest run 2>&1 | tail -10
```

Expected: typecheck clean. **All tests pass.** Including the new e2e test from Task 5.

- [ ] **7.2: Optional dev-mode smoke**

If desired:

```bash
PORT=4322 npm run dev    # in one terminal
DASHBOARD=http://localhost:4322 ./scripts/soak-probe.sh chiang-mai-aqi-worker
```

Validates chart-augmentation change (Item A) end-to-end on real worker output.

- [ ] **7.3: Push**

```bash
git push -u origin sprint/m9.4-s4.3-worker-pipeline-cleanup
```

Open PR titled `feat(m9.4-s4.3): worker pipeline cleanup — single writer + sidecar metadata`.

---

### Task 8 — Merge gate

S4.3 merges to master when ALL of the following are true:

1. **Branch tests green:** typecheck clean, full vitest run passes (the existing 1455 plus the new e2e test from Task 5).
2. **S4.2 morning soak Day-5 (or later) is clean:** the morning of merge, the brief and relocation session both deliver cleanly per the soak gate. Demonstrates S4.2 stays solid.
3. **Probe loop on dev-mode dashboard:** at least one Trigger 1 PASS on the dev-mode instance (verifies Item A doesn't regress the brief path).
4. **CTO approval.**

**Earliest sensible merge:** 2026-05-03 (Day 6 of S4.2 soak, after Day 5 morning observation passes).
**Latest reasonable merge:** before 2026-05-04 (Day 7) so the merged code rides at least one soak-day on master.

After merge, S4.3 inherits the remaining S4.2 soak days as bonus gravity testing. If the brief or relocation session regresses post-S4.3-merge, flip `PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0` and triage.

---

## Risk log

| Risk | Likelihood | Mitigation |
|---|---|---|
| Capability skill (`capability-brainstorming/SKILL.md`) tells workers to write frontmatter; not updated in this sprint | Medium | Update the skill in `.my_agent/skills/` as part of Task 3.4. Local data fix; no commit needed on public repo. |
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
