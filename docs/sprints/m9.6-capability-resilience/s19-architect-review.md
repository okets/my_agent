---
sprint: M9.6-S19
title: UX Polish — ack coalescing + notifier fan-out + system-origin UI + frontmatter friendly_name + assistant-turn orphan + failure_type producer — architect review
architect: Opus 4.7 (Phase 3 architect)
review_date: 2026-04-20
verdict: APPROVED
---

# S19 Architect Review

**Sprint:** M9.6-S19 — UX Polish (six features, largest Phase 3 sprint)
**Branch:** `sprint/m9.6-s19-ux-polish` (not yet merged — correct per §0.3)
**Implementer commits:** 11 commits in plan order:
  - `776fa1b` Task 1 — FRIENDLY_NAMES → frontmatter migration
  - `287669a` Task 2 — ack coalescing
  - `b01cc03` Task 2 fix — coalescer copy ("now also" + slice new types)
  - `ec9e91d` Task 3 — fixed-outcome notifier + AutomationNotifierLike wired
  - `9a6955a` Task 4 — system-origin ring buffer + health endpoint
  - `d45cfd3` Task 5 — TranscriptTurn.failure_type + FAILURE_PLACEHOLDERS + watchdog scan
  - `b91069c` Task 5.5 (R1) — failure_type producer in chat-service.ts
  - `471a696` Task 6 — dashboard UI (failure_type marker + system health panel)
  - `2b9f305` Task 6 fix — Tailwind color tokens corrected
  - `04f4abc` Task 7 — sprint artifacts
  - `41e03d6` Task 7 — external verification report
**Reviewed:** 2026-04-20
**Verdict:** **APPROVED.** Largest-surface Phase 3 sprint to date and the cleanest. All R1 + R2 corrections + S1–S5 suggestions addressed. Three full Phase 3 sprints in a row (S17 + S18 + S19) with full §0.3 compliance and substantive sprint artifacts. The dev's external verification report is high-quality and matches my independent verification line-for-line.

---

## 1. What's done well — substantial

The work is high-quality across correctness, process, and discipline axes.

- **§0.3 compliance fully maintained** (third Phase 3 sprint in a row):
  - Branch `sprint/m9.6-s19-ux-polish` not merged to master.
  - No ROADMAP-Done commit in sprint history.
  - No "APPROVED" or "all tasks complete" framing in any commit message.

- **All architect corrections from plan review addressed:**
  - **R1 (failure_type producer):** Task 5.5 implemented exactly as scoped. `ttsFailed` flag at `chat-service.ts:776`, set `true` at `:897` when `synthesisResult === null`, written into `TranscriptTurn.failure_type` at `:934`. New `chat-service-failure-type.test.ts` (3 tests) verifies the producer end-to-end.
  - **R2 (ring buffer test):** assertion corrected — `events[0] === "component-104"` (most recent) + `events[99] === "component-5"` (oldest still in buffer). Verified at `cfr-system-origin-health.test.ts:45-46`.
  - **S1 (coalescer integration test):** Step 3.5 of Task 2 added — fires through `AckDelivery.deliver()` end-to-end. Verified by 10/10 ack-coalescing tests pass.
  - **S2 (`OrphanSweepReport` shape):** dev grepped first, preserved existing `staleSkipped` and `corruptSkipped` shapes. No `{ ... }` placeholder leftover in production code.
  - **S3 (app.ts wiring assertion):** new `app-ackdelivery-wiring.test.ts` (2 tests). Confirms `app.ackDelivery` is non-null after boot with notifier wired.
  - **S4 (line-number verification):** dev grepped at sprint-start; many `~line N` references corrected during implementation per the discovered actual lines (visible in DECISIONS D3 narrative).
  - **S5 (D3 expansion):** D3 captures the hypothesis (message-handler) vs grep-discovered reality (chat-service:931), with the "why plan v0 was wrong" rationale (S18 path collapse moved synthesis fully into chat-service). Decision-history shape exactly as requested.

- **External auditor used** (Task 7 Step 4 — optional but recommended). The `s19-review.md` report is a model artifact: 15 spec requirements mapped to concrete source-code line ranges, independent test reproduction, browser verification of the live endpoint, §0.3 compliance check. This is the right discipline for a six-feature sprint.

- **Three honest deviations documented:**
  - **DEV-1:** confirms R1 — file location was wrong in plan v0; followed Task 5.5 to land in chat-service.
  - **DEV-2:** `image-to-text.md` template doesn't exist in the repo. Dev correctly updated 5 of 6 templates and documented the gap. FU-2 tracks template creation when an image-to-text capability is added. Better than silently skipping.
  - **DEV-3:** `register()` method added to `CapabilityRegistry` as a test-harness convenience. Additive only, no existing API changed.

