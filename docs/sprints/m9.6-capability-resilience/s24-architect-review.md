---
sprint: M9.6-S24
reviewer: architect (opus)
date: 2026-04-22
verdict: APPROVE
---

# S24 Architect Review

## Verdict: APPROVE

Mode 4 is complete. The framework matrix is fully covered. All five sub-tasks implemented correctly, both suites green, live retest passed end-to-end with CTO present. Two in-sprint discoveries (system-origin reverify gap, 24h timestamp filter) were found, fixed, and verified before sign-off. M9.6 closes here.

---

## What's right

### Implementation matches §2.9 precisely

All five sub-tasks land exactly where the plan said they would:

- **§2.9.1 (heartbeat wiring):** `app.ts` interval changed to 24h, `capabilityHealthCheck` callback wired correctly. The plan spec named a non-existent `orchestrator.emitFailure()` method — team correctly routed through `app.cfr.emitFailure()`, consistent with every other CFR emission site (D5). Right call; the plan was stale on this detail.

- **§2.9.2 (`isInFlight()`):** Clean one-liner at `recovery-orchestrator.ts:137-143`. Test fixture mirrors the `cfr-ack-delivery-wiring` pattern and exercises the gate using a promise-gated `spawnAutomation` to hold a session mid-flight. Pre/post assertions are exact.

- **§2.9.3 (terminal drain fix):** `AckDelivery.recordSystemOutcome()` is the right API shape — reverse-scan for matching in-progress entry, transition in place, fallback-append if missing. The old `deliver()` system-origin branch bug (appending a new entry on terminal instead of transitioning) is fixed as a side effect. `OrchestratorDeps.recordSystemOutcome?` optional wiring pattern (console.warn when absent) follows the established late-bind convention correctly. Integration test uses the real AckDelivery + RecoveryOrchestrator graph, not mocks — right call.

- **§2.9.4 (testAll MCP coverage):** Both manifests already correct. The coverage test's insight — `testCapability()` structurally cannot return `"untested"` — is a genuine invariant worth locking down. Clean.

- **§2.9.5 (brief integration):** `formatSystemHealthSection()` as a pure exported function is the right decomposition — testable in isolation, appendable unconditionally, empty-string sentinel for omission. `BuiltInHandler` ctx extension + `AutomationExecutor` → `debrief-automation-adapter` wiring chain follows the existing `db` lazy-getter pattern. Early-return change (both workers AND system-health empty) is correct: a self-heal-only night still warrants a brief.

### Live retest: genuine end-to-end pass (CTO present, 2026-04-22)

| Gate | Result |
|------|--------|
| Probe fires, detects degraded cap | ✓ |
| CFR emitted with system origin | ✓ |
| **Silent path — no chat bubble, no WhatsApp** | ✓ (screenshot `s24-live-silent-path.png`) |
| Fix agent spawned, repairs script | ✓ |
| Ring buffer transitions to `fixed` | ✓ (after DEV-1 fix) |
| Capability shows `health: healthy` post-recovery | ✓ |
| Dashboard clean — zero errors | ✓ |

The silent-path screenshot is the artifact that matters most. "Fix audio-to-text capability" visible in Automations panel, chat panel untouched throughout.

### DEV-1 found and fixed correctly

The system-origin reverify gap was a genuine latent design issue: `reverifyAudioToText` required a triggering artifact (`rawMediaPath`), but system-origin probes carry none. Every reverify returned `pass: false` even when the fix agent succeeded.

Fix: early-return in `dispatchReverify` when `origin.kind === "system"` and `waitForAvailability()` passes — return `{ pass: true }`. The rationale is correct: `watcher.rescanNow()` already called `testAll()`, which is the same probe that detected the degradation. If the capability is available after the fix ran, testAll has already verified it. Artifact-based reverification is redundant and impossible for system-origin failures.

Test update — "returns pass:true for system-origin failures" with explicit doc comment — locks the contract for future readers. D9 in DECISIONS captures the reasoning.

### 24h timestamp filter (D8) correct

`timestamp >= now - 24h` ISO string lexicographic comparison is valid for UTC ISO 8601. Test update to `recentTs()` (1h ago) is temporally stable — the previous hardcoded `2026-04-21T03:00:00Z` timestamps would have failed once the 24h window rolled, which was imminent.

### Artifact trail complete

`s24-DECISIONS.md` (9 decisions), `s24-DEVIATIONS.md` (1), `s24-FOLLOW-UPS.md` (2), `s24-review.md` (external), `s24-test-report.md` (live retest). Complete.

---

## What's wrong

Nothing blocking. Two minor notes:

### Minor: `capabilityHealthCheck` has no log line on entry

`checkCapabilityHealth()` fires silently. During the live retest, confirming the probe had run required inferring from `lastTestLatencyMs` on the capability registry rather than a log entry. A single `console.log("[Heartbeat] capability health check starting")` would have made live observability straightforward. Not blocking; file as FOLLOW-UP if production debugging surfaces the need.

### Minor: `formatSystemHealthSection` reads full ring buffer before filtering

The 24h cutoff filters after `getSystemEvents()` returns all 256 entries. Trivial at daily cadence; worth noting if probe frequency ever increases.

---

## Required changes

None.

---

## Suite results (verified)

| Package | Passed | Failed | Skipped |
|---------|--------|--------|---------|
| core | 695 | 0 | 9 |
| dashboard | 1391 | 0 | 24 |
| TypeScript (core) | clean | — | — |
| TypeScript (dashboard) | clean | — | — |

+8 core / +16 dashboard vs S23 close baseline — matches exactly what S24's five sub-tasks plus DEV-1 fix added.

---

## Framework matrix — final state

| | Mode 1 (tool exception) | Mode 2 (child crash mid-call) | Mode 3 (server crashes at startup) | Mode 4 (daily proactive probe) |
|---|:---:|:---:|:---:|:---:|
| Input (STT) | N/A | N/A | N/A | ✓ S24 live |
| Output (TTS, image) | N/A | N/A | N/A | ✓ S24 |
| Tool (browser, desktop) | ✓ S12+S22 | ✓ S12+S22 | ✓ S23 | ✓ S24 |

Mode 4 completes the matrix. `testAll()` is shape-agnostic — input, output, and tool capabilities all go through the same daily probe.

---

## Milestone exit assessment

Per §2.9 "Acceptance for S24 close":

| Gate | Status | Evidence |
|------|--------|----------|
| All five sub-tasks implemented + tests pass | ✓ GREEN | Spec coverage table in `s24-review.md` |
| Live retest passes, NO user-visible signal during recovery | ✓ GREEN | `s24-test-report.md`; CTO present 2026-04-22 |
| Suite green — zero failed (both packages) | ✓ GREEN | core 695/0/9, dashboard 1391/0/24 |
| S23 still green | ✓ GREEN | S23 architect APPROVE WITH CHANGES (cosmetic); RC-1/RC-2 landed in S24 |
| Architect approval | ✓ GREEN | This review |

**M9.6 closes here. M10 is unblocked.**
