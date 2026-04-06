# M9.1-S8 Architect Sprint Review

> **Reviewer:** CTO + Claude Code (architects)
> **Date:** 2026-04-06
> **Verdict:** PASS — M9.1 milestone approved

---

## Summary

S8 validated the entire agentic flow with real LLM sessions. 8 tests, 4 smoke test runs, 4 real bugs found and fixed iteratively. The bugs were legitimate integration gaps (worker prompt missing todo instructions, executor overwriting deliverables, vague template text, weak retry instruction). All fixed correctly and minimally.

The systemic issues from M9-S8 are resolved. Nina delegates through the system, workers follow process via todo templates + validators, jobs report status, notifications persist and deliver, restarts recover interrupted work, and source code is protected.

---

## Test Results

All 8 tests PASS. No test required subjective interpretation — all verified via artifacts on disk or observable system behavior.

## Bugs Found During Testing

| Bug | Severity | Fix | Correct? |
|---|---|---|---|
| Worker never called todo tools | Critical | Added todo instructions to worker prompt | Yes — integration gap between S1 and existing prompt |
| Executor overwrote worker deliverable | Critical | Preserve worker version if it has YAML frontmatter | Yes — validators check the worker's structured output |
| Vague template text | Important | Templates now specify target file and frontmatter field | Yes — workers need to know what validators expect |
| Worker didn't retry after validation failure | Important | Stronger retry instruction in prompt | Yes — completion gating was the safety net |

All 4 bugs are the kind of issues that only surface in live testing — they involve the interaction between LLM behavior and framework code. This validates the decision to run real tests in S8 rather than relying solely on mocked E2E tests.

## D7: Conversation Nina Omits Delegator Todos

**Finding:** Nina sets `job_type` correctly but leaves `todos` empty. Layer 1 of the 3-layer assembly is unused. Workers get only framework template items.

**Root causes:**
1. `todos` is `.optional()` in the `create_automation` tool schema — no nudge to include it
2. No system prompt or skill instructs Nina to populate it
3. `conversation-role.md` references `create_task` (nonexistent tool), not `create_automation`

**Impact:** Nina is a reliable dispatcher but not yet a project manager. Process compliance works (via templates), task planning doesn't (Layer 1 empty). The design's full vision is partially realized.

**Status:** Fix now — update tool description + fix skill reference. No new sprint needed.

---

## M9.1 Milestone Assessment

### Original problems → resolved

| Problem | Resolution | Validated in S8 |
|---|---|---|
| A: Nina acts inline | Hook 2 blocks direct edits, forces delegation | Test 1 ✓ |
| B: Purely reactive | Heartbeat + persistent notifications + system prompt briefing | Tests 4, 5 ✓ |
| C: Worker ignores process | Todo templates + validators + completion gating | Tests 2, 3 ✓ |
| D: Infrastructure gaps compound | Scanner loudness, findById from disk, target_path from manifest | Test 7 ✓ |
| Restart loses work | Recovery sequence + resume flow | Test 6 ✓ |
| Self-harm risk | Source code protection hook | Test 8 ✓ |

### What M9.1 delivered

- Universal todo system (MCP server, 4 tools, per-session persistence)
- Static templates for capability jobs with code-validated mandatory items
- Heartbeat monitoring (30s tick, stale detection, capability health)
- Persistent notification queue (survives restarts, 3 delivery channels)
- Enforcement hooks (source code protection, capability routing, Stop reminder)
- Status communication (enhanced check_job_status, system prompt enrichment)
- Restart recovery (interrupted detection, resume flow, stale cleanup)
- Smoke test infrastructure (repeatable reset + test scripts)
- 55+ new tests across unit, integration, and E2E layers

### Known limitation

D7 (delegator todos) — tracked, fix in progress. Does not affect process compliance, only task planning granularity.

---

## Action: Fix D7 now

Two changes, no new sprint:

1. **Update `create_automation` tool description** — tell Nina to always include `todos` when delegating capability work
2. **Fix `conversation-role.md`** — reference `create_automation` (not `create_task`), include example with `todos`

---

*M9.1: Agentic Flow Overhaul — APPROVED*
*8 sprints, 12 systemic issues resolved, agentic flow validated live*
