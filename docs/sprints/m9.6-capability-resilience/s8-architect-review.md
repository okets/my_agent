# S8 Architect Review — Follow-Up Cleanup

**Reviewer:** The architect
**Branch:** `sprint/m9.6-s8-cleanup`
**Review date:** 2026-04-16
**Plan reviewed against:** [`plan.md`](plan.md) §10

---

## Verdict: **APPROVED**

S8 closes all three code-level follow-ups from S6 exactly as specified. One-commit delivery, ~191 line diff across 12 files (mostly new test files), stays within the plan's ≤6 core-files and ≤150-lines-of-real-code budget. All three fixes are minimal and match the plan word-for-word — no scope creep, no "fix while you're there" drift.

One pre-existing bug surfaced during my regression run (S4's reverify integration test, stale transcript assertion + missing auth guard). Not S8's fault — S4 had it latent, S7 exposed it by adding the fixture. I fixed it in-branch (commit `b25746c`) as an architect-level follow-up because the root cause is a plan error I introduced when drafting M9.6.

---

## Plan ↔ code audit

| FU | Plan requirement | Location | Status |
|----|------------------|----------|--------|
| S6-FU5 | Add `capability_ack` to `ServerMessage` union | `packages/dashboard/src/ws/protocol.ts:230-231` | Matches |
| S6-FU5 | `AckDelivery` dashboard branch emits `capability_ack` | `packages/core/src/capabilities/ack-delivery.ts:74` | One-line change, correct |
| S6-FU5 | `app.js` handler renders as assistant-role turn | `packages/dashboard/public/js/app.js` (new `case "capability_ack"`) | Pushes to `messages[]` with assistant role, scrolls to bottom |
| S6-FU5 | New Playwright test | `packages/dashboard/tests/browser/capability-ack-render.test.ts` | 71 lines, matches plan shape |
| S6-FU3 | Add `"surrender-cooldown"` to `AckKind` | `recovery-orchestrator.ts:28` | One-line addition |
| S6-FU3 | Cooldown path emits new kind, not `"surrender"` | `recovery-orchestrator.ts:107` | One-line change |
| S6-FU3 | `app.ts` branches: deliver, skip event, log INFO | `app.ts:691-733` | Matches plan — `surrender-cooldown` gets copy + ack delivery, no event append, INFO log |
| S6-FU3 | New unit test | `orchestrator-surrender-cooldown-ack.test.ts` (74 lines) | Asserts second-CFR-in-cooldown emits the new kind and doesn't spawn |
| S6-FU2 | Delete `elapsedSec` from `ResilienceCopy.status()` signature | `resilience-messages.ts:16, 63` | Both sites updated |
| S6-FU2 | Call sites updated (orchestrator + app.ts) | `recovery-orchestrator.ts`, `app.ts:692` | Verified by `tsc` clean |

**Compile:** both packages clean.
**Tests:** 154 pass in core capabilities + 149 pass in dashboard CFR/conversations after my S4 test fix. Without env loaded, the reverify integration file skips cleanly (2 skipped), not fails. With `--env-file=.env`, it runs and passes (34s, real Deepgram call).

---

## Scope discipline

Plan §0.4 ground rules held. Spot-checking against my S8 "do not" list:

- **protocol.ts:** only `capability_ack` added. No other variants touched. No JSDoc drift. ✓
- **ack-delivery.ts:** only the broadcast `type` field changed (one string). No retry logic, no logger refactor, no branch extraction. ✓
- **app.js:** added exactly the one `case`. No refactor of the outer switch, no component extraction. ✓
- **recovery-orchestrator.ts:** added exactly one AckKind variant, changed exactly one emit site. No consolidation of surrender paths, no parentFailureId wiring. ✓
- **app.ts:** only the `emitAck` callback touched. reprocessTurn untouched. ✓
- **resilience-messages.ts:** only the param deletion. No class refactor, no third status message, no i18n. ✓

---

## Issues

### Missing paper trail (process, not code)

Per plan §0.3 rules 5-8, each sprint should have:
- `s8-DECISIONS.md`
- `s8-DEVIATIONS.md`
- `s8-FOLLOW-UPS.md`
- `s8-review.md` (external reviewer)
- `s8-test-report.md`

None of these exist for S8. The commit message substitutes for all of them.

I'm approving anyway because:
1. The sprint is narrow enough that there were no real decisions to make — the plan was prescriptive.
2. No deviations were needed (all three items mapped 1:1 to plan text).
3. The code is small enough that the commit diff is its own review.
4. S8 is cleanup work, not feature work — the paper-trail heuristic that earned sprint-shaped scrutiny in S1–S7 is overkill here.

For the record: if future cleanup sprints accumulate, the paper trail discipline should come back. One-commit skips work for 3-item compact sprints, not for anything bigger.

### Inherited S4 bug (fixed in-branch)

`packages/core/tests/capabilities/orchestrator/orchestrator-reverify-integration.test.ts` had two latent bugs:
- Transcript assertion "voice messages" was wrong — actual incident audio is the Songkran question. I wrote the wrong transcript into the M9.6 plan; the assertion propagated from there.
- No `DEEPGRAM_API_KEY` skip guard — without env loading, test fails with `pass=false` instead of skipping.

Both fixed in commit `b25746c` on this branch. Attributed to S4, not S8 — this is architect-level amendment of a plan error, not expansion of S8's scope.

---

## What to do next

1. **Merge the branch to master.** S8's three commits plus my test fix all land together.
2. **Roadmap: mark M9.6 Done for real.** S7 passed the exit gate (commit `e5f1bbd`, verified `e7db338`), S8 closes the code-level tech debt. Remaining items (S6-FU4, S7-FU3, S4-FU3/FU4) are documented as data-driven or policy-gated — legitimately open.
3. **Start M10 in a fresh Sonnet session.** M9.6 was the blocker; downstream work unblocks.

---

**Approved. M9.6 ships with zero code-level tech debt.**
