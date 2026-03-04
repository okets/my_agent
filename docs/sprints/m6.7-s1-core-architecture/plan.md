# M6.7-S1: Core Architecture — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the two-branch `buildQuery()` in SessionManager with a single path that always passes both `resume` + `systemPrompt`, powered by a new SystemPromptBuilder that assembles a 6-layer prompt with caching annotations.

**Architecture:** Every query to Conversation Nina now goes through one code path: SystemPromptBuilder assembles the system prompt fresh (6 layers, with cache_control on stable layers 1-2), then `buildQuery()` always passes both `resume` (if session exists) and `systemPrompt`. This removes `context-builder.ts` (cold-start injection), simplifies SessionRegistry, and makes the system prompt inspectable and testable.

**Tech Stack:** TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Fastify, Vitest, better-sqlite3

**Design doc:** `docs/plans/2026-03-04-conversation-nina-design.md`

**Implementation plan (parent):** `docs/plans/2026-03-04-conversation-nina-plan.md` (Tasks 1-3 are S1 scope)

---

## Task 1: Update Roadmap & Design Docs

Bring documentation in line with the approved Conversation Nina design before any code changes. This is the foundation — every subsequent task references these docs.

**Files:**
- Modify: `docs/ROADMAP.md` — M6.7 description, sprint table, M9 description, M6.6 sequencing note, dependency graph, design specs table
- Modify: `docs/design/conversation-system.md` — full rewrite for current/inactive model
- Modify: `docs/design/channels.md` — update conversation continuity, per-contact scoping, email routing

**Reference:** `docs/plans/2026-03-04-conversation-nina-plan.md` Task 1 (Steps 1-7) contains the exact content for each update.

### Step 1: Update M6.7 in ROADMAP.md

In `docs/ROADMAP.md`, find the M6.7 section (around line 394). Replace the description with the expanded version from the implementation plan Task 1 Step 1. Key additions:
- Resumable sessions with dynamic system prompt
- 6-layer system prompt architecture
- Single current conversation model
- Channel routing rules
- Sprint scope table (S1-S4)

### Step 2: Update M9 in ROADMAP.md

Find the M9 section. Change from "Email Channel" to "Email Integration" — email is task submission to Working Agents, not a conversation channel. See implementation plan Task 1 Step 2.

### Step 3: Update M6.6 sequencing note

Add relationship note to M6.6: M6.7 delivers 6-layer prompt + session unification, M6.6 builds on it by populating layers 3-4 via work loop. Remove "context refresher on resume" from M6.6 S1 scope (superseded). See implementation plan Task 1 Step 3.

### Step 4: Update Design Specs table

Update the Conversations and Two-Agent Refactor rows in the Design Specs table. See implementation plan Task 1 Step 4.

### Step 5: Update dependency graph notes

Replace M6.7 dependency description (around line 720). See implementation plan Task 1 Step 5.

### Step 6: Rewrite conversation-system.md

Full rewrite of `docs/design/conversation-system.md`:
- Replace created → active → idle → abbreviate lifecycle with **current/inactive** model
- Document resume + systemPrompt mechanics (SDK accepts both together)
- Add channel badges section
- Document new conversation triggers (`/new`, Web→WhatsApp, idle timeout)
- Add browsable/resumable from UI section
- Add MCP tools section (conversation_search, conversation_read)
- **Keep** terminology (conversation, transcript, turn) and storage format (JSONL + SQLite) — unchanged
- **Remove** cold-start fallback section entirely

### Step 7: Update channels.md

In `docs/design/channels.md`:
- **Conversation continuity section:** Replace "conversations do not span channels" with asymmetric rule (Web→WhatsApp = new, WhatsApp→Web = same)
- **Per-contact scoping:** Add note that per-contact scoping applies to Working Agents only
- **Email section:** Clarify email routes to Working Agents as task submission, not to Conversation Nina

### Step 8: Commit

```bash
git add docs/ROADMAP.md docs/design/conversation-system.md docs/design/channels.md
git commit -m "docs: align roadmap and design specs with conversation nina architecture

Update M6.7 with conversation architecture (resume+systemPrompt, 6-layer
prompt, channel routing). Rewrite conversation-system.md for current/inactive
model. Update channels.md for asymmetric channel switching and Working Agent
per-contact scoping. Clarify M9 as email integration (task submission, not
conversation channel). Update M6.6 sequencing."
```

---

## Task 2: Create SystemPromptBuilder

Extract system prompt assembly into a dedicated, testable module with 6-layer architecture and prompt caching annotations. This replaces the scattered prompt logic in `session-manager.ts:doInitialize()` and the inline prompt injection in `buildQuery()`.

