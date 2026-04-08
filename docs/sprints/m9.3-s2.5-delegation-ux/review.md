# M9.3-S2.5: Delegation UX -- Architect Review

**Reviewer:** External architect (Opus)
**Branch:** `sprint/m9.3-s2.5-delegation-ux`
**Commits reviewed:** 5 implementation commits (`8c27c64`..`a473afe`)
**Files changed:** 14 files, +285/-5 lines
**Date:** 2026-04-08

---

## Summary

The sprint delivers all five planned tasks (6.1-6.5) from the implementation plan. The auto-fire logic, progress pipeline, and inline progress bar are correctly wired end-to-end. The implementation is clean, well-scoped, and follows established patterns. Two important issues and several suggestions are noted below.

### What Was Done Well

- **Clean pipeline architecture.** The onProgress callback flows through a clear chain: todo_update -> emitProgress -> executor -> app -> statePublisher -> WebSocket -> Alpine. No polling, no file watchers. This is the right design.
- **Guard correctness.** The `isOnceManual` guard (`args.once && args.trigger.every(t => t.type === 'manual')`) correctly prevents auto-fire for scheduled, watch, or channel-triggered automations. This is the single most important safety check in the sprint.
- **Test coverage.** The `todo-server-progress.test.ts` tests cover the happy path, edge cases (notes-only, no callback provided), and multi-item scenarios. Clean and focused.
- **Desktop and mobile parity.** The progress bar template appears identically in both desktop (~line 5652) and mobile (~line 8747) sections of `index.html`.
- **Design language compliance.** The progress bar uses the correct Tokyo Night tokens: accent-blue `#7aa2f7` fill, panel `#292e42` background, muted `#565f89` text. 4px height with rounded corners matches the spec.

---

## Plan Alignment

| Task | Plan | Implementation | Status |
|------|------|---------------|--------|
| 6.1 | Update systemMessage with `once: true` + pre-acknowledge | Done exactly as specified | Aligned |
| 6.2 | Auto-fire once:true manual automations | Done exactly as specified | Aligned |
| 6.3 | Add onProgress callback to todo server | Done exactly as specified | Aligned |
| 6.4 | Wire progress through executor -> processor -> UI | Wired executor -> app.ts directly, bypassing processor relay | Justified deviation |
| 6.5 | Inline progress bar in chat UI | Done, inline styles in HTML | Aligned |

### Task 6.4 Deviation

The plan specified wiring through the processor (`onJobProgress` on processor fires `job:progress` via `onJobEvent`). The actual implementation puts `onJobProgress` on the executor config and handles it directly in `app.ts`:

```typescript
onJobProgress: (jobId) => {
  const job = app.automationJobService?.getJob(jobId);
  if (job) {
    app.statePublisher?.publishJobs();
    app.emit("job:progress", job);
  }
},
```

This is a **justified deviation** -- the processor doesn't need to be an intermediary here because the executor already has the job context. The processor's `onJobEvent` is still used for lifecycle events (created, completed, failed), so there's no inconsistency. The approach is actually cleaner because it avoids adding a separate callback interface to the processor for a concern that lives entirely in the executor.

---

## Issues

### Important (should fix)

**1. `resume()` path does not pass `onProgress` to the todo server.**

In `automation-executor.ts`, the `run()` method correctly wires `onProgress` when creating the worker's todo server (line 259-261). However, the `resume()` method (line 553) creates a todo server without the callback:

```typescript
resumeMcpServers["todo"] = createTodoServer(todoPath);
```

This means if a needs_review job is resumed, the progress bar will not update during the resumed execution. For `once:true` ad-hoc tasks this is unlikely (they run to completion), but for jobs with `autonomy: "review"` that get resumed, progress will be silent during the second run.

**Fix:** Pass the same `onProgress` pattern used in `run()`:

```typescript
const onProgress = (progress: TodoProgress) => {
  this.config.onJobProgress?.(job.id, progress)
}
resumeMcpServers["todo"] = createTodoServer(todoPath, undefined, undefined, onProgress);
```

**2. Misleading variable name `delegationJobId` stores automation ID, not job ID.**

In `app.js`, the regex extracts the automation ID from the "created and fired" message:

```javascript
const match = lastMsg.content.match(/created and fired \(ID: ([^)]+)\)/);
if (match) {
  lastMsg.delegationJobId = match[1]; // This is automation.id, not job.id
}
```

The variable name says "job ID" but it stores `automation.id` (from the tool response text `(ID: ${automation.id})`). The `_syncDelegationProgress` function then correctly uses it to key into a map of `automationId -> job`, so the logic works. But the name is confusing and could lead to bugs if someone later tries to use it as an actual job ID.

**Fix:** Rename to `delegationAutomationId` throughout `app.js` (3 occurrences).

### Suggestions (nice to have)

**3. `onJobProgress` discards the `progress` parameter.**

The executor config declares `onJobProgress?: (jobId: string, progress: TodoProgress) => void` but `app.ts` only uses `jobId`:

```typescript
onJobProgress: (jobId) => {
```

The progress data is discarded and re-read from disk via `_getJobSnapshots()` in state-publisher. This works but means a disk I/O round-trip on every todo update. For high-frequency updates this could matter. Low priority since the debounce (100ms) in state-publisher already batches rapid updates.

**4. Multiple jobs per automation in the job map.**

`_syncDelegationProgress` builds `new Map(jobs.map(j => [j.automationId, j]))`. If an automation has multiple jobs (e.g., from manual re-fires), only the last job in the array survives in the map. For `once:true` automations this is unlikely to matter since they auto-disable after completion. No action needed, but worth a comment.

**5. No test coverage for the auto-fire path in automation-server.**

The plan (task 6.2) specified tests for the auto-fire behavior, but looking at the diff, only `todo-server-progress.test.ts` was added as a new test file. The auto-fire guard logic (checking `once:true` and trigger types) is covered implicitly by the existing test suite passing, but explicit unit tests for the three auto-fire cases (fire, skip-schedule, skip-no-once) would strengthen confidence.

**6. Progress bar text truncation on mobile.**

The progress bar text uses `truncate` class for CSS truncation, which works. However, the plan specifically called out testing at 375px width. The current text format `"3/5 -- Cross-checking sources"` could be quite long. The `truncate` class handles this, but adding `max-width: 100%` explicitly would be belt-and-suspenders.

---

## Security and Performance

- **No security concerns.** The auto-fire path uses `sourceChannel: "dashboard"` to prevent WhatsApp notification bleed. The progress pipeline is read-only from the UI side (WebSocket pushes, no client writes).
- **Race condition in auto-fire (checklist item 6):** The `.catch()` fire-and-forget pattern is intentional and matches the existing `fire_automation` tool. The processor has per-automation concurrency control (`runningJobs` map) that prevents double-fires. This is safe.
- **Performance:** The `_getJobSnapshots()` function reads todo files from disk on every `publishJobs()` call. With the 100ms debounce this is acceptable. For very large todo lists (50+ items) this could become a concern, but real-world jobs rarely exceed 10 items.

---

## Verdict

**Approve with minor fixes.** The implementation is solid and achieves the sprint goal. The two Important issues should be addressed before merge:

1. Wire `onProgress` in the `resume()` path (5-minute fix)
2. Rename `delegationJobId` to `delegationAutomationId` (search-and-replace)

The suggestions are non-blocking and can be addressed in a follow-up.
