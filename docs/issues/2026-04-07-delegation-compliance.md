# Issue: Conversation Nina Never Delegates — Delegation Compliance Failure

**Severity:** High — core architectural pattern is non-functional
**Discovered:** M9.2-S6 integration testing (2026-04-07)
**Confirmed:** M9.2-S10 rerun (2026-04-07) — 0 of 7 prompts triggered delegation across two sprints
**Status:** Open — awaiting design decision

---

## Summary

Conversation Nina (brain, Sonnet 4.6) has `create_automation` available as an MCP tool, has detailed delegation instructions in her system prompt, and has a `todos` field enforced by schema validation. But she never calls `create_automation`. Every request — including multi-source research, scheduled tasks, and complex comparisons — is handled inline via WebSearch + reasoning. The entire worker delegation system built in M9.1 and extended in M9.2 is unreachable from the conversation layer.

---

## Current Design

### Architecture (how it should work)

```
User sends message
    ↓
Conversation Nina (brain, Sonnet 4.6)
    ├── Simple question → answer inline (WebSearch)
    ├── Complex research → delegate via create_automation
    │       ↓
    │   Working Nina (worker, Sonnet 4.6)
    │       ├── Todo checklist (mandatory, validated, gated)
    │       ├── Status report (validated)
    │       └── Deliverable → notification → brain presents to user
    └── Skill/memory → handle directly
```

### What the brain receives in its system prompt (~46K chars)

**Layer 1 — conversation-role.md (framework skill):**
- "You are the conversation layer. You do not do work yourself."
- "When the user asks you to research something... delegate it to a working agent via `create_automation`."
- "What you do directly: conversation, quick lookups, memory, task management"
- "What you delegate: research, analysis, file creation, code, browser automation, multi-step comparisons"

**Layer 2 — task-triage.md (framework skill):**
- "For anything beyond a quick WebSearch, use `create_automation` to delegate"
- "WebSearch: single factual question, one search, instant answer"
- "create_automation: research, comparison, multi-step work, file creation"
- 7-field Automation Design Checklist

**Layer 3 — operational-rules.md (framework skill):**
- "For substantial work (multiple searches, long research): consider delegating to a one-off task"
- Language: "your call", "consider delegating"

**Layer 4 — create_automation tool (MCP, schema-enforced):**
- `todos` is required (`.min(1)`) — S4 enforcement
- `description` field explains: "REQUIRED — every task needs at least one todo"
- Tool is available and functional

### What the brain actually does

The brain uses WebSearch + WebFetch inline for everything. It produces high-quality results — multiple sources, charts, structured output. The delegation path is never taken.

---

## Evidence: 7 Prompts, 0 Delegations

| # | Sprint | Prompt | Expected | Actual |
|---|--------|--------|----------|--------|
| 1 | S4 | "Research best noise-canceling headphones under $300" | Delegate research | Inline: table + chart from training data |
| 2 | S4 | "Check memory usage 2 minutes from now" | Delegate scheduled task | Said "Scheduled" but no tool call (hallucinated) |
| 3 | S6 | "Research headphones" (retry) | Delegate | Inline with WebSearch |
| 4 | S6 | "Check memory usage" (retry) | Delegate | Hallucinated scheduling again |
| 5 | S6 | "Top 3 Thai restaurants in Chiang Mai" | Delegate research | Inline: 3 restaurants, 4 sources, chart ($0.31) |
| 6 | S10 | "Check memory usage 2 min from now" (S6 rerun) | Delegate | Hallucinated: "Scheduled. I'll check at 18:15" — no tool call |
| 7 | S10 | "Top 3 Thai restaurants" (S6 rerun) | Delegate | Inline: full research with sources + chart |

**Prompt 2/4/6 is notable:** The brain claims to schedule a delayed task but never calls `create_automation`. It hallucinates the scheduling. This is the most concerning failure — the brain presents false confirmation to the user.

**Prompt 5/7 is notable:** The brain does excellent research inline — WebSearch, WebFetch, TripAdvisor sources, food guides, comparison chart. The quality is indistinguishable from what a worker would produce. The brain has no incentive to delegate because the inline path works.

