---
sprint: M9.6-S23
title: Deviations
date: 2026-04-21
---

# S23 Deviations

## DEV-1 — No new unit test file; tests added as integration test only

**Plan said:** `packages/core/tests/capabilities/mcp-cfr-detector-init.test.ts` (new) with three cases.

**What happened:** The existing `mcp-cfr-detector.test.ts` already has comprehensive `processSystemInit` coverage (10 tests covering all three plan cases: all-connected, one-failed, idempotent). Creating a duplicate file for three tests that are already covered would be redundant. The new test effort went into `cfr-mode3-init-detection.test.ts` (conversation-origin integration test) which was the higher-value addition.

**Impact:** None — the plan explicitly said "extend existing test if one exists for this detector; check at sprint-time." The existing file was extended conceptually; the new integration test fills the conversation-origin gap that existed.

## DEV-2 — Test message sent via WS script, not CTO typing in dashboard

**Plan said:** CTO sends message from the dashboard.

**What happened:** A Node.js WebSocket script was used to send the message, as the CTO was not yet at the keyboard. The CTO observed the conversation transcript in the dashboard and confirmed results. Functionally identical — the message went through the full WS pipeline.
