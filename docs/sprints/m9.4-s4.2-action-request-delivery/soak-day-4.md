---
sprint: M9.4-S4.2 — Proactive Delivery as Action Request
soak_status: Day 4 of 7 — calendar-day soak gate cleared
date: 2026-05-01
events_observed:
  - 07:01 BKK morning brief (notify: debrief, debrief-reporter)
  - 08:03 BKK relocation session (notify: immediate, daily-relocation-session)
verdict: PASS — both deliveries clean, first morning since 2026-04-27 with both shapes good
---

# M9.4-S4.2 — Soak Day 4 Case Report

## TL;DR

**Both deliveries clean.** This is the calendar-day soak gate fu3 was waiting on. The probe-run-2 result (5/5 PASS Trigger 1) generalised to the real morning fire on real workers with real prompts on a real conversation. fu3 is closeable.

## Events

| Time (BKK) | Time (UTC) | Automation | notify | Status |
|---|---|---|---|---|
| 07:00:42 | 00:00:42 | debrief-reporter | debrief | completed (deliverable: 14,456 bytes) |
| 07:01:22 | 00:01:22 | heartbeat → action-request injection | — | delivered |
| 07:01:49 | 00:01:49 | brief turn lands in conv-01KPYCMD…HTJ | — | clean |
| 08:00:42 | 01:00:42 | daily-relocation-session | immediate | completed (deliverable: 5,563 bytes) |
| 08:03:13 | 01:03:13 | heartbeat → action-request injection | — | delivered |
| 08:03:38 | 01:03:38 | relocation turn lands in conv-01KPYCMD…HTJ | — | clean |

## STAGE 1 — deliverable.md cleanliness

Both files head-300 ran through the validator regex (`STRONG_OPENERS` + `SECOND_MARKERS`) — zero hits each.

**Debrief deliverable opener (verbatim, first 100 chars):**
```
<!-- wrapper -->
## chiang-mai-aqi-worker

## Chiang Mai Air Quality

**AQI: 89 (Moderate)**
PM2.5:
```

**Relocation deliverable opener (verbatim, first 100 chars):**
```
# Daily Relocation Update — May 1, 2026

## Current Status

**Location:** Chiang Mai, Thailand (The
```

Both are pure structured content. No `Let me`, no `I'll start`, no `Now I need to`, no `Let me read` — the regression patterns from days 2 and 3 are absent.

## STAGE 2 — assistant turn cleanliness

**Brief turn @ 2026-05-01T00:01:49.420Z (07:01 BKK), verbatim opener:**
```
## Morning Brief — May 1, 2026

---

### 🌬️ Air Quality — AQI 60, Moderate

Down from 89 yesterday, PM2.5 at ~16 µg/m³. That's a real improvement —
for context, late March peaked at 263. The burning season is functionally
over, open burning ban holds through May 31, and once the May rains
arrive mid-month it'll drop further. Outdoor mornings are back.
```

**Relocation turn @ 2026-05-01T01:03:38.243Z (08:03 BKK), verbatim opener:**
```
## Relocation Update — May 1, Day 8

![Relocation tracker](/api/assets/screenshots/ss-eed2b77d-4bf0-4d41-b364-363bef597cbc.png)

**Status: On track.** eSIM, Line, Lazada all done. School letters in
progress and on schedule for the Vietnam trip.
```

Both turns open with their own structured heading — no Read tool narration, no worker process bleed, no conversation gravity from yesterday's transcript. Mediation visible: the brief reads "AQI 60 — down from 89 yesterday" (comparative analysis present in the turn but not the source deliverable, where the AQI value alone is "AQI: 89 (Moderate)" because the brief was assembled from yesterday's chiang-mai-aqi-worker reports). That's exactly the brain doing its job — picking what matters, structuring it, voicing it — without dropping sections.

## Felt-experience contrast vs the 4-day run

| Day | Brief opener | Reloc opener | User read |
|---|---|---|---|
| 04-27 | clean (pre-S4.2 baseline) | clean | "good" |
| 04-28 | "(That's tomorrow's morning brief arriving early — the debrief reporter runs at 2am to be ready for 7am. Let me grab it.)" | "The deliverable is corrupted — it's just the agent's internal reasoning…" | regression flagged |
| 04-29 | "Let me read that deliverable.Good — I have the full picture…" | "The worker left its process narration instead of the final composed message…" | "massive degradation" |
| 04-30 | "This one's a debrief reporter that had an identity crisis…" | "Another worker that didn't make it…" | floor; fu3 planned |
| **05-01** | **`## Morning Brief — May 1, 2026`** | **`## Relocation Update — May 1, Day 8`** | **clean** |

The fu3 worker→executor contract change (executor reads worker's `deliverable.md` verbatim instead of overwriting it with the response stream) eliminated the contamination at source. Same workers, same models, same prompts. The only thing that changed between 04-30 and 05-01 was the executor's load-bearing edit.

## Defense-in-depth gate

The validator gate at job-end (`runValidation("deliverable_written", run_dir)` in `readAndValidateWorkerDeliverable`) was effectively a no-op today because both deliverables were already clean — but its presence is what guarantees that "if a worker ever regresses, the executor will throw `failed` instead of letting contamination through." That's the fail-loud contract; today it didn't have to fire.

## What this closes

- **fu3 (PR #13 — `f41ea2e` on master)** — the load-bearing edit. Master tree was green by 2026-04-30 23:00 IDT (concern #1 cleared at `8b501c3`); the calendar-day soak gate is now also passed.
- **Open question from architect-review-fu3.md concern #2** ("watch one full day before declaring done") — answered: clean.

## What's still pending (not blocking fu3 close)

- **FU2 task 8 (Day-3 observation)** — never written. Day-3 (2026-04-30) was the day fu3 was *built and shipped*, so a clean observation report wasn't the goal of the day; the goal was diagnosis-and-fix. The probe-run-2 report (`probe-run-2.md`) functionally serves as the Day-3 evidence.
- **FU1 task 7 (Day-2 observation entry)** — the Day-2 case was so dense it became `soak-day-2.md` itself. No follow-up owed.
- **Soak Days 5–7** — the 7-day calendar window CTO requested. Days 5, 6, 7 are routine observation; if any regress, that's a new sprint.

## References

- fu3 plan: [`soak-day-3-followup-plan.md`](soak-day-3-followup-plan.md)
- fu3 probe results: [`probe-run-2.md`](probe-run-2.md) (5/5 PASS Trigger 1)
- Architect review: [`architect-review-fu3.md`](architect-review-fu3.md)
- fu3 PR: #13 merged @ master `f41ea2e`
- Concern #1 fix: master `8b501c3`
- Today's run dirs:
  - debrief: `.my_agent/automations/.runs/debrief-reporter/job-bca62535-be7d-478f-bf01-e4d91d2d766e/`
  - reloc: `.my_agent/automations/.runs/daily-relocation-session/job-235b500b-9436-4ce9-b841-22e8397dd0b8/`
- Conversation: `conv-01KPYCMD9438AYAKX67BZETHTJ`, turns at 2026-05-01T00:01:49.420Z and 2026-05-01T01:03:38.243Z
