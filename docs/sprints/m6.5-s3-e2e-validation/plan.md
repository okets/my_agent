# M6.5-S3: E2E Validation — Sprint Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. MUST invoke claude-developer-platform skill before any Agent SDK work.

> **Milestone:** M6.5 Agent SDK Alignment
> **Sprint:** S3 — E2E Validation
> **Status:** Planned
> **Depends on:** M6.5-S1 + M6.5-S2 complete
> **Existing tests:** `docs/testing/task-e2e-testing.md` (60 manual tests across 10 phases)

---

## Goal

Validate the full SDK alignment retrofit end-to-end. Consolidate existing E2E test plans (task system + memory system), add SDK-specific test scenarios (MCP tools, session resumption, hooks, subagents), and run tests ordered easiest-to-hardest, fixing issues as they surface.

## Architecture

E2E tests verify the full stack:
```
User action (dashboard/WhatsApp) → WebSocket/REST → Session/Task system → Brain query (SDK features) → Response
```

Tests are organized in phases of increasing complexity. Each phase builds on the previous. Fix-as-you-go: when a test fails, fix the root cause before proceeding.

## Tech Stack

- Dashboard running on `localhost:4321`
- SQLite database (`.my_agent/agent.db`)
- Debug API endpoints for observation
- Manual testing via mobile/desktop browser
- Reset script: `npx tsx packages/dashboard/tests/reset-test-data.ts`

---

## Scope

**In Scope:**
- Consolidate existing 60 manual tests from `docs/testing/task-e2e-testing.md`
- Add S1-specific tests (MCP memory tools, hooks audit trail, subagent definitions)
- Add S2-specific tests (session resumption, compaction, sessionId persistence)
- Regression tests for chat, tasks, memory, calendar
- Fix issues discovered during testing

**Out of Scope:**
- Automated E2E test framework (future work)
- Performance benchmarks
- Load testing

---

## Test Phases

Tests are ordered easiest → hardest. Fix issues before moving to next phase.

### Phase 1: Smoke Tests (Basic Functionality)

Verify nothing is broken after S1+S2 changes.

| # | Test | Expected | Status |
|---|------|----------|--------|
| 1.1 | Open dashboard in browser | Page loads, chat visible | |
| 1.2 | Send "Hello" in chat | Response streams back | |
| 1.3 | Send a follow-up message | Response acknowledges context from first message | |
| 1.4 | Refresh page, reopen same conversation | Conversation history visible from transcript | |
| 1.5 | Create a new conversation | Fresh conversation starts | |

### Phase 2: Session Resumption Verification

Verify SDK sessions work correctly (S2 changes).

| # | Test | Expected | Status |
|---|------|----------|--------|
| 2.1 | Send first message, check DB | `sdk_session_id` populated in conversations table | |
| 2.2 | Send second message | Brain responds with awareness of first message (via SDK session, not prompt injection) | |
| 2.3 | Send 5+ messages in conversation | All responses contextually aware; no "[Current conversation]" in system prompt | |
| 2.4 | Restart dashboard server, send message in existing conversation | Session resumes from persisted sessionId | |
| 2.5 | Check server logs | No `buildPromptWithHistory` calls; `resume:` appears in query logs | |
| 2.6 | Skip reset. Open a pre-S2 conversation (no stored session). Send a message. | Falls back to fresh session with context injection. New `sdk_session_id` persisted afterward. | |

### Phase 3: Memory MCP Tools (S1)

Verify memory tools work as native MCP tools (not just prompt-injected functions).

| # | Test | Expected | Status |
|---|------|----------|--------|
| 3.1 | "Remember that my favorite color is green" | Brain calls `remember` MCP tool, fact saved to notebook | |
| 3.2 | Start new conversation: "What's my favorite color?" | Brain calls `recall` MCP tool, returns "green" | |
| 3.3 | "Write a daily log entry about today's testing" | Brain calls `daily_log` MCP tool | |
| 3.4 | "Read my standing orders notebook" | Brain calls `notebook_read` MCP tool | |
| 3.5 | Check Debug API: `/api/debug/memory/status` | Shows MCP server active, tool call counts | |

### Phase 4: Hook Audit Trail (S1)

Verify hooks are active and logging.

| # | Test | Expected | Status |
|---|------|----------|--------|
| 4.1 | Send any chat message | Audit log entry written to `{agentDir}/logs/audit.jsonl` | |
| 4.2 | Check audit log format | JSONL with tool name, input summary, timestamp | |
| 4.3 | Send message that triggers Bash tool | Bash tool use appears in audit log | |
| 4.4 | Verify no dangerous commands pass | Bash blocker active at task/subagent trust levels | |

### Phase 5: Task System (from existing E2E tests)

Consolidation of phases 1-4 from `docs/testing/task-e2e-testing.md`.

#### Immediate Tasks

| # | Test | Expected | Status |
|---|------|----------|--------|
| 5.1 | "Check the weather in Tel Aviv" | Single-step task, executes immediately | |
| 5.2 | "Check weather in Tel Aviv and tell me if I need an umbrella" | Multi-step, conditional logic | |
| 5.3 | "Look up AAPL and MSFT stock prices, which is up more?" | Multi-fetch, comparison | |
| 5.4 | "Review my calendar for tomorrow and list conflicts" | Data analysis task | |

#### Scheduled Tasks (Short Delays)

