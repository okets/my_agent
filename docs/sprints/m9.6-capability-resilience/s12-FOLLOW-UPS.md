---
sprint: m9.6-s12
---

# S12 Follow-Ups

## Deferred (out of scope for S12)

- **Ack coalescing for parallel CFRs (30s window, friendly-name combining)** → Phase 3, S19.
- **System-origin dashboard health page UI** → Phase 3, S19. S12 leaves the system branch at log-only.
- **Fix-engine swap to `capability-brainstorming` fix-mode** → Phase 3, S16.
- **`RESTORED_TERMINAL` state-machine literal + `TERMINAL_ACK` action** → S13. S12 makes the non-conversation `reprocessTurn` path non-crashing; S13 wires the explicit terminal-state branching with the right ack copy.
- **Cross-origin `SurrenderScope` (Option B — discriminated union)** → deferred; name here only if Option A proves insufficient in practice. Option A (conversation-only SurrenderScope, with automation/system info in CFR_RECOVERY.md / log) was adopted per D6 / Task 6c.
- **Automation "fixed" notifyMode=immediate notifier path** → Phase 3 (S19). S12's terminal drain skips the terminal `emitAck` for automation origins on the `"fixed"` outcome; CFR_RECOVERY.md is still written, but the immediate-notification fan-out is not wired. Debrief-prep (Task 7) carries the narrative for `notifyMode=debrief` (default).
- **Concrete `AutomationNotifierLike` implementation in app.ts** → Phase 3 (S19). `AckDelivery` supports the notifier dep, but no concrete impl is wired in `app.ts` yet. With `notifyMode=immediate` and a missing notifier, AckDelivery logs a warning and still writes CFR_RECOVERY.md.

## Plugs / failure modes with uncovered coverage (§0.1)

Every MCP-typed plug in `.my_agent/capabilities/` today (`browser-chrome`, `desktop-x11`) routes through `McpCapabilityCfrDetector`. The following failure modes are NOT covered by this sprint and are named here per the universal-coverage rule:

- **In-session late MCP crash** — server crashes between tool calls, not during one. Does not surface via `PostToolUseFailure` (no active tool invocation) and not via `processSystemInit` (session already past init). Candidate for S13 reverify flow.
- **`is_interrupt: true` handling** — the field is present on `PostToolUseFailureHookInput`; neither Mode 1 nor Mode 2 sets it true in the spike. Distinct user-abort path — S13.
- **Unknown-tool `tool_result` with `is_error: true`** — the model hallucinates a tool name, or an MCP plug is missing. Requires parsing tool_result blocks from the user message stream (outside the hook surface). Out of scope for S12.
- **MCP server reports partial degradation (e.g. some tools fail, others succeed)** — per-tool failure routing is handled by `PostToolUseFailure`, but there is no aggregate health signal. Candidate for a Phase-3 per-tool health ledger.

## Minor / polish

- `ack-delivery.ts` historical comment rename (see DEVIATIONS.md) — if similar strict-grep acceptance checks exist in later sprints, audit doc comments ahead of the verification step.
- Test coverage for `processSystemInit` with `status: "disabled"` exists in unit tests but not in an integration scenario; the new `cfr-automation-mcp.test.ts` covers `status: "failed"` end-to-end. Low priority.
