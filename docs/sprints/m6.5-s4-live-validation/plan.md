# M6.5-S4: Live Validation — Sprint Plan

> **Milestone:** M6.5 Agent SDK Alignment
> **Sprint:** S4 — Live Validation (remaining tests from S3)
> **Status:** Planned
> **Depends on:** M6.5-S3 complete (Run 2 passed)

---

## Goal

Execute the tests that S3 Run 2 skipped or code-verified-only. These require real wait times, actual WhatsApp delivery, and sustained long conversations to trigger compaction. All are live end-to-end tests — no code-verification shortcuts.

## Pre-Requisites

- Dashboard running on `localhost:4321` (build c2405ce or later)
- WhatsApp connected (for 5.6, 8.6)
- Ollama running at configured host (for embeddings)
- Reset test data: `npx tsx packages/dashboard/tests/reset-test-data.ts`

---

## Tests

### Group A: Scheduled & Recurring Tasks (~15 min)

These require real timer waits. Run sequentially.

| # | Test | Expected | Wait |
|---|------|----------|------|
| 5.6 | "In 3 minutes, check weather and message me on WhatsApp" | Scheduled multi-step with WhatsApp delivery | 3.5 min |
| 5.7 | "In 2 minutes, check if I have tasks due today and summarize" | Self-referential scheduled task | 2.5 min |
| 5.11 | Create two recurring tasks scheduled 1 minute apart. Let both execute. | Both complete independently, no cross-contamination. | 3 min |
| 5.12 | After a task completes, manually set its `sdk_session_id` to `'fake_expired_session'` in SQLite, re-trigger. | Server logs show "SDK session resume failed", task falls back to fresh session, completes successfully. | 2 min |

### Group B: Compaction (~20 min)

Requires sustained conversation to approach the 200K context limit.

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 7.1 | Send 20+ substantive messages in a single conversation | No token overflow, responses stay contextual | Use long prompts (paste paragraphs, ask for analysis) to fill context faster |
| 7.2 | Check server logs for compaction indicators | SDK compaction events visible (`compact-2026-01-12` beta) | grep logs after 7.1 |
| 7.3 | After compaction, ask about early conversation topic | Brain still remembers (compacted, not lost) | Only meaningful if compaction triggered |

**Note:** If 20 messages don't trigger compaction, try sending very long messages (paste code blocks, request detailed analysis). Compaction triggers near the 200K token context limit.

### Group C: WhatsApp Integration

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 8.6 | Send a WhatsApp message to the agent | Message creates/routes to a conversation with SDK session | Requires phone |
| 8.7 | `/new` — Establish baseline active conversation | Send normal WhatsApp message → pinned conversation exists | Prerequisite for 8.8 |
| 8.8 | `/new` — Reset active conversation | Send `/new` via WhatsApp → old conv unpinned, new conv pinned, user gets confirmation | Verifies `/new` handler |
| 8.9 | `/new` — Subsequent message routes correctly | Send follow-up after `/new` → message lands in new conv, old conv untouched | Verifies routing post-reset |

### Group D: Pre-S2 Conversation Live Test

| # | Test | Expected | Notes |
|---|------|----------|-------|
| 2.6-live | Open a pre-S2 conversation (one with `sdk_session_id = NULL` in DB). Send a message. | Falls back to fresh session with context injection. New `sdk_session_id` persisted after response. | Check DB before and after |

---

## Execution Protocol

1. **Reset** test data before starting
2. **Restart** dashboard: `pkill -f "tsx.*dashboard" && cd packages/dashboard && npm run dev`
3. Run Group A first (sequential, timer-dependent)
4. Run Group B (long conversation)
5. Run Group C (WhatsApp — needs phone)
6. Run Group D (DB inspection + chat)
7. Update `test-report.md` with S4 results
8. Update `review.md` with final coverage assessment

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Tech Lead | Opus | Coordinate, run tests |
| Tester | Sonnet | Parallel agent for DB inspection during timer waits |

## Sprint Mode

**Normal sprint** — CTO available for WhatsApp testing (needs phone).

---

## Success Criteria

All 11 tests pass live. No code-verification shortcuts. After this sprint, M6.5 validation coverage is 100%.
