# S6 Architect Review — User-Facing Messaging + Capability Confidence Contract

**Reviewer:** The architect
**Branch:** `sprint/m9.6-s6-user-facing-messaging`
**Review date:** 2026-04-16
**Plan reviewed against:** [`plan.md`](plan.md) §8

---

## Verdict: **APPROVED for merge**

S6 closes out the last feature sprint before S7's E2E gate. Copy strings match the plan verbatim. `AckDelivery` correctly routes to the triggering channel (WhatsApp → WhatsApp, dashboard → WS broadcast). The 20s status timer (D2) is a better design than the plan's per-attempt emit — time-based matches user perception, not internal iteration boundaries. `surrenderReason` tracking (D3) is clean. FU4 reprocessTurn routing fix from S5 landed correctly. `capability_surrender` event emission (D4) completes the S5 orphan-watchdog's forward-compat wiring. 22 new tests pass, 51 total across S4+S6 orchestrator scope, both packages compile clean.

One known gap: F1 (dashboard WS broadcast uses `{type: "system_message"}` which has no frontend handler — ack is silently dropped in-browser). Filed as FU5 by the implementer. I accept the deferral — WhatsApp is the M9.6 incident case, the S7 exit gate tests WhatsApp, and the dashboard gap is a post-milestone polish item. Not blocking merge.

---

## Plan ↔ code audit (independent)

| Plan item | Location | Status |
|-----------|----------|--------|
| §8.1 `ResilienceCopy` interface + `defaultCopy` | `resilience-messages.ts:14-74` | Byte-exact match. `ack` dispatches on `capabilityType` + `symptom`. `surrender` dispatches on `SurrenderReason`. `FRIENDLY_NAMES` table covers the four well-known types. |
| §8.2 `AckDelivery` class | `ack-delivery.ts:61-101` | Structural `*Like` interfaces (D1). Routes via `TransportManager.send` for channels, `ConnectionRegistry.broadcastToConversation` for dashboard. Errors caught + logged, never thrown. |
| §8.3 Template: `confidence` + `duration_ms` | `skills/capability-templates/audio-to-text.md:32-42` | Documented as "optional but recommended". Migration note present. |
| §8.4 `.my_agent/` untouched | (unchanged) | Correct. FU1 filed for CTO to update Deepgram script. |
| §8.5 `emitAck` stub replaced with real delivery | `app.ts:682-731` | Real `AckDelivery.deliver()` wired. Graceful fallback if TransportManager/ConnectionRegistry unavailable. `capability_surrender` event persisted on surrender kinds (D4). |
| §8.5 20s status timer | `recovery-orchestrator.ts:217-225` | Single `setTimeout(20_000)`, state-guarded, `.unref()`ed, cleared in `finally`. Better than per-attempt. |
| §8.6 `reverify` reads `confidence` + `duration_ms` | `reverify.ts:170-181` | `Number.isFinite` guard. Fields exposed on `ReverifyResult`. |
| FU4 (S5): reprocessTurn routing | `app.ts:748-756` | `failure.triggeringInput.channel.channelId \|\| undefined` as `channelOverride`. |
| D4: `capability_surrender` event | `app.ts:712-731` | Fires on both `surrender` and `surrender-budget`. `reason` field maps correctly. Event shape matches `CapabilitySurrenderEvent` in `types.ts:230-237`. Orphan watchdog's `hasSurrenderEventFor` now sees real events. |

Compile: both packages clean.
Tests: 51 passed, 2 skipped (D3 fixture). 22 new S6 tests. No regressions.

---

## Assessment of decisions

All seven are sound:

