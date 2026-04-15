# S5 Architect Review — Orphaned-Turn Watchdog

**Reviewer:** The architect
**Branch:** `sprint/m9.6-s5-orphaned-turn-watchdog`
**Review date:** 2026-04-15
**Plan reviewed against:** [`plan.md`](plan.md) §7

---

## Verdict: **APPROVED with one must-fix before merge**

S5 delivers the orphan-watchdog end-to-end. Structural interface types avoid the core→dashboard cycle (D1), marker-before-inject preserves at-most-once idempotence (D2), forward-compat stub for surrender markers (F2 fix) lets S6 drop its events into a wired listener. Abbreviation queue correctly substitutes `turn_corrected` content. 9 tests pass across `orphan-watchdog-*` and `abbreviation-honors-correction`, both packages compile clean.

External reviewer caught F1 (`watchdog_rescue_completed` missing), F2 (surrender-marker check missing), F3 (plan path drift) — all fixed in-branch via `a9e939b`. Clean flow.

I found one routing correctness issue that S5 owns and should fix on this branch, plus one inherited routing issue (same bug in S4's `reprocessTurn`) that I'll file forward to S6.

---

## Plan ↔ code audit (independent)

| Plan item | Location | Status |
|-----------|----------|--------|
| §7.1 `OrphanWatchdog` + `OrphanWatchdogConfig` + `OrphanSweepReport` | `packages/core/src/conversations/orphan-watchdog.ts:131-163, 227-465` | Matches. `reverify?` added as optional (D6) — correct graceful-degrade for non-audio / unhatched paths. |
| §7.1 Marker-before-inject idempotence | `:346-350` (rescued) before `:360` (inject) | At-most-once preserved. Plan's red-team scenario (crash during rescue → next boot loops) is blocked. |
| §7.1 `watchdog_rescue_completed` companion event | `:366-370` (after F1 fix) | Present in both the type (`WatchdogRescueCompletedLike`) and the code path. Distinct observability: `rescued` without `completed` = crashed mid-inject. |
| §7.1 Skip if already marked (idempotence) | `:288` (`hasWatchdogEventFor`) | Scans for `watchdog_rescued` or `watchdog_resolved_stale`. Correct. |
| §7.1 Stale threshold (default 30 min) → `watchdog_resolved_stale` event | `:313-326` | Correct. Age computed from user turn timestamp. |
| §7.2 `WatchdogRescuedEvent` + `WatchdogResolvedStaleEvent` type declarations | `packages/dashboard/src/conversations/types.ts:200-216`, re-exported from `transcript.ts:20-24` | Matches (via D4). Deviation is justified — `transcript.ts → types.ts` already exists, the plan's literal placement would have created a cycle. |
| §7.3 Abbreviation queue honors `turn_corrected` | `packages/dashboard/src/conversations/abbreviation.ts:147-179` | Correct. Builds `turnNumber → correctedContent` map, substitutes for `role === "user"` only. Last correction wins. |
| §7.4 Watchdog wired in `app.ts` after boot | `packages/dashboard/src/app.ts:931-986` | Matches (via D5). Placed after `ConversationInitiator` for dependency reasons — still boot-time, still once-only. |
| §7.4 10s cap via `Promise.race` | `app.ts:970-985` | Boot never blocks on a slow sweep; timeout logs a WARN. |
| §7.5 `orphan-rescue.md` template | `packages/core/src/prompts/orphan-rescue.md` | Present, plus inline fallback (D3) for dist/ runtime. Byte-identical content. |
| Acceptance: `orphan-watchdog-basic.test.ts` (3 cases) | `packages/core/tests/conversations/orphan-watchdog-basic.test.ts` | 3/3 pass. Fresh + stale + already-answered all covered. |
| Acceptance: `orphan-watchdog-idempotence.test.ts` (2 cases) | same dir | 2/2 pass. Second run after rescue → `injectCount === 1`. |
| Acceptance: `orphan-watchdog-audio-rescue.test.ts` (2 cases) | same dir | 2/2 pass. Covers reverify success + missing-raw-media degrade. |
| Acceptance: `abbreviation-honors-correction.test.ts` (2 cases) | `packages/dashboard/tests/conversations/abbreviation-honors-correction.test.ts` | 2/2 pass. Asserts the substitution path directly. |

Independent verification:
- `npx tsc --noEmit` in both packages — clean.
- Tests: 7 core + 2 dashboard = 9, all pass.
- No S1-S4 regressions introduced (file set is disjoint from prior sprints).

---

## Assessment of decisions

- **D1 (structural interfaces):** Right call. Core cannot import dashboard without a cycle. `*Like` interfaces keep the watchdog portable.
- **D2 (marker before inject):** Literal compliance with plan §7.1. The right tradeoff per the red-team finding #10.
- **D3 (inline prompt fallback):** Justified — the prompts directory isn't in the tsc output. Dual representation stays byte-identical; low drift risk.
- **D4 (types in `types.ts`, re-exported from `transcript.ts`):** Correct, matches the codebase's existing import topology.
- **D5 (wired after `ConversationInitiator`):** My plan §7.4 assumed ordering that didn't hold. D5's placement is still boot-time + once-only + 10s capped, which is what the plan's intent required.
- **D6 (`reverify?` optional):** Enables graceful degrade for non-audio orphans and unhatched agents. Audio rescue only engages where it can actually run.

All six are sound.

---

## Must-fix before merge

### C1: Orphan rescue response is routed to the preferred outbound channel, not the conversation's original channel

**Evidence:** `packages/dashboard/src/app.ts:963-965` — after the rescue prompt produces an assistant response:
```typescript
if (response) {
  const ci = app.conversationInitiator;
  if (ci) await ci.forwardToChannel(response);
}
```

`ConversationInitiator.forwardToChannel(content, channelOverride?)` at `conversation-initiator.ts:281-289` uses `getOutboundChannel()` when `channelOverride` is absent. `getOutboundChannel()` returns the user's preference from `config.yaml`.

**Why this breaks routing:** The memory note `project_routing_rule` — and M10-S0's design — say *"conversation replies stay on the conversation's channel; channels are transport, not identity."* An orphan rescue is a reply to a specific user turn on a specific channel. If the user sent voice on WhatsApp and the preferred outbound is `"web"` (or a different channel), the rescue response won't reach them on WhatsApp. Silence class persists.

**Concrete scenario:**
1. Voice #1 on WhatsApp goes unanswered (brain killed mid-stream).
2. Dashboard restarts. Watchdog sweep fires.
3. Rescue prompt injected, brain generates response ("you asked X — here's Y").
4. `ci.forwardToChannel(response)` → routed to `preferred outbound channel = "web"`.
5. Response shows in dashboard. WhatsApp user hears nothing.

**Fix:** look up the last user turn's channel and pass as `channelOverride`:

```typescript
systemMessageInjector: async (convId, prompt) => {
  const conv = await app.conversationManager.get(convId);
  const nextTurn = (conv?.turnCount ?? 0) + 1;
  let response = "";
  for await (const event of app.chat.sendSystemMessage(convId, prompt, nextTurn)) {
    if (event.type === "text_delta" && event.text) response += event.text;
  }
  if (response) {
    const ci = app.conversationInitiator;
    const lastUser = app.conversationManager.getLastUserTurn(convId);  // exists per transcript.ts:212
    if (ci) await ci.forwardToChannel(response, lastUser?.channel);
  }
}
```

`getLastUserTurn()` exists already in `TranscriptManager`; wire it through `ConversationManager` if it isn't exposed there (it's used in other routing paths, so likely is).

