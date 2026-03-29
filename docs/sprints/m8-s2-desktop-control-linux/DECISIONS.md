# M8-S2 Decisions

## D1: Hatching uses tool+prompt, not step class

**Decision:** Desktop control hatching step is implemented as an MCP tool (`get_desktop_status`) + prompt instruction in the hatching system prompt, NOT as a rigid HatchingStep class.

**Why:** The hatching system is LLM-driven — it uses prompts and tools, not a step interface. Adding a class would mean inventing a new pattern that doesn't match existing hatching architecture. The tool+prompt approach lets the LLM check desktop status and present install instructions naturally within the existing flow.

**Logged:** 2026-03-29

## D2: Safety hooks as standalone utilities, not SDK PreToolUse

**Decision:** Rate limiter and audit logger are standalone utility objects on `app.desktopRateLimiter` / `app.desktopAuditLogger`, NOT wired as Agent SDK PreToolUse hooks.

**Why:** The existing hooks system in this codebase uses a different pattern (core-level hooks for task safety, not per-MCP-tool hooks). The MCP tool handlers can call the rate limiter directly before executing. This is simpler and doesn't require inventing a new hook wiring pattern.

**Logged:** 2026-03-29

## D3: Rate limiter set to 30/minute (not 10)

**Decision:** Desktop tool rate limit set to 30 per minute, not the spec's suggested 10.

**Why:** The computer use loop can fire multiple actions per second during rapid GUI interaction. 10/minute would throttle normal usage. 30/minute is generous enough for real work but still prevents runaway loops.

**Logged:** 2026-03-29
