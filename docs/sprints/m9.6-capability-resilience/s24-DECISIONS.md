---
sprint: M9.6-S24
title: Decisions
date: 2026-04-21
---

# S24 Decisions

## D1 — RC-1 was already applied; duplicate guard line removed instead

**Decision:** `FAILED_STATUSES` is already a module-scope constant in `packages/core/src/capabilities/mcp-cfr-detector.ts` (defined at `:140`). The architect's RC-1 (hoist the Set out of the loop) is a no-op — the set was hoisted during S23 development before the review landed. What the review call out *did* surface was a duplicate guard line in the loop at `:145-147`:

```ts
if (entry.status === "connected" || entry.status === "pending") continue;
if (!FAILED_STATUSES.has(entry.status)) continue;
if (!FAILED_STATUSES.has(entry.status)) continue;  // <-- duplicate
```

The duplicate was removed instead.

**Why:** Following the architect's intent (clean up the loop body, no behavioural change) while acting on the actual code gap that existed. Hoisting a constant that was already hoisted would have been a no-op diff; the duplicate guard was the real cosmetic issue.

**How to apply:** Before implementing an architect-requested change, verify against the current code rather than the review's quoted line numbers — reviews are snapshots and the plan may have already absorbed the fix.

## D2 — RC-2 test count: architect miscounted; actual is 10

**Decision:** `s23-DEVIATIONS.md` DEV-1 wording keeps the plural phrasing but the count is **10**, not 11. Verified by `grep -n "^\s*it(" packages/core/tests/capabilities/mcp-cfr-detector.test.ts | wc -l` scoped to the `processSystemInit` describe blocks.

**Why:** The architect review asserted "11 processSystemInit tests" with specific line numbers cited (348, 371, 384, 397, 410, 425, 444, 458, 471, 486 + "plus implicit coverage"). Direct grep against master returned 10 discrete `it(...)` calls inside the `processSystemInit` describe blocks. The "plus implicit" note in the review implies the count of 11 included coverage that is not a distinct test case — the DEV-1 wording was already correct at 10.

**How to apply:** When an architect review cites a count, verify it by grep before amending — reviewers can miscount when scanning a long test file, and correcting a number is cheaper than propagating a wrong one.

## D3 — `isInFlight()` added as a public query on RecoveryOrchestrator

**Decision:** Add `isInFlight(capabilityType: string): boolean` as a public method on `RecoveryOrchestrator` (`packages/core/src/capabilities/recovery-orchestrator.ts:137-143`). Returns `this.inFlight.has(capabilityType)`. The underlying `inFlight` Set remains private.

**Why:** The daily probe (`capabilityHealthCheck` in `app.ts`) needs to skip emitting CFR for capabilities already mid-recovery. Without this gate, the probe would emit a fresh attempt ack every 24h for the same failing capability and produce duplicate `in-progress` entries in the ring buffer. The S12 `inFlight` mutex already dedups at the orchestrator, but that happens *after* AckDelivery writes the initial entry — pre-checking at the probe keeps the ring buffer clean.

**Alternative considered:** Exposing the full Set via a `getInFlightCapabilities()` getter. Rejected — callers need a boolean answer for a specific type, not enumeration. Smaller surface, smaller leak of internal state.

**Test pattern:** The new test in `orchestrator-state-machine.test.ts` uses the same mirror-app pattern as `cfr-ack-delivery-wiring.test.ts` — build real deps, hold `spawnAutomation` on a promise gate, assert `isInFlight(type)` is true during the fix session, false after the gate releases.

## D4 — System-origin terminal drain: new `recordSystemOutcome` API + outcome union widening

**Decision:** Three coupled changes:

1. `SystemCfrEvent.outcome` union widened from `"in-progress" | "surrendered"` to `"in-progress" | "fixed" | "surrendered"` (`ack-delivery.ts:204`).
2. New `AckDelivery.recordSystemOutcome({component, capabilityType, ..., outcome})` method (`ack-delivery.ts:466-503`). Transitions the most recent matching in-progress entry in place (by component + capabilityType); appends a fresh terminal entry if no in-progress predecessor exists.
3. `RecoveryOrchestrator`'s system-origin drain (`recovery-orchestrator.ts:720-747`) now calls `deps.recordSystemOutcome({...})` after logging. The dep is optional — when absent the drain warns and legacy log-only behaviour is preserved.

