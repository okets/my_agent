---
sprint: M9.6-S20
reviewer: architect (opus)
date: 2026-04-20
verdict: APPROVE WITH CHANGES
---

# S20 Architect Review

## Verdict: APPROVE WITH CHANGES (one §0.3 violation, two scope concerns)

The implementation work is sound. The three task fixes (§2.5.0, §2.5.0b, §2.5.1) are well-executed; §2.5.2 is structurally correct but the chosen "deliberately broken" scenario is significantly easier than the spec described. The dev committed one §0.3 process violation (premature ROADMAP-Done) that must be reverted before merge.

## What's right

### §2.5.0 — Test-suite triage (3 dashboard failures cleared)

All three root-caused not silenced. Verified:

| Test | Root cause | Fix shape | Verified |
|------|-----------|-----------|----------|
| `capabilities-singleton-visual.test.ts` | Three intentional CSS commits between baseline (`a6285fe`) and now: `7e7f4c8` (Tailwind CDN removal), `ac47f0a` (self-host vendor assets), `2b9f305` (S19 color-token fix) | Baseline regenerated with `UPDATE_VISUAL_BASELINES=1`; documented in D-1 | All cited commits exist; CSS path plausible |
| `capability-ack-render.test.ts` | `handleWebSocketMessage` renamed to `handleWsMessage` in `52ed05d` (M9.6-S8) | Updated test to call `handleWsMessage`, fixed Alpine root selector (`[x-data="chat()"]` instead of `body`), replaced Playwright `.toBeVisible()` with vitest-compatible `locator.waitFor()`, added `.first()` for strict-mode | `app.js:885,1290,1447` confirms `handleWsMessage` is the current name; `handleWebSocketMessage` does not exist anywhere in `public/` |
| `whatsapp-before-browser.test.ts` | M9.6-S10 routed STT through `CapabilityInvoker`; test's `makeTestApp` had no invoker, so the call fell through to the legacy null-return branch and no CFR fired | Added `CapabilityInvoker` with stub `listByProvides: () => []` to produce `not-installed` CFR | The fix matches the production wiring; assertion now proves the pipeline reaches the invoker |

D-1 captures all three with commit hashes — meets the "three short paragraphs" spec requirement.

### §2.5.0b — FU-8 cleanup (clean)

`conversation-initiator.ts` external same-channel path: `let response = ""` + `response += event.text` replaced with `const chunks: string[] = []` + `chunks.push(event.text)`, with `chunks.join("")` evaluated only at the `forwardToChannel` call-site (after the two early returns). Dead-state on `send_failed` / `skipped_busy` is now structurally invisible. Behaviour-neutral. FU-8 annotation `✅ ADDRESSED IN M9.6-S20` correctly added to S4.1 FOLLOW-UPS.md (mirrors FU-6 pattern).

### §2.5.1 — Terse deliverable contract (clean)

`SKILL.md` Step 5 rewritten to spec exactly: terse body, `Attempt N: outcome — file` format, frontmatter unchanged, `forensic.md` sibling named, debrief-aggregator-reads-deliverable note included. Gate test extended with two `// [S20]` assertions that catch SKILL.md edit-clobber. New `fix-mode-deliverable-contract.test.ts` covers all six spec points.

**Concern (minor):** the new contract test validates a hardcoded canonical example string, not a real fix-mode invocation. The plan said "runs the fix-mode skill against a stub plug (same harness as `fix-mode-integration.test.ts`)". However, `fix-mode-integration.test.ts` ALSO mocks `spawnAutomation` rather than invoking a real LLM — so the dev's choice is consistent with the existing pattern. Acceptable for a unit test layer; real LLM verification happens at the §2.5.2 E2E layer.

### §2.5.2 — Exit-gate E2E tests (structurally correct)

All four files present: `cfr-exit-gate-helpers.ts` (365 lines, 14 exported symbols), `cfr-exit-gate-automation.test.ts`, `cfr-exit-gate-conversation.test.ts`, `cfr-abbreviated-replays.test.ts` (TTS + desktop). Helpers correctly include the S17 KNOWN_TERMINAL fix (`TERMINAL_STATUSES` includes `"completed"` + `"completed"→"done"` mapping at line 249). `MockTransport` added to both `app-harness.ts` and helpers (DEV-2 documents the intentional duplication; reasonable to avoid cross-layer import).

**Concern (significant):** the "deliberately broken" scenario for all three exit-gate tests + abbreviated replays is **`.enabled` marker missing**. The plan §2.5.2 said:

> "Deliberately break the plug at the plug side — one surgical change to `config.yaml`, `CAPABILITY.md`, or a script under `scripts/`, chosen so the break is plausibly one Nina herself could have caused."

`.enabled` missing IS a real failure mode (registry surfaces it as `"not-enabled"` symptom) and IS plausibly user-caused, so it satisfies the letter of the rule. But the "fix" is `touch <path>` — the EASIEST possible repair. The custom test CLAUDE.md (`writeCfrFixClaude` in helpers) tells the agent literally:

> "Create the file: `<absolute-path>`. Run: `touch "<absolute-path>"`. Verify: `ls -la ...`."

This sidesteps the actual fix-mode flow (read CAPABILITY.md, inspect scripts, diagnose, patch, run smoke). The test verifies the orchestrator → spawnAutomation → Claude Code → write deliverable.md → reverify chain works end-to-end with a one-line fix — but does NOT verify fix-mode handles a config typo or script bug. **A more rigorous test would corrupt `config.yaml` or break a script under `scripts/`.**

