---
sprint: m9.1-s9
title: Heartbeat Liveness Fix
status: Done
date: 2026-04-18
---

# Sprint Review — M9.1-S9: Heartbeat Liveness Fix

## Trigger Incident

**2026-04-18, job `job-9d6ba79b` (`thailand-news-worker`)**

At 00:06:19 UTC, the heartbeat service flagged the job as interrupted — 5 minutes 17 seconds after the last todo MCP call. The job completed normally at 00:10:18 UTC. A false `job_interrupted` notification was delivered to the user.

The audit log showed continuous activity: WebFetch, browser MCP, and Bash tool calls right up to 00:04:50 UTC — only 1 minute 29 seconds before the alarm fired.

## Root Cause

`todos.json:last_activity` was the **only** liveness signal. It is updated by exactly 4 todo MCP tools (`todo_update`, `todo_complete`, `todo_add`, `todo_check`). Workers performing legitimate research work — WebFetch, browser navigation, Bash commands — for more than 5 minutes received no credit for that activity and were falsely flagged as stalled.

## Layers Shipped (Defense-in-Depth)

### Layer 1 — Audit-Log Liveness (PRIMARY)

New module: `audit-liveness.ts`. Reads `{agentDir}/logs/audit.jsonl`, filters by `sdk_session_id`, and returns the timestamp of the most recent tool call. **Any** tool call (not just todo MCP tools) counts as activity. Implementation: 64 KB tail read, `<1ms` in practice.

### Layer 2 — Run-Dir Recursive mtime (LAZY FALLBACK)

Checked only when **both** the todo timestamp and the audit timestamp are stale. Recursively stats the job's run directory up to depth 4. Excluded from consideration: executor-owned files (`todos.json`, `deliverable.md`, `CLAUDE.md`, `task.md`) to avoid false freshness from the executor itself writing state. Designed to catch subagent-delegation gaps where the parent executor is idle while a subagent does work.

### Layer 3 — 60s Minimum-Age Gate + Recheck (SAFETY NET)

`deliverPendingNotifications` now enforces a 60-second minimum age before delivering any `job_interrupted` notification. If the job has since recovered (status changed to `completed`, `success`, or similar), the notification is silently discarded. A `falsePositivesDropped` counter is incremented on each discard.

### Layer 4 — Per-Automation Threshold Override (ESCAPE HATCH)

Automation manifests now support a `health.stale_threshold_ms` field. Applied immediately to 6 known research workers with a 15-minute threshold (these jobs routinely spend >5 minutes on a single source). The type system in `automation-types.ts` was extended accordingly.

## What Was Skipped and Why

**Stream-event heartbeat from executor** (`for await` loop injecting periodic pings): would require touching the executor's core event loop, carrying higher regression risk. Deferred unless false positives recur under the new four-layer scheme.

## New Test Coverage

**15 new tests across 3 files:**

| File | New Tests | Coverage |
|------|-----------|---------|
| `audit-liveness.test.ts` | 6 | file absent, no session match, latest-wins across sessions, large-tail bounded to 64 KB, off-tail returns 0, empty session ID |
| `heartbeat-service.test.ts` | 6 | audit shows recent activity → no interrupt; neverStarted still fires; min-age gate delays a fresh notification; aged+stuck delivers; aged+recovered discards (drops counter); threshold override applied |
| `automation-manager.test.ts` | 3 | health field round-trip via create; absent field returns undefined; update path persists field |

## Live Smoke Test (2026-04-18)

A synthetic `job_interrupted` notification for the original April 18 job (now `completed`) was placed in the pending queue. On the next heartbeat tick, the journal confirmed:

```
[Heartbeat] Discarding stale job_interrupted for job-9d6ba79b... — job is now "completed" (drops=1)
```

Notification moved to `delivered/`, no false alert sent to user. Recheck path confirmed working end-to-end.

## Files Changed

**New:**
- `packages/dashboard/src/automations/audit-liveness.ts`
- `packages/dashboard/src/automations/__tests__/audit-liveness.test.ts`

**Modified:**
- `packages/dashboard/src/automations/heartbeat-service.ts` — agentDir threading, `readRunDirMtime`, audit signal integration, min-age gate, recheck-before-deliver, threshold resolver
- `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts` — 6 new tests
- `packages/dashboard/src/automations/automation-manager.ts` — health field serializer
- `packages/dashboard/src/automations/__tests__/automation-manager.test.ts` — 3 new tests
- `packages/core/src/spaces/automation-types.ts` — `health.stale_threshold_ms` field
- `packages/dashboard/src/app.ts` — agentDir + threshold resolver wired to `HeartbeatService`
- 6 `.my_agent/automations/*.md` files (gitignored) — 15-minute threshold applied to research workers

## Follow-Ups

- **Restart-recovery eligibility for scheduled workers** — broaden to cover the April 7 class of incidents (separate ticket, not in scope here)
- **`falsePositivesDropped` counter** — wire to `/health` endpoint or metrics dashboard so ops can see the discard rate without tailing logs
- **Chunked backward reads** — if 64 KB audit tail proves insufficient under very high concurrent traffic, upgrade `audit-liveness.ts` to a chunked backward reader
