# M10-S0 Routing Simplification — Architect Review

**Reviewer:** Opus (architect, separate session)
**Date:** 2026-04-13
**Scope:** Sprint commits `f5f7800..8b430c6` on branch `sprint/m10-s0-routing-simplification`
**Confidence note:** This sprint is the M10 blocker. It is the fourth fix to WhatsApp bleed. Prior fixes each patched a symptom and left the class intact. This sprint was specifically scoped to remove the class. A residual violation in this PR is not a nit — it is the failure mode the sprint was chartered to eliminate.

---

## Verdict: NOT APPROVED — 3 issues must be fixed before merge

The core architectural cleanup is excellent. The `sourceChannel` abstraction is cleanly removed, the presence rule is faithfully implemented in `alert()`, the regression-first methodology was practiced (tests committed in `f5f7800` before implementation in `b6c04b5`), and acceptance criteria 1–4 are all green.

However, the implementation contains a **rule violation in the channel-switch branch** that is identical in shape to the bugs this sprint was meant to prevent — silently falling back to a different channel than the rule dictates. It is masked by a test suite that uses the same value for preferred channel and target channel in every scenario. Two related robustness bugs in the same code path compound the risk.

All three issues live in `conversation-initiator.ts` within ~20 lines of each other and share a fix pattern. They are a single afternoon of work, not a second sprint.

---

## What Works

- **Presence rule implementation.** `alert()` at `packages/dashboard/src/agent/conversation-initiator.ts:87-148` is a pure function of `(last user turn, preferred channel, now)`. No coupling to `SessionManager.channel`, no residual sourceChannel plumbing, no inference from turn history beyond the one explicit rule. This is exactly what the plan asked for.
- **`getLastUserTurn` helper.** `packages/dashboard/src/conversations/transcript.ts:196-223` scans tail-first, strictly filters `type === "turn" && role === "user"`. Correctly excludes events, meta, assistant turns. Resilient to malformed JSONL (try/catch/continue).
- **Hardcode deletions.** All five planned hardcode sites are gone. All five planned read sites are gone. Grep confirms zero production references to `sourceChannel` or `source_channel`.
- **Test discipline.** The 6 integration tests in `tests/integration/routing-presence.test.ts` cover the scenarios the plan named. `getLastUserTurn` unit tests cover edge cases (empty, trailing-assistant-before-user, unknown conv). 16 conversation-initiator tests lock in the new behavior.
- **Documentation.** `whatsapp-bleed-issue-4.md` is cleanly written with root cause analysis. `whatsapp-bleed-issue-3.md` is annotated with the reversion note. ROADMAP updated.
- **Diff health.** Tight, focused, no commented-out code, no console logs, no unrelated refactors.

---

## Issue 1 — CRITICAL: Channel-switch branch violates the presence rule

**File:** `packages/dashboard/src/agent/conversation-initiator.ts:125-148`
**Severity:** Critical — same failure class the sprint was chartered to eliminate.

### The violation

