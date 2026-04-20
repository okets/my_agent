---
sprint: M9.6-S20
reviewer: external-opus
verdict: PASS
---

# S20 External Review

## Verdict: PASS

## Summary

S20 delivers all four spec tasks faithfully. The three inherited test failures are
addressed with real root-cause fixes (not silenced assertions), the FU-8 cleanup
matches the planned shape exactly (`chunks` + inline `join("")` on the happy path
only), the terse deliverable contract is correctly specified in SKILL.md and has
matching test coverage, and the four exit-gate E2E test files are all present and
use the shared helpers module as spec'd. The sprint artifacts (DECISIONS, DEVIATIONS,
FOLLOW-UPS, ROADMAP) are consistent and the milestone is closed cleanly. Minor
cosmetic observations only; nothing blocks merge.

## Task-by-Task

### §2.5.0 — Zero-failed-tests gate

All three root-cause fixes are real, not silences:

1. **`capabilities-singleton-visual.test.ts`** — Documented in D-1 as a baseline refresh
   traced to three intentional commits (Tailwind CDN removal, self-hosted vendor assets,
   S19 color-token correction). Regenerated with `UPDATE_VISUAL_BASELINES=1`; baseline
   bytes recorded. Matches the spec's "document what changed" requirement.

2. **`capability-ack-render.test.ts`** — Three cascading fixes, all correctly identified:
   - `handleWebSocketMessage` → `handleWsMessage` (verified: `app.js:1290` defines
     `handleWsMessage`; no `handleWebSocketMessage` remains).
   - `Alpine.$data(body)` → `Alpine.$data(root)` with `[x-data="chat()"]` selector.
   - `expect(locator).toBeVisible()` (Playwright matcher) → `locator.waitFor({ state: "visible" })`
     (vitest-compatible), and `.first()` added to resolve strict-mode multi-match
     (desktop + mobile bubbles). All three fixes match the spec exactly.

3. **`whatsapp-before-browser.test.ts`** — `CapabilityInvoker` added to `makeTestApp`
   with stub registry `listByProvides: () => []`, producing a `not-installed` CFR.
   Root cause correctly attributed to M9.6-S10 refactor that routed STT through
   `CapabilityInvoker`. The test now proves the pipeline passes the deps gate and
   emits an STT-level (not deps-missing) CFR. Both the post-S2 test and the pre-S2
   negative-control test remain.

D-1 in s20-DECISIONS.md captures all three root causes in detail with commit
hashes — fully meeting the "three short paragraphs" spec requirement.

### §2.5.0b — FU-8 cleanup

`conversation-initiator.ts:190-216` implements the spec precisely:

```
const chunks: string[] = [];
...
if (event.type === "text_delta" && event.text) {
  chunks.push(event.text);
}
...
if (errorMsg) return { status: "send_failed", reason: errorMsg };
if (!sawDone) return { status: "skipped_busy" };
const forward = await this.forwardToChannel(chunks.join(""), targetChannel);
```

The `chunks.join("")` is only evaluated on the happy path, after the two early
returns. On `send_failed` or `skipped_busy`, the accumulator is structurally dead
state — the array exists but is never serialized. This matches D-0's description
and is strictly cleaner than the old `response += event.text` pattern.

FU-8 is correctly annotated `✅ ADDRESSED IN M9.6-S20` in
`docs/sprints/m9.4-s4.1-brief-section-preservation/FOLLOW-UPS.md:66` (mirrors the
FU-6 close pattern noted in the plan).

### §2.5.1 — Terse deliverable contract

`SKILL.md` Step 0 Fix Mode step 5 (lines 39-47) rewritten correctly:

- `deliverable.md` body: "terse one-liner per attempt, 2–5 lines TOTAL."
- Format: `Attempt {N}: {outcome} — {file changed | "no change"}`.
- Frontmatter fields preserved (`change_type`, `test_result`, `hypothesis_confirmed`,
  `summary`, `surface_required_for_hotreload`).
- `forensic.md` named as sibling for full per-attempt detail.
- Explicit note that the debrief aggregator reads `deliverable.md`, not `forensic.md`.

`capability-brainstorming-gate.test.ts` has two new `// [S20]` assertions at
lines 63-70 (forensic.md named; terse contract present — regex covers `2-5 lines`,
`terse`, `one-liner`). Pre-existing R3 regression assertions (Steps 1-6 headings,
`create_automation`, `Spawn the Builder`) untouched.

`fix-mode-deliverable-contract.test.ts` is a new file with 6 tests covering all
spec requirements: ≤5 line body, per-attempt format regex, forensic.md exists,
forensic body > deliverable body, ESCALATE marker at body start still parses,
frontmatter fields survive. Uses `parseFrontmatterContent` from core — verified
exported at `lib.ts:212`.

**Note:** the plan §2.5.1 file-list referenced `packages/core/tests/skills/capability-brainstorming-gate.test.ts` but the actual path is `packages/core/tests/capabilities/capability-brainstorming-gate.test.ts`. This is a spec-text typo, not an implementation issue — the test file was in `capabilities/` from S16.

### §2.5.2 — Exit-gate E2E tests

All four files present and correctly structured:

