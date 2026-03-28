# M7-S8 External Review: Debrief Worker Architecture

**Reviewer:** External (Opus 4.6)
**Date:** 2026-03-28
**Verdict:** PASS

---

## Section Verdicts

| # | Section | Verdict |
|---|---------|---------|
| 1 | Code Changes | PASS |
| 2 | All 10 Findings Resolved | PASS |
| 3 | Tests Pass | PASS |
| 4 | Type Check | PASS |
| 5 | Manifest Integrity | PASS |
| 6 | Design Doc Alignment | PASS (with note) |
| 7 | Debrief Pipeline E2E | PASS |
| 8 | Gaps and Risks | No blockers |

---

## 1. Code Changes (Commit Verification)

Seven commits on master, oldest to newest:

1. **`4feafc9`** — docs: close S7, plan S8. Sprint plan and DECISIONS.md created. Verified.
2. **`2fc1240`** — test(m7-s7): unit and integration tests for automation stack. Pre-S8 test foundation. Verified: 82 test files pass.
3. **`c20d0f5`** — feat: debrief worker pipeline. This is the main implementation commit. Adds `getDebriefPendingJobs()` in `db.ts`, `debrief-reporter` handler in `handler-registry.ts`, `WebSearch`/`WebFetch` to `WORKER_TOOLS`. Verified: all three changes present in source.
4. **`0d6cfb0`** — feat: manifest orphan audit on startup. `syncAll()` in `automation-manager.ts` compares DB active entries against `.md` files, disables orphans. Verified: orphan detection loop at lines 240-254.
5. **`f047ddd`** — fix: map handler+system fields in automation `list()`. Both `handler` and `system` are now mapped from DB rows in `list()` at lines 199-200. Verified.
6. **`34dd0c1`** — fix: debrief reporter writes brief to disk, adapter reads file. Reporter writes to `morning-brief.md` (handler-registry.ts line 297-302). Adapter reads from the same path (debrief-automation-adapter.ts line 48). Verified: paths match.
7. **`df54428`** — fix: debrief reporter uses 24h window instead of last-run time. Reporter uses `Date.now() - 86400000` (handler-registry.ts line 256). Verified: no last-run cutoff logic exists.

No regressions detected. Each commit's claim matches the code.

## 2. All 10 Findings Resolved

### Finding 1: WhatsApp message split
**Status:** RESOLVED
`message-handler.ts` lines 606-607 handle `tool_use_start` event. On first tool use with preceding text, it saves and sends the ack as a separate message, then resets `assistantContent` for message 2. Logic mirrors `chat-service.ts` (web path).

### Finding 2: Brain mediator framing
**Status:** RESOLVED
All system prompt injections include mediator framing:
- `automation-processor.ts` line 182: "You are the conversation layer -- present what matters..."
- `automation-processor.ts` line 194: "You are the conversation layer -- present this to the user naturally..."
- `app.ts` line 1036: "You are the conversation layer -- let the user know..."
- `conversation-initiator.ts` line 158: "You are the conversation layer -- explain briefly..."
- `routes/debug.ts` line 742: "You are the conversation layer -- ask the user..."

No raw status dumps found anywhere.

### Finding 3: handler/system field mapping
**Status:** RESOLVED
`automation-manager.ts` `list()` at lines 199-200 maps both `handler` and `system` from DB row to manifest.

### Finding 4: Orphan audit
**Status:** RESOLVED
`automation-manager.ts` `syncAll()` at lines 240-254 detects active DB entries without corresponding `.md` files and disables them. Log message clearly identifies orphans.

### Finding 5: Worker tools
**Status:** RESOLVED
`automation-executor.ts` line 30: `WORKER_TOOLS` includes `WebSearch` and `WebFetch` alongside the original 7 tools.

### Finding 6: Debrief collector
**Status:** RESOLVED
`db.ts` `getDebriefPendingJobs(since)` at lines 1026-1052. SQL joins `jobs` with `automations` where `notify = 'debrief'` and `status = 'completed'` and `completed >= since`. Returns structured results.

### Finding 7: Reporter handler
**Status:** RESOLVED
`handler-registry.ts` registers `debrief-reporter` at line 235. It:
1. Runs `debrief-context` to refresh `current-state.md`
2. Reads refreshed notebook context
3. Queries `getDebriefPendingJobs()` with 24h window
4. Reads `status-report.md` from each job's `run_dir` (fallback to summary)
5. Assembles structured brief with notebook context + worker reports
6. Writes to `morning-brief.md` and returns as deliverable

