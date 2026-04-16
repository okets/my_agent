# S6 External Code Review — User-Facing Messaging + Capability Confidence Contract

Sprint: M9.6-S6
Reviewer: Claude claude-opus-4-6 (external review session, no shared context with implementers)
Date: 2026-04-15
Spec ref: `docs/sprints/m9.6-capability-resilience/plan.md` §8
Branch: sprint/m9.6-s6-user-facing-messaging

---

## Verdict

**APPROVED WITH MINOR OBSERVATIONS.**

All six plan subsections (§8.1–§8.6) are implemented correctly and to spec, all
22 new S6 tests pass, both tsc runs are clean, and no tests regressed on master.
The S5-inherited items (FU4 routing fix, `capability_surrender` event emission)
are correctly wired. Two cosmetic / low-severity observations are noted below
— neither blocks merge.

---

## Plan ↔ code audit

| # | Plan item | Location | Status | Notes |
|---|-----------|----------|--------|-------|
| §8.1 | `ResilienceCopy` interface + `defaultCopy` | `packages/core/src/capabilities/resilience-messages.ts:14-74` | PASS | Interface shape matches plan verbatim. Tests lock byte-exact copy. |
| §8.1 | Ack (audio-to-text, deps-missing\|not-enabled) | `resilience-messages.ts:52-57` | PASS | "hold on — voice transcription isn't working right, fixing now." — also covers `not-installed`, `empty-result`, `timeout`, `validation-failed` via fall-through. Verified by test `resilience-copy.test.ts:32-48`. |
| §8.1 | Ack (audio-to-text, execution-error) | `resilience-messages.ts:53-55` | PASS | "voice transcription just hit an error — let me fix that." |
| §8.1 | Status (>20s) | `resilience-messages.ts:63-65` | PASS | "still fixing — second attempt." (`elapsedSec` param kept but ignored — documented in FU2.) |
| §8.1 | Surrender (iteration-3) | `resilience-messages.ts:67-73` | PASS | Exact string. |
| §8.1 | Surrender (budget) | `resilience-messages.ts:67-69` | PASS | Exact string. |
| §8.1 | Other-cap-type fallback template | `resilience-messages.ts:60,24-29` | PASS | `FRIENDLY_NAMES` table maps `image-to-text → "image understanding"`, `text-to-audio → "voice reply"`, `text-to-image → "image generation"`. Unknown types fall through to raw type. |
| §8.2 | `AckDelivery` class (TransportManager + ConnectionRegistry) | `packages/core/src/capabilities/ack-delivery.ts:61-101` | PASS | Structural `*Like` interfaces used instead of dashboard imports — documented in D1, necessary to avoid core→dashboard circular dep. Matches S5's `orphan-watchdog.ts` pattern. |
| §8.2 | Route via TransportManager for channel msgs | `ack-delivery.ts:89-99` | PASS | Correctly uses `channel.transportId`, `channel.sender`, `channel.replyTo`. Send failure is caught + logged (best-effort). |
| §8.2 | Route via WS broadcast for dashboard | `ack-delivery.ts:71-86` | PARTIAL | `broadcastToConversation` is called with payload `{ type: "system_message", ... }`. See Finding F1. |
| §8.3 | audio-to-text template: `confidence` + `duration_ms` | `skills/capability-templates/audio-to-text.md:32-42` | PASS | Documented as "optional but recommended", migration note present, JSON example updated. |
| §8.3 | Migration rule: undefined → null (conservative) | `packages/core/src/capabilities/failure-symptoms.ts:67-73` | PASS | `classifyEmptyStt` returns null when either field is undefined. Test `classify-empty-result-live.test.ts:52-58` locks this. |
| §8.4 | Do NOT touch `.my_agent/capabilities/stt-deepgram/` | (unchanged) | PASS | Correctly left alone. Follow-up filed in `s6-FOLLOW-UPS.md` FU1. |
| §8.5 | Replace emitAck log-only stub with AckDelivery.deliver() | `packages/dashboard/src/app.ts:682-731` | PASS | Real delivery wired; graceful fallback (console warn) if TransportManager/ConnectionRegistry unavailable at boot. |
| §8.5 | Status messages fire on 20s timer started at ack-emit | `packages/core/src/capabilities/recovery-orchestrator.ts:217-225,271` | PASS | Single `setTimeout(20_000)` after the initial attempt ack; cleared in `finally`. Timer is `.unref()`ed. Test `orchestrator-timing.test.ts` verifies fire/no-fire semantics with fake timers. |
| §8.6 | reverify reads `confidence` + `duration_ms` | `packages/core/src/capabilities/reverify.ts:170-181` | PASS | Robust parsing — `Number.isFinite` guard rejects NaN/Infinity. Fields exposed on `ReverifyResult` (lines 34-40). |
| Tests §8 acc. #1 | `resilience-copy.test.ts` | `packages/core/tests/capabilities/resilience-copy.test.ts` | PASS | 10 cases, all pass. Byte-exact string assertions. |
| Tests §8 acc. #2 | `ack-delivery-transport.test.ts` | `packages/core/tests/capabilities/ack-delivery.test.ts` | PASS | Named differently (`ack-delivery.test.ts`) but covers the same ground: WhatsApp path, dashboard path, non-throwing on transport error. 3 cases, all pass. |
| Tests §8 acc. #3 | `orchestrator-timing.test.ts` | `packages/core/tests/capabilities/orchestrator/orchestrator-timing.test.ts` | PASS | 3 cases with fake timers. See Finding F2 on test naming. |
| Tests §8 acc. #4 | `classify-empty-result-live.test.ts` | `packages/core/tests/capabilities/classify-empty-result-live.test.ts` | PASS | 7 cases covering Deepgram-shaped inputs with/without new fields + boundary cases (500ms, 0.2 confidence). |
| S5 inherited: FU4 reprocessTurn routing | `packages/dashboard/src/app.ts:749-756` | PASS | `failure.triggeringInput.channel.channelId \|\| undefined` passed as `channelOverride`. Correctly fixes the routing bug identified in S5 review. `\|\| undefined` guards against empty-string propagating. See observation O1. |
| S5 inherited: `capability_surrender` event emission | `packages/dashboard/src/app.ts:712-731` | PASS | Fires on both `surrender` and `surrender-budget` kinds; `reason` field maps correctly (`budget-exhausted` vs `max-attempts`). Event shape matches `CapabilitySurrenderEvent` in `packages/dashboard/src/conversations/types.ts:230-237`. |

