# Decisions Log — Sprint M2-S5: Naming

> **Sprint:** [plan](plan.md)
> **Started:** 2026-02-16
> **Tech Lead:** Opus (Tech Lead)

---

## Summary

| Severity | Count | Flagged for Review |
| -------- | ----- | ------------------ |
| Major    | 0     | 0                  |
| Medium   | 7     | No                 |
| Minor    | 0     | 0                  |

---

## Decisions

## Decision 1: Fix naming service auth to support both API keys and setup tokens

**Timestamp:** 2026-02-16T01:10:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
QA discovered auto-naming never triggered. Root cause: NamingService in chat-handler.ts only checked `process.env.ANTHROPIC_API_KEY`, but user may authenticate with a setup token stored in `CLAUDE_CODE_OAUTH_TOKEN`. The abbreviation queue in index.ts already handled both.

**Options Considered:**

1. **Check both env vars inline** — simple one-line fix, matches existing pattern in index.ts
2. **Use resolveAuth() + pass via Fastify decorator** — cleaner but more plumbing

**Decision:** Option 1

**Rationale:**
Matches existing pattern in index.ts (line 45-47). Minimal change, consistent with codebase.

**Risk:**
None — this is how auth is already handled elsewhere.

**Reversibility:** Easy

---

## Decision 2: Fix model ID for Haiku calls

**Timestamp:** 2026-02-16T01:30:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
naming.ts and abbreviation.ts used `claude-haiku-4` which is not a valid model ID, causing `createBrainQuery` to fail with "process exited with code 1".

**Options Considered:**

1. **Use full model ID `claude-haiku-4-5-20251001`** — known correct, matches SDK expectations
2. **Use short alias** — not supported by SDK

**Decision:** Option 1 — Changed to `claude-haiku-4-5-20251001` (full model ID) in both files.

**Rationale:**
This is the correct, fully-qualified model ID that the SDK recognizes.

**Risk:**
None — this is the correct ID.

**Reversibility:** Easy

---

## Decision 3: Fix SDK response parsing for non-streaming queries

**Timestamp:** 2026-02-16T01:45:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
With `includePartialMessages: false`, the Agent SDK returns complete `assistant` type messages (with `message.content` blocks), NOT `stream_event` type messages. Both naming.ts and abbreviation.ts were parsing `stream_event` messages, so `responseText` was always empty.

**Options Considered:**

1. **Parse `assistant` message content blocks** — matches actual SDK behavior
2. **Switch to streaming (`includePartialMessages: true`)** — unnecessary complexity

**Decision:** Option 1 — Changed both files to extract text from `assistant` message content blocks. Also added `result` type as fallback.

**Rationale:**
Matches how the SDK actually works. Verified by debug logging that showed the SDK sends `system` -> `assistant` -> `result` messages (no `stream_event`) when `includePartialMessages: false`.

**Risk:**
None — matches how the SDK actually works.

**Reversibility:** Easy

---

## Decision 4: Immediate abbreviation on conversation switch

**Timestamp:** 2026-02-16T08:00:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
CTO asked why abbreviation waits 10 minutes on idle. When switching conversations, the previous conversation should get abbreviated (and potentially renamed) immediately.

**Options Considered:**

1. **Keep 10-min idle only** — simpler, but leaves conversations unnamed until idle
2. **Enqueue abbreviation on switch** — immediate feedback, conversation gets named before user returns to it

**Decision:** Option 2 — Call `abbreviationQueue.enqueue()` in both `handleNewConversation` and `handleSwitchConversation`.

**Rationale:**
CTO preference. Provides immediate naming feedback. Idle timer still catches conversations left open without switching.

**Risk:**
Extra Haiku calls if user switches rapidly. Mitigated by AbbreviationQueue's deduplication (`pendingIds` set).

**Reversibility:** Easy

---

## Decision 5: 10-turn minimum between auto-renames

**Timestamp:** 2026-02-16T08:10:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
CTO requested a cooldown to prevent wasteful rename calls on every abbreviation cycle.

**Decision:** Track `lastRenamedAt` Map (conversationId → turnCount). Skip rename if fewer than 10 turns since last rename. `undefined` (never renamed by this path) always qualifies.

**Rationale:**
Prevents unnecessary Haiku calls while ensuring conversations get renamed as they evolve significantly.

**Risk:** None — purely an optimization.

**Reversibility:** Easy

---

## Decision 6: Human-readable titles instead of haiku format

**Timestamp:** 2026-02-16T09:00:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
CTO requested descriptive titles ("Server Monitoring Setup") instead of haiku-style names ("autumn-wind-drifts").

**Options Considered:**

1. **Keep haiku format** — original plan
2. **Switch to descriptive titles** — 2-6 words, title case, human-readable

**Decision:** Option 2 — Changed NamingService prompt and validation.

**Rationale:**
Direct CTO directive. More practical for users. Topic tags still provide search metadata in kebab-case.

**Risk:** Slightly harder to validate format (haiku was strict 3-word-hyphenated). Mitigated by relaxed but bounded validation (2-6 words, max 80 chars).

**Reversibility:** Easy — prompt-only change.

---

## Decision 7: Draggable sidebar divider

**Timestamp:** 2026-02-16T10:00:00Z
**Severity:** Medium
**Flagged:** No

**Context:**
Longer descriptive titles get truncated in the fixed-width 260px sidebar. CTO requested an expandable sidebar.

**Decision:** Added a drag handle between sidebar and chat area. Min 180px, max 500px. Alpine.js state + CSS.

**Rationale:**
Simple, no-dependency solution. Replaces the fixed sidebar transition with dynamic width.

**Risk:** None — purely additive UI feature.

**Reversibility:** Easy

---
