# Decisions — M9.1-S3: Heartbeat Jobs Service

> Sprint decisions logged during autonomous execution (trip mode).

## D1: Kept SessionManager.pendingNotifications (in-session delivery)

**Context:** The spec says "Replaced by persistent notification queue on disk." But `pendingNotifications` serves a different purpose — when `ci.alert()` finds the session is busy streaming, it queues the notification for next-turn injection. This is the active-conversation delivery path, not the between-session retry path.

**Decision:** Keep `pendingNotifications` for in-session delivery. The persistent queue handles cross-session persistence and retry. They're complementary, not redundant.

**Pros:** Preserves working active-conversation notification flow.
**Cons:** Two notification mechanisms coexist. The persistent queue handles working agent notifications; pendingNotifications handles conversation-layer injections.

## D2: Kept checkStaleJobs() method but removed from interval

**Context:** The scheduler's `checkStaleJobs()` is replaced by the heartbeat service's todo-activity-based detection. Rather than deleting the method (which might be referenced elsewhere), I removed it from the polling interval and added a comment.

**Decision:** Method kept for backward compat, just no longer called on tick.

## D3: Simplified handleNotification to queue writes

**Context:** The old `handleNotification()` had 3 branches (immediate/failure/needs_review) each with inline `ci.alert()` + `ci.initiate()` fallback + timezone resolution. 

**Decision:** Replaced with a single queue write. The heartbeat's `formatNotification()` now handles mediator framing. Falls back to direct `ci.alert()` if no queue configured (backward compat for tests).

