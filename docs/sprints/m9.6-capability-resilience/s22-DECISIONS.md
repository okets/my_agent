---
sprint: M9.6-S22
title: Tool Capability Recovery Loop — Decisions
date: 2026-04-21
---

# M9.6-S22 Decisions

## D1 — `terminalDrain` dispatch point for tool capabilities

**Decision:** `retryTurn` fires inside the `outcome === "terminal-fixed"` branch (after `emitAck("terminal-fixed")`), not in a new `outcome === "fixed"` branch.

**Rationale:** Tool capabilities produce no `recoveredContent` — the orchestrator's state machine routes them through `REVERIFY_PASS_TERMINAL` → `terminalDrain(outcome: "terminal-fixed")`. Adding a sibling branch on `outcome === "fixed"` would be unreachable dead code. The correct hook point is: after notifying the user the capability is restored, also re-submit the original request. Output capabilities (TTS) take the same `terminal-fixed` path but `getInteraction` returns `"output"`, so `retryTurn` is not called for them.

**Sequence:**
1. `emitAck("terminal-fixed")` — user notified ("fixed!")
2. `getInteraction(capabilityType) === "tool"` → `retryTurn(failure)` — original request re-submitted
3. Brain sees healthy capability, completes task

---

## D2 — `retryTurn` is optional in `OrchestratorDeps` (same pattern as `writeAutomationRecovery`)

**Decision:** `retryTurn?: (failure) => Promise<void>` — optional field, undefined → log warn + no-op.

**Rationale:** Backward compatibility with existing callers (tests, integrations) that don't wire `retryTurn`. The warn log surface the missing wiring rather than silently doing nothing. Follows the established pattern of `writeAutomationRecovery?`.

---

## D3 — `DEFAULT_INTERACTION` table in `types.ts` (shared between scanner and registry)

**Decision:** A single `DEFAULT_INTERACTION` constant in `types.ts` is used by both `scanner.ts` (when frontmatter omits `interaction:`) and `registry.ts` (`getInteraction` fallback). Not duplicated in each file.

**Rationale:** Single source of truth. Both consumers import from `types.ts` — the logical home for capability type metadata.

---

## D4 — Unknown capability types default to `"tool"` (not `"input"`)

**Decision:** Any capability type not in `DEFAULT_INTERACTION` and without explicit frontmatter defaults to `"tool"`.

**Rationale:** "tool" is the safer default. `retryTurn` re-submits the original request — worst case is a second brain turn. `reprocessTurn` expects `recoveredContent` that tool capabilities never produce; calling it with `undefined` would be a type error / silent no-op at best, wrong behavior at worst.

---

## D5 — Turn lookup for `retryTurn` uses `conversationManager.getTurns(convId)` filtered by `turnNumber + role`

**Decision:** In `app.ts`'s `retryTurn` implementation, look up the original user turn via `app.conversationManager.getTurns(convId)` (all turns, no pagination) and `find(t => t.role === "user" && t.turnNumber === turnNumber)`.

**Rationale:** `conversationManager.getTurns()` already exists and is the authoritative transcript reader. The `conversationOrigin` shape carries `turnNumber` from `ConversationSessionContext` — the exact same turn that triggered the CFR. Turn numbers are unique per conversation for `role === "user"`.

---

## D6 — `retryTurn` re-submits via `app.chat.sendMessage(convId, text, nextTurnNumber, { channel, source: "channel" })`

**Decision:** Same call site as `ChannelMessageHandler` and WS chat-handler. Events broadcast automatically via app's `chat:*` listener.

**Rationale:** `sendMessage` handles the complete pipeline: user turn save, session management, brain streaming, assistant turn save, WS broadcast, post-response hooks. No special-casing needed for retried turns.

---

## D7 — E2E automated test uses `.enabled` missing; live retest uses real config corruption

**Decision:** The automated `cfr-exit-gate-tool-retry.test.ts` uses `.enabled` missing as the failure mode (reliable, predictable repair instruction). The CTO live retest uses real config/script corruption that requires genuine fix-mode diagnosis.

**Rationale:** Automated tests need deterministic repair so the fix-mode agent succeeds reliably. The live retest is where "does the agent actually diagnose novel failures?" is exercised. Separating concerns keeps the automated test fast and stable.

---

## D8 — Three dispatch tests, one per shape (not one "input vs not-tool" test)

**CTO direction (2026-04-21):** Separate tests for all three shapes — tool, input, output — to give symmetric proof at the unit level matching the two live retests.

**Implementation:** `cfr-tool-retry.test.ts` (tool shape), `cfr-input-no-retry.test.ts` (input shape), `cfr-output-no-retry.test.ts` (output shape). Output test uses a custom `provides: "custom-synth"` type with explicit `interaction: "output"` to avoid the `reverifyTextToAudio` path (which calls `synthesize.sh` directly, not via invoker).

---

## D9 — Two live tests required to close M9.6-S22