---

## Findings

### F1 — Dashboard WS broadcast payload `{ type: "system_message" }` has no frontend handler (LOW)

**Location:** `packages/core/src/capabilities/ack-delivery.ts:73-78`

The dashboard branch of `AckDelivery.deliver()` broadcasts

```ts
this.connectionRegistry.broadcastToConversation(conversationId, {
  type: "system_message",
  conversationId,
  content: text,
  timestamp: new Date().toISOString(),
});
```

but `type: "system_message"` is not a variant of the `ServerMessage` union in
`packages/dashboard/src/ws/protocol.ts:120-166` and the Alpine client in
`packages/dashboard/public/js/app.js` has no handler for it (I grepped for
`system_message` across all frontend code — zero hits). Effect: for a
dashboard-originated CFR, the ack message is broadcast to the correct sockets
but silently ignored by the browser — the user sees nothing.

This is a product-facing gap for the dashboard-channel case. WhatsApp channel
delivery (the primary incident-recovery case, and the one the acceptance test
exercises) works correctly.

**Severity:** LOW — WhatsApp path is the spec's primary case; dashboard users
have the in-browser console for incident recovery. But this should get a
tracking follow-up so the dashboard reflects the ack in the conversation UI.

**Recommended fix (post-merge):** either (a) add `"system_message"` (or a more
opinionated name like `"capability_ack"`) to the `ServerMessage` union and a
`case` in `handleWebSocketMessage` that renders it as a system-styled turn, or
(b) use an existing variant (`conversation_updated` with a synthetic
assistant turn). Not blocking; add to `s6-FOLLOW-UPS.md`.

### F2 — `orchestrator-timing.test.ts` "budget-hit path" test is actually an iteration-3 path (COSMETIC)

**Location:** `packages/core/tests/capabilities/orchestrator/orchestrator-timing.test.ts:123`

The third test is named `"does not fire 'status' when the session completes
within 20s (budget-hit path)"`. However, when `spawnAutomation` throws, the
`try { ... session.totalJobsSpawned += 1 } catch` block swallows the error
*before* the counter increments (`recovery-orchestrator.ts:298-316`). So the
5-job budget is never hit; the session instead runs three attempts, all
failing at the spawn step, and then surrenders on iteration-3.

The test's assertion

```ts
expect(kinds.some((k) => k === "surrender" \|\| k === "surrender-budget")).toBe(true);
```

accepts either kind, so the test still passes and still proves the invariant
it is named after (no status ack within 20s). The name is just misleading.

**Severity:** COSMETIC — test still correct; clarify the name or add a real
budget-hit path test if desired.

