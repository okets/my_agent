---
sprint: M9.4-S4.2 — Proactive Delivery as Action Request
status: closeout — for team consultation
date: 2026-05-01
author: handoff prepared by AI pair, awaiting team review
verdict: fu3 closeable. Master green. Calendar-day soak gate cleared.
---

# M9.4-S4.2 Closeout Report

> One-screen brief for team consultation on next steps.

## TL;DR

- **What we set out to do:** make scheduled deliveries (morning brief, daily relocation, immediate-notify automations) land as clean, mediated turns instead of `[SYSTEM:]`-wrapped status dumps that the brain dismissed.
- **What we shipped:** S4.2 (route through action-request channel, not system-message channel) → fu1 (widen validator regex, tighten prompt) → fu2 (inline content in prompt body, kill Read-tool narration) → fu3 (delete the executor's overwrite of `deliverable.md`, fail loud when worker doesn't produce one).
- **Where we are this morning (Day 4 of 7-day soak):**  both `notify:debrief` (07:01 BKK brief) and `notify:immediate` (08:03 BKK relocation) deliveries landed clean. First clean morning for both shapes since 2026-04-27.
- **Master tree:** 1455 passed / 24 skipped / 0 failed at `a78990b`. Architect concern #1 cleared.
- **Open questions for the team:** §6.

## 1. The four-day arc (what the user actually saw)

| Date | Brief opener (07:01 BKK) | Reloc opener (08:03 BKK) | User read |
|---|---|---|---|
| 2026-04-27 | clean (pre-S4.2 baseline) | clean | "good" |
| 2026-04-28 | "(That's tomorrow's morning brief arriving early — the debrief reporter runs at 2am to be ready for 7am. Let me grab it.)" | "The deliverable is corrupted — it's just the agent's internal reasoning, no actual content." | regression flagged |
| 2026-04-29 | "Let me read that deliverable.Good — I have the full picture…" | "The worker left its process narration instead of the final composed message…" | "massive degradation in how Nina presents me briefs since last week" |
| 2026-04-30 | "This one's a debrief reporter that had an identity crisis…" | "Another worker that didn't make it…" | floor — fu3 planned and shipped same day |
| **2026-05-01** | **`## Morning Brief — May 1, 2026`** | **`## Relocation Update — May 1, Day 8`** | **clean** |

## 2. Why the fix needed three rounds (fu1, fu2, fu3)

Each round addressed a real layer; none was wasted, but the diagnosis sharpened each time.

| Round | Diagnosis at the time | Fix landed | What it actually solved | What it left exposed |
|---|---|---|---|---|
| **S4.2** | "Briefs are dismissed as 'background activity' because they arrive as `[SYSTEM:]` notifications." | Route proactive deliveries through action-request channel (USER role, no wrap), inline content in the prompt body, queue → heartbeat → injection. | Routing: deliveries no longer dismissed; brain enters mediator mode. | Workers themselves still emitted narration; conversation gravity from yesterday's transcript still bled into openers. |
| **fu1** | "Validator regex is too narrow; prompt isn't tight enough; SDK session is reusing yesterday's context." | Widened regex (`I'll start by`, `Now I need to`, `Let me read/check/find/search`), tightened prompt ("TODAY's", "pause and deliver"), rotated SDK session, fixed relocation manifest. | Caught the prompt-level dismissal patterns; rotation eliminated transcript inheritance. | The Read-tool invitation in S4.2's "read this deliverable" framing structurally invited Sonnet's tool-call narration. |
| **fu2** | "Telling Sonnet to Read a file path always invites narration of the call. Don't ask, just hand it the content." | Inline the resolved deliverable in the prompt body, wrapped in `---` delimiters. The artifact still lives at `run_dir/deliverable.md` for provenance. | "Let me read that deliverable…" leakage gone at brain layer. | Workers were still writing junk to `deliverable.md`, and the executor was overwriting it with the response stream anyway. |
| **fu3** | "Worker→executor contract is broken at framework level. The on-disk file is being overwritten by the model's pre-tool-call narration. Conflicting templates left it ambiguous which side owned the file." | Executor reads `deliverable.md` verbatim and validates it; never overwrites. Fails loud (`status: failed`) if the worker didn't write one. Worker prompt cadence aligned: write file first, then `todo_done`. | The on-disk file is now ground truth. Workers must write it cleanly or the job fails. | (none observed today.) |

The investigation that produced fu3 is documented in three companion docs: [`worker-pipeline-history.md`](worker-pipeline-history.md), [`worker-pipeline-mechanism-inventory.md`](worker-pipeline-mechanism-inventory.md), [`worker-pipeline-redesign.md`](worker-pipeline-redesign.md). The redesign was a hard delete of the legacy XML-tag contract and an opportunistic-fallback path that had silently introduced the bug on Apr 1 (commit `f4f5d83`).