**Why:** Pre-S24, the drain only logged. The ring buffer accumulated initial `in-progress` entries from `AckDelivery.deliver()` but never transitioned them. The brief composer (and any Debug/Admin surface reading `getSystemEvents()`) would show capabilities stuck in `in-progress` forever. The `debrief-reporter` System Health section explicitly filters on `outcome === "fixed"` or `"surrendered"` — without the transition, the section would always be empty.

**Alternative considered:**

- *In-place mutation vs append* — chose in-place transition on match, append-as-fallback when no in-progress predecessor exists. The alternative (always append a second row) would double the ring-buffer footprint and force downstream filters to dedupe by (component, capabilityType, timestamp-window). The chosen shape keeps one row per failure episode.
- *Moving the recordSystemOutcome call into the orchestrator's try/catch ladder* — kept it outside the per-origin try/catch so a ring-buffer write failure doesn't swallow the outcome log. The `deps.recordSystemOutcome` implementation is responsible for its own defensive behaviour (app.ts wraps it with a null-guard on `app.ackDelivery`).

**How to apply (for future sprints):** This method is the only sanctioned way to transition a system-origin ring-buffer entry. Don't push a second entry for the same (component, capabilityType) pair — use `recordSystemOutcome` so existing in-progress rows are rewritten in place.

**Pre-existing gap closed:** This fix closes a latent gap predicted by `plan-phase3-refinements.md` §2.9.3: even without S24, S23's Mode 3 detection emits system-origin CFRs at session init, and those rows were pinned at `in-progress` under the old drain. The drain change is additive (new outcome write) and does not regress S23's Mode 3 detection path — verified by the S23 suite running green on this branch.

## D5 — Heartbeat wiring: use `app.cfr.emitFailure()`, not the plan's `orchestrator.emitFailure()`

**Decision:** The `capabilityHealthCheck` callback in `app.ts:2152-2173` calls `app.cfr.emitFailure({...})` directly. The plan (§2.9.1) showed `orchestrator.emitFailure({...})` in the example code, but `RecoveryOrchestrator` has no such method — CFR emission flows through the `CfrEmitter` (`app.cfr`), which every other emission site in the codebase uses (`mcp-cfr-detector.ts`, `script-plug-probe.ts`, automation post-tool hooks, etc.).

**Why:** The plan's example code was a stale spec — `emitFailure` is the `CfrEmitter`'s method, not the orchestrator's. The orchestrator *receives* failures via `onFailure` wired to `app.cfr.on("failure", ...)` and never emits them itself. Using `app.cfr.emitFailure()` is consistent with every other CFR emission site and keeps the wiring uniform (the orchestrator stays a consumer, not a producer).

**How to apply:** Future sprints adding new CFR emit sites should use `app.cfr.emitFailure(...)` from anywhere with access to the app handle. The `CfrEmitter` is the single entry point for the CFR pipeline.

## D6 — `testAll()` MCP coverage: no fix needed — manifests and harness already correct

**Decision:** No changes to `.my_agent/capabilities/browser-chrome/CAPABILITY.md`, `.my_agent/capabilities/desktop-x11/CAPABILITY.md`, or `packages/core/src/capabilities/test-harness.ts` — all three are already correct. The plan (§2.9.4) asked to "verify + fix if needed"; verification found no gap.

**Why:**

- Both MCP manifests already declare `provides: <type>` and `interface: mcp` in their YAML frontmatter. They pass `testAll()`'s `c.status === "available" && c.provides` filter today.
- `testCapability()` in `test-harness.ts` structurally cannot return `health: "untested"` from a missing dispatch entry. It dispatches on `interface`: `"script"` goes through `TEST_CONTRACTS`, `"mcp"` goes through `testMcpCapability` (spawn + handshake + tool list), and any other interface returns a typed `error` result. A capability can only stay at `untested` if `testAll()` itself is never called — never because of a silent dispatch gap.
- The new `test-harness-mcp-coverage.test.ts` asserts exactly this: for every currently-installed capability type, `testCapability()` returns `ok` or `error` with a meaningful message, never silent `untested`.

**Alternative considered:** Adding a `TEST_CONTRACTS` entry for a hypothetical future script-based browser plug. Rejected — no such plug exists today and the test harness is already robust to missing contracts (returns a typed error). Adding a speculative contract entry would violate the "don't design for hypothetical future requirements" rule.