**Files:**
- Create: `packages/dashboard/src/agent/system-prompt-builder.ts`
- Test: `packages/dashboard/tests/system-prompt-builder.test.ts`
- Reference: `packages/core/src/prompt.ts` — existing `assembleSystemPrompt()` (used as Layer 1-2 source)

### Step 1: Write failing tests

Create `packages/dashboard/tests/system-prompt-builder.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SystemPromptBuilder } from "../src/agent/system-prompt-builder.js";

// Mock @my-agent/core to avoid filesystem dependencies in tests
vi.mock("@my-agent/core", () => ({
  assembleSystemPrompt: vi.fn().mockResolvedValue("## Identity\nYou are Nina."),
  loadCalendarConfig: vi.fn().mockReturnValue(null),
  loadCalendarCredentials: vi.fn().mockReturnValue(null),
}));

describe("SystemPromptBuilder", () => {
  let builder: SystemPromptBuilder;

  beforeEach(() => {
    builder = new SystemPromptBuilder({
      brainDir: "/tmp/test-brain",
      agentDir: "/tmp/test-agent",
    });
  });

  it("returns system prompt as array of content blocks", async () => {
    const result = await builder.build({
      channel: "web",
      conversationId: "conv-TEST123",
      messageIndex: 1,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("text");
  });

  it("applies cache_control on stable layers (block 0) only", async () => {
    const result = await builder.build({
      channel: "web",
      conversationId: "conv-TEST123",
      messageIndex: 1,
    });

    // First block (identity + skills) should have cache_control
    expect(result[0].cache_control).toEqual({ type: "ephemeral" });

    // Last block (dynamic layers) should NOT have cache_control
    expect(result[1].cache_control).toBeUndefined();
  });

  it("includes inbound metadata as JSON in dynamic block", async () => {
    const result = await builder.build({
      channel: "whatsapp",
      conversationId: "conv-ABC",
      messageIndex: 5,
    });

    const dynamicText = result[1].text;
    expect(dynamicText).toContain('"channel": "whatsapp"');
    expect(dynamicText).toContain('"conversation_id": "conv-ABC"');
    expect(dynamicText).toContain('"message_index": 5');
  });

  it("includes conversation ID in session context", async () => {
    const result = await builder.build({
      channel: "web",
      conversationId: "conv-XYZ",
      messageIndex: 3,
    });

    const dynamicText = result[1].text;
    expect(dynamicText).toContain("conv-XYZ");
    expect(dynamicText).toContain("Message index: 3");
  });

  it("caches stable prompt across calls", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");

    await builder.build({ channel: "web", conversationId: "c1", messageIndex: 1 });
    await builder.build({ channel: "web", conversationId: "c1", messageIndex: 2 });

    // assembleSystemPrompt should only be called once (cached)
    expect(assembleSystemPrompt).toHaveBeenCalledTimes(1);
  });

  it("invalidateCache forces re-read of stable prompt", async () => {
    const { assembleSystemPrompt } = await import("@my-agent/core");

    await builder.build({ channel: "web", conversationId: "c1", messageIndex: 1 });
    builder.invalidateCache();
    await builder.build({ channel: "web", conversationId: "c1", messageIndex: 2 });

    expect(assembleSystemPrompt).toHaveBeenCalledTimes(2);
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd packages/dashboard && npx vitest run tests/system-prompt-builder.test.ts`
Expected: FAIL — `Cannot find module '../src/agent/system-prompt-builder.js'`

### Step 3: Write the implementation

Create `packages/dashboard/src/agent/system-prompt-builder.ts`:

