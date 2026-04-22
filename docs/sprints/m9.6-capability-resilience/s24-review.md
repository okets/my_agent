---
sprint: M9.6-S24
title: External Verification Report
reviewer: External Opus (independent)
date: 2026-04-22
---

# External Verification Report

**Sprint:** M9.6-S24 Mode 4: Daily Silent Self-Heal + Brief Integration
**Reviewer:** External Opus (independent)
**Date:** 2026-04-22

## Spec Coverage

Spec source: `docs/sprints/m9.6-capability-resilience/plan-phase3-refinements.md` §2.9.

| Spec Requirement | Status | Evidence |
|------------------|--------|----------|
| §2.9.1 Change `capabilityHealthIntervalMs` from 1h → 24h | COVERED | `packages/dashboard/src/app.ts:2150` sets `24 * 60 * 60 * 1000` |
| §2.9.1 Add `capabilityHealthCheck` callback: `testAll()` + emit system-origin CFR for degraded caps not already mid-recovery | COVERED | `app.ts:2151-2173` — iterates `list()`, skips non-degraded, skips `isInFlight(capType)`, emits via `app.cfr.emitFailure({...})` with `origin.kind: "system"` and `component: "capability-health-probe"` |
| §2.9.1 Heartbeat unit test verifying callback fires at interval and is idempotent | COVERED | `packages/dashboard/tests/unit/automations/heartbeat-service.test.ts:156-336` — 4 new tests: fires on tick, emits for degraded not-in-flight, skips in-flight, ignores healthy/untested |
| §2.9.2 Add public `isInFlight(type): boolean` on RecoveryOrchestrator | COVERED | `packages/core/src/capabilities/recovery-orchestrator.ts:137-143` (`return this.inFlight.has(capabilityType)`) |
| §2.9.2 Orchestrator test: `isInFlight` true mid-flight, false after completion | COVERED | `packages/core/tests/capabilities/orchestrator/orchestrator-state-machine.test.ts:212-263` — uses promise-gate spawn to hold a fix session in-flight and asserts both states |
| §2.9.3 System-origin terminal drain appends/transitions outcome to ring buffer | COVERED | `recovery-orchestrator.ts:720-747` calls `deps.recordSystemOutcome({...outcome: fixed\|surrendered})`; `ack-delivery.ts:466-513` new `recordSystemOutcome()` method transitions most-recent matching in-progress entry in place (fallback-appends when none found) |
| §2.9.3 `SystemCfrEvent.outcome` union widened to include `"fixed"` | COVERED | `ack-delivery.ts:204` — `"in-progress" \| "fixed" \| "surrendered"` |
| §2.9.3 Integration test: ring buffer transitions `in-progress → fixed` / `in-progress → surrendered` | COVERED | `packages/dashboard/tests/integration/cfr-system-origin-terminal-drain.test.ts` — 2 tests boot real `App` wiring, fire system-origin CFR, assert exactly one ring-buffer entry at terminal outcome (not appended second entry) |
| §2.9.3 Existing system-origin branch of `deliver()` fixed to NOT append on terminal | COVERED | `ack-delivery.ts:420-450` — terminal context now calls `recordSystemOutcome()` instead of pushing a fresh entry; in-progress context still pushes new entry. Closes latent S19 double-entry bug |
| §2.9.4 Verify `browser-chrome` / `desktop-x11` CAPABILITY.md declare `provides` + `interface: mcp` | COVERED | Both manifests verified correct (no code change needed — D6). `browser-chrome/CAPABILITY.md` has `provides: browser-control`, `interface: mcp`; `desktop-x11/CAPABILITY.md` has `provides: desktop-control`, `interface: mcp` |
| §2.9.4 `testCapability()` cannot return `"untested"` — documented via test | COVERED | `packages/core/tests/capabilities/test-harness-mcp-coverage.test.ts` — 7 tests verify every shape resolves to `ok` or `error`, never `untested`; includes MCP-without-entrypoint, unavailable, script-without-well-known-type, unrecognized provides, audio-to-text missing script |
| §2.9.5 `debrief-reporter` appends `## System Health` section when ring buffer has fixed/surrendered events | COVERED | `handler-registry.ts:307-336` — new exported `formatSystemHealthSection()`; handler at `:340` consumes `ctx.ackDelivery`; appended to `fullBrief` and `digest` |
| §2.9.5 Omit section entirely when ring buffer is empty for last 24h | PARTIAL | Omitted when no fixed/surrendered events exist (empty string return). HOWEVER the implementation does NOT apply a 24h timestamp filter — the entire 256-entry ring buffer is considered. See Gaps below |
| §2.9.5 `BuiltInHandler` ctx extended with `ackDelivery?: AckDelivery`; wired via `AutomationExecutor.config` | COVERED | `handler-registry.ts:56-65` (type); `automation-executor.ts:84-91, 271` (config + ctx pass-through); `app.ts:1768-1769` (config construction); `debrief-automation-adapter.ts` takes `getAckDelivery` lazy getter; `app.ts:1652` passes it |
| §2.9.5 Early-return fires only when BOTH workers empty AND system-health empty | COVERED | `handler-registry.ts:400-412` — `if (workerSections.length === 0 && systemHealthSection === "")` |
| §2.9.5 Integration test: empty / fixed / surrendered cases | COVERED (exceeds spec) | `packages/dashboard/tests/integration/debrief-reporter-system-health-section.test.ts` — 10 tests total (6 formatter unit tests + 4 handler integration tests including the spec's 3 cases plus "all in-progress" regression) |
| §2.9.6 Live retest with corrupted `stt-deepgram` — silent recovery + ring-buffer transition + brief section | NOT PERFORMED | No `s24-live-retest.md` or `s24-test-report.md` artifact exists. Team's brief to me did not claim live retest was run |
| Acceptance: All five sub-tasks implemented + tests pass | COVERED (except live retest) | See above |
| Acceptance: Suite green (core + dashboard zero-failed) | COVERED | Verified independently — see Test Results |
| RC-1 (S23 architect): duplicate `FAILED_STATUSES.has` guard removed | COVERED | `mcp-cfr-detector.ts:147` — duplicate line deleted. D1 documents that RC-1's original "hoist the Set" was a no-op (already hoisted); team acted on the real code gap instead |
| RC-2 (S23 architect): DEV-1 test count corrected from "11" to "10" | COVERED | `s23-DEVIATIONS.md` updated; D2 explains architect miscount verified by grep |

## Test Results

Both suites run independently from a clean shell, confirming team-reported numbers.

### Core (`packages/core`)
- **Files:** 91 passed, 2 skipped (93 total)
- **Tests:** 695 passed, 0 failed, 9 skipped (704 total)
- **Duration:** 38.28s
- New S24 tests present: `tests/capabilities/test-harness-mcp-coverage.test.ts` (7 tests), plus `RecoveryOrchestrator.isInFlight()` describe block in `orchestrator-state-machine.test.ts` (adds 1 test → 20 total in that file)

### Dashboard (`packages/dashboard`)
- **Files:** 176 passed, 14 skipped (190 total)
- **Tests:** 1391 passed, 0 failed, 24 skipped (1415 total)
- **Duration:** 67.04s
- New S24 tests present: `tests/integration/cfr-system-origin-terminal-drain.test.ts` (2 tests), `tests/integration/debrief-reporter-system-health-section.test.ts` (10 tests), heartbeat-service.test.ts has 4 new tests (9 total in file)

### TypeScript
- `packages/core`: `npx tsc --noEmit` → clean (exit 0, no output)
- `packages/dashboard`: `npx tsc --noEmit` → clean (exit 0, no output)

## Browser Verification

**Skipped with justification.** S24 introduces no new UI, no new routes, and no new public/ assets. The changes are:
- One constant change in `app.ts` (interval 1h → 24h) and one new callback inside an existing heartbeat config object
- One new public method on RecoveryOrchestrator
- Internal extensions to AckDelivery (new method, widened union)
- New optional ctx field on handler type + wiring through AutomationExecutor + debrief-automation-adapter
- Brief composer emits a new markdown section when appropriate

The dashboard systemd user service (`nina-dashboard.service`) is already active on this branch's built artifacts (core `dist/` timestamps match current branch). `journalctl --user -u nina-dashboard.service --since "1 hour ago"` shows no errors or stack traces — normal request/response traffic only. Server starts clean with the S24 code.

No end-user-facing UI behavior changes in this sprint; the only user-visible artifact is a new markdown section in the daily brief, which is delivered via existing channels (not a new UI surface). Playwright verification would add no signal beyond what the integration test for `debrief-reporter-system-health-section` already provides.

## Gaps Found

### GAP-1 — Live retest (§2.9.6) not performed
**Severity:** Blocker for the milestone-close gate, but NOT a spec-fidelity gap for what was built.

The spec's acceptance gate lists:
> *Live retest above passes end-to-end with NO user-visible signal during the recovery window*

No `s24-live-retest.md` / `s24-test-report.md` artifact exists; the team's brief to me did not claim the live retest was executed. Per spec §2.9.6, this requires:
- Corrupting `stt-deepgram/scripts/transcribe.sh`, accelerating `capabilityHealthIntervalMs` to 60_000
- Observing: probe fires, cap goes degraded, system-origin CFR emitted, NO chat bubble / NO WhatsApp / NO brain turn, fix runs, ring buffer transitions to `fixed`, brief includes the event

Unit + integration tests cover each of these behaviours in isolation. The missing step is the end-to-end composition in a real environment. The spec explicitly ties this to the milestone-close decision: *"Milestone exit: S24 acceptance gates green + S23 still green + live retest signed off by CTO + architect approval. M9.6 closes here."*

### GAP-2 — Brief section 24h window filter not applied
**Severity:** Minor — spec divergence, low blast radius today.

§2.9.5 specifies:
> *query `app.ackDelivery.getSystemEvents()` **filtered to the last 24h***

`formatSystemHealthSection()` in `handler-registry.ts:307-336` reads all ring-buffer events without a timestamp filter. With a 256-entry ring buffer and daily probe cadence, in practice this would rarely show stale events, but if a capability self-heals once and another stays surrendered for weeks, the surrendered entry would re-appear in every subsequent daily brief.

This is not called out in `s24-DECISIONS.md` D7. The omission appears unintentional. Recommended fix: filter by `Date.parse(e.timestamp) >= Date.now() - 24*60*60*1000` before categorising.

### GAP-3 — Brief section format diverges from spec example (minor)
**Severity:** Cosmetic — spec example was illustrative, not prescriptive.

§2.9.5 shows:
```
- 03:14 — browser-chrome auto-recovered (config drift; smoke clean within 2 min)
- 22:08 — desktop-x11 surrendered after 3 attempts; needs attention
  (last error: xdotool not found; check `which xdotool`)
```

Actual output:
```
## System Health

Self-healed:
- stt-deepgram (audio-to-text) at 2026-04-21T03:00:00Z

Surrendered:
- browser-chrome (browser-control) at 2026-04-21T03:05:00Z
```

Differences: ISO timestamps vs HH:MM; no recovery context summary; sub-headers instead of flat bullets; no remediation hint. The spec's "Format:" heading precedes an illustrative example and acceptance gates only require "lists what self-healed and what surrendered" + "self-healed / surrendered lists" — so strict fidelity was not required and the simpler format is defensible. Flagged for visibility; not blocking.

### GAP-4 — No `s24-DEVIATIONS.md` / `s24-FOLLOW-UPS.md` artifacts
**Severity:** Process — this sprint's artifact trail is thinner than S19-S23.

The S19-S23 pattern consistently includes DECISIONS + DEVIATIONS + FOLLOW-UPS + architect-review + test-report. S24 has only DECISIONS. If no deviations were needed (D5's `emitFailure` routing counts as a decision, not deviation) and no follow-ups surfaced, this is acceptable — but an empty FOLLOW-UPS file still carries signal. Noting for consistency.

## Verdict

**PASS WITH CONCERNS**

All five in-scope sub-tasks (§2.9.1 through §2.9.5) are implemented correctly against the spec, both test suites are zero-failed (695 core / 1391 dashboard), and TypeScript compiles clean. The system-origin terminal drain fix also closes a latent S19 bug exactly as predicted by the audit. The concerns are: (1) the spec's live retest acceptance gate (§2.9.6) has not been performed — required by the spec for milestone close; (2) `formatSystemHealthSection()` does not apply the 24h timestamp filter called out in §2.9.5. Neither concern is a code-level defect, but GAP-1 blocks the spec's "Milestone exit" clause and GAP-2 should be patched before the section goes into production briefs.
