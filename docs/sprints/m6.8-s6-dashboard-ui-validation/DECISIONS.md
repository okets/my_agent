# M6.8-S6 Decisions

## D1: SkillService class for headless App readiness

**Decision:** Extract skill file operations into a `SkillService` class instead of adding logic directly to REST routes.

**Why:** M6.10 will extract a headless `App` class. SkillService becomes `app.skills` with zero rewrite. Both MCP handlers and REST routes share the same logic.

**Alternatives considered:**
- A) REST routes with direct file I/O — simpler now, rewrite needed in M6.10
- B) MCP passthrough (REST calls MCP tools) — adds unnecessary MCP client in HTTP layer

## D2: Search integration deferred

**Decision:** Skill search is not included in S6. The spec says "indexed by notebook's existing search" but the search service indexes `notebook/` files, not `.claude/skills/`. Extending the search service's indexing scope is a separate concern.

**Why:** Adding skills to the search index requires changes to the memory/search infrastructure, which is out of scope for a dashboard UI sprint. Better handled as a focused follow-up.

## D3: Edit UI uses inline textarea, not separate tab

**Decision:** Edit mode shows within the skill detail panel (textarea + description input + Save/Cancel), not as a separate editor tab.

**Why:** Follows the existing notebook file edit pattern (inline edit mode in the browser panel). Consistent UX, less code.

## D4: Team composition — 2 devs + tech lead

**Decision:** Backend dev (Tasks 1-3) and frontend dev (Tasks 4-6) working in sequence, tech lead handles E2E (Task 7) and artifacts (Task 8).

**Why:** Clear dependency chain (backend → frontend → E2E). Backend dev unblocked frontend dev by completing the API first.
