---
sprint: M9.6-S22
title: Tool Capability Recovery Loop — Deviations
date: 2026-04-21
---

# S22 Deviations

## DEV-1 — `retryTurn` dispatch point moved from `outcome: "fixed"` to `outcome: "terminal-fixed"`

**Plan said:** Add `retryTurn` call in the dispatch branch for tool capabilities after reverification passes.

**What was built:** `retryTurn` fires inside the `outcome === "terminal-fixed"` branch (after `emitAck("terminal-fixed")`), not in a sibling `outcome === "fixed"` branch as initially drafted.

**Why:** Tool capabilities produce no `recoveredContent`. The orchestrator state machine routes them through `REVERIFY_PASS_TERMINAL` → `terminalDrain(outcome: "terminal-fixed")`. The `outcome === "fixed"` branch is only reached when `recoveredContent !== undefined` (input capability path). A sibling branch on `"fixed"` for tool capabilities would be unreachable dead code.

**Impact:** Correct behavior — the fix was a design correction discovered during implementation, not a scope change. Captured as D1 in `s22-DECISIONS.md`.

---

## DEV-2 — Output dispatch test uses `custom-synth` type, not an existing capability type

**Plan said:** Write unit tests for all three shapes. The output shape test was expected to use `text-to-audio`.

**What was built:** The output test (`cfr-output-no-retry.test.ts`) uses a custom capability type `"custom-synth"` with explicit `interaction: "output"` in the `Capability` object.

**Why:** `reverifyTextToAudio` (the `text-to-audio` reverifier) calls `synthesize.sh` directly — not through the `CapabilityInvoker`. A stub invoker cannot intercept it. Using `custom-synth` falls through to `runSmokeFixture`, which uses an availability check when no `scripts/smoke.sh` exists — testable without real scripts or API calls.

**Impact:** None on coverage. The test proves the dispatch decision at `getInteraction("custom-synth") === "output"` → no `retryTurn`. The real `text-to-audio` path is covered by the S21 live retest (voice regression gate).

---

## DEV-3 — `retryTurn` in app.ts drains the async generator to completion

**Plan said:** Re-submit via `app.chat.sendMessage()`.

**What was built:** `retryTurn` iterates the `sendMessage` async generator with `for await (const _event of ...)`, draining all events before returning. Events broadcast automatically via the app's `chat:*` listener.

**Why:** `sendMessage` returns an `AsyncIterable`. Not consuming it leaves the brain stream unstarted. The drain loop is a one-liner; no output-coupling is needed because broadcast happens internally.

**Impact:** None — this is the correct way to drive `sendMessage` from a non-HTTP caller. Same pattern used in the WS chat-handler.
