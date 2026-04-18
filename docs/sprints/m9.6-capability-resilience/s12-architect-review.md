---
sprint: M9.6-S12
title: PostToolUseFailure CFR hook + automation-origin wiring — architect review
architect: Opus 4.7 (Phase 2 architect)
review_date: 2026-04-18
verdict: APPROVED
---

# S12 Architect Review

**Sprint:** M9.6-S12 — `PostToolUseFailure` CFR hook + automation-origin wiring
**Branch:** `sprint/m9.6-s12-mcp-cfr-detector`
**Implementer commits:** `b8f76cb` → `345e9dc` → `8c5cb63` → `f88d47d` → `bc48429` → `37a72b2` → `43c9545` → `a092c6c` → `250ee1b` (9 commits, one per task + a self-caught spec-gap fix + auditor artifact)
**External auditor:** dev-contracted, `recommended: APPROVE` with zero conditions, only minor observations
**Reviewed:** 2026-04-18
**Verdict:** **APPROVED.** Cleanest Phase 2 sprint to date. Zero corrections required.

---

## 1. Sprint goal vs. delivered

**Goal (per `plan-phase2-coverage.md` §2.4):** universal MCP-plug detection; automation-origin routing works end-to-end; S10 placeholder origin replaced with real session context.

**Delivered:** all of it. `McpCapabilityCfrDetector` ships with both entry points (hooks for Modes 1+2; `processSystemInit` for the spike-discovered Mode 3). `SessionContext` lifecycle is documented and implemented in both `SessionManager` and `AutomationExecutor`. The S10 placeholder is gone — `app.capabilityInvoker.originFactory` now reads from the live session registry. All five `unreachable in S9` throws are replaced. `CFR_RECOVERY.md` writer + reader pair land together. The N-aware `attachedOrigins` mutex coalescing works as specified.

---

## 2. Independent verification gates

| Check | Command | Result |
|---|---|---|
| Core typecheck | `cd packages/core && npx tsc --noEmit` | exit 0, zero errors |
| Dashboard typecheck | `cd packages/dashboard && npx tsc --noEmit` | exit 0, zero errors |
| S9 throws gone | `Grep "unreachable in S9" packages/` | zero matches |
| S12 core unit tests | 4 files, 44 tests | 44/44 PASS |
| S12 dashboard integration tests | 3 files, 17 tests | 17/17 PASS |
| Auditor's run reproduced | external reviewer ran same commands | identical results |

The dev's test report and the external auditor's reproduction match my own runs exactly. No discrepancies.

---

## 3. Spec coverage (every design feature mapped)

I cross-checked the dev's auditor-table against the design feature → task coverage map in the plan. Every row implemented, including the spike-driven scope expansion.

