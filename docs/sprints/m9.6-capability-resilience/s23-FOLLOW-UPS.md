---
sprint: M9.6-S23
title: Follow-Ups
date: 2026-04-21
---

# S23 Follow-Ups

## FOLLOW-UP-1 — retryTurn fires spuriously for Mode 3 system-origin failures

**Context:** After `terminal-fixed`, `retryTurn` re-submits the original user message. For Mode 1/2 (tool call failure), this is correct — the brain gave a degraded response because the tool failed, so retrying lets it succeed. For Mode 3 (MCP startup failure), the brain already answered the turn successfully via fallback capabilities. The retry causes the brain to answer the same question twice, and Nina noticed the duplication ("You asked twice — everything okay?").

**Root cause:** Mode 3's origin is set to `kind: "conversation"` (the session context at init time), so the orchestrator's `terminal-fixed` dispatch calls `retryTurn` when `getInteraction(type) === "tool"`. There's no distinction between "turn failed because of missing tool" and "turn succeeded despite missing tool".

**Options:**
1. Add a `turnSucceeded` flag to the `TriggeringInput` shape — set `true` for system-origin failures where no tool call failed, `false` for post-tool-call failures. Guard `retryTurn` on `!triggeringInput.turnSucceeded`.
2. Use `origin.kind === "system"` for Mode 3 triggers (separate origin type, not conversation-origin). The orchestrator skips `retryTurn` for system-origin failures entirely.
3. Accept the behavior — Mode 3 failures are rare, the retry is harmless (brain just answers again), user experience is slightly odd but not broken.

**Recommendation:** Option 1 or 2 for M10 if the double-answer UX is considered important to fix. Option 3 is acceptable for M9.6 close — the core detection and recovery work correctly.

**Owner:** M10 planning.
