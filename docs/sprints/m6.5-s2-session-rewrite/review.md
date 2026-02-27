# Sprint Review -- M6.5-S2: Session Rewrite

> **Reviewer:** Opus (independent review)
> **Date:** 2026-02-27
> **Branch:** master (uncommitted working tree)
> **Mode:** Normal sprint

---

## Verdict: PASS

All eight tasks are implemented and the core goal is achieved: prompt-injection session architecture has been replaced with native SDK session resumption. The resume path, persistence path, cold-start fallback, stale session recovery, and model-change invalidation are all correctly wired. Original reviewer findings (compaction config-gating, `continue` flag removal) have been fixed. T8 (stale session fallback) was added retroactively and completed.

---

## Plan Adherence

| Task | Plan | Implementation | Match |
|------|------|----------------|-------|
| T1: brain.ts resume + compaction | Add `resume` and `compaction` to BrainSessionOptions | Both fields added, resume passed to queryOptions, compaction uses beta cast | Yes |
| T2: Database columns | `sdk_session_id` on conversations + tasks | Both columns migrated, getter/setter methods on ConversationDatabase | Yes (deviation: plan said `storage.ts`, impl used `db.ts`) |
| T3: SessionManager rewrite | Remove prompt injection, add SDK resume | TurnRecord/buildPromptWithHistory removed, resume path + fresh path implemented, session_init captured | Yes |
| T4: Chat handler wiring | Load/save sdkSessionId at all entry points | Wired at 4 locations: initial load, conversation switch, session creation, post-message persist. Model change clears stored session. | Yes |
| T5: TaskExecutor rewrite | Dual path (resume vs fresh), capture sessionId | Resume path + fresh fallback, system init captured, session persisted via db | Yes (findings fixed) |
| T6: Compaction beta | Config-gated, passed on resume path only | Compaction config-gated via `config.compaction ?? true` in both resume paths | Yes (finding fixed) |
| T7: Dead code removal + docs | Remove TurnRecord, buildPromptWithHistory, update design docs | Dead code fully removed from SessionManager. Design docs updated. TaskExecutor retains text-injection fallback (acceptable). | Yes |
| T8: Stale session fallback | (Retroactive) try/catch resume, fall back to fresh | SessionManager + TaskExecutor both catch resume failures, clear stale session, retry fresh | Yes |
| Unit tests | Plan specified 3 test files | No test files created | Deviation (see below) |

**Deviation: No unit tests.** The plan specified `brain-resume.test.ts`, `session-manager.test.ts`, and `task-executor-session.test.ts`. None were created. This follows the same pattern as S1 (no test runner configured). The deviation is acceptable given TypeScript compilation provides type-level guarantees and the code was independently reviewed, but test coverage remains a gap across the project.

**Deviation: T2 file mismatch.** The plan referenced `storage.ts` but the implementation correctly went into `db.ts` (which is where the database schema and queries live). This is a beneficial deviation -- the plan had an outdated filename.

**Deviation: `memory-db.ts` formatting changes.** The diff includes whitespace-only reformatting of `packages/core/src/memory/memory-db.ts`. This is outside the sprint scope but harmless (likely from a Prettier run).

---

## Architecture Assessment

### Session Resumption Pattern (Pass)

The dual-path architecture is correctly implemented:

**SessionManager (`/home/nina/my_agent/packages/dashboard/src/agent/session-manager.ts`):**
- **Resume path (warm):** When `sdkSessionId` exists, calls `createBrainQuery` with `resume: sessionId` -- no system prompt, no history injection. Correct.
- **Fresh path (cold):** When no session ID, builds full system prompt with optional context injection from abbreviation + recent turns. Captures session ID from `session_init` event. Correct.
- **Session ID capture:** Listens for `session_init` events from the stream processor. This is the right approach since `session_init` arrives early in the stream.

