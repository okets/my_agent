# Conversation Nina — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the revised conversation lifecycle where Conversation Nina uses resumable SDK sessions with dynamic system prompt rebuild, unified channel routing, and browsable/resumable conversation management.

**Architecture:** Single `buildQuery()` path always passes both `resume` + `systemPrompt`. System prompt is rebuilt every query from 6 layers (identity, skills, state, memory, metadata, session) with prompt caching on stable layers. Channel routing separates owner messages (→ Conversation Nina) from external contacts (→ Working Agents). All conversations are either current (one) or inactive (resumable).

**Tech Stack:** TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Fastify, Alpine.js, SQLite, JSONL transcripts

**Design doc:** `docs/plans/2026-03-04-conversation-nina-design.md`

---

## Task 1: Update Roadmap & Design Docs

Bring all documentation in line with the approved design before any code changes. This is the foundation — every subsequent task references these docs.

**Files:**
- Modify: `docs/ROADMAP.md` — M6.7 description, M9 description, M6.6 sequencing, dependency notes
- Modify: `docs/design/conversation-system.md` — full rewrite
- Modify: `docs/design/channels.md` — update conversation continuity and per-contact scoping sections
- Update: Design Specs table in ROADMAP.md — link to new design doc

### Step 1: Update M6.7 in ROADMAP.md

Expand M6.7 description to include conversation architecture specifics from the approved design:

```markdown
### M6.7: Two-Agent Refactor — PLANNED

Return to the original design doc vision: Conversation Nina (brain) + Working Agents (folder-based sessions). Eliminates the inline TaskExecutor/TaskScheduler layer, replaces with folder-based working agents.

**Conversation Nina architecture (approved 2026-03-04):**

- **Resumable sessions with dynamic system prompt.** Every query passes both `resume` (SDK session ID) and `systemPrompt` (rebuilt fresh). Validated: SDK accepts both together — new system prompt applies on resume while preserving full conversation history.
- **6-layer system prompt:** Identity → Skills → Current State → Memory → Inbound Metadata → Session Context. Layers 1-2 cached with `cache_control: { type: "ephemeral" }`.
- **Single current conversation.** All others are inactive but resumable. No archive/read-only state.
- **Channel routing:** Owner → Conversation Nina (any channel). External contacts → Working Agents. Email is task submission, not a conversation channel.
- **New conversation triggers:** `/new`, Web→WhatsApp switch, idle timeout. WhatsApp→Web is NOT a new conversation (Web shows full transcript).
- **Working Agents unchanged.** Folder-as-context model retained — different problem, different solution.

**Design doc:** [plans/2026-03-04-conversation-nina-design.md](plans/2026-03-04-conversation-nina-design.md)
```

Add sprint structure (leave sprint scopes as TBD — will be planned in sprint breakdown):

```markdown
| Sprint | Name | Scope |
|--------|------|-------|
| S1 | System Prompt & Session Unification | system-prompt-builder.ts, buildQuery single-path, remove context-builder.ts |
| S2 | Conversation Lifecycle & Routing | current/inactive model, channel routing, conversation-router.ts |
| S3 | UI Rearrangement | Homepage inactive list, tab support, resume flow, channel badges |
| S4 | MCP Tools & E2E Validation | conversation_search, conversation_read, E2E tests, human-in-the-loop |
```

### Step 2: Update M9 in ROADMAP.md

Change M9 from "Email Channel" to "Email Integration" and clarify routing:

```markdown
### M9: Email Integration — PLANNED

Email inbox monitoring as task submission. Inbound emails are routed to Working Agents, not Conversation Nina. Email monitoring in "personal role" maps to a responsibility in `work-patterns.md`.

**Routing model:** Inbound email → task creation → Working Agent (per-task session). Owner never converses with Nina via email — email is async task submission.
```

