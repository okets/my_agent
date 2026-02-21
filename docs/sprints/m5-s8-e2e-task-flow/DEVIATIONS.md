# Deviations Log — Sprint M5-S8: E2E Task Flow

> **Sprint:** [plan](plan.md)
> **Started:** 2026-02-20

---

## Summary

| Type | Count | Recommendation |
|------|-------|----------------|
| Additions | 3 | Keep |
| Removals | 0 | — |
| Changes | 2 | Keep |
| Dependencies | 1 | Keep |

**Overall Assessment:** Architecture improved — brain curl replaced with deterministic extraction

---

## Deviations

## Deviation: Added @types/ws dependency

**Type:** Dependency

**Planned:**
Plan did not explicitly mention TypeScript type dependencies for test files.

**Actual:**
Added `@types/ws` as dev dependency to packages/dashboard for E2E test WebSocket client.

**Reason:**
Test files use the `ws` package for WebSocket client in Node.js. TypeScript requires type definitions for proper compilation.

**Impact:**
- Affects other sprints: No
- Affects architecture: No
- Affects timeline: No

**Recommendation:** Keep

---

## Deviation: Full skill content loading

**Type:** Addition

**Planned:**
Plan said to fix skill loading so `task-api.md` appears in Available Commands list.

**Actual:**
Also added `loadSkillContent()` to load full content of specified skills into system prompt.

**Reason:**
Just adding to Available Commands list (one-liner) doesn't give the brain the API documentation it needs. Brain needs full content to know HOW to create tasks.

**Impact:**
- Affects other sprints: No (contained to prompt assembly)
- Affects architecture: No (extends existing pattern)
- Affects timeline: No

**Recommendation:** Keep (necessary for brain to function)

---

## Deviation: Deterministic task extraction (replaces brain curl)

**Type:** Change

**Planned:**
Brain creates tasks by calling `POST /api/tasks` via curl tool use.

**Actual:**
Added `task-extractor.ts` — after brain responds, a fast Haiku call analyzes the user's message and deterministically extracts task data (title, instructions, steps, type, scheduledFor). Task is created server-side without relying on brain tool use.

**Reason:**
Brain says "I'll create a task" but doesn't reliably execute curl. LLM tool-use is non-deterministic for delivery actions. See DECISIONS.md for full analysis.

**Impact:**
- Affects other sprints: No
- Affects architecture: Yes — task creation is now server-side, not brain-initiated
- Affects timeline: No

**Recommendation:** Keep (resolves core reliability issue)

---

## Deviation: Deterministic step execution via StepExecutor

**Type:** Addition

**Planned:**
Plan did not include deterministic delivery step execution.

**Actual:**
Added `step-executor.ts` — after brain completes research, StepExecutor parses task steps and executes delivery actions (WhatsApp, email) deterministically. Brain handles research; StepExecutor handles delivery.

**Reason:**
Same reliability issue as task creation — brain can't be trusted to reliably execute `curl` for WhatsApp delivery. StepExecutor uses the ChannelManager API directly.

**Impact:**
- Affects other sprints: No
- Affects architecture: Yes — delivery is split from research
- Affects timeline: No

**Recommendation:** Keep

---

## Deviation: Added ownerJid to ChannelInstanceConfig

**Type:** Change

**Planned:**
StepExecutor would use `ownerIdentities[0]` with `@s.whatsapp.net` suffix for outbound WhatsApp.

**Actual:**
Added `ownerJid` field that stores the full original JID from token authorization. `ownerIdentities` remains for identity matching only.

**Reason:**
Owner's WhatsApp JID was `@lid` format (Linked Device ID), not `@s.whatsapp.net`. The normalization in `handleTokenAuthorization` stripped the suffix, and StepExecutor reconstructed it incorrectly. Messages went to a nonexistent number.

**Impact:**
- Affects other sprints: No
- Affects architecture: Minor — clean separation of identity matching vs outbound messaging
- Affects timeline: No (discovered and fixed during E2E testing)

**Recommendation:** Keep

---

## Deviation: Ralph loop E2E tests with WhatsApp delivery

**Type:** Addition

**Planned:**
Plan specified E2E tests for immediate and scheduled tasks with result delivery to conversation.

**Actual:**
Tests also verify WhatsApp delivery (step marked complete, message actually sent) and use a ralph loop runner that requires 3 consecutive passes before exit.

**Reason:**
WhatsApp delivery is a critical part of the task flow. Testing only conversation delivery would miss the most important user-facing output.

**Impact:**
- Affects other sprints: No
- Affects architecture: No
- Affects timeline: No

**Recommendation:** Keep

---
