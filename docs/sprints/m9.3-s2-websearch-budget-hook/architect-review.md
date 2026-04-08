# M9.3-S2 WebSearch Budget Hook — Architect Review

**Reviewer:** Opus (architect, separate session)
**Date:** 2026-04-08
**Scope:** S2 commits `5e0c4b7..8d79d13` (2 plan commits + 2 housekeeping)

---

## Verdict: APPROVED

S2 delivers the code enforcement layer exactly as planned. The hook is minimal (58 lines), correctly typed against the SDK, wired at the right lifecycle point, and tested at all behavioral boundaries. Combined with S1's prompt corrections, the two-layer defense (instruction clarity + code enforcement) is complete and ready for E2E verification in S3.

---

## Root Cause Coverage Update

| Root Cause | S1 | S2 | Status |
|---|---|---|---|
| 1. Contradictory instructions | Fixed | — | Done |
| 2. Tool description framing | Fixed | — | Done |
| 3. Delegation friction (10 fields vs 1) | — | — | Deferred to S4 |
| 4. Interview-first friction | — | — | Design tension |
| 5. System prompt dilution | Partial | — | Mitigated |
| 6. No code enforcement | — | **Fixed** | Done |
| 7. Hallucinated scheduling | — | — | Unaddressed (no WebSearch involved) |

S1+S2 address 4 of 7 root causes. The remaining 3 are either deferred (S4), accepted design tensions, or separate bugs. This is the right coverage for the first verification gate.

---

## Implementation Verification

### Hook Logic

`packages/core/src/hooks/delegation.ts` — 58 lines, clean closure pattern:

- Counter increments on every WebSearch call: correct
- Returns `{}` (allow) when `count <= budget`: correct
- Returns deny with `systemMessage` + `hookSpecificOutput` when `count > budget`: correct
- `resetTurn()` zeros the counter: correct
- Default budget is 2: matches plan

The `systemMessage` is well-crafted — it states the situation, reframes as research, and gives actionable instructions including `notify: "immediate"` and "Include the full research context." This is consistent with S1's skill language.

### SDK Type Fidelity

Verified the implementation uses the correct SDK types:

```typescript
import type { HookCallback, HookJSONOutput, PreToolUseHookInput }
```

The deny return shape matches `SyncHookJSONOutput` with `PreToolUseHookSpecificOutput`. The dev agent added an explicit `HookJSONOutput` return type annotation not in the plan — a good improvement.

### Wiring

Three integration points in `session-manager.ts`, all correct:

| Point | Line | What | Correct? |
|---|---|---|---|
| Class property | 257 | `createDelegationEnforcer(2)` | Yes — one per session |
| Hook registration | 329-334 | Push to `PreToolUse` with `matcher: "WebSearch"` | Yes — follows SubagentStart/Stop pattern |
| Turn reset | 459 | `resetTurn()` at top of `buildQuery()` | Yes — before prompt assembly, 1:1 with user messages |

The plan suggested building hooks in `buildQuery()` but the implementation pushes in `doInitialize()`. This is a better approach — consistent with existing hook patterns and avoids rebuilding arrays per query.

### Test Quality

7 unit tests cover all behavioral paths:

| Case | Tested |
|---|---|
| Allow within budget | Yes (first + second call) |
| Deny above budget | Yes (third call) |
| Deny continues | Yes (fourth+ calls) |
| Non-WebSearch ignored | Yes (Read tool) |
| Reset clears count | Yes (exhaust → reset → allow) |
| Custom budget | Yes (budget=1, first allowed, second denied) |

Tests use correct SDK input shapes including `hook_event_name`, `tool_use_id`, and `AbortSignal`. The custom budget test actually exercises the deny path (not just creation) — better than the plan specified.

---

## S1 Follow-up: I1 Resolved

The S1 architect review flagged missing tests for `dismiss_job` and `disable_automation` (I1). Commit `7c6b552` adds 130 lines of tests covering:
- Dismiss: status change, running-job guard, non-existent job, excluded from queries, orphaned DB cleanup
- Disable: status change, system automation guard, non-existent, idempotency

I1 is closed.

---

## Plan Deviations

Two justified deviations, both improvements:

1. **Hook registration in `doInitialize()` instead of `buildQuery()`** — simpler, consistent with existing patterns, avoids per-query array rebuild
2. **Explicit `HookJSONOutput` return type** — not in plan, but adds type safety

No unjustified deviations.

---

## What Works Well

1. **Minimal surface area.** 58 lines of hook code, 13 lines of wiring. The enforcement layer is proportional to the problem — no over-engineering.

2. **Actionable deny message.** The systemMessage tells the LLM exactly what to do next, using the same vocabulary as the S1 skill corrections. The brain receives consistent messaging from both layers.

3. **Clean separation.** Core provides the hook factory. Dashboard wires it. Tests are self-contained. No coupling between delegation logic and session management.

4. **Downstream test impact handled.** The mock update in `session-manager-skills.test.ts` prevents the new import from breaking existing tests. This kind of attention to ripple effects matters.

---

## Concerns for S3

1. **Budget of 2 may be too generous for Test B.** "Top 3 Thai restaurants in Chiang Mai" — the brain might do 2 WebSearches, get enough data to answer, and still not delegate. The budget allows 2 searches which could be sufficient for a shallow answer. Watch for this in S3.

2. **Test A (hallucinated scheduling) is outside the hook's scope.** The brain says "Scheduled" without calling ANY tool — WebSearch or `create_automation`. The budget hook doesn't trigger because no WebSearch is called. If Test A still fails in S3, it needs a targeted prompt fix (e.g., "To schedule future tasks, you MUST call `create_automation` with a schedule trigger. Saying 'I'll check later' does not create a schedule.").

3. **WebFetch is not budgeted.** The brain also has WebFetch. If it uses WebFetch instead of WebSearch to gather information, the budget hook won't catch it. Monitor whether the brain shifts to WebFetch as an evasion. If so, extend the hook matcher to `"WebSearch|WebFetch"`.

---

## Recommendation

**Merge. Proceed to S3 (E2E Verification).** S1+S2 deliver the full planned two-layer defense. S3 will tell us if it's enough.