**CTO direction (2026-04-21):**
1. **Browser live test (new):** CTO breaks browser-chrome (real config/script corruption), asks for screenshot, screenshot arrives within ~3 min. Verifies tool-capability recovery loop end-to-end.
2. **Voice live test (S21 regression gate):** Same test that closed S21 — break STT and TTS, verify full input/output recovery chain. Confirms S22 changes don't disturb existing recovery loops.

Both tests must pass before M9.6 closes.

---

## D10 — BUG-8 explicitly deferred to M10

**Decision:** The brain racing CFR mid-session (user sees stale "I can't" reply before "hold on — fixing…" ack) is deferred to M10.

**Rationale:** Fixing BUG-8 requires either a pre-delivery SDK hook intercepting tool errors before the brain stream, or mid-stream brain output suppression. The Agent SDK as of M9.6 doesn't expose pre-delivery interception. Mid-stream suppression is race-y and architecturally invasive. M10 revisits the brain-lifecycle hook surface. See `s22-FOLLOW-UPS.md`.

---

## D11 — Parallel browser paths are intentional; live test methodology corrected (added 2026-04-21 by architect after live-test-1 failed)

**Context:** The first live retest (s22-review.md §"Live Test 1") corrupted browser-chrome three different ways and observed in each case: brain delivers screenshot successfully, no `PostToolUseFailure` fires, no CFR detection log, no `processSystemInit` log. The dev's structural finding identified that Desktop MCP exposes Playwright browser tools (`browser_navigate`, `browser_take_screenshot`) in parallel with browser-chrome, masking the failure.

**CTO clarification (2026-04-21):** *"Desktop should expose browser, I don't mind conflicting paths. Browser is for another purpose. Nina should be able to use a different browser for her accounts and my accounts. We can refine the prompt to be 'Use the chrome browser capability to check if I am logged in to facebook on this browser'."*

The two browser surfaces are deliberately distinct semantically:
- **Desktop MCP's browser tools** = Nina's working browser (her own tasks)
- **`browser-chrome` capability** = user's browser instance (carries user's accounts, cookies, sessions)

Brain disambiguates by intent — explicit prompt naming the capability routes the call to the right one.

**Decision:** This is by-design, not an architectural bug. Do NOT remove or reshape Desktop MCP's tool surface. Live test methodology must be corrected to exercise S22's actual code path.

**Implication for live test:** the dev's three test attempts all exercised **MCP-init failure** (config wrong → MCP server exits at startup → tools never registered → brain doesn't see `browser-chrome` at all → fallback path taken). S22's `retryTurn` triggers from `PostToolUseFailure`, which fires only when the brain **actually calls a tool and the call fails mid-session**. MCP-init failures are caught by Mode 3 (`processSystemInit`) detection — a different, separately-tracked path (see FOLLOW-UP-3 in `s22-FOLLOW-UPS.md`).

---

## D12 — Failure-mode taxonomy: (a) tool-call vs (b) MCP-init (added 2026-04-21)

**Decision:** Two distinct failure modes for tool capabilities, requiring two different detection paths:

| Shape | What breaks | Detection path | Built? |
|---|---|---|---|
| (a) tool-call mid-session | MCP server starts, `browser_navigate` (or other tool) fails when called | `PostToolUseFailure` → CFR → `terminalDrain` → `retryTurn` | ✅ S22 |
| (b) MCP-init at startup | MCP server crashes at boot, tools never registered, brain doesn't see them | `processSystemInit` (Mode 3) | unverified |

S22 is scoped to (a). The retest must engineer an (a)-shape failure.

**To engineer an (a)-shape break for browser-chrome:** corrupt the browser **binary or runtime path**, not the config that drives MCP startup. Concretely: point `config.yaml`'s `browser_path` (or equivalent) at a script that exists, is executable, but exits non-zero on any invocation; OR break user-data-dir permissions so navigation fails when the brain calls it. The MCP server must start cleanly (so its tools register and the brain sees `browser-chrome`), and the tool call must fail when actually invoked.

**Mode 3 verification is FOLLOW-UP-3** — separate scope from S22.

---

## D13 — Live retest 1 prompt must explicitly name the capability (added 2026-04-21)

**Decision:** The CTO's screenshot prompt must explicitly name `browser-chrome` so the brain routes through that capability rather than Desktop MCP. Per the CTO clarification under D11.

**Required prompt shape:** *"Use the chrome browser capability to take a screenshot of [URL]"* (or equivalent — *"Use the chrome browser capability to check if I'm logged in to Facebook on this browser"*). Generic *"take a screenshot of CNN"* allows the brain to pick whichever browser surface is convenient and bypass `browser-chrome` entirely.

**Why this matters:** even with an (a)-shape break, an ambiguous prompt lets the brain succeed via Desktop MCP without touching browser-chrome. The explicit prompt removes the disambiguation ambiguity and forces the path under test to fire.
