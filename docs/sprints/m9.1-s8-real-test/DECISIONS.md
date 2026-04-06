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

## D4: Executor overwrites worker deliverable with stream text

**Date:** 2026-04-06
**Context:** Smoke test run 2 — worker wrote `deliverable.md` with proper YAML frontmatter (validators passed during session). After session ended, executor extracted response text and overwrote the file, losing frontmatter.

**Root cause:** `automation-executor.ts` line 339-340 unconditionally writes extracted deliverable to `deliverable.md`.

**Decision:** Check if `deliverable.md` already exists and starts with `---` (YAML frontmatter). If so, preserve the worker's version.

## D5: Todo template text too vague for validated items

**Date:** 2026-04-06
**Context:** Smoke test run 2 — worker tried to mark `change_type_set` validator item done before writing the deliverable. Failed 3x and got auto-blocked.

**Decision:** Updated template text to explicitly mention what file and frontmatter field the validator checks. E.g., "Identify change type ... — write to deliverable.md frontmatter as change_type".

## D6: Worker forgets to retry failed validation

**Date:** 2026-04-06
**Context:** Smoke test run 3 — t8 (test_executed) failed validation once, worker wrote deliverable with `test_result: pass`, but never retried `todo_update(t8, "done")`. Session ended with t8 in_progress.

**Decision:** Strengthened retry instruction in prompt: "read the error, fix the issue, then call todo_update AGAIN. Do not move on until validated items pass." This is a compliance improvement, not a code fix — the system correctly gated the job as needs_review.

## D7: Conversation Nina omits delegator todos

**Date:** 2026-04-06
**Context:** Test 1 — Nina created `smoke-test-cap-add-format-flag` automation with `job_type: capability_modify` but no `todos` field in the manifest.

**Decision:** Not a code fix needed. The design spec says delegator items (Layer 1) are "the primary plan" but the framework template (Layer 2) provides mandatory process items regardless. This is a prompt quality issue for future optimization, not a system failure.

**Trade-off:** Accepted — the worker still gets all mandatory items from the template. Missing delegator items means the worker doesn't see the user's task breakdown, but the instructions field contains the full context.

## D3: Health check endpoint — use root instead of /health

**Date:** 2026-04-06
**Context:** Reset script referenced `/health` endpoint that doesn't exist.

**Decision:** Use `GET /` (returns 200) with retry loop (10x2s). Per CTO: "Don't add a route for this — it's a test script convenience, not a feature."
