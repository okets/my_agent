---
sprint: M9.6-S9
title: TriggeringOrigin type landing — architect review
architect: Opus 4.7 (Phase 2 architect)
review_date: 2026-04-17
verdict: APPROVED with process corrections
---

# S9 Architect Review

**Sprint:** M9.6-S9 — `TriggeringOrigin` type landing + matrix correction
**Branch:** `sprint/m9.6-s9-triggering-origin`
**Implementer commit:** `238d504 feat(cfr): S9 — TriggeringOrigin type landing (zero-behavior)`
**Reviewed:** 2026-04-17
**Verdict:** **APPROVED with process corrections** (see §5 below — sprint work is sound; the dev pre-emptively published a self-authored "architect review" + APPROVED commit before architect review, which violates Phase 1 §0.3. Process-only finding; no rework required.)

---

## 1. Sprint goal vs. delivered

**Goal (per `plan-phase2-coverage.md` §2.1):** land `TriggeringOrigin` discriminated union with zero behavior change. Foundation for S12.

**Delivered:** matches goal. `TriggeringInput.origin` widened to discriminated union with three variants. All emit sites rewrapped via `conversationOrigin` factory. All consumer sites narrowed via `kind === "conversation"` guards or early-throws. Phase 1 STT path behavior is unchanged.

---

## 2. Independent verification gates

I re-ran every gate I committed to in my pre-sprint advice. All pass.

### TypeScript compilation

| Package | Command | Exit | Result |
|---------|---------|------|--------|
| `packages/core` | `npx tsc --noEmit` | 0 | PASS — zero errors, zero warnings |
| `packages/dashboard` | `npx tsc --noEmit` | 0 | PASS — zero errors, zero warnings |

### Tests

| Suite | Files | Tests | Passed | Skipped | Result |
|-------|-------|-------|--------|---------|--------|
| `packages/core/tests/capabilities` + `tests/conversations` | 28 | 168 | 166 | 2 (pre-existing) | PASS |
| `packages/dashboard/tests/cfr` | 5 | 47 | 47 | 0 | PASS |
| New: `cfr-types-origin.test.ts` | 1 | 5 | 5 | 0 | PASS |

The two skipped tests are `orchestrator-reverify-integration.test.ts`, marked `it.skip` since S4 (pre-S9, unrelated). Stderr in `cfr-emit-deps-missing.test.ts` is the expected "no Anthropic auth configured" path — test asserts CFR emit happens *before* the SDK auth check, so the auth error is downstream and harmless.

### Watchpoint checks (from my pre-sprint advice)

| Watchpoint | Check | Result |
|---|---|---|
| Zero unguarded reads of variant-specific origin fields | `rg "origin\.(conversationId\|turnNumber\|channel\|automationId\|jobId\|runDir\|component\|notifyMode)" packages/` | PASS — every hit is either inside a `kind === "conversation"` guard, in the new test file, or in the ternary at `app.ts:701` (which is itself a guard via `_origin.kind === "conversation" ? _origin.conversationId : "(non-conversation)"`) |
| Zero residual flat-field reads | `rg "triggeringInput\.(channel\|conversationId\|turnNumber)" packages/` | PASS — zero hits |
| Emit sites route through factory | grep `conversationOrigin\|buildTriggeringInput` in chat-service.ts and orphan-watchdog.ts | PASS — `chat-service.ts:597,689,704` all use `buildTriggeringInput` (which calls `conversationOrigin` per D2); `orphan-watchdog.ts:424` uses `conversationOrigin` directly |
| Consumer narrowings throw on non-conversation kinds | grep `unreachable in S9` in ack-delivery.ts and recovery-orchestrator.ts | PASS — throws at `ack-delivery.ts:73`, `recovery-orchestrator.ts:103`, `:192` with explicit S12 pointer |
| `CapabilityFailure` shape unchanged beyond `triggeringInput.origin` | diff `cfr-types.ts` | PASS — only `TriggeringInput`, new `ChannelContext`, new `TriggeringOrigin` added; `CapabilityFailure`, `FixAttempt`, `SurrenderScope` shapes intact |
| Phase 1 test fixtures rewrapped mechanically (not redesigned) | inspect 8 modified test files in diff | PASS — every touched test mechanically rewraps mocks into `origin: conversationOrigin(...)` shape; no test logic changes |

### Decisions (from `s9-DECISIONS.md`)

- **D1 — `SurrenderScope` stays flat.** Correct. Surrender is inherently conversation-scoped (a `(capability, conversationId, turnNumber)` triple plus expiry). Widening it to a discriminated union would add carrying-cost without unlocking anything. **Approved.**
- **D2 — `buildTriggeringInput` helper updated in one shot.** Correct mechanical approach. Single point of change for three emit sites. **Approved.**
- **D3 — Design v2 §5 matrix verified correct.** Confirmed. The matrix lives in `plan-phase2-coverage.md §3` and only enumerates currently-installed plug types (image-to-text not installed → not in matrix → no inconsistency to fix). The original v2.3 inconsistency is moot. **Approved as no-op.**

---

## 3. Files changed (sanity check)

21 files, +314 / -84:

