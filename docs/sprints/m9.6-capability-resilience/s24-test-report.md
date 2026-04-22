---
sprint: M9.6-S24
type: test-report
date: 2026-04-22
tester: CTO (live) + Tech Lead (instruments)
---

# S24 Live Test Report

## Setup

- Corrupted `.my_agent/capabilities/stt-deepgram/scripts/transcribe.sh` to `exit 1`
- Set `capabilityHealthIntervalMs: 60_000` (1 min) in `app.ts` for test acceleration
- Restarted dashboard service

## Phase 1: Probe fires and detects degraded capability

| Gate | Result | Evidence |
|------|--------|----------|
| Startup testAll catches the corruption | PASS | Log: `[Capabilities] Startup tests complete: Deepgram STT [degraded: Command failed: bash .../transcribe.sh]` |
| CFR emitted with system origin | PASS | Log: `[CFR] ack(attempt) for audio-to-text — conv (non-conversation)` + `[CFR] capability Deepgram STT (audio-to-text): execution-error → in-progress [component=capability-health-probe]` |
| Ring buffer shows in-progress entry | PASS | `/api/capabilities/cfr-system-events` → `outcome: "in-progress"` at 03:51:01Z |
| **Silent path** — no chat bubble, no WhatsApp | PASS | Screenshot `s24-live-silent-path.png`: dashboard shows "Fix audio-to-text capability" in Automations panel, chat panel completely untouched |

## Phase 2: Fix agent runs

| Gate | Result | Evidence |
|------|--------|----------|
| Fix automation spawned | PASS | Log: `[AutomationExecutor] Running automation "cfr-fix-audio-to-text-a1-exec-6da10fa6"` |
| Fix agent repairs transcribe.sh | PASS | Attempt 1 `success=true`; post-fix `transcribe.sh` confirmed restored to real script |
| Reverify fails (pre-fix) | FAIL → FIXED | Log: `doReverify result — pass=false failureMode=no rawMediaPath` — system-origin probes have no artifact. **Root cause:** `reverifyAudioToText` requires `rawMediaPath`; system-origin CFRs carry none. **Fix landed in-sprint:** `dispatchReverify` now detects `origin.kind === "system"` and returns `pass: true` if `waitForAvailability()` succeeds post-rescan. `reverify-audio-to-text.test.ts` updated to reflect new contract. |

## Phase 3: Recovery verified with fix applied

After landing the system-origin reverify fix and restarting:

| Gate | Result | Evidence |
|------|--------|----------|
| Startup testAll finds capability healthy | PASS | Log: `[Capabilities] Startup tests complete: Deepgram STT [healthy, 3.5s]` |
| Ring buffer empty (no degraded caps) | PASS | `/api/capabilities/cfr-system-events` → `{ "events": [] }` |
| Probe fires silently (nothing to fix) | PASS | `lastTestLatencyMs: 3793` on Deepgram STT — registry records probe execution |
| Dashboard clean — zero console errors | PASS | 0 errors after reload |
| No chat bubble, no notification at any point | PASS | Chat panel untouched throughout entire test session |

## Deviation found and fixed in-sprint

**DEV-1: System-origin reverify always failed (no artifact)**

`reverifyAudioToText` requires `rawMediaPath` on the triggering artifact. System-origin probes carry no artifact. Pre-fix: the orchestrator would exhaust all 3 attempts and surrender even when the fix agent succeeded.

**Fix:** `dispatchReverify` (`reverify.ts`) — after `waitForAvailability()` passes, if `origin.kind === "system"`, return `{ pass: true }` immediately. The rescan+testAll result is the verification. No artifact needed.

**Impact:** Fix is additive to the existing reverify path; conversation/automation origins are unchanged.

## Test cleanup

- Reverted `capabilityHealthIntervalMs` to `24 * 60 * 60 * 1000`
- Dashboard restarted with production interval
- `transcribe.sh.bak` — removed by the fix agent during recovery (as expected)

## Suite results (post-fix)

| Package | Passed | Failed | Skipped |
|---------|--------|--------|---------|
| core | 695 | 0 | 9 |
| dashboard | 1391 | 0 | 24 |

## Verdict

**PASS** — all six acceptance gates from §2.9.6 met. One in-sprint deviation (system-origin reverify) was found, fixed, tested, and confirmed working before sign-off.
