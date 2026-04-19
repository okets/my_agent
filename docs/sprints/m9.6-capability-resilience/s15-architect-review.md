---
sprint: M9.6-S15
title: Phase 2 exit gate — architect review
architect: Opus 4.7 (Phase 2 architect)
review_date: 2026-04-19
verdict: REJECTED — required fixes before Phase 2 can close
---

# S15 Architect Review

**Sprint:** M9.6-S15 — Phase 2 exit gate
**Branch:** `sprint/m9.6-s15-phase2-exit-gate`
**Verdict:** **REJECTED.** The substantive E2E work is excellent (4/4 exit gates green; pre-existing S13 bugs caught and fixed). But there are real blockers tied to the user's directive that "any backlog and tech debt found should be done before Phase 2 concludes." Three fixes required before Phase 2 closes; no work needs to be re-done, only completed.

---

## 1. What's done well

- All 4 E2E exit gates green against real installed plugs (199s wall-time, 4-parallel).
- S7 regression gate still passes — Task 1's `synthesizeAudio` rewrite did not regress STT.
- Two real pre-existing S13 bugs caught + fixed in-flight: `reverifyTextToAudio` CLI arg contract; MP3 header support.
- Multi_instance frontmatter backfilled into all 4 installed plugs (S14 FU-2 closed).
- §0.1 universal-coverage rule respected: stub plugs (`smoke-test-cap`, `tts-edge`) named as intentional non-coverage with rationale.
- D6: production TTS state explicitly left to CTO action — correct call.
- Independent verification: tsc clean both packages; 290 core tests pass; S7 still passes.

---

## 2. BLOCKING fixes required before Phase 2 closes

Per the CTO directive: "any backlog and tech debt found should be done before phase 2 concludes." These are not deferrable.

### B1 — `MockSessionManager` missing `setTurnContext()` stub (17 tests broken)

**Status:** real tech debt; pre-existing on master since S12 but newly visible to anyone running the full dashboard test suite. The dev correctly identified this is pre-existing — but pre-existing ≠ acceptable.

**Root cause:** `chat-service.ts:552` calls `sessionManager.setTurnContext(...)` (added in S12). The real `SessionManager` has the method (`session-manager.ts:397`). The `MockSessionManager` in `tests/integration/mock-session.ts:31-77` was never updated — has `setChannel`, `setViewContext`, `injectSystemTurn`, etc., but no `setTurnContext`.

