# Decisions Log — Sprint M2-S5: Naming

> **Sprint:** [plan](plan.md)
> **Started:** 2026-02-16
> **Tech Lead:** Opus (Tech Lead)

---

## Summary

| Severity | Count | Flagged for Review |
|----------|-------|-------------------|
| Major | 0 | 0 |
| Medium | 3 | No |
| Minor | 0 | 0 |

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
