# M9.4-S4.1: Brief Section Preservation — Supplemental Sprint Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supplemental to:** [M9.4-S4 — Brief Delivery Pipeline Fix](../m9.4-s4-brief-delivery-fix/plan.md)

**Opened:** 2026-04-20
**External audit:** pass-with-amendments (codex-rescue, 2026-04-20) — all 5 gaps folded into this plan.
**Blocks:** [M9.6-S20 Phase 3 exit gate](../m9.6-capability-resilience/plan-phase3-refinements.md#25-sprint-20--phase-3-exit-gate-two-definitive-smoke-tests) — see §"Dev note for M9.6-S20" below.

---

## Why this sprint exists

On 2026-04-20 the user's morning brief dropped all user-facing content (news, AQI, events, expat tips, project status). The trigger was a byte-level slice in `summary-resolver.ts`. Investigation exposed additional silent-drop hazards downstream in the same delivery chain (delivery-ack correctness, premature `markDelivered`).

This sprint's goal: **the brief never silently disappears**. If any layer of the pipeline can't deliver, it must say so — loudly — not claim success.

### The failing incident

- Debrief-reporter aggregate: 33,374 bytes, 14 worker-wrapper sections.
- CFR-fix sections occupied bytes 0–23,080. User-facing workers occupied bytes 23,080–33,374.
- `summary-resolver.ts:90` did `text.slice(0, 20_000)` before Haiku. Sections past byte 20,000 were dropped pre-summarization.
- Haiku never saw news / AQI / events / expat-tips / project-status. Brain got a condensed version containing only CFR fixes.
- User: "there are no news in Thailand today?" Brain replied truthfully — it never received those sections.

### Additional hazards in the delivery chain (found by external audit)

- **`alert()` falsely reports `{status: "delivered"}` when `sendSystemMessage()` returned early** (session busy → generator yields nothing) **or yielded `{type: "error"}`**. Heartbeat then marks the queue item delivered. The notification is gone but was never seen by the brain. `conversation-initiator.ts:123-132` + `send-system-message.ts:45-49,94-98` + `heartbeat-service.ts:290-296`.
- **`briefingResult.markDelivered()` fires before the model runs**, at `session-manager.ts:799-802`. If the session query fails between the `markDelivered()` call and first model output, the briefing is marked delivered but the brain never processed it.

### Design principle (promoted from this incident)

**Truncation may summarize a section — it must not drop one. Delivery may fail — it must not lie.**

Byte-slicing violates the first rule. False-delivered ACKs violate the second. Both cause silent data loss with no retry signal to any layer. This sprint fixes both.

---

## Scope — files changed

| Action | File | Change |
|--------|------|--------|
| Modify | `packages/dashboard/src/automations/summary-resolver.ts` | Remove `text.slice(0, 20_000)`. Strengthen `CONDENSE_SYSTEM_PROMPT` (heading preservation). Add 100K hard input cap with fail-loud stub fallback. Add post-Haiku heading verification with fallback. |
| Modify | `packages/dashboard/src/agent/conversation-initiator.ts` | Extend `AlertResult` union with `skipped_busy` and `send_failed`. Make `alert()` observe `sendSystemMessage()` output (track `done` vs `error` vs empty generator) and return the accurate status. Applies to both web-path and external-channel paths (lines 132, 164, 185). |
| Modify | `packages/dashboard/src/automations/heartbeat-service.ts` | Handle `skipped_busy` and `send_failed`: leave in queue, `incrementAttempts`, log. Same semantic as existing `transport_failed`. |
| Modify | `packages/dashboard/src/automations/automation-scheduler.ts` | Update the `AlertResult` type alias + switch for new statuses. |
| Modify | `packages/dashboard/src/automations/automation-processor.ts` | Update the `AlertResult` type alias (inline copy at line 43) to match. |
| Modify | `packages/dashboard/src/server.ts` | Update the `AlertResult` type alias (inline copy at lines 74–76) to match. |
| Modify | `packages/dashboard/src/agent/session-manager.ts` | Move `briefingResult.markDelivered()` from before model invocation (line 799–802) to after the first model output event is observed (or on successful stream completion). |
| Create | `packages/dashboard/tests/fixtures/debrief-2026-04-20.md` | Snapshot of today's real 33,374-byte aggregated deliverable. |
| Modify | `packages/dashboard/tests/unit/automations/summary-resolver.test.ts` | Live regression test against fixture + synthetic "huge early + tiny late" unit test + hard-cap stub test + post-Haiku verification test. |
| Modify | `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts` | New tests for `skipped_busy` / `send_failed` retry semantics. |
| Create | `packages/dashboard/tests/unit/agent/conversation-initiator-alert-outcome.test.ts` | New tests for `alert()` outcome observation (busy / error / done paths). |
| Modify | `packages/dashboard/src/agent/__tests__/session-manager.test.ts` *(or equivalent)* | New test: briefing not marked delivered if session throws before first output. |
| Modify | `docs/ROADMAP.md` | S4.1 row + S20 blocker + S20 dev note (already landed). |

---

## Relation to M9.4-S4

S4 built the artifact-first resolution, mandatory deliverable validator, verbatim framing, and reporter-as-assembler. All of that stands untouched. S4.1 fixes two latent defects S4 shipped with:

1. The Haiku fallback was never exercised against a multi-section aggregated payload, and the 20K input slice went unnoticed because no worker in the M9.4 era produced oversize output solo.
2. `alert()` has always reported `delivered` without observing `sendSystemMessage()` output; this was latent because notifications usually fit and the session was usually idle.

M9.6 Phase 1–3 introduced CFR-fix automations, which the debrief-reporter aggregates with other `notify: debrief` workers. That's the scale pressure that crossed the threshold and exposed both bugs.

---

## Heading preservation contract (precise)

**What must be preserved** (asserted in tests):

The **top-level worker wrapper headings** written by the debrief-reporter at `handler-registry.ts:331` — format: `## ${prefix}${job.automationName}`. For today's fixture, these are the 14 automation names (listed explicitly in the test — brittleness is the point).

**What may be compressed or merged** (not asserted):

Internal `##` headings inside worker-authored deliverable bodies (`## Diagnosis`, `## Results`, `## Validation`, etc.). These are worker-internal structure and are expected to be compressed aggressively.

Detection: each top-level section starts with the sequence `\n\n## <automation-name>\n\n`, where `<automation-name>` matches one of the registered automation IDs that fed into the debrief. The test hardcodes the list of 14 for the 2026-04-20 fixture; a helper can extract the list for future fixtures.

---

## Tasks

### Task 1 — Capture the regression fixture

- [ ] **Step 1:** Copy `.my_agent/automations/.runs/debrief-reporter/job-4b578057-a315-41c4-8dfc-d18560e427ab/deliverable.md` to `packages/dashboard/tests/fixtures/debrief-2026-04-20.md`.
- [ ] **Step 2:** Verify byte count = 33 374 and the 14 top-level worker-wrapper headings are present:
  - `cfr-fix-test-type-a1-exec-cee49e8b`
  - `cfr-fix-test-type-a2-exec-85e1eae7`
  - `cfr-fix-browser-control-a1-exec-fcd0d34d`
  - `cfr-fix-text-to-audio-a1-exec-aa89baa4`
  - `cfr-fix-test-type-a3-exec-16e00970`
  - `cfr-fix-text-to-audio-a2-exec-55a1084c`
  - `cfr-fix-browser-control-a2-exec-da70561d`
  - `cfr-fix-text-to-audio-a3-exec-029f023c`
  - `cfr-fix-browser-control-a3-exec-43146a22`
  - `chiang-mai-aqi-worker`
  - `expat-tips-worker`
  - `project-status-worker`
  - `chiang-mai-events-worker`
  - `thailand-news-worker`
- [ ] **Step 3:** Add a fixture provenance comment at the head of the file (job ID, date, why snapshotted). Do not edit the content itself.

### Task 2 — Strengthen `summary-resolver.ts` (content integrity)

File: `packages/dashboard/src/automations/summary-resolver.ts`

- [ ] **Step 1 — Remove byte slice.** In the async condense branch, replace `text.slice(0, 20_000)` with `text`.
- [ ] **Step 2 — Add 100K hard input cap with fail-loud stub.**
  - If `text.length > 100_000`, do NOT call Haiku. Return a stub of the form:
    ```
    [Debrief exceeded safe size (<N>K chars across <M> sections) — content preserved at <deliverable_path>. Section list:
    - <heading 1>
    - <heading 2>
    ...]
    ```
  - Log at `console.warn` level with the total bytes and section count.
  - Rationale: avoids runaway Haiku calls on megabyte deliverables; preserves the never-drop invariant by listing every section heading so the brain knows what's in the debrief on disk.
- [ ] **Step 3 — Strengthen condense prompt.**
  ```ts
  const CONDENSE_SYSTEM_PROMPT =
    "Condense this content to fit within 10,000 characters. Do NOT drop any information — " +
    "every finding, number, name, date, and actionable item must be preserved. " +
    "If the content has `## ` section headings written at the top level (aggregator-style " +
    "worker wrappers), every such heading MUST appear in the output in its original order. " +
    "You may compress the body under each heading and merge internal subsections, but never " +
    "drop a top-level section entirely. Shorten prose, remove filler, use bullets, but keep all substance.";
  ```
- [ ] **Step 4 — Post-Haiku heading verification.** After Haiku returns:
  - Extract the set of top-level worker-wrapper headings from the input (regex `/^## (\S.*)$/m` filtered to entries matching registered automation names, or simply extract all `^## ` lines from input as the expected set).
  - Check each expected heading appears in output (substring match on `"## <name>"`).
  - If any missing, log `console.warn` with the missing names, and fall back to returning the raw input content unmodified. Never silently accept Haiku output that dropped sections. This is belt-and-suspenders on top of the prompt instruction.
- [ ] **Step 5 — Preserve existing fallback.** `resolveJobSummaryAsync`'s existing behavior when Haiku throws (return raw content) stands unchanged.

### Task 3 — Tests for `summary-resolver.ts`

File: `packages/dashboard/tests/unit/automations/summary-resolver.test.ts`

Extend the existing suite. All tests gate on Agent SDK session availability (not `ANTHROPIC_API_KEY`) per the project's OAuth/Max constraint — follow the pattern in `packages/dashboard/tests/live/helpers.ts`.

- [ ] **Step 1 — Synthetic unit test: huge early + tiny late sections** (no Haiku required).
  - Build a fake deliverable: one 25K section followed by four tiny 1K sections. Mock `queryModelFn` to verify it's called with the full 30K content, not sliced.
  - Mock returns a condensed version. Assert no byte-level slicing happened upstream.
  - This is the exact failure shape from 2026-04-20 but without a live Haiku call — cheap, fast, always runs in CI.

- [ ] **Step 2 — Synthetic unit test: Haiku drops a section.**
  - Mock `queryModelFn` to return output missing one of the expected headings.
  - Assert the resolver falls back to returning raw input, and a warning is logged.

- [ ] **Step 3 — Synthetic unit test: hard-cap stub path.**
  - Build a fake deliverable of 150K chars with 3 sections. Mock `queryModelFn` and assert it's NOT called.
  - Assert returned content is the stub format (contains `"exceeded safe size"` and each section heading).

- [ ] **Step 4 — Live regression test: today's real fixture.**
  - Gate on Agent SDK session availability.
  - Write the fixture file into a temp `runDir` as `deliverable.md`.
  - Call `resolveJobSummaryAsync(runDir, fallback, realQueryModel)`.
  - Assert: every one of the 14 top-level worker-wrapper headings (from Task 1) appears in output as substring `"## <name>"`.
  - Assert: `content.length <= MAX_LENGTH` (10 000).
  - Assert: representative user-facing facts survive — must contain the AQI number (`"157"` or `"AQI"`), at least one of `"Songkran"` / `"PM2.5"` / `"Chiang Mai"`, and the `"S19"` project-status marker.
  - Run this test once before the fix (FAILS — headings past byte 20k missing) and once after (PASSES). Include both runs in test-report.md.

### Task 4 — Fix `alert()` outcome observation

File: `packages/dashboard/src/agent/conversation-initiator.ts`

- [ ] **Step 1 — Extend the `AlertResult` union** (lines 66–69):
  ```ts
  export type AlertResult =
    | { status: "delivered" }
    | { status: "no_conversation" }
    | { status: "transport_failed"; reason: string }
    | { status: "skipped_busy" }
    | { status: "send_failed"; reason: string };
  ```

- [ ] **Step 2 — Observe `sendSystemMessage()` in the web-delivery path** (currently lines 123–132):
  ```ts
  if (!targetChannel || targetChannel === "web") {
    let sawDone = false;
    let errorMsg: string | undefined;
    for await (const event of this.chatService.sendSystemMessage(
      current.id, prompt, (current.turnCount ?? 0) + 1,
      { triggerJobId: options?.triggerJobId },
    )) {
      if (event.type === "done") sawDone = true;
      else if (event.type === "error") errorMsg = event.message;
    }
    if (errorMsg) return { status: "send_failed", reason: errorMsg };
    if (!sawDone) return { status: "skipped_busy" };
    return { status: "delivered" };
  }
  ```
  Rationale: `sendSystemMessage()` returns early without yielding when session is busy (yields no events → `sawDone` stays false). Catches errors as `{type: "error"}` events (yields error → `errorMsg` set). Both are now surfaced accurately.

- [ ] **Step 3 — Mirror the pattern in external-channel paths** at lines 164 and 185. Apply the same `sawDone`/`errorMsg` observation wherever `sendSystemMessage()` is consumed for assistant-turn generation. Paths that only call transport-send (not `sendSystemMessage`) keep their existing behavior.

- [ ] **Step 4 — Keep existing `transport_failed` semantics.** Don't collapse into the new statuses. `transport_failed` remains the channel-unreachable case; `send_failed` is the new model/session-error case.

### Task 5 — Update callers to handle new statuses

- [ ] **Step 1 — Heartbeat service** (`heartbeat-service.ts:290-323`):
  - Extend the `if/else` chain after `alert()` to handle `skipped_busy` and `send_failed`:
    ```ts
    } else if (result.status === "skipped_busy" || result.status === "send_failed") {
      const reason = result.status === "skipped_busy"
        ? "session busy"
        : `send failed: ${(result as { reason: string }).reason}`;
      console.warn(
        `[Heartbeat] Notification ${notification.job_id} deferred: ${reason}`,
      );
      this.config.notificationQueue.incrementAttempts(notification._filename!);
    }
    ```
  - Same semantics as existing `transport_failed`: leave in queue, bump attempts, rely on `MAX_DELIVERY_ATTEMPTS` for eventual give-up.

- [ ] **Step 2 — Automation scheduler** (`automation-scheduler.ts:26-28, 318`): update type alias to match and handle new statuses symmetrically (retry path, not markDelivered).

- [ ] **Step 3 — Automation processor** (`automation-processor.ts:43`): update inline `AlertResult` type alias.

- [ ] **Step 4 — Server** (`server.ts:74-76`): update inline `AlertResult` type alias.

- [ ] **Step 5 — Typecheck.** TypeScript's exhaustiveness checking will surface any caller that switches on `AlertResult.status` without handling the new variants. Fix each until `npx tsc --noEmit` is clean.

### Task 6 — Fix `markDelivered()` timing

File: `packages/dashboard/src/agent/session-manager.ts`

- [ ] **Step 1 — Read the surrounding logic at line 775–820** to identify where the model query is actually invoked (should be in the same method, after the `buildContext` is fully assembled).

- [ ] **Step 2 — Move the `markDelivered()` call** from its current location (line 799–802, before model invocation) to fire after the first model output event is observed (or on successful stream completion — whichever is simpler and covers the normal case).

  Implementation sketch: keep a reference to `briefingResult` in local scope; call `markDelivered()` inside the stream consumer's `done` handler (or on first `text_delta` event — either is defensible; pick whichever is simpler). If the stream throws before any output, briefing stays in `pending/` and next session's briefing provider re-includes it.

- [ ] **Step 3 — Idempotency check.** Verify `markDelivered()` is safe to call zero or one times (not required to be called exactly once on success). If it's not already idempotent, guard with a `delivered` boolean so error-after-first-token scenarios don't double-mark.

### Task 7 — Tests for delivery-ack correctness

- [ ] **Step 1 — Heartbeat tests for new statuses** in `packages/dashboard/src/automations/__tests__/heartbeat-service.test.ts`:
  - `alert` returns `{status: "skipped_busy"}` → queue item NOT marked delivered, `incrementAttempts` called.
  - `alert` returns `{status: "send_failed", reason: ...}` → queue item NOT marked delivered, `incrementAttempts` called, warning logged.

- [ ] **Step 2 — New file `packages/dashboard/tests/unit/agent/conversation-initiator-alert-outcome.test.ts`:**
  - Busy path: mock `sendSystemMessage` to return empty generator → `alert()` returns `{status: "skipped_busy"}`.
  - Error path: mock `sendSystemMessage` to yield `{type: "error", message: "oops"}` → `alert()` returns `{status: "send_failed", reason: "oops"}`.
  - Happy path: mock yields `{type: "start"}`, `{type: "text_delta", text: "..."}`, `{type: "done"}` → `alert()` returns `{status: "delivered"}`.

- [ ] **Step 3 — Session-manager briefing-delivery timing test:**
  - Simulate `briefingResult.markDelivered` being called; assert it is NOT called if the model query throws before first output; IS called if the model query produces at least one output event.
  - If the session-manager's current test scaffold doesn't support this, add a small targeted test file.

### Task 8 — Full test sweep + typecheck

- [ ] **Step 1:** `cd packages/dashboard && npx tsc --noEmit` — zero errors. Exhaustiveness on `AlertResult` must be clean.
- [ ] **Step 2:** `npx vitest run` on dashboard — zero new failures.
- [ ] **Step 3:** `cd packages/core && npx tsc --noEmit` — zero errors (sanity; no core changes expected).

### Task 9 — Documentation artifacts

- [ ] **Step 1 — `DECISIONS.md`:**
  - D1: Principle — "truncation may summarize, must not drop a section."
  - D2: Principle — "delivery may fail, must not lie."
  - D3: Haiku input cap raised from 20K (silent slice) to 100K (fail-loud stub). Rationale: 100K is well within Haiku context and the brief latency budget; >100K should never occur under normal operation and indicates a runaway worker that warrants operator attention rather than silent best-effort compression.
  - D4: Post-Haiku heading verification is belt-and-suspenders. Prompt instruction is primary, runtime check is secondary, raw-content fallback is tertiary. Three layers, never silent loss.
  - D5: `alert()` return values now include `skipped_busy` and `send_failed`. Both receive the same retry semantics as `transport_failed` — leave in queue, bump attempts, rely on `MAX_DELIVERY_ATTEMPTS` for give-up.
  - D6: `markDelivered()` fires after first model output, not before model invocation. Protects against session-manager exceptions between briefing injection and response generation.
  - D7: Explicitly NOT in scope — alert-layer conversation-context-budget gate. Captured as FU-1 for a future sprint.
- [ ] **Step 2 — `FOLLOW-UPS.md`:**
  - FU-1: Alert-layer context-budget gate. Separate architectural concern. Future sprint.
  - FU-2: M9.6-S20 dev note — CFR-fix worker output contract change (see §"Dev note for M9.6-S20" below).
  - FU-3: `AlertResult` type alias is duplicated in 4+ files (`conversation-initiator.ts`, `server.ts`, `automation-scheduler.ts`, `automation-processor.ts`). Worth consolidating to a single import in a future tidy-up sprint.
  - FU-4: 8:13 AM delivery latency budget is not documented anywhere. Add an explicit budget (e.g. 5 min from worker completion to brain notification) to avoid future capacity debates.
- [ ] **Step 3 — `test-report.md`** (post-run): commands, pass/fail counts, before/after demo for the live fixture test, fixture provenance, list of new statuses observed in heartbeat logs during testing.

---

## Out of scope — explicit non-goals

- **Alert-layer context-budget gate.** Proposed mid-discussion as an architectural follow-up. Not required to fix today's bug class. Logged as FU-1.
- **Reporter ordering / sort.** Not touched. Once CFR-fix workers emit one-liners (per M9.6-S20 dev note), ordering is a non-issue.
- **`AlertResult` type consolidation.** The duplicated inline type aliases work correctly; their consolidation is FU-3.
- **CFR-fix automation output contract change.** Belongs to M9.6-S20 (see below). Changing a worker's output template is an M9.6 concern; S4.1 just makes the pipeline robust against whatever workers emit.
- **summary-resolver rename.** Cosmetic, not worth import churn.

---

## Dev note for M9.6-S20

**For the S20 developer — pick up after this sprint lands.**

After S4.1 fixes section-drop and delivery-ack correctness, CFR-fix automation output will still dominate the Haiku 10 000-char condense budget because each attempt writes a ~2–3K forensic `deliverable.md` and the aggregator reads `deliverable.md` first (`handler-registry.ts:309-320`). The result is a brief where everything is present but CFR content crowds out user-facing content's fidelity.

The user-facing signal the CTO wants for system-maintenance work is one-liner-style:

> "tts-edge-tts voice fixed (3 attempts, capability healthy). browser-chrome entrypoint restored (smoke green). test-type CFR synthetic endpoint test passed."

Not the three-attempt forensic diary.

**Proposed change (S20 scope):**

Change the CFR-fix automation prompt/template output contract:

- `deliverable.md` = one terse paragraph per capability — outcome + file changed, if any. 2–5 lines total across all attempts. This is what shows up in the user's morning brief.
- Forensic detail (diagnosis, decisions log, validation commands, attempt-by-attempt state) moves to a sibling file in the same `run_dir`. Suggested: `attempts.md` or `forensic.md`. Same audit trail, not surfaced to the aggregator.

**Impact:** After S4.1 + S20 land together, the morning brief goes back to ~6–8K chars on a normal day — no Haiku condense needed. The condense path remains as a safety net for actual-content-rich days.

**Out of S4.1 scope** because changing a worker's output contract is an M9.6 concern (their automation's prompt template). S4.1 just makes sure that whatever the worker writes, no section gets dropped and no delivery-ack lies on the way to the brain.

