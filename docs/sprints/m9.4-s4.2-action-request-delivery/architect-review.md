---
sprint: M9.4-S4.2
auditor: architect (Claude — same context as plan author)
date: 2026-04-27
verdict: APPROVE
gate: 7-day live soak (Task 16) remains open and load-bearing
---

# Architect Review — M9.4-S4.2 Implementation

## Method

Independent walk of the executed branch `sprint/m9.4-s4.2-action-request-delivery` against the plan v3 (which folded both `audit.md` and `dead-code-audit.md`). Verifications run from `/home/nina/my_agent-s4.2`:

- TypeScript: `npx tsc --noEmit` → exit 0
- Unit sample: 5 S4.2-specific test files (28 tests) → all PASS
- Integration: `proactive-delivery-aged-conversation.test.ts` → 2/2 PASS
- Static checks: grep verification on every claimed deletion + every claimed addition

The dev's external reviewer report (`review.md`) found 4 gaps and the dev addressed G1 in commit `dde82a3`. This audit independently re-verifies that closure plus everything the external reviewer signed off on.

---

## Design Conformance

### 1. Trigger conversion (the load-bearing change)

| Site | Plan said | Code says | Status |
|---|---|---|---|
| `injectActionRequest` exists | bare `streamMessage(prompt)` no wrap | `session-manager.ts:904-906` does exactly this | ✅ |
| `injectSystemTurn` retained | only for genuine system events | `session-manager.ts:886-888` unchanged; docstring (relocated) explains | ✅ |
| `sendActionRequest` chat path | mirrors `send-system-message.ts` shape | `chat/send-action-request.ts` (107 lines, parallel structure) | ✅ |
| ChatServiceLike interface | both methods declared | `conversation-initiator.ts:32, 38` | ✅ |
| Chat-service registration | both sender methods wired | `chat-service.ts:1022, 1043` | ✅ |
| `alert()` web path | flag-gated routing | `conversation-initiator.ts:157-159` | ✅ |
| `alert()` same-channel path | flag-gated routing | `conversation-initiator.ts:213-215` | ✅ |
| `initiate()` path | flag-gated routing | `conversation-initiator.ts:286-288` | ✅ |
| `formatNotification.job_completed` | action-request prompt | `heartbeat-service.ts:382-394` | ✅ |
| `[Pending Briefing]` → `[Pending Deliveries]` | renamed + reframed | `system-prompt-builder.ts:158-167` | ✅ |
| `run_dir` field on `PersistentNotification` | added | `notifications/persistent-queue.ts:28` | ✅ |
| `run_dir` populated at enqueue | both sites | `app.ts:2038`, `automation-processor.ts:283` | ✅ |
| MockSessionManager parallel mock | `injectActionRequest` + `lastInjectionKind` | `tests/integration/mock-session.ts:76, 100-110` | ✅ |

### 2. All `[SYSTEM:]` pre-wrap sites collapsed

Plan promised 4 sites; external reviewer found 2 more (G1); dev fixed in `dde82a3`. Independent re-verification:

```
$ grep -rn '\[SYSTEM:' packages/dashboard/src --include="*.ts" | grep -v '^.*\.md\|comment'
session-manager.ts:887   yield* this.streamMessage(`[SYSTEM: ${prompt}]`);   ← inside injectSystemTurn (correct, only remaining wrap site)
```

All four originally-named sites (`conversation-initiator.ts:184/255`, `heartbeat-service.ts:313`, `automation-processor.ts:306`, `app.ts:726`) and both G1 sites (`automation-scheduler.ts:329`, `routes/debug.ts:752, 761`) verified bare. **Zero stray pre-wraps in production code paths.**

### 3. Dead-code findings actioned

