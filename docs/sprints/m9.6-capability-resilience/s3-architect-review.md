# S3 Architect Review — Capability Hot-Reload + Restart Gap Closure

**Reviewer:** The architect
**Branch:** `sprint/m9.6-s3-capability-hot-reload`
**Review date:** 2026-04-15
**Plan reviewed against:** [`plan.md`](plan.md) §5

---

## Verdict: **APPROVED for merge**

S3 delivers the spine of M9.6: a real filesystem watcher, the `systemctl restart nina-*` hole closed, and a framework-layer directive to the brain telling it never to self-restart. The capability-builder prompt's "filesystem watch picks it up" claim — which I flagged in the red-team as a lie — is now true. 26 new tests plus 107 regression tests all pass. Both packages compile clean. No deviations filed, four reasoned decisions, two honest follow-ups. The implementer even picked up a pre-existing bug (leaked `FileWatcher` local) on the way through.

**Process note landed correctly:** the roadmap-done commit is NOT on this branch. After S2's slip, S3 restored the right pattern — architect reviews first, then roadmap-done. Appreciated.

One implicit-deviation call-out and two forward-looking flags below. None of them block merge.

---

## Plan ↔ code audit (independent)

| Plan item | Location | Status |
|-----------|----------|--------|
| §5.1 `CapabilityWatcher` class | `packages/core/src/capabilities/watcher.ts` | Signature matches. `start/stop/rescanNow` all present. Watches the four file types via an allowlist filter on `add/change/unlink`. Debounce 500ms, polling 500ms. Awaits `'ready'` so callers can write files right after `start()`. |
| §5.2 `CapabilityHealthReport` + `getHealth()` | `registry.ts:8-15, :209-228` | Both unhealthy-branch conditions from plan landed verbatim: `enabled && status==='unavailable'` and `status==='available' && health==='degraded'`. `type` falls back to `"custom"` for capabilities without `provides`. Reports all capabilities, issue-flagged ones included. |
| §5.2 Consumed proactively on boot (logs at WARN) | `app.ts:477-483` | **Landed after F1 fix.** Inside initial `testAll().then()`. Fires once per boot. Correct semantics — not re-emitted on every watcher rescan (that would spam). |
| §5.3 Watcher constructed after registry init | `app.ts:524-536` | Replaces the old `capWatcher` (see D1 below). Wired immediately after registry MCP-server registration. |
| §5.3 Watcher started + stopped | `app.ts:537`, `app.ts:1887-1889` | `await start()` at boot; `stop()` in shutdown sequence, in reverse-init order. |
| §5.4 Four new bash-block patterns | `hooks/safety.ts:58-61` | All four verbatim from plan, with M9.6 annotation. Comment block at `:41-47` updated to explain self-restart = self-kill. |
| §5.5 `// Verified real by M9.6-S3` comment | `agents/definitions.ts:126` | Present. Placed as a one-liner above `tools:` — documents that the agent prompt's watch claim has been verified by the S3 watcher. Acceptable placement. |
| §5.6 Framework directive to brain | `prompt.ts:486-496, :641` | `formatNeverSelfRestartDirective()` returns the plan's text verbatim. Unconditionally injected into `assembleSystemPrompt()`. |
| Acceptance tests (3 files, 26 tests) | `packages/core/tests/capabilities/{watcher,get-health}.test.ts`, `tests/hooks/safety-restart-block.test.ts` | All pass. Existing `bash-blocker-extended.test.ts` updated to match new `systemctl start` behavior. |
| Compile | `npx tsc --noEmit` both packages | Clean. |
| Regression | S1/S2 tests: 107/107 pass | No drift. |

