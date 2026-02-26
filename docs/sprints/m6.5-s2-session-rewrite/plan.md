# M6.5-S2: Session Rewrite — Sprint Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. MUST invoke claude-developer-platform skill before any Agent SDK work.

> **Milestone:** M6.5 Agent SDK Alignment
> **Sprint:** S2 — Session Rewrite (Destructive)
> **Status:** Planned
> **Depends on:** M6.5-S1 complete
> **Design Spec:** [Agent SDK TS README](https://github.com/anthropics/claude-agent-sdk-typescript), Agent SDK plugin docs

---

## Goal

Replace the prompt-injection session architecture with native Agent SDK session resumption (`resume: sessionId`). Every conversation and task execution gets a real SDK session that persists across queries — eliminating token-wasteful history re-injection, enabling server-side compaction, and unlocking true multi-turn continuity.

## Architecture

**Current (prompt injection):**
```
User message → buildPromptWithHistory() → inject ALL prior turns as text into system prompt → fresh query()
```
- Every message re-sends full conversation history as tokens
- Cost scales linearly with conversation length
- No server-side context management
- `continue: true` is global/process-wide, unusable for per-conversation continuity

**Target (SDK session resumption):**
```
User message → query({ resume: sessionId }) → SDK resumes existing session → server-side context
```
- SDK manages conversation state server-side
- Only new message sent per query (not full history)
- Compaction handled by SDK when context fills
- Each conversation/task has its own persistent sessionId

## Tech Stack

- `@anthropic-ai/claude-agent-sdk` — `resume` option, `sessionId` from result messages
- `packages/dashboard/src/agent/session-manager.ts` — primary rewrite target
- `packages/dashboard/src/tasks/task-executor.ts` — secondary rewrite target
- `packages/core/src/brain.ts` — add `resume` support to query options
- `packages/dashboard/src/conversations/` — store sessionId per conversation

---

## Scope

**In Scope:**
- `brain.ts` — add `resume` option passthrough
- `SessionManager` — replace prompt injection with `resume: sessionId`
- `TaskExecutor` — replace prompt injection with `resume: sessionId`
- Session ID persistence in `agent.db` (conversations + tasks tables)
- Cold start: first message creates session, subsequent messages resume
- Compaction beta flag opt-in
- Session registry update (track sessionId per conversation, not just LRU)

**Out of Scope:**
- MCP tools, subagents, hooks (done in S1)
- Dashboard UI changes (sessions are invisible to users)
- Channel plugin changes (channels don't touch sessions)

---

## Tasks

### T1: Extend brain.ts with `resume` Support

**Owner:** Backend Dev
**Files:**
- Modify: `packages/core/src/brain.ts`
- Test: `packages/core/tests/brain-resume.test.ts`

**Step 1: Read current brain.ts**

Read `packages/core/src/brain.ts` to understand the current `BrainSessionOptions` and `createBrainQuery()` function.

**Step 2: Write the failing test**

Create `packages/core/tests/brain-resume.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'

// Mock the SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn().mockReturnValue((async function* () {
    yield { type: 'result', sessionId: 'sess_test123' }
  })()),
}))

import { createBrainQuery } from '../src/brain.js'
import { query as mockQuery } from '@anthropic-ai/claude-agent-sdk'

describe('brain.ts resume support', () => {
  it('passes resume option to SDK query', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    createBrainQuery('hello', {
      model: 'claude-sonnet-4-5-20250929',
      resume: 'sess_abc123',
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resume: 'sess_abc123',
        }),
      }),
    )
  })

  it('omits resume when not provided', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    createBrainQuery('hello', {
      model: 'claude-sonnet-4-5-20250929',
    })

    const callArgs = (mockQuery as any).mock.calls[0][0]
    expect(callArgs.options.resume).toBeUndefined()
  })

  it('passes compaction beta flag when enabled', () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'

    createBrainQuery('hello', {
      model: 'claude-sonnet-4-5-20250929',
      resume: 'sess_abc123',
      compaction: true,
    })

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          betas: expect.arrayContaining(['compact-2026-01-12']),
        }),
      }),
    )
  })
})
```

**Step 3: Run test to verify it fails**

Run: `cd packages/core && npx vitest run tests/brain-resume.test.ts`
Expected: FAIL — `resume` not in BrainSessionOptions

**Step 4: Implement resume support in brain.ts**

Add to `BrainSessionOptions`:
```typescript
export interface BrainSessionOptions {
  model: string
  systemPrompt?: string
  continue?: boolean
  includePartialMessages?: boolean
  reasoning?: boolean
  /** SDK session ID for resuming a previous session */
  resume?: string
  /** Enable server-side compaction (beta) */
  compaction?: boolean
}
```

Add to `createBrainQuery()` after thinking config:
```typescript
  // Session resumption
  if (options.resume) {
    queryOptions.resume = options.resume
  }

  // Compaction beta
  if (options.compaction) {
    queryOptions.betas = [...(queryOptions.betas ?? []), 'compact-2026-01-12']
  }
```

**Step 5: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/brain-resume.test.ts`
Expected: PASS

**Step 6: Rebuild core package**

Run: `cd packages/core && npm run build`

**Step 7: Commit**

```bash
git add packages/core/src/brain.ts packages/core/tests/brain-resume.test.ts
git commit -m "feat(brain): add resume and compaction support to createBrainQuery"
```

---

### T2: Add sessionId Column to Database

**Owner:** Backend Dev
**Files:**
- Modify: `packages/dashboard/src/conversations/storage.ts` — add migration + accessor
- Test: `packages/dashboard/tests/session-storage.test.ts`

**Step 1: Read current storage.ts**

Read `packages/dashboard/src/conversations/storage.ts` to understand the schema and migration pattern.

**Step 2: Write the failing test**

Create `packages/dashboard/tests/session-storage.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { ConversationStorage } from '../src/conversations/storage.js'

describe('sessionId persistence', () => {
  let db: Database.Database
  let storage: ConversationStorage

  beforeEach(() => {
    db = new Database(':memory:')
    storage = new ConversationStorage(db)
  })

  afterEach(() => {
    db.close()
  })

  it('stores and retrieves SDK sessionId for a conversation', () => {
    const conv = storage.create({ title: 'Test' })
    storage.updateSessionId(conv.id, 'sess_abc123')
    const retrieved = storage.get(conv.id)
    expect(retrieved?.sdkSessionId).toBe('sess_abc123')
  })

  it('returns null sdkSessionId for new conversations', () => {
    const conv = storage.create({ title: 'Test' })
    const retrieved = storage.get(conv.id)
    expect(retrieved?.sdkSessionId).toBeNull()
  })

  it('overwrites sessionId on subsequent updates', () => {
    const conv = storage.create({ title: 'Test' })
    storage.updateSessionId(conv.id, 'sess_first')
    storage.updateSessionId(conv.id, 'sess_second')
    const retrieved = storage.get(conv.id)
    expect(retrieved?.sdkSessionId).toBe('sess_second')
  })
})
```

**Step 3: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/session-storage.test.ts`
Expected: FAIL — `updateSessionId` not defined, `sdkSessionId` not in schema

**Step 4: Add migration and accessor**

Add migration to `ConversationStorage` init:
```typescript
// Migration: add sdk_session_id column
const hasSessionCol = db.prepare(
  "SELECT COUNT(*) as cnt FROM pragma_table_info('conversations') WHERE name='sdk_session_id'"
).get() as { cnt: number }
if (hasSessionCol.cnt === 0) {
  db.exec('ALTER TABLE conversations ADD COLUMN sdk_session_id TEXT DEFAULT NULL')
}
```

Add methods:
```typescript
updateSessionId(conversationId: string, sessionId: string): void {
  this.db.prepare('UPDATE conversations SET sdk_session_id = ? WHERE id = ?')
    .run(sessionId, conversationId)
}
```

Include `sdk_session_id` in the `get()` query result mapping.

**Step 5: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/session-storage.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/dashboard/src/conversations/storage.ts packages/dashboard/tests/session-storage.test.ts
git commit -m "feat(storage): add sdk_session_id column for session resumption"
```

---

### T3: Rewrite SessionManager

**Owner:** Backend Dev
**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts`
- Test: `packages/dashboard/tests/session-manager.test.ts`

This is the core rewrite. The `SessionManager` currently:
1. Stores turns in RAM (`this.turns: TurnRecord[]`)
2. Builds system prompt with ALL history injected as text (`buildPromptWithHistory()`)
3. Creates a fresh query every message (`continue: false`)

After rewrite:
1. Stores only the SDK `sessionId` (string)
2. System prompt sent once on first message only
3. Subsequent messages use `resume: sessionId`

**Step 1: Read current session-manager.ts thoroughly**

Read `packages/dashboard/src/agent/session-manager.ts`. Note every method and its responsibility.

**Step 2: Write the failing tests**

Create `packages/dashboard/tests/session-manager.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the core module
const mockCreateBrainQuery = vi.fn()
vi.mock('@my-agent/core', () => ({
  createBrainQuery: mockCreateBrainQuery,
  loadConfig: () => ({ model: 'claude-sonnet-4-5-20250929', brainDir: '/tmp/brain' }),
  assembleSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
  assembleCalendarContext: vi.fn().mockResolvedValue('calendar context'),
  createCalDAVClient: vi.fn(),
  loadCalendarConfig: vi.fn().mockReturnValue(null),
  loadCalendarCredentials: vi.fn().mockReturnValue(null),
}))

import { SessionManager } from '../src/agent/session-manager.js'

describe('SessionManager (SDK sessions)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('first message creates a new session (no resume)', async () => {
    // Mock query that yields a result with sessionId
    mockCreateBrainQuery.mockReturnValue((async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }
      yield { type: 'result', sessionId: 'sess_new123' }
    })())

    const sm = new SessionManager('conv-1')
    const events = []
    for await (const event of sm.streamMessage('Hello')) {
      events.push(event)
    }

    // Should NOT have resume option on first call
    expect(mockCreateBrainQuery).toHaveBeenCalledWith(
      'Hello',
      expect.objectContaining({
        systemPrompt: expect.any(String),
      }),
    )
    const callOpts = mockCreateBrainQuery.mock.calls[0][1]
    expect(callOpts.resume).toBeUndefined()
  })

  it('second message resumes the session', async () => {
    mockCreateBrainQuery
      .mockReturnValueOnce((async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }
        yield { type: 'result', sessionId: 'sess_abc' }
      })())
      .mockReturnValueOnce((async function* () {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'World' }] } }
        yield { type: 'result', sessionId: 'sess_abc' }
      })())

    const sm = new SessionManager('conv-1')

    // First message
    for await (const _ of sm.streamMessage('Hello')) {}

    // Second message — should resume
    for await (const _ of sm.streamMessage('How are you?')) {}

    const secondCallOpts = mockCreateBrainQuery.mock.calls[1][1]
    expect(secondCallOpts.resume).toBe('sess_abc')
  })

  it('does not inject conversation history into system prompt', async () => {
    mockCreateBrainQuery
      .mockReturnValueOnce((async function* () {
        yield { type: 'result', sessionId: 'sess_1' }
      })())
      .mockReturnValueOnce((async function* () {
        yield { type: 'result', sessionId: 'sess_1' }
      })())

    const sm = new SessionManager('conv-1')
    for await (const _ of sm.streamMessage('First')) {}
    for await (const _ of sm.streamMessage('Second')) {}

    // System prompt on second call should NOT contain "[Current conversation]"
    const secondCallOpts = mockCreateBrainQuery.mock.calls[1][1]
    expect(secondCallOpts.systemPrompt).not.toContain('[Current conversation]')
    expect(secondCallOpts.systemPrompt).not.toContain('First')
  })

  it('exposes sessionId for persistence', async () => {
    mockCreateBrainQuery.mockReturnValue((async function* () {
      yield { type: 'result', sessionId: 'sess_persist' }
    })())

    const sm = new SessionManager('conv-1')
    for await (const _ of sm.streamMessage('Hi')) {}

    expect(sm.getSessionId()).toBe('sess_persist')
  })

  it('restores from a persisted sessionId (cold start)', async () => {
    mockCreateBrainQuery.mockReturnValue((async function* () {
      yield { type: 'result', sessionId: 'sess_restored' }
    })())

    const sm = new SessionManager('conv-1', null, 'sess_restored')
    for await (const _ of sm.streamMessage('Welcome back')) {}

    const callOpts = mockCreateBrainQuery.mock.calls[0][1]
    expect(callOpts.resume).toBe('sess_restored')
  })
})
```

**Step 3: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run tests/session-manager.test.ts`
Expected: FAIL — current SessionManager doesn't support resume, doesn't expose getSessionId()

**Step 4: Rewrite SessionManager**

Rewrite `packages/dashboard/src/agent/session-manager.ts`:

Key changes:
1. Remove `private turns: TurnRecord[]` — SDK manages conversation state
2. Remove `buildPromptWithHistory()` — no more history injection
3. Add `private sdkSessionId: string | null` — captured from SDK result messages
4. Add constructor param for restoring persisted sessionId
5. Add `getSessionId(): string | null` accessor
6. First message: send with `systemPrompt`, no `resume`
7. Subsequent messages: send with `resume: this.sdkSessionId`
8. Capture `sessionId` from `result` messages in the stream

Core logic:
```typescript
async *streamMessage(
  content: string | ContentBlock[],
  options?: StreamOptions,
): AsyncGenerator<StreamEvent> {
  await this.ensureInitialized()

  const model = options?.model || this.config!.model
  const isHaiku = model.includes('haiku')
  const reasoning = options?.reasoning && !isHaiku

  const brainOptions: BrainSessionOptions = {
    model,
    includePartialMessages: true,
    reasoning,
  }

  if (this.sdkSessionId) {
    // Resume existing session — SDK has full conversation context
    brainOptions.resume = this.sdkSessionId
  } else {
    // First message — send system prompt to establish session
    brainOptions.systemPrompt = this.buildSystemPrompt()
  }

  const q = createBrainQuery(content, brainOptions)
  this.activeQuery = q

  try {
    for await (const event of processStream(q)) {
      // Capture sessionId from result messages
      if (event.type === 'result' && event.sessionId) {
        this.sdkSessionId = event.sessionId
      }
      yield event
    }
  } finally {
    this.activeQuery = null
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/session-manager.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/dashboard/src/agent/session-manager.ts packages/dashboard/tests/session-manager.test.ts
git commit -m "feat(session): rewrite SessionManager to use SDK session resumption"
```

---

### T4: Wire Session Persistence into Chat Handler

**Owner:** Backend Dev
**Files:**
- Modify: `packages/dashboard/src/ws/chat-handler.ts`
- Modify: `packages/dashboard/src/agent/session-registry.ts`

**Step 1: Read current chat-handler.ts and session-registry.ts**

Understand how chat handler creates SessionManagers and how the registry caches them.

**Step 2: Update session registry**

The session registry currently creates SessionManagers from conversation context. Update it to:
1. Load `sdkSessionId` from storage when creating a SessionManager for an existing conversation
2. After each message, persist the new `sdkSessionId` back to storage

**Step 3: Update chat handler**

After processing a message stream, call:
```typescript
const sessionId = sessionManager.getSessionId()
if (sessionId) {
  conversationStorage.updateSessionId(conversationId, sessionId)
}
```

**Step 4: Test manually**

1. Start dashboard
2. Send a message in a new conversation
3. Check database: `sqlite3 .my_agent/agent.db "SELECT id, sdk_session_id FROM conversations ORDER BY created_at DESC LIMIT 1"`
4. Send a second message
5. Verify sessionId is stable across messages

**Step 5: Commit**

```bash
git add packages/dashboard/src/ws/chat-handler.ts packages/dashboard/src/agent/session-registry.ts
git commit -m "feat(chat): persist SDK sessionId across conversation messages"
```

---

### T5: Rewrite TaskExecutor Session Handling

**Owner:** Backend Dev
**Files:**
- Modify: `packages/dashboard/src/tasks/task-executor.ts`
- Test: `packages/dashboard/tests/task-executor-session.test.ts`

The TaskExecutor currently:
1. `loadPriorContext()` — reads from JSONL log, returns turns as text
2. `executeQuery()` — injects prior turns into prompt text, uses `continue: shouldContinue`

After rewrite:
1. Store `sdkSessionId` per task (in tasks table)
2. First execution: fresh query with system prompt
3. Recurring executions: `resume: task.sdkSessionId`
4. No more text injection of prior context

**Step 1: Read current task-executor.ts**

Read fully. Note `loadPriorContext()` and `executeQuery()` methods.

**Step 2: Add sdkSessionId to tasks table**

Add migration (same pattern as T2):
```sql
ALTER TABLE tasks ADD COLUMN sdk_session_id TEXT DEFAULT NULL
```

**Step 3: Write the failing test**

Create `packages/dashboard/tests/task-executor-session.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'

describe('TaskExecutor SDK sessions', () => {
  it('first execution creates new session (no resume)', async () => {
    // Mock setup...
    // Execute a task with no prior sdkSessionId
    // Verify createBrainQuery called WITHOUT resume
  })

  it('recurring task resumes from stored sessionId', async () => {
    // Mock setup...
    // Execute a task that has sdkSessionId from previous execution
    // Verify createBrainQuery called WITH resume: sdkSessionId
  })

  it('captures and stores sessionId from result', async () => {
    // Mock setup...
    // Execute task, verify sdkSessionId is saved to taskManager
  })

  it('no longer injects prior context as text', async () => {
    // Mock setup...
    // Execute recurring task with prior log entries
    // Verify prompt does NOT contain "Prior context from this recurring task:"
  })
})
```

**Step 4: Rewrite executeQuery()**

Replace the prompt-injection approach:
```typescript
private async executeQuery(
  task: Task,
  priorContext: TranscriptTurn[],
): Promise<{ response: string; sessionId?: string }> {
  const brainConfig = loadConfig()

  const brainOptions: BrainSessionOptions = {
    model: brainConfig.model,
    includePartialMessages: false,
  }

  if (task.sdkSessionId) {
    // Recurring task — resume existing session
    brainOptions.resume = task.sdkSessionId
  } else {
    // First execution — send full system prompt
    const systemPrompt = await assembleSystemPrompt(brainConfig.brainDir, {
      /* calendar context etc. */
    })
    brainOptions.systemPrompt = systemPrompt
  }

  const userMessage = this.buildUserMessage(task)
  const q = createBrainQuery(userMessage, brainOptions)

  let response = ''
  let sessionId: string | undefined
  for await (const msg of q) {
    if (msg.type === 'assistant') {
      // collect text...
    }
    if (msg.type === 'result' && msg.sessionId) {
      sessionId = msg.sessionId
    }
  }

  return { response, sessionId }
}
```

Update `run()` to persist sessionId:
```typescript
const { response, sessionId } = await this.executeQuery(task, priorContext)
if (sessionId) {
  this.taskManager.update(task.id, { sdkSessionId: sessionId })
}
```

**Step 5: Run tests**

Run: `cd packages/dashboard && npx vitest run tests/task-executor-session.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/dashboard/src/tasks/task-executor.ts packages/dashboard/tests/task-executor-session.test.ts
git commit -m "feat(tasks): rewrite TaskExecutor to use SDK session resumption"
```

---

### T6: Enable Compaction Beta

**Owner:** Backend Dev
**Files:**
- Modify: `packages/core/src/brain.ts` (already has compaction support from T1)
- Modify: `packages/core/src/config.ts` — add compaction config option
- Modify: `packages/dashboard/src/agent/session-manager.ts` — pass compaction flag
- Modify: `packages/dashboard/src/tasks/task-executor.ts` — pass compaction flag

**Step 1: Add config option**

Add to `config.yaml` schema:
```yaml
compaction: true  # Enable SDK server-side compaction (beta)
```

**Step 2: Pass compaction flag through to brain queries**

In both SessionManager and TaskExecutor, when session has a resume ID:
```typescript
brainOptions.compaction = config.compaction ?? true  // default on
```

Compaction only makes sense when resuming (existing session has context to compact).

**Step 3: Test manually**

Send 20+ messages in a conversation. Observe that the SDK manages context without token overflow.

**Step 4: Commit**

```bash
git add packages/core/src/config.ts packages/dashboard/src/agent/session-manager.ts packages/dashboard/src/tasks/task-executor.ts
git commit -m "feat(compaction): enable SDK server-side compaction for long sessions"
```

---

### T7: Remove Dead Code + Update Documentation

**Owner:** Backend Dev
**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts` — remove `buildPromptWithHistory`, `TurnRecord`, `turns[]`
- Modify: `packages/dashboard/src/agent/session-registry.ts` — remove context injection logic
- Modify: `docs/design.md` — update session architecture section
- Modify: `docs/design/conversation-system.md` — update continuity description

**Step 1: Remove dead code**

After T3-T5 are complete and tested, clean up:
- Remove `TurnRecord` interface
- Remove `turns: TurnRecord[]` property
- Remove `buildPromptWithHistory()` method
- Remove `contextInjection` constructor param (if fully replaced)
- Remove `loadPriorContext()` from TaskExecutor (if fully replaced)

**Step 2: Update design docs**

Update `docs/design.md` session architecture section to reflect:
- SDK session resumption via `resume: sessionId`
- No more prompt injection for conversation history
- Compaction enabled for long-running sessions

**Step 3: Run all tests**

Run: `cd packages/dashboard && npx vitest run`
Run: `cd packages/core && npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(session): remove prompt-injection dead code, update docs"
```

---

## Verification

After all tasks complete:

1. New conversations get an SDK sessionId stored in `agent.db`
2. Second message in any conversation uses `resume: sessionId` (not prompt injection)
3. Recurring tasks resume from stored sessionId
4. `buildPromptWithHistory()` is completely removed
5. No `[Current conversation]` text injected into any system prompt
6. Compaction is enabled — long conversations don't hit token limits
7. Cold start (server restart) restores sessions from persisted sessionIds
8. All unit tests pass
9. Dashboard chat works (regression check)
10. Task execution works (regression check)

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| SDK `resume` behavior differs from docs | T1 tests validate resume passthrough; manual test in T4 validates E2E |
| Session IDs expire or become invalid | Fallback: if resume fails, create new session with system prompt |
| Compaction beta is unstable | Compaction is config-gated, can be disabled without code changes |
| Cold start loses context if sessionId is stale | SDK should handle gracefully; test in T4 step 4 |
| Breaking change to task execution | T5 tests validate recurring task resume; E2E tests in S3 |

---

## Team

| Role | Model | Responsibility |
|------|-------|----------------|
| Tech Lead | CTO | Architecture decisions, SDK guidance |
| Backend Dev | Sonnet | T1-T7 implementation |
| Reviewer | Opus | Plan-execution match, SDK correctness |

## Sprint Mode

**Normal sprint** — CTO available for SDK decisions. This sprint is high-risk (destructive rewrite) — Reviewer must verify each task before proceeding to next. MUST invoke `claude-developer-platform` skill during review.
