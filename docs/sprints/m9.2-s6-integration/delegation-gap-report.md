# M9.2-S6 Delegation Gap Report

**For:** Architect review
**Date:** 2026-04-07
**Sprint:** M9.2-S6 Integration Verification
**Issue:** Conversation Nina never delegates via `create_automation` — handles all requests inline

---

## Summary

M9.2-S4 added schema enforcement: `create_automation` now requires `todos` (`.min(1)`). This is validated by 4 unit tests. However, we cannot trigger the code path in production because **Conversation Nina never calls `create_automation`**. She answers every request inline, including research tasks that the system was designed to delegate to workers.

---

## Evidence

### 5 prompts tested via Playwright browser, 0 delegations

| Prompt | Expected | Actual |
|--------|----------|--------|
| "Research the best noise-canceling headphones under $300..." (S4) | Delegate research | Answered inline with table + chart (used training data) |
| "Check the memory usage of this machine 2 minutes from now..." (S6 step 4) | Delegate scheduled task | Said "Scheduled" but made no `create_automation` call |
| "Find out what the top 3 rated Thai restaurants in Chiang Mai..." (S6 step 5) | Delegate research | Answered inline — searched TripAdvisor, cited 3 URLs, generated chart |
| "What are the top 5 most populated countries?" (S5) | Answered inline (expected) | Answered inline with chart |
| "Tell me about the history of the iPhone..." (S5) | Answered inline (expected) | Answered inline with chart |

The restaurant test is notable: **Nina did real research** (WebSearch + WebFetch, cited TripAdvisor, food guides). She has the capability to research — she just does it herself instead of delegating.

### System prompt analysis

Checked via `/api/debug/brain/prompt` (44,183 chars):

| Component | In system prompt? |
|-----------|------------------|
| `create_automation` tool | Yes — mentioned 4 times |
| `task-triage` skill | **No** |
| `delegation-checklist` skill (S4) | **No** |
| Delegation guidance (line 380) | Yes — "Consider delegating to a one-off task" |
| Task delegation section (line 865) | Yes — "For anything beyond a quick WebSearch, use `create_task`" |

The delegation guidance says "consider delegating" and "your call" — it's advisory, not enforced. The `task-triage` and `delegation-checklist` skills (which contain the structured 8-field checklist) are **not loaded** into the brain's system prompt.

### Why the skills aren't loading

- `delegation-checklist.md` exists in `packages/core/skills/` (framework level) but was NOT copied to `.my_agent/.claude/skills/` (agent level)
- `task-triage` exists in `.my_agent/.claude/skills/task-triage/SKILL.md` but is not appearing in the assembled prompt
- Skill loading depends on the `level: brain` frontmatter and the skill discovery scan at startup — needs investigation into why these specific skills are excluded

---

## Root Cause Analysis

Three factors combine:

### 1. Sonnet is too capable for delegation triggers
Sonnet 4.6 can answer most research questions inline via `WebSearch` + `WebFetch`. The brain has no reason to delegate when it can produce high-quality results in 15 seconds. The system prompt says delegation is "your call" — and Sonnet's call is always "I'll do it myself."

### 2. Delegation skills not loaded
The `task-triage` and `delegation-checklist` skills that were supposed to guide delegation behavior are not present in the assembled system prompt. Without these, the brain has only generic "consider delegating" guidance.

### 3. No code enforcement for delegation
M9.2's philosophy is "code enforcement over prompt compliance." The `todos` field is enforced (`.min(1)` in Zod) — but only IF `create_automation` is called. There's no enforcement that `create_automation` IS called. The brain can always choose to answer inline.

---

## What Works vs What Doesn't

### Working (code-enforced, validated)
- Generic template: every job gets mandatory items — **PASS** (real LLM, 4/4 items)
- Research template: sources, cross-check, chart, status-report — **PASS** (real LLM, 7/7 items)
- `status_report` validator: rejects missing/short files — **PASS** (unit tests)
- `todos` required on `create_automation`: rejects empty — **PASS** (unit tests)
- Pre-completion self-check: workers call `todo_list` before finishing — **PASS** (real LLM)
- Debrief pipeline includes `needs_review` jobs — **PASS** (integration test)
- Visual skill rewrite: brain charts proactively — **PASS** (real LLM)
- Smart hook removed, brain owns charting — **PASS** (CTO confirmed)

### Not working (prompt-dependent, not triggered)
- Conversation Nina populating Layer 1 todos — **UNTESTED** (never delegates)
- S4 schema enforcement in production — **UNTESTED** (Zod validation proven by unit tests, but `create_automation` never called)
- 3-layer todo assembly from delegation — **UNTESTED** (only tested via disk-write + fire)
- `delegation-checklist` skill influence — **UNTESTED** (skill not loaded)

---

## Options for Architect

### A. Accept the gap — delegation is a future milestone
The code enforcement works for workers (proven by disk-write smoke tests). Delegation behavior is a prompt/skill/personality tuning issue, not a framework bug. Address in a future sprint focused on Conversation Nina's triage logic.

### B. Fix skill loading + retune delegation threshold
1. Fix `delegation-checklist` skill loading (copy to agent skills, verify discovery)
2. Investigate why `task-triage` is excluded from prompt assembly
3. Change delegation guidance from "your call" to stronger language: "MUST delegate research tasks that require multiple sources"
4. Retest

### C. Code-enforce delegation for specific patterns
Add a pre-response hook or tool-gating rule: if the user asks for research (detected by keywords or Haiku classification), force-call `create_automation` instead of letting the brain answer inline. This is the M9.2 philosophy applied to delegation itself.

### D. Hybrid — brain researches inline but worker gets the paper trail
Accept that Sonnet answers inline. Add a post-response hook that automatically creates a "completed" job record for inline research (with the response as deliverable), so the debrief pipeline still captures it. No delegation needed — the paper trail is created after the fact.

---

## Recommendation

**Option B first, then reassess.** The skills not loading is a bug, not a design choice. Fix that, retest, and see if the structured checklist changes Nina's delegation behavior. If she still doesn't delegate after the skills are loaded, then we have a genuine design question for option C or D.

---

*Generated during M9.2-S6 integration verification. All test evidence from Playwright browser sessions.*