```typescript
/**
 * System Prompt Builder
 *
 * Assembles the 6-layer system prompt for Conversation Nina.
 * Layers 1-2 (identity + skills) are cached with cache_control.
 * Layers 3-6 (state, memory, metadata, session) are rebuilt every query.
 *
 * Design doc: docs/plans/2026-03-04-conversation-nina-design.md § 4
 */

import {
  assembleSystemPrompt,
  loadCalendarConfig,
  loadCalendarCredentials,
  createCalDAVClient,
  assembleCalendarContext,
} from "@my-agent/core";

interface BuilderConfig {
  brainDir: string;
  agentDir: string;
}

export interface BuildContext {
  channel: string;
  conversationId: string;
  messageIndex: number;
  hasPendingEscalations?: boolean;
  activeWorkingAgents?: string[];
}

export interface SystemPromptBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export class SystemPromptBuilder {
  private config: BuilderConfig;
  private stablePromptCache: string | null = null;

  constructor(config: BuilderConfig) {
    this.config = config;
  }

  /**
   * Build the full system prompt as an array of content blocks.
   * Layers 1-2 (identity + skills) are cached. Layers 3-6 are dynamic.
   */
  async build(context: BuildContext): Promise<SystemPromptBlock[]> {
    // Layers 1-2: Identity + Skills (stable, cached)
    const stablePrompt = await this.getStablePrompt();

    // Layers 3-6: Dynamic context (rebuilt every query)
    const dynamicParts: string[] = [];
    const now = new Date();

    // Layer 3: Current state
    // Populated by work loop in M6.6 — timestamp placeholder for now
    dynamicParts.push(
      `[Current State]\nTimestamp: ${now.toISOString()}\n[End Current State]`,
    );

    // Layer 4: Memory context
    // Daily summary is included in stable prompt via assembleSystemPrompt.
    // MCP memory server handles runtime retrievals — no extra injection needed.

    // Layer 5: Inbound metadata (JSON, system-role, trusted)
    const metadata = {
      channel: context.channel,
      timestamp: now.toISOString(),
      message_index: context.messageIndex,
      conversation_id: context.conversationId,
      has_pending_escalations: context.hasPendingEscalations ?? false,
      active_working_agents: context.activeWorkingAgents ?? [],
    };
    dynamicParts.push(
      `[Inbound Metadata]\n${JSON.stringify(metadata, null, 2)}\n[End Inbound Metadata]`,
    );

    // Layer 6: Session context
    dynamicParts.push(
      `[Session Context]\nConversation ID: ${context.conversationId}\nMessage index: ${context.messageIndex}\n[End Session Context]`,
    );

    return [
      {
        type: "text",
        text: stablePrompt,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: dynamicParts.join("\n\n"),
      },
    ];
  }

  /**
   * Get layers 1-2 (identity + skills). Cached after first call.
   * Call invalidateCache() if brain files change at runtime.
   */
  private async getStablePrompt(): Promise<string> {
    if (!this.stablePromptCache) {
      // Try to include calendar context (graceful degradation)
      let calendarContext: string | undefined;
      try {
        const calendarConfig = loadCalendarConfig(this.config.agentDir);
        const credentials = loadCalendarCredentials(this.config.agentDir);
        if (calendarConfig && credentials) {
          const calendarRepo = await createCalDAVClient(
            calendarConfig,
            credentials,
          );
          calendarContext = await assembleCalendarContext(calendarRepo);
        }
      } catch {
        // Calendar unavailable — continue without it
      }

      this.stablePromptCache = await assembleSystemPrompt(
        this.config.brainDir,
        { calendarContext },
      );
    }
    return this.stablePromptCache;
  }

  /** Invalidate the cached stable prompt (call when brain files change). */
  invalidateCache(): void {
    this.stablePromptCache = null;
  }
}
```

### Step 4: Run tests to verify they pass

Run: `cd packages/dashboard && npx vitest run tests/system-prompt-builder.test.ts`
Expected: PASS (all 6 tests)

### Step 5: Run prettier

Run: `cd packages/dashboard && npx prettier --write src/agent/system-prompt-builder.ts tests/system-prompt-builder.test.ts`

### Step 6: Commit

```bash
git add packages/dashboard/src/agent/system-prompt-builder.ts packages/dashboard/tests/system-prompt-builder.test.ts
git commit -m "feat: add SystemPromptBuilder with 6-layer architecture and prompt caching

Layers 1-2 (identity + skills) cached with cache_control: ephemeral.
Layers 3-6 (state, memory, metadata, session) rebuilt every query.
Extracted from SessionManager for testability."
```

---

## Task 3: Unify SessionManager to single buildQuery path

Replace the two-branch `buildQuery()` (line 208-253 in `session-manager.ts`) with a single path that always passes both `resume` and `systemPrompt`. This is the core architectural change of M6.7.

**Current behavior (two branches):**
- Branch 1 (line 213-225): Has `sdkSessionId` → pass `resume` only, NO `systemPrompt`
- Branch 2 (line 228-252): No session → pass `systemPrompt` only, with inline context injection

