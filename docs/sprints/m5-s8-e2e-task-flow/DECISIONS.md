# Decisions Log — Sprint M5-S8: E2E Task Flow

> **Sprint:** [plan](plan.md)
> **Started:** 2026-02-20
> **Tech Lead:** Opus

---

## Summary

| Severity | Count | Flagged for Review |
|----------|-------|-------------------|
| Major | 1 | 1 |
| Medium | 1 | 0 |
| Minor | 2 | 0 |

---

## Decisions

## Decision: Skill content loading approach

**Timestamp:** 2026-02-20T22:30:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
Plan specified fixing skill loading so `task-api.md` is recognized. However, just adding it to the "Available Commands" list (one-liner) isn't enough — the brain needs the full API documentation to know HOW to call the task API.

**Options Considered:**
1. **Option A — Command list only** — Add task-api.md to Available Commands
   - Pros: Simpler, matches existing pattern
   - Cons: Brain doesn't get API documentation, can't actually create tasks

2. **Option B — Full content loading** — Load task-api.md full content into system prompt
   - Pros: Brain has complete API documentation
   - Cons: Adds ~2k chars to system prompt

**Decision:** Option B

**Rationale:**
The purpose of task-api.md is to teach the brain how to use the REST API. A one-liner command reference doesn't provide the endpoint documentation, example requests, or usage guidelines. The brain MUST have this information to successfully create tasks.

**Risk:**
Slightly larger system prompt. Mitigated by keeping skill content files to a minimum (only task-api.md for now).

**Reversibility:** Easy

---

## Decision: Deterministic task extraction instead of brain curl

**Timestamp:** 2026-02-21T01:00:00Z
**Severity:** Major
**Flagged:** Yes — architectural change from S8 plan

**Context:**
S8 plan assumed the brain would create tasks by calling `POST /api/tasks` via curl tool use. In practice, the brain says "I'll create a task" but doesn't reliably execute the curl. This is inherent to LLM behavior — the model describes intent but doesn't deterministically act on it.

**Options Considered:**
1. **Brain creates tasks via curl** (planned approach) — unreliable, LLM decides whether to actually call the API
2. **Deterministic extraction** — after brain responds, a fast Haiku call extracts structured task data from the user's message

**Decision:** Option 2 — Deterministic extraction via `task-extractor.ts`

**Rationale:**
Delivery actions (send WhatsApp, send email) must happen reliably. LLM tool-use is non-deterministic. By extracting tasks from the user's message using a focused Haiku call, task creation becomes reliable. The brain still handles research/reasoning; the extractor handles task detection.

**Risk:**
Haiku may occasionally not return JSON (mitigated with retry logic — max 2 attempts).

**Reversibility:** Medium — would require removing extractor and reverting to brain curl, which has known reliability issues.

---

## Decision: Separate ownerJid from ownerIdentities

**Timestamp:** 2026-02-21T07:15:00Z
**Severity:** Minor
**Flagged:** No

**Context:**
WhatsApp delivery failed silently. `ownerIdentities` stores normalized digits (stripped of `@lid` suffix) for identity matching. StepExecutor reconstructed the JID by appending `@s.whatsapp.net`, but the actual JID was `@lid` format. Messages went to a nonexistent number.

**Decision:** Added `ownerJid` field to `ChannelInstanceConfig` — stores the full original JID for outbound messaging. `ownerIdentities` remains for identity matching only.

**Reversibility:** Easy

---

## Decision: Retry logic for TaskExtractor

**Timestamp:** 2026-02-21T03:00:00Z
**Severity:** Minor
**Flagged:** No

**Context:**
Haiku occasionally returns conversational text instead of JSON despite a JSON-only system prompt. This caused task extraction to silently fail.

**Decision:** Added max 2 attempts with strengthened system prompt ("JSON-only API" framing). If first attempt returns no JSON, retry once.

**Reversibility:** Easy

---
