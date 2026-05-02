# Post-fu3 Side-Effect Worker Incident — `update-relocation-roadmap`

**Job:** `job-7ed578ce-ce87-485b-b6f3-2c79e8293d58`
**Conversation:** `conv-01KPYCMD9438AYAKX67BZETHTJ`
**Window:** 2026-05-02 04:01:50 → 04:06:26 UTC

---

## 1. TL;DR

**fu3 is innocent.** The `readAndValidateWorkerDeliverable` gate at `automation-executor.ts:75` PASSED — `deliverable.md` exists (4918 bytes, well-formed). The executor logged `Automation "update-relocation-roadmap" completed (job …)`, returned `{success: true, work, deliverable: <full text>}`, and then `automation-processor.ts:136` (added in `ec948f8`, M9-S3.1, 2026-04-02 — pre-dates fu3) downgraded the job to `failed` because `result.work.trim().length < 20`. `result.work` is the assistant **text-block stream**, not the deliverable file — and Sonnet correctly suppressed narration per the todo template's "do NOT narrate, emit the report only" directive. The roadmap on disk IS correctly updated (mtime 07:04:17 +0300, all 7 phases, new Tel Aviv strategy). Nina's "just a reporting issue" is half-right (the file is good) and half-wrong (a real `job_failed` notification fired, which is what she was reacting to — she just framed the failure as benign and stopped digging). This surfaced a real design gap: the pre-fu3 narration-length heuristic for "empty deliverable" is now actively wrong because (a) fu3 made the on-disk deliverable.md the source of truth, and (b) the worker prompt explicitly tells the model to be silent.

## 2. Timeline

| Timestamp (UTC) | Event |
|---|---|
| 03:58:11 | User: "Update the relocation roadmap if you haven't already." |
| 03:58:18 | Nina: "On it." |
| 04:01:50.727 | Job created. Executor starts. (`[AutomationExecutor] Running automation "update-relocation-roadmap"`) |
| 04:01:58.943 | Nina sends conversation-side preview of changes ("Removed: …, Added: …, Updated: …") |
| 04:03:22.118 | Nina: "The roadmap update is running in the background — I'll confirm when it's done." |
| 04:04:17.965 | `relocation-roadmap.md` written (target file mtime) |
| 04:05:11.843 | `deliverable.md` created (Birth) |
| 04:05:53.110 | `status-report.md` written |
| 04:05:55.889 | `todos.json` finalized (all 5 items `done`) |
| 04:05:58 | `[AutomationExecutor] Deliverable has chartable data, generating chart` (would not run if fu3 had thrown) |
| 04:06:16.492 | `deliverable.md` re-written with chart appended |
| 04:06:16 | `[AutomationExecutor] Automation "update-relocation-roadmap" completed (job …)` — executor success path |
| 04:06:16 | `[AutomationProcessor] Empty deliverable for "update-relocation-roadmap" (job …)` — processor downgrades to failed |
| 04:06:16.498 | Notification enqueued: `type: job_failed, summary: "[update-relocation-roadmap] Failed: empty_deliverable"` |
| 04:06:16+ | Heartbeat formats prompt: `"A background task failed.\n\nError: [update-relocation-roadmap] Failed: empty_deliverable\n\n…"` (heartbeat-service.ts:428) |
| 04:06:26.771 | Nina renders that prompt to the user as "The roadmap write failed — the worker completed its todos but didn't produce a deliverable confirmation. The file itself was written correctly though…" |

## 3. The job's actual state

