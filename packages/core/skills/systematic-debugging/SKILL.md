---
name: systematic-debugging
description: Methodical 4-phase debugging — root cause investigation, pattern analysis, hypothesis testing, implementation. Use for any bug, test failure, or unexpected behavior before proposing fixes.
origin: curated
allowed-tools: [Read, Grep, Glob, Write, Edit, Bash]
---

# Systematic Debugging

## Overview

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue: test failures, bugs, unexpected behavior, performance problems, build failures, integration issues.

**Use this ESPECIALLY when:**

- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work

**Don't skip when:**

- Issue seems simple (simple bugs have root causes too)
- You're in a hurry (systematic is faster than thrashing)

## The Four Phases

Complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Reproduce Consistently**
   - Can you trigger it reliably?
   - What are the exact steps?
   - If not reproducible, gather more data — don't guess

3. **Check Recent Changes**
   - What changed that could cause this?
   - Git diff, recent commits
   - New dependencies, config changes

4. **Gather Evidence in Multi-Component Systems**

   WHEN system has multiple components (CI -> build -> signing, API -> service -> database):

   BEFORE proposing fixes, add diagnostic instrumentation:
   - For EACH component boundary: log what data enters, log what exits
   - Verify environment/config propagation
   - Run once to gather evidence showing WHERE it breaks
   - THEN analyze evidence to identify failing component
   - THEN investigate that specific component

5. **Trace Data Flow (Root Cause Tracing)**

   When error is deep in the call stack, trace backward:
   - **Observe the symptom** — what error appears?
   - **Find immediate cause** — what code directly causes this?
   - **Ask: what called this?** — trace up through the call chain
   - **Keep tracing up** — what value was passed? Where did it come from?
   - **Find original trigger** — fix at the source, not the symptom

   When you can't trace manually, add stack trace instrumentation:

   ```typescript
   const stack = new Error().stack
   console.error('DEBUG:', { value, cwd: process.cwd(), stack })
   ```

   **NEVER fix just where the error appears.** Trace back to the original trigger.

### Phase 2: Pattern Analysis

1. **Find Working Examples** — locate similar working code in same codebase
2. **Compare Against References** — read reference implementations COMPLETELY, don't skim
3. **Identify Differences** — list every difference, however small
4. **Understand Dependencies** — what components, settings, environment does this need?

### Phase 3: Hypothesis and Testing

1. **Form Single Hypothesis** — "I think X is the root cause because Y"
2. **Test Minimally** — smallest possible change, one variable at a time
3. **Verify Before Continuing** — worked? Phase 4. Didn't work? New hypothesis. DON'T add more fixes on top.

### Phase 4: Implementation

1. **Create Failing Test Case** — simplest reproduction, automated if possible
2. **Implement Single Fix** — address root cause, ONE change at a time, no "while I'm here" improvements
3. **Verify Fix** — test passes? No other tests broken? Issue resolved?
4. **If Fix Doesn't Work:**
   - Count: how many fixes have you tried?
   - If < 3: return to Phase 1 with new information
   - If >= 3: STOP and question the architecture (see below)

5. **If 3+ Fixes Failed: Question Architecture**

   Pattern indicating architectural problem: each fix reveals new coupling, requires massive refactoring, or creates new symptoms elsewhere.

   STOP and question fundamentals:
   - Is this pattern fundamentally sound?
   - Should we refactor architecture vs continue fixing symptoms?
   - Discuss with the user before attempting more fixes

   This is NOT a failed hypothesis — this is a wrong architecture.

## Defense-in-Depth

After fixing a root cause, add validation at EVERY layer data passes through:

| Layer                 | Purpose                                    | Example                                         |
| --------------------- | ------------------------------------------ | ----------------------------------------------- |
| Entry point           | Reject invalid input at API boundary       | Validate params exist, correct type             |
| Business logic        | Ensure data makes sense for operation      | Operation-specific checks                       |
| Environment guards    | Prevent dangerous ops in specific contexts | Refuse destructive ops outside tmpdir in tests  |
| Debug instrumentation | Capture context for forensics              | Stack trace logging before dangerous operations |

All four layers are often necessary — different code paths bypass different layers.

## Condition-Based Waiting (for flaky tests)

When debugging flaky tests with arbitrary delays:

```typescript
// BAD: guessing at timing
await new Promise((r) => setTimeout(r, 50))

// GOOD: waiting for actual condition
await waitFor(() => getResult() !== undefined)
```

Wait for the actual condition you care about, not a guess about how long it takes.

## Red Flags — STOP and Follow Process

If you catch yourself thinking:

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "One more fix attempt" (when already tried 2+)
- Proposing solutions before tracing data flow

**ALL of these mean: STOP. Return to Phase 1.**

## Common Rationalizations

| Excuse                                     | Reality                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| "Issue is simple, don't need process"      | Simple issues have root causes too. Process is fast for simple bugs.    |
| "Emergency, no time for process"           | Systematic debugging is FASTER than guess-and-check thrashing.          |
| "Just try this first, then investigate"    | First fix sets the pattern. Do it right from the start.                 |
| "Multiple fixes at once saves time"        | Can't isolate what worked. Causes new bugs.                             |
| "I see the problem, let me fix it"         | Seeing symptoms != understanding root cause.                            |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question pattern, don't fix again. |

## Quick Reference

| Phase                 | Key Activities                                                          | Success Criteria            |
| --------------------- | ----------------------------------------------------------------------- | --------------------------- |
| **1. Root Cause**     | Read errors, reproduce, check changes, gather evidence, trace data flow | Understand WHAT and WHY     |
| **2. Pattern**        | Find working examples, compare                                          | Identify differences        |
| **3. Hypothesis**     | Form theory, test minimally                                             | Confirmed or new hypothesis |
| **4. Implementation** | Create test, fix, verify, defense-in-depth                              | Bug resolved, tests pass    |