Add a test: orphan user turn on `channel: "whatsapp"` with preferred outbound `"web"` → assert `forwardToChannel` is called with `"whatsapp"` as the second arg, not default.

**Severity:** Major. The entire point of M9.6 is closing silence paths. This one stays open if the user's preferred channel differs from the conversation's channel, which is the normal WhatsApp-user-with-dashboard-open case.

---

## Forward-looking follow-up

### FU6 (carried from S4): `reprocessTurn` has the same routing bug

**Evidence:** `app.ts:610-627` — `reprocessTurn` also calls `ci.forwardToChannel(response)` without `channelOverride`. I missed this in the S4 review. `CapabilityFailure.triggeringInput.channel.channelId` is available and should be passed in.

**Why defer to S6:** S4 is merged. The plan §0.4 says "do not fix while you're there" for out-of-sprint bugs. S6 is the messaging sprint — it was already planning to touch these delivery paths (§8.2 `AckDelivery` uses `TriggeringInput.channel` explicitly). Bundling the `reprocessTurn` fix with S6's `AckDelivery` work is natural.

**Action:** add to `s5-FOLLOW-UPS.md` as FU4 (after the three already there), cross-referenced from S6's plan scope.

---

## Other observations (no action)

- **F2 forward-compat (`hasSurrenderEventFor`):** nicely done. The stub is literal "always false" and the function shape matches what S6 will need. S6 just has to start emitting the event and the watchdog ingests it automatically. This is how forward compatibility should look.
- **F4 (review): `findOrphanedUserTurn` uses `>=` for answered detection.** I agree with the reviewer — the lenient check is the right bias for a rescue scanner. A later assistant turn with higher turnNumber would imply the earlier user turn was superseded.
- **F5 (review): attachmentId match between RawMediaStore and channel layer not verified.** FU1 captures this. S7 will exercise end-to-end. The graceful-degrade on mismatch (skip audio rescue, still do text rescue) is the right failsafe.
- **Injector-throws path untested.** The reviewer flagged this — `orphan-watchdog.ts:375-388` catches injector errors and writes to `corruptSkipped`. No test covers this path. Low priority, defer to test-debt follow-up.
- **`hasSurrenderEventFor` is O(n) per turn.** Fine for N=5 conversation limit and small transcripts. If watchdog scope expands later, consider indexing events on read.

