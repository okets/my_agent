# M9.1-S8 Decisions

## D1: Working Nina prompt missing todo instructions

**Date:** 2026-04-06
**Context:** Smoke test run 1 — worker completed the capability modification correctly but ignored the todo system entirely (0/9 items marked done). Job correctly gated to `needs_review`.

**Root cause:** `working-nina-prompt.ts` had zero mention of the todo system. The todo MCP tools were wired into the worker session, and the Stop hook was registered, but the worker had no instructions to use them.

**Decision:** Added a "Todo System (MANDATORY)" section to the working nina persona prompt with clear instructions to call `todo_list` first, mark items in_progress/done, and a warning that skipping todos flags the job.

**Trade-off:** More prompt tokens per worker session (~150 words). Acceptable — this is exactly the design spec's principle: "If data MUST exist, the framework produces or validates it."

## D2: Smoke test script adaptation — no POST /api/automations

**Date:** 2026-04-06
**Context:** Implementation plan's smoke test script used `POST /api/automations` to create automations, but this route doesn't exist. `create_automation` is only available as an MCP tool inside agent sessions.

**Decision:** Write automation manifest files directly to `.my_agent/automations/` and restart the dashboard to trigger `syncAll()`. This mirrors how automations are created outside of conversations.

**Architect approved:** "Writing the manifest to disk and syncing is how automations are created outside of a conversation."

## D3: Health check endpoint — use root instead of /health

**Date:** 2026-04-06
**Context:** Reset script referenced `/health` endpoint that doesn't exist.

**Decision:** Use `GET /` (returns 200) with retry loop (10x2s). Per CTO: "Don't add a route for this — it's a test script convenience, not a feature."