**New behavior (single path):**
- Always build system prompt via `SystemPromptBuilder.build()`
- Always pass `systemPrompt` (fresh every query)
- Pass `resume` when `sdkSessionId` exists
- No context injection, no cold-start logic

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts` — rewrite constructor, doInitialize, buildQuery, streamMessage
- Modify: `packages/dashboard/src/agent/session-registry.ts` — simplify getOrCreate (remove context injection)
- Delete: `packages/dashboard/src/agent/context-builder.ts` — no longer needed

### Step 1: Rewrite session-manager.ts

Replace the full content of `packages/dashboard/src/agent/session-manager.ts`. Key changes:

**Constructor:**
```typescript
// OLD: constructor(conversationId?, contextInjection?, sdkSessionId?)
// NEW: constructor(conversationId, channel, sdkSessionId?)
constructor(
  conversationId: string,
  channel: string,
  sdkSessionId?: string | null,
) {
  this.conversationId = conversationId;
  this.channel = channel;
  this.sdkSessionId = sdkSessionId ?? null;
}
```

**Remove** `contextInjection` field entirely.

**Add** `channel` field and `messageIndex` counter.

**Add** `promptBuilder` field (SystemPromptBuilder), initialized in `doInitialize()`.

**doInitialize():**
- Keep: `loadConfig()`, `createHooks()`, MCP server check
- Remove: `assembleSystemPrompt()` call (moved to SystemPromptBuilder)
- Remove: Calendar assembly (moved to SystemPromptBuilder)
- Add: Create `SystemPromptBuilder` instance with `brainDir` + `agentDir`

**buildQuery() — single path:**
```typescript
private async buildQuery(
  content: string | ContentBlock[],
  model: string,
  reasoning: boolean | undefined,
): Query {
  this.messageIndex++;

  const systemPrompt = await this.promptBuilder!.build({
    channel: this.channel,
    conversationId: this.conversationId,
    messageIndex: this.messageIndex,
  });

  return createBrainQuery(content, {
    model,
    systemPrompt,           // Always included — fresh every query
    resume: this.sdkSessionId ?? undefined,  // Included when resuming
    includePartialMessages: true,
    reasoning,
    hooks: this.hooks ?? undefined,
    mcpServers: sharedMcpServers ?? undefined,
  });
}
```

**Note on systemPrompt type:** `createBrainQuery` in `packages/core/src/brain.ts:59` currently sets `queryOptions.systemPrompt = options.systemPrompt` which expects `string | undefined`. But SystemPromptBuilder returns `SystemPromptBlock[]` (array of content blocks with cache_control). We need to update `BrainSessionOptions.systemPrompt` to accept `string | SystemPromptBlock[]` and pass it through to the SDK. Check `@anthropic-ai/claude-agent-sdk` `Options.systemPrompt` type — the SDK accepts both strings and content block arrays.

**Update `packages/core/src/brain.ts`:**
- Change `BrainSessionOptions.systemPrompt` type from `string` to `string | SystemPromptBlock[]`
- No other changes needed — the SDK accepts content block arrays natively

**Update `packages/core/src/index.ts`:**
- Export the `SystemPromptBlock` type if needed, OR import it from dashboard's module

Actually, to keep the dependency clean (dashboard depends on core, not vice versa), define the block type in brain.ts:

```typescript
// In brain.ts, update the type:
export interface BrainSessionOptions {
  model: string;
  systemPrompt?: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  // ... rest unchanged
}
```

**streamMessage():**
- Remove the `model` parameter passthrough to `buildQuery` — that's fine, keep as-is
- The resume-failed-fallback logic (lines 170-198) stays — but now the fresh fallback also passes systemPrompt (since single path handles both cases)
- In the fallback, clear `sdkSessionId` to null, then `buildQuery()` naturally omits `resume`

### Step 2: Simplify session-registry.ts

Replace `packages/dashboard/src/agent/session-registry.ts`:

**Key changes:**
- `getOrCreate()` signature: `(conversationId: string, channel: string, sdkSessionId?: string | null)` — remove `manager: ConversationManager` dependency
- Remove `buildContextInjection` import and usage
- Remove `RECENT_TURNS_LIMIT` constant
- Remove conversation lookup and turn loading
- Simply create `new SessionManager(conversationId, channel, sdkSessionId)`

```typescript
async getOrCreate(
  conversationId: string,
  channel: string,
  sdkSessionId?: string | null,
): Promise<SessionManager> {
  if (this.sessions.has(conversationId)) {
    this.touchAccess(conversationId);
    return this.sessions.get(conversationId)!;
  }

  const session = new SessionManager(conversationId, channel, sdkSessionId);

  if (this.sessions.size >= this.maxSessions) {
    this.evictLRU();
  }

  this.sessions.set(conversationId, session);
  this.accessOrder.push(conversationId);
  return session;
}
```

### Step 3: Delete context-builder.ts

Run: `git rm packages/dashboard/src/agent/context-builder.ts`

This file (`buildContextInjection`, `formatTimeGap`) is no longer needed. The system prompt is rebuilt every query — no cold-start injection.

### Step 4: Update chat-handler.ts call sites

Search for all `sessionRegistry.getOrCreate(` calls in `chat-handler.ts`. Each currently passes `(conversationId, conversationManager, sdkSessionId)`. Update to `(conversationId, channel, sdkSessionId)`.

There are ~5 call sites (lines 500, 569, 627, 808, 981). For each:

```typescript
// OLD:
sessionManager = await sessionRegistry.getOrCreate(
  conversationId,
  conversationManager,
  conversation.sdkSessionId,  // or similar
);

// NEW:
sessionManager = await sessionRegistry.getOrCreate(
  conversationId,
  "web",  // channel — hardcoded for now, will be dynamic in S2
  sdkSessionId,
);
```

**Important:** For now, all dashboard chat-handler connections are web channel. Channel routing (WhatsApp → different conversation) comes in S2. Just pass `"web"` as the channel.

### Step 5: Update core package exports

In `packages/core/src/brain.ts`, update the `BrainSessionOptions.systemPrompt` type to accept content block arrays:

```typescript
export interface BrainSessionOptions {
  model: string
  systemPrompt?: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>
  // ... rest unchanged
}
```

Then rebuild core: `cd packages/core && npm run build`

### Step 6: Run TypeScript compilation

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: PASS (no type errors)

If there are errors from removed imports (e.g., `context-builder.ts` import in session-registry.ts), fix them.

### Step 7: Run existing tests

Run: `cd packages/dashboard && npx vitest run`
Expected: All tests pass. The existing `conversations.test.ts` should not be affected since it tests the conversation layer, not sessions.

### Step 8: Run prettier

Run: `cd packages/dashboard && npx prettier --write src/agent/session-manager.ts src/agent/session-registry.ts`
Run: `cd packages/core && npx prettier --write src/brain.ts`

### Step 9: Rebuild core package

Run: `cd packages/core && npm run build`

The dashboard imports from `@my-agent/core` which resolves to `packages/core/dist/`. After changing `brain.ts`, the core package must be rebuilt.

### Step 10: Manual smoke test

Run: `cd packages/dashboard && npm run dev`
- Open `http://localhost:4321`
- Send a message → verify response streams correctly
- Check server logs for `[SystemPromptBuilder]` log lines (add if missing)
- Send a second message → verify SDK session is resumed (log: `Resuming SDK session:`)
- Verify no `[SessionManager] Starting new SDK session` on second message (should resume)

### Step 11: Commit

```bash
git add packages/dashboard/src/agent/session-manager.ts packages/dashboard/src/agent/session-registry.ts packages/dashboard/src/ws/chat-handler.ts packages/core/src/brain.ts
git rm packages/dashboard/src/agent/context-builder.ts
git commit -m "feat: unify buildQuery to single path — always resume + systemPrompt

Remove two-branch split in SessionManager. System prompt rebuilt every
query via SystemPromptBuilder. Remove context-builder.ts (cold-start
injection no longer needed). SessionRegistry simplified — no context
injection, no ConversationManager dependency.

BREAKING: SessionManager constructor changes from
(conversationId, contextInjection, sdkSessionId) to
(conversationId, channel, sdkSessionId)."
```

---

## Sprint Verification Checklist

Before declaring S1 complete:

- [ ] `cd packages/core && npx tsc --noEmit` passes
- [ ] `cd packages/core && npm run build` succeeds
- [ ] `cd packages/dashboard && npx tsc --noEmit` passes
- [ ] `cd packages/dashboard && npx vitest run` passes (all tests)
- [ ] `cd packages/dashboard && npx prettier --check src/ public/` passes
- [ ] `context-builder.ts` is deleted
- [ ] SessionManager has ONE `buildQuery` method (no branches)
- [ ] System prompt is rebuilt on every query (check logs)
- [ ] SDK session resume works (check logs on second message)
- [ ] Resume-fail-fallback still works (clear session ID from DB, restart, verify fresh session starts)
- [ ] Design docs updated (conversation-system.md, channels.md, ROADMAP.md)

## Task Summary

| Task | What | Type | Est. Complexity |
|------|------|------|-----------------|
| 1 | Roadmap + Design Docs | Documentation | Medium (large text changes, but straightforward) |
| 2 | SystemPromptBuilder | New module + tests | Low (pure function, well-defined) |
| 3 | Unify SessionManager buildQuery | Refactor + integration | High (touches core flow, multiple call sites) |