---

## Root Cause Analysis

### Primary: The brain has the tools to do the work itself

Conversation Nina has WebSearch, WebFetch, memory tools, and chart tools. She can produce research-quality output inline. The delegation instructions say "delegate research" but the brain evaluates: "I can answer this myself in 15 seconds with WebSearch. Why would I create an automation, wait for a worker, then present the results?"

This is rational behavior from the LLM's perspective. The prompt says "delegate" but the tools say "you can do it yourself." Tools win over instructions.

### Secondary: Delegation language is advisory

The three framework skills use soft language:
- conversation-role.md: "delegate it to a working agent" (imperative but no consequence)
- task-triage.md: "For anything beyond a quick WebSearch, use `create_automation`" (imperative, followed by guidance)
- operational-rules.md: "Consider delegating", "your call" (explicitly advisory)

The brain interprets "your call" as permission to do it inline. And since it can, it does.

### Tertiary: No code enforcement for the delegation decision

M9.2's philosophy is "code enforcement > prompt compliance." We code-enforced:
- Todo items (templates, validators, completion gating) ✓
- Status reports (validator) ✓
- Todos on delegation (`create_automation` schema) ✓
- Chart descriptions (required in schema) ✓
- Skill filtering (runtime, not disk writes) ✓
- Worker prompt isolation ✓

But we did NOT code-enforce the delegation decision itself. The brain chooses whether to delegate. All enforcement happens AFTER delegation — which never occurs.

---

## The Core Tension

**The brain needs WebSearch** for legitimate direct use:
- "What time is it in Bangkok?" → WebSearch, answer directly ✓
- "What's the weather today?" → WebSearch, answer directly ✓
- Quick factual lookups during conversation → WebSearch ✓

**The brain shouldn't use WebSearch for substantial research:**
- "Compare the top 5 headphones under $300" → should delegate
- "Research Thai restaurants in Chiang Mai" → should delegate
- "Analyze Node.js LTS release history" → should delegate

We can't remove WebSearch — the brain needs it. But the brain over-relies on it, doing 5-10 searches inline instead of delegating to a worker who would do the same searches with a structured checklist, status report, and paper trail.

**What delegation provides that inline doesn't:**
1. **Paper trail** — todo completion, status report, deliverable on disk
2. **Structured output** — validated by framework (sources, cross-check, chart)
3. **Debrief integration** — worker results appear in daily debrief
4. **Resumability** — interrupted work can be resumed
5. **Auditability** — who did what, when, with what tools

When the brain answers inline, all 5 are lost. The user gets a good answer but the system has no record, no validation, no debrief entry.

---

## What We Tried

### Attempt 1: Prompt guidance (original task-triage skill)
**Result:** Ignored. The skill said `create_task` (stale tool name), but even after fixing to `create_automation` (S7), the brain still answers inline.

### Attempt 2: Detailed delegation checklist (S4)
**Result:** Ignored. The 7-field Automation Design Checklist is in the prompt but the brain never reaches it because it never decides to delegate.

### Attempt 3: Schema enforcement on create_automation (S4)
**Result:** Works perfectly — but only if `create_automation` is called. The brain never calls it. The enforcement is on a code path that's never reached.

### Attempt 4: Framework/instance split (S7)
**Result:** Fixed the loading bug (skills now load correctly with `create_automation`). But loading correct skills didn't change behavior — the brain still answers inline.

### Attempt 5: Strengthened conversation-role instructions (S7)
**Result:** "You do not do work yourself — working agents do the work" is clear and present in the prompt. The brain ignores it because it has the tools to contradict it.

---

## Why This Is Hard

### The LLM optimization function

LLMs optimize for helpfulness in the immediate context. When the user asks "research X":
- **Delegating** means: construct a complex tool call, wait for worker, present results later. The user waits. Perceived as slow/indirect.
- **Answering inline** means: WebSearch, synthesize, present now. The user gets an answer immediately. Perceived as helpful.

