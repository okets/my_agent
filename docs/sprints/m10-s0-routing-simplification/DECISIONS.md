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