---

## Paper trail

- `s5-DECISIONS.md` — six decisions with rationale, impact, and blast-radius each. D5's dependency-ordering explanation is good.
- `s5-DEVIATIONS.md` — two self-answered (D4, D5). No CTO-escalation. Correct.
- `s5-FOLLOW-UPS.md` — three items. FU3 (pre-existing channel-unification test gap) correctly attributed to earlier sprints.
- `s5-review.md` — strong external review. All five findings meaningful.
- `s5-test-report.md` — present (verified in reviewer's commands).

Commit hygiene: 8 sprint commits (after the scaffold commit), conventional-style, no `--amend`, no `--no-verify`. Fix commit `a9e939b` cleanly addresses the three review findings.

---

## Process note — fourth sprint, putting the rule deeper

### P1: Roadmap-done bundled into an earlier commit, not the last one

Commit `a684719 docs(m9.6-s5): sprint artifacts — DECISIONS, DEVIATIONS, FOLLOW-UPS + roadmap update` includes the roadmap-done change mid-stream, with test and fix commits on top. The plan §0.3 rule 9 I added after S4 says: *"The roadmap-done commit is the LAST commit on the sprint branch, landed AFTER the architect-review commit."*

**Partial compliance.** The tip of the branch is the fix commit (`a9e939b`), not a "roadmap done" commit — better than S2 and S4's tip-commit roadmap slips. But the roadmap-done diff is already on the branch before architect review.

For S6 onwards: the roadmap edit is a **separate** commit, LAST, after architect review. Not bundled with artifacts. If S5 had been rejected, commit `a684719` would need an awkward partial-revert. The rule exists precisely to avoid that.

Not blocking merge. Flagging for continued process discipline.

---

## What to do next

1. **Implementer:** C1 fix — extend the orphan-watchdog injector in `app.ts:946-967` to pass the last user turn's channel to `forwardToChannel`. Add a test with a WhatsApp orphan + `"web"` preferred outbound that asserts the override is used. Commit: `fix(m9.6-s5): route orphan rescue to original channel, not preferred outbound`.
2. **Implementer:** add FU4 to `s5-FOLLOW-UPS.md` — `reprocessTurn` has the same bug; defer to S6.
3. **Architect (me):** re-review C1 fix when pushed. If clean, approve merge.
4. **After merge:** S6 (user-facing messaging + capability confidence contract) in a fresh Sonnet session. Plan §8. S6 will:
   - Replace the `emitAck` stub with `AckDelivery` that already correctly uses `TriggeringInput.channel`.
   - Fix the `reprocessTurn` channel override per FU4.
   - Extend the capability contract with `confidence` and `duration_ms`.

---

**Approved pending C1. Ping when the channel-override fix lands.**
