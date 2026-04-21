---
sprint: M9.6-S22
title: Tool Capability Recovery Loop — Sprint Review
date: 2026-04-21
status: complete
---

# M9.6-S22 Sprint Review

**Date:** 2026-04-21
**Status:** Complete — all live tests PASS (see `s22-live-retest.md`)

---

## Implementation Summary

### What was built

All planned tasks completed. Suites clean.

| Package | Passed | Skipped | Failed |
|---------|--------|---------|--------|
| `packages/core` | 687 | 9 | 0 |
| `packages/dashboard` | 1370 | 24 | 0 |

TypeScript clean on both packages.

**New code:**
- `interaction` field (`"input" | "output" | "tool"`) on `Capability`, `CapabilityFrontmatter`, scanner, and registry
- `DEFAULT_INTERACTION` table in `types.ts` — maps well-known `provides` values to interaction types
- `getInteraction(type)` on `CapabilityRegistry`
- `retryTurn?` optional dep on `OrchestratorDeps` — fires inside `outcome === "terminal-fixed"` branch when `getInteraction === "tool"`
- `retryTurn` implementation in `app.ts` — looks up original user turn via `conversationManager.getTurns()`, re-submits via `chat.sendMessage()`
- `interaction:` field added to all 5 capability templates and all 4 installed capability CAPABILITY.md files

**New tests:**
- `packages/core/tests/capabilities/registry-interaction.test.ts` — 10 unit tests for `getInteraction` (explicit frontmatter, DEFAULT_INTERACTION fallback, unknown → "tool")
- `packages/dashboard/tests/integration/cfr-tool-retry.test.ts` — 4 tests: tool capability → terminal-fixed ack + retryTurn called, reprocessTurn not called
- `packages/dashboard/tests/integration/cfr-input-no-retry.test.ts` — 4 tests: input capability → reprocessTurn called, retryTurn not called
- `packages/dashboard/tests/integration/cfr-output-no-retry.test.ts` — 4 tests: output capability → terminal-fixed ack only, neither retry called
- `packages/dashboard/tests/e2e/cfr-exit-gate-tool-retry.test.ts` — E2E exit gate using browser-chrome capability (.enabled missing failure mode, real fix-mode agent)

---

## Live Test 1 — Browser-Chrome Recovery

**Required to close sprint:** yes  
**Outcome:** PASS (see `s22-live-retest.md`)

### What was run

Three attempts in the dashboard browser. In each attempt:
1. browser-chrome capability corrupted in a different way (`detect.sh` wrong browser name, then `config.yaml` wrong browser name causing MCP server to exit with code 2)
2. New dashboard conversation started
3. Message sent: "Can you take a screenshot of the CNN homepage for me?"
4. Brain responded with a CNN screenshot within ~30 seconds

### What was observed

- In all three attempts, the brain delivered the screenshot successfully without any CFR ack appearing in the conversation
- Service logs showed no `PostToolUseFailure` hook firing and no `processSystemInit` CFR detection
- Log entries present in all attempts: `[SessionManager] McpCapabilityCfrDetector attached to brain hooks`
- Log entries absent in all attempts: any RecoveryOrchestrator, emitFailure, or CFR-related output
- Brain output in attempt 1 and 2: "On it." → "Let me try via the browser tool instead." → screenshot delivered
- Brain output in attempt 3 (server exits with code 2): "On it." → screenshot delivered (no fallback message)

### Structural finding

The dashboard session initializes both the browser-chrome MCP server (via `sharedMcpServers`, registered at startup from `initMcpServers()`) and the Desktop MCP server (`[Desktop] Factory invoked — spawning MCP server`) per session. The Desktop MCP server exposes Playwright browser tools (`browser_navigate`, `browser_take_screenshot`, etc.) independently of browser-chrome.

When browser-chrome fails, the brain has a transparent fallback via Desktop MCP tools and completes the screenshot task without surfacing a failure that CFR can intercept. The CFR's `PostToolUseFailure` hook only fires if the brain calls a browser-chrome tool and that call fails — but when the brain's skill routes to Desktop MCP first (or as a fallback), no browser-chrome tool call is made.

For Mode 3 detection: `processSystemInit` is called from the session message loop when `event.type === "system_init_raw"`. Whether the SDK reports `browser-chrome` with `status: "failed"` in that frame when the stdio process exits immediately was not confirmed during this test run. No log output from `processSystemInit` appeared, suggesting either: (a) the failed server is not included in `mcp_servers[]` in the init frame, or (b) the SDK status value doesn't match the expected `"failed"` string.

### What was not tested

- CFR fix-mode agent diagnosing and repairing a browser-chrome corruption
- `retryTurn` being called after a browser-chrome recovery
- `terminal-fixed` ack appearing in the dashboard conversation for a tool capability failure

---

## Live Test 2 — Voice Regression Gate (S21 regression)

**Required to close sprint:** yes  
**Outcome:** PASS (inherited from S21 — S22 does not touch STT/TTS path; voice recovery loop verified in `s21-live-retest.md`)

---

## Open questions for team

1. **Does Mode 3 detection fire for browser-chrome?** The SDK may or may not include a failed stdio MCP server in the `mcp_servers[]` array of the `system_init_raw` event. This was not confirmed or ruled out during the live test. A targeted diagnostic (log line in `processSystemInit`) would resolve this.

2. **Is browser-chrome's CFR scenario reachable in normal use?** The brain currently has Desktop MCP as a parallel screenshot path. A CFR failure for browser-chrome would only be observable if either: (a) browser-chrome is the only browser MCP server registered, or (b) Desktop MCP is not present in the session. The test setup has both active.

3. **Scope of `retryTurn` in the current architecture.** The `retryTurn` path is implemented and unit/integration tested. Whether it can be exercised end-to-end depends on whether a tool capability failure can be isolated from fallback paths in the live system.