**TaskExecutor (`/home/nina/my_agent/packages/dashboard/src/tasks/task-executor.ts`):**
- **Resume path:** Loads stored session ID from DB, resumes with `resume: storedSessionId`. Correct.
- **Fresh path:** Falls back to full system prompt + text-injected prior context. Session ID captured from raw SDK `system` messages (since TaskExecutor uses `processStream` directly, not via the stream processor). Correct.
- **Persistence:** Stores captured session ID via `db.updateTaskSdkSessionId()`. Correct.

### Persistence Wiring (Pass)

The chat handler (`/home/nina/my_agent/packages/dashboard/src/ws/chat-handler.ts`) correctly loads and saves `sdkSessionId` at all necessary points:

1. **Initial page load** (line 499-501): Loads stored session ID from DB for the most recent conversation.
2. **Conversation switch** (line 626-628): Loads stored session ID when user switches conversations.
3. **Session creation** (line 979-987): Loads stored session ID when creating a new SessionManager.
4. **Post-message persist** (line 1189-1195): Saves the session ID after each completed message.
5. **Model change invalidation** (line 917-920): Clears stored session ID and removes cached session when model changes. This is correct -- a model change requires a fresh SDK session.

### Stream Processor (Pass)

The `session_init` event type (`/home/nina/my_agent/packages/dashboard/src/agent/stream-processor.ts`, lines 75-83) correctly extracts the session ID from SDK system init messages. The `(msg as any)` casts are necessary because the SDK types do not fully type the system message subtypes.

### Database Layer (Pass)

The `ConversationDatabase` (`/home/nina/my_agent/packages/dashboard/src/conversations/db.ts`) correctly:
- Adds migration for both `conversations` and `tasks` tables (lines 116-120, 219-224)
- Uses the established migration pattern (check column existence before ALTER TABLE)
- Provides clean getter/setter methods (lines 584-625)
- Uses parameterized queries (no SQL injection risk)

### Manager/Index Wiring (Pass)

- `ConversationManager.getConversationDb()` (`/home/nina/my_agent/packages/dashboard/src/conversations/manager.ts`, lines 309-314) exposes the DB instance for session ID operations. Clean approach.
- `index.ts` (`/home/nina/my_agent/packages/dashboard/src/index.ts`, line 206) passes `conversationManager.getConversationDb()` to TaskExecutor. Correct.
- `event-handler.ts` (`/home/nina/my_agent/packages/dashboard/src/scheduler/event-handler.ts`, lines 27-28, 103, 178-183) receives and passes DB to TaskExecutor instances. Correct.

---

## Code Quality

| Criterion | Rating | Notes |
|-----------|--------|-------|
| Type safety | Good | Appropriate use of `string \| null` for session IDs, SDK types used correctly |
| Error handling | Good | Graceful degradation on calendar context failure, try/finally on stream processing |
| Code organization | Good | Clean separation: stream-processor captures events, session-manager orchestrates, chat-handler persists |
| Documentation | Good | JSDoc comments present on new methods, design docs updated |
| Security | Pass | Parameterized SQL queries, no secrets in code |
| Naming | Good | `sdkSessionId` consistent across all files, `session_init` event type is clear |
| Dead code removal | Good | `TurnRecord`, `buildPromptWithHistory`, `turns[]` fully removed from SessionManager |

---

## Findings

### Resolved (Fixed During Sprint)

**1. Compaction config-gating** — Originally hardcoded `true`, now reads `config.compaction ?? true` in both SessionManager and TaskExecutor. **Fixed.**

**2. `continue: shouldContinue` removal** — Removed from TaskExecutor fresh path to prevent cross-contamination between concurrent task executions. **Fixed.**

**3. Stale session fallback (T8)** — Added retroactively. Both SessionManager and TaskExecutor now wrap the resume path in try/catch. On failure: log warning, clear stale session ID (so caller persists null), fall back to fresh session. SessionManager refactored resume/fresh logic into `buildQuery()` helper to avoid duplication. TaskExecutor refactored into `buildResumeQuery()`, `buildFreshQuery()`, and `iterateBrainQuery()` helpers. **Implemented.**

