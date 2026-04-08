# M9.3-S1 Prompt Corrections — Architect Review

**Reviewer:** Opus (architect, separate session)
**Date:** 2026-04-08
**Scope:** S1 commits `ba4863b..f6b51fa` (6 plan commits + 5 bonus)

---

## Verdict: APPROVED

S1 delivers the planned prompt corrections precisely. The contradiction that was the #1 root cause of 0% delegation compliance is eliminated. The bonus work (dismiss/disable tools, heartbeat fix) is clean and complementary.

---

## Root Cause Validation

I traced the full agentic flow before this sprint was planned. The investigation confirmed 7 root causes, with the primary being contradictory instructions across skills. S1 addresses root causes 1, 2, and partially 5:

| Root Cause | Addressed? | How |
|---|---|---|
| 1. Contradictory instructions ("your call") | **Yes** | `operational-rules.md` rewritten — imperative delegation, no escape hatches |
| 2. Tool description framing ("standing instruction") | **Yes** | `create_automation` description leads with "Delegate work" + concrete examples |
| 3. Delegation friction (10 fields vs 1) | No | Deferred to S4 (`quick_lookup` wrapper) if needed |
| 4. Interview-first compounds friction | No | Design tension — interview is valuable, can't remove |
| 5. System prompt dilution | **Partial** | Motivation section gives delegation instructions more weight |
| 6. No code enforcement | No | S2 (budget hook) |
| 7. Hallucinated scheduling | No | Should improve with clearer tool description, but unverified |

---

## Plan Adherence

All 4 tasks implemented as specified:

| Task | Plan | Commit | Match |
|------|------|--------|-------|
| T1: Remove contradiction | Remove "your call", "consider delegating" | `ba4863b` | Exact |
| T2: Add motivation | WHY section + tighten quick lookups | `47b667d` | Exact |
| T3: Exhaustive rules | ONLY/MUST + self-check | `93fb054` | Exact |
| T4: Reframe tool description | "Delegate work to a working agent" | `ebd5ebb` | Exact |

---

## Skill File Consistency Audit

I verified all three brain-level skills now align:

| Skill | Before S1 | After S1 | Consistent? |
|---|---|---|---|
| `conversation-role.md` | "You do not do work yourself" (imperative) | Same + motivation + "one search, one answer" | Yes |
| `task-triage.md` | "For anything beyond a quick WebSearch" (imperative but vague) | ONLY/MUST exhaustive rules + self-check | Yes |
| `operational-rules.md` | **"your call"** (contradicts above) | "delegate the work via `create_automation`" (imperative) | **Fixed** |

No remaining advisory or permissive delegation language across any skill file. The three skills now reinforce each other instead of contradicting.

---

## Quality Assessment

### What works well

1. **Self-check instruction** ("before calling WebSearch a second time, stop and ask yourself: Is this research?") — this is the highest-leverage single change. It places the decision checkpoint at the exact moment of failure. LLMs respond well to metacognitive prompts that trigger re-evaluation.

2. **Motivation over mandates.** The WHY section in `conversation-role.md` (paper trail, debrief, resumability, validation) gives the model a reason to comply rather than just a rule. This aligns with Anthropic's prompting guidance: context/motivation behind instructions improves compliance.

3. **Tool description with examples.** Adding "Examples: 'Research best headphones under $300'" directly maps the failed M9.2 test prompts to the tool. The brain should now pattern-match "research X" to `create_automation`.

4. **Regression test design.** `prompt-delegation-compliance.test.ts` copies real skill files (not stubs) and checks both banned and required phrases. It will catch drift.

### Concerns

1. **Prompt-only fixes have a ceiling.** The research agent's assessment (40-60% compliance from prompts alone) is realistic. The budget hook in S2 is essential — don't skip it even if early E2E tests look good. The LLM's optimization for immediate helpfulness is a strong competing signal that prompt instructions can only partially overcome.

2. **Interview-first tension remains.** `task-triage.md` still says "Every task and every skill MUST start with an interview." For obvious research requests ("Research headphones under $300"), the brain might interview first (good) but then answer inline instead of delegating after the interview (bad). The self-check instruction should catch this, but watch for it in S3 E2E tests.

3. **Hallucinated scheduling (Test A) may persist.** The tool description reframe helps, but the brain's tendency to say "Scheduled. I'll check at 18:15" without actually calling any tool is a deeper issue — the model is pattern-matching to conversational scheduling rather than tool-based scheduling. The budget hook won't help here (no WebSearch is called). If Test A still fails in S3, consider a specific prompt addition: "To schedule a future task, you MUST call `create_automation` with a schedule trigger. You cannot schedule tasks by saying you will — only the tool creates actual schedules."

---

## Bonus Work Assessment

5 extra commits outside the plan:

| Commit | What | Clean? |
|---|---|---|
| `9ada7ef` | `dismiss_job` MCP tool | Yes — no tests though (I1) |
| `639018d` | `disable_automation` MCP tool | Yes — no tests (I1) |
| `fafdf45` | Dismissed job UI styling + live updates | Yes |
| `697db54` | Audit fixes (orphaned jobs, description) | Yes |
| `fef7152` | Heartbeat initiate on preferred channel | Yes — follows CLAUDE.md pattern |

**I1 (Important):** `dismiss_job` and `disable_automation` lack unit tests. Non-trivial logic (status guards, orphaned-job fallback, idempotency). Should be covered before S2.

---

## S2 Readiness

S1 is the foundation. S2 (WebSearch budget hook) adds code enforcement on top. The plan is sound:
- `packages/core/src/hooks/delegation.ts` — new file, self-contained
- Wire into `session-manager.ts` — minimal integration
- Unit tests cover allow/block/reset

**No blockers for S2.**

---

## Recommendation

**Merge S1. Proceed to S2.** Address I1 (bonus tool tests) as a housekeeping item before S3 E2E verification so the full test suite is clean for the compliance gate.
