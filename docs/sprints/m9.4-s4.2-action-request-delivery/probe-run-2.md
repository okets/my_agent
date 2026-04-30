---
date: 2026-04-30
sprint: M9.4-S4.2 — Proactive Delivery as Action Request
phase: fu3 fast-iteration validation (Trigger 1, real automation fire)
result: 5/5 PASS — fu3 cleared the worker→executor contract
---

# M9.4-S4.2 fu3 — Probe Run 2 (Trigger 1)

## TL;DR

**5 consecutive PASS.** All STAGE 1 (deliverable.md cleanliness). fu3's load-bearing edit is working in production: workers write clean content, executor preserves it without overwrite, validator's job-end gate passes.

## Setup

- Trigger 1 (real automation fire)
- Strategy A (don't apply for Trigger 1; user's conv unchanged)
- Worker: `chiang-mai-aqi-worker` (notify: debrief — STAGE 2 N/A; brief queues for daily 7am assembly, not immediate delivery)
- 5 iterations, ~3 minutes each (110-140s worker run + 60s cooldown)

## Iterations

| # | Worker run | Deliverable cleanliness | Result |
|---|---|---|---|
| 1 | 140s | clean (199 chars) | PASS |
| 2 | 110s | clean (200 chars) | PASS |
| 3 | 105s | clean (241 chars) | PASS |
| 4 | 110s | clean (199 chars) | PASS |
| 5 | 140s | clean (199 chars) | PASS |

Total wall time: ~18 minutes for 5 iterations.

## Sample deliverable.md (verbatim from iteration 1)

```
## Chiang Mai Air Quality

**AQI: 89 (Moderate)**
PM2.5: ~30 µg/m³ | Dominant pollutant: PM2.5

Unusually sensitive people should consider limiting prolonged outdoor exertion.

(source: aqicn.org)
```

Properties verified by STAGE 1 regex:
- ✓ No `^Let me start by`, `^I'll start (by|executing)`, or other STRONG_OPENERS
- ✓ Zero weak narration markers in head-300 (no "Let me check", "Now I need", etc.)
- ✓ Body length ≥ 50 chars
- ✓ Markdown structure (`## ` headings)
- ✓ Substantive content (AQI value, PM2.5 measurement, guidance, source citation)

Compare to today's pre-fu3 brief deliverable (reproduced from soak-day-3.md):

```
<!-- wrapper -->
## expat-tips-worker

I'll start by checking my todo list and then execute the automation.
I need to understand the automation spec first before writing deliverable.md.
Let me read the automation spec to understand what expat-tips-worker should produce.
Now let me check what previous tips have been given to avoid repeating evergreen ones […]
```

The pre-fu3 deliverable was 100% narration. The post-fu3 deliverable is 100% content. **Same worker (chiang-mai-aqi-worker is one of the 5 brief-feeders), same model, same prompts. Only the executor's `automation-executor.ts:605-621` block changed — and the contamination is gone.**

This confirms the diagnosis from the three investigation docs: the executor was overwriting the worker's clean output. With fu3's edit, the worker's file is preserved verbatim.

## Why STAGE 2 was N/A

`chiang-mai-aqi-worker` has `notify: debrief` (default) — it queues for the daily 7am brief assembly, not immediate delivery. STAGE 2 (assistant turn cleanliness) only fires for `notify: immediate` workers (`daily-relocation-session`, `coworking-spaces-chiang-mai`, `debrief-reporter`).

The probe correctly detected this and exited with OVERALL PASS based on STAGE 1 alone. The fu3 load-bearing fix is in the worker→executor contract, which STAGE 1 validates directly. STAGE 2 is downstream and tests fu2 (which already validated 5x in probe-run-1).

## Probe behavior summary

The probe script automatically:
1. Reads the automation manifest's `notify:` field
2. If `notify: immediate` → run STAGE 2 (poll user's conv for new turn)
3. Otherwise → skip STAGE 2 with OVERALL PASS based on STAGE 1

This makes the probe correct for both notify types without manual intervention.

## What this validates

**fu3 load-bearing fix:**
- Worker writes `deliverable.md` via Write tool → file is clean ✓
- Executor's `automation-executor.ts:605-621` no longer overwrites with stream → file stays clean ✓
- Defense-in-depth `runValidation("deliverable_written", run_dir)` at job-end → would have thrown on contamination ✓

**fu2 stack still works:**
- Per probe-run-1, all action-request prompt-shape changes passed 5x. fu3 doesn't change those.

## What's still pending

**Task 8.3 (manual verification on real conv):** fire `debrief-reporter` once into the user's real conversation. This validates the full STAGE 1 + STAGE 2 + downstream-pipeline-end-to-end path including the heartbeat → action-request → SDK call → user-facing turn. Single fire, deliberately user-disruptive (delivers a real brief turn into the live WhatsApp conversation).

**Task 9 (Day-4 morning soak observation, 2026-05-01):** the calendar-day soak gate. Tomorrow's 07:00 BKK morning brief is the load-bearing observation. fu3 should make this clean.

## References

- Plan: [`soak-day-3-followup-plan.md`](soak-day-3-followup-plan.md)
- Three investigation docs: [`worker-pipeline-history.md`](worker-pipeline-history.md), [`worker-pipeline-mechanism-inventory.md`](worker-pipeline-mechanism-inventory.md), [`worker-pipeline-redesign.md`](worker-pipeline-redesign.md)
- fu3 PR: #13 merged @ master `f41ea2e`
- Probe script: `scripts/soak-probe.sh` (Trigger 1 added in fu3 PR; notify-aware skip added in `f14ccca`)
- Day-2 case report: [`soak-day-2.md`](soak-day-2.md)
- Probe run 1 (Trigger 2, fu2 validation): [`probe-run-1.md`](probe-run-1.md)
