# M9.3-S2.5 Delegation UX — Architect Review

**Reviewer:** Opus (architect, separate session)
**Date:** 2026-04-08
**Scope:** S2.5 commits `8c27c64..f9bed56` (5 implementation + 1 fix + 2 docs)

---

## Verdict: APPROVED

S2.5 transforms delegation from a slow, invisible process into an immediate, visible one. The auto-fire eliminates a full tool-call round trip. The progress bar gives users live feedback as workers tick through todo items. The callback-based architecture is the right design — no file watching, no polling, fires at the source. Both reviewer issues (resume path, variable naming) were fixed before this review.

---

## What This Sprint Achieves

Before S2.5, when the budget hook forces delegation:
1. Brain calls `create_automation` (~3-5s)
2. Tool says "use fire_automation"
3. Brain calls `fire_automation` (~3-5s)
4. Brain tells user "working on it"
5. Silence until job completes (30-120s)

After S2.5:
1. Brain tells user "delegating this" (pre-acknowledge, immediate)
2. Brain calls `create_automation` — auto-fires, worker starts (~3-5s)
3. Progress bar appears: "1/5 — Searching for headphones"
4. Bar ticks forward in real-time as worker completes items
5. Bar fills, fades, results delivered

Perceived wait drops from ~10s of silence + black box to ~3s + continuous visible progress.

---

## Task-by-Task Verification

| Task | What | Verified |
|---|---|---|
| 6.1 | Budget hook systemMessage now says `once: true` + pre-acknowledge | Yes — `delegation.ts:38-41` |
| 6.2 | Auto-fire when `once: true` + all triggers manual | Yes — `automation-server.ts:151-173`, guard `isOnceManual` correct |
| 6.3 | `onProgress` callback on todo server | Yes — `todo-server.ts:34,49-56,163`, fires on status change only |
| 6.4 | Wired executor → app → state-publisher → WebSocket | Yes — executor config has `onJobProgress`, app.ts relays to publisher |
| 6.5 | Inline progress bar in chat (desktop + mobile) | Yes — identical templates at lines 5652 and 8747, Tokyo Night colors |
| Fix | Resume path passes `onProgress` | Yes — commit `4e89cb3` |
| Fix | `delegationJobId` → `delegationAutomationId` | Yes — commit `4e89cb3` |

---

## Architecture Assessment

### The callback chain is clean

```
Worker calls todo_update("t3", "done")
  → todo-server emitProgress() — fires at the write, zero delay
  → executor onJobProgress(jobId, progress)
  → app.ts onJobProgress → statePublisher.publishJobs()
  → WebSocket broadcast state:jobs with todoProgress field
  → Alpine _syncDelegationProgress() updates DOM
```

No file watchers. No polling. No extra disk reads for progress (the state-publisher reads todos.json on broadcast, but that's debounced at 100ms). The callback fires at the exact moment the todo changes — piggybacking on work the worker already does.

### Auto-fire safety

The guard `args.once && args.trigger.every(t => t.type === 'manual')` is correct and important:
- Scheduled `once: true` automations are NOT auto-fired (scheduler handles them)
- Recurring automations are NOT auto-fired (they need the scheduler loop)
- Only manual one-shots fire immediately

`sourceChannel: "dashboard"` prevents WhatsApp notification bleed. The processor's `runningJobs` map prevents double-fire. Both verified in code.

### UI logic

The `_syncDelegationProgress` function in app.js is well-structured:
- Associates messages with automations via regex match on "created and fired (ID: ...)"
- Filters to `once: true` only (checks automation snapshot)
- Updates `delegationProgress` reactively (Alpine picks up the change)
- On completion: fills bar to 100%, shows "Done", fades after 2s via setTimeout
- Handles edge case where `todoProgress` is absent (job completed before first broadcast)

---

## Remaining Suggestions from Dev Review

The dev reviewer noted 4 suggestions. My assessment:

| # | Suggestion | Priority | Action |
|---|---|---|---|
| 3 | `onJobProgress` discards progress param, re-reads from disk | Low | Acceptable — debounce batches rapid updates, disk read is cheap |
| 4 | Multiple jobs per automation in job map | None | Correct for `once: true` (auto-disables), comment would be nice |
| 5 | No explicit auto-fire unit tests | Medium | Would be good to add before S3 — 3 simple tests for the guard conditions |
| 6 | Progress bar text truncation on mobile | Low | `truncate` class handles it, tested at standard widths |

I'd add suggestion 5 (auto-fire tests) to the S3 prep. The others are fine as-is.

---

## S3 Readiness

With S1 (prompts), S2 (budget hook), and S2.5 (delegation UX) complete, the full stack is in place:

1. **Instruction layer:** Skills consistently say "delegate research" — no contradictions
2. **Enforcement layer:** Budget hook blocks after 2 WebSearches with actionable systemMessage
3. **UX layer:** Auto-fire eliminates round trip, pre-acknowledge reduces perceived wait, progress bar shows live status

S3 reruns the M9.2-S10 failed tests (A: scheduled task, B: restaurant research, C: headphone research, D: direct control). All three layers will be active.

**Prediction:** Tests B and C should pass — the budget hook forces delegation, auto-fire starts the worker immediately, progress bar shows it happening. Test A (hallucinated scheduling) is the wildcard — no WebSearch is involved so the budget hook doesn't trigger. The reframed tool description from S1 may or may not be enough. If A fails, consider a targeted prompt addition about schedule triggers.

**No blockers for S3.**

---

## Recommendation

**Merge. Proceed to S3.** Add auto-fire unit tests (suggestion 5) as S3 prep housekeeping.
