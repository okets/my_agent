# M9 Systemic Issues — Correction Plan

> **Date:** 2026-04-05
> **Context:** S8 completed with PASS WITH CONCERNS. Paper trail works but modify flow, notifications, and session resumption were not validated. This document catalogs systemic issues and their root causes for correction in future sprints.
> **For discussion in a fresh session.**

---

## Issue Map

Nine issues surfaced in S8. They cluster into four systemic problems.

```
SYSTEMIC PROBLEM A: Nina acts inline instead of through the system
  → Issue 1: Inline fallback (S6 iteration 2, S8 DEV3)
  → Issue 5: Private data in builder output

SYSTEMIC PROBLEM B: The agent is purely reactive
  → Issue 2: Notifications don't reach user
  → Issue 3: No proactive resume after restart
  → Issue 6: Stale running jobs survive restarts

SYSTEMIC PROBLEM C: Prompt instructions are unreliable for worker agents
  → D1: Builder prompt additions confused CAPABILITY.md output
  → D2: Three approaches to target_path failed before regex worked
  → Issue 9: Change type always "unknown" (builder ignores frontmatter)

SYSTEMIC PROBLEM D: Infrastructure gaps compound into flow failures
  → D3: findById returned empty instructions from DB
  → Issue 4: Concurrent voice messages blocked by aggressive guard
  → Issue 7: Stale once:true automation files
  → Issue 8: Scanner silently skips invalid capabilities
```

---

## Problem A: Nina Acts Inline Instead of Through the System

### What happened
When asked to add Hebrew support, Nina edited config.yaml and transcribe.sh directly in conversation instead of using the brainstorming skill's modify flow → tracked job → paper trail. This is the same behavior as S4 (generic advice) and S6 iteration 2 (inline edits).

### How we designed it
The brainstorming skill has a modify detection step: "If a capability for this type already exists, read DECISIONS.md, determine change type, spawn builder with modify spec." The notebook reference says "NEVER just explain — DO it." CLAUDE.md says "invoke the capability-brainstorming skill immediately."

### What I suspect went wrong
1. **The brainstorming skill didn't fire.** This is the same root cause as S4. Despite fixing the skill description in S5 (adding trigger phrases), it still didn't activate for modify requests. The skill is written for "new capability" requests — "add Hebrew" doesn't pattern-match to "new ability."
2. **Inline editing is the path of least resistance.** Nina has Write/Edit tools in her conversation session. Editing a config file is one tool call. Spawning an automation, waiting for a job, checking the result — that's 5+ tool calls with potential failures. The agent optimizes for task completion, not process compliance.
3. **No enforcement mechanism.** The brainstorming skill instruction is a suggestion, not a gate. There's no hook that says "if you're about to edit a file in `.my_agent/capabilities/`, use the modify flow instead."

### Systemic root cause
**The system relies on prompt compliance for process-critical flows.** S8 D1/D2/D3 all proved that prompt instructions are ~60-80% reliable for worker agents. The same applies to Conversation Nina. Any flow that MUST happen (paper trail, tracked job, modify detection) needs code enforcement, not prompt enforcement.

