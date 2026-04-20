---
sprint: M9.4-S4.1
title: "Test Report — Brief Section Preservation"
date: 2026-04-20
runner: team-lead + backend-dev
---

# Test Report — M9.4-S4.1

## Environment

- Platform: Linux 6.17.0-20-generic (Ubuntu 25.10, OVH VPS)
- Node: via npx tsx / vitest
- Runner: `npx vitest run` (packages/dashboard)
- TypeScript: `npx tsc --noEmit` (packages/dashboard, packages/core)

## TypeScript Compilation

```
cd packages/dashboard && npx tsc --noEmit
```
**Result: PASS** — zero errors, zero warnings. Exit 0, no output.

```
cd packages/core && npx tsc --noEmit
```
**Result: PASS** — zero errors, zero warnings. Exit 0, no output.

### Notes

TypeScript exhaustiveness on the extended `AlertResult` discriminated union surfaced a cascading TS2322 at `packages/dashboard/src/app.ts:1990`, which traced back to a fourth inline structural alias inside `HeartbeatConfig.conversationInitiator.alert` at `heartbeat-service.ts:77-81` that the plan's scope table had omitted. Logged as DEV-1 in DEVIATIONS.md. The discovery validates the approach — the plan intentionally relies on TS exhaustiveness as the safety net rather than manual caller inventory.

## Sprint-Scoped Tests

```
cd packages/dashboard && npx vitest run \
  tests/unit/automations/summary-resolver.test.ts \
  tests/unit/agent/conversation-initiator-alert-outcome.test.ts \
  tests/unit/agent/session-manager-briefing-timing.test.ts \
  src/automations/__tests__/heartbeat-service.test.ts
```

**Result: PASS — 43 tests passed across 4 files (2.16s).**

| File | Tests | Notes |
|------|-------|-------|
| `tests/unit/automations/summary-resolver.test.ts` | 18 | 4 new synthetic + 1 live fixture (see live-fixture caveat below) |
| `src/automations/__tests__/heartbeat-service.test.ts` | 16 | 2 new tests for `skipped_busy` / `send_failed` retry semantics |
| `tests/unit/agent/conversation-initiator-alert-outcome.test.ts` | 3 | busy / error / happy paths for `alert()` outcome observation |
| `tests/unit/agent/session-manager-briefing-timing.test.ts` | 6 | rewritten in Option B patch — now tests the real `ackBriefingOnFirstOutput` helper (see below) |

### Live Fixture Test — Environmental Caveat

The live Haiku regression test (`all 14 worker headings survive Haiku condense on the 2026-04-20 fixture`) invoked the Haiku model but the Agent SDK session authentication was unavailable in the test environment. Observed log output:

```
[summary-resolver] Haiku condense: 33082 chars → ≤10000 (source: deliverable)
[Brain] createBrainQuery model: claude-haiku-4-5
[summary-resolver] Haiku condense failed — returning raw (33082 chars)
[live-test] Haiku condense unavailable — result is raw (33082 chars).
  Re-run with authenticated Agent SDK session for full assertion.
```

The test passed as a graceful degradation (raw-content fallback path exercised). The load-bearing assertions (`all 14 headings present, length ≤ 10_000, AQI/Songkran/S19 markers present`) will be fully verified on the 2026-04-21 morning brief under the authenticated Agent SDK session, per the plan's success criterion #5. The synthetic unit tests (huge-early-tiny-late, Haiku-drops-section, hard-cap-stub) cover the same correctness invariants without requiring a live session.

### Session-Manager Timing Test — Load-Bearing Verification

The initial implementation of `session-manager-briefing-timing.test.ts` was flagged by reviewer as tautological — it tested a local `simulateStreamMessageBriefingPath` rather than the real production guard. Backend-dev applied reviewer's Option B remediation (see DEV-2 in DEVIATIONS.md):

1. Extracted the guard into an exported pure function `ackBriefingOnFirstOutput(stream, briefingResult)` in `session-manager.ts`.
2. Replaced both original duplicated guard blocks (previously at lines ~707-715 and ~749-757) with `yield* ackBriefingOnFirstOutput(...)`.
3. Rewrote the test to import and call the real function.

**Revert-restore sanity check (per CTO directive "he must test it"):**

```
[Guard removed from ackBriefingOnFirstOutput]
Test Files  1 failed (1)
      Tests  2 failed | 4 passed (6)
```

```
[Guard restored]
Test Files  1 passed (1)
      Tests  6 passed (6)
      Duration  2.25s
```

The test is load-bearing. Reverting the production guard breaks it; restoring the fix makes it pass.

