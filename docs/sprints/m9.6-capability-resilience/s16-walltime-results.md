---
sprint: M9.6-S16
gate: wall-time measurement
generated: 2026-04-19T04:28:40.591Z
---

# S16 Wall-Time Results

**Gate:** plan-phase3-refinements.md §2.1 / design §6.3

## Plugs found at measurement time

- `browser-chrome`
- `desktop-x11`
- `stt-deepgram`
- `tts-edge-tts`

## Results

| Plug | Type | Break method | Wall-time (s) | Outcome | Decision |
|------|------|-------------|---------------|---------|----------|
| _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ |

## Gate decision

- [ ] ≤5 min consistently: ship as-is
- [ ] 5–10 min consistently: file `proposals/s16-walltime-mitigation.md`, architect picks mitigation
- [ ] >10 min consistently: escalate — may need architectural change

## How to run

```bash
# 1. Load env
set -a && . packages/dashboard/.env && set +a

# 2. For each plug to test:
#    a. Introduce a surgical break (e.g., edit config.yaml to use wrong API key)
#    b. Send a triggering message via dashboard
#    c. Time from CFR ack ("hold on — ...") to restoration or surrender
#    d. Record in the table above
#    e. Verify plug restored (or restore manually if surrendered)

# 3. Fill in the table above and commit
```
