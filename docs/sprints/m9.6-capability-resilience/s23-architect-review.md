---
sprint: M9.6-S23
reviewer: architect (opus)
date: 2026-04-21
verdict: APPROVE WITH CHANGES (cosmetic only — no code rework)
---

# S23 Architect Review

## Verdict: APPROVE WITH CHANGES (cosmetic only)

Mode 3 detection is proven end-to-end against a real broken plug. The live retest captures the exact SDK shape, confirms the pre-existing allow-list was already correct, and the new integration test locks the conversation-origin chain against regression. One tiny code-quality nit and one documentation correction are all that stands between this and an unconditional APPROVE — nothing is blocking M9.6 close.

## What's right

### Implementation matches the plan precisely

- **Diagnostic log at entry of `processSystemInit`** (`mcp-cfr-detector.ts:133-136`) — fires immediately after the `isInitSystemMessage` guard, captures the full `mcp_servers[]` payload via `JSON.stringify`. At `console.debug` level so it's cheap in production and available for future diagnoses. Matches §2.8 file spec exactly.
- **Positive allow-list** (`mcp-cfr-detector.ts:145`) — `FAILED_STATUSES = new Set(["failed", "needs-auth", "disabled"])` with a block comment explaining the defensive design choice (new SDK states won't silently trigger false CFRs). Semantically identical to the previous dual `connected|pending` skip + implicit accept, but intent is now explicit and reviewable. Matches plan guidance to "use a positive match against an allow-list, not negative match against `connected/pending`."
- **Try/catch around `cfr.emitFailure(...)`** (`mcp-cfr-detector.ts:165-181`) — wraps the emit, catches `originFactory` throws, logs via `console.error` with the capability name, continues the loop for remaining entries. This is a real bug fix beyond the plan: without it, an unpromoted session context at `system_init_raw` time would propagate an exception up through `processSystemInit` and could kill the session-manager's `for-await` loop. Good defensive move.
- **No matcher widening required.** Live capture (`s23-test-report.md` §Phase 2) shows the SDK emits `{"name":"browser-chrome","status":"failed"}` for a crash-at-boot MCP server — matches the existing allow-list exactly. S12 spike prediction was correct. Plan said "don't widen the guard speculatively — only adjust to match observed reality." The diff holds the line.

### Live retest is genuine and passes all six conditions

The transcript in `s23-test-report.md` §Phase 3 shows the full chain working against a real break:
- (a) Debug log fires with the `browser-chrome` failed entry — PASS
- (b) CFR emits proactively from `processSystemInit` with no tool call needed — PASS
- (c) Fix-mode agent spawns (two attempts observed) — PASS
- (d) `terminal-fixed` ack delivered after fix — PASS
- (e) Original simple prompt "What time is it?" is answered correctly despite the broken MCP — PASS (system-origin failure does not gate the conversation, as designed)
- (f) Subsequent explicit-browser prompt succeeds — PASS per CTO confirmation

The break method (renaming `entrypoint` to a non-existent script so the MCP process exits before the stdio handshake) is a clean (b)-shape corruption — this is exactly the surface S22's first retest attempts accidentally hit with no detection. S23 now detects it.

### Suite results verified

I ran both suites fresh:

| Package | Passed | Failed | Skipped | Matches report |
|---------|--------|--------|---------|----------------|
| core | 687 | 0 | 9 | ✓ |
| dashboard | 1375 | 0 | 24 | ✓ |

The new `cfr-mode3-init-detection.test.ts` (5 tests) runs in 39 ms and all pass. The existing `mcp-cfr-detector.test.ts` (22 tests) still passes under the refactored code — idempotence, allow-list behavior, and non-init no-op cases all still hold.

### Integration test is well-scoped

`cfr-mode3-init-detection.test.ts` is the right shape for the wiring gate in the plan:
- It assembles the real `McpCapabilityCfrDetector` + `CfrEmitter` + `RecoveryOrchestrator` + `AckDelivery` + `CapabilityRegistry` graph. Not a mock-heavy unit test — this is an integration of the conversation-origin chain.
- It uses a plausible `originFactory` built on a `sessionContexts` map keyed by `activeSdkSessionId`, mirroring the production shape. The originFactory-throws test exercises the S23 try/catch fix directly and proves the for-await loop is guarded.
- It verifies the ack actually routes through `AckDelivery.broadcastToConversation` with the correct `conv-mode3` id and does not hit `transportManager.send` (correct per current dashboard-channel ack routing).
- Idempotence test re-submits the same frame and confirms `spawnAutomation` is only called once, guarding the `initEmitted` Set contract.

### Test report is honest about the retryTurn oddity

§Phase 3 "Observation: retryTurn fires for Mode 3" flags the spurious double-answer ("Still 12:51 AM. You asked twice — everything okay?") and correctly routes it to FOLLOW-UP-1 rather than hiding it. The rationale (Mode 3 origin is `kind: "conversation"` so `getInteraction(type) === "tool"` triggers retryTurn, but the brain already answered via fallback) is architecturally accurate. Not a blocker — the core detection and recovery work correctly.

## What's wrong

Nothing blocking. Two minor issues:

### Minor: `FAILED_STATUSES` Set allocated inside the loop

`mcp-cfr-detector.ts:145` — the `new Set([...])` is allocated on every iteration of `for (const entry of systemMessage.mcp_servers)`. In practice `mcp_servers[]` has ~13 entries per init frame and `processSystemInit` fires once per session-init, so this is a few hundred wasted allocations per day, not a performance issue. But it's a code-quality nit: the set is a compile-time constant and belongs at module scope (next to `isStructurallyEmptyMcpResult` helpers at the bottom of the file).

### Minor: DEV-1 wording is slightly misleading

`s23-DEVIATIONS.md` DEV-1 says the existing `mcp-cfr-detector.test.ts` "already has comprehensive `processSystemInit` coverage (10 tests covering all three plan cases)." I count **11** `processSystemInit` tests in that file (lines 348, 371, 384, 397, 410, 425, 444, 458, 471, 486, plus the implicit coverage in the earlier describe blocks). Not a correctness problem — the decision to skip a duplicate unit test file is sound because the existing coverage genuinely does cover the plan's (a), (b), (c) cases. Just a docs typo.

## Required changes

| ID | Change | Owner |
|----|--------|-------|
| RC-1 | Hoist `FAILED_STATUSES` Set to module scope (outside `processSystemInit` loop) — pure cosmetic, no behavior change | S23 dev |
| RC-2 | DEV-1 test count — either verify the count or change "10 tests" to the correct number (current file has 11 processSystemInit tests) | S23 dev |

Both can land in a single "docs+cosmetic" commit — no test re-run needed, no live retest needed.

## Suggested (non-blocking)

- **FOLLOW-UP-1 deserves a concrete M10 ticket now.** The retryTurn double-answer for Mode 3 is the kind of thing that gets lost if it's only in a follow-ups file. Worth adding to ROADMAP.md M10 as a named user-visible bug with a chosen option (Option 2 — `origin.kind === "system"` for Mode 3 — is architecturally cleaner than smuggling a `turnSucceeded` flag into `TriggeringInput`).
- **Diagnostic log naming.** `[CfrDetector]` is a good prefix. If M10 adds more detectors or broadens the brand, consider `[CfrDetector.mcp]` or similar to distinguish from hypothetical script/stdio detectors. Not today's work.
- **No `error` field in the captured payload.** The live capture (`s23-test-report.md` §Phase 2) notes "no `error` field present when the entrypoint script doesn't exist (process exits before stdio handshake)." The fallback "MCP server failed to start" string is fine for the ack, but future Mode 3 diagnostics would be more useful if the detector also logged the process exit code or stderr if the SDK exposes either. Out of scope for S23, but worth considering when the S12 spike artifacts are revisited.
- **Framing idea for docs:** Mode 3's `origin = conversation` is a deliberate UX choice (the user deserves feedback that something system-level is broken mid-turn), but the retryTurn miss is the hidden cost. Documenting this tension in `capability-resilience-v2.md` (or a short ADR) would help future sprints understand the trade-off rather than "fixing" it naively.

## Milestone exit assessment

Per §2.8 "Milestone exit": **S23 acceptance gates green + S22 still green + live retest signed off by CTO + architect approval. M9.6 closes here.**

| Gate | Status | Evidence |
|------|--------|----------|
| Diagnostic captures SDK shape | ✓ GREEN | `[CfrDetector] processSystemInit` log in `mcp-cfr-detector.ts:133-136`; live payload captured in `s23-test-report.md` §Phase 2 |
| Matcher fix lands (or confirmed unnecessary) | ✓ GREEN | D1 documents the no-change decision with diagnostic evidence; allow-list now explicit Set with rationale comment |
| Wiring proven (integration test) | ✓ GREEN | `cfr-mode3-init-detection.test.ts` — 5 tests, all pass, covers conversation-origin chain end-to-end including the try/catch fix |
| Suite green (both packages 0 failed) | ✓ GREEN | Verified fresh: core 687/0/9, dashboard 1375/0/24 |
| Live retest | ✓ GREEN | All 6 pass conditions met per transcript + CTO observation 2026-04-21 20:51–20:54 UTC |
| S22 still green | ✓ GREEN | S22 architect review APPROVE WITH CHANGES (cosmetic), no code rework outstanding; master HEAD includes S22 live-test PASS commit `8d24e7a` |
| Live retest signed off by CTO | ✓ GREEN | `s23-test-report.md` §Phase 3 names the CTO and records confirmation |
| Architect approval | ✓ GREEN (this review) | APPROVE WITH CHANGES (cosmetic) |

### Framework matrix coverage

The promise of M9.6 is "any plug-side failure is recoverable." Post-S23 the matrix is:

|                     | Mode 1 (tool exception) | Mode 2 (child crash mid-call) | Mode 3 (server crashes at startup) |
|---------------------|:-----------------------:|:-----------------------------:|:----------------------------------:|
| Input (STT)         | N/A (no tool surface)   | N/A                           | N/A (script-based)                 |
| Output (TTS, image) | N/A                     | N/A                           | N/A (script-based)                 |
| Tool (browser, desktop) | ✓ S12 + S22 live    | ✓ S12 + S22 live              | ✓ S23 live                         |

The three MCP failure modes are covered for the tool-capability shape (where they apply). Input/output plugs are script-based and have their own reverify/fix-mode paths covered in Phase 1/Phase 2. Mode 3 for non-MCP capabilities is explicitly out of scope per §2.8 "Out of scope" — filed as M10-candidate if it surfaces.

### Ready for close

**M9.6 meets the exit criteria.** Nothing is blocking. The only items between "now" and "merge commit" are:

1. Land RC-1 (hoist Set) and RC-2 (DEV-1 wording fix) in a single cosmetic commit.
2. Commit the S23 artifacts (four new docs + one code change + one new test) on master.
3. Optionally file the FOLLOW-UP-1 retryTurn issue as an M10 ticket (not a blocker for close — it's already in `s23-FOLLOW-UPS.md`).

The ROADMAP.md line "M9.6 CLOSED 2026-04-21 — M10 UNBLOCKED" (from commit `69695f0`) was written **before** S22 and S23 surfaced and should now be verified against the final sprint set — if S22 and S23 aren't reflected in the roadmap table (they won't be, commit `69695f0` landed before S22 existed), the roadmap needs a follow-up edit to include S22 and S23 in the M9.6 sprint list. That's a docs hygiene item, not a gate.

M9.6 is done. Ship it.