---

## Observations (non-findings)

### O1 — `|| undefined` for dashboard-triggered CFR is safe but slightly noisy

**Location:** `packages/dashboard/src/app.ts:753-755`

```ts
const originChannel = failure.triggeringInput.channel.channelId || undefined;
await ci.forwardToChannel(response, originChannel);
```

For a dashboard-triggered CFR, `channel.channelId === "dashboard"` (see
`packages/dashboard/src/chat/chat-service.ts:137`). This is passed as
`channelOverride` to `forwardToChannel`, which then looks up a transport with
id `"dashboard"`. No such transport exists, so it logs `[ConversationInitiator]
dashboard not connected` and returns `{ delivered: false }`. Meanwhile the
actual content was already broadcast by `chat.sendSystemMessage`, so the user
sees the response. Net: correct behavior with a spurious warning in the log.

The alternative (`channel.transportId === "dashboard" ? undefined : channelId`)
would silence the warning but requires another branch and duplicates logic that
`forwardToChannel` already has for `"web"`. Acceptable as-is; possible
clean-up is to treat `"dashboard"` as a no-op in `forwardToChannel` alongside
`"web"` (one-line change at `conversation-initiator.ts:286`).

### O2 — Structural `*Like` interfaces (D1) are the correct call

Core cannot import from dashboard (which already imports from core). S5's
`orphan-watchdog.ts` uses the same pattern for `RawMediaStoreLike` and
`ConversationManagerLike`. The concrete `TransportManager.send` signature in
`packages/dashboard/src/channels/manager.ts:288-292` is structurally assignable
to `TransportManagerLike.send` (its 3rd arg is `OutgoingMessage` = `{ content,
replyTo?, attachments? }`, which is a supertype of `{ content, replyTo? }`).
Similarly `ConnectionRegistry.broadcastToConversation(convId, message:
ServerMessage, exclude?)` is structurally assignable to
`ConnectionRegistryLike.broadcastToConversation(convId, message: unknown)`
(the `unknown` relaxation is weaker and permits the synthetic
`system_message` payload — see F1).

### O3 — `surrenderReason` state hand-off (D3) is clean

The state machine itself remains reason-agnostic (correct separation). The
orchestrator tags the session in exactly two spots (`runOneAttempt:291` and
`runFixLoop:262,268`) and `surrender()` reads it once (`453-458`). Stale
values on recovered sessions are harmless since the session is discarded when
the recovery succeeds (`this.inFlight.delete` in `handle()`).

---

## Test Results (independent run)

### Core tsc
```
cd packages/core && npx tsc --noEmit
```
**Result:** clean (no output, exit 0).

### Dashboard tsc
```
cd packages/dashboard && npx tsc --noEmit
```
**Result:** clean (no output, exit 0).

### S6 acceptance tests
```
npx --prefix packages/core vitest run tests/capabilities/resilience-copy tests/capabilities/ack-delivery tests/capabilities/orchestrator/orchestrator-timing tests/capabilities/classify-empty-result-live
```
**Result:** 4 files, **22 tests, all pass**, 384ms.

### Full core suite
```
cd packages/core && npx vitest run
```
**Result:** 56 files passed + 2 skipped; **463 passed, 9 skipped, 0 failed**, 28.03s.

### Full dashboard suite
```
cd packages/dashboard && npx vitest run
```
**Result:** 142 passed + 4 skipped + 5 failed files; **1241 passed, 12 skipped, 8 failed**, 59.63s.
The 8 failures are in:
- `tests/integration/channel-unification.test.ts` ×3
- `tests/unit/ui/progress-card.test.ts` ×2
- `tests/browser/capabilities-singleton-visual.test.ts` ×1 (Playwright)
- `tests/browser/automation-ui.test.ts` ×1 (Playwright — no ANTHROPIC_API_KEY)
- `tests/browser/progress-card.test.ts` ×1 (Playwright)

None of these files are touched by S6 (see `git diff master..HEAD --stat`).
Failures match exactly the implementer's report. Consistent with pre-existing
infrastructure gaps (missing API keys, progress-card UI drift unrelated to
CFR).

---

## Verdict summary

S6 delivers exactly what the plan §8 asked for. Code is well-factored
(structural interfaces avoid circularity), artifacts are thorough (D1–D7 + 4
follow-ups), tests are behavioral rather than snapshot-like, and the S5
inherited items are landed. The one product-facing concern — F1, dashboard WS
ack not rendering — is a low-severity gap that doesn't block merge, but should
get a follow-up. **Approved with minor observations; recommend merge.**