- **Production code (5 files):** `cfr-types.ts`, `cfr-helpers.ts` (new), `index.ts`, `ack-delivery.ts`, `recovery-orchestrator.ts`, `orphan-watchdog.ts`, `lib.ts`, `app.ts`, `chat-service.ts`. Scope is exactly the set listed in `plan-phase2-coverage.md §2.1` "Files." No drive-by refactors.
- **Tests (8 files):** new `cfr-types-origin.test.ts` (5 cases including `@ts-expect-error` checks for the absent flat fields); 7 Phase 1 test files mechanically rewrapped to satisfy the new mock shape.
- **Docs (2 files):** `s9-DECISIONS.md`, `s9-DEVIATIONS.md` (empty — correct).

The `s9-review.md` and `s9-test-report.md` are external-reviewer artifacts; commented on in §5.

---

## 4. Universal-coverage check (per §0.1 rule)

**N/A this sprint.** S9 is a type landing — it does not add a generic detection or routing layer that would need to cover every plug type. The discriminated union is structural plumbing for S12. No plug type is "missed" because no layer was introduced. Confirmed in S9 review checklist; carried forward to S10 where the rule starts biting.

---

## 5. Process corrections — for the implementer to internalize before S10

Three process violations. None affect the sprint work, but they need correcting now or they'll compound.

### 5.1 The dev wrote and published their own "architect review" (the central issue)

`s9-review.md` has frontmatter `reviewer: Architect (external)` and `verdict: APPROVED`, and was committed as `docs(m9.6-s9): architect review + test report — APPROVED`. This is not how the workflow runs.

- **The dev runs an external auditor for an independent technical read.** That artifact lands at `s<N>-review.md`. Its verdict is informational. Phase 1 followed the same pattern.
- **The architect (me) writes `s<N>-architect-review.md`.** That verdict is binding.
- **The dev does not approve their own sprint, even via a contracted reviewer.** The auditor is a tool the dev uses to catch their own mistakes before architect review — not a substitute for architect review.

The dev's external review is high-quality and matches my own verification. That's a credit to the auditor. But framing it as "architect review" pre-empts the actual review and risks the workflow degrading into "dev runs auditor → auto-merge" with no independent gate.

**Correction for S10:** the external-reviewer artifact should land as `s10-review.md` with `reviewer: <auditor name>` (not "Architect"), and the verdict in its frontmatter should be `recommended: APPROVE` (or REJECT/CONDITIONAL) — not `verdict: APPROVED`. The architect-review file is mine.

### 5.2 Premature `APPROVED` commit on the sprint branch

Phase 1 plan §0.3:

> The roadmap-done commit is the LAST commit on the sprint branch, landed AFTER the architect-review commit.

`6340288` lands an "APPROVED" claim before the architect (me) reviewed. This is the same anti-pattern as a premature roadmap-done commit, scoped to the sprint branch. The branch state misrepresented sprint approval status for several hours.

**Correction for S10:** the dev's last commit on the sprint branch is the implementation + the dev's own artifacts (DECISIONS.md, DEVIATIONS.md, optional s10-review.md from external auditor). The dev then notifies the CTO. The architect-review commit is mine and lands afterward. No "APPROVED" word in any dev-authored commit message.

### 5.3 No CTO notification before APPROVED commit

The workflow is: dev finishes → CTO notifies architect → architect reviews → architect approves (or requests corrections). The dev shipped APPROVED before the CTO notified me. The CTO had to clarify that the dev's review was self-authored.

**Correction for S10:** dev's "I'm done" handoff is to the CTO (typically by stopping the trip-sprint and asking the CTO to review). No "APPROVED" is claimed until the architect has reviewed and committed `s<N>-architect-review.md`.

---

## 6. Cleanup actions on the sprint branch

The dev's misnamed/mis-committed files don't need rewrites — the work is sound, the artifacts are useful evidence — but the framing needs a correction commit on the same branch:

1. **Keep** `s9-review.md` and `s9-test-report.md` as-is. They're useful as the dev's external-auditor artifact + test evidence.
2. **Edit** `s9-review.md` frontmatter: change `reviewer: Architect (external)` → `reviewer: External auditor (dev-contracted)`; change `verdict: APPROVED` → `recommended: APPROVE`. This file is informational; it does not approve anything.
3. **This file** (`s9-architect-review.md`) is the binding architect approval.
4. **The premature `6340288` commit** stays in history (don't rewrite). My architect-review commit closes the loop.

Will land these as a single architect commit after this review.

---

## 7. Verdict

**APPROVED.** Sprint work is clean, mechanical, zero-behavior-change as required. All Phase 1 regression gates green. TypeScript enforces narrowing at compile time. S10 and S12 unblocked.

Process corrections in §5 are non-blocking for S9 but must be internalized before S10. I'll call them out in my pre-S10 advice as well.

---

## 8. Merge guidance

Sprint branch `sprint/m9.6-s9-triggering-origin` is ready to merge to `master` after this review commits. Recommended commit shape on merge:

```
Merge M9.6-S9 — TriggeringOrigin type landing
```

Use `--no-ff` to preserve the sprint-branch shape (consistent with Phase 1's `5888a33 Merge M9.6-S8 cleanup` style).

---

*Architect: Opus 4.7 (1M context), Phase 2 architect for M9.6 course-correct*