Update deliverables to remove "thread management" (conversations don't span to email) and clarify dedicated vs personal role in terms of Working Agent routing.

### Step 3: Update M6.6 sequencing note

Add a note to M6.6 clarifying what M6.7 delivers vs what M6.6 owns:

```markdown
**Relationship to M6.7:** M6.7 delivers the 6-layer system prompt architecture and session unification. M6.6 builds on this by adding the work loop that populates `current-state.md` (layer 3) and daily summaries (layer 4). M6.6's "context refresher on resume" is superseded by M6.7's rebuild-every-query — the system prompt is always fresh.
```

Update M6.6 S1 scope: remove "context refresher on resume" (superseded by M6.7's rebuild-every-query). Replace with "validate system prompt layers 3-4 populated by work loop jobs."

### Step 4: Update Design Specs table

In the Design Specs table, update the Conversations row:

```markdown
| Conversations        | Revised  | M2, M6.7    | [design/conversation-system.md](design/conversation-system.md) + [plans/2026-03-04-conversation-nina-design.md](plans/2026-03-04-conversation-nina-design.md) |
```

Update the Two-Agent Refactor row:

```markdown
| Two-Agent Refactor   | Design   | M6.7        | [plans/2026-03-04-conversation-nina-design.md](plans/2026-03-04-conversation-nina-design.md) + [ideas/two-agent-architecture.md](ideas/two-agent-architecture.md) |
```

### Step 5: Update dependency graph notes

Replace line 720:
```markdown
**M6.7 implements conversation architecture.** Resumable sessions with dynamic system prompt, channel routing (owner → Conversation Nina, external → Working Agents), current/inactive conversation model. Design: `plans/2026-03-04-conversation-nina-design.md`.
```

### Step 6: Rewrite conversation-system.md

Full rewrite of `docs/design/conversation-system.md` to reflect:
- Current/inactive model (not created → active → idle → abbreviate)
- Resume + systemPrompt mechanics
- Channel badges in transcripts
- New conversation triggers (not per-channel creation)
- Browsable/resumable from UI (not archive)
- MCP tools for Nina to reference past conversations
- Remove cold-start fallback section entirely

Keep the terminology section (conversation, transcript, turn) and storage format (JSONL + SQLite) — those are unchanged.

### Step 7: Update channels.md

In `docs/design/channels.md`, update:
- **Conversation continuity section:** Remove "conversations do not span channels." Replace with the asymmetric rule (Web→WhatsApp = new, WhatsApp→Web = same).
- **Per-contact scoping:** Add note that per-contact scoping applies to Working Agents only. Conversation Nina has single-owner routing — no per-contact threads.
- **Email section:** Clarify email routes to Working Agents as task submission, not to Conversation Nina.

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

## Task 2: Create system-prompt-builder.ts

Extract system prompt assembly into a dedicated, testable module. This replaces the scattered prompt logic in `session-manager.ts:doInitialize()` and `buildQuery()`.

**Files:**
- Create: `packages/dashboard/src/agent/system-prompt-builder.ts`
- Test: `packages/dashboard/tests/agent/system-prompt-builder.test.ts`
- Reference: `packages/core/src/prompt.ts:389-482` (existing `assembleSystemPrompt`)

### Step 1: Write failing tests

```typescript
// packages/dashboard/tests/agent/system-prompt-builder.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SystemPromptBuilder } from "../../src/agent/system-prompt-builder.js";

describe("SystemPromptBuilder", () => {
  let builder: SystemPromptBuilder;

  beforeEach(() => {
    builder = new SystemPromptBuilder({
      brainDir: "/tmp/test-brain",
      agentDir: "/tmp/test-agent",
    });
  });

  it("returns system prompt as array with cache_control on stable layers", async () => {
    const result = await builder.build({
      channel: "web",
      conversationId: "conv-test",
      messageIndex: 1,
    });

    // Result should be an array of content blocks (for cache_control support)
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(2);

    // First block (identity + skills) should have cache_control
    expect(result[0].cache_control).toEqual({ type: "ephemeral" });

    // Last block (dynamic layers) should NOT have cache_control
    const lastBlock = result[result.length - 1];
    expect(lastBlock.cache_control).toBeUndefined();
  });

  it("includes inbound metadata as JSON", async () => {
    const result = await builder.build({
      channel: "whatsapp",
      conversationId: "conv-123",
      messageIndex: 5,
    });

    const fullText = result.map((b) => b.text).join("\n");
    expect(fullText).toContain('"channel": "whatsapp"');
    expect(fullText).toContain('"conversation_id": "conv-123"');
    expect(fullText).toContain('"message_index": 5');
  });

  it("includes conversation ID in session context", async () => {
    const result = await builder.build({
      channel: "web",
      conversationId: "conv-abc",
      messageIndex: 3,
    });

    const fullText = result.map((b) => b.text).join("\n");
    expect(fullText).toContain("conv-abc");
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd packages/dashboard && npx vitest run tests/agent/system-prompt-builder.test.ts`
Expected: FAIL — module does not exist

### Step 3: Write the implementation

```typescript
// packages/dashboard/src/agent/system-prompt-builder.ts
import {
  assembleSystemPrompt,
  loadConfig,
  createHooks,
  loadCalendarConfig,
  loadCalendarCredentials,
  createCalDAVClient,
  assembleCalendarContext,
} from "@my-agent/core";
import type { HookEvent, HookCallbackMatcher } from "@my-agent/core";

interface BuilderConfig {
  brainDir: string;
  agentDir: string;
}

interface BuildContext {
  channel: string;
  conversationId: string;
  messageIndex: number;
  hasPendingEscalations?: boolean;
  activeWorkingAgents?: string[];
}

interface SystemPromptBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export class SystemPromptBuilder {
  private config: BuilderConfig;
  private basePromptCache: string | null = null;

  constructor(config: BuilderConfig) {
    this.config = config;
  }

  /**
   * Build the full system prompt as an array of content blocks.
   * Layers 1-2 (identity + skills) are cached. Layers 3-6 are dynamic.
   */
  async build(context: BuildContext): Promise<SystemPromptBlock[]> {
    // Layer 1-2: Identity + Skills (stable, cached)
    const stablePrompt = await this.getStablePrompt();

    // Layers 3-6: Dynamic context
    const dynamicParts: string[] = [];

    // Layer 3: Current state (tasks, calendar, escalations)
    // Populated by work loop in M6.6 — placeholder for now
    const now = new Date();
    dynamicParts.push(
      `[Current State]\nTimestamp: ${now.toISOString()}\n[End Current State]`,
    );

    // Layer 4: Memory context
    // Daily summary loaded by assembleSystemPrompt above; MCP memory handles retrievals at runtime

    // Layer 5: Inbound metadata
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
   * Call invalidateCache() if brain files change.
   */
  private async getStablePrompt(): Promise<string> {
    if (!this.basePromptCache) {
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

      this.basePromptCache = await assembleSystemPrompt(
        this.config.brainDir,
        { calendarContext },
      );
    }
    return this.basePromptCache;
  }

  /** Invalidate the cached stable prompt (call when brain files change). */
  invalidateCache(): void {
    this.basePromptCache = null;
  }
}
```

### Step 4: Run tests to verify they pass

Run: `cd packages/dashboard && npx vitest run tests/agent/system-prompt-builder.test.ts`
Expected: PASS (may need to mock `assembleSystemPrompt` — adjust test setup if core import fails in test env)

### Step 5: Commit

```bash
git add packages/dashboard/src/agent/system-prompt-builder.ts packages/dashboard/tests/agent/system-prompt-builder.test.ts
git commit -m "feat: add SystemPromptBuilder with 6-layer architecture and prompt caching

Layers 1-2 (identity + skills) cached with cache_control: ephemeral.
Layers 3-6 (state, memory, metadata, session) rebuilt every query.
Extracted from SessionManager for testability."
```

---

## Task 3: Unify SessionManager buildQuery to single path

Remove the two-branch split in `buildQuery()`. Always pass both `resume` and `systemPrompt`.

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts:48-261`
- Remove: `packages/dashboard/src/agent/context-builder.ts`
- Test: `packages/dashboard/tests/agent/session-manager.test.ts`

### Step 1: Write failing test

```typescript
// Test that buildQuery always includes systemPrompt, even on resume
describe("SessionManager.buildQuery", () => {
  it("passes both resume and systemPrompt when session ID exists", async () => {
    // Create a SessionManager with an existing SDK session ID
    const sm = new SessionManager("conv-test", null, "existing-session-id");
    // After initialization, buildQuery should pass both resume AND systemPrompt
    // (implementation detail — verify via spy on createBrainQuery)
  });
});
```

### Step 2: Rewrite SessionManager

Key changes to `session-manager.ts`:

1. **Replace constructor params:** Remove `contextInjection`. Add `channel`.
2. **Replace `doInitialize()`:** Use `SystemPromptBuilder` instead of direct `assembleSystemPrompt` call. Remove calendar assembly (moved to builder).
3. **Replace `buildQuery()`:** Single path — always build system prompt via `SystemPromptBuilder.build()`, always pass `resume` + `systemPrompt`.
4. **Update `streamMessage()`:** Pass channel and message index to builder context.

```typescript
// New buildQuery — SINGLE PATH
private async buildQuery(
  content: string | ContentBlock[],
  model: string,
  reasoning: boolean | undefined,
  context: { channel: string; messageIndex: number },
): Query {
  const systemPrompt = await this.promptBuilder.build({
    channel: context.channel,
    conversationId: this.conversationId!,
    messageIndex: context.messageIndex,
  });

  return createBrainQuery(content, {
    model,
    systemPrompt,  // Always included — fresh every query
    resume: this.sdkSessionId ?? undefined,  // Included when resuming
    includePartialMessages: true,
    reasoning,
    hooks: this.hooks ?? undefined,
    mcpServers: sharedMcpServers ?? undefined,
  });
}
```

5. **Delete `context-builder.ts`:** No longer needed — no cold-start injection.

### Step 3: Update session-registry.ts

Remove cold-start context injection from `getOrCreate()`:

```typescript
// OLD (lines 48-68): Load recent turns, build context injection
// NEW: Just create SessionManager — no context injection needed
getOrCreate(conversationId: string, channel: string, sdkSessionId?: string | null): SessionManager {
  const cached = this.sessions.get(conversationId);
  if (cached) {
    this.touchAccess(conversationId);
    return cached;
  }

  const session = new SessionManager(conversationId, channel, sdkSessionId);
  this.sessions.set(conversationId, session);
  this.touchAccess(conversationId);
  this.evictLRU();
  return session;
}
```

### Step 4: Run tests, verify pass

Run: `cd packages/dashboard && npx vitest run`
Expected: All existing + new tests pass

### Step 5: Commit

```bash
git add packages/dashboard/src/agent/session-manager.ts packages/dashboard/src/agent/session-registry.ts
git rm packages/dashboard/src/agent/context-builder.ts
git commit -m "feat: unify buildQuery to single path — always resume + systemPrompt

Remove two-branch split. System prompt rebuilt every query via
SystemPromptBuilder. Remove context-builder.ts (cold-start injection
no longer needed). SessionRegistry simplified — no context injection."
```

---

## Task 4: Add conversation status model (current/inactive)

Add status field to conversations and swap logic.

**Files:**
- Modify: `packages/dashboard/src/conversations/types.ts:11-58`
- Modify: `packages/dashboard/src/conversations/conversation-manager.ts`
- Modify: `packages/dashboard/src/conversations/storage.ts` (schema migration)
- Test: `packages/dashboard/tests/conversations/status.test.ts`

### Step 1: Write failing tests

```typescript
describe("Conversation status", () => {
  it("new conversation is created as current", () => {
    // Create conversation → status should be "current"
  });

  it("only one conversation can be current at a time", () => {
    // Create conv A (current), create conv B (current)
    // Conv A should become inactive
  });

  it("resuming inactive conversation swaps status", () => {
    // Conv A (current), Conv B (inactive)
    // Resume Conv B → Conv B becomes current, Conv A becomes inactive
  });
});
```

### Step 2: Add status to types

In `types.ts`, add to `Conversation` interface:

```typescript
/** Whether this is the active conversation or a parked one */
status: "current" | "inactive";
```

### Step 3: Add schema migration

In `storage.ts`, add migration:

```sql
ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive';
```

### Step 4: Add swap logic to ConversationManager

```typescript
/** Make a conversation current. Previous current becomes inactive. */
async makeCurrent(conversationId: string): Promise<void> {
  // Set all conversations to inactive
  this.db.run("UPDATE conversations SET status = 'inactive' WHERE status = 'current'");
  // Set target to current
  this.db.run("UPDATE conversations SET status = 'current' WHERE id = ?", conversationId);
}
```

### Step 5: Run tests, verify pass, commit

```bash
git add packages/dashboard/src/conversations/types.ts packages/dashboard/src/conversations/conversation-manager.ts packages/dashboard/src/conversations/storage.ts packages/dashboard/tests/conversations/status.test.ts
git commit -m "feat: add current/inactive conversation status model

Only one conversation can be current. Resume swaps status.
Schema migration adds status column."
```

---

## Task 5: Implement conversation-router.ts

Channel-aware routing: detect owner vs external, detect Web→WhatsApp switches.

**Files:**
- Create: `packages/dashboard/src/agent/conversation-router.ts`
- Test: `packages/dashboard/tests/agent/conversation-router.test.ts`

### Step 1: Write failing tests

```typescript
describe("ConversationRouter", () => {
  it("routes owner WhatsApp message to Conversation Nina", () => {
    const result = router.route({ channel: "whatsapp", sender: ownerNumber });
    expect(result.target).toBe("conversation-nina");
  });

  it("routes external WhatsApp message to working agent", () => {
    const result = router.route({ channel: "whatsapp", sender: otherNumber });
    expect(result.target).toBe("working-agent");
  });

  it("detects Web→WhatsApp switch as new conversation", () => {
    router.setCurrentChannel("web");
    const result = router.route({ channel: "whatsapp", sender: ownerNumber });
    expect(result.newConversation).toBe(true);
  });

  it("does NOT detect WhatsApp→Web as new conversation", () => {
    router.setCurrentChannel("whatsapp");
    const result = router.route({ channel: "web", sender: ownerNumber });
    expect(result.newConversation).toBe(false);
  });
});
```

### Step 2: Implement

```typescript
// packages/dashboard/src/agent/conversation-router.ts
export interface RouteResult {
  target: "conversation-nina" | "working-agent";
  newConversation: boolean;
  channel: string;
}

export class ConversationRouter {
  private ownerIdentifiers: Set<string>;
  private currentChannel: string | null = null;

  constructor(ownerIdentifiers: string[]) {
    this.ownerIdentifiers = new Set(ownerIdentifiers);
  }

  setCurrentChannel(channel: string): void {
    this.currentChannel = channel;
  }

  route(message: { channel: string; sender: string }): RouteResult {
    const isOwner = this.ownerIdentifiers.has(message.sender);

    if (!isOwner) {
      return { target: "working-agent", newConversation: false, channel: message.channel };
    }

    // Owner message — detect channel switch
    const isWebToWhatsApp =
      this.currentChannel === "web" && message.channel === "whatsapp";

    this.currentChannel = message.channel;

    return {
      target: "conversation-nina",
      newConversation: isWebToWhatsApp,
      channel: message.channel,
    };
  }
}
```

### Step 3: Run tests, verify pass, commit

```bash
git add packages/dashboard/src/agent/conversation-router.ts packages/dashboard/tests/agent/conversation-router.test.ts
git commit -m "feat: add ConversationRouter for owner/external routing

Detects owner vs external contacts. Web→WhatsApp triggers new
conversation. WhatsApp→Web continues same conversation."
```

---

## Task 6: Wire chat-handler.ts to new architecture

Connect the new components (SystemPromptBuilder, ConversationRouter, status model) into the existing WebSocket chat handler.

**Files:**
- Modify: `packages/dashboard/src/ws/chat-handler.ts`
- Modify: `packages/dashboard/src/index.ts` (initialization)

### Step 1: Update index.ts initialization

Add SystemPromptBuilder and ConversationRouter initialization alongside existing setup.

### Step 2: Update chat-handler message flow

Replace context injection logic with:
1. Route message through ConversationRouter
2. If `newConversation` → call `conversationManager.makeCurrent(newId)`
3. Get/create SessionManager via registry (no context injection)
4. SessionManager.streamMessage passes channel + messageIndex to builder

### Step 3: Remove context injection references

Remove all references to `buildContextInjection`, `contextInjection` parameter, `context-builder` imports.

### Step 4: Test manually

Run: `cd packages/dashboard && npm run dev`
- Send a message → verify response streams correctly
- Check server logs for `[SystemPromptBuilder]` and `[SessionManager]` messages
- Verify SDK session ID captured on first message and reused on second

### Step 5: Commit

```bash
git add packages/dashboard/src/ws/chat-handler.ts packages/dashboard/src/index.ts
git commit -m "feat: wire chat-handler to new session architecture

Route through ConversationRouter, use SystemPromptBuilder for
system prompt, single buildQuery path. Remove context injection."
```

---

## Task 7: Add channel badges to transcripts

Store channel origin per message and expose via WebSocket.

**Files:**
- Modify: `packages/dashboard/src/conversations/types.ts` — `channel` field already exists on `TranscriptTurn`
- Modify: chat-handler.ts — pass channel when writing transcript turns
- Modify: `packages/dashboard/public/js/app.js` — render channel badge

### Step 1: Verify channel field exists on TranscriptTurn

Check `types.ts:89` — `channel?: string` already exists. Just ensure it's populated.

### Step 2: Populate channel on every transcript write

In chat-handler, when writing user turns to transcript, include `channel: currentChannel`.

### Step 3: Render badge in UI

In `app.js`, add channel badge rendering to message template:

```html
<template x-if="msg.channel && msg.channel !== 'web'">
  <span class="text-[9px] px-1 py-px rounded bg-blue-500/15 text-blue-400 ml-1"
        x-text="msg.channel === 'whatsapp' ? '📱 WhatsApp' : msg.channel">
  </span>
</template>
```

### Step 4: Test, commit

```bash
git add packages/dashboard/src/conversations/types.ts packages/dashboard/src/ws/chat-handler.ts packages/dashboard/public/js/app.js
git commit -m "feat: add channel badges to transcript messages

Store channel origin per turn. Render badge in chat UI for
non-web messages (WhatsApp, future channels)."
```

---

## Task 8: Rearrange UI — homepage inactive list + tabs

Restructure the Web UI to show inactive conversations on the homepage and support tabs.

**Files:**
- Modify: `packages/dashboard/public/index.html` — homepage layout, tab container
- Modify: `packages/dashboard/public/js/app.js` — tab state management, resume flow
- Modify: `packages/dashboard/public/js/ws-client.js` — conversation status sync
- Modify: `packages/dashboard/public/css/app.css` — tab styles

### Step 1: Add conversation status to Alpine store

In `ws-client.js`, ensure `state:conversations` updates include status field. In `app.js`, add computed properties for current vs inactive.

### Step 2: Build homepage inactive conversation list

Glass panel on homepage showing inactive conversations:
- Date, summary snippet, channel badges, message count
- Click → opens in read-only tab
- "Resume" button on each

### Step 3: Add tab support

Tab bar above chat panel. Current conversation is always the first tab. Inactive conversations opened from homepage appear as additional tabs. Each tab shows full transcript (read-only for inactive).

### Step 4: Implement resume flow

"Resume" button → WebSocket message `conversation:resume` → server swaps status → client updates stores → tab becomes current.

### Step 5: Test manually

- Open dashboard → see inactive conversations on homepage
- Click one → opens in tab
- Click "Resume" → becomes current, previous goes to homepage
- Send `/new` → current becomes inactive, new conversation starts

### Step 6: Commit

```bash
git add packages/dashboard/public/index.html packages/dashboard/public/js/app.js packages/dashboard/public/js/ws-client.js packages/dashboard/public/css/app.css
git commit -m "feat: homepage inactive conversations + tab support

Inactive conversations shown on homepage. Open in tabs for
reading/referencing. Resume button swaps current/inactive."
```

---

## Task 9: Add MCP conversation tools

Create MCP server with `conversation_search` and `conversation_read` tools so Nina can reference past conversations.

**Files:**
- Create: `packages/core/src/mcp/conversation-server.ts`
- Modify: `packages/core/src/index.ts` — export new server
- Modify: `packages/dashboard/src/agent/session-manager.ts` — add to `sharedMcpServers`
- Test: `packages/core/tests/mcp/conversation-server.test.ts`

### Step 1: Write failing tests

```typescript
describe("conversation MCP tools", () => {
  it("conversation_search returns matching conversations", async () => {
    // Search for "deployment" → returns conversations containing that term
  });

  it("conversation_read returns full transcript", async () => {
    // Read conv-123 → returns all turns with timestamps and channel badges
  });
});
```

### Step 2: Implement conversation-server.ts

Two tools:
- `conversation_search` — takes `query: string`, searches conversation summaries and transcript content via SQLite FTS or keyword match
- `conversation_read` — takes `conversationId: string`, returns full transcript as formatted text

### Step 3: Wire into SessionManager

In `initMcpServers()`, add conversation server alongside memory server:

```typescript
const conversationServer = createConversationServer({ conversationManager, transcriptManager });
sharedMcpServers = { memory: memoryServer, conversations: conversationServer };
```

### Step 4: Run tests, verify pass, commit

```bash
git add packages/core/src/mcp/conversation-server.ts packages/core/src/index.ts packages/core/tests/mcp/conversation-server.test.ts packages/dashboard/src/agent/session-manager.ts
git commit -m "feat: add conversation MCP tools (search + read)

Nina can search past conversations by keyword/semantic match
and read full transcripts. Wired into brain's MCP servers."
```

---

## Task 10: E2E Validation & Human-in-the-Loop Test

Validate the complete flow end-to-end.

**Files:**
- Create: `packages/dashboard/tests/e2e/conversation-lifecycle.test.ts`

### Step 1: Automated E2E tests

```typescript
describe("Conversation lifecycle E2E", () => {
  it("new conversation starts as current", async () => {});
  it("/new creates new current, previous becomes inactive", async () => {});
  it("resume makes inactive conversation current", async () => {});
  it("system prompt is rebuilt on every message", async () => {});
  it("SDK session is resumed with new system prompt", async () => {});
  it("channel badge is stored in transcript", async () => {});
  it("conversation_search finds past conversations", async () => {});
  it("conversation_read returns full transcript", async () => {});
});
```

### Step 2: Human-in-the-loop test scenarios

**Scenario 1: Daily flow**
1. Open web UI → send "Good morning" → verify response
2. Send `/new` → verify new conversation, old one in homepage
3. Chat about a topic → verify continuity
4. Open old conversation in tab → verify readable
5. Click "Resume" on old conversation → verify swap

**Scenario 2: Channel badge verification**
1. Send message from web UI → no badge
2. (If WhatsApp available) Send from WhatsApp → verify badge appears in web UI transcript

**Scenario 3: Nina references past conversation**
1. Have a conversation about topic X
2. Send `/new`
3. Ask "What did we discuss about X?" → verify Nina uses conversation tools to find and reference it

### Step 3: Run full test suite, fix failures, commit

```bash
git add packages/dashboard/tests/e2e/conversation-lifecycle.test.ts
git commit -m "test: add E2E tests for conversation lifecycle

Covers: current/inactive model, /new, resume, channel badges,
system prompt rebuild, MCP conversation tools."
```

---

## Task Summary

| Task | Component | Type |
|------|-----------|------|
| 1 | Roadmap + Design Docs | Documentation |
| 2 | SystemPromptBuilder | New module |
| 3 | SessionManager unification | Refactor |
| 4 | Conversation status model | Data model |
| 5 | ConversationRouter | New module |
| 6 | Wire chat-handler | Integration |
| 7 | Channel badges | Feature |
| 8 | UI rearrangement | Frontend |
| 9 | MCP conversation tools | Feature |
| 10 | E2E validation | Testing |

**Sprint mapping suggestion (from M6.7 design):**

| Sprint | Tasks |
|--------|-------|
| S1: System Prompt & Session Unification | Tasks 1, 2, 3 |
| S2: Conversation Lifecycle & Routing | Tasks 4, 5, 6 |
| S3: UI Rearrangement | Tasks 7, 8 |
| S4: MCP Tools & E2E Validation | Tasks 9, 10 |
