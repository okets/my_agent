# S2 Architect Review — Deps Wiring at App Boot

**Reviewer:** The architect
**Branch:** `sprint/m9.6-s2-deps-boot-wiring`
**Review date:** 2026-04-15
**Plan reviewed against:** [`plan.md`](plan.md) §4

---

## Verdict: **APPROVED with one small fix before merge**

S2 nails its scope. Module-level singletons are gone. `IdleTimerManager` correctly uses the callback approach. `AppChatService.setDeps()` now fires in `App.create()`, not on first WS connect. 107 tests pass across CFR + boot + e2e + the 58 existing conversation tests. No deviations. The four decisions are well-reasoned and the one I was most worried about (D1 — App-level fields for `idleTimerManager` / `attachmentService`) is actually required by the `delete_conversation` cleanup path I hadn't thought about when writing the plan.

One cleanup and one process note. Neither is a re-plan.

---

## Plan ↔ code audit (independent)

| Plan item | Location | Status |
|-----------|----------|--------|
| §4.1 `IdleTimerManager` ctor arg becomes `getViewerCount: (id) => number` with default `() => 0` | `idle-timer.ts:20-28` | Matches |
| §4.1 `setViewerCountFn(fn)` setter | `idle-timer.ts:35-37` | Matches |
| §4.1 `AttachmentService` constructed in boot path | `app.ts:1850` | Matches |
| §4.1 `IdleTimerManager` constructed in boot path | `app.ts:1851-1853` | Matches; correctly conditional on `app.abbreviationQueue` for unhatched agents |
| §4.1 `app.chat.setDeps()` called in boot path | `app.ts:1854-1862` | Matches |
| §4.2 Module-level `idleTimerManager` / `attachmentService` `let` singletons removed | `chat-handler.ts` | Removed (imports at :10-17, no stray lets) |
| §4.2 First-connect init block (lines 38–59 pre-S2) removed | `chat-handler.ts` | Gone |
| §4.2 `app.chat.setDeps()` call removed from WS handler | `chat-handler.ts` | Gone |
| §4.2 WS handler upgrades `IdleTimerManager` via setter | `chat-handler.ts:35-37` | Calls `setViewerCountFn` with bound `ConnectionRegistry.getViewerCount` |
| §4.3 `message-handler.ts` untouched (per plan) | n/a | Correctly untouched |
| Acceptance: `boot-deps-wired.test.ts` (4 tests) | `tests/cfr/boot-deps-wired.test.ts` | Present, pass |
| Acceptance: `whatsapp-before-browser.test.ts` (2 tests) | `tests/e2e/whatsapp-before-browser.test.ts` | Present, pass |
| Regression: existing `IdleTimerManager` tests still pass | `tests/conversations.test.ts` | 5 sites migrated to lambdas — functionally identical |

I also independently verified:
- No other files construct `IdleTimerManager` or `AttachmentService` directly (`grep -rn "new IdleTimerManager\\|new AttachmentService"` → only `app.ts:1850, 1852`). Single-construction invariant holds.
- All callers of `idleTimerManager` / `attachmentService` across dashboard use `app.idleTimerManager?.*` / `app.attachmentService?.*` pattern — no lingering module-level reads.
- `deleteConversation` path (`chat-handler.ts:305-312`) uses the App fields correctly.

**Compile:** both packages clean (`npx tsc --noEmit`).
**Test:** `tests/cfr + tests/e2e/whatsapp-before-browser + tests/conversations.test` → 7 files, 107 tests, 0 failures.

---

## Assessment of decisions

- **D1 (App fields for `idleTimerManager` / `attachmentService`):** Approved. My plan text at §4.1 didn't account for the `delete_conversation` cleanup path, which has always reached these objects directly. Exposing them as nullable App fields is the cleanest option — the alternative (private access on `AppChatService.deps`) would have been worse. D1 matches the shape S1 used for `cfr` / `rawMediaStore`, so the App surface grows consistently.
- **D2 (`() => 0` default):** Approved. Aggressive default is the right call for a resilience sprint — preferring "abbreviation fires if idle at boot" over "abbreviation deferred indefinitely" matches M9.6's philosophy (silence is the bug).
- **D3 (`setViewerCountFn` on every connect, not first):** Approved. Idempotent, simpler, no state to bookkeep.
- **D4 (`onRenamed` stays in WS handler):** Approved. It's a transport broadcast concern that genuinely needs `connectionRegistry`.

---

## Gap to fix before merge

### A1: `App.shutdown()` doesn't call `idleTimerManager.shutdown()`

**Evidence:** `app.ts:1881-…` shutdown sequence; no line for `this.idleTimerManager?.shutdown()`.
**Already identified as:** FU2 in `s2-FOLLOW-UPS.md`.
**External reviewer said:** "should be resolved before S4."

**My call:** fix it now, on this branch. Reasons:
1. It's a genuine leak — `Map<string, NodeJS.Timeout>` of live timers at process exit. In tests this can log errors when the abbreviation queue is drained before the timers fire.
2. It's a one-liner. There is no upside to deferring.
3. We are trying to avoid an accumulating "FU to fix later" list that seeps into the cognitive load of the recovery orchestrator sprint. Every time a later sprint's implementer reads the FOLLOW-UPS, they have to decide whether FU2 has landed and whether their code can trust shutdown to clean up idle timers. That's wasted cycles.