## Full Dashboard Suite

```
cd packages/dashboard && npx vitest run
```

**Result:**

```
Test Files  6 failed | 159 passed | 9 skipped (174)
      Tests  8 failed | 1328 passed | 19 skipped (1355)
   Duration  78.35s
```

### Failing Files (All Pre-Existing)

Backend-dev confirmed by stashing sprint changes and re-running against baseline commit `3f4fc85`. All 8 failures reproduce on master and are unrelated to sprint-touched files:

| File | Category | Pre-existing reason |
|------|----------|---------------------|
| `tests/browser/automation-ui.test.ts` | Playwright | needs running dashboard |
| `tests/browser/capabilities-singleton-visual.test.ts` | Playwright | pixel baseline |
| `tests/browser/capability-ack-render.test.ts` | Playwright | Playwright env |
| `tests/browser/progress-card-handoff.test.ts` | Playwright | Playwright env |
| `tests/browser/progress-card.test.ts` | Playwright | Playwright env |
| `tests/e2e/whatsapp-before-browser.test.ts` | E2E | prior boot-wiring test |
| `tests/knowledge-extractor.test.ts` | unit | pre-existing parse failures |
| `tests/unit/ui/progress-card.test.ts` | UI templates | prior UI template failures |

**Regression status: zero new failures introduced by S4.1.**

## Static Verification

| Check | Expected | Observed |
|-------|----------|----------|
| `text.slice(0, 20_000)` removed from `summary-resolver.ts` | 0 matches | 0 matches |
| `AlertResult` variants `skipped_busy` and `send_failed` present | source-of-truth at `conversation-initiator.ts` | present, exported |
| `AlertResult` callers (4 inline structural aliases) | all updated | heartbeat-service (`HeartbeatConfig` interface), automation-scheduler, automation-processor, server — all updated. `app.ts:1990` cascading TS2322 resolved automatically once the `HeartbeatConfig` interface matched. |
| `ackBriefingOnFirstOutput` exported from `session-manager.ts` | present | present |
| Duplicated guard blocks in `session-manager.ts` | 0 copies (single helper) | 0 copies (both loops delegate) |

## New Heartbeat Log Statuses Observed During Testing

```
[Heartbeat] Delivering job_completed with VERBATIM framing (4 chars)
[Heartbeat] (skipped_busy path) — incrementAttempts, no markDelivered
[Heartbeat] (send_failed path) — incrementAttempts, warning logged, no markDelivered
[Heartbeat] Notification job-maxed exceeded 10 delivery attempts — moving to delivered
```

Retry semantics confirmed identical to the existing `transport_failed` path.

## Fixture Provenance

```
tests/fixtures/debrief-2026-04-20.md
  source: .my_agent/automations/.runs/debrief-reporter/job-4b578057-a315-41c4-8dfc-d18560e427ab/deliverable.md
  captured: 2026-04-20
  original byte count: 33,374
  top-level worker-wrapper headings: 14 (9 cfr-fix + 5 worker-named)
  provenance header: HTML comment at file head, body preserved verbatim
```

## Summary

| Gate | Status |
|------|--------|
| Dashboard `npx tsc --noEmit` | PASS |
| Core `npx tsc --noEmit` | PASS |
| Sprint-scoped vitest (4 files, 43 tests) | PASS |
| Full dashboard vitest (regression only) | PASS (0 new failures) |
| Revert-restore sanity check on timing test | PASS |
| Live fixture regression — authenticated Haiku | DEFERRED (needs authenticated SDK session; will verify on 2026-04-21 brief) |

All S4.1 success criteria #1-4 are satisfied by CI-runnable tests. Success criterion #5 (manual verification of next morning's brief content) is scheduled for 2026-04-21.

---

## Post-Review Addendum — 2026-04-20 live verification + FU-6/FU-7 resolution

After the initial external review, CTO flagged three concerns:
1. The live fixture test was gracefully-skipped in CI (Agent SDK session not authenticated in the dev shell) — how do we know the fix actually works?
2. FU-6 (vestigial `briefingDelivered` field) and FU-7 (delivery-observation on `initiate()`) need to be properly addressed, not deferred.

### Live verification

Wrote `scripts/verify-s4.1-live.ts` exposing `queryModel` + `resolveJobSummaryAsync` directly, ran from CTO's server with dashboard .env loaded and `CLAUDECODE` unset (per live-test helpers pattern).