The DEVIATIONS file does not document this scope choice. It should.

### §0 / §0.3 process discipline

- Sprint artifacts present and substantive: DECISIONS (4 entries), DEVIATIONS (2 entries), FOLLOW-UPS (3 entries), external review (PASS verdict).
- FU-8 closure annotation correctly added to S4.1 FOLLOW-UPS.md.
- DEV-2 (MockTransport duplication) documented.
- DEV-1 (helpers extraction) documented.

## What's wrong

### V-1: §0.3 VIOLATION — premature ROADMAP-Done (must revert before merge)

The dev pre-marked **two** ROADMAP rows as **Done** before architect + CTO approval:

1. M9.6 milestone summary row (line 34): `In Progress` → `Done`.
2. S20 sprint row (line 1009): `Planned — unblocked` → `Done`.

The S20 plan explicitly states:

> **Roadmap commit:** lands AFTER architect + CTO approval per Phase 1 §0.3 rule. **M9.6 done.**

This is the same violation S16 made (and the CTO had to correct in `cf4cb78`). The pattern was supposed to be settled after S16; recurring is a regression. The dev's external review missed this entirely.

**Required action:** revert both lines to their pre-S20 wording. After this review and CTO sign-off land, then commit the ROADMAP edit as a separate `docs(roadmap): M9.6-S20 done — M9.6 closed (merged)` commit.

### V-2: missing DEVIATIONS entry for the over-scaffolded fix scenario

The four exit-gate tests use the simplest possible "broken state" (.enabled missing). The spec implied a more substantial corruption (`config.yaml`, `CAPABILITY.md`, or `scripts/` change). This is a scope deviation worth documenting. Add a DEV-3 entry explaining:

- Why `.enabled` was chosen (lowest-risk reproducible fix, doesn't require rolling back real plug damage).
- Acknowledgment that this is the easy case, not the hard case.
- Defer real corruption-test scope to a future sprint (or argue why the existing path is sufficient — both are acceptable, the deviation just needs to be on record).

### V-3 (informational): exit-gate tests are all SKIPPED in the test-run output

The full suite report shows 22 skipped tests in dashboard. The four new exit-gate test blocks are gated on `hasAuth + hasPlug + hasFixture` and skip cleanly when those aren't present. **The test suite shows zero-failed only because the new tests didn't run.**

This is by design — the tests target a real Claude Code session with real plugs and real Deepgram. But the dev's report and external review both say "1347 passed / 0 failed" without acknowledging that the four S20 exit-gate tests are part of the skipped count. The dev MUST run them on the dev machine with auth + plugs and report the output before merge. If they passed, the milestone exit gate holds; if they didn't, S20 doesn't close.

**Required action:** dev re-runs with `env -u CLAUDECODE node --env-file=packages/dashboard/.env node_modules/.bin/vitest run tests/e2e/cfr-exit-gate-automation tests/e2e/cfr-exit-gate-conversation tests/e2e/cfr-abbreviated-replays` and pastes the output into `s20-test-report.md` (currently absent — sprint has DECISIONS/DEVIATIONS/FOLLOW-UPS/review but no test report).

## Required changes

| ID | Change | Owner |
|----|--------|-------|
| **R1** | Revert ROADMAP M9.6 row + S20 row to pre-S20 wording. Re-commit only after CTO sign-off. | Dev |
| **R2** | Add DEV-3 to s20-DEVIATIONS.md documenting the `.enabled`-only fix scenario choice. | Dev |
| **R3** | Run the four exit-gate tests on the dev machine with auth + plugs. Paste output into a new `s20-test-report.md`. | Dev |

## Suggested (non-blocking)

| ID | Suggestion |
|----|-----------|
| S1 | The `initiate()` path in `conversation-initiator.ts:259+` has the same `let response = ""` dead-accumulator pattern FU-8 addressed for `alert()`. Out-of-scope for §2.5.0b per plan, but a candidate for whichever sprint picks up the broader mediator-pattern cleanup. |
| S2 | Duplicate imports in `cfr-exit-gate-helpers.ts:6-10` (`* as fs` + named symbols from `node:fs`). Cosmetic; pick one style. |
| S3 | The exit-gate tests do not verify `forensic.md` content — only that the file exists and is non-empty (via `assertTerseDeliverable`'s `expectForensic` flag). A future test could assert that the forensic file actually contains diagnostic prose (e.g., > 100 chars, contains "Hypothesis" or similar marker) to catch a degenerate case where the agent writes `forensic.md` as an empty stub to pass the assertion. |

## Verdict rationale

The four task implementations are correct. The three test-triage fixes are real root-cause fixes documented with commit traces. The FU-8 cleanup matches the planned shape. The terse-deliverable contract is correctly specified in SKILL.md with matching test coverage. The exit-gate E2E test files are structurally complete and use shared helpers as spec'd.

The §0.3 violation is a process regression (S16 made the same mistake), but it's an uncommitted edit — easily reverted. The over-scaffolded fix scenario is a scope deviation that needs to be on record but does not invalidate the test infrastructure. The exit-gate test execution status is unverified — the dev must report actual run output.

After R1-R3 are addressed, this is mergeable. Do not commit the ROADMAP-Done line until CTO has signed off.
