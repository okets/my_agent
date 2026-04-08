# S3.5 Decisions

## D1: Session ID persistence (discovered during testing)

**Context:** Auto-resume predicate checked `job.sdk_session_id` but it was always `null` — the executor only persisted it at job completion (step 10).

**Decision:** Persist immediately on SDK init message capture, before worker continues.

**Why:** Without this, every interrupted job lacks a session ID and can't auto-resume.

## D2: WhatsApp bleed prevention for dashboard-sourced notifications

**Context:** When `alert()` fails (no active web conversation), the heartbeat falls through to `initiate()` which creates a new conversation on WhatsApp. This happened even for dashboard-sourced ad-hoc jobs.

**Decision:** When `source_channel === "dashboard"`, skip `initiate()` and leave the notification in the queue for the next `alert()` attempt when the user opens the dashboard.

**Why:** Dashboard-sourced work should stay on the dashboard. The user will see it when they open the web UI. API-fired and scheduler-fired jobs (no `sourceChannel`) still fall through to WhatsApp as before.

## D3: API-fired smoke tests don't set sourceChannel

**Context:** The `/api/automations/.../fire` endpoint doesn't pass `sourceChannel` to the processor. Only the brain's `create_automation` auto-fire path sets `sourceChannel: "dashboard"`.

**Decision:** This is by design. API-fired and scheduler-fired automations are not dashboard-specific — they may legitimately need WhatsApp notification. Only brain-delegated work gets the dashboard guard.