| # | Test | Expected | Status |
|---|------|----------|--------|
| 5.5 | "In 2 minutes, remind me to stretch" | Fires at T+2min | |
| 5.6 | "In 3 minutes, check weather and message me on WhatsApp" | Scheduled multi-step with external action | |
| 5.7 | "In 2 minutes, check if I have tasks due today and summarize" | Self-referential task | |

#### Task Session Resumption (S2-specific)

| # | Test | Expected | Status |
|---|------|----------|--------|
| 5.8 | Create a recurring task, let it execute twice | Second execution uses `resume: sessionId`, not fresh prompt | |
| 5.9 | Check tasks table after execution | `sdk_session_id` populated | |
| 5.10 | Check task execution log | No "Prior context from this recurring task:" text injection | |
| 5.11 | Create two recurring tasks scheduled 1 minute apart. Let both execute. | Both complete independently, no cross-contamination in responses. | |
| 5.12 | After 5.8 completes, manually set task's `sdk_session_id` to `'fake_expired_session'` in SQLite, re-trigger execution. | Server logs show "SDK session resume failed", task falls back to fresh session, completes successfully. | |

### Phase 6: Memory System (from existing E2E tests)

Consolidation of phases 5-8 from `docs/testing/task-e2e-testing.md`.

#### Indexing

| # | Test | Expected | Status |
|---|------|----------|--------|
| 6.1 | Create `notebook/reference/test-doc.md` | File appears in Settings memory panel | |
| 6.2 | Modify the file | Chunk count updates | |
| 6.3 | Delete the file | Removed from index | |
| 6.4 | Click "Rebuild Index" | All files re-indexed | |

#### Search

| # | Test | Expected | Status |
|---|------|----------|--------|
| 6.5 | Create file with "Dogs are loyal pets" | File indexed | |
| 6.6 | Search "loyal" | Returns match with highlight | |
| 6.7 | Search "cats" (not in any file) | Empty results gracefully | |

#### Live Updates

| # | Test | Expected | Status |
|---|------|----------|--------|
| 6.8 | Create file via terminal while watching Settings | File count increments within 3s (no refresh) | |
| 6.9 | Delete file while watching | Count decrements within 3s | |

#### Recall via Chat

| # | Test | Expected | Status |
|---|------|----------|--------|
| 6.10 | Setup facts file, ask "What's my favorite color?" | Uses recall, returns correct answer | |
| 6.11 | "Search your memory for my dog's name" | Uses recall, returns correct answer | |
| 6.12 | "Remember that my sister's name is Dana" | Creates/updates notebook file | |
| 6.13 | "Search your memory for [nonexistent term]" | Graceful "not found" | |

### Phase 7: Compaction (Long Conversations)

Verify server-side compaction works for extended interactions.

| # | Test | Expected | Status |
|---|------|----------|--------|
| 7.1 | Send 20+ messages in a single conversation | No token overflow, responses stay contextual | |
| 7.2 | Check server logs for compaction indicators | SDK compaction events visible | |
| 7.3 | After compaction, ask about early conversation topic | Brain still remembers (compacted, not lost) | |

### Phase 8: Edge Cases + Regression

| # | Test | Expected | Status |
|---|------|----------|--------|
| 8.1 | Model switching mid-conversation | Works with SDK session (or graceful new session) | |
| 8.2 | Extended thinking toggle | Works with SDK session | |
| 8.3 | File attachment (image) | Works with SDK session | |
| 8.4 | Slash command `/new` | Creates fresh conversation with no sessionId | |
| 8.5 | Slash command `/model` | Switches model, session adapts | |
| 8.6 | WhatsApp message → conversation | WhatsApp conversations get SDK sessions too | |
| 8.7 | "In -5 minutes, remind me" | Rejects invalid time | |
| 8.8 | "Do something in 5 minutes" | Handles vague instruction gracefully | |

### Phase 9: Embeddings + Semantic Search

Only if embeddings plugin is active (requires Ollama).

| # | Test | Expected | Status |
|---|------|----------|--------|
| 9.1 | Settings → Memory → Select "Ollama Embeddings" | Connection UI appears | |
| 9.2 | Connect to Ollama, pull model | Model downloads | |
| 9.3 | Rebuild index with embeddings | Vector count > 0 | |
| 9.4 | Search "canine" (file says "dog") | Semantic match | |
| 9.5 | Search "automobile" (file says "car") | Semantic match | |

---

## Test Execution Protocol

1. **Reset** before starting: `npx tsx packages/dashboard/tests/reset-test-data.ts`
2. **Restart** dashboard: `cd packages/dashboard && npm run dev`
3. Execute phases in order (1 → 9)
4. When a test fails:
   - Document the failure in the status column
   - Investigate root cause
   - Fix the issue
   - Re-run the failing test + all earlier tests (regression check)
   - Continue to next test
5. After all phases pass, write `review.md`

## Reporting

After completion, create `docs/sprints/m6.5-s3-e2e-validation/review.md` with:
- Phase-by-phase pass/fail summary
- Issues found and fixes applied
- Regression risks identified
- Recommendations for automated test coverage

---

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Tech Lead | CTO | Manual testing, bug reporting |
| Backend Dev | Sonnet | Fix issues as they surface |
| Reviewer | Opus | Verify fixes don't introduce regressions |

## Sprint Mode

**Normal sprint** — CTO tests manually, reports failures. Backend dev fixes in real-time. Reviewer verifies each fix.
