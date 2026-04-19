---
sprint: M9.6-S16
gate: wall-time measurement
generated: 2026-04-19T10:55:00.000Z
overall_branch: C
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
| tts-edge-tts | script | config.yaml voice → "en-XX-BrokenVoiceXXX" | 480 | fixed (3 attempts) | B |
| browser-chrome | MCP | CAPABILITY.md entrypoint → missing file | 652 | fixed (3 attempts) | C |

Per-attempt breakdown:

| Plug | Attempt 1 | Attempt 2 | Attempt 3 | Total |
|------|-----------|-----------|-----------|-------|
| tts-edge-tts | 122 s | 144 s | 213 s | 480 s (8.0 min) |
| browser-chrome | 113 s | 322 s | 217 s | 652 s (10.9 min) |

## Gate decision

- [ ] ≤5 min consistently: ship as-is
- [x] 5–10 min consistently: file `proposals/s16-walltime-mitigation.md`, architect picks mitigation
- [x] >10 min consistently: escalate — may need architectural change

See `proposals/s16-walltime-mitigation.md` for mitigation options (M1/M2/M3) and recommendation.

## Measurement method

Two real plugs surgically broken and measured end-to-end through the live recovery
orchestrator via `POST /api/debug/cfr/inject` (M9.6-S16 Path B endpoint, added to
`packages/dashboard/src/routes/debug.ts`). Both plugs were successfully FIXED by
Opus over 3 attempts each.

- `tts-edge-tts`: voice name in `config.yaml` changed to `en-XX-BrokenVoiceXXX`
- `browser-chrome`: entrypoint in `CAPABILITY.md` changed to `src/server-broken-s16-test.ts`

Wall-time measured from `cfr.emitFailure()` call to final attempt `completed` status.
Plugs were restored by Opus (verified: both files back to original values). Backup
files (`*.bak`) cleaned up after verification.
