---
sprint: M9.6-S14
title: Friendly names + multi-instance + per-type fallback copy — architect review
architect: Opus 4.7 (Phase 2 architect)
review_date: 2026-04-18
verdict: APPROVED
---

# S14 Architect Review

**Sprint:** M9.6-S14 — Friendly names + multi-instance disambiguation + per-type fallback copy + FU-4 invoker named-instance
**Branch:** `sprint/m9.6-s14-friendly-names`
**Implementer commits:** 10 commits (per-task feat/test/docs + 2 fixes addressing external auditor's findings)
**External auditor:** dev-contracted, `recommended: APPROVE WITH NOTES` (1 important + 1 suggestion); both fixed before notifying CTO
**Reviewed:** 2026-04-18
**Verdict:** **APPROVED.** All 4 architect gaps (G1–G4) addressed; external auditor findings fixed; spec coverage 100%; process discipline clean.

---

## 1. Sprint goal vs. delivered

**Goal (per `plan-phase2-coverage.md` §2.6):** every CFR ack uses friendly names + multi-instance disambiguation + per-type fallback action sourced from frontmatter via registry-injected factory; FU-4 named-instance selection on `CapabilityInvoker`.

**Delivered:** matches goal. `createResilienceCopy(registry)` factory, `CapabilityRegistry.{isMultiInstance, getFallbackAction}` helpers, scanner reads new frontmatter fields, `app.resilienceCopy` always-non-null at boot, `terminalAck` per type, `capabilityName?` on `InvokeOptions` for FU-4 named-instance selection. Two real bugs caught and fixed in-flight (D5: surrender-cooldown routing; D6: terminal-fixed AckKind silently routed to budget-surrender copy).

---

## 2. Independent verification gates

| Check | Result |
|---|---|
| Core typecheck | exit 0 |
| Dashboard typecheck | exit 0 |
| S14 acceptance suites (6 files, 58 tests) | 58/58 PASS |
| Full capabilities regression (per dev report: 43 files, 292 tests) | 290 PASS / 2 skipped (pre-existing) |
| Issue 1 fix (`isTerminalKind` includes `"terminal-fixed"`) | confirmed at `ack-delivery.ts:127` |
| Issue 2 fix (raw-type non-match assertion scoped to FRIENDLY_NAMES types) | commit `8759141` |

External auditor reproduced same results. No discrepancies.

---

## 3. Architect gaps G1–G4 — all addressed

| Gap | Resolution | Verification |
|---|---|---|
| **G1** dynamic universal-coverage gate | `resilience-messages-coverage.test.ts` calls `scanCapabilities(myAgentCapabilitiesDir, envPath)` and iterates the actual `.my_agent/capabilities/` scan results; static Layer 1 (`REGISTERED_TYPES` array) kept as the explicit-cases gate | Confirmed at test:64-68; test report shows "Dynamic scan ran: browser-chrome scanned and passed" |
| **G2** `getFallbackAction` semantic decision | D7 documents: first-wins is intentional (type-level property; instances of the same type should agree; divergence is an authoring error, load-order resolves) | Recorded in `s14-DECISIONS.md` D7 |
| **G3** plug-level override of template-level | D7 explicitly covers: "plug-level `fallback_action` declared in a specific CAPABILITY.md takes precedence over the template default" | Same D7 |
| **G4** `app.resilienceCopy` boot-order | **Better than asked:** field is initialized to `createResilienceCopy(new CapabilityRegistry())` at construction (always non-null), then re-assigned at boot. No fallback path needed in `emitAck`. Documented in D1 | Confirmed at `app.ts:465` |

G4's resolution is cleaner than my recommendation — eliminating the fallback entirely is better than a `console.warn` masking a real bug.

---

## 4. Spec coverage

Every design feature from `plan-phase2-coverage.md §2.6` mapped to implementation:

| Feature | Implementation |
|---|---|
| `createResilienceCopy(registry)` factory | `resilience-messages.ts` — D1 |
| `FRIENDLY_NAMES` for every registered type | 6 entries (audio-to-text / image-to-text / text-to-audio / text-to-image / browser-control / desktop-control) |
| Multi-instance ack disambiguation (instance suffix) | `instanceSuffix(failure, registry)` — gates on `failure.capabilityName && registry.isMultiInstance(...)` |
| `surrender()` parameterized on friendlyName + suffix | confirmed; surrender-cooldown branch added (D5) |
| `terminalAck` per type | per-type switch with default fallback |
| `registry.isMultiInstance(type)` | + WELL_KNOWN_MULTI_INSTANCE safety net (D4) |
| `registry.getFallbackAction(type)` | + generic default for unregistered types |
| `fallback_action` + `multi_instance` frontmatter loader | scanner reads + propagates to Capability |
| `capabilityName?` on `InvokeOptions` (FU-4) | filter `listByProvides` results before enabled+available selection |
| Universal-coverage gate test | dynamic + static Layer 1, both green |
| FRIENDLY_NAMES → frontmatter migration deferred | FU-1 to S19/S20 |
| `terminal-fixed` AckKind handled in `emitAck` | branch added (D6 — was a real bug from S13 era) |
| `AckDelivery.writeAutomationRecovery` accepts `"terminal-fixed"` | DEV-1 widening; flows to CFR_RECOVERY.md `outcome:` field |

100% coverage.

---

## 5. Bugs caught + fixed in-flight (good signal)

The dev caught two real bugs while implementing the wiring:

- **D5 — `surrender-cooldown` routed to `iteration-3` copy.** `emitAck` switch was missing the cooldown branch; users hit by cooldown got "I tried three fixes and..." copy instead of the cooldown-specific message. Fixed.
- **D6 — `terminal-fixed` AckKind silently fell through to `budget-surrender` copy.** Wired in S13 but the switch was never updated. Fixed alongside D5.

Both are pre-existing bugs from S6/S13 surfaced by S14's emitAck refactor. The dev documented them as decisions (not deviations) and the fix is bundled with S14's intentional changes. Acceptable framing — these aren't scope creep, they're correctness fixes that the refactor exposed.

External auditor's Issue 1 (`isTerminalKind` missing `"terminal-fixed"`) is the same shape: a real bug from S13 era surfaced when S14's wiring touched the surrounding code. Fixed in `1a416e6`.

---

## 6. Process compliance

| Check | Result |
|---|---|
| All artifacts present (DECISIONS, DEVIATIONS, FOLLOW-UPS, test-report, review) | All 5 present |
| External auditor frontmatter correct | `verified-by: Senior Code Reviewer (claude-sonnet-4-6)` + appropriate framing in s14-review.md |
| No premature APPROVED commits in dev's commit log | Confirmed — `851fade` says "external reviewer — APPROVED WITH NOTES" which is the auditor's verdict, not the dev claiming architect approval |
| No roadmap-done commit | Confirmed — ROADMAP.md S14 row not yet marked Done |
| No `s14-architect-review.md` written by dev | Confirmed — this file is mine |
| §0.2 (detection at the gates) | Holds — no new emit sites; only registry/copy/invoker wiring |
| Issues from external auditor addressed before notifying CTO | Confirmed — both fixes in commits before the CTO notification |
| FU-4 deferred work landed | Yes — invoker `capabilityName?` parameter added with named-instance + nonexistent tests |

Cleanest sprint of Phase 2 alongside S12. The dev internalized the §0.3 process, used the auditor properly (caught real issues; addressed before architect review), and added their own bugfix discipline.

---

## 7. Observations (non-blocking)

1. **`isTerminalKind` does not include `"surrender-cooldown"`.** Cooldown is emitted before the fix loop spawns, so writing `CFR_RECOVERY.md` for it is debatable — the prior surrender already wrote one. Defensible either way; the dev's choice (exclude) avoids duplicate records. **Accept as-is.** If a future incident wants the cooldown event surfaced separately, revisit.

2. **Dynamic coverage scan uses `.my_agent/.env` not `packages/dashboard/.env`.** Test report flags this honestly: env-dependent plugs (e.g. `stt-deepgram` needing `DEEPGRAM_API_KEY`) would scan as `unavailable` during the test run. Practically harmless today (`browser-chrome` is the only installed plug with no env requirements), and the static Layer-1 gate covers the registered well-known types. **Accept; track as a soft FOLLOW-UP if S15 exit gate exposes it.**

3. **`s14-plan.md` is untracked (uncommitted) on the sprint branch.** Prior sprints (S11/S12/S13) committed their `s<N>-plan.md` to the branch. The dev created it locally but never `git add`ed it. Doesn't affect correctness — the plan informed implementation and is in the working tree — but breaks the audit trail. I'll commit it alongside this architect review so it lands via the merge.

---

## 8. Plan amendments (CTO deferral rule)

**No new amendments required.** S14 added two FOLLOW-UPS that map cleanly:

- **FU-1 (FRIENDLY_NAMES → frontmatter migration):** target S19/S20 — already Phase 3 territory; not in any sprint plan yet but it's a natural follow-on item that S19's "system-origin UI" sprint or a S20 cleanup pass can pick up. Will mention in Phase 3 architect handoff.
- **FU-2 (multi_instance frontmatter backfill for installed plugs):** target S15 (Phase 2 exit gate) — natural place since S15 verifies every installed plug works end-to-end. Adding it to S15 plan now.

---

## 9. Verdict

**APPROVED.** Sprint work is high-quality, complete, and disciplined. Two real bugs from prior sprints surfaced and fixed in-flight. Architect gaps G1–G4 all addressed (G4 better than asked). Process discipline matches S12's clean run.

S15 unblocked. Next sprint is the Phase 2 exit gate — incident-replay per installed plug type. Phase 2 closes there.

---

## 10. Merge guidance

Sprint branch ready to merge to master after this architect-review commit (which also commits the previously-untracked `s14-plan.md`). Recommended:

```bash
git merge --no-ff sprint/m9.6-s14-friendly-names
```

Roadmap-done commit lands AFTER merge per §0.3.

---

*Architect: Opus 4.7 (1M context), Phase 2 architect for M9.6 course-correct*