| Critical design feature | Source | Implementation |
|---|---|---|
| McpCapabilityCfrDetector hooks (Modes 1+2) | v2 §3.1 | `mcp-cfr-detector.ts:42-70` |
| `processSystemInit` (Mode 3) | spike, 2026-04-18 adjudication | `mcp-cfr-detector.ts:127-165`, idempotency via `initEmitted: Set<string>` |
| `classifyMcpToolError` | v2 §3.1 | `failure-symptoms.ts:44-50` (regex map covers `Connection closed` for spike Mode 2) |
| `registry.findByName` | v2 §3.1 | `registry.ts:209-211`, name-keyed independent of enabled/status |
| SessionContext + lifecycle (D1) | architect C2 | `cfr-types.ts:93-112` + populate-on-`session_init` + clear-in-`finally` in both gates |
| ChannelContext completeness (D3) | architect C1 + D3 | `chat-service.ts:552` threads full struct; fallback `sender: "user"` (better than S10's `"system"`; observation only) |
| S10 placeholder origin replaced (C1) | s10 audit C4 | `app.ts:540-559` reads from `sessionRegistry.getCurrentOrigin()` |
| Six-step terminal drain (Task 6b) | v2 §3.4 | `recovery-orchestrator.ts:542-660`, automation→conversation→system, per-origin try/catch |
| `attachedOrigins` N-aware coalescing | v2 §3.4 + D7 | `recovery-orchestrator.ts:145-154`, no second spawn, no duplicate ack — both mock-asserted |
| `CFR_RECOVERY.md` writer + schema (D5) | v2 §3.4 + architect C9 | `ack-delivery.ts:277-312`, written via `writeFrontmatter()`, schema matches D5 exactly |
| `debrief-prep` reader | v2 §3.4 | `debrief-prep.ts:91-135` + `runDir` threading at `handler-registry.ts:256` (the self-caught spec gap, fix `43c9545`) |
| Non-conversation surrender (Option A, D6) | architect C8 | `recovery-orchestrator.ts:234-251`, gates `recordSurrender` on conversation-kind |
| All 5 S9 `unreachable in S9` throws replaced (C7) | s9 review | `ack-delivery.ts`, `recovery-orchestrator.ts:103,192`, `app.ts:721,749` — zero hits per acceptance grep |

Auditor's full table in `s12-review.md` lists 13 rows, all implemented. My spot-check confirms.

---

## 4. Process compliance — first clean Phase 2 sprint

This is the first Phase 2 sprint that hits every §0.3 process rule cleanly:

- ✓ All required artifacts present: DECISIONS (D1–D7), DEVIATIONS (4 entries), FOLLOW-UPS, test-report, review, spike-results.
- ✓ External auditor frontmatter correct: `reviewer: External auditor (dev-contracted)`, `recommended: APPROVE`, NEVER `verdict: APPROVED`.
- ✓ No premature roadmap-done commit. ROADMAP.md S12 row still says `Planned`.
- ✓ No `s12-architect-review.md` written by dev (this file is mine).
- ✓ Day-1 spike filed and architect-adjudicated before Task 2 began. The streamMessage mini-spike that I requested also landed cleanly with results in `proposals/s12-spike-results.md`.
- ✓ Commits are clean: one per task (`feat(m9.6-s12): X (Task N)`), plus the self-caught spec-gap fix and the auditor-artifact commit. Zero "APPROVED" claims in any commit message.
- ✓ §0.2 (detection at the gates) holds: both `processSystemInit` and the hooks live inside `McpCapabilityCfrDetector` — single class, two entry points.

The dev caught a spec gap themselves (debrief-prep's `runDir` was added as a parameter but not wired at the production call site), fixed it in `43c9545`, and documented it in DEVIATIONS. That's exactly the discipline the plan was trying to instill.

---

## 5. Observations (non-blocking, accepted as-is)

The auditor flagged five minor observations. My take on each:

1. **`CapabilityInvoker.originFactory` "first active session wins"** (`app.ts:549-557`). Correct concern; not a current bug. The brain is single-session-per-conversation today. If multi-session concurrency lands later (M10+), this becomes a latent bug. **Accept; track in S20 exit-gate verification (will surface if a parallel-conversation test exists) or in a future sprint.**

2. **Dashboard fallback `ChannelContext.sender = "user"`** (`chat-service.ts:547-551`). Better than S10's `"system"`. Acceptable for single-user dashboard; will need real userId when multi-user auth lands. **Accept; not a Phase 2 blocker.**

3. **`ack-delivery.ts` doc-comment rename** to make the `rg "unreachable in S9"` acceptance grep unambiguous. Slightly defensive (the comment was historical context), but transparently documented in DEVIATIONS. The grep is intentionally strict. **Accept.**

4. **Acceptance-grep strictness** caught a doc-comment match. The dev's recovery (rename rather than weaken the grep) is the right move. **Note for future sprints:** if you have to weaken an acceptance check to make it pass, that's a smell; rename the surrounding text or scope the grep. The dev did this correctly here.

5. **Pre-existing `integration.test.ts` MCP-spawn flake** in core regression. File untouched in S12 (`git log master..HEAD -- packages/core/tests/capabilities/integration.test.ts` returns nothing). **Pre-existing on master; outside S12 scope.** Track separately if it ever blocks S15 exit gate.

---

## 6. Plan amendments (CTO deferral rule — architect's job)

Two new FOLLOW-UPS items the dev surfaced are not yet explicit in the receiving sprint plan. Adding to S19 (Phase 3) per the deferral rule:

- **Concrete `AutomationNotifierLike` implementation in `app.ts`.** S12's `AckDelivery` supports the notifier dep but no concrete impl is wired. With `notifyMode === "immediate"` and a missing notifier, AckDelivery logs a warning and still writes `CFR_RECOVERY.md` — degraded but not broken. S19 should wire the concrete impl alongside the system-origin dashboard health UI work it already covers.
- **Automation `fixed` outcome — `notifyMode === "immediate"` notifier fan-out.** S12's terminal drain skips the immediate-notification step for automation origins on the `"fixed"` outcome (writes `CFR_RECOVERY.md` only). The debrief carries the narrative for `notifyMode === "debrief"` (the default). S19 should wire the immediate fan-out path.

I'll commit the S19 plan amendment in this architect commit per the deferral rule.

The other dev-surfaced uncovered failure modes (in-session late MCP crash, `is_interrupt` handling, unknown-tool `tool_result`, partial degradation) stay as `s12-FOLLOW-UPS.md` items without specific sprint assignment — they're discovery items for whichever future sprint exposes their need. Naming them now satisfies §0.1.

---

## 7. Verdict

**APPROVED.** Sprint work is high-quality, complete, and disciplined. No dev cleanup required.

S13 unblocked. The dev's `runSmokeFixture` from S11 (early-delivered) plus this sprint's `attachedOrigins` mutex + 6-step drain give S13 everything it needs to land the per-type reverifiers + `RESTORED_TERMINAL` state cleanly.

---

## 8. Merge guidance

Sprint branch ready to merge to master after this architect-review commit. Recommended:

```bash
git merge --no-ff sprint/m9.6-s12-mcp-cfr-detector
```

Roadmap-done commit lands AFTER merge per §0.3.

---

*Architect: Opus 4.7 (1M context), Phase 2 architect for M9.6 course-correct*
