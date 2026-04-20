---
sprint: M9.4-S4.1
title: "Deviations — Brief Section Preservation"
date: 2026-04-20
runner: team-lead
---

# Deviations — M9.4-S4.1

## DEV-1 — Plan missed the `HeartbeatConfig.conversationInitiator.alert` structural alias

**Type:** Scope addition (forced by TypeScript exhaustiveness).

**What the plan said:**

> Task 5 Step 1: "Heartbeat service (`heartbeat-service.ts:290-323`): Extend the `if/else` chain after `alert()` to handle `skipped_busy` and `send_failed`..."
>
> Task 5 Steps 2–4: update inline `AlertResult` type aliases in `automation-scheduler.ts`, `automation-processor.ts`, `server.ts`.

Plan covered four inline-alias update sites: three named in Steps 2-4, plus the *handling* logic in heartbeat-service.

**What we found:**

When Task 5's first pass landed and Task 8 ran `npx tsc --noEmit`, TypeScript surfaced a TS2322 error at `packages/dashboard/src/app.ts:1990`:

```
Type 'ConversationInitiator | null' is not assignable to type
  '{ alert(prompt: string, options?: ...): Promise<{ status: "delivered"; } | { status: "no_conversation"; } | { status: "transport_failed"; reason: string; }>; ... }'
```

The error line was in `app.ts`, but the root cause was elsewhere: the `HeartbeatConfig.conversationInitiator` interface at `heartbeat-service.ts:77-81` declared an inline *structural* shape of `alert()`'s return type that was still the pre-sprint 3-variant union. `app.ts` assigned a real `ConversationInitiator` (5-variant return) to a `HeartbeatConfig.conversationInitiator` field (3-variant return), which was the mismatch.

The plan's scope table mentioned the heartbeat-service.ts file twice (for handling logic at 290-323 and tests in `__tests__/`) but did not call out the `HeartbeatConfig` interface at lines 77-81 as an additional inline-alias duplication.

**Action taken:**

Extended the inline alias inside `HeartbeatConfig.conversationInitiator.alert` at `heartbeat-service.ts:77-81` to include `skipped_busy` and `send_failed`. Typecheck went clean afterward — no edits to `app.ts` were required; the cascading TS2322 resolved automatically once the interface matched.

**Why:**

The plan counted three inline-alias duplications (scheduler, processor, server); in reality there were four (scheduler, processor, server, heartbeat-service's `HeartbeatConfig` interface). Exhaustiveness did its job — it surfaced the mismatch as a compile error rather than a silent logic hole. We log this as a deviation because the scope table in the plan undercounted, not because we changed our approach.

**Consequence for follow-up:**

FU-3 (AlertResult consolidation) counts five total duplications of the shape — four structural inline aliases plus the canonical `export type AlertResult` in `conversation-initiator.ts`. Recorded in FOLLOW-UPS.md.

## DEV-2 — Session-manager briefing-timing test rewritten mid-sprint

**Type:** Test quality correction.

**What the plan said:**

> "New test: briefing not marked delivered if session throws before first output."

Plan did not prescribe the test's implementation shape.

**What we found:**

The first implementation of `tests/unit/agent/session-manager-briefing-timing.test.ts` tested a local copy of the guard logic (`simulateStreamMessageBriefingPath`) rather than exercising the real `session-manager.ts` production path. Reviewer flagged the test as tautological — a revert of the production guard would not cause these tests to fail.

**Action taken:**

Backend-dev rewrote the test per reviewer's Option B: the guard logic was extracted into a single helper inside `session-manager.ts` (also eliminating a real duplication hazard — two copies of the guard block at lines ~707-715 and ~749-757 that could drift), and the test now exercises the real helper via synthetic async generators. Verified by revert-restore sanity check (revert → tests fail; restore → tests pass).

**Why:**

CTO directive during the sprint emphasized that tests must actually exercise the invariants they claim to test. A tautological test is worse than no test — it creates false confidence. The correction was small and high-leverage.

**Consequence for follow-up:**

FU-5 tracks the monitoring concern (future re-inlining could re-introduce the tautology).