| Finding | Action plan | Verified |
|---|---|---|
| Top-1 — `pendingNotifications` queue | DELETE entirely | ✅ Zero matches in `packages/dashboard/src` (regression test at `no-system-prepend-from-queue.test.ts`) |
| Top-2 (#2 in dead-code audit) — `verbatimFraming` constant | DELETE | ✅ Zero matches in `src/` |
| Top-2 — "Background work results" template | DELETE | ✅ Zero matches |
| Top-2 — `console.log("VERBATIM framing")` | DELETE | ✅ Test asserts the log line is gone |
| Top-3 — `[Pending Briefing]` literal | RENAME everywhere | ✅ src + 5 test assertions updated |
| Top-4 — `if (!alerted)` historical commentary | DELETE | ✅ Zero matches in `src/` |
| Top-5 — Orphaned docstring at `session-manager.ts:889-897` | RELOCATE above `injectSystemTurn` | ✅ Now at `:872-885` immediately above `injectSystemTurn:886` |
| Top-6 — Archive ~26 disabled CFR-fix + 3 build-* | move to `_archive/` | ✅ 58 files in `_archive/`; zero live `cfr-fix-*` or `build-*-capability*` |

### 4. Audit findings (`audit.md`) actioned

| Concern | Action | Verified |
|---|---|---|
| Critical-1 — `pendingNotifications` queue framing | deleted (above) | ✅ |
| Critical-2 — Standing-orders cache invalidation | service restart documented (D2); `invalidateCache()` exposed publicly | ✅ |
| Critical-3 — Task 8 fictional API + wrong constants | uses `manifest.system` at three real sites; helper `defaultNotifyFor()` at `automation-manager.ts:25-27` | ✅ |
| Concern-5 — Tasks 4+5+6 must land atomically | landed in single commit `d1cb289` | ✅ |
| Concern-6 — AppHarness fictional methods | extended with real methods; integration test passes | ✅ |
| Concern-9 — feature flag for rollback | implemented, routing-only per D3 | ✅ |
| Concern-12 — CLAUDE.md drift | rewritten in `0d4dc8b`; dead `if (!alerted)` example removed | ✅ |
| SDK pre-flight — verify user-role assumption | D1 records type-decl-based verification with citations | ✅ |

### 5. Standing-orders + Voice rule

`~/my_agent/.my_agent/notebook/reference/standing-orders.md`:
- ✅ `## Brief Requirements` block deleted (was lines 38-46)
- ✅ `## Conversation Voice` section added (lines 38-54), with four behavioral rules and concrete bad/good examples drawn from the actual 2026-04-25–27 incident
- ✅ Service restart documented in DECISIONS.md D2 (cache invalidation requirement)

---

## Test Quality

### Load-bearing tests (not tautological)

- `inject-action-request.test.ts` (3) — asserts `streamMessage` is called with the prompt unwrapped, distinct from `injectSystemTurn`'s wrap. Direct contract test.
- `no-system-prepend-from-queue.test.ts` (3) — asserts `queueNotification`, `hasPendingNotifications`, and `pendingNotifications` are undefined on the prototype. Catches accidental re-introduction.
- `heartbeat-action-request-prompt.test.ts` (7) — asserts no legacy strings ("Background work results", "forward verbatim"), no celebratory log, action verbs present (deliver/present/render), `run_dir` referenced when provided, fallback when absent doesn't produce `undefined/deliverable.md`.
- `feature-flag.test.ts` (6) — both flag states (default, "1", "true", "0") for both `alert()` and `initiate()`. Mocks the chat service and asserts which method was called.
- `deliverable-validator.test.ts` (8) — strong-opener rejections, two-marker rejection, false-positive guard ("I need to flag" accepted), clean-content acceptance.
- `automation-manager.test.ts` (3) — `system: true` defaults to `none`; `system: false` (or absent) defaults to `debrief`; explicit `notify` always wins.
- `summary-resolver.test.ts` — telemetry-distinguishing tests for "stripped" vs "no-heading-passthrough" paths.
- `proactive-delivery-aged-conversation.test.ts` (2) — 50-turn synthetic gravity; asserts `lastInjectionKind === "action_request"` and prompt does not match `/^\[SYSTEM:/`.

### Independent test run

```
TypeScript: clean (exit 0)
Sample (5 S4.2 unit test files): 28/28 PASS
Integration: 2/2 PASS
```

Matches the dev's reported numbers. No flakes observed.

---

## Concerns Found (Minor — Non-Blocking)

### M1 — Self-referential typo in test header comment

**File:** `tests/integration/status-prompt-acceptance.test.ts:7`
**Issue:** Comment says `"renamed from [Pending Deliveries] in M9.4-S4.2"` — should read `"renamed from [Pending Briefing] in M9.4-S4.2"`. Search-and-replace overshot.
**Severity:** Cosmetic. Test logic is correct.
**Fix:** One-character edit in a follow-up.

### M2 — Integration test 2nd case description ≠ implementation

**File:** `tests/integration/proactive-delivery-aged-conversation.test.ts:111-131`
**Issue:** The test's docstring claims it "exercises the conversation-initiator `alert()` path end-to-end through the chat-service mediator with a mocked session," but the test body just calls `harness.chat.sendActionRequest` directly — same as the first test, one layer too low. The actual `alert() → chatService.sendActionRequest → MockSessionManager.injectActionRequest` composition isn't exercised by any single test.
**Severity:** Low. Unit tests cover `alert()` with stubbed chat service (`conversation-initiator.test.ts`); the gap is "no integration-level end-to-end alert() test." Confidence is still high because each layer is unit-tested.
**Recommendation:** Either rewrite the second case to call `harness.conversationInitiator.alert()` (true end-to-end) OR adjust the docstring to match what's tested. Defer to a follow-up; not a merge blocker.

### M3 — "Render-don't-drop" tested at directive level only

**Test:** `heartbeat-action-request-prompt.test.ts` asserts the prompt text contains `voice` and `silently drop` markers. It does NOT verify the model would actually preserve sections — that's deferred to live soak.
**Severity:** None. The plan correctly defers behavioral verification to Task 16; the test confirms the prompt-level guard is in place.
**Note for soak:** Watch specifically for section drops on Day 3+ once gravity accumulates.

### M4 — `infra_alert` framing comment retains the word "verbatim"

**File:** `heartbeat-service.ts:402-404`
**Issue:** Comment says "Passed through verbatim …" — the word is correct here (describes pass-through, not a Nina-facing instruction), but a future reader scanning for residual S4-era language may flag it.
**Severity:** Cosmetic. Same as the external reviewer's G3.
**Fix:** Optional — could rephrase to "passed through unmodified" in a docs PR.

---

## Live Soak Gate (Task 16)

This is **the** load-bearing gate. The plan is correct to defer it post-merge and the dev is correct not to gate the PR on it.

Soak protocol per `test-report.md`:
- Day 1: 07:00 BKK morning brief + 08:00 BKK relocation session — observe both deliver as turns, no dismissal language, no tool narration, Nina returns to prior topic in next turn.
- Days 2–7: repeat each morning; conversation length grows naturally, gravity grows.
- On any morning fail: `PROACTIVE_DELIVERY_AS_ACTION_REQUEST=0` in `.env`, restart service, sprint stays open, file follow-up bug.
- After 7 clean days: sprint close. After 14 more: remove flag.

Both S4 and S4.1 PASSed verification gates and regressed in production within 5–15 days. The 7-day soak is the design's own honest acknowledgement of that pattern. Do not shorten it.

---

## Verdict

**APPROVE.**

The implementation faithfully executes plan v3. All 16 tasks delivered. Audit + dead-code findings all visibly folded in. Six pre-wrap sites collapsed (the planned four plus two G1 stragglers). Dead `pendingNotifications` queue fully deleted (verified zero callers). Obsolete prompt content deleted outright (not flag-gated, per dead-code audit recommendation). Standing-orders updated with concrete incident-derived examples. CLAUDE.md drift fixed including dead `if (!alerted)` example removal. Feature flag is correctly routing-only with both states tested.

Typecheck clean. Independent unit + integration test sample passes. Static greps confirm every claimed deletion.

**Concerns are cosmetic** (M1 typo, M2 test docstring mismatch, M3 directive-only assertion, M4 word "verbatim" in infra_alert comment). None block merge. M2 is the most worth tracking — could be tightened in a follow-up if the soak surfaces edge cases that an end-to-end alert() integration test would have caught.

**The 7-day live soak (Task 16) is the load-bearing acceptance gate** and remains open. Sprint can merge; sprint cannot close until soak passes. If any morning fails, flip the feature flag, file follow-up, re-plan.

Recommend merge.
