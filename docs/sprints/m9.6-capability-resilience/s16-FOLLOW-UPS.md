---
sprint: m9.6-s16
---

# S16 Follow-Ups

## FU-1 — Empty `session.attempts` on ESCALATE paths degrades paper trail

- **What:** When `runOneAttempt` hits an ESCALATE marker and returns early, `session.attempts` stays `[]`. `terminalDrain`'s `writeAutomationRecovery` call receives zero attempts — CFR_RECOVERY.md shows no attempt history for ESCALATE surrenders.
- **Why deferred:** Not a correctness bug; the orchestrator surrenders correctly. Reviewer flagged as "Important" but approved "ship as-is, file FOLLOW-UP." Adding a synthetic FixAttempt record requires threading `hypothesis`, `change`, `executeJobId` through the early-return path — small change, but outside Task 4 scope.
- **Target sprint:** S17 (reflect dead-code cleanup) or S18

## FU-2 — No warn/test for unrecognized ESCALATE payload

- **What:** If `deliverable.body` starts with `ESCALATE: gibberish`, the orchestrator sets no `surrenderReason` (undefined), `terminalAckKind` falls back to plain `"surrender"`, and no log line fires. The surrender is handled but the mis-shaped output is silent.
- **Why deferred:** Safe default behavior; reviewer approved "Important" as ship-as-is. Fix: add `console.warn` + one test for the unrecognized-reason path.
- **Target sprint:** S17

## FU-3 — Write-guard hook for `.my_agent/` not yet implemented

- **What:** The `.my_agent/` write-guard hook (M9.2 TODO) that exempts `capability_modify` automations is absent. Noted in D1 of s16-DECISIONS.md.
- **Why deferred:** No sprint has been scoped for it yet. The automation fix path works correctly without it; the guard is a security/auditability improvement.
- **Target sprint:** Dedicated hook-setup sprint (pre-M10 or early M10)

## FU-4 — Wall-time measurement (RESOLVED 2026-04-19 — Branch B/C)

- **What:** Task 12 executed against 2 real broken plugs via `POST /api/debug/cfr/inject`. Both plugs fixed by Opus. tts-edge-tts: 480 s (8.0 min, Branch B). browser-chrome: 652 s (10.9 min, Branch C).
- **Mitigation proposal:** `proposals/s16-walltime-mitigation.md` — M1 (smoke output in prompt), M2 (per-type timeouts), M3 (relax boundary). Recommendation: M1 + M3.
- **Gate decision:** Pending architect selection of M1/M2/M3.

## FU-5 — `stalemate` path not covered by fix-mode tests

- **What:** The reflect dead-code block (lines ~447–482 in recovery-orchestrator.ts) is unreachable post-S16 but not yet deleted. Future readers may be confused by the REFLECTING state machine path that never triggers.
- **Why deferred:** S17's explicit purpose is reflect-phase collapse and dead-code cleanup.
- **Target sprint:** S17

## FU-6 — Plug types not exercised by wall-time measurement

Per §0.1 universal-coverage rule, plug types not in the wall-time table need rationale:

- `browser-chrome` (MCP type): included in wall-time plan; awaiting CTO run (FU-4)
- `desktop-x11` (MCP type): smoke exits 2 (SMOKE_SKIPPED) — plug exists but is inconclusively testable; same category as S15's inconclusive-pass handling
- `stt-deepgram` (script type): included in wall-time plan; awaiting CTO run (FU-4)
- `tts-edge-tts` (script type): included in wall-time plan; awaiting CTO run (FU-4)
- **Target sprint:** Wall-time coverage completes with FU-4; S20 exit gate covers all installed plugs end-to-end.

## FU-7 — `emitAck` surrender branches could be table-driven

- **What:** Code reviewer (Task 5) noted the five `if/else if` surrender branches in `app.ts:736-745` could be a lookup table (`SURRENDER_REASON_BY_KIND: Partial<Record<AckKind, SurrenderReason>>`). Both `terminalAckKind` and `emitAck` encode the same bidirectional mapping.
- **Why deferred:** Cosmetic; current code is readable. Phase 3 refactor opportunity.
- **Target sprint:** S18 or S19 (ack coalescing sprint touches these paths anyway)
