# S2 Test Report — Deps Wiring at App Boot

**Sprint:** M9.6-S2 — `sprint/m9.6-s2-deps-boot-wiring`
**Reviewer:** Claude Sonnet 4.6 (external review session)
**Date:** 2026-04-15
**Branch:** `sprint/m9.6-s2-deps-boot-wiring`

---

## Commands run

```
cd packages/dashboard && npx vitest run tests/cfr/boot-deps-wired tests/e2e/whatsapp-before-browser
cd packages/dashboard && npx tsc --noEmit
```

---

## Test output

```
RUN  v4.0.18 /home/nina/my_agent/packages/dashboard

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > emits STT-level CFR (not deps-missing) when deps wired at boot
[SessionManager] Initialized (trust: brain, dir: <agent-dir>/.my_agent)

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > emits STT-level CFR (not deps-missing) when deps wired at boot
[Skills] Disabled "systematic-debugging" — requires tools not in session: Write, Edit, Bash

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > emits STT-level CFR (not deps-missing) when deps wired at boot
[Skills] Disabled "writing-plans" — requires tools not in session: Write, Edit, Bash

stderr | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > emits STT-level CFR (not deps-missing) when deps wired at boot
Calendar credentials not found at <agent-dir>/.my_agent/calendar/credentials.json. Calendar features disabled.

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > emits STT-level CFR (not deps-missing) when deps wired at boot
[SessionManager] options.model: undefined, config.model: claude-sonnet-4-6, final: claude-sonnet-4-6

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > emits STT-level CFR (not deps-missing) when deps wired at boot
[SessionManager] Starting new SDK session (message 1)
[Brain] createBrainQuery model: claude-sonnet-4-6

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > pre-S2 behaviour: null deps causes deps-missing CFR
[Model Debug] Message model: undefined, Conversation model: null, Override: undefined, ConvId: conv-01KP8XDNQHX3HEFWP5BHNV49BC
Sending message with text
[SessionManager] Initialized (trust: brain, dir: <agent-dir>/.my_agent)

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > pre-S2 behaviour: null deps causes deps-missing CFR
[Skills] Disabled "systematic-debugging" — requires tools not in session: Write, Edit, Bash

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > pre-S2 behaviour: null deps causes deps-missing CFR
[Skills] Disabled "writing-plans" — requires tools not in session: Write, Edit, Bash

stderr | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > pre-S2 behaviour: null deps causes deps-missing CFR
Calendar credentials not found at <agent-dir>/.my_agent/calendar/credentials.json. Calendar features disabled.

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > pre-S2 behaviour: null deps causes deps-missing CFR
[SessionManager] options.model: undefined, config.model: claude-sonnet-4-6, final: claude-sonnet-4-6

 ✓ tests/cfr/boot-deps-wired.test.ts (4 tests) 220ms

stdout | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > pre-S2 behaviour: null deps causes deps-missing CFR
[SessionManager] Starting new SDK session (message 1)
[Brain] createBrainQuery model: claude-sonnet-4-6

stderr | tests/e2e/whatsapp-before-browser.test.ts > whatsapp-before-browser > pre-S2 behaviour: null deps causes deps-missing CFR
Error: No Anthropic authentication configured. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, or run /my-agent:auth
    at createBrainQuery (...)
    at SessionManager.buildQuery (...)
    at SessionManager.streamMessage (...)
    at AppChatService.sendMessage (...)
    at drain (...)
    ...
Error in streamMessage

 ✓ tests/e2e/whatsapp-before-browser.test.ts (2 tests) 239ms

 Test Files  2 passed (2)
       Tests  6 passed (6)
    Start at  18:51:05
    Duration  3.60s (transform 3.20s, setup 0ms, import 6.28s, tests 459ms, environment 0ms)
```

---

## TypeScript check output

```
cd packages/dashboard && npx tsc --noEmit
(no output — clean)
```

---

## Results summary

| Suite | Tests | Passed | Failed | Duration |
|---|---|---|---|---|
| `tests/cfr/boot-deps-wired.test.ts` | 4 | 4 | 0 | 220ms |
| `tests/e2e/whatsapp-before-browser.test.ts` | 2 | 2 | 0 | 239ms |
| **Total** | **6** | **6** | **0** | **459ms** |

TypeScript: **0 errors**

---

## Test coverage analysis

### `boot-deps-wired.test.ts` (4 tests)

1. **`app.chat deps include AttachmentService after boot wiring`** — Directly verifies the S2 goal: `AppChatService` has `deps.attachmentService` and `deps.idleTimerManager` populated when `setDeps()` is called at boot (no WS connection involved). Uses `(chat as any)["deps"]` to inspect the private field.

2. **`deps are not null even when abbreviationQueue is null (unhatched agent)`** — Verifies the unhatched-agent edge case: `setDeps()` with null `idleTimerManager` still produces non-null `deps`. `AttachmentService` is always present; idle manager is nullable. Matches App.create() logic where `idleTimerManager` is conditional on `app.abbreviationQueue`.

3. **`IdleTimerManager starts with no-op and abbreviates on idle`** — Verifies that the default `() => 0` callback causes abbreviation to proceed. Uses 50ms idle for fast execution.

4. **`setViewerCountFn upgrades callback — upgraded callback blocks abbreviation`** — Verifies the upgrade path: after `setViewerCountFn(() => 1)` is called (simulating WS connect), idle fires but does NOT enqueue (viewer present). Core of the callback-approach contract.

### `whatsapp-before-browser.test.ts` (2 tests)

1. **`emits STT-level CFR (not deps-missing) when deps wired at boot`** — The primary S2 acceptance test. With `setDeps()` called before `sendMessage()` (no WS connection needed), the pipeline gets past the `deps-missing` gate, reaches `transcribeAudio`, and emits an STT-level CFR on fake audio. Asserts: zero `deps-missing` CFRs, at least one `audio-to-text` CFR.

2. **`pre-S2 behaviour: null deps causes deps-missing CFR`** — Regression/contrast test. Without calling `setDeps()`, `sendMessage()` with attachments emits a `deps-missing` CFR immediately. Proves that S2's wiring is what enables the pipeline to proceed past the gate.

---

## Notes on test output

**SDK error in test 1 (whatsapp-before-browser):** The stdout shows the session manager starting an SDK session and then receiving `Error: No Anthropic authentication configured`. This is expected and by design — the `drain()` helper in the test catches all errors from the async generator. The test's assertions occur *before* the SDK call would return (the CFR events fire during the deps gate and STT gate, both of which precede the SDK session). The error is caught and ignored; the test passes correctly.

**Calendar credentials warning:** Appears in both E2E tests because `ConversationManager` initialization reads `.my_agent/` config. This is a known cosmetic warning in test environments and does not affect test results.

**Skills disabled notices:** `SessionManager` logs disabled skills during init. Cosmetic, consistent with other test runs in the suite.

---

## Flakiness assessment

No flakiness observed. The timer-based tests in `boot-deps-wired.test.ts` (tests 3 and 4) use 50ms idle with a 100ms wait — a 2× margin. On a loaded CI machine this could theoretically be marginal, but 100ms is a generous wait for a `setTimeout(50)`. The same pattern is used in the existing `conversations.test.ts` suite (which passes reliably). No concern.
