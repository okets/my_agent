# M6.8-S5 Decisions

## D1: Trimmed triage behavioral tests, added browser E2E

**Decision:** Reduced Task 6 from 10 content-validation tests to 3 smoke checks. Added Playwright-based browser E2E to Task 8 — verifying Nina naturally creates and updates skills via conversation.

**Why:** CTO wanted fewer mechanical content tests, more proof that the system works end-to-end. Real validation = does Nina route "teach me X" to `create_skill` naturally?

**Outcome:** 3 triage smoke tests + full E2E conversation test (create + update). Both passed.

## D2: Backend dev picked up Tasks 5 and 7

**Decision:** Backend dev completed Tasks 5 (description guide) and 7 (lifecycle test) in addition to Tasks 1-3, since content dev was still working on Task 4.

**Why:** Maximized parallelism. Tasks 5 and 7 had no dependency on Task 4.

## D3: No debug API endpoint for skill tools

**Decision:** Skill tools are exposed only via MCP (available to agent sessions), not via debug HTTP routes.

**Why:** Follows the MCP-first pattern. The task-tools server has debug routes because they predate the MCP pattern, but new servers should be MCP-only. Verification done via browser E2E instead.
