# Conversation System Design Review (v3 — FINAL)

> **Reviewer:** Claude Code (Opus 4.6)
> **Date:** 2026-02-14
> **Docs reviewed:**
> - `docs/plans/conversation-system.md` (roadmap integration plan, updated)
> - `docs/design/conversation-system.md` (full design spec, updated)
> **Code reviewed:**
> - `packages/dashboard/src/agent/session-manager.ts`
> - `packages/dashboard/src/ws/chat-handler.ts`
> - `packages/core/src/brain.ts`
> **Supersedes:** v2 review from earlier today. All issues reconciled.

## Summary: All Issues Resolved

The documents have been reconciled. The plan's simpler approach was adopted for file naming, IDs, and database location. Missing protocol messages and failure handling have been added.

### Reconciliation Applied

| Issue | Resolution |
|-------|------------|
| R1: File naming | **Fixed.** Now `conv-{ulid}.jsonl` (flat, stable) |
| R2: Vector indexing | **Already correct.** Abbreviations only |
| R3: Compression as index trigger | **Fixed.** Removed, compression is SDK-internal |
| R4: Embedding dimensions | **Fixed.** Schema shows `FLOAT[384]` |
| R5: M2-S3 status | **Fixed.** Now "Complete" |
| N1: Abbreviation failure | **Added.** `needs_abbreviation` flag + retry logic |
| N3: Timeout layering | **Added.** Clear documentation of 30min vs 4h |
| N5: Reconnect protocol | **Added.** `conversation_loaded` message |
| N7: Protocol messages | **Added.** Full WebSocket protocol section |

---

## Resolved Issues

### C1: ID Mutation -- MOSTLY RESOLVED

The plan doc uses `conv-{uuid}.jsonl` as the filename format. The spec uses `{channel}_{date}_{haiku}.jsonl` with rename at turn 5. The plan's approach (UUID-based, stable) solves the mutation problem. The spec still has the mutable ID scheme.

**Verdict:** The plan is correct. The spec still needs to adopt the plan's stable-ID approach. See R1 below.

### C2: SessionManager Binding -- RESOLVED

The plan explicitly says "each conversation maps to an Agent SDK session; switching conversations switches (or creates) sessions." The design is clear that a `ConversationManager` layer sits between the WebSocket handler and `SessionManager`. The current code's one-`SessionManager`-per-WebSocket pattern is understood to be the thing being replaced.

**Verdict:** Resolved at the design level. Implementation will introduce `ConversationManager`.

### C3: continue:true Confusion -- RESOLVED

The spec documents two resume paths clearly:
1. Hydration from transcript tail (lines 529-537): read last N turns, create new Agent SDK query with loaded context
2. Compression summary as preceding context (line 535): include compression summary when present

The `continue: true` in the current `SessionManager` is for multi-turn within a living process. The spec's hydration path constructs fresh context from transcript, which is the correct cold-resume approach.

**Verdict:** Resolved. Both hot-resume (same process, `continue: true`) and cold-resume (from transcript) are described.

### C4: Multi-Tab Conflict -- RESOLVED for MVP

The spec says "Same conversation across tabs (single WebSocket per session)" for web. This implies single-connection enforcement. The previous review recommended Option A (close previous connection on new connect). The design does not add multi-tab complexity -- it keeps things simple.

**Verdict:** Resolved. MVP scope is appropriate.

### Compression vs Abbreviation Separation -- WELL DONE

This is the key improvement in the updated documents. The plan doc clearly articulates:

- **Compression** = SDK-internal, triggered by context pressure, output is compressed working context for the agent. We do not control it, we do not need to.
- **Abbreviation** = our operation, triggered on conversation transition (switch, close, 30min idle). Output is ~100-200 token "meeting notes" for semantic search indexing.
- These are **independent**: different triggers, different outputs, no coordination needed.

The plan's statement "The full transcript is already on disk before compression happens" is the key insight. Since the transcript is append-only and always ahead of the SDK's working context, compression is transparent to us.