1. **`cfr-exit-gate-helpers.ts`** (366 lines) — exports all thirteen symbols listed
   in the spec: `realAgentDir`, `hasAuth`, `makeIsolatedAgentDir`,
   `writeCfrFixClaude`, `copyCapabilityWithoutEnabled`, `makeCapabilityStack`,
   `makeAutomationStack`, `makeOrchestrator`, `waitForAutomationRecovery`,
   `waitForConversationRecovery`, `assertCfrRecovery`, `assertTerseDeliverable`,
   `MockTransport`, `OrchestratorCallbacks`. Clean abstraction; no over-engineering.

2. **`cfr-exit-gate-automation.test.ts`** (browser-chrome, automation-origin)
   — uses shared helpers, `describe.skipIf` gates on `hasAuth` + `hasBrowserPlug`.
   Asserts: `.enabled` created, `CFR_RECOVERY.md` written with correct frontmatter
   via `assertCfrRecovery`, no surrender, terse deliverable + forensic.md via
   `assertTerseDeliverable`. D-3 parallel-conversation deferral commented in the
   file header (lines 23-24).

3. **`cfr-exit-gate-conversation.test.ts`** (stt-deepgram, conversation-origin)
   — uses `AckDelivery` + `MockTransport` as wired per spec. Gated on `hasSttPlug`
   + `hasAudio` + `hasAuth` + `hasDeepgram` (matches the "real Deepgram transcription"
   requirement). Asserts: `.enabled` created, no surrender,
   `reprocessCalledWith` not null and length > 0, ≥1 ack captured on
   TEST_CHANNEL via `mockTransport.sends.filter(...)`, terse deliverable + forensic.md.
   All five assertion shapes from D-3 of plan §2.5.2 present.

4. **`cfr-abbreviated-replays.test.ts`** (TTS + desktop):
   - **Block A (TTS, conversation-origin, terminal):** asserts
     `emittedAcks.toContain("terminal-fixed")` AND `reprocessCalledWith` is null
     (TTS has no retriable input). Matches spec exactly.
   - **Block B (desktop-x11, automation-origin):** asserts CFR_RECOVERY.md written
     with `desktop-control` plug type + terse deliverable.

   D-4 non-coverage of image-to-text is named explicitly; plan concurs (no plug
   installed).

All four files use consistent skip-if gating, 60s setup timeout, 360s test timeout,
and call `rmSync(agentDir, ...)` in `afterAll` for cleanup.

## Concerns

1. **Minor cosmetic: duplicate imports in `cfr-exit-gate-helpers.ts`** (lines 6-10).
   `node:fs` is imported both as `* as fs` and as named symbols (`mkdirSync`,
   `writeFileSync`, `existsSync`, `cpSync`); same pattern for `node:path`. Not a bug
   — TypeScript/esbuild deduplicates at compile time — but tidier to pick one style.
   Low priority.

2. **`initiate()` has the same `let response = ""` pattern FU-8 addressed for `alert()`**
   (`conversation-initiator.ts:259, 269, 284-285`). The spec scoped FU-8 narrowly to
   the `alert()` same-channel path at lines 177-190, and the cleanup there is done
   correctly. However the same dead-accumulator cosmetic pattern lives in `initiate()`.
   This is explicitly out-of-scope for §2.5.0b ("Touching... the broader `alert()` /
   `initiate()` mediator pattern" is listed under Out of Scope, line 517 of plan). Just
   worth flagging as a potential future follow-up if the codebase gets another
   readability pass. Not a blocker.

3. **`capability_ack-render.test.ts` skips when the dashboard is unreachable** — the
   test gates on `isDashboardReachable()`. This was spec'd (the test file existed before
   S20; S20 only fixed the assertions). CI/local runs that don't have a live dashboard
   will show it skipped, not passed. That's consistent with prior S20 history but
   means "1347 passed / 0 failed" depends on dashboard availability at sprint close.
   This is pre-existing test infrastructure; not a new S20 concern.

4. **S20 sprint artifacts deliberately exclude a plan/test-report/architect-review**
   — only DECISIONS, DEVIATIONS, FOLLOW-UPS exist. The plan lives in
   `plan-phase3-refinements.md §2.5` (linked correctly from ROADMAP line 1009).
   Prior Phase 3 sprints (S16-S19) had their own plan files. For the exit-gate sprint
   this shared-plan pattern is acceptable — the tasks are small and well-specified
   in §2.5 — but the ROADMAP link goes to a section of a shared plan doc rather than
   a dedicated `s20-plan.md`. This is a stylistic choice, not a defect.

## Verdict Rationale

All four tasks match the spec. The three inherited test fixes are root-cause fixes
with documented traces. The FU-8 cleanup is structurally exactly what the plan asked
for. The terse deliverable contract is correctly specified in SKILL.md with matching
test coverage (8 assertions across 2 test files). The four exit-gate E2E test files
are present, use shared helpers, and cover every spec'd assertion. The ROADMAP is
updated on both the S20 row and the M9.6 milestone summary row. The
deviations file documents the single additive scope change (shared helpers) and the
intentional `MockTransport` duplication. No blockers.

Recommend merge.