- **Substantive DECISIONS:**
  - D1 (coalescer placement) — option-A vs option-B explicit weighing.
  - D2 (ring buffer storage) — in-memory vs file with spec-grounded rationale.
  - D3 — the prized one (per S5).
  - D4 — root-cause note for the fixed-outcome bug, including why S12 missed it.

- **Six features all implemented:**
  - **Feature 1 (FRIENDLY_NAMES → frontmatter):** `getFriendlyName(type)` with first-wins-per-type semantic; 5 templates updated; hardcoded table preserved as fallback. Plug-level frontmatter overrides hardcoded table.
  - **Feature 2 (ack coalescing):** 30s window per conversation; N-aware Oxford-comma rendering; partial restoration ("X is back; Y still in progress"); combined terminal ("X and Y are back" / mixed-outcome combinations); cross-origin bypass.
  - **Feature 3 (fixed-outcome notifier):** automation outcome derived from `context?.kind`; concrete `AutomationNotifierLike` wired in app.ts using `conversationInitiator.alert() → initiate()` fallback per dashboard CLAUDE.md mediator-framing pattern.
  - **Feature 4 (system-origin ring buffer + endpoint):** `SystemCfrEvent` interface, max-100 ring buffer with `shift()`-on-overflow, `getSystemEvents()` returns most-recent-first, `/api/capabilities/cfr-system-events` endpoint, live-tested by external auditor (200, `{"events":[]}` on fresh boot).
  - **Feature 5 (failure_type + assistant-turn orphan):** field on TranscriptTurn, FAILURE_PLACEHOLDERS dispatch table, watchdog scan with idempotency check (skip if later non-empty assistant turn exists), `assistantFailuresScheduled` report items.
  - **Feature 6 (dashboard UI):** failure_type inline marker (`text-orange-400/70 italic` styling, "voice reply unavailable — fixing…" copy for `text-to-audio`); system-origin health panel with refresh button; Tailwind tokens correctly applied (initial `bg-surface-800` was wrong, fix landed in `2b9f305`).

- **Independent verification (re-ran):**

  | Check | Command | Result |
  |---|---|---|
  | core tsc | `cd packages/core && npx tsc --noEmit` | exit 0 |
  | dashboard tsc | `cd packages/dashboard && npx tsc --noEmit` | exit 0 |
  | S19 core tests (4 files) | 21 tests | 21/21 pass |
  | S19 dashboard integration (4 files) | 13 tests | 13/13 pass |
  | S18 regression gate | 7 tests | 7/7 pass |
  | R1 producer in code | `grep "ttsFailed\|failure_type" chat-service.ts` | `:776, :897, :934` confirmed |
  | R2 corrected assertion | `grep "component-104\|component-5" cfr-system-origin-health.test.ts` | `:45-46` confirmed |

---

## 2. NON-BLOCKING observations (accepted as-is)

These are real items but don't block approval.

### 2.1 Dashboard pre-existing failures (7 tests, same as S17/S18 baseline)

`s19-test-report.md` and the external auditor both confirm the 7 dashboard test failures are pre-existing and unrelated to S19 — Playwright browser env issues, visual regression baselines, progress-card token mismatches. Verified by file modification check (none touched by S19 commits).

**Action:** none required. These have persisted across S15/S16/S17/S18/S19; track separately if they ever block S20 exit gate.

### 2.2 `bg-surface-800` tech debt in `index.html` (FU-3)

Lines 5136 and 5149 of `packages/dashboard/public/index.html` use `bg-surface-800/50` — a class not defined in the Tailwind config. Dev caught this via Tailwind-token discipline during Task 6 ("I/O Contract" panel for tool spaces, outside S19 scope). FU-3 tracks for future dashboard cleanup sprint.

**Action:** none required. Honest follow-up of unrelated tech debt.

### 2.3 FU-1 — orphan watchdog re-drive path could be more direct

Currently the watchdog uses `systemMessageInjector` to prompt the brain to retry. Future enhancement would wire `assistantFailuresScheduled` to the CFR orchestrator's structured re-drive path. Dev correctly notes this is "functional; structured re-drive is an enhancement."

**Action:** none required. Track for a future sprint if the orphan watchdog recovery rate proves insufficient in production.

### 2.4 Image-to-text template gap (DEV-2 / FU-2)