The LLM's training reward favors immediate helpfulness. Delegation is an indirect action that doesn't pattern-match to "be helpful now."

### The tool availability trap

The brain has WebSearch in its tool list. When it sees a research question, the planning process considers available tools:
1. "I have WebSearch → I can answer this"
2. "I have create_automation → I could delegate this"
3. Option 1 is simpler, faster, more direct → choose option 1

The existence of WebSearch in the tool list makes delegation a suboptimal choice from the LLM's perspective.

---

## Possible Solutions (for design discussion)

### A. Tool restriction by request type

Classify the request before giving the brain tools. If the request is "research/compare/analyze," remove WebSearch from the available tools for that turn. The brain can only delegate because it can't research inline.

**Pros:** Forces delegation. Clean separation.
**Cons:** Complex to implement (request classification, dynamic tool sets). May misclassify. Breaks "check the weather then research restaurants" compound requests.

### B. Tool usage budget

Allow the brain N WebSearch calls per response (e.g., 2). If it needs more, it must delegate. The brain can do quick lookups but can't do 5-10 searches inline.

**Pros:** Simple heuristic. Allows quick lookups. Forces delegation for heavy research.
**Cons:** Arbitrary threshold. Brain might make 2 searches and give a shallow answer instead of delegating.

### C. Post-response paper trail (Option D from S6)

Accept inline answers. Add a post-response hook that automatically creates a "completed" job record when the brain does substantial inline work (detected by tool call count, response length, or Haiku classification). The debrief pipeline captures it.

**Pros:** No behavior change needed. Brain keeps doing good work. Paper trail is created automatically.
**Cons:** No todo validation, no structured output, no status report. The paper trail is a record, not a quality gate.

### D. Pre-response routing hook

Add a pre-response hook that classifies the user's message before the brain processes it. If the message is research/comparison/analysis, inject a system message: "This request requires delegation. Call create_automation." Or stronger: intercept and route directly to a worker without brain involvement.

**Pros:** Code enforcement at the routing level. Brain can't override.
**Cons:** Complex. Needs a classifier (Haiku). May over-route (simple questions get delegated unnecessarily).

### E. Stronger prompt + consequences

Change "your call" / "consider delegating" to "You MUST delegate research tasks. If you use WebSearch more than twice for a single request, you are violating your instructions." Add a post-response check that flags violations.

**Pros:** Simplest change. Might work.
**Cons:** M9.1 proved prompt compliance is 60-80%. Might improve delegation rate but won't guarantee it.

### F. Remove WebSearch, add a research tool

Replace WebSearch with a wrapper tool `quick_lookup` that is limited to 1 search and short results. For substantial research, the only available tool is `create_automation`. The brain physically cannot do multi-search research inline.

**Pros:** Clean enforcement via tool design. Brain can still do quick lookups.
**Cons:** Requires wrapping WebSearch. May be too restrictive for legitimate multi-search conversations.

---

## Impact

### What works despite the delegation gap

- Workers function correctly when jobs are created via disk manifests
- Todo system (templates, validators, gating) is fully operational
- Status reports validated
- Charts generated inline by brain
- Framework/instance split is clean
- Skill filter is crash-safe

### What doesn't work

- Conversation Nina → Worker delegation (never triggered)
- S4 schema enforcement (never reached in production)
- 3-layer todo assembly from live delegation (never tested in production)
- Debrief pipeline for conversation-initiated work (no jobs to collect)
- Paper trail for user-requested research (lost — only in conversation transcript)

---

## Recommendation

Start with **Option E** (stronger prompt + consequences) because it's zero-code and testable in one session. If it doesn't work, move to **Option B** (tool usage budget) or **Option C** (post-response paper trail) which are code changes but preserve the brain's capability.

**Option A** and **F** are the nuclear options — they restrict the brain's capabilities. Use only if softer approaches fail.

The research agent is investigating compliance patterns from the Agent SDK docs and other frameworks. Findings will be appended.

---

*Filed during M9.2-S10 final verification. All test evidence from Playwright browser sessions across S4, S6, and S10.*
