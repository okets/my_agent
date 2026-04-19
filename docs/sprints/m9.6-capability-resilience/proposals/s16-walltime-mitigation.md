---
sprint: M9.6-S16
title: Wall-time mitigation proposal
gate: plan-phase3-refinements.md §2.1 / design §6.3
branch: B/C — tts-edge-tts 8.0 min; browser-chrome 10.9 min
---

# S16 Wall-Time Mitigation Proposal

## Measurement results (real plugs, CFR-inject path)

| Plug | Type | Wall-time | Gate | Outcome |
|------|------|-----------|------|---------|
| tts-edge-tts | script | 480 s (8.0 min) | B | fixed (3 attempts) |
| browser-chrome | MCP | 652 s (10.9 min) | C | fixed (3 attempts) |

Per-attempt durations:
- tts-edge-tts: 122 s + 144 s + 213 s (between-attempt reverify adds overhead)
- browser-chrome: 113 s + 322 s + 217 s (attempt 2 explored MCP source extensively)

Both plugs were FIXED by Opus end-to-end. Total wall time includes all 3 attempts because
smoke verification failed on attempts 1 and 2 — the fix landed on attempt 3 in both cases.

## Why 3 attempts each

Opus made progress each attempt but didn't satisfy the smoke check until attempt 3.
For tts-edge-tts: the smoke script invokes a real edge-tts call; Opus needed attempts to
correctly propagate the voice fix through the synthesize.sh path. For browser-chrome: the
entrypoint fix required Opus to correctly locate the real entry point in package.json.

## Proposed mitigations

### Option M1 (recommended) — Pre-populate MODE:FIX prompt with smoke output

The current `buildFixModeInvocation` prompt includes `symptom` and `detail` strings from
the failure record, but does NOT include the actual smoke.sh stderr output. Opus wastes
attempt 1 re-running diagnostics that CFR already has.

**Change:** In `runOneAttempt`, before calling `spawnAutomation`, run `smoke.sh` once more
(or capture the failure output from the invoker) and append a `## Smoke Output` section to
the prompt. Opus skips its own smoke run and goes straight to patching.

**Expected improvement:** Reduces attempt 1 from ~120 s to ~60 s. Net saving: ~60-90 s
per CFR cycle (~1-1.5 min). Brings tts-edge-tts from 8 min → ~7 min (still B), and
browser-chrome from 11 min → ~9.5 min (down from C to B).

**Effort:** 30 min — add a `smokeOutput?: string` field to `AutomationSpec`, capture it
in `runOneAttempt`, append to `buildFixModeInvocation`. One new test for the prompt field.

### Option M2 — Separate timeouts: script plugs 8 min, MCP plugs 15 min

Currently `JOB_TIMEOUT_MS = 15 * 60 * 1000` for all plug types. MCP plugs legitimately
need longer (the browser-chrome source tree requires more exploration). Script plugs
should cap at 8 min since fixes are config/bash changes.

**Change:** Pass plug interface type in `AutomationSpec`, let `spawnAutomation` choose
timeout: script → 8 min, MCP → 15 min. `JOB_TIMEOUT_MS` becomes a default fallback.

**Expected improvement:** Fail-fast on stuck script plug attempts (saves 7 min on a hung
run); no change to MCP timing. Does not reduce measured wall time for either test case.

**Effort:** 45 min — thread `plugInterface` through `AutomationSpec`, update
`buildFixModeInvocation`, add two tests.

### Option M3 — Accept current timing (no change)

The architect projected "5–12 min for a cold Opus run on an unfamiliar plug." Both results
are within that projection:
- tts-edge-tts at 8 min: within range
- browser-chrome at 10.9 min: at the top of range but successful fix

The gate boundary (>10 min = escalate) was set before real measurements existed. With data
showing a successful fix at 10.9 min, the boundary could be relaxed to ≤12 min for MCP
plugs while keeping ≤5 min for script plugs. Document in DECISIONS.

**Effort:** 0 min code, 15 min DECISIONS update.

## Recommendation

**M1 + M3 combined:**
1. Implement Option M1 in S17 (it touches `runOneAttempt` which S17 refactors anyway).
2. For the gate decision: browser-chrome at 10.9 min is one data point, very close to the
   boundary, and the plug was successfully fixed. Given the architect's 5-12 min projection
   covers this, relax the boundary to ≤12 min for MCP plugs via DECISIONS note.

Neither M1 nor M3 requires a code change in S16. If the architect accepts M3 for the gate
decision, S16 ships with a Branch A/B overall decision; M1 lands in S17.

## Architect decision requested

☐ Accept M3 (relax boundary to 12 min for MCP — S16 ships with Branch A/B) → DECISIONS D8  
☐ Require M1 before S16 closes (lands in S17 scope but blocks S16 approval)  
☐ Escalate architectural change for MCP plug wall-time (requires new sprint scope)
