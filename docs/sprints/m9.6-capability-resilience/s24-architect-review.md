---
sprint: M9.6-S24
reviewer: architect (opus)
date: 2026-04-22
verdict: APPROVE WITH CHANGES (cosmetic + 1 in-sprint deviation worth flagging)
---

# S24 Architect Review

## Verdict: APPROVE WITH CHANGES (no rework — only cleanup + ROADMAP update)

All five planned sub-tasks correctly implemented. Both suites green (1391/0 dashboard, 695/0 core). The dev caught a real architectural issue mid-sprint (system-origin reverify needs no artifact) and fixed it cleanly with a documented decision (D9). The two issues from the external review at the time of report writing — GAP-1 live retest, GAP-2 missing 24h filter — were both resolved by the dev (test-report.md exists, D8 added the filter). M9.6 closes when CTO signs off.

## What's right

### All five §2.9 sub-tasks implemented to spec

- **§2.9.1 Heartbeat wiring** — `app.ts:2150-2173`. Interval correctly set to `24 * 60 * 60 * 1000`. Callback iterates `list()`, skips non-degraded, skips `isInFlight(capType)`, emits via `app.cfr.emitFailure({...})` with inline `{ kind: "system", component: "capability-health-probe" }`. Per D5, uses `app.cfr.emitFailure` (the canonical CFR entry point), not the spec's stale `orchestrator.emitFailure` example — correct routing. Heartbeat-service.test.ts extended with 4 new tests covering the four states (fires, emits-when-degraded, skips-in-flight, ignores-healthy).
- **§2.9.2 `isInFlight`** — `recovery-orchestrator.ts:137-143`. Public method, three lines, returns `this.inFlight.has(capabilityType)`. `inFlight` Set stays private. Orchestrator state-machine test extended with promise-gate spawn + assertion at both states.
- **§2.9.3 System-origin terminal drain → ring buffer** — `recovery-orchestrator.ts:720-747` calls `deps.recordSystemOutcome({...})` for each system origin after logging. `ack-delivery.ts:479-513` new `recordSystemOutcome` method transitions the most-recent matching in-progress entry in place; appends a fresh terminal entry if no in-progress predecessor exists (defensive). `SystemCfrEvent.outcome` union widened to include `"fixed"` at line 204. `deliver()`'s system-branch updated at lines 420-450 to call `recordSystemOutcome` instead of pushing a duplicate entry — closes a latent S19 double-entry bug, exactly as predicted by the audit.
- **§2.9.4 `testAll()` MCP coverage** — D6 documents the verification: both `browser-chrome` and `desktop-x11` CAPABILITY.md already declare `provides` + `interface: mcp` correctly. `testCapability()` structurally cannot return `untested` from a missing dispatch entry. New `test-harness-mcp-coverage.test.ts` (7 tests) asserts every shape resolves to `ok` or `error`, never silent `untested`. **No code change was needed; the audit's gap class doesn't exist in the current tree.** D6 properly documents the verification result.
- **§2.9.5 Brief integration** — `handler-registry.ts:307-336` exports `formatSystemHealthSection(ackDelivery)`. **24h cutoff filter present at line 318** (`const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()` then `e.timestamp >= cutoff`). Filters for `outcome: fixed | surrendered`, omits in-progress. Empty string return when no events. `BuiltInHandler` ctx extended with `ackDelivery?: AckDelivery`. `automation-executor.ts` + `debrief-automation-adapter.ts` plumb the dep through. Early-return at `:400-412` correctly fires only when BOTH workers and system-health are empty. New `debrief-reporter-system-health-section.test.ts` has 10 tests.

### Live retest performed and passed (test-report.md exists)

External reviewer's GAP-1 ("live retest not performed") was wrong at the time of writing — the test-report.md was either added after their review or they didn't have access. The actual report shows: probe fires, capability marked degraded, CFR emitted with system origin, **silent path verified** (chat panel completely untouched per `s24-live-silent-path.png`), fix automation spawned, fix succeeded, ring buffer transitioned to `fixed`, dashboard clean. Six gates from §2.9.6 all PASS.