### What a systemic fix looks like
- **PreToolUse hook on Edit/Write** targeting `.my_agent/capabilities/`: block direct edits, return a system message "Use the capability-brainstorming skill to modify capabilities. Direct edits bypass the paper trail."
- **OR:** a PostToolUse hook that detects capability folder modifications and retroactively creates a paper trail entry (lighter touch, doesn't block the edit but ensures traceability).
- The brainstorming skill's modify detection needs to match modify-style requests ("add Hebrew", "change the voice", "switch provider"), not just "new capability" requests.

### Private data sub-issue (Issue 5)
The builder absorbed personal context from conversation history ("Hanan's language environment") into DECISIONS.md. This is a guardrails problem — the builder prompt should include "Never include personal names or private details in capability files." But since prompt compliance is unreliable (Problem C), a PostToolUse hook checking `.guardrails` patterns on capability folder writes would be more reliable.

---

## Problem B: The Agent is Purely Reactive

### What happened
- **Notifications (Issue 2):** `handleNotification` fires, `ci.alert()` executes, but nothing reaches the conversation. User must ask "what's the status?"
- **Restart resume (Issue 3):** Dashboard restart kills context. Nina doesn't reach out to continue interrupted work. Mid-task work is silently abandoned.
- **Stale jobs (Issue 6):** JSONL records with `status: running` persist from crashed sessions. Nina thinks jobs are active when they're not.

### How we designed it
S3.1 built a heartbeat system with watchdogs for conversation and working agent errors. The conversation watchdog detects garbled responses, tool-heavy silence, and missing deliverables. The working agent watchdog detects empty deliverables, failed jobs, and stale jobs. But both are reactive — they fire when the user sends a message and the brain processes it.

### What I suspect went wrong
1. **Notifications depend on conversation state.** `ci.alert()` tries to inject into the current conversation. But if the conversation is streaming (the user just sent a message), the alert can't inject (streaming guard). If the conversation is idle, there may be no active WebSocket turn to inject into.
2. **No independent process monitors state.** The heartbeat (S3.1) runs on user message triggers, not on a timer. Job completion happens asynchronously. If the user doesn't send a message after a job completes, the notification is never delivered.
3. **Stale job cleanup assumes continuous operation.** If the dashboard crashes and restarts, nobody marks the running jobs as failed. The stale job detector (S3.1) would catch this — but only when the next user message triggers it.

### Systemic root cause
**Nina has no autonomous loop.** She responds to messages. She doesn't independently monitor, act on events, or reach out. The heartbeat system (S3.1) added detection but not autonomous action. A true watchdog needs to run on a timer, independent of user messages.

### What a systemic fix looks like
- **An independent process** (setInterval or systemd timer) that runs every N seconds and:
  - Checks for completed jobs → delivers notifications
  - Checks for stale `running` jobs → marks them failed
  - Checks for degraded capabilities → alerts the user
  - After restart: checks for interrupted work → initiates conversation to resume
- This is architecturally different from the current "brain processes everything on user message" model. It's a monitoring daemon inside the dashboard process.

---

## Problem C: Prompt Instructions Are Unreliable for Worker Agents

### What happened
- **D1:** Adding deliverable frontmatter instructions to the builder prompt caused it to omit `name` and `interface` from CAPABILITY.md. Two YAML examples confused the model.
- **D2:** Three approaches to make the brainstorming skill pass `target_path` all failed. Regex extraction from instructions text was the only reliable method.
- **Issue 9:** Builder never writes `change_type` frontmatter. Paper trail entry always says "unknown."
- **S6 had 5 similar cases:** wrong provider, inline fallback, .env instructions, off-script questions, template precedence violations.

### How we designed it
The paper trail v1 design relied on the builder writing structured frontmatter in its deliverable. The brainstorming skill was supposed to pass `target_path` in the automation manifest. Both depended on the agent following prompt instructions.

### What I suspect went wrong
1. **Competing instructions.** The builder prompt is already ~100 lines. Adding 43 more lines with a second YAML format example created ambiguity. The model "averaged" the two examples and produced CAPABILITY.md without required fields.
2. **Long prompt = lower compliance.** As the prompt grows, each individual instruction gets less attention weight. Critical instructions (like "always include `name` in frontmatter") get diluted.
3. **No feedback loop.** When the builder writes bad CAPABILITY.md, the scanner silently skips it (Issue 8). The builder never learns it failed. If the scanner returned an error, the builder could retry.

### Systemic root cause
**The M9 design spec's Principle 7 ("scripts are the universal adapter") was validated. Principle 2 ("the agent builds its own skills") was proven unreliable for process compliance.** The agent is a great coder (scripts work!) but a poor bureaucrat (metadata, frontmatter, structured deliverables are inconsistently produced).

The paper-trail-v2 design already recognized this: move critical data out of prompts and into code (regex extraction, schema fields). This principle needs to be applied universally.

### What a systemic fix looks like
- **Code guarantees over prompt instructions** for anything process-critical. If data MUST exist, the framework must produce it or extract it — not request it from the agent.
- **Validation with feedback.** When the scanner skips a capability, log a warning AND pass it back to the brain: "Capability at X was skipped because name field is missing." The brain (or builder) can then fix it.
- **Shorter, focused prompts.** The builder prompt should be about building scripts. Process requirements (frontmatter, paper trail, metadata) should be handled by the framework, not the builder.

---

## Problem D: Infrastructure Gaps Compound Into Flow Failures

### What happened
- **D3:** `findById()` returned empty instructions from DB, causing the paper trail regex to find nothing. Root cause: instructions are stored on disk (markdown), not in SQLite, but `findById` was reading from SQLite.
- **Issue 4:** Concurrent voice messages blocked by an aggressive "already processing" guard.
- **Issue 7:** Stale `once:true` automation files remain on disk, confusing Nina when checking for existing automations.
- **Issue 8:** Scanner silently skips invalid capabilities — no error feedback.

### How we designed it
These are individually small bugs/oversights. But they compound: the paper trail didn't fire for 3 attempts because of D3 + D2 combined. The modify flow couldn't be tested because Issue 1 + Issue 2 combined. Each issue is minor; together they blocked the entire sprint goal.

### Systemic root cause
**No integration test coverage for multi-step agentic flows.** Each component works in isolation (scanner scans, executor executes, paper trail writes). But the chain (brain → brainstorming skill → create_automation → executor → builder → paper trail → notification → modify flow) has never been tested end-to-end with automation. The sprint IS the integration test — and it found 9 issues.

### What a systemic fix looks like
- **End-to-end test for the capability lifecycle:** create → verify paper trail → modify → verify paper trail updated → delete → verify cleanup. This runs against the headless App with mock sessions, not against the live brain.
- **Loud failures.** Scanner should log errors, not silently skip. `findById` should throw if instructions are missing. Stale automations should be cleaned up on startup. Every silent failure in S8 should become a loud failure.
- **Concurrency review.** The "already processing" guard (Issue 4) and notification delivery (Issue 2) both involve timing assumptions. A systematic review of concurrent access patterns in the chat service would catch these before the next sprint reveals them.

---

## Summary: Four Problems, Four Correction Strategies

| Problem | Root Cause | Strategy |
|---------|-----------|----------|
| **A: Inline fallback** | Process compliance relies on prompts | Code enforcement (hooks that block or track capability edits) |
| **B: Purely reactive** | No autonomous monitoring loop | Independent watchdog process (timer-based, not message-triggered) |
| **C: Unreliable prompt compliance** | Worker agents ignore metadata/process instructions | Move process-critical data to code; keep prompts focused on the actual task |
| **D: Compounding infrastructure gaps** | No integration test for multi-step flows | E2E lifecycle test + loud failures + concurrency review |

---

## Recommended Correction Order

1. **Problem C first** — it's already partially solved (paper-trail-v2, regex extraction). Generalize the principle: if it must happen, code it.
2. **Problem D next** — quick wins: loud failures, stale cleanup, findById fix (already done). E2E test prevents regression.
3. **Problem A** — hooks for capability folder protection. Depends on C being resolved (the hook system IS code enforcement).
4. **Problem B last** — largest architectural change (autonomous monitoring). But also the highest long-term value — enables notifications, restart resume, degraded capability alerts, and proactive behavior.

---

*This document is input for the next planning session. Each problem should be scoped as a sprint or group of tasks, not solved piecemeal.*