**How to apply:** This decision documents that the gap class predicted by the audit does not exist in the current tree — future sprints adding new `interface:` values should add both the dispatch branch in `testCapability()` *and* a coverage test in `test-harness-mcp-coverage.test.ts` to keep the invariant visible.

## D7 — Brief integration: `formatSystemHealthSection()` added to `handler-registry.ts`, omit section when both workers AND system-health are empty

**Decision:** Three coupled changes:

1. New exported function `formatSystemHealthSection(ackDelivery)` in `packages/dashboard/src/scheduler/jobs/handler-registry.ts:307-336`. Reads the ring buffer via `getSystemEvents()`, filters for `outcome: "fixed" | "surrendered"` (in-progress entries are intentionally skipped), emits a `## System Health` section with two sub-lists ("Self-healed:" and "Surrendered:"). Returns empty string when no fixed/surrendered events exist.
2. `BuiltInHandler` ctx type extended with optional `ackDelivery?: AckDelivery` (`:56-65`). Passed through by `AutomationExecutor.config.ackDelivery` to every handler invocation.
3. The `debrief-reporter` early-return path (`:399-410`) now fires only when BOTH `workerSections.length === 0` AND `systemHealthSection === ""`. Previously the no-workers path returned immediately; now a system-health-only brief is allowed to proceed.

**Why:**

- The plan (§2.9.5) called for a standalone section append; extracting it as a pure function (`formatSystemHealthSection`) keeps the handler body readable and makes the three-case test coverage (empty / fixed / surrendered) straightforward to write without standing up a full handler fixture.
- The early-return change is the core of the user-visible contract: *"the user should not be bothered with internal fixes if they are done in the background"* — but they SHOULD see what self-healed overnight. If workers ran OR system-health has entries, the brief must run. Both empty → skip.
- `in-progress` entries are filtered out because the daily probe runs once a day — any entry still at `in-progress` when the brief runs means the fix session hasn't terminated yet, which is not a user-facing health update.

**Alternative considered:**

- *Injecting `AckDelivery` directly into the `debrief-reporter` handler closure* — rejected. Handlers are registered at module scope (`registerHandler(...)` runs on import), so they can't capture a runtime-constructed `AckDelivery` without a factory pattern. Passing via the per-invocation ctx is cleaner and lets other handlers consume it in the future without rewiring.
- *Instance-level `.my_agent/automations/cfr-self-heal-summary.md`* — rejected per the plan's framework-level constraint.

**How to apply:** When adding new framework-level data to the daily brief, extend the `BuiltInHandler` ctx type and plumb through `AutomationExecutor.config`. The `formatSystemHealthSection` pattern (pure function, empty-string sentinel for omitted sections) is the template — callers append unconditionally and rely on the empty-string return.

## D8 — 24h timestamp filter added to formatSystemHealthSection (post-review fix)

**Decision:** Added a 24h cutoff filter to `formatSystemHealthSection` — only ring buffer entries with `timestamp >= now - 24h` are surfaced in the brief.

**Why:** External reviewer flagged that the spec §2.9.5 says events should be filtered to the last 24h. Without filtering, a surrendered entry would re-appear in every subsequent morning brief until evicted from the 256-entry ring buffer, which could take months at daily-probe cadence. The fix adds `const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()` before the fixed/surrendered split. ISO string lexicographic comparison is correct here (all timestamps are UTC ISO 8601).

**How to apply:** Any future ring-buffer reader that surfaces events to users should apply the same 24h window. The ring buffer is sized for long-term history (Debug/Admin UI); the brief surface is for the last night only.

## D9 — System-origin reverify: skip artifact-based reverifier, trust rescan (live-test fix)

**Decision:** `dispatchReverify` now detects `failure.triggeringInput.origin.kind === "system"` and, after `waitForAvailability()` passes, returns `{ pass: true }` directly — skipping the per-type REVERIFIERS table.

**Why:** System-origin probes (daily health probe, startup scan) carry no triggering artifact. `reverifyAudioToText` requires `rawMediaPath`; without it, every reverify returned `pass: false` even when the fix agent successfully repaired the script. The rescan+testAll executed by `watcher.rescanNow()` + `waitForAvailability()` IS the verification for system-origin — if the capability is available after the fix runs, testAll already confirmed it's healthy. No artifact replay needed.

**How to apply:** Any future per-type reverifier that requires artifact data must be skipped for system-origin failures. The `kind === "system"` early-return in `dispatchReverify` is the single enforcement point — no per-type reverifier needs its own system-origin guard.
