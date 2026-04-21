---
sprint: M9.6-S23
title: Decisions
date: 2026-04-21
---

# S23 Decisions

## D1 — No matcher change required

**Decision:** The existing `FAILED_STATUSES` allow-list (`"failed"`, `"needs-auth"`, `"disabled"`) is correct. The SDK emits `status: "failed"` for crash-at-boot MCP servers.

**Why:** Live diagnostic captured `{"name":"browser-chrome","status":"failed"}` — matches the existing allow-list exactly. S12 spike prediction confirmed.

**Alternative considered:** Extending the allow-list with additional strings (`"crashed"`, `"exited"`, `"terminated"`). Not needed based on observed reality.

## D2 — Keep diagnostic log permanently at debug level

**Decision:** `console.debug("[CfrDetector] processSystemInit:", ...)` stays in the production code at `debug` level.

**Why:** Mode 3 detection gaps are hard to diagnose without knowing what the SDK actually emits. The log is cheap (fires once per session init, JSON of a small array). Future Mode 3 issues will start from this trace rather than having to add it again.

## D3 — Add try/catch around per-entry CFR emit

**Decision:** Wrap `cfr.emitFailure({...})` in a try/catch inside the `mcp_servers` loop. Errors are logged but don't propagate.

**Why:** `originFactory()` can throw if the session context isn't promoted yet at the time `system_init_raw` fires. Without the catch, the exception propagates through `processSystemInit` into the session-manager's `for-await` loop and could terminate the session. The catch ensures one failed entry doesn't abort detection for remaining entries.

## D4 — retryTurn for Mode 3 is a follow-up (FOLLOW-UP-1)

**Decision:** Accept the "asked twice" behavior for M9.6. Mode 3 triggers `retryTurn` because the origin is `kind: "conversation"`. This is functionally correct but UX-suboptimal when the original turn already completed via fallback.

**Why:** Fixing this requires either a `turnSucceeded` flag on `TriggeringInput` or a separate `system` origin kind. Both are meaningful changes to the CFR type system. Out of scope for S23 — the core detection and recovery work correctly.
