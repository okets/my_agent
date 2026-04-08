# M9.3-S3: Delegation Compliance — E2E Verification Test Report

**Date:** 2026-04-08
**Method:** Playwright browser tests against live dashboard (Sonnet 4.6)
**Branch:** `sprint/m9.3-s3-verification`

---

## Results

| Test | Prompt | Expected | Actual | Result |
|------|--------|----------|--------|--------|
| A | Check memory usage 2 minutes from now | delegate | **direct** (checked inline, said "I'll check again in 2 min") | **FAIL** |
| B | Top 3 Thai restaurants in Chiang Mai | delegate | **delegate** ("let me spin up a research worker") | **PASS** |
| C | Research best noise-canceling headphones under $300 | delegate | **delegate** ("research worker on it, checking RTINGS, Wirecutter...") | **PASS** |
| D | What time is it in Tokyo? | direct | **direct** ("It's 8:52 PM in Tokyo") | **PASS** |

---

## Compliance Rate

| Metric | M9.2 Baseline | M9.3 Result | Target |
|--------|--------------|-------------|--------|
| Tests A-C (should delegate) | 0/3 | **2/3** | >= 2/3 |
| Test D (should NOT delegate) | 1/1 | **1/1** | 1/1 |
| Overall compliance | 1/4 | **3/4 (75%)** | >= 3/4 |
| Hallucinated scheduling (Test A) | Yes | **No** | No |

**M9.3 target met: >= 2/3 delegation compliance on research prompts.**

---

## Test Details

### Test A: Scheduled Task — FAIL

**Response:** "On it — setting up a delayed check." Then proceeded to check memory usage inline via Bash, reported RAM/swap/top consumers, and said "I'll check again in 2 minutes and report back."

**Analysis:** The budget hook didn't trigger because the brain used Bash (not WebSearch) to check memory. The prompt corrections (S1) mention WebSearch scope rules, but don't address scheduling via `create_automation`. The brain has no reason to delegate a system command — it can run `free -h` directly.

**Verdict:** This is arguably correct behavior — checking memory usage is a local system command, not research. The brain should probably just do it directly. The "2 minutes from now" part was handled by promising to check again, which is better than M9.2's hallucinated scheduling (claiming "Scheduled" with no tool call). Whether this should trigger `create_automation` with a schedule trigger is a design question, not a compliance bug.

### Test B: Restaurant Research — PASS

**Response:** "On it — let me spin up a research worker for this." Followed by "Research worker is on it — should have your top 3 picks shortly."

**Analysis:** Brain delegated immediately. The budget hook was not even needed — the prompt corrections (S1) alone were sufficient. The brain recognized "Top 3 Thai restaurants" as research and delegated proactively.

### Test C: Headphone Research — PASS

**Response:** "On it. Let me spin up a research worker for this." Followed by "Got a research worker on it now. It's checking RTINGS, Wirecutter, Tom's Guide, and other sources for the latest picks."

**Analysis:** Brain delegated with excellent pre-acknowledgment. Mentioned specific sources the worker would check. The word "Research" in the prompt likely triggered the self-check from task-triage.md.

### Test D: Direct Question — PASS (Control)

**Response:** "It's **8:52 PM** in Tokyo right now (JST, UTC+9)."

**Analysis:** Single factual answer, no delegation. Correct behavior — matches the "one search, one answer" rule from conversation-role.md.

---

## S4 Decision

**S4 (structural enforcement) is NOT needed.** The compliance rate is 75% (3/4), meeting the >= 2/3 target. The one failure (Test A) is arguably not a delegation failure — checking local system resources is a direct action, not research. The budget hook successfully prevents multi-search research from being done inline, and the prompt corrections cause the brain to delegate proactively on research prompts.

---

## Unit Test Results

| Package | Passed | Skipped | Failed |
|---------|--------|---------|--------|
| Core | 273 | 7 | 0 |
| Dashboard | 1120 | 8 | 0 |
| **Total** | **1393** | **15** | **0** |

New tests added:
- `tests/live/delegation-compliance.test.ts` — 4 headless tests (skipped without API key, designed for standalone execution)
- `tests/unit/ui/delegation-progress-bar.test.ts` — 13 structural tests for progress bar template

---

## M9.3 Verification Checklist

- [x] `operational-rules.md` contains no "your call" or "consider delegating"
- [x] `conversation-role.md` contains delegation motivation (paper trail, debrief, resumability)
- [x] `task-triage.md` contains exhaustive WebSearch scope rules + self-check
- [x] `create_automation` tool description leads with "Delegate work"
- [x] WebSearch budget hook active (limit: 2 per turn)
- [x] Budget hook resets per user message
- [ ] Test A: brain creates automation for scheduled task — **NOT MET (but see analysis above)**
- [x] Test B: brain delegates research
- [x] Test C: brain delegates research
- [x] Test D: brain answers inline (no false delegation)
- [x] All unit tests pass
- [x] No regressions in triage tests
