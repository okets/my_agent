# External Verification Report

**Sprint:** M9-S5 Capability Templates + Test Harness
**Reviewer:** External Opus (independent)
**Date:** 2026-04-03

---

## Spec Coverage

| Plan Task | Status | Evidence |
|-----------|--------|----------|
| A1 - Diagnose skill triggering | N/A (private file) | `.my_agent/` is gitignored; cannot verify from public repo |
| A2 - Fix skill frontmatter | N/A (private file) | Confirmed rewritten per sprint summary; not in diff |
| A3 - Test skill activation | N/A (manual) | Cannot verify from code review alone |
| B1 - Notebook reference | N/A (private file) | `.my_agent/notebook/reference/capabilities.md` is gitignored |
| B2 - Strengthen CLAUDE.md directive | PASS | `CLAUDE.md` updated with "invoke the capability-brainstorming skill immediately. Do not explain options -- build the capability." and template flow |
| B3 - Empty registry prompt footer | PASS | `loadCapabilityHints([])` returns message referencing brainstorming skill and "Do not explain -- build it." |
| C1 - Template directory | PASS | `skills/capability-templates/` created with 4 files |
| C2 - audio-to-text.md | PASS | Complete: script contract, input formats (OGG/WebM/WAV/MP3), output JSON, test contract, known providers, transport-agnostic, `template_version: 1`, security section |
| C3 - text-to-audio.md | PASS | Complete: script contract (synthesize.sh), OGG output, test contract, known providers, `template_version: 1` |
| C4 - text-to-image.md | PASS | Complete: script contract (generate.sh), PNG/JPEG output, test contract, known providers, `template_version: 1` |
| C5 - _bundles.md | PASS | Voice = audio-to-text + text-to-audio; Full multimedia = all three; trigger phrases documented |
| D1 - registry.test() method | PASS | `registry.test(type)` implemented, runs `testCapability()`, returns `CapabilityTestResult` |
| D2 - health field on Capability | PASS | `health: 'healthy' \| 'degraded' \| 'untested'` added to type, plus `degradedReason`, `lastTestLatencyMs` |
| D3 - Validate on activation | PASS | `testAll()` called after re-scan in file watcher callback; non-blocking (`.then()/.catch()`) |
| D4 - Validate on startup | PASS | `testAll()` called after initial scan in `App.create()`; non-blocking (`.then()/.catch()`) |
| D5 - Expose test-on-demand | PASS | `registry.test(type)` callable from debug API: `POST /api/debug/capabilities/test/:type` and `POST /api/debug/capabilities/test-all` |
| D6 - Health in system prompt | PASS | Format: `[healthy, 1.2s]`, `[degraded: 401 Unauthorized]`, `[untested]` -- matches spec |
| E1 - Builder prompt template precedence | PASS | Builder prompt includes "template's script contract takes precedence over generic conventions" |
| E2 - Builder prompt test harness | PASS | "Your work is not done until the framework's test harness passes against your script." |
| E3 - Brainstorming skill globs for templates | N/A (private file) | `.my_agent/.claude/skills/` is gitignored |
| E4 - Brainstorming skill composites | N/A (private file) | Gitignored |
| E5 - Brainstorming skill self-healing | N/A (private file) | Gitignored |

**Summary:** 15/15 verifiable public tasks PASS. 6 tasks are in `.my_agent/` (gitignored, private) -- reported as implemented per sprint summary but not independently verifiable from the diff.

---

## Test Results

```
Test Files  1 passed (1)
     Tests  29 passed (29)
  Duration  1.28s
```

Tests cover:
- Scanner: discovery, frontmatter parsing, env var checking (process.env + .env file), MCP config expansion, malformed file handling, empty directory
- Registry: load, has, get (preference for available), list, rescan, getContent, getReference
- Prompt hints: empty registry footer, healthy/degraded/untested formatting, unavailable with reason, mixed capabilities, provides vs custom display
- resolveEnvPath

**TypeScript compilation:**
- `packages/core` -- clean (no errors)
- `packages/dashboard` -- clean (no errors)