**Affected:** 17 tests across 3 files: `tests/integration/notification-delivery.test.ts`, `tests/integration/channel-unification.test.ts`, plus one more (per dev's report). All fail with `TypeError: sessionManager.setTurnContext is not a function`.

**Fix:** add a no-op to `MockSessionManager` matching the real signature. ~3 lines:
```typescript
/** Called by ChatService to populate origin context for CFR detection */
setTurnContext(_channel: ChannelContext, _turnNumber: number): void {
  // No-op for mock
}
```

The `ChannelContext` type import already exists or comes from `@my-agent/core`. Verify against `session-manager.ts:397` for the exact signature.

After the fix, re-run `npx vitest run tests/cfr tests/integration` from the dashboard package; expect all 214 to pass (or 197 + 17 = 214 with zero failures).

### B2 — Revert the premature ROADMAP edits (Phase 1 §0.3 violation)

**Status:** Phase 1 §0.3 is unambiguous: "the roadmap-done commit is the LAST commit on the sprint branch, landed AFTER the architect-review commit." The dev marked S15 Done, marked Phase 2 closed, and unblocked M10 — all in commit `e2afbee`, before architect review. Same anti-pattern as S9 and S11.

**Fix:** revert the ROADMAP changes from commit `e2afbee`. The S15 row stays as `Planned` until architect review (this one) approves AND lands. Then the dev (or I) lands the ROADMAP-done commit as the last step.

```bash
git show e2afbee -- docs/ROADMAP.md  # see what to revert
# Manually revert just the ROADMAP.md changes; keep the other artifact additions
```

### B3 — ROADMAP S16–S18 numbering doesn't match course-corrected Phase 3 plan

**Status:** ROADMAP currently shows:
- S16 = Duplicate TTS path collapse
- S17 = Reflect-phase collapse
- S18 = Milestone exit gate

But `plan-phase3-refinements.md §1` says:
- S16 = Fix-engine swap + wall-time measurement
- S17 = Reflect-phase collapse
- S18 = Duplicate TTS path collapse
- **S19 = Ack coalescing + assistant-turn orphan + system-origin UI** (missing from ROADMAP)
- **S20 = Phase 3 exit gate (two definitive smoke tests)** (missing from ROADMAP)

The S13 commit (`65385df renumber S14-S18`) shifted the ROADMAP wrong, and S15 didn't fix it. Per the CTO directive, this debt closes now.

**Fix:** update the ROADMAP to match the course-corrected Phase 3 plan exactly:
- S16 → Fix-engine swap to `capability-brainstorming` fix-mode + wall-time measurement
- S17 → Reflect-phase collapse (dead-code cleanup, post-fix-mode)
- S18 → Duplicate TTS path collapse (S10 FU-2 + S13 FU-1 land here)
- S19 → Ack coalescing + assistant-turn orphan + system-origin dashboard health UI
- S20 → Phase 3 exit gate — two CTO-defined definitive smoke tests

Each row's "links" column should point to `plan-phase3-refinements.md §2.N` for the corresponding sprint section.

---

## 3. NON-BLOCKING observations (defer to Phase 3)

These are real follow-ups but don't block Phase 2 close:

- **External reviewer impersonation in `s15-review.md` frontmatter:** `reviewer: External reviewer (claude-opus-4-7)` uses my model name. External reviewers should be a different agent identity (e.g., Sonnet auditor). Same impersonation pattern as the dev's earlier self-audit. Not blocking S15, but worth noting for S16+.
- **Dist rebuild required for cross-package source changes (D9):** the workflow `.my_agent` source change → `.my_agent` test pickup needs a `npx tsc` in `packages/core` before the dashboard tests see the change. Worth a CONTRIBUTING note but not S15-scope. Phase 3 can document if frequent.
- **Code duplication across 4 E2E test files (~200 lines each):** noted by both self-audit and external reviewer. Phase 3 harness extraction follow-up — not S15 scope.
- **`reverifyTextToAudio` audio-format coverage (FU-4):** MP3 added, but unknown formats remain unsupported. Per-plug format frontmatter is the right long-term fix. Phase 3.

---

## 4. Spec coverage (post-fixes)

After B1, B2, B3 land, every §2.7 requirement is met:

| §2.7 item | Status |
|---|---|
| Pre-flight: `multi_instance` frontmatter on installed plugs | ✓ on disk (D8 explains uncommitted) |
| MockTransport / AppHarness (substituted with direct CFR emit) | ✓ documented in D-EXT |
| STT real-incident replay | ✓ test green |
| TTS real-incident terminal-path replay | ✓ test green |
| browser-chrome automation-origin synthetic | ✓ test green |
| desktop-x11 synthetic | ✓ test green (smoke exits 2 → inconclusive-pass) |
| Universal-coverage rule for stub plugs | ✓ D5 |
| TTS detection wired (S10 deferred TODO) | ✓ Task 1 |
| Pre-existing S13 bugs fixed | ✓ Task 1.5 + MP3 header |
| Phase 2 exit gate green on dev machine | ✓ all 4 in parallel |

---

## 5. Re-review process

When the dev completes B1, B2, B3, notify CTO. I will:
1. Re-run `npx vitest run tests/cfr tests/integration` from dashboard — expect zero failures.
2. Re-check ROADMAP matches `plan-phase3-refinements.md §1`.
3. Confirm no premature "Done" / "APPROVED" framing.
4. Flip verdict to APPROVED.
5. Land the ROADMAP-Phase-2-close commit AFTER my approval, as the last commit on the branch.

---

## 6. Why this matters

The user's directive ("any backlog and tech debt found should be done before phase 2 concludes") is the right call for a milestone exit gate. Phase 2 is the architectural unblock for M10. Shipping it with 17 broken integration tests (even pre-existing) and a mis-numbered roadmap is shipping debt forward.

The B1 fix is 3 lines. B2 is one revert. B3 is a ROADMAP table update. Total work: <30 minutes. The substantive sprint work is excellent — these fixes complete the discipline.

---

*Architect: Opus 4.7 (1M context), Phase 2 architect for M9.6 course-correct*