## 3. Verification evidence

| Layer | Source | Result |
|---|---|---|
| Unit + integration tests | `npx vitest run` from clean tree at `a78990b` | 1455 passed / 24 skipped / 0 failed |
| Synthetic probe (Trigger 2, fu2) | `probe-run-1.md` | 5/5 PASS |
| Real-fire probe (Trigger 1, fu3) | `probe-run-2.md` | 5/5 PASS over ~18 min wall time |
| Calendar-day soak (notify:debrief) | This morning's 07:01 BKK brief | Clean — turn opens with `## Morning Brief — May 1, 2026` |
| Calendar-day soak (notify:immediate) | This morning's 08:03 BKK relocation | Clean — turn opens with `## Relocation Update — May 1, Day 8` |
| Validator regex check (post-hoc) | Both deliverables this morning | 0 STRONG_OPENERS, 0 SECOND_MARKERS in head-300 |
| Architect review | `architect-review-fu3.md` | APPROVE WITH CHANGES (cosmetic only) — concern #1 fixed at `8b501c3` |

## 4. What's not yet verified

- **Soak days 5, 6, 7** — the calendar window the team agreed to before declaring "done." Today is Day 4. Nothing forces a "shipped" call yet; another 3 mornings of clean deliveries make it boring instead of provisional.
- **Other notify:immediate workers** beyond `daily-relocation-session`: `coworking-spaces-chiang-mai`, `debrief-reporter` (the latter is debrief, but it has an immediate path too). They share the framework so the change generalizes, but they haven't been exercised on a real fire since fu3.
- **Failure-path observability**: fu3 is "fail loud" — if a worker regresses, the job goes to `status: failed` and fires a `job_failed` notification. We have not yet observed that path firing in production. The probe forced it once via TDD-failing test scaffolding; never on a live worker.

## 5. Side findings (out-of-scope for this sprint)

- **Debrief digest duplicates the same worker report.** Today's `deliverable.md` has the chiang-mai-aqi-worker block repeated 3+ times in the wrapper. Doesn't affect the user-facing turn (the brain renders cleanly), but it's wasted tokens and a real bug in `debrief-reporter`'s collection-window logic. **Not fu3's domain.** Worth a separate ticket.
- **Validator-enforcement-gap (filed FU2 task 7).** The validator runs but doesn't always block; documented as a separate thread. fu3 closed the most-load-bearing path (job-end gate in `readAndValidateWorkerDeliverable`) but other validation hooks still need an audit.
- **Test 8.3 (manual fire of debrief-reporter into the real conv).** Was on the fu3 plan, never executed because Day-4 morning observation covered the same path. Could still be useful as a forced-failure exercise.

## 6. Open questions / decisions for the team

1. **Declare M9.4-S4.2 done after Day 4, or hold to the 7-day soak window?**
   - Done after 4 = unblocks M10 (memory perfection) immediately. Risk: a Day 5–7 regression reopens it.
   - Hold to 7 = boring confidence. Cost: 3 days of nothing-shipping-in-this-area.
2. **What's the policy when a worker regresses post-fu3?** Today fu3 is fail-loud. Options: (a) accept that and let the user see `job_failed` notifications until we patch; (b) add a graceful-degrade path that routes to needs_review with a stub deliverable; (c) make worker regressions automatically retry once before failing. Each has real tradeoffs — fail-loud is honest, graceful is cushy, retry is opaque.
3. **Spin off the side findings (§5) as their own sprint, or bundle into M10 setup?**
4. **Architect concern #2 ("watch one full day before declaring done") — answered by today, or does the team want a longer watch?**

## 7. References for deeper reads

- Sprint plan: [`plan.md`](plan.md)
- Day-by-day soak reports: [`soak-day-1.md`](soak-day-1.md), [`soak-day-2.md`](soak-day-2.md), [`soak-day-4.md`](soak-day-4.md)
- Follow-up plans: [`soak-day-1-followup-plan.md`](soak-day-1-followup-plan.md), [`soak-day-2-followup-plan.md`](soak-day-2-followup-plan.md), [`soak-day-3-followup-plan.md`](soak-day-3-followup-plan.md)
- Investigation triad: [`worker-pipeline-history.md`](worker-pipeline-history.md), [`worker-pipeline-mechanism-inventory.md`](worker-pipeline-mechanism-inventory.md), [`worker-pipeline-redesign.md`](worker-pipeline-redesign.md)
- Probe results: [`probe-run-1.md`](probe-run-1.md), [`probe-run-2.md`](probe-run-2.md)
- Architect review: [`architect-review-fu3.md`](architect-review-fu3.md)
- Key commits on master: `f41ea2e` (fu3 PR #13 merge), `8b501c3` (concern #1 fix), `a78990b` (soak day 4)
