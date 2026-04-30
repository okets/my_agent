# M9.4-S4.2 — Soak Day-3 Follow-up Plan (fu3)

> **For agentic workers:** Use `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax. **Critical path — morning briefs are broken in production. Land fast.**

**Opened:** 2026-04-30
**Origin:** Three investigation docs in this folder ([`worker-pipeline-history.md`](worker-pipeline-history.md), [`worker-pipeline-mechanism-inventory.md`](worker-pipeline-mechanism-inventory.md), [`worker-pipeline-redesign.md`](worker-pipeline-redesign.md)). All claims verified independently against current code. Today's contaminated `deliverable.md` files (verified at `expat-tips-worker/job-b2adc1fb-…/deliverable.md` and `daily-relocation-session/job-fd9e0314-…/deliverable.md`) confirm the diagnosis.
**Goal:** Eliminate the executor's silent overwrite of worker `deliverable.md` files. Worker writes are authoritative.
**Soak status:** stays open. Day-3 calendar morning is not a useful gate — fu3 changes the underlying contract, so the gate is the **fast-iteration probe loop** (5 consecutive PASS) before resuming calendar soak.

---

## Why fu3 exists

fu1 (Day-1) widened the validator regex. fu2 (Day-2) inlined deliverable content in the prompt body. Both passed their unit tests. Both produced contaminated turns in production.

**Root cause** (verified): `automation-executor.ts:605-621` overwrites `deliverable.md` with the model's full response stream **unless the file starts with `---` (YAML frontmatter)**. Generic/research workers (8 of 8 active model-driven workers) write plain markdown via the Write tool — no frontmatter. The frontmatter sniff always fails for them; the executor always overwrites.

The contamination wasn't fu1's or fu2's problem to solve — they delivered exactly what was on disk. What was on disk was the executor's overwrite, not the worker's clean output.

The dev's investigation traced this to three drift commits (`f4f5d83` Apr 1, `697ab41` Apr 6, `cacba19` Apr 10) — none of which owned the worker contract end-to-end. The `startsWith("---")` guard is correct for capability_build/modify workers (which DO emit frontmatter — but those are in `_archive/`, dormant in production). For every active model-driven worker today, the guard is a load-bearing fossil.

## Design principle (one sentence)

**The worker's `deliverable.md` is the source of truth from the moment the worker writes it. The executor reads, validates, and fails loud if missing — but never rewrites.**

---

## Scope — files changed

| Action | File | Change |
|--------|------|--------|
| Modify | `packages/dashboard/src/automations/automation-executor.ts:600-621` | Delete the overwrite block. Replace with: file-exists check (fail loud if missing) + read into `finalDeliverable` for downstream code + defense-in-depth `runValidation("deliverable_written", run_dir)` final gate. |
| Modify | `packages/dashboard/src/automations/automation-executor.ts:603` | Drop `extractDeliverable(response)` call. The XML-tag contract is dead. |
| Modify | `packages/dashboard/src/automations/automation-executor.ts:1115` | Delete the cadence-rule line *"The last tool call before writing `deliverable.md` MUST be `todo_done` on your final step."* Replace with the corrected ordering: write file first, then `todo_done`. |
| Delete | `packages/dashboard/src/automations/deliverable-utils.ts` | `extractDeliverable` and `validateDeliverable` are unreferenced after the executor change. The `<deliverable>` tag contract has been silently retired since Apr 1; finishing the job. |
| Modify | `packages/dashboard/src/automations/automation-executor.ts` (imports) | Remove `import { extractDeliverable } from "./deliverable-utils.js"`. |
| Modify | tests touching `extractDeliverable` or asserting post-run overwrite behavior | Update or delete — those tests exercise the bug. |
| Modify | `scripts/soak-probe.sh` (from Day-2 protocol) | Expand: pre-delivery check that `deliverable.md` is clean (no narration patterns) before firing the delivery hop. |

**Out of scope for fu3 (forward improvements; tracked but deferred):**
- Chart-augmentation third-writer cleanup (`automation-executor.ts:649-672`). Currently mutates `deliverable.md` post-run by appending `![chart](url)`. After fu3, `finalDeliverable` is sourced from the worker's file, so the chart code reads + appends a URL — enrichment, not corruption. Acceptable for ASAP. Move to worker-runtime tool in a follow-up.
- `capability_build` / `capability_modify` template migration to `result.json` sidecar. Zero active workers in production use these (all archived). Forward decision when revived.
- Handler-based automation cleanup (debrief-reporter writes `result.deliverable` directly). Deterministic code, no contamination risk. Keep as-is.

---

## Tasks

### Task 1 — Worktree

- [ ] **1.1: Create worktree**

```bash
cd ~/my_agent
git worktree add ../my_agent-s4.2-fu3 -b sprint/m9.4-s4.2-fu3-worker-contract
cd ../my_agent-s4.2-fu3
```

---

### Task 2 — Write failing tests (TDD)

**File:** `packages/dashboard/src/automations/__tests__/automation-executor.test.ts` (extend if exists; create if not).

The new contract is simple enough to express as 5 invariants. Tests assert each one.

- [ ] **2.1: Write the invariant tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Test helpers as per existing pattern in the file.

describe("AutomationExecutor — worker-deliverable contract (M9.4-S4.2-fu3)", () => {
  let runDir: string;
  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "fu3-test-"));
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("preserves worker-written deliverable.md verbatim (no overwrite, no frontmatter sniff)", async () => {
    const workerContent = "## AQI\n\n**AQI: 145**\nPM2.5: ~52 µg/m³";
    fs.writeFileSync(path.join(runDir, "deliverable.md"), workerContent);
    const responseStream = "I'll start by checking…\n\n## AQI\n**AQI: 145**";
    // Run executor's post-run logic (extract via test helper or call private method)
    await runExecutorPostRunStage({ runDir, response: responseStream });
    expect(fs.readFileSync(path.join(runDir, "deliverable.md"), "utf-8")).toBe(workerContent);
  });

  it("preserves worker-written deliverable.md WITH frontmatter equally", async () => {
    const workerContent = "---\nchange_type: configure\n---\n\n## Result\n\n**Done.**";
    fs.writeFileSync(path.join(runDir, "deliverable.md"), workerContent);
    await runExecutorPostRunStage({ runDir, response: "stream content" });
    expect(fs.readFileSync(path.join(runDir, "deliverable.md"), "utf-8")).toBe(workerContent);
  });

  it("fails loud when deliverable.md is missing (no fabrication from response stream)", async () => {
    // No deliverable.md written by worker
    await expect(
      runExecutorPostRunStage({ runDir, response: "I'll start by checking…\n\nSome content" }),
    ).rejects.toThrow(/Worker did not write deliverable\.md/i);
    // And specifically, the response stream must NOT have been written as a fallback
    expect(fs.existsSync(path.join(runDir, "deliverable.md"))).toBe(false);
  });

  it("runs deliverable_written validator one more time at job-end (defense in depth)", async () => {
    // Contaminated content survives the worker's todo_done validator gate
    // (e.g. validator regex hole). Job-end gate catches it.
    fs.writeFileSync(
      path.join(runDir, "deliverable.md"),
      "Let me start by checking my todo list. Now let me look at the AQI sensors.",
    );
    await expect(
      runExecutorPostRunStage({ runDir, response: "doesn't matter" }),
    ).rejects.toThrow(/Final validator gate failed|narration|stream-of-consciousness/i);
  });

  it("does NOT call extractDeliverable on the response stream", async () => {
    // Hot-path coverage: if extractDeliverable is removed, this test confirms
    // the executor doesn't re-introduce a tag-extracting fallback.
    const workerContent = "## Body\n\nClean content.";
    fs.writeFileSync(path.join(runDir, "deliverable.md"), workerContent);
    const taggedResponse =
      "<deliverable>This is the OLD contract — must be ignored</deliverable>";
    await runExecutorPostRunStage({ runDir, response: taggedResponse });
    expect(fs.readFileSync(path.join(runDir, "deliverable.md"), "utf-8")).toBe(workerContent);
    expect(fs.readFileSync(path.join(runDir, "deliverable.md"), "utf-8")).not.toContain("OLD contract");
  });
});
```