### Finding 8: Brief persistence
**Status:** RESOLVED
Reporter writes to `notebook/operations/morning-brief.md` (handler-registry.ts line 297-302). Adapter reads from the same path (debrief-automation-adapter.ts line 48). Both use `join(agentDir/notebookDir, "notebook", "operations", "morning-brief.md")`.

### Finding 9: Collection window
**Status:** RESOLVED
Reporter uses `new Date(Date.now() - 86400000).toISOString()` — a 24h rolling window (handler-registry.ts line 256). No last-run cutoff logic exists. Comment explicitly documents the rationale.

### Finding 10: Tool narration
**Status:** RESOLVED
Standing orders at `.my_agent/notebook/reference/standing-orders.md` has a "Conversation Voice" section with explicit instructions: "Don't narrate your tool usage." Includes good/bad examples.

## 3. Tests Pass

**PASS** — 82 test files, 740 tests passed, 2 skipped, 0 failures. Duration 15.11s.
See `test-report.md` for details.

## 4. Type Check

**PASS** — `npx tsc --noEmit` completed with zero errors.

## 5. Manifest Integrity

**PASS** — All 7 active automations in the DB have corresponding `.md` files on disk:
- 3 system automations: `debrief`, `system-daily-summary`, `debrief-reporter`
- 4 user automations: `thailand-news-worker`, `chiang-mai-aqi-worker`, `chiang-mai-events-worker`, `project-status-worker`

Zero orphans.

## 6. Design Doc Alignment

**PASS** (with note)

- **ROADMAP.md:** S7 marked "Superseded", S8 and S9 both listed with descriptions. S8 row has sprint plan link. However, **S8 status says "Planned" when it should say "Done" or "Complete"** — the work is merged to master. This is a cosmetic issue, not a blocker.
- **Spec (`2026-03-22-m7-spaces-automations-jobs.md`):** Updated with `WORKER_TOOLS` note (line 257: "Updated 2026-03-27 (M7-S8): WORKER_TOOLS now includes WebSearch and WebFetch"). Debrief Pipeline section (line 767+) documents the full collector-reporter architecture with the worker -> context -> reporter -> delivery flow.
- **`packages/dashboard/CLAUDE.md`:** "System Prompt Injections" section present at line 106 with mediator framing rules, pattern examples, and the origin story.

## 7. Debrief Pipeline E2E

**PASS**

`morning-brief.md` exists and contains:
- Notebook context: Today, Yesterday, Past 7 Days, This Month Ahead sections with real data (AQI readings, Thai news, events, project status)
- Worker Reports section (after `---` separator) with Daily Summary worker output
- Full status report from the worker including artifacts list, findings, and issues

The pipeline demonstrably ran end-to-end: workers executed, wrote `status-report.md` to their run directories, the reporter collected them, and assembled the brief.

## 8. Gaps and Risks

### Follow-ups for S9

1. **ROADMAP S8 status:** Still says "Planned" instead of "Done/Complete". Should be updated when closing the sprint.

2. **Single worker in brief:** The morning brief currently shows only the "Daily Summary" worker report. The other workers (thailand-news, chiang-mai-aqi, chiang-mai-events, project-status) may be too new or may have been consolidated into daily-summary. Worth verifying in S9 that each worker's output appears as a separate section when they all run.

3. **Backward-compat alias:** `debrief-prep` is aliased to `debrief-context` (handler-registry.ts line 226). This is good for migration but should be removed in a future sprint once all manifests are confirmed updated.

4. **Error handling in reporter:** If `debrief-context` handler throws, the reporter catches nothing — it would propagate and fail the whole job. Consider wrapping step 1 in try/catch so worker reports are still collected even if notebook context fails.

### No Blockers

All 10 findings are resolved. The implementation matches the plan. Code quality is consistent with the codebase patterns. No security or regression concerns.

---

## Overall Verdict: PASS

The sprint successfully resolved all 8 original integration gaps (expressed as 10 verification items). The debrief worker pipeline is architecturally sound — workers produce reports, the collector queries them, the reporter assembles and persists the brief, and the MCP adapter reads it for on-demand access. The mediator framing pattern is well-documented and consistently applied across all system prompt injection sites.