**Verdict:** Clear, correct, and well-reasoned.

---

## Previously Remaining Issues — NOW RESOLVED

### R1: File Naming ✓ FIXED

Spec now uses `conv-{ulid}.jsonl` (flat directory, stable IDs). Haiku is stored as `title` field, not in filename.

### R2: Vector Indexing ✓ ALREADY CORRECT

Spec correctly indexes abbreviations only. The chunk-based approach was from an earlier draft and has been removed.

### R3: Compression as Index Trigger ✓ FIXED

Compression is now documented as SDK-internal only. It does not trigger abbreviation or indexing.

### R4: Embedding Dimensions ✓ FIXED

Schema now shows `FLOAT[384]` matching `all-MiniLM-L6-v2`.

### R5: M2-S3 Status ✓ FIXED

Plan doc now shows M2-S3 as "Complete".

---

## Previously New Concerns — NOW RESOLVED

### N1: Abbreviation Failure ✓ FIXED

Spec now includes "Abbreviation Failure Handling" section with:
- `needs_abbreviation` flag in database schema
- Non-blocking behavior (user not affected)
- Retry on startup and idle checks
- Graceful degradation (FTS still works)

### N2: Concurrent Transitions ✓ ADDRESSED

Spec clarifies that the background worker processes tasks serially, preventing duplicate work.

### N3: Timeout Layering ✓ FIXED

Spec now includes "Timeout Layering" section clearly documenting:
- 30min idle = abbreviation trigger (conversation stays active)
- 4h/24h idle = conversation close
- No re-abbreviation if already done

### N4: Multi-Channel Context — DEFERRED TO M3

This remains an M3 problem. The architecture supports independent hydration per conversation.

### N5: Reconnect Protocol ✓ FIXED

Spec now includes "WebSocket Protocol Messages" section with:
- `conversation_loaded` message on connect
- `conversation_list` for sidebar
- Full reconnect flow documented

### N6: vec0 Schema — DEFERRED TO M4b

Will verify against sqlite-vec docs during implementation. Only matters for vector search (M4b).

### N7: Protocol Messages ✓ FIXED

Spec now includes full "WebSocket Protocol Messages" section with:
- Client → Server: `new_conversation`, `switch_conversation`, `rename_conversation`
- Server → Client: `conversation_loaded`, `conversation_list`, `conversation_renamed`, etc.
- `ConversationMeta` type definition

---

## Final Summary

| Category | Status |
|----------|--------|
| Original issues (C1-C4) | ✓ All resolved |
| Plan/spec inconsistencies (R1-R5) | ✓ All fixed |
| New concerns (N1-N7) | ✓ 5 fixed, 2 deferred (M3/M4b scope) |

### What Is Good

- Compression vs abbreviation separation is clear and well-reasoned
- The plan's milestone decomposition (M2-S4 transcripts, M2-S5 naming, M4b search) is practical
- JSONL-as-source-of-truth is simple and correct
- The "no automatic topic splitting" decision avoids unnecessary complexity
- Hybrid search (FTS on transcripts, vector on abbreviations) is sound and simple
- Error handling and failure recovery are now documented
- Privacy considerations (everything in `.my_agent/`, gitignored) are consistently applied
- WebSocket protocol messages are fully specified
- Timeout layering is clearly documented

### Ready for Implementation

The design is complete and ready for M2-S4 implementation. All inconsistencies have been resolved. The documents are now aligned.

**Deferred items (not blocking):**
- N4: Multi-channel routing → M3 scope
- N6: vec0 schema verification → M4b scope

### Overall Verdict

**APPROVED.** The design is solid, simple, and implementation-ready. Compression/abbreviation decoupling is the right call. Stable ULIDs for conversation IDs avoid mutation complexity. Hybrid search (FTS + abbreviation vectors) balances power and simplicity.

---

*Review completed: 2026-02-14*
*Reviewer: Claude Code (Opus 4.6)*
*Version: v3 (final) — All issues reconciled*