The test helper `runExecutorPostRunStage` may need to be extracted from `AutomationExecutor` — if so, do the extraction as part of this task. The post-run stage (lines 600-622 of the current file) is a self-contained block; extracting it into a private method that's exported via a test seam is a small change that makes future testing cleaner.

- [ ] **2.2: Run tests, confirm 5 FAIL** (or close to — depending on which assertions land first)

```bash
cd packages/dashboard
npx vitest run src/automations/__tests__/automation-executor.test.ts
```

---

### Task 3 — Apply the executor change (the load-bearing edit)

**File:** `packages/dashboard/src/automations/automation-executor.ts:600-622`

- [ ] **3.1: Replace the post-run block**

Delete lines 600-622 (the whole `// 7. Extract deliverable` through the closing `if (unsubscribe) unsubscribe();`). Replace with:

```typescript
      // 7. Worker run complete. The worker MUST have written deliverable.md
      //    via the Write tool during its run. We do not extract from the
      //    response stream, do not merge, do not overwrite — the on-disk file
      //    is the source of truth from this point forward.
      //    M9.4-S4.2-fu3: replaces the f4f5d83 (Apr 1) auto-write fallback
      //    and the 697ab41 (Apr 6) startsWith("---") guard. Both were
      //    correct for contracts that no longer exist in production.
      let deliverablePath: string | undefined;
      let finalDeliverable: string | undefined;
      if (job.run_dir) {
        deliverablePath = path.join(job.run_dir, "deliverable.md");
        if (!fs.existsSync(deliverablePath)) {
          // Fail loud — do NOT fabricate from response stream. The validator
          // at todo-completion time was supposed to catch this; if it didn't,
          // surface as a job failure for investigation.
          throw new Error(
            `Worker did not write deliverable.md to ${job.run_dir}. ` +
              `Check ${job.run_dir}/todos.json for validation_attempts. ` +
              `The worker likely skipped or short-circuited the deliverable-emit step.`,
          );
        }
        finalDeliverable = fs.readFileSync(deliverablePath, "utf-8");

        // Defense in depth: re-run the validator at job-end. Catches any
        // worker that bypassed the todo_update MCP path (Hypothesis H2 from
        // the bug record). Cheap regex check on a file already on disk.
        const finalCheck = runValidation("deliverable_written", job.run_dir);
        if (!finalCheck.pass) {
          throw new Error(
            `Final validator gate failed for ${job.run_dir}: ${finalCheck.message}. ` +
              `This indicates the worker bypassed the todo-runtime validator.`,
          );
        }
      }
      if (unsubscribe) unsubscribe();
```