---

## Browser Verification

Skipped -- sprint is pure backend/framework work with no UI changes to HTML/CSS/JS.

---

## Traceability Matrix Verification

Each row in the plan's traceability matrix was checked against the implementation:

| Design Ref | Requirement | Verified |
|------------|-------------|----------|
| Adversary S1 | Skill activation root cause | N/A (private files) |
| Adversary S3 | Notebook reference in prompt | N/A (private file, but B3 empty-registry footer verified) |
| Adversary S7 | "NEVER explain -- DO it" | PASS -- CLAUDE.md and prompt footer both enforce |
| Adversary S2 | Template transcoding responsibility | PASS -- audio-to-text.md: "script MUST handle all formats, transcode if needed" |
| Adversary S5 | Template vs builder conflict | PASS -- "template's script contract takes precedence" |
| Adversary S9 | Test all input formats | PASS -- test contract in template; harness generates WAV fixture |
| Adversary S10 | Multi-capability composites | PASS -- `_bundles.md` covers voice and full multimedia |
| Adversary S6 | Validation-on-activation | PASS -- testAll() after rescan in file watcher |
| Advocate S1 | Templates transport-agnostic | PASS -- no channel names in any template |
| Advocate S15 | Template versioning | PASS -- all templates have `template_version: 1` |
| Advocate S11 | MCP absorption gap | Deferred (as planned) |
| Templates Proposal | Framework-authored contracts | PASS -- 3 templates + bundles |
| Templates Proposal | Notebook reference | N/A (private file) |
| Templates Proposal | Builder follows template | PASS -- prompt updated |
| Capability Design Spec | Error handling with health | PASS -- types, prompt display, self-healing (private) |

---

## Gaps Found

### 1. `setProjectRoot()` never called (minor)

`CapabilityRegistry.setProjectRoot()` exists but is never called in `packages/dashboard/src/app.ts`. The `projectRoot` parameter is threaded through to test functions but none of the three concrete test contracts actually use it (all use `/tmp` paths). Functionally harmless -- dead infrastructure code. If a future test contract needs to locate template files or project-relative resources, this will need wiring.

### 2. New debug endpoints not in `/api-spec` (minor)

The three new capability debug endpoints (`GET /capabilities`, `POST /capabilities/test/:type`, `POST /capabilities/test-all`) are functional but not listed in the `/api-spec` endpoint's debug section. This means agent self-discovery of these endpoints will miss them.

### 3. No unit test for `testCapability()` function (moderate)

The test harness (`test-harness.ts`) is 232 lines of new code with no direct unit tests. The file is exercised only indirectly via `registry.test()` calls from the debug API at runtime. A unit test with a mock script would catch regressions in JSON validation, exit code handling, and fixture generation logic.

### 4. Test harness `ffprobe` validation mentioned in template but not implemented (minor)

The `text-to-audio.md` template test contract specifies "check with ffprobe -- exits 0" but the actual `testTextToAudio()` in `test-harness.ts` only checks file existence and minimum size (100 bytes). Not a spec violation (the harness is a subset of the template's ideal), but worth noting.

### 5. `CapabilityTestResult` not exported from package root (minor)

`CapabilityTestResult` is exported from `capabilities/index.ts` but not re-exported from `lib.ts`. Currently only used internally by the registry, so no immediate issue. External consumers would need to add the type export if they want to type-check test results.

---

## Verdict

**PASS**

The sprint delivers all planned public-repo artifacts: three capability templates with complete contracts, test harness with health tracking, registry test methods, non-blocking startup and rescan validation, debug API endpoints, prompt integration with health display, and builder agent prompt updates. TypeScript compiles cleanly, all 29 tests pass, and the traceability matrix maps correctly to implemented code.

The gaps found are minor (dead code, missing api-spec entries, no direct unit test for the harness). None affect correctness or the sprint's stated goals. The private-file changes (Phase A, B1, E3-E5) cannot be independently verified but are consistent with the framework code changes.
