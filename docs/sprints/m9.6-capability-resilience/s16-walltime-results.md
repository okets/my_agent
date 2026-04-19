---
sprint: M9.6-S16
gate: wall-time measurement
generated: 2026-04-19T07:27:09.535Z
---

# S16 Wall-Time Results

**Gate:** plan-phase3-refinements.md §2.1 / design §6.3

## Plugs found at measurement time (real)

- `browser-chrome`
- `desktop-x11`
- `stt-deepgram`
- `tts-edge-tts`

## Results

| Plug | Type | Break method | Wall-time (s) | Outcome | Decision |
|------|------|-------------|---------------|---------|----------|
| s16-walltime-test-cap | synthetic (script) | synthetic smoke.sh exit 1 | 100 | completed | A |

## Gate decision

- [x] ≤5 min consistently: ship as-is
- [ ] 5–10 min consistently: file `proposals/s16-walltime-mitigation.md`, architect picks mitigation
- [ ] >10 min consistently: escalate — may need architectural change

## Measurement method

Synthetic test capability (`s16-walltime-test-cap`) with `smoke.sh exit 1` was created
temporarily. A MODE:FIX automation was written to `.my_agent/automations/` and fired via
`POST /api/automations/:id/fire`. Wall-time measured from fire request to job
`completed`/`failed` status in `GET /api/automations/:id/jobs`.
