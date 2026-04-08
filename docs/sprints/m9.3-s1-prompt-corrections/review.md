# M9.3-S1 Prompt Corrections -- External Review

**Reviewer:** Opus (external)
**Date:** 2026-04-08
**Branch:** `sprint/m9.3-s1-prompt-corrections`
**Commits:** 4 (ba4863b, 47b667d, 93fb054, ebd5ebb)
**Files changed:** 6 (+111/-14)

---

## Verdict: PASS with one Important fix required

The sprint delivers exactly what the plan specified across all four tasks. The contradictions identified in the issue report are fully resolved, the new language is clear and directive (not advisory), and the regression test covers the key phrases. One issue in the existing triage regression test needs to be fixed before merge.

---

## Checklist Results

### 1. Do the skill file changes remove ALL contradictions identified in the issue report?

**Yes.** The issue report identified three specific contradictions:

| Contradiction | Location | Status |
|---|---|---|
| "your call" (line 12) | `skills/operational-rules.md` | Removed in ba4863b |
| "Consider delegating" (line 17) | `skills/operational-rules.md` | Removed in ba4863b |
| "quick lookups: WebSearch for simple facts" (generic) | `skills/conversation-role.md` | Tightened to "one search, one answer" in 47b667d |

Grep confirms zero remaining instances of "your call" or "consider delegat" across all skill files.

### 2. Is the new language clear and unambiguous (not advisory)?

**Yes.** The language shift is consistent across all three skills:

- `operational-rules.md`: "Then -- delegate the work via `create_automation`" (imperative, not "your call")
- `conversation-role.md`: "If you need a second search, delegate instead." (conditional imperative)
- `task-triage.md`: "You may use WebSearch ONLY for" / "You MUST delegate via create_automation for" (exhaustive ONLY/MUST rules)
- Self-check: "before calling WebSearch a second time, stop and ask yourself" (metacognitive instruction)

All four files now point in the same direction. There are no remaining escape hatches that grant permission to work inline.

### 3. Does the regression test cover the key phrases adequately?

**Yes.** `packages/core/tests/prompt-delegation-compliance.test.ts` covers:

- **Banned phrases (2):** "your call", "consider delegating" -- case-insensitive check
- **Required phrases (7):** paper trail, debrief integration, ONLY/MUST rules, self-check, identity sentences

The test copies actual skill files from the repo (not stubs), so it will break if the phrases drift in future edits. This is good regression coverage.

### 4. Does the triage regression test update correctly reflect the new wording without losing coverage?

**Mostly yes, but one sub-test is broken.**

The three updated directives in `TRIAGE_DIRECTIVES` correctly match the new wording:

| Old | New | Correct? |
|---|---|---|
| `For anything beyond a quick WebSearch` | `For anything beyond a single-question WebSearch` | Yes |
| `WebSearch: single factual question, one search, instant answer` | `You may use WebSearch ONLY for` | Yes |
| `create_automation: research, comparison, multi-step work` | `You MUST delegate via create_automation for` | Yes |

**However**, the duplication test at line 81 still uses the old marker string:

```typescript
const marker = 'For anything beyond a quick WebSearch, use `create_automation`'
```

This string no longer exists in the prompt, so `indexOf` returns -1. The assertion `expect(-1).toBe(-1)` passes vacuously. The test no longer guards against double-inclusion. See "Issues" below.

### 5. Is the `create_automation` tool description accurate and not misleading?

**Yes.** The old description ("standing instruction") biased toward recurring work and did not match one-off research delegation. The new description leads with "Delegate work to a working agent" and includes three concrete examples matching the exact prompts that failed in M9.2-S10. This reframing directly addresses the issue report's tertiary root cause.

### 6. Any spec gaps -- things the plan asked for that were not done?

**None.** All four S1 tasks are complete:
- Task 1: operational-rules.md contradiction removed (ba4863b)
- Task 2: conversation-role.md motivation + tightened lookups (47b667d)
- Task 3: task-triage.md exhaustive rules + self-check (93fb054)
- Task 4: create_automation tool description rewritten (ebd5ebb)

---

## Issues

### Important: Stale duplication marker in triage regression test

**File:** `packages/core/tests/prompt-triage-regression.test.ts:81`

**Problem:** The "does not double-include triage content" test uses the old string `'For anything beyond a quick WebSearch, use \`create_automation\`'` as its duplication marker. This string was changed to `'For anything beyond a single-question WebSearch'` in this sprint. The marker is never found, so the test passes vacuously without actually checking for duplication.

**Fix:** Update line 81 to use the new string:
```typescript
const marker = 'For anything beyond a single-question WebSearch, use `create_automation`'
```

**Severity:** Important -- the test silently lost its purpose. It will not catch duplication regressions until fixed.

---

## What Was Done Well

1. **Exact plan adherence.** Every commit maps 1:1 to a plan task with the exact commit message format specified. No scope creep, no deviations.

2. **Consistent voice across files.** The three skill files and the tool description all reinforce the same message without contradicting each other. The motivation section in conversation-role.md gives the LLM a reason to comply, not just a rule to follow.

3. **Self-check instruction.** The metacognitive prompt ("before calling WebSearch a second time, stop and ask yourself: Is this research?") is the most effective pattern for LLM compliance -- it forces the model to re-evaluate at the decision point rather than relying on upfront instructions.

4. **Test-first approach.** The regression test was created before the fixes, matching the plan's prescribed workflow.

5. **Minimal, surgical changes.** 111 additions across 6 files, focused entirely on the identified contradictions. No unnecessary refactoring.