**Round 1 — real bug surfaced in the fix itself.** Initial `extractTopLevelHeadings` regex matched every `^## ` line, so it counted worker-internal headings (`## Diagnosis`, `## Results`, etc.) as wrappers. Post-Haiku check saw 59 "dropped" sections on the real fixture and fell back to raw on every multi-section debrief. Net effect of the initial fix: section-drop safety preserved (no data loss) but condense path never actually ran.

**Root cause analysis.** The aggregator at `handler-registry.ts:368` joins worker sections with `\n\n---\n\n`, but workers write `---` horizontal rules inside their content too. No content-only heuristic cleanly distinguishes aggregator-written wrappers from worker-internal headings.

**Fix (D8).** Introduced `WRAPPER_MARKER = "<!-- wrapper -->"` — invisible in rendered markdown, workers cannot produce it. Aggregator prefixes each wrapper heading with the marker; resolver extracts via regex built from the shared exported constant. Silent-break guarded by a new contract test that asserts `handler-registry.ts` imports and uses `WRAPPER_MARKER` and does NOT hard-code the string literal.

**Fix (D9).** Strengthened `CONDENSE_SYSTEM_PROMPT` after Round 2 live run revealed Haiku merging retry attempts (`-a1` / `-a2` / `-a3`) when content was near-identical. Added explicit instruction to keep both headings and write "Same outcome as previous attempt." under the duplicate. Also told Haiku to return only markdown, no preamble.

**Round 3 — PASS.**

```
[1/2] Smoke check: direct queryModel call with tiny prompt
  Haiku reply: "ok"
[2/2] Real resolver: resolveJobSummaryAsync against fixture
  Output length: 5716 bytes  (from 34,271 byte fixture — 83% reduction)
  Headings present: 14/14
  Length ≤ 10 000: yes
  Output < fixture: yes (condense happened, not raw fallback)
  Representative facts: AQI=true Songkran=true Project=true
VERDICT: PASS
```

All 14 top-level wrapper headings preserved, user-facing AQI / Songkran / project-status markers survive the condense. Haiku output includes proper retry-attempt handling (`## cfr-fix-text-to-audio-a2-exec-...` with brief "Attempt 2/3: State on disk already correct from attempt 1. Smoke re-verified." body).

### FU-6 — DONE

Removed `briefingDelivered` field declaration + all three writes from `session-manager.ts`. Zero remaining references. Typecheck clean.

### FU-7 — DONE

`initiate()` signature changed from `Promise<Conversation>` to `Promise<{ conversation: Conversation; delivery: AlertResult }>`. All six callers updated. Discovered and fixed a pre-existing dead-code `if (!alerted)` bug in `app.ts:685` as part of the rollup. 4 new inline structural aliases updated (same pattern as AlertResult — now FU-3 counts double duplication).

### Updated test counts

| File | Pre-review | Post-review | Delta |
|------|-----------|-------------|-------|
| `tests/unit/automations/summary-resolver.test.ts` | 18 | 22 | +4 (3 contract guards + 1 worker-internal-subheading test) |
| `src/automations/__tests__/heartbeat-service.test.ts` | 16 | 18 | +2 (FU-7 initiate-busy + initiate-fail) |
| `tests/unit/agent/conversation-initiator-alert-outcome.test.ts` | 3 | 3 | — |
| `tests/unit/agent/conversation-initiator-initiate-outcome.test.ts` | — | 4 | +4 new file |
| `tests/unit/agent/session-manager-briefing-timing.test.ts` | 6 | 6 | — |
| **Sprint-scoped total** | **43** | **53** | **+10** |

### Full-suite regression

```
Test Files  6 failed | 160 passed | 9 skipped (175)
      Tests  7 failed | 1340 passed | 18 skipped (1365)
```

Pre-sprint baseline was 6 files / 8 tests failing. Post-sprint: 6 files / 7 tests. **One fewer test failing** than pre-sprint despite the `initiate()` signature change — initial cascade (conversation-initiator.test.ts + conversation-initiator-routing.test.ts = 4 new failures) fixed via destructuring updates at 5 test sites.

### Success criteria — updated

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Live Haiku regression test passes | **PASS** (5,716-byte output, 14/14 headings, real Haiku call, on CTO's server with authenticated SDK) |
| 2 | All synthetic tests pass | PASS (53/53 sprint-scoped) |
| 3 | Dashboard typecheck clean | PASS |
| 4 | Full suite has no new failures | PASS (7 failed vs. 8 pre-sprint — actually improved) |
| 5 | Next morning's brief (2026-04-21) includes all user-facing sections | Pending — scheduled |
| 6 | DECISIONS / FOLLOW-UPS / test-report present | PASS (D1–D11, FU-1..FU-8 scoped) |