- **D1 (structural interfaces):** Correct, matches S5 pattern. Necessary to avoid core→dashboard cycle.
- **D2 (20s timer replaces per-attempt status):** Better than plan. Time-based matches UX intent; per-attempt would fire on fast-failing spawns that don't warrant user reassurance.
- **D3 (surrenderReason on session):** Clean. State machine stays reason-agnostic; reason tracked at orchestrator layer.
- **D4 (`capability_surrender` in emitAck callback):** Correct placement — dashboard concern stays in dashboard. Orphan watchdog's forward-compat check now has real data.
- **D5 (FU4 routing fix):** `channelId || undefined` is the right pattern — empty string falls back to preferred outbound, which is the web/dashboard no-op path.
- **D6 (confidence/duration_ms on ReverifyResult):** Conservative null-handling preserves backward compat with legacy scripts.
- **D7 (no per-deploy copy overrides):** Correct. Copy is a product decision, not configuration. Byte-exact test locking prevents drift.

---

## Known gap — accepted, not blocking

### F1 / FU5: Dashboard WS ack silently dropped

`AckDelivery` broadcasts `{type: "system_message"}` to the conversation's WS connections. `ServerMessage` union in `protocol.ts` has no `system_message` variant; `app.js` has no handler. Dashboard users see nothing.

**Why I accept the deferral:**
1. M9.6's incident was WhatsApp. The S7 exit gate tests WhatsApp. That path works.
2. Dashboard CFR is a low-probability scenario (deps-missing at dashboard would require AttachmentService to regress post-S2, which is now boot-wired).
3. The fix is bounded (~30 lines: add type to union, add client handler, render as system-turn) but touches frontend files outside S6's scope.
4. FU5 is filed, referenced by the external review. S7 or post-milestone.

---

## Observations (no action)

- **O1 (reviewer):** `reprocessTurn` with `channelId === "dashboard"` causes a spurious `"dashboard not connected"` warning from `forwardToChannel`. Harmless — the content was already broadcast by `sendSystemMessage`. Could be silenced by treating `"dashboard"` as a no-op alongside `"web"` in `conversation-initiator.ts:286`. Minor.
- **F2 (reviewer):** `orchestrator-timing.test.ts` third test is named "budget-hit path" but actually tests iteration-3 path. Cosmetic. Test assertion is correct.
- **FU2:** `elapsedSec` param unused in `defaultCopy.status`. Signature kept for future use. YAGNI but harmless.
- **FU3:** Cooldown-hit surrenders also emit `capability_surrender` events. Technically noisy but correct — the orphan watchdog should not re-drive a cooldown-hit turn.

---

## Paper trail

- `s6-DECISIONS.md` — 7 decisions, most thorough of any sprint this milestone. D2 (timer design) and D3 (surrenderReason) show good engineering judgment.
- `s6-DEVIATIONS.md` — no proposals. Correct — D1-D7 fell within the plan's guidance, and the single plan exclusion (§8.4 `.my_agent/` forbidden) was handled as documented.
- `s6-FOLLOW-UPS.md` — 5 items. FU1 (CTO update Deepgram script) is the critical one for activating `empty-result` detection. FU5 (dashboard ack gap) is the known product gap.
- `s6-review.md` — thorough external review with independent full-suite run. 8 pre-existing dashboard test failures confirmed unrelated to S6.

Commit hygiene: 10 commits, conventional-style. No `--amend`, no `--no-verify`. Process note: roadmap-done at tip — I've flagged this in every review since S2. Not blocking; moving on.

---

## What to do next

1. Merge S6 to master.
2. **S7 (E2E incident replay + exit gate)** in a fresh Sonnet session. Plan §9. This is the milestone's final sprint — it must prove the incident class is closed. The implementer should read: plan §9.1 (test sequence), §9.2 (zero-manual-intervention assertion), and the audio fixture approach from S4's D3.
3. **CTO action item from FU1:** update `scripts/transcribe.sh` in `.my_agent/capabilities/stt-deepgram/` to emit `confidence` and `duration_ms` from Deepgram Nova-2 output. Without this, `classifyEmptyStt` stays conservative and the `empty-result` CFR path never fires. The jq snippet is in FU1.

---

**Approved. Merge and proceed to S7.**