---

## Testing philosophy

- **Synthetic tests first.** They run in CI, are fast, and exercise the exact code paths. Every bug in this sprint has a synthetic unit test.
- **One live fixture test.** Guards against prompt-quality regressions in the real condense path. Gated on Agent SDK availability.
- **Exhaustiveness.** TypeScript must enforce the `AlertResult` union across all 4+ callers. A future `delivery_aborted` status should produce 4+ compile errors the moment it's added — that's a feature.

## Success criteria

1. Today's live fixture test passes with a real Haiku call — all 14 top-level worker headings present, total ≤ 10 000 chars, representative facts survive.
2. Synthetic tests for huge-early-tiny-late, Haiku-drops-section, hard-cap-stub, alert-busy, alert-error, briefing-timing all pass.
3. Typecheck clean on dashboard + core.
4. Full dashboard test suite has no new failures vs. master.
5. Manual verification: next morning's actual brief (2026-04-21 or whenever) includes news / AQI / events / expat tips / project status sections.
6. DECISIONS, FOLLOW-UPS, test-report artifacts present.

## Rollback

- `summary-resolver.ts` change: single-file revert; restore slice if the no-slice path causes unexpected Haiku behavior. Regression test will catch next time.
- `alert()` return-shape change: more invasive if reverted — all callers would need to drop handling for the new statuses. Safer path: if a caller regression emerges, patch the caller rather than revert the shape. The new statuses are strictly more information.
- `markDelivered()` timing change: single-file revert. Accepts the original "mark before model" semantics. Briefing still gets re-included on next session if missed.

---

## Anchor sources for the auditor's verification

This plan was validated against:

- `packages/dashboard/src/automations/summary-resolver.ts:5,85-100` — the 20K slice site.
- `packages/dashboard/src/agent/conversation-initiator.ts:66-69, 123-132, 164, 185` — `AlertResult` declaration + lying `delivered` return sites.
- `packages/dashboard/src/chat/send-system-message.ts:45-49, 94-98` — busy-skip return and error yield.
- `packages/dashboard/src/automations/heartbeat-service.ts:290-323` — the caller that marks delivered.
- `packages/dashboard/src/agent/session-manager.ts:775-820` — briefing `markDelivered` timing.
- `packages/dashboard/src/scheduler/jobs/handler-registry.ts:307-331` — debrief-reporter aggregator format (source of the 14 top-level worker-wrapper headings).
- `.my_agent/automations/.runs/debrief-reporter/job-4b578057-a315-41c4-8dfc-d18560e427ab/deliverable.md` — the 33 374-byte fixture.

---

*Plan authored: 2026-04-20. External audit verdict: pass-with-amendments (codex-rescue). All 5 gaps folded in.*