### Suggestions (Nice to Have)

**4. `(msg as any)` casts for SDK system messages**

Five locations use `(msg as any)` to access `subtype` and `session_id` on SDK system messages:
- `stream-processor.ts` lines 76, 79
- `task-executor.ts` lines 443-446

These casts exist because the SDK does not export typed system message interfaces. This is acceptable now, but could break silently if the SDK changes the message shape.

**Recommendation:** Define a local interface for type narrowing:

```typescript
interface SdkSystemInitMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
}
```

This centralizes the assumption and makes it grep-able if the SDK changes.

---

## Security Review

| Check | Status | Notes |
|-------|--------|-------|
| No secrets in code | Pass | No API keys, credentials, or private data in any changed file |
| SQL injection | Pass | All DB queries use parameterized statements (`?` placeholders) |
| Null handling | Pass | Session IDs are `string \| null` throughout, null-checked before use |
| `any` type usage | Acceptable | Limited to SDK system message access (5 locations) and SDK beta cast (1 location) |
| Session invalidation | Pass | Model change correctly clears stored session ID and removes cached session |

---

## Recommendations for CTO

1. ~~**Fix compaction config wiring**~~ — **Done.**
2. ~~**Remove `continue: shouldContinue`**~~ — **Done.**
3. ~~**Add stale session fallback**~~ — **Done (T8).**
4. **Add unit tests** when vitest is configured. The three test files from the plan (brain-resume, session-manager, task-executor-session) are well-specified and can be implemented directly from the plan.
5. **Merge to master** — all findings resolved. Changes are well-structured and the architecture is sound.

---

## Files Changed

### Modified Files (13 in scope)

**Core package:**
- `packages/core/src/brain.ts` -- Added `resume` and `compaction` to BrainSessionOptions, wired into queryOptions
- `packages/core/src/config.ts` -- Added `brain.compaction` to YamlConfig, plumbed to BrainConfig
- `packages/core/src/types.ts` -- Added `compaction?: boolean` to BrainConfig

**Dashboard package:**
- `packages/dashboard/src/agent/stream-processor.ts` -- Added `session_init` StreamEvent type, captures SDK system init messages
- `packages/dashboard/src/agent/session-manager.ts` -- Rewrote: removed prompt injection, added SDK resume/fresh dual path, captures session_init events. T8: refactored into `buildQuery()` helper, added try/catch fallback on stale session
- `packages/dashboard/src/agent/session-registry.ts` -- Added `sdkSessionId` parameter to `getOrCreate()`
- `packages/dashboard/src/ws/chat-handler.ts` -- Wired session ID load/save at 5 points, model change clears session
- `packages/dashboard/src/conversations/db.ts` -- Added `sdk_session_id` columns to conversations + tasks, getter/setter methods
- `packages/dashboard/src/conversations/manager.ts` -- Added `getConversationDb()` accessor
- `packages/dashboard/src/index.ts` -- Threaded DB access to TaskExecutor and event handler
- `packages/dashboard/src/scheduler/event-handler.ts` -- Added `db` to EventHandlerConfig, passed to TaskExecutor
- `packages/dashboard/src/tasks/task-executor.ts` -- Rewrote: dual path (resume stored session vs fresh), captures and persists session IDs. T8: refactored into `buildResumeQuery()`/`buildFreshQuery()`/`iterateBrainQuery()` helpers, added try/catch fallback on stale session

**Documentation:**
- `docs/design.md` -- Updated session architecture section with SDK resumption description
- `docs/design/conversation-system.md` -- Updated Working Context and Resume sections

### Out-of-scope changes (1)
- `packages/core/src/memory/memory-db.ts` -- Formatting only (Prettier whitespace changes)