### In-sprint deviation: D9 (system-origin reverify) — handled correctly

The dev discovered during the live test that `reverifyAudioToText` requires `rawMediaPath`, which system-origin probes don't carry. Without a fix, every system-origin recovery would surrender even when the fix succeeded. The dev landed a `dispatchReverify` change that detects `origin.kind === "system"` and returns `{ pass: true }` after `waitForAvailability()` succeeds — trusting the rescan + testAll result as the verification (correct, since testAll IS the daily probe that detected the failure in the first place).

This is a real architectural insight: **artifact-based reverification doesn't apply to proactive probes** because there's no original artifact. The fix is additive (conversation/automation origins unchanged), the test contract was correctly inverted in `reverify-audio-to-text.test.ts`, and D9 documents the rationale + the "skip per-type reverifier for system-origin" rule for future reverifiers. Architect would have approved this if proposed mid-sprint; landing it directly with documentation is the right call.

### Audit's predicted gaps all addressed

| Audit finding | Status |
|---|---|
| `systemOrigin()` factory missing | ✅ Used inline literal `{ kind: "system", component: "capability-health-probe" }` |
| `inFlight` private | ✅ Added `isInFlight(type)` public method |
| Terminal drain log-only (latent S19 gap) | ✅ New `recordSystemOutcome` API + drain calls it |
| `testAll()` MCP coverage uncertainty | ✅ Verified — no fix needed; D6 documents |
| Brief composer is `debrief-reporter` not `handler-registry` | ✅ The composer is in `handler-registry.ts:340` (the brief composer handler IS registered there); ctx extended + `AckDelivery` plumbed |

### S23 RC items folded in

D1 (RC-1 duplicate guard) and D2 (RC-2 test count correction) — small tail-end cleanups from the S23 architect review applied here. Both are 1-line/1-character changes. Slightly unconventional to land S23 RC items in S24's branch, but they're tiny and don't conflict with anything; not worth re-routing.

### §0.3 followed

ROADMAP M9.6 row remains `In Progress`. ROADMAP S24 row remains `Planned`. **S22, S23, and now S24 dev have all followed §0.3 discipline.** Pattern is established. (S16, S20 each violated; S21 self-corrected after architect catch.)

## What's wrong (cosmetic + ROADMAP)

### C-1: Stray screenshot at repo root