`alert()` correctly computes `targetChannel` via the presence rule. When a channel switch is needed (target ≠ current conversation's `externalParty`), it calls `this.initiate({ firstTurnPrompt })` with no channel override. `initiate()` at `:155-188` always resolves outbound info via `this.getOutboundChannel()` — the **preferred** channel — ignoring the `targetChannel` that `alert()` just decided.

### Scenario that fails the rule

- Preferred channel = `"web"` (or any non-WA default).
- User's last user turn was on `"ninas_dedicated_whatsapp"`, 5 minutes ago.
- Current conversation's `externalParty` is null (e.g. web-originated conversation).
- `alert()` computes `targetChannel = "ninas_dedicated_whatsapp"` — presence rule, correct.
- `resolveOutboundInfo("ninas_dedicated_whatsapp")` returns the WA ownerJid.
- `isSameChannel = false` (null ≠ WA ownerJid).
- Falls into `initiate()`. `initiate()` resolves via `getOutboundChannel()` → `"web"`.
- **New conversation created on web, not WA.** The rule said WA. The code delivered web.

This is exactly the pattern we just spent the sprint removing: a silent fallback to a "default" that overrides the rule's explicit decision. It doesn't bite in production today only because the user's preferred channel happens to equal the target in the vast majority of cases. It will bite the moment we ship M10-S2 (email) or M10-S3 (Discord) and users have a non-WA preference.

### Why the test suite didn't catch it

Every test in `tests/conversation-initiator.test.ts` uses `getOutboundChannel: () => "whatsapp"`. Every test in `tests/integration/routing-presence.test.ts` uses WA as the preferred channel. Because preferred and target are always the same value, `initiate()`'s silent fallback to preferred is indistinguishable from honoring the target. The bug is invisible.

### Fix direction

`initiate()` must accept an explicit channel argument that overrides `getOutboundChannel()`. The name `initiate` already implies "reach out on a specific channel" — wire the channel in.

Two options; either is acceptable:

**Option A (minimal):** Add an optional `channel` parameter to `initiate()`. `alert()`'s channel-switch branch passes `targetChannel`. Cron-triggered `initiate()` (proactive outreach with no existing conversation) continues to pass undefined, which falls to `getOutboundChannel()` as today.

**Option B (factored):** Extract a private `resolveOutboundInfoFor(channelId)` that both paths use. `alert()` resolves once for `targetChannel` and passes the resolved `{channelId, ownerJid}` down to a lower-level `createNewConversationOn(channel, ownerJid, prompt)` primitive. `initiate()` becomes a thin wrapper that picks the preferred channel and calls the primitive.

Option B is cleaner long-term but larger. Option A is sufficient. Developer's call.

### Acceptance

The following test must be added to `tests/conversation-initiator.test.ts` and must pass:

```
"channel switch honors presence rule target, not preferred channel"
- getOutboundChannel: () => "web"
- Conversation with externalParty: null (web-origin)
- Append a user turn with channel: "whatsapp", timestamp = now - 5 min
- Call alert("test")
- Assert: a new conversation is created
- Assert: the new conversation's externalParty matches the WA ownerJid
- Assert: channelManager.sent has one entry (WA forward), not zero
```

This test MUST fail against the current code before the fix, then pass after.

---

## Issue 2 — CRITICAL: Silent drop when target transport is disconnected

**File:** `packages/dashboard/src/agent/conversation-initiator.ts:145` (and `:240-278` for `forwardToChannel`)
**Severity:** Critical — the plan named this exact failure mode and it was deferred without tracking.

### The failure

`forwardToChannel` at `:240-278` returns `void`. If the transport is disconnected, it logs a warning and silently returns. But at `:140-145`, the assistant turn has already been persisted with `channel: "ninas_dedicated_whatsapp"` via `sendSystemMessage`. The caller has no way to know the forward failed.

In the heartbeat path (`heartbeat-service.ts:180-192`), `alert()` returns `true`, the heartbeat calls `markDelivered`, and the notification is deleted from the queue. The transcript shows the message was sent. The user received nothing. There is no retry, no escalation, no observability.

### Why this is a rule violation, not just robustness

The rule says "find the user" and "deliver." Silently persisting to transcript while the transport drops the message on the floor is neither finding nor delivering. It is the most expensive form of failure — the one where every system reports success and the user experiences silence.

The plan's red-team section named this as follow-up "M10-S0.1." The review narrative acknowledges it. But no ROADMAP entry, no sprint folder, no DEVIATIONS.md note. It's currently a prose-only mention in two documents that will drift out of anyone's attention within a week.

### Fix direction

Three coordinated changes:

1. **`forwardToChannel` returns status.** Change return type from `Promise<void>` to `Promise<{ delivered: boolean; reason?: string }>`. Return `{delivered: false, reason}` for: transport not connected, no ownerJid, `send()` threw. Return `{delivered: true}` only when `channelManager.send` resolved without error.

2. **`alert()` propagates the outcome.** When `forwardToChannel` returns `delivered: false`, `alert()` returns `false`. When it returns `delivered: true`, `alert()` returns `true`. Currently `alert()` returns `true` unconditionally in the non-web path.

3. **Heartbeat treats `false` as transient failure, not terminal.** In `heartbeat-service.ts:184-198`, when `alert()` returns `false` due to forward failure (not due to "no current conversation"), increment attempts, do not mark delivered, do not fall to `initiate()`. The existing `MAX_DELIVERY_ATTEMPTS` check at `:161` handles the eventual give-up case.

Note: the current heartbeat's `false` branch falls to `initiate()`. This was correct when `false` meant "no current conversation." It becomes wrong when `false` can also mean "transport failed." `alert()`'s return value needs to distinguish these, or the heartbeat needs to check "conversation exists" before deciding to fall to `initiate()`. Developer's choice. The cleanest answer is probably an enum return type: `{status: "delivered" | "no_conversation" | "transport_failed"}`.

### Acceptance

The following test must be added to `tests/integration/routing-presence.test.ts` and must pass:

```
"transport failure does not silently mark notification delivered"
- Set up a conversation with a recent WA user turn (presence rule → WA target)
- Mock the WA transport to return statusDetail.connected = false
- Enqueue a job_completed notification
- Call heartbeat.drainNow()
- Assert: notification is still pending (not markDelivered)
- Assert: delivery_attempts incremented to 1
- Reconnect the transport (statusDetail.connected = true)
- Call heartbeat.drainNow()
- Assert: notification is now markDelivered
- Assert: transport received the outbound message
```

---

## Issue 3 — IMPORTANT: Channel-switch branch churns conversations on transient disconnect

**File:** `packages/dashboard/src/agent/conversation-initiator.ts:125-132`, combined with `manager.ts:69-73`
**Severity:** Important — not a rule violation per se, but a UX-hostile interaction with Issues 1 and 2.

### The failure

When `targetChannel = "ninas_dedicated_whatsapp"` but the WA transport has `statusDetail.connected === false`, `resolveOutboundInfo("ninas_dedicated_whatsapp")` returns `{ownerJid: null, resolvedChannelId: null}` at `:211-213`. Back in `alert()`:

- `isCurrentOnWeb` checks `!current.externalParty` — may be false (conversation IS on WA, externalParty set).
- `isSameChannel = !isCurrentOnWeb && current.externalParty === ownerJid` — `ownerJid` is null, so `isSameChannel` is false.
- `needsNewConversation = true` → falls into `initiate()`.
- `initiate()` creates a new conversation via `conversationManager.create()`, which at `manager.ts:69-73` **demotes the current conversation** (`status: "inactive"`) before creating the new one.
- Combined with Issue 1, the new conversation likely lands on web (the preferred fallback).

Result: on a transient WA disconnect, a successful WA-bound conversation is demoted and replaced by a web conversation. User comes back to WA to find a different conversation is now "current." This is conversation churn on infra flakiness.

### Fix direction

After Issues 1 and 2 are fixed, Issue 3 is largely subsumed:

- With Issue 2 fixed, `alert()` detects transport-not-connected upstream and returns `transport_failed`. The heartbeat retries; no new conversation is ever spawned on disconnect.
- With Issue 1 fixed, if a new conversation IS spawned legitimately, it lands on the correct target.

If any gap remains after Issues 1 and 2 are fixed, the explicit fix is: check transport connectivity in the channel-switch branch before calling `initiate()`. If target transport is not connected, return `transport_failed` (same enum value as Issue 2) rather than churning the conversation.

### Acceptance

The Issue 2 test above will largely cover this. Additionally, add a dedicated assertion:

```
"transient transport disconnect does not demote the current conversation"
- Conversation on WA (externalParty = WA ownerJid, status = "current")
- Mock WA transport disconnected
- Append a recent WA user turn (presence rule → WA target)
- Call alert("test")
- Assert: current conversation is still status="current"
- Assert: no new conversation was created (count unchanged)
```

---

## Tests required (summary)

Three new tests, all must fail against current code and pass after fix:

1. **`conversation-initiator.test.ts`** — channel switch honors target, not preferred. (Issue 1.)
2. **`tests/integration/routing-presence.test.ts`** — transport failure does not mark delivered; retries on reconnect. (Issue 2.)
3. **`tests/integration/routing-presence.test.ts`** — transient disconnect does not demote current conversation. (Issue 3.)

The existing 22 tests (16 unit + 6 integration) continue to pass unchanged.

---

## What NOT to change

- **The presence rule itself.** It is correct. Do not add "fallback if channel is disconnected" logic into the rule computation — handle disconnection at the delivery layer (Issue 2), not the decision layer.
- **`getLastUserTurn` or the transcript helper.** They are correct and thoroughly tested.
- **The hardcode deletions.** All five are correctly gone. Do not reintroduce any `sourceChannel` parameter, field, or branch to "solve" Issue 1. The fix is to plumb `targetChannel` through `initiate()`, not to re-tag the call site.
- **The `markDelivered` semantics in the heartbeat's success path.** When delivery genuinely succeeds, `markDelivered` is correct. Only the failure path needs work.

---

## Tasks 6 and 7 (from plan)

- **Task 6 (deliver the lost April 13 Chiang Mai research):** Still owed. Plan-approved as post-merge. DECISIONS.md logs approval. Not blocking this architect review.
- **Task 7 (ROADMAP + memory + docs):** Done. Verified.

---

## Acceptance criteria for re-review

When the developer re-submits:

1. Three new tests exist, each demonstrating a prior-failure before the fix (proven via commit order or reviewer-run diff).
2. `forwardToChannel` returns a status object or enum (not void).
3. `alert()` has a distinguishable return for "no conversation" vs "transport failed."
4. Heartbeat does not call `markDelivered` on transport-failed alerts.
5. Channel-switch branch lands on the presence-rule target, regardless of preferred channel.
6. All 22 pre-existing tests still pass.
7. Diff is still tight — no unrelated refactors smuggled in alongside the fixes.

---

## Note to developer

This sprint did the hard architectural work correctly. The three issues above are in code the rule never directly mandated — they live in the seams between the rule and the delivery layer. They were not caught because the tests, though correct, used a single preferred-channel value throughout, so two distinct code paths (presence-rule target, channel-switch fallback) looked equivalent. The fix is not a redesign; it is closing the seams that the rule itself correctly defined but the implementation didn't fully honor.

One afternoon of work. Submit for re-review when all three tests pass.