- [ ] **3.2: Drop the `extractDeliverable` import**

At the top of `automation-executor.ts`:

```diff
- import { extractDeliverable } from "./deliverable-utils.js";
```

If `validateDeliverable` is also imported anywhere, drop that too.

- [ ] **3.3: Confirm `runValidation` is imported**

```bash
grep -n "import.*runValidation\|from.*todo-validators" packages/dashboard/src/automations/automation-executor.ts
```

If not imported, add:

```typescript
import { runValidation } from "./todo-validators.js";
```

- [ ] **3.4: Run tests, confirm PASS**

```bash
npx vitest run src/automations/__tests__/automation-executor.test.ts
```

- [ ] **3.5: Run typecheck**

```bash
npx tsc --noEmit
```

Expect: clean. The chart-augmentation block at lines 624-674 still references `finalDeliverable` (which is now sourced from the worker's file rather than the response stream) — TypeScript should be happy; the variable is the same shape.

- [ ] **3.6: Commit**

```bash
git add packages/dashboard/src/automations/automation-executor.ts \
        packages/dashboard/src/automations/__tests__/automation-executor.test.ts
git commit -m "fix(s4.2-fu3): worker deliverable.md is source of truth — delete executor overwrite

Replaces the f4f5d83 (Apr 1) auto-write fallback and the 697ab41
(Apr 6) startsWith('---') frontmatter guard with: presence check +
fail-loud + defense-in-depth validator gate at job-end.

Active model-driven workers (8 of 8) write plain markdown via Write
tool — the frontmatter guard always failed and the executor always
overwrote with the model response stream, contaminating today's
morning briefs and relocation sessions.

Worker writes are now authoritative. Validator runs once at
todo-completion (existing) and once at job-end (new gate). Job
fails loud if deliverable.md is missing — no silent fabrication."
```

---

### Task 4 — Delete the legacy XML-tag contract

**Files:**
- Delete: `packages/dashboard/src/automations/deliverable-utils.ts`
- Modify: any remaining imports

- [ ] **4.1: Verify no remaining production callers**

```bash
grep -rn "extractDeliverable\|validateDeliverable\|from.*deliverable-utils" \
  packages/dashboard/src --include="*.ts" 2>/dev/null
```

Expected after Task 3: zero references in `src/`. If anything remains in `src/`, fix it before deleting the file.

Test files referencing `extractDeliverable` directly (testing the legacy function): delete those tests — they cover behavior that no longer exists.

- [ ] **4.2: Delete the file**

```bash
git rm packages/dashboard/src/automations/deliverable-utils.ts
```

- [ ] **4.3: Run typecheck + full test suite**

```bash
npx tsc --noEmit && npx vitest run 2>&1 | tail -10
```

Expected: clean typecheck. Tests pass (or only pre-existing CFR live skips).

- [ ] **4.4: Commit**

```bash
git add -A
git commit -m "fix(s4.2-fu3): delete deliverable-utils.ts — XML-tag contract retired

extractDeliverable and validateDeliverable were the M5-S9 (Feb 22)
<deliverable>...</deliverable> tag-parsing utilities. Modern templates
(generic/research, since M9.4-S4) tell workers to write plain markdown
via Write tool — no XML wrapping. The fallback in automation-executor
that consumed extractDeliverable's output was deleted in fu3 Task 3.

Zero remaining src/ references. The contract is fully retired."
```

---

### Task 5 — Update worker prompt cadence

**File:** `packages/dashboard/src/automations/automation-executor.ts:1115`

- [ ] **5.1: Replace the contradictory rule**

```diff
-    "**The last tool call before writing `deliverable.md` MUST be `todo_done` on your final step.**",
+    "**Write `deliverable.md` first via the Write tool, then call `todo_done` on the deliverable-emit step.** The `deliverable_written` validator runs when you mark the step done — it reads the file you just wrote, so the file MUST exist before you mark the todo done.",
```

This resolves Conflict #4 from the inventory. Template t1 wins. Template t1's text already says "Final step: this should be the last thing you write before marking done" — the prompt now matches.

- [ ] **5.2: Find any tests that assert on the old rule wording**

```bash
grep -rn "last tool call.*todo_done\|MUST be.*todo_done" packages/dashboard/tests \
  --include="*.ts" 2>/dev/null
```

Update any matches to assert the new wording, OR delete if the assertion was specifically pinning the old phrasing.

- [ ] **5.3: Commit**

```bash
git add packages/dashboard/src/automations/automation-executor.ts \
        packages/dashboard/tests
git commit -m "fix(s4.2-fu3): worker prompt cadence — write file first, then todo_done

The template's t1 says 'Final step: write deliverable.md before marking
done.' The Progress Cadence prompt section said 'todo_done MUST be the
last tool call before writing deliverable.md' — opposite ordering.
Workers got rejected once (validator can't find file → rejects → worker
pivots to writing file → second todo_done call passes), inflating
validation_attempts cosmetically.

Template wins. Update the prompt to match. The validator-runs-at-
todo_done semantics require the file to exist first."
```

---

### Task 6 — Expand the soak-probe with deliverable-cleanliness check

**File:** `scripts/soak-probe.sh` (created in `fast-iteration-protocol.md` from Day-2)

The Day-2 probe checks the assistant turn after delivery. Today's failure shows we also need to check `deliverable.md` cleanliness BEFORE delivery — otherwise we're testing whether the prompt body works on already-corrupted input.

- [ ] **6.1: Add a pre-delivery check**

Edit `scripts/soak-probe.sh` to add, between Trigger 1's automation fire and the wait-for-delivery step:

```bash
# Pre-delivery: verify deliverable.md is clean BEFORE the delivery hop fires.
# fu3 made worker writes authoritative; this check confirms the executor
# didn't silently corrupt them.
if [[ "$TRIGGER" == "1" ]]; then
  echo "[probe] Waiting for worker to finish writing deliverable.md..."
  sleep 15  # rough estimate of worker run time
  LATEST_RUN_DIR=$(ls -td "$AGENT_DIR"/automations/.runs/"$AUTO"/* 2>/dev/null | head -1)
  if [[ -z "$LATEST_RUN_DIR" || ! -f "$LATEST_RUN_DIR/deliverable.md" ]]; then
    echo "[probe] PRE-DELIVERY FAIL — no deliverable.md in $LATEST_RUN_DIR"
    exit 3
  fi
  DELIVERABLE_HEAD="$(head -c 300 "$LATEST_RUN_DIR/deliverable.md")"
  echo "[probe] Deliverable head: ${DELIVERABLE_HEAD:0:100}..."

  # Same regex as the validator
  if echo "$DELIVERABLE_HEAD" | grep -qiE \
      "^(Let me start by|I'?ll start (by|executing)|I'?ll help (you )?(condense|summarize|format)|Now I'?ll (start|check|look)|Here'?s what I'?ll do|Let'?s check)"; then
    echo "[probe] PRE-DELIVERY FAIL — deliverable.md opens with strong narration:"
    echo "$DELIVERABLE_HEAD"
    exit 3
  fi
  SECOND_COUNT=$(echo "$DELIVERABLE_HEAD" | grep -ciE \
      "(Now let me|Now I need(\\s+to)?|Let me (check|look|fetch|read|get|find|search|create|locate)|I'?ll (check|fetch|read|look|get|find|search|create|locate))")
  if [[ "$SECOND_COUNT" -ge 2 ]]; then
    echo "[probe] PRE-DELIVERY FAIL — $SECOND_COUNT narration markers in head"
    echo "$DELIVERABLE_HEAD"
    exit 3
  fi
  echo "[probe] PRE-DELIVERY PASS — deliverable.md is clean"
fi
```

- [ ] **6.2: Add a "two-stage PASS" message**

After both pre-delivery and post-delivery pass, the probe should print explicit `STAGE 1 PASS / STAGE 2 PASS / OVERALL PASS` lines. Makes failure mode unambiguous in CI logs.

- [ ] **6.3: Commit**

```bash
git add scripts/soak-probe.sh
git commit -m "test(s4.2-fu3): soak-probe two-stage check — deliverable.md clean before delivery

Day-2 probe only checked the assistant turn; today's contamination
proved that's downstream of the real problem (executor overwriting
worker file). Two-stage check:
  STAGE 1 — pre-delivery: deliverable.md is clean (worker wrote
            cleanly + executor didn't overwrite with stream)
  STAGE 2 — post-delivery: assistant turn doesn't narrate Read tool

fu3 should make STAGE 1 PASS where today it FAILs. STAGE 2 was
expected to pass already from fu2; today's evidence is that STAGE 2
also failed because STAGE 1 input was contaminated."
```

---

### Task 7 — Sweep + push

- [ ] **7.1: Full test suite**

```bash
cd packages/dashboard
npx tsc --noEmit && npx vitest run 2>&1 | tail -15
```

Expected: typecheck clean. All tests pass except pre-existing 24 CFR live env-gated skips.

- [ ] **7.2: Push**

```bash
git push -u origin sprint/m9.4-s4.2-fu3-worker-contract
```

Open PR. Title: `fix(m9.4-s4.2-fu3): worker deliverable.md is source of truth — delete executor overwrite`. Body summarizes the bug, links the three investigation docs, lists the 4 commits, notes "this is the load-bearing fix for the contamination class; fu1 + fu2 work as intended once fu3 lands."

---

### Task 8 — Deploy + fast-iteration probe loop

After PR merge to master:

- [ ] **8.1: Restart dashboard**

```bash
systemctl --user restart nina-dashboard.service
sleep 5
journalctl --user -u nina-dashboard.service -n 30 --no-pager | grep -iE "error|started" | head
```

- [ ] **8.2: Run the probe loop — 5 iterations of Trigger 1 (real automation fire)**

```bash
cd ~/my_agent
for i in 1 2 3 4 5; do
  echo "=== Iteration $i ==="
  TRIGGER=1 ./scripts/soak-probe.sh chiang-mai-aqi-worker || break
  sleep 60  # cooldown between fires
done
```

PASS criteria for each iteration:
- STAGE 1 PASS: `deliverable.md` is clean (worker write was authoritative; no executor overwrite)
- STAGE 2 PASS: assistant turn has no Read narration, no dismissal, no meta-explanation, content present

If any iteration fails STAGE 1: the worker is producing contaminated content (the bug shifted from "executor corrupts worker file" to "worker writes contaminated content directly"). Investigate the validator's todo-completion gate — likely the `validation_attempts` enforcement gap from `bugs/2026-04-29-validator-enforcement-gap.md` (separate but related). File a follow-up; don't soak.

If any iteration fails STAGE 2 with STAGE 1 PASS: the prompt body / delivery path still has an issue post-fu2. Re-engage the architectural conversation (model swap, etc.).

If all 5 iterations PASS both stages: ship to slow soak.

- [ ] **8.3: Manual verification on the user's actual conversation**

Fire the brief once into the user's real conversation (not a synthetic one). Inspect the resulting turn. This is the last gate before tomorrow's morning soak.

```bash
curl -X POST http://localhost:4321/api/automations/debrief-reporter/fire
sleep 45
tail -1 ~/my_agent/.my_agent/conversations/conv-*.jsonl \
  | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("content",""))[:800]'
```

Verify: no Read narration, no meta-explanation, no "tomorrow's brief", clean section structure with content.

If clean: the soak resumes for tomorrow morning's calendar observation.
If not clean: the architectural conversation begins.

---

### Task 9 — Day-4 morning observation (2026-05-01)

After tomorrow's 07:00 BKK morning brief and 08:00 BKK relocation session:

- [ ] **9.1: Append to `soak-day-4.md`**

Same observational template as Day-1 / Day-2 reports. Verbatim openers, body completeness, validator state, deliverable.md cleanliness inspection per `.runs/`.

If clean: continue calendar soak (Day-5, Day-6, Day-7). After 7 clean days: sprint close. After 14 more clean days post-close: remove the `PROACTIVE_DELIVERY_AS_ACTION_REQUEST` feature flag.

If contaminated: the bug is not what we thought. Re-open the architectural question.

---

## Risk log

| Risk | Likelihood | Mitigation |
|---|---|---|
| Worker writes contaminated content directly (validator regex hole) and the new defense-in-depth gate also misses it | Medium | Defense-in-depth uses the same regex as the worker-runtime validator. If the regex has a hole, both gates miss. The probe loop will surface this — STAGE 1 FAIL + STAGE 2 FAIL together points here. Mitigation: widen regex (fu1 pattern). |
| Worker doesn't write `deliverable.md` at all → executor throws → job fails noisily | Low | Better than today's silent corruption. Error message is actionable. Worker prompt + template t1 explicitly say "Use the Write tool"; the only way this fires is if the worker bypasses both. |
| Defense-in-depth gate runs even when worker's todo_done validator already ran successfully — is this redundant? | Acceptable | Yes, intentional belt-and-suspenders. Cheap (regex on a small file). Catches Hypothesis H2 (worker bypassing todo-server). |
| Chart-augmentation block at line 649-672 reads stale `finalDeliverable` | None | After fu3, `finalDeliverable` is sourced from the worker's file (not the response stream). Same content the rest of the pipeline sees. Chart code unchanged. |
| Existing tests assert post-run overwrite behavior and break | Certain | Update them. Those tests were exercising the bug. The fu3 PR includes the test updates. |
| Probe Trigger 1 needs more than 15s for worker run | Low | Adjustable in the probe script. Current research workers complete in ~10s; relocation/brief assembly is longer. Tune if Trigger 1 races. |
| Production restart picks up partially-applied state | Negligible | We deploy via PR merge → systemd restart. No partial states between commits in the same PR. |

---

## Out of scope (forward improvements, NOT blocking)

1. **Chart augmentation as worker-runtime tool** (vs current post-run append). Today the chart code reads worker's clean `deliverable.md`, generates SVG via Haiku, appends `![chart](url)` and writes back. Post-fu3 this is enrichment (not corruption). Move to worker-side in a follow-up so the worker owns its complete deliverable.
2. **Capability_build / capability_modify template migration** to `result.json` sidecar. Zero active production workers use these. When revived, migrate.
3. **Validator regex extension for new narration patterns surfaced by future workers**. The current regex was designed against fu1's observed verbs; future workers may surface new ones. Add to the validator as observed.
4. **Handler-based automation cleanup**. `debrief-reporter` writes via `result.deliverable` field; could be unified with worker-side write. Not blocking; deterministic code, no contamination risk.
5. **`validation_attempts: 1` cosmetic in todos.json**. Today's contradictory cadence rule causes this. fu3 Task 5 fixes the rule, which should fix the cosmetic naturally — verify during Task 8.

---

## Done state

After fu3 lands and probe passes:

- Worker writes `deliverable.md` via Write tool. Plain markdown. Source of truth.
- Validator runs at todo-completion (worker-runtime gate).
- Validator runs again at job-end (defense-in-depth gate).
- If file missing: job fails loud with clear error.
- Heartbeat reads `deliverable.md` from disk → fu2 inlines content in action-request prompt → Nina renders without Read narration → user sees a clean brief.
- One write path. One read path. Two validator gates. No silent overwrite.

The fu1 + fu2 + fu3 stack:
- **fu1** widened the validator regex (catches narration if the worker emits it).
- **fu2** inlined content in the prompt body (no Read tool call → no narration).
- **fu3** made worker writes authoritative (the file the validator checks IS the file delivery reads).

All three are necessary. None alone fixes the chain.
