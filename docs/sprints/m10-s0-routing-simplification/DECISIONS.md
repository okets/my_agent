# M10-S0 Decisions Log

Decisions made during sprint execution. Appended chronologically.

---

## 2026-04-13 — Sprint start

**Mode:** Trip sprint (CTO on mobile).

**Pre-execution decisions (CTO confirmed):**

- **Task 6 Option A approved.** After the presence-rule fix lands, we manually re-enqueue a `job_completed` notification for job `594f1962` (the lost April-13 Chiang Mai research) with no `sourceChannel`. Heartbeat picks it up, presence rule routes to WA. Real code path, proves fix end-to-end.
- **No auto-merge.** Sprint ends at `sprint/m10-s0-routing-simplification` branch + `/trip-review`. CTO decides merge after walkthrough.

**Validation approach (CTO approved):**

1. Regression-first — integration tests against current master must fail (prove they catch Issue #4) before any code deletion.
2. Unit tests for `getLastUserTurn()` and `alert()` presence rule.
3. Integration tests via AppHarness — real ConversationManager, mocked transports (no live outreach).
4. Mechanical: grep `sourceChannel` / `source_channel` in `packages/dashboard/src/` → zero prod hits; typecheck; existing suite passes.
5. External reviewer (trip-mode mandate) — independent Opus, runs tests, spec-gap analysis.
6. Production proof — Task 6 re-enqueue. If message lands on WA, fix is real.

---

## 2026-04-13 — Mechanical acceptance results

**Grep (`packages/dashboard/src/`):**
- `sourceChannel` → 0 matches
- `source_channel` → 0 matches

**Typecheck:**
- `packages/dashboard` → exit 0
- `packages/core` → exit 0

**Full dashboard test suite (1200 tests):**
- 1184 passed, 12 skipped, **4 failed**.
- The 4 failures are pre-existing on master (verified by stashing the sprint diff and re-running): `tests/unit/ui/progress-card.test.ts` (status icon/color assertions) + 2 Playwright browser tests in `tests/browser/`. None reference routing, conversations, notifications, or `sourceChannel`. **Not introduced by M10-S0.**

**M10-S0-specific tests (29 tests across 3 files):**
- `tests/integration/routing-presence.test.ts` — 6/6 pass
- `tests/conversations/get-last-user-turn.test.ts` — 7/7 pass
- `tests/conversation-initiator.test.ts` — 16/16 pass

---

## 2026-04-13 — Implementation choices

- **`getLastUserTurn()` placement:** added on `TranscriptManager` (tail-scan reading the JSONL once, stops at first user turn). `ConversationManager` exposes it as a thin async wrapper. Mirrors the existing `getRecentTurns` pattern.
- **Channel-switch detection (alert):** kept the existing rule — if `current.externalParty` doesn't match the resolved owner JID for the target channel, start a new conversation. Did not introduce a separate "channel switch" code path; reuses `initiate()`.
- **`PersistentNotification.source_channel` field:** removed from the type. Stale on-disk records that still carry the field are tolerated because `JSON.parse` doesn't mind unknown fields and nothing reads it anymore — verified by the legacy-field integration test.
- **`automation-scheduler.ts:292` comment:** rewrote rather than deleting, to record the new rule for future maintainers.
- **`mcp/automation-server.ts` fire_automation:** now passes `args.context ?? {}` straight through. The brain's MCP context is no longer mutated.

---

## 2026-04-13 — Architect review fixes

After the external reviewer returned PASS, a separate architect review (`architect-review.md`) returned **NOT APPROVED** with three issues, all clustered in `conversation-initiator.ts` and all masked by tests where preferred channel, target channel, and `externalParty` ownerJid all happened to equal `"whatsapp"`. Same failure class this sprint was chartered to remove.

Fixes landed together since they share a code path:

### Issue 1 — channel-switch branch honors presence-rule target, not preferred

`initiate()` previously resolved outbound info via `getOutboundChannel()` unconditionally. When `alert()` hit the channel-switch branch (target ≠ current conversation's ownerJid) it called `initiate(...)` without passing `targetChannel`, so the new conversation landed on preferred instead of target. Fixed by:

- `initiate(options?: { firstTurnPrompt?: string; channel?: string })` — optional explicit channel.
- `alert()` passes `targetChannel` when taking the channel-switch branch.
- Test (`tests/conversation-initiator.test.ts`): preferred=`"web"`, target=`"whatsapp"`, conversation `externalParty=null` → asserts new conversation's `externalParty` is the WA ownerJid and transport actually received the WA send.

### Issue 2 — transport failures surfaced via enum return type

`forwardToChannel` previously returned `Promise<void>` and swallowed transport-disconnect / send-throw cases. `alert()` always returned `true`. Heartbeat always `markDelivered`. The transcript showed "sent"; the user got silence. Fixed by:

- `forwardToChannel` now returns `Promise<{ delivered: boolean; reason?: string }>`.
- `alert()` return type changed from `Promise<boolean>` to a discriminated union: `{ status: "delivered" | "no_conversation" | "transport_failed"; reason?: string }`. Exported as `AlertResult`.
- Upfront connectivity check in `alert()`: if target transport is disconnected, return `transport_failed` **before** touching the transcript or the conversation lifecycle.
- Heartbeat now branches on `result.status`: `delivered` → `markDelivered`; `no_conversation` → `initiate()` fallback; `transport_failed` → `incrementAttempts` (retry next tick, `MAX_DELIVERY_ATTEMPTS` handles give-up).
- Test (`tests/integration/routing-presence.test.ts`): notification enqueued with WA-bound conversation + recent WA turn + WA transport disconnected → `listPending()` shows 1 with `delivery_attempts: 1`, no send. Reconnect → `drainNow` → delivered.

### Issue 3 — no conversation churn on transient disconnect

Pre-fix, `resolveOutboundInfo` for a disconnected transport returned `{ ownerJid: null }`, making `isSameChannel = false` (because `current.externalParty` was set but `ownerJid` was null), which flowed into `initiate()` → `conversationManager.create()` **demoted the current conversation**. User comes back on reconnect to find the conversation moved. Fixed as a consequence of Issue 2's upfront connectivity check: `transport_failed` is now returned before `isSameChannel` is evaluated, so `initiate()` is never called on disconnect.

- Test (`tests/integration/routing-presence.test.ts`): WA-bound current conversation + disconnected transport + recent WA turn → `alert()` returns `transport_failed`, conversation count unchanged, status still `"current"`, `channelManager.sent` is empty.

### Call-site migration

- `server.ts`, `automation-processor.ts`, `automation-scheduler.ts`: structural `conversationInitiator` types updated to the enum return + `channel` param.
- `app.ts` mount_failure handler: already ignored the return value; no change needed.
- `routes/debug.ts` (the `/debrief` test endpoint): updated to return the `result` object; branches on `result.status === "no_conversation"` for the initiate fallback.
- `automation-processor.ts` fallback path (no queue wired): branches on `delivered | no_conversation | transport_failed`, logs on transport_failed.
- `automation-scheduler.ts` failure-notify path: only falls to `initiate()` on `no_conversation`.

### Test mocks updated

Six test files with `vi.fn().mockResolvedValue(true|false)` on `alert` migrated to the enum shape: `needs-review-notification.test.ts`, `unit/automations/heartbeat-service.test.ts`, `src/automations/__tests__/heartbeat-service.test.ts`, `e2e-agentic-flow.test.ts`, `e2e/conversation-initiator-routing.test.ts`, plus the in-suite assertion migrations for `conversation-initiator.test.ts` and `routing-presence.test.ts`.

### Post-fix verification

- Typecheck: dashboard + core both exit 0.
- Full dashboard suite: 1187 pass, 12 skipped, 4 fail (all pre-existing: 2 UI status-icon assertions in `tests/unit/ui/progress-card.test.ts`, 1 Playwright automation-ui test, 1 Playwright progress-card test — none touch routing, notifications, or the initiator).
- M10-S0-scoped tests: 32/32 pass (17 initiator + 8 routing-presence + 7 get-last-user-turn). The three new architect-acceptance tests all FAILED against the pre-fix code (verified during TDD phase) and PASS now.
- Grep: still 0 references to `sourceChannel`, `source_channel`, `isDashboardSourced`, `getLastWebMessageAge`, `useWeb`, `webAge` in `packages/dashboard/src/`.
