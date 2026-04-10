---
reviewer: external-auditor
date: 2026-04-10
scope: post-merge polish commits (6ad5bc7..7232cee)
verdict: PASS WITH CONCERNS
---

# Post-Sprint Review: M9.4-S3 Job Progress Card (Polish Commits)

## Verdict: PASS WITH CONCERNS

All 135 tests pass (1171 assertions, 0 failures). The changes are well-scoped, follow existing patterns, and deliver real UX improvements. Two concerns warrant attention before the next release.

## Commits Reviewed

| Commit | Description |
|--------|-------------|
| `6ad5bc7` | fix(heartbeat): restore MAX_DELIVERY_ATTEMPTS guard |
| `80b00fd` | fix(ui): click anywhere on card to toggle |
| `807a2e4` | feat(ui): stop button with confirmation |
| `2788f1e` | fix(ui): optimistic dismiss on stop |
| `5c3f462` | feat(jobs): notify brain on stop |
| `7232cee` | fix(jobs): race guard on stop endpoint |

---

## What Was Done Well

- **Heartbeat guard restoration** is a genuine safety fix. Without MAX_DELIVERY_ATTEMPTS, a permanently undeliverable notification would retry on every 30s tick forever. Good catch.
- **Race condition guard** (`job.status !== "running"` check) prevents double-notification when a job completes naturally before the stop request lands. Correct pattern.
- **Desktop/mobile parity** for the stop button HTML is pixel-identical between the two templates. Good discipline.
- **Notification shape** matches the `PersistentNotification` interface exactly: `job_id`, `automation_id`, `type`, `summary`, `created`, `delivery_attempts` are all present and correctly typed. The `type: "job_failed"` value is valid per the union type.
- **`@click.stop`** on the stop button container prevents toggle from firing when interacting with stop/confirm controls. Correct event handling.

---

## Issues

### Important (should fix)

**1. Optimistic dismiss hides API failures silently**

In `confirmStop()`, the card is dismissed before the fetch fires. If the API call fails (network error, 503, race condition), the user sees the card vanish but the job keeps running server-side. The `catch` block only logs to console -- the user has no indication anything went wrong.

File: `/home/nina/my_agent/packages/dashboard/public/js/progress-card.js`, lines 45-55

Recommendation: On fetch failure, un-dismiss the card (re-add to active cards) or show a brief toast/error indicator. At minimum, check the response status:

```js
const res = await fetch(`/api/jobs/${jobId}/stop`, { method: "POST" });
if (!res.ok) {
  console.error("[progress-card] stop failed:", res.status);
  // Consider: Alpine.store("jobs").undismiss(jobId);
}
```

**2. Stop endpoint does not actually stop the running process**

The endpoint sets `status: "failed"` in the job record and enqueues a notification, but does not signal the `AutomationProcessor` or `AutomationExecutor` to abort the in-flight work. If the job is running a multi-step automation with an active Claude session, that session continues executing and will eventually write its own completion status, overwriting the "failed" status set by stop.

File: `/home/nina/my_agent/packages/dashboard/src/routes/automations.ts`, lines 269-297

This is the most significant gap. The race guard at the top prevents double-notification if the job finishes first, but the inverse race (stop fires, job keeps running, job finishes and overwrites status to "completed") is not handled. The user thinks they stopped it, the brain gets a "stopped by user" notification, then minutes later the job finishes and potentially sends a second notification via the normal completion path.

Recommendation: Either (a) add an abort signal to the executor/processor that the stop endpoint can trigger, or (b) add a `stoppedByUser` flag to the job record that the completion path checks before overwriting status. This can be a follow-up item but should be tracked.

### Minor

**3. No input validation on job ID parameter**

The stop endpoint accepts any string as `:id`. While `getJob()` returns null for unknown IDs (handled with 404), there is no validation that the ID is well-formed. This is consistent with other routes in the file, so it is not a regression, but worth noting.

**4. `notificationQueue` null guard is defensive but asymmetric**

The stop endpoint checks `if (app.notificationQueue)` before enqueuing. If the queue is null, the stop succeeds silently without notification -- the brain never learns the user stopped a job. This is acceptable for robustness but the brain will never inform the user about the stop in that case.

---

## Security Assessment

**Risk: Low.** The stop endpoint follows the same security posture as all other `/api/jobs/*` and `/api/automations/*` routes:

- No auth middleware is applied (consistent with all automation routes).
- The dashboard is accessed over Tailscale (private network), not the public internet.
- Debug/admin routes use `localhostOnly` middleware; user-facing routes do not, per project convention.
- The endpoint is idempotent: calling stop twice returns `{ ok: true, message: "Job already finished" }` on the second call. No amplification risk.
- The endpoint does not accept arbitrary data in the body; only the URL parameter `:id` is used.

No new attack surface relative to existing routes.

---

## Test Coverage

- T6 (toggle expand/collapse) was updated to reflect the new click target (outer `.glass-strong` div instead of inner `span.cursor-pointer`). Correct update.
- No new tests were added for the stop flow (requestStop, confirmStop, cancelStop). These are UI-only methods calling a REST endpoint, so browser-level tests would be appropriate but are not critical for a polish commit.
- The heartbeat MAX_DELIVERY_ATTEMPTS guard has an existing test (`stops retrying after max delivery attempts`) that covers this path.

---

## Summary

| Category | Count |
|----------|-------|
| Critical | 0 |
| Important | 2 |
| Minor | 2 |
| Suggestions | 0 |

The polish commits are clean, well-structured, and follow existing patterns. The two Important items (silent failure on optimistic dismiss, and stop not actually cancelling the running process) should be tracked for resolution. Neither blocks the current state from shipping since the stop feature is new and additive.