- `status: failed` (downgraded by processor, not executor)
- `summary: "Completed with empty deliverable — no useful output produced"` (set by `automation-processor.ts:142`)
- `deliverablePath`: present, points at the 4918-byte file
- `deliverable.md`: **EXISTS**, well-formed markdown report with new visa strategy + chart screenshot embedded
- `status-report.md`: 3.3K, "Job completed successfully. All mandatory todo items marked done."
- `todos.json`: all 5 mandatory items `status: done` (incl. `t3` validation `deliverable_written` and `t5` validation `status_report` — both passed runtime validation)
- `screenshotIds: ["ss-ecb123fe-..."]` — chart was generated and appended (proves the executor went past fu3's gate AND past the success path; chart generation only runs after `readAndValidateWorkerDeliverable` returns)

## 4. fu3 causal chain confirmation

**No.** Three independent pieces of evidence:

1. **No fu3 throw in journalctl.** If `readAndValidateWorkerDeliverable` had thrown, the catch block at `automation-executor.ts:784` would log `[AutomationExecutor] Automation "…" failed (job …)`. The actual log line is `… completed (job …)`.
2. **Chart augmentation ran.** That code path is gated by `if (finalDeliverable && deliverablePath && this.config.visualService)` immediately after `readAndValidateWorkerDeliverable`. We see `[AutomationExecutor] Deliverable has chartable data` and `Chart appended to deliverable: …` in journalctl. Both require fu3's gate to have already passed.
3. **The notification's error string.** The on-disk notification (`.my_agent/notifications/delivered/1777694776498-job-…json`) has `summary: "[update-relocation-roadmap] Failed: empty_deliverable"`. fu3's throw would produce `Worker did not write deliverable.md to …` (executor-level error message), routed through `automation-processor.ts:269` as `Failed: ${result.error}`. The string `empty_deliverable` is set ONLY at `automation-processor.ts:145` — i.e. the narration-length heuristic, not fu3.

## 5. What Nina saw vs. what actually happened

Nina received a real `job_failed` action-request via heartbeat: *"A background task failed. Error: [update-relocation-roadmap] Failed: empty_deliverable. …"* (per `heartbeat-service.ts:428`). She correctly inferred the file write succeeded (she could see it via Read in the system) and framed the failure as a "reporting issue on the worker's side." That framing is **technically defensible** (the work was done; only the in-band confirmation was missing) but **operationally wrong**:

- The job is recorded as `status: failed` in the source-of-truth `.jsonl` manifest. Any subsequent debrief, scoreboard, or "what failed yesterday" sweep will include it.
- The `notify: immediate` framing produced a user-facing message saying "the roadmap write failed" — which is incorrect. The write succeeded; the post-hoc heuristic falsely flagged it.
- Nina did NOT investigate further (no Read on todos.json, no check of journalctl). She accepted the prompt's framing AND simultaneously contradicted it. That contradiction is the smell — when a healthy file is on disk and the framework says "failed," one of them is lying. She should have flagged it.

## 6. Was the side-effect successful?

**Yes.** `~/my_agent/.my_agent/spaces/thailand-relocation/relocation-roadmap.md` mtime `2026-05-02 07:04:17 +0300` (i.e. 04:04:17 UTC, mid-job). Confirmed contents:

- Header updated: "Last updated: May 2, 2026 — plan revised: Vietnam trip cancelled, visa reset to Singapore/HK, ED/Non-O applications from Thai Embassy Tel Aviv during Israel summer"
- All 7 phases present, in the new sequence
- Critical path chain reflects new flow (visa reset → finish school → Israel → Tel Aviv visa → return Aug 10)
- Cost summary, document requirements, Open Flags all updated

The user's intent was fulfilled. The framework's reporting was wrong about it.

## 7. Design question

This is a `result.work` heuristic problem, not a `deliverable.md` contract problem. Pre-fu3, `result.work` was the only signal of "did the worker do anything"; the `< 20` length check was a reasonable smoke test. **Post-fu3, the on-disk `deliverable.md` is the source of truth**, and `result.work` (assistant text stream) is no longer correlated with worker success — especially because the same sprint (S4.2 fu2) added explicit "do NOT narrate" anti-narration directives that suppress the very signal the heuristic measures.

Of the three options:

- **(a) Require all workers to narrate >20 chars.** Conflicts directly with fu2's anti-narration directive and the `Do NOT narrate your process … emit the report only` todo template. We'd be telling the worker "be silent" and "be loud" in the same prompt.
- **(b) `job_type: side_effect` flag.** Adds a manifest knob for what is really a framework-level invariant. Most workers do legitimate side effects today; gating on a flag invites manifest drift.
- **(c) Soft-fail with `completed_no_deliverable`.** Better, but mis-named: in this case the deliverable IS present. The wrong axis to pivot on.

**Recommended: option (d) — replace the heuristic with the on-disk truth.** Change `automation-processor.ts:136` from `result.work.trim().length < 20` to `(!result.deliverable || result.deliverable.trim().length < 20)`. `result.deliverable` is already populated from the disk file by the executor. This is correct by construction:

- If `deliverable.md` is missing or contaminated → fu3 already threw → we never reach line 136 (the catch block at executor.ts:784 sets `success: false` and we skip the heuristic).
- If `deliverable.md` exists and has real content → success regardless of how chatty/silent the model was.
- If a worker writes a 5-byte placeholder → still flagged as empty (the heuristic's original intent).

Two-line change, no manifest schema growth, removes the `result.work` dependency for empty-deliverable detection. fu3's invariant becomes the single point of truth.

## 8. Action items

**Patch (smallest):**

```typescript
// automation-processor.ts:136
- if (result.success && (!result.work || result.work.trim().length < 20)) {
+ if (
+   result.success &&
+   (!result.deliverable || result.deliverable.trim().length < 20)
+ ) {
```

**Test:** existing soak-probe (Trigger 1, the real-automation-fire test from `f1d3c60`) should continue to pass. Add a new test fixture: worker emits zero assistant text but Writes a valid 1KB deliverable.md → must end `status: completed`, `notify: immediate` should produce a `job_completed` action request, NOT `job_failed`.

**No worker-side change needed.** The worker did everything correctly: 5/5 todos done, `deliverable_written` validator passed, `status_report` validator passed, file written to target path, chart augmentation succeeded.

**Brain-side (Nina) note:** when the framework reports "failed" and the file on disk contradicts that, escalate rather than rationalize. A future skill update could add: *"if a job_failed notification's summary contradicts observable filesystem state, do not paper over it — surface the contradiction to the user as a framework bug."* Out of scope for this patch but worth a brain-skills follow-up.

---

**Files referenced:**

- `/home/nina/my_agent/packages/dashboard/src/automations/automation-executor.ts:75-98` (fu3 gate — passed cleanly)
- `/home/nina/my_agent/packages/dashboard/src/automations/automation-processor.ts:135-146` (the actual culprit, predates fu3)
- `/home/nina/my_agent/packages/dashboard/src/automations/heartbeat-service.ts:427-428` (job_failed prompt format)
- `/home/nina/my_agent/packages/dashboard/src/automations/todo-templates.ts:55,73` (anti-narration directive)
- `~/my_agent/.my_agent/automations/.runs/update-relocation-roadmap/job-7ed578ce-…/` (job artifacts)
- `~/my_agent/.my_agent/notifications/delivered/1777694776498-job-7ed578ce-…json` (the false-failure notification)
- `~/my_agent/.my_agent/spaces/thailand-relocation/relocation-roadmap.md` (the successfully-updated target)
