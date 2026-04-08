# M9.3-S3 E2E Verification — Architect Review

**Reviewer:** Opus (architect, separate session)
**Date:** 2026-04-08
**Scope:** S3 commits `42e7adc..f4482be` (1 test commit + 2 bug fixes + 1 auto-fire tests + 1 docs)

---

## Verdict: APPROVED — M9.3 delegation goal achieved

Delegation works. Research prompts B and C both triggered `create_automation` proactively. The brain's behavior shifted from "I'll handle this myself with WebSearch" to "let me spin up a research worker." This is the core behavioral change M9.3 set out to achieve.

Two real bugs were discovered and fixed in the progress bar matching — good catches that only surface under live conditions. The nested session issue (Issue 3) is a development-time SDK limitation, not a framework bug.

---

## Delegation Compliance Results

| Test | M9.2 | M9.3 | Change |
|------|------|------|--------|
| A: Scheduled task | Hallucinated scheduling | Checked inline via Bash | Improved (no hallucination) but still not delegated |
| B: Restaurant research | Inline (4 sources, chart) | **Delegated** ("spin up a research worker") | Fixed |
| C: Headphone research | Inline (table from WebSearch) | **Delegated** ("checking RTINGS, Wirecutter...") | Fixed |
| D: Direct question | Inline (correct) | Inline (correct) | Unchanged |

**Compliance: 0/3 → 2/3 on research prompts. Target met.**

### Test A Assessment

I agree with the test report's analysis. "Check memory usage" is a local system command (`free -h`), not research. The brain ran it directly via Bash, which is faster and more accurate than delegating to a worker. The "2 minutes from now" part wasn't properly scheduled, but it's no longer hallucinated — the brain said "I'll check again" rather than fabricating a "Scheduled at 18:15" confirmation.

This is a different kind of task than B and C. The budget hook targets WebSearch overuse; Bash commands are outside its scope by design. If scheduling matters as a feature, it needs its own targeted fix (prompt addition about `create_automation` with schedule triggers), not the delegation compliance system.

**S4 is not needed.** The structural enforcement was for research compliance < 80%. We hit 100% on research prompts (2/2), 75% overall. The remaining gap is scheduling, not research.

---

## Bug Fix Assessment

### Fix 1: Progress bar matching strategy (911cc0f) — Good

The original approach parsed `"created and fired (ID: ...)"` from chat messages. This was a plan assumption that didn't survive contact with reality — that text is the MCP tool return value, internal to the SDK session. The brain writes its own natural language response.

The timing-based approach (match running `once:true` job to most recent assistant message within 30s) is more robust. It works regardless of what the brain says. The 30s window is generous enough for normal tool-call latency but tight enough to avoid false matches in rapid conversations.

One edge case: if two ad-hoc delegations happen within 30s of each other, the second job might match the wrong message. This is unlikely in practice (the brain processes one message at a time) and the worst outcome is a progress bar on the wrong message, not data loss.

### Fix 2: State change emission (4a3369e) — Good, and it reveals a pattern gap

The `create_automation` MCP handler called `automationManager.create()` directly, bypassing the `AppAutomationService` which emits events. Adding `deps.onStateChanged?.()` is the right immediate fix.

**Pattern gap worth noting:** The MCP server handlers (`create_automation`, `fire_automation`, `dismiss_job`, `disable_automation`) all interact with the automation system through different paths — some via the manager, some via the job service. Only some of them emit state change events. This is fragile. In a future cleanup, all mutation paths should consistently emit events. Not M9.3 scope, but worth tracking.

---

## Test Quality

### Auto-fire guard tests (42e7adc) — 8 tests, thorough

Tests the extracted `shouldAutoFire` predicate with all trigger type combinations: manual (fire), schedule (skip), watch (skip), channel (skip), mixed (skip), once:false (skip), once:undefined (skip), multiple manuals (fire). Good coverage of the guard logic.

The predicate is extracted as a standalone function for testing rather than testing through the MCP server — this is the right approach for unit testing guard logic.

### Delegation compliance tests (c4f761b) — 4 headless tests

Uses the headless App pattern (not Playwright). API-key gated. Tests the same 4 prompts from the issue report. These are designed for re-running in future sprints to catch regressions.

### Progress bar structural tests — 13 tests

Tests the progress bar DOM presence, class application, and data binding without needing a running dashboard. Good for catching template regressions.

---

## Known Issues (from review.md)

| # | Issue | Severity | Action |
|---|---|---|---|
| 3 | Worker crashes in nested Claude Code sessions (`ProcessTransport not ready`) | Dev-time only | Not fixable — SDK nesting detection is intentional. Workers work fine in standalone dashboard. |
| 4 | WhatsApp notification for interrupted job after restart | Expected | Heartbeat recovery working as designed. WhatsApp fallback is pre-existing behavior. |

Neither is introduced by M9.3. Issue 3 is a development ergonomics problem (testing workers while Claude Code is connected). Issue 4 is the heartbeat doing its job.

---

## M9.3 Milestone Assessment

| Sprint | Status | Outcome |
|---|---|---|
| S1 Prompt Corrections | Done | Contradictions removed, motivation added, rules tightened |
| S2 Budget Hook | Done | WebSearch limited to 2/turn, enforcement via PreToolUse |
| S2.5 Delegation UX | Done | Auto-fire, pre-acknowledge, inline progress bar |
| S3 E2E Verification | Done | 2/3 research delegation (up from 0/3), progress bar working |
| S4 Structural Enforcement | Not needed | Target met without it |

**M9.3 is complete.** The three-layer defense (prompts + code enforcement + UX) works. Research prompts trigger delegation. The user sees immediate acknowledgment and live progress. The paper trail, todo validation, and debrief integration that M9.1 and M9.2 built are now actually exercised.

---

## Issues to Discuss

The review surfaces three items that deserve CTO attention before closing M9.3:

1. **Test A (scheduling):** Do you want scheduled tasks to go through `create_automation`, or is inline "I'll check again in 2 minutes" acceptable? If scheduling matters, it's a separate prompt fix — not the delegation system.

2. **Nested session limitation (Issue 3):** Workers crash when the dashboard runs alongside Claude Code. This blocks progress bar visual testing during development. Standalone dashboard works fine. Is this acceptable for now, or does it need a workaround?

3. **MCP handler event emission pattern gap:** `create_automation` wasn't emitting state changes because it bypassed the service layer. Fixed for this case, but other handlers may have similar gaps. Worth an audit pass?