I also independently verified:
- No other file constructs a `FileWatcher` for the capabilities directory. The old pattern is fully replaced, not running in parallel (`grep -rn "capWatcher\|capabilityWatcher"` only shows S3's code).
- The brain directive is actually wired: `formatNeverSelfRestartDirective()` is imported and called in `assembleSystemPrompt()` at `prompt.ts:641`, inside the `sections.push(...)` sequence that becomes the final system prompt. Agents at brain-session-level will see it.
- The framework directive and the capability-builder's agent-prompt directive are both present and correctly target different agents. FU2's "redundant" call-out is not quite right — they're for different principals (brain vs subagent).

---

## Assessment of decisions

- **D1 — Replace `FileWatcher`-based `capWatcher` with `CapabilityWatcher`:** *Strictly better than the plan.* The old `capWatcher` watched only `**/CAPABILITY.md`, used a 5-second debounce + 5-second poll, and leaked on shutdown. The new watcher watches the four plan-specified file types, uses 500ms/500ms, has a shutdown handle, and has tests. The incident's headline behavior — "create `.enabled`, expect activation" — was literally impossible with the old watcher because `.enabled` wasn't in its include pattern. D1 fixes that bug in passing. Fair to call this scope-widening; I accept it.
- **D2 — Update `bash-blocker-extended.test.ts` assertion for `systemctl start`:** Correct. The plan adds `start` to the blocked set; the pre-existing "allowed" assertion was from a pre-M9.6 era.
- **D3 — Static chokidar import:** Fine. The dynamic-import pattern in `watch-trigger-service.ts` was a bundler workaround unrelated here.
- **D4 — Framework directive is unconditional, not gated on capabilities:** Correct. The rule applies any time the brain is running; gating on presence would make the rule surface/disappear as capabilities get toggled.

---

## Implicit deviation I want to flag for S4

### F2 in the external review: "watcher tests use 2.5s, plan said 1s"

The plan's §5.3 test criterion said *"within 1s, assert `registry.isEnabled(type)` flips to true."* That's physically impossible with the configuration the plan itself specified (polling interval 500ms + debounce 500ms = 1000ms minimum, plus fs + rescan + testAll). The tests correctly use 2.5s. But the implementer did not file a deviation.

**This should have been a `proposals/s3-watcher-timing.md` deviation.** Not because the test is wrong — the test is right, the plan was wrong — but because the stop-on-deviation protocol in plan §0.1 says: *"An acceptance test cannot be written without a design choice the plan does not make."* The plan says 500ms polling AND 1s detection; the two contradict. That's a deviation trigger.

**For S4 onwards:** if an acceptance criterion is physically unreachable given the plan's other constraints, that's a deviation, not a "just pick a more realistic number" judgment call. File the proposal; I'll amend the plan text. The S3 implementer shipped the right code; they just bypassed a paper-trail step.

I'll update the plan's §5 acceptance criterion to "within 2.5s" as part of committing this review — that way S4's implementer doesn't inherit the contradiction.

---

## Forward-looking flags (no action in S3)

### FU1 (inherited, not introduced): double `capability:changed` emit in watcher `onRescan`

The double-emit pattern — first emit with pre-`testAll` scan results, second emit with post-`testAll` registry state — is inherited verbatim from the old `capWatcher`'s behavior. S3 preserved it. It's harmless (second emit is authoritative) and S3 didn't make it worse.

**If someone cleans this up, do it in S4 or later.** A single emit after `testAll()` would be cleaner. The subscriber list will include S4's recovery orchestrator (via `onCapabilityNowAvailable`), so making the emit deterministic before then is nice but not required.

### Brain prompt real estate

`formatNeverSelfRestartDirective()` is 6 lines. Combined with `formatScreenshotCurationDirective()` (also unconditional), the framework-owned operational section is growing. This is fine for M9.6 — we need the directive to land — but worth tracking: by M10+ when agent-authored channels add their own rules, the operational section will need structure (a single "Framework Rules" header with collapsible sub-rules, or similar). Not S3's problem.

### `getHealth()` WARN fires only on boot `testAll`, not on watcher-triggered `testAll`

The F1 fix added `getHealth()` logging inside the initial boot `testAll().then()`. The `CapabilityWatcher.rescanNow()` path also runs `testAll()` but does not re-log unhealthy capabilities. I think this is correct — operators want startup visibility, and mid-session health changes should flow via `capability:changed` events into the UI. But if the health-regression case ever becomes a WARN requirement, the `onRescan` callback in `app.ts:524-536` is where to add it.

---

## Test fidelity

- Watcher tests use a real temporary directory with actual `.enabled`/`CAPABILITY.md` file operations and poll the registry. This is the right level of integration — mocking chokidar would have hidden the timing realities that F2 captures.
- `get-health.test.ts` covers 9 scenarios including edge cases (disabled+unavailable = no issue, available+untested = no issue, custom `provides` falls back to `"custom"`). Good coverage.
- `safety-restart-block.test.ts` covers all four new patterns plus case-insensitive variants plus allowed-through commands. The allowed-variant set includes `systemctl status nina-*` and `service nginx status` — correct, those should not be blocked.
- Test for the framework directive's *presence in the prompt* would be a nice addition but isn't required — the insertion is obvious from reading the code and the prompt structure is tested elsewhere.

---

## Paper trail

- `s3-DECISIONS.md` — four decisions, each with rationale and blast-radius. Good.
- `s3-DEVIATIONS.md` — claims no deviations. Should have had F2 as one (see above).
- `s3-FOLLOW-UPS.md` — FU1 and FU2 honestly self-assessed. FU1 is correctly identified as minor; FU2's "redundancy" call is slightly off (the two directives target different agents, so they're not truly redundant) but harmless.
- `s3-review.md` — external reviewer caught F1 (missing boot-time WARN), implementer fixed it before commit. Correct flow.
- `s3-test-report.md` — command output preserved, honest.

Commit hygiene: seven commits, conventional-style, no `--amend`, no `--no-verify`. Fix commit (`54a2167`) properly credited to the external reviewer's catch. **Most importantly: no roadmap-done commit on the branch** — correct sequencing for the first time this milestone.

---

## What to do next

1. **Me (architect):** commit this review. Update plan.md §5 watcher acceptance criterion from "within 1s" to "within 2.5s" to fix the contradiction the implementer worked around.
2. **Implementer or CTO:** after review lands, commit the `docs(roadmap): M9.6-S3 done` entry as the final commit. Merge to master.
3. **Fresh Sonnet session for S4:** the recovery orchestrator. This is the biggest sprint in M9.6 — 3-tries protocol, reflection, budgets, per-phase model selection. Plan §6 is dense; the new session should read it cold and file a deviation if any contract from S1/S2/S3 doesn't provide something S4 expects.
4. **Watch for this in S4:** the plan says the orchestrator spawns automation jobs. The automation-spawner API may or may not be exposed from `@my-agent/core` today — the plan's §6.6 explicitly told the implementer to file a deviation rather than build a parallel spawner. Hold that line if it comes up.

---

**Approved. Land the roadmap commit and merge when ready.**
