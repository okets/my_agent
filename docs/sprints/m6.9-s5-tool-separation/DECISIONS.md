# M6.9-S5 Decisions

## D1: Playwright MCP kept in shared servers (not removed from conversation Nina)
**Decision:** Keep Playwright MCP in shared servers. Conversation Nina technically has access but will never discover or use it — MCP tools are auto-deferred and she has no use case that triggers browser automation without power tools.
**Reasoning:** Removing it would require splitting MCP servers between conversation and working contexts, adding complexity for no practical benefit. The tool restriction (WebSearch + WebFetch only) plus standing orders already prevent misuse.

## D2: Pre-existing test failure (knowledge-extractor flaky in full suite)
**Observation:** `tests/knowledge-extractor.test.ts > parseClassifiedFacts > parses all 7 classification categories` fails when run in the full test suite but passes in isolation. This is a pre-existing issue unrelated to S5 changes.
**Action:** Noted, not fixed in this sprint.

## D3: PostResponseHooks deps simplified
**Decision:** Removed `broadcastToConversation`, `publishTasks`, and `taskProcessor` from PostResponseHooksDeps. The hook no longer creates tasks, so these are unnecessary.
**Impact:** Callers (index.ts, channel message handler) pass fewer deps. No behavioral change — the hook now only detects and logs.
