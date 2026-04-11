# M9.5-S4: Deviations Log

## DEV1: Factory→session wiring bug required code fix

**Task:** Task 8 — Acceptance test
**Deviation:** Plan assumed desktop MCP tools would "just work" once the factory was registered. They didn't — the SDK doesn't support `cwd` in stdio server configs, so relative entrypoint paths failed silently.

**Fix applied:** Resolved entrypoint args to absolute paths in `app.ts` factory registration. This is a framework-level fix (not just a test workaround).

**Impact:** No plan change needed. The fix is small and correct. Logged as D3 in DECISIONS.md.

## DEV2: Acceptance test required "New" button, not `?new=1` URL

**Task:** Task 8
**Deviation:** Navigating to `?new=1` does not create a new conversation — the dashboard reuses the most recent conversation, which had an existing SDK session ID. Resumed sessions don't re-establish MCP servers, so desktop tools were unavailable.

**Fix:** Click the "New" button in the chat UI to create a truly fresh conversation with a fresh SDK session. The factory is then invoked and the MCP server spawns correctly.

## DEV3: Desktop screenshot inline rendering deferred

**Task:** Task 8.5 (CTO feedback)
**Deviation:** CTO flagged that desktop screenshots should render inline in the conversation UI, not just be described in text. This requires VAS integration for in-conversation MCP tool results.

**Flagged as CTO PRIORITY** in D4 of DECISIONS.md. Deferred to next sprint touching desktop or conversation rendering.