`/home/nina/my_agent/s24-live-silent-path.png` (403K) sits at the repo root. Per project memory rule *"Delete stray screenshots before commits — Playwright test screenshots pile up in repo root, delete before every commit."* The screenshot is referenced by `s24-test-report.md` as evidence of the silent path; it should either be moved into `docs/sprints/m9.6-capability-resilience/screenshots/` (and tracked) or deleted (and the test-report's reference removed). **Either move or delete; do not commit at repo root.**

### C-2: ROADMAP S24 row not updated for the passing implementation + retest

Currently still says `Planned` — but the implementation is complete and the live retest passed. ROADMAP doesn't reflect the actual state. Two fixes needed (one before approval, one after):

- **Now (architect commit):** update the S24 row to reflect "Implementation + live retest PASS — awaiting CTO sign-off." M9.6 milestone row stays `In Progress` until CTO sign-off.
- **After CTO sign-off:** CTO updates both the S24 row and the M9.6 milestone row to Done.

### C-3: No `s24-DEVIATIONS.md` / `s24-FOLLOW-UPS.md` files

External reviewer flagged this as GAP-4. Mostly a process consistency note. D9 is arguably a deviation (mid-sprint discovery + fix); it's recorded in DECISIONS rather than DEVIATIONS, which is defensible (the dev framed it as a design decision, not a plan deviation). **An empty FOLLOW-UPS.md still carries signal** ("no follow-ups surfaced"). For sprint-trail consistency with S19-S23, dev should create both files even if just stub content stating "no items." Low priority.

### C-4: Brief section format diverges from spec example (cosmetic)

External reviewer flagged this as GAP-3. Spec showed:
```
- 03:14 — browser-chrome auto-recovered (config drift; smoke clean within 2 min)
- 22:08 — desktop-x11 surrendered after 3 attempts; needs attention (last error: xdotool not found)
```
Actual:
```
Self-healed:
- stt-deepgram (audio-to-text) at 2026-04-21T03:00:00Z
Surrendered:
- browser-chrome (browser-control) at 2026-04-21T03:05:00Z
```

The spec example was illustrative, not prescriptive (acceptance only required "lists what self-healed and what surrendered"), so this is defensible. But the spec's HH:MM timestamps are more readable than ISO, and the spec's per-event remediation hint was a real value-add. Worth a follow-up to refine the format — track in `s24-FOLLOW-UPS.md` (when it's created per C-3) for a future polish sprint. Not blocking.

## Required changes

| ID | Change | Owner |
|----|--------|-------|
| **C-1** | Move `s24-live-silent-path.png` to `docs/sprints/m9.6-capability-resilience/screenshots/` and track, OR delete and remove reference from test-report.md | Dev |
| **C-2** | Update ROADMAP S24 row to "Implementation + live retest PASS — awaiting CTO sign-off." | Architect (this commit) |
| **C-3** | Create `s24-DEVIATIONS.md` (D9 belongs here; can also reference DECISIONS for full detail) and `s24-FOLLOW-UPS.md` (with C-4 brief-format polish + any other items) | Dev |
| **C-4** | File brief-format refinement (HH:MM timestamps + remediation hints) as `s24-FOLLOW-UPS.md` item; not blocking M9.6 close | Dev |

## Suggested (non-blocking)

| ID | Suggestion |
|----|-----------|
| S1 | The `dispatchReverify` system-origin skip (D9) at `reverify.ts:319` covers all per-type reverifiers via early return. Worth adding a comment on the `REVERIFIERS` table itself: *"Per-type reverifiers are NOT called for system-origin failures — the rescan + testAll result is the verification. See D9 in s24-DECISIONS."* So future maintainers don't add a per-type system-origin guard inside individual reverifiers. |
| S2 | The `recordSystemOutcome` "append fallback when no in-progress predecessor exists" path is defensive but probably never fires in practice (every system-origin failure currently emits an in-progress entry first via `deliver()`). Worth a debug log when the fallback fires so we'd notice if it became routine — would surface a wiring bug rather than silently degrading the ring buffer. |
| S3 | The brief section's "in-progress" filter (intentional — D8) means a fix that's mid-flight at brief-gen time doesn't appear. If the recovery completes within minutes after brief generation, the user has no visibility into it until tomorrow. Consider including in-progress entries as a third sub-list with "in progress" framing, since the brief is the only user-facing surface. Cosmetic; defer to FOLLOW-UPS. |

## Verdict rationale

S24 is a mature, well-executed sprint. All five planned sub-tasks landed cleanly. The latent S19 ring-buffer bug (predicted by the audit) was correctly fixed. The mid-sprint D9 discovery was handled with engineer judgment + clear documentation. Both suites green. §0.3 followed. Live retest performed and passed with explicit silent-path verification.

After C-1 (screenshot cleanup), C-2 (ROADMAP update — done in this commit), and C-3 (sprint-trail consistency files), this is mergeable. **M9.6 closes when CTO signs off.**

The 24-sprint promise is finally delivered:
- **3 capability shapes** (input / output / tool) — S1-S22
- **4 MCP failure modes** (Mode 1 tool exception / Mode 2 child crash / Mode 3 MCP-init / Mode 4 daily proactive probe) — S12, S22, S23, S24
- **3 user-visibility contracts** (immediate ack for input/output reactive / immediate ack + retry for tool reactive / fully silent + brief-only for proactive) — S12+S21+S22+S24

The framework now does what M9.6 promised end-to-end. M10 unblocks at sign-off.
