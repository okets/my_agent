# M7-S8: Debrief Worker Architecture

> **Status:** Planned
> **Branch:** `feat/debrief-workers`
> **Depends on:** S6, S6.5 (system automations, handler registry)
> **Discovered by:** Real-world usage testing (2026-03-26/27) — user gave Nina actual tasks, found integration gaps

## Origin

During hands-on testing with real user tasks (not scripted E2E), the following gaps were discovered:

1. **Message split only worked on web, not WhatsApp** — the actual user channel
2. **Brain responded as worker instead of mediator** — raw status dumps, "Noted. Logging it."
3. **Nina updated policy docs instead of automation code** — debrief handler is hardcoded, not instruction-based
4. **User-created automation lost its manifest** — `daily-summary` runs from DB ghost state, no `.md` file
5. **Workers lack web access** — `WORKER_TOOLS` missing WebSearch/WebFetch
6. **`notify: "debrief"` pipeline doesn't exist** — value is accepted but nothing collects
7. **No debrief reporter** — brief delivery depends on hardcoded handler, not composable workers
8. **Tool-use narration leaks into conversation** — Nina's debugging process visible to user

## Tasks

### Task 1: Fix WhatsApp message split on tool use
- Port the `tool_use_start` split logic from `chat-service.ts` to `message-handler.ts`
- On first tool use with text before it: send ack as separate WhatsApp message, continue accumulating message 2
- **Validates finding #1**

### Task 2: Brain notification mediator framing
- All system prompt injections tell the brain: "You are the conversation layer — present what matters"
- No raw status dumps to the brain
- Fix double-wrap bug in mount failure alert
- Already done in commit `6fff864` — verify no regressions, document in CLAUDE.md
- **Validates finding #2**

### Task 3: Add WebSearch/WebFetch to WORKER_TOOLS
- Update `WORKER_TOOLS` in `automation-executor.ts`
- Workers can now fetch external data (news, AQI, etc.)
- **Validates finding #5**

### Task 4: Fix `create_automation` manifest persistence
- Verify `automationManager.create()` writes `.md` files (it does — investigate why `daily-summary.md` is missing)
- Add startup audit: compare DB automations against `.md` files on disk, log orphans
- Migrate orphaned `daily-summary`: recreate manifest from DB state
- **Validates finding #4**

### Task 5: Rename `debrief-prep` → `debrief-context`, simplify
- Remove `runDebriefPrep()` LLM call — write assembled context directly to `current-state.md`
- Keep all notebook reading logic (summaries, properties, calendar, staged knowledge)
- Update manifest: `handler: debrief-context`, `notify: none`
- **Validates finding #3** (partially — handler becomes context-only, brief content moves to workers)

### Task 6: Add debrief collector query
- New DB method: `getDebriefPendingJobs(since)` — completed jobs where automation's `notify = "debrief"`, since last report
- Returns job ID, automation name, summary, run_dir, completed timestamp
- **Validates finding #6**

### Task 7: Create debrief reporter system job
- New handler `debrief-reporter` in handler-registry:
  1. Run `debrief-context` handler (refresh `current-state.md`)
  2. Query debrief-pending jobs via collector
  3. Read `{run_dir}/status-report.md` for each (fallback to summary)
  4. Assemble full brief as structured sections
  5. Return as deliverable
- Manifest: `cron: "0 8 * * *"` (configurable), `notify: immediate`, `system: true`
- **Validates finding #7**

### Task 8: Update `request_debrief` MCP tool
- Share collector logic with reporter
- Returns assembled brief on-demand when Conversation Nina calls it
- **Validates finding #7** (on-demand path)

### Task 9: Conversation voice — no tool narration
- Standing orders updated: "Don't narrate tool usage"
- Already done — verify it works in practice
- **Validates finding #8**

### Task 10: Change test-watcher to `notify: debrief`
- Update automation config
- Instructions: "Escalate via needs_review on NEW failures. Routine passes go to debrief."
- **Validates finding #6** (existing automation feeds into pipeline)

### Task 11: Standing orders — "add X to brief" pattern
- When user asks to add something to the brief → create worker automation with `notify: debrief`
- Not "edit standing orders" or "update a handler"

## Validation: Recreate User Automations Naturally

After all tasks are complete, clear current user automations and recreate them through conversation with Nina, using the original user prompts:

1. "Add Thailand and Chiang Mai news to the morning brief"
   - **Expected:** Nina creates a worker automation (e.g., `thailand-news`) with `notify: debrief`, cron before debrief reporter
   - **Verify:** `.md` manifest exists, job runs, results appear in next debrief

2. "Add Chiang Mai air quality to the brief"
   - **Expected:** Nina creates `chiang-mai-aqi` worker, `notify: debrief`
   - **Verify:** manifest, execution, debrief inclusion

3. "Add Chiang Mai events to the brief — time-bound only, no evergreen"
   - **Expected:** Nina creates `chiang-mai-events` worker
   - **Verify:** manifest, execution, debrief inclusion

4. "The project status should read the roadmap"
   - **Expected:** Nina creates `project-status` worker that reads `docs/ROADMAP.md`
   - **Verify:** manifest, execution, debrief inclusion

5. **Test-watcher escalation:** Introduce a deliberate test failure, verify needs_review triggers immediate alert via conversation

6. **Debrief assembly:** Trigger `request_debrief` and verify all worker results are collected and presented naturally

**All 8 findings must be verified resolved through this natural recreation process.**

## Execution Order

```
Task 1  (WhatsApp message split)        — already coded, needs deploy + verify
Task 2  (mediator framing)              — already coded, verify no regressions
Task 3  (worker tools)                  — simple constant change
Task 4  (manifest persistence audit)    — investigate + fix
Task 5  (rename/simplify handler)       — low risk
Task 6  (collector query)               — new DB method
Task 7  (debrief reporter)              — depends on 5, 6
Task 8  (MCP tool update)               — depends on 6
Task 9  (conversation voice)            — already done, verify
Task 10 (test-watcher notify)           — config change
Task 11 (standing orders)               — behavioral
─── validation ───
Clear user automations, recreate naturally, verify all 8 findings resolved
```

## Success Criteria

- All 8 original findings verified resolved
- User can say "add X to the brief" and Nina creates a worker automation
- Worker manifests exist as `.md` files (filesystem is truth)
- Debrief reporter assembles worker results and delivers on schedule
- `request_debrief` returns collected worker outputs on demand
- Test-watcher escalates new failures via `needs_review`, routine passes go to debrief
- No tool-use narration in conversation responses
- WhatsApp messages split on tool use (ack arrives immediately)
- Brain notification prompts all have mediator framing