Plan v0 listed 6 templates; only 5 exist in the repo. Dev updated all 5 and tracked the missing template in FU-2. The hardcoded `FRIENDLY_NAMES` table provides a safe fallback for any future `image-to-text` capability.

**Action:** none required. When image-to-text capability is created, the future sprint must include `friendly_name:` in the new template.

### 2.5 External auditor pattern is excellent

This sprint used the optional external auditor (Task 7 Step 4) and produced a model artifact. Calling out as positive signal: every spec requirement mapped to concrete source-code line ranges, live endpoint verified via curl, §0.3 compliance grep documented. Future Phase 3 sprints (S20) should consider using the same pattern, especially for surface-heavy work.

---

## 3. Spec coverage (every plan task verified)

| Plan task | Status |
|---|---|
| Task 0 — preflight (branch + S18 baseline + artifact stubs) | ✓ |
| Task 1 — FRIENDLY_NAMES frontmatter migration (registry + 5/6 templates per DEV-2) | ✓ |
| Task 2 — ack coalescing (30s window, N-aware, partial/combined terminal) | ✓ |
| Task 2 (S1) — integration test through `AckDelivery.deliver()` | ✓ |
| Task 3 — `fixed`-outcome fan-out + AutomationNotifierLike wired | ✓ |
| Task 3 (S3) — app.ts wiring assertion test | ✓ |
| Task 4 — system-origin ring buffer + health endpoint | ✓ |
| Task 4 (R2) — corrected ring buffer cap test assertion | ✓ |
| Task 5 — TranscriptTurn.failure_type + FAILURE_PLACEHOLDERS + watchdog scan | ✓ |
| Task 5 (S2) — `OrphanSweepReport` shape preserved (no placeholder `{ ... }`) | ✓ |
| Task 5.5 (R1) — failure_type producer in chat-service.ts | ✓ |
| Task 6 — dashboard UI (failure_type marker + system health panel) | ✓ |
| Task 7 — sprint artifacts (DECISIONS, DEVIATIONS, FOLLOW-UPS, test-report, review) | ✓ |
| Task 7 (S5) — D3 expanded with hypothesis-vs-reality decision history | ✓ |
| §0.1 universal-coverage check | ✓ FU notes the rule going forward (new templates MUST include friendly_name) |
| §0.3 compliance | ✓ branch + commit messages + no ROADMAP touch |

100% spec coverage.

---

## 4. Process compliance — third clean Phase 3 sprint in a row

| Check | Result |
|---|---|
| All required artifacts present | DECISIONS (4), DEVIATIONS (3), FOLLOW-UPS (3), test-report, plus optional review — all present and substantive |
| Branch not merged before review | ✓ on `sprint/m9.6-s19-ux-polish` |
| No ROADMAP-Done commit | ✓ |
| No "APPROVED" / "all tasks complete" framing | ✓ all 11 commits use neutral language |
| Architect-amended plan followed | ✓ R1 + R2 + S1–S5 all addressed |
| §0.2 (detection at the gates) | ✓ no new emit sites added; coalescer wraps existing path |
| External auditor optional | ✓ used + high-quality artifact |
| `failure_type` producer landed (not just type + scanner) | ✓ Task 5.5 added by architect, executed cleanly by dev |

S17 + S18 + S19 = three back-to-back clean sprints. The §0.3 discipline that S16 violated has stuck across the entire latter half of Phase 3.

---

## 5. Verdict

**APPROVED.** Phase 3 UX polish complete. Six features, all working end-to-end. The largest sprint of Phase 3 came in clean.

Phase 3 status post-S19:
- S16 — fix-engine swap to `capability-brainstorming` ✓
- S17 — reflect-phase collapse + Item B latent-bug fix ✓
- S18 — duplicate TTS path collapse + 4 §0.5 deferrals ✓
- S19 — ack coalescing + notifier fan-out + system-origin UI + frontmatter friendly_name + assistant-turn orphan + failure_type producer ✓
- **S20 — Phase 3 exit gate (two CTO-defined definitive smoke tests)** — last sprint

S20 unblocked. M9.6 closes at S20.

The ROADMAP-Done commit lands separately as the LAST commit per §0.3, authored by me.

---

## 6. Merge guidance

Sprint branch ready to merge to master after this architect-review commit. Recommended:

```bash
git checkout master
git merge --no-ff sprint/m9.6-s19-ux-polish
```

Then I'll author the ROADMAP-Done commit on master.

---

*Architect: Opus 4.7 (1M context), Phase 3 architect for M9.6 course-correct*