Add `this.idleTimerManager?.shutdown();` to `App.shutdown()` in reverse-init order (before `abbreviationQueue?.drain()` so drained queue doesn't see late enqueues). One commit: `fix(m9.6-s2): stop idleTimerManager in App.shutdown`.

---

## Process note — read this before S3

### A2: Roadmap "done" commit came before architect review

Commit order on this branch:
1. feat (core change)
2. test (existing test migration)
3. test (new acceptance tests)
4. docs (DECISIONS / DEVIATIONS / FOLLOW-UPS)
5. docs (review.md + test-report.md)
6. **docs(roadmap): M9.6-S2 done** ← committed **before** architect review

Compare to S1, where the roadmap-done commit (`093f39b`) came **after** my architect-review commit (`4a4b291`). That was the right shape.

Why this matters: if I had rejected S2, the branch would carry a "done" claim that isn't true. The fix would be mechanical but the discipline slipped.

**Rule for S3 onwards:** roadmap-done is the **last** commit of the sprint, after the architect-review commit lands on the branch. The implementer does not mark the sprint done in the roadmap; the architect does it (or the implementer does it only after receiving an explicit approval).

I will amend this on this branch by pushing my review + approval first, then the implementer (or I) pushes the roadmap commit last.

---

## Test fidelity observations (no action)

### Test 1 in `whatsapp-before-browser.test.ts` simulates post-plugin layer

The plan §4 wrote: *"headless App + mock WhatsApp plugin → send voice note while no WS client connected → assert transcribeAudio is reached, attachment is saved, audio file exists in `.my_agent/conversations/<conv>/attachments/`."*

The shipped test calls `chat.sendMessage` directly with channel options, bypassing the plugin and the `ChannelMessageHandler` path. Its assertions are:
- No `deps-missing` CFR → deps are wired
- At least one `audio-to-text` CFR → pipeline got past the deps gate to the STT branch

This is an equivalent signal by dependency: for STT-branch CFR to fire, `savedAttachments` had to be populated, which means `AttachmentService.save()` ran, which means `deps.attachmentService` was not null. The test is adequate. But it doesn't literally assert the `conversations/<conv>/attachments/voice.ogg` file exists, which was the plan's literal assertion.

Not a re-work. Worth noting for S7 (the real end-to-end incident replay) — that test should directly assert on the attachment file paths, not just CFR signatures.

### Test noise — SessionManager and calendar warnings

Same pattern as S1. The tests catch SDK auth errors from `drain()` because `AppChatService` constructs a real `SessionManager`. Flagged in S1's follow-up already; still not blocking. A shared test fixture that stubs `AppChatService` at a lighter level would reduce the noise; worth doing in parallel with S5's orphan-watchdog tests which will hit the same pattern.

---

## Nitpicks (no action required)

- **N1:** `IdleTimerManager` class comment at `:14-15` still says "WS handler upgrades to real ConnectionRegistry.getViewerCount on first connect" — after D3, it's upgraded on *every* connect. Minor doc drift. Ignore or fix with the A1 commit.
- **N2:** `postResponseHooks` log adapter uses `console.log` / `console.error` not `fastify.log.*`. FU1 captures this. Pre-existing behavior for channel-origin messages. Ignore.
- **N3:** `makeTestApp` duplicated across `boot-deps-wired.test.ts` and `whatsapp-before-browser.test.ts`. Share a fixture when S5 writes its tests.

---

## Paper trail

- `s2-DECISIONS.md` — good. Four decisions, rationale + blast-radius each.
- `s2-DEVIATIONS.md` — correctly states "no deviations." D1 is logged in DECISIONS because it's *additive* to the plan, not a deviation from it — correct categorization.
- `s2-FOLLOW-UPS.md` — three items. FU2 is being elevated to A1 above; FU1 and FU3 are genuinely later-sprint concerns.
- `s2-review.md` — thorough external review. Independent compile / test verification. Reviewer correctly flagged A1 but under-called the urgency.
- `s2-test-report.md` — command output preserved, honest about the auth-error noise.

Commit hygiene: six commits, conventional-style, no `--amend`, no `--no-verify`.

---

## What to do next

1. **Implementer:** one-line fix for A1 + matching test assertion that `idleTimerManager.getActiveTimerCount()` returns 0 after `App.shutdown()`. Commit: `fix(m9.6-s2): stop idleTimerManager in App.shutdown`.
2. **Implementer:** **do not** add any roadmap-done commit on top. The roadmap commit already exists (`c817018`) — leave it. Next time (S3), defer the roadmap commit until after architect review.
3. **Architect (me):** re-review the A1 fix when pushed. If clean, approve merge.
4. **After merge:** S3 starts in a fresh Sonnet session. Point it at `plan.md §5` (Sprint 3 — Capability hot-reload + restart gap closure).

---

**Approved pending A1. Ping when the shutdown fix lands.**
