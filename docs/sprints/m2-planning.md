# M2 Web UI — Sprint Planning

> **Created:** 2026-02-14
> **Status:** Planning complete, ready for execution

---

## Gantt Chart

```
Sprint         Week 1              Week 2              Week 3
               ┌───┬───┬───┬───┐   ┌───┬───┬───┬───┐   ┌───┬───┬───┬───┐
               │ M │ T │ W │ T │   │ M │ T │ W │ T │   │ M │ T │ W │ T │
═══════════════╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══
S1 Server      │███████████████│   │   │   │   │   │   │   │   │   │   │ DONE
S2 Streaming   │   │   │   │   │███████████████│   │   │   │   │   │   │ DONE
───────────────┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───
S3 Hatching    │   │   │   │   │   │   │   │   │   │███████████████│   │ CURRENT
  T1 Protocol  │   │   │   │   │   │   │   │   │   │▓▓▓│   │   │   │   │
  T2 Frontend  │   │   │   │   │   │   │   │   │   │▓▓▓▓▓▓│   │   │   │
  T3 Scripted  │   │   │   │   │   │   │   │   │   │   │▓▓▓│   │   │   │
  T4 LLM Tools │   │   │   │   │   │   │   │   │   │   │▓▓▓▓▓▓│   │   │
  T5 Handler   │   │   │   │   │   │   │   │   │   │   │   │▓▓▓│   │   │
  T6 Cleanup   │   │   │   │   │   │   │   │   │   │   │   │   │▓▓▓│   │
  T7 Review    │   │   │   │   │   │   │   │   │   │   │   │   │   │▓▓▓│
═══════════════╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══╪═══
S4 Conversations                                                    Week 4-5
  T1 Storage   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │▓▓▓▓▓▓
  T2 Sessions  │   │   │   │   │   │   │   │   │   │   │   │   │   │   │  ▓▓▓▓
  T3 Protocol  │   │   │   │   │   │   │   │   │   │   │   │   │   │   │  ▓▓▓▓
  T4 Sidebar   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │    ▓▓▓
  T5 Abbrev    │   │   │   │   │   │   │   │   │   │   │   │   │   │   │  ▓▓▓
  T6 Review    │   │   │   │   │   │   │   │   │   │   │   │   │   │   │     ▓▓
───────────────┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───
S5 Naming                                                           Week 5-6
  T1 Service   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │      ▓▓
  T2 Trigger   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │       ▓▓
  T3 Frontend  │   │   │   │   │   │   │   │   │   │   │   │   │   │   │        ▓▓
  T4 Review    │   │   │   │   │   │   │   │   │   │   │   │   │   │   │         ▓
```

**Legend:** ███ = complete, ▓▓▓ = planned

---

## Risk Assessment

### M2-S3: Chat-Based Hatching — REVIEWED

| ID | Risk | Severity | Status | Mitigation |
|----|------|----------|--------|------------|
| **B1** | Tool promises hang on disconnect | High | FIXED | `cleanup()` resolves pending promises with marker |
| **B2** | No SDK query abort on socket close | High | FIXED | `interrupt()` then `cleanup()` on close |
| **B3** | Silent auth errors in Phase 1→2 | Medium | Deferred | Explicit error handling (low priority) |
| **R1** | No reconnect recovery | Medium | Deferred | `.hatching_in_progress` marker (future) |
| **R2** | Multi-tab race condition | Low | Deferred | File locking (future) |
| **R3** | Hardcoded model ignores config | Medium | Deferred | Read from config (future) |

**Status:** B1/B2 fixed 2026-02-14. Sprint ready for final testing.

---

### M2-S4: Conversation Persistence — REVIEWED

**Key Decision:** History injection replaces SDK replay. On cold start, inject recent turns + summary into system prompt. No SDK capability assumptions.

| ID | Type | Severity | Issue | Mitigation | Status |
|----|------|----------|-------|------------|--------|
| **G2** | Gap | High | No conversationId in WebSocket handshake | Add `connect` message or URL param | In plan |
| **B1** | Blocker | High | Unbounded sessions in memory | LRU eviction (max 5 sessions) | In plan |
| **B3** | Blocker | Medium | SQLite WAL mode not configured | Add pragmas in db.ts constructor | In plan |
| **R1** | Risk | High | Multi-tab abbreviation race | Track viewer count per conversation | In plan |
| **R2** | Risk | Medium | Abbreviation on stale transcript | Check turn_count before/after | In plan |
| **R3** | Risk | Medium | AbbreviationQueue no dedup | Track pending IDs in Set | In plan |
| **R4** | Risk | Medium | Idle timer fires during streaming | Touch on assistant done too | In plan |
| **R5** | Risk | Medium | No graceful shutdown for queue | drain() on SIGINT/SIGTERM | In plan |
| **R6** | Risk | Low | JSONL partial line crash | Skip malformed lines in reader | In plan |
| **R7** | Risk | Low | Context injection format | Clear delimiters for history block | In plan |

**Critical path:** Task 1 (ConversationManager + SQLite) is foundation. All mitigations documented in sprint plan.

---

### M2-S5: Naming

| ID | Risk | Severity | Likelihood | Impact | Mitigation |
|----|------|----------|------------|--------|------------|
| **R1** | Haiku rate limiting | Low | Low | Delayed naming | Queue + backoff |
| **R2** | Bad haiku output | Low | Medium | Weird titles | Validation regex, fallback |
| **R3** | Cost overrun | Low | Low | Billing surprise | ~$0.001/call, monitor |

**Lowest risk sprint.** Simple, well-scoped.

---

## Future Milestones — High Level

| Milestone | Est. Sprints | Key Risks |
|-----------|-------------|-----------|
| **M3: WhatsApp** | 2-3 | ToS compliance, Baileys stability, rate limiting |
| **M4a: Tasks** | 3-4 | Claude Code CLI changes, file-based comms reliability |
| **M4b: Memory** | 2 | First agent-built feature, SQLite FTS limits |
| **M5: Ops Dashboard** | 2-3 | Agent-built, complex UI state |
| **M6: Email** | 2 | OAuth complexity, MS Graph rate limits |

---

## M2-S3 Blockers (from Opus Review)

The Opus reviewer found that M2-S3 code already exists but has critical issues:

### B1: Tool promises hang forever if WebSocket disconnects

**Location:** `packages/dashboard/src/hatching/hatching-tools.ts`

**Problem:** `waitForControlResponse()` creates a promise that hangs indefinitely if the client disconnects.

**Fix:**
```typescript
function cleanup() {
  for (const [id, pending] of pendingResponses) {
    pending.resolve('__session_closed__');
  }
  pendingResponses.clear();
}
```

Call `hatchingSession.cleanup()` on socket close before nulling it.

### B2: No SDK query abort on socket close

**Location:** `packages/dashboard/src/ws/chat-handler.ts`

**Problem:** When WebSocket closes, `hatchingSession = null` is set, but the SDK query continues running.

**Fix:** Store the `Query` reference in the hatching session and call `query.interrupt()` on cleanup.

---

*Created: 2026-02-14*
