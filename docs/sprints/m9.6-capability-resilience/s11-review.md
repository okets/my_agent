---
sprint: m9.6-s11
title: Template Smoke Fixtures — External Review
verdict: APPROVED
---

# M9.6-S11 External Review

**Branch reviewed:** `sprint/m9.6-s11-template-smoke-fixtures`
**Head:** `437d892 docs(m9.6-s11): add signature deviation note + update _bundles.md smoke.sh reference`
**Reviewer:** external reviewer (Opus)
**Date:** 2026-04-17

## Summary

S11 delivers exactly what `plan-universal-coverage.md` §12.3 and §11 ask for: `fallback_action` frontmatter + a "Smoke Fixture" contract section on all five templates, full working `smoke.sh` reference implementations on the three script-plug templates, a clearly labelled minimal stub on the two MCP templates, and an exported `runSmokeFixture` in `reverify.ts` with four focused unit tests. All 492 core tests pass (9 pre-existing skips), `npx tsc --noEmit` is clean, and every deviation from the plan is documented inline or in a prior commit.

## Spec compliance

| Requirement (plan §12.3 / §11) | Status | Evidence |
|---|---|---|
| `fallback_action: "could you resend as text"` on `audio-to-text` | PASS | `skills/capability-templates/audio-to-text.md:5` |
| `fallback_action: "you can read my last reply above"` on `text-to-audio` | PASS | `skills/capability-templates/text-to-audio.md:5` |
| `fallback_action: "try again in a moment"` on `text-to-image` | PASS | `skills/capability-templates/text-to-image.md:5` |
| `fallback_action: "try again in a moment"` on `browser-control` | PASS | `skills/capability-templates/browser-control.md:7` |
| `fallback_action: "try again in a moment"` on `desktop-control` | PASS | `skills/capability-templates/desktop-control.md:6` |
| "Smoke Fixture" section on all 5 templates with contract + reference `smoke.sh` | PASS | audio-to-text.md:88, text-to-audio.md:79, text-to-image.md:78, browser-control.md:345, desktop-control.md:356 |
| Script-plug templates ship full working `smoke.sh` (not stubs) | PASS | Each STT/TTS/T2I smoke script generates or consumes a deterministic fixture, invokes the contract script, validates JSON via `jq -e`, and (for TTS/T2I) verifies the output file size. Cleanup via `trap ... EXIT`. |
| MCP templates ship contract spec + minimal stub (full version deferred to S14) | PASS | Both browser-control and desktop-control list a 5-step contract and ship a stub that runs `detect.sh` + spawns `npx tsx src/server.ts` under `timeout 10s` and confirms the server survives 3 s. Clearly marked "replace with full version in S14." |
| `runSmokeFixture(capDir, registry, capabilityType)` exported from `reverify.ts` | PASS | `packages/core/src/capabilities/reverify.ts:231-263` |
| Runs `smoke.sh` as direct `execFile` subprocess (not bash wrapper) | PASS | `execFileAsync(smokeScript, [], { timeout, cwd, env })` at reverify.ts:253. The top-level `execFile`/`promisify` import (reverify.ts:11-20) is dedicated to this function; the legacy audio-to-text fallback path keeps its dynamic import unchanged. |
| Falls back to availability check with warning when `smoke.sh` missing | PASS | reverify.ts:238-250; warning text contains "template gap". |
| 4 unit tests covering all branches | PASS | `packages/core/tests/capabilities/run-smoke-fixture.test.ts` — exit 0, exit 1, absent+available, absent+unavailable. |
| `_bundles.md` updated to reference `smoke.sh` | PASS | `skills/capability-templates/_bundles.md:36` |
| Roadmap marked Done | PASS | `docs/ROADMAP.md:997` |

## Deviations from plan

All deviations are documented inline and non-blocking:

1. **`runSmokeFixture` signature.** Plan §12.6 sketches `runSmokeFixture(failure, registry)`. Shipped signature is `(capDir, registry, capabilityType)` so the caller resolves `capDir` before calling. Rationale: `runSmokeFixture` has no need for the full `CapabilityFailure` shape — only `capDir` and `capabilityType`. Deviation recorded at `packages/core/src/capabilities/reverify.ts:227-229` with an explicit note that S14 should adopt this signature. Low risk: S14 is the wiring sprint and will author the dispatcher against whichever signature it finds.
2. **MCP stub uses `sleep 3` (plan says `sleep 2`).** Commit `34645bc` raised the wait to 3 s and added clarifying comments about stdout/stderr suppression. This is a reliability improvement; `timeout 10s` still bounds the overall runtime.
3. **`multi_instance` field not added to the four non-browser templates.** Plan §12.3 bullet 3 says templates add `multi_instance: boolean` (defaults false; set to true only on `browser-control`). Only `browser-control.md` declares the field (= `true`); the other four omit it (default behaviour). This matches the plan's "defaults false" clause and the S11 sprint plan itself does not list `multi_instance` as a per-step change — the field shape is lexically introduced, S15 is where it matters. Not a blocker; logged here so future work can explicitly set `multi_instance: false` if `registry.isMultiInstance()` ever becomes strict.

## Quality checks

- **Smoke fixture contracts.** STT contract notes that a sine wave won't transcribe meaningfully but smoke still exits 0 on empty-string text — correctly framed as a liveness check, not a quality check. TTS/T2I contracts pick small byte-count thresholds (100 / 1000) that are defensible as "file exists and is non-trivial" without being tied to any specific encoder. MCP stubs are honest about their scope ("meaningful liveness coverage, but does not exercise any MCP tools").
- **Test quality.** Four tests, one assertion per branch, no implementation-detail leakage. The registry stub at `tests/capabilities/run-smoke-fixture.test.ts:20-27` is minimal and correct. `afterEach(() => vi.restoreAllMocks())` is in place so the `console.warn` spy does not leak. Uses real filesystem under `os.tmpdir()` which is the right trade-off for a function that spawns a subprocess.
- **Imports.** Top-level `execFile` / `promisify` at reverify.ts:11-14 is the right shape for a function that will be called often (S14 dispatcher). The older dynamic-import path inside `reverifyAudioToText` is left alone per the file comment.
- **Error surface.** `smoke.sh failed: ${message}` uses `err.message` which, for `execFile` rejections, includes the command, exit code, and stderr tail. That's enough detail for the orchestrator to log without leaking the whole stderr.

## Gaps found

None that block merge.

Minor forward-looking items (not S11 scope):

- S14 must resolve the `runSmokeFixture` signature mismatch in the dispatcher. The inline deviation note covers this.
- If `registry.isMultiInstance()` is ever tightened to require an explicit `multi_instance: false` in frontmatter (rather than treating absent as false), the four non-browser templates will need one-line updates. Today's behaviour is correct.

## Verdict

**APPROVED.** S11 meets the plan's acceptance criteria (`ls .../capability-templates/*.md` and confirm each contains "smoke.sh" and "fallback_action" — all five pass), ships one new exported function with four green unit tests, leaves no TypeScript errors, and introduces zero regressions in the broader test suite. Deviations are documented and defensible. Ready to merge.
