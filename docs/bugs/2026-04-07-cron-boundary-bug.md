---
title: "Scheduler cron boundary bug — missed debrief on 2026-04-07"
priority: high
created: 2026-04-07
---

# Bug: AutomationScheduler misses cron tick due to `prev()` boundary condition

## Symptom

Debrief reporter (`0 8 * * *` Bangkok) did not fire on 2026-04-07. No errors in logs. Dashboard was running continuously (PID 658280, up since 20:31 IDT April 6).

## Root Cause

Two interacting issues in `packages/dashboard/src/automations/automation-scheduler.ts`:

### Issue 1: `cron-parser` `prev()` boundary (line 113)

At the exact cron tick second (e.g., 01:00:00 UTC for `0 8 * * *` Bangkok), `CronExpressionParser.parse().prev()` returns the **previous** tick (yesterday), not the current one:

```
at 01:00:00 UTC → prev() = 2026-04-06T01:00:00Z  (yesterday)
at 01:01:00 UTC → prev() = 2026-04-07T01:00:00Z  (today, correct)
```

### Issue 2: Manual run poisoned the comparison (line 136)

The debrief was manually triggered on April 6 at 07:40 UTC (14:40 Bangkok). This job is newer than the April 6 01:00 UTC tick. When the scheduler polled at 01:00:00 UTC April 7:

```
prev  = 2026-04-06T01:00:00Z  (yesterday's tick, due to Issue 1)
last  = 2026-04-06T07:40:52Z  (manual run)
prev > last → false → SKIP
```

On the next poll at ~01:01 UTC, `prev()` should return the correct tick and `prev > last` should be `true`. But the debrief still didn't fire, which suggests a third issue — possibly the `setInterval` callback dying silently from an unhandled promise rejection in `checkDue()`.

### Issue 3: No try-catch in `checkDue()` (line 62-96)

`checkDue()` is called from a `setInterval` callback (line 42). If `automationManager.list()` throws, the rejection is unhandled. In Node.js, this could kill the interval timer silently — no log, no crash, just stops polling.

## Evidence

```
# Debrief jobs — no April 7 entry
completed  created=2026-04-06T07:40:52Z  (manual, 14:40 Bangkok)
completed  created=2026-04-06T01:00:21Z  (cron, 08:00 Bangkok)
completed  created=2026-04-05T01:00:42Z  (cron, 08:00 Bangkok)

# Dashboard was running at cron time
PID 658280: started 2026-04-06T17:31:45 UTC, running until 2026-04-07T02:30 UTC
No restarts between 17:31 UTC April 6 and 02:30 UTC April 7

# No debrief-related log entries between 23:00 IDT April 6 and 05:30 IDT April 7
# Daily Summary fired correctly at 23:00 IDT (different cron, different handler)

# Reproduction:
npx tsx -e "
import { CronExpressionParser } from 'cron-parser';
const i = CronExpressionParser.parse('0 8 * * *', { tz: 'Asia/Bangkok', currentDate: new Date('2026-04-07T01:00:00Z') });
console.log(i.prev().toDate().toISOString()); // 2026-04-06T01:00:00Z  ← WRONG
"
```

## Fixes Required

### Fix A: Guard `prev()` boundary

In `isCronDue()` at line 113, add 1 second to `currentDate` so `prev()` never lands on the boundary:

```typescript
const interval = CronExpressionParser.parse(cron, {
  tz,
  currentDate: new Date(now.getTime() + 1000), // avoid exact-second boundary
});
```

### Fix B: Wrap `checkDue()` in try-catch

At line 42, protect the interval callback so it never dies silently:

```typescript
this.interval = setInterval(async () => {
  try {
    await this.checkDue();
  } catch (err) {
    console.error("[AutomationScheduler] checkDue failed:", err);
  }
}, this.config.pollIntervalMs ?? 60_000);
```

### Fix C: Add logging for skipped crons (optional, helps debugging)

Currently `checkDue()` produces no output when automations are evaluated but not fired. Adding a debug log when a scheduled automation is skipped would have made this issue visible immediately.

## Files to Modify

- `packages/dashboard/src/automations/automation-scheduler.ts` — all three fixes
- `packages/dashboard/src/automations/__tests__/automation-scheduler.test.ts` — add boundary test

## Verification

After fixing, run:
```typescript
// This must return true (the cron tick IS due)
scheduler.isCronDue("0 8 * * *", automation, new Date("2026-04-07T01:00:00Z"), "Asia/Bangkok")
```
