# M6.7-S2: Conversation Lifecycle — Sprint Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add current/inactive conversation status model, ConversationRouter for owner/external routing with channel-switch detection, and wire into chat-handler and message-handler.

**Architecture:** Conversations gain a `status` column (`current`/`inactive`). Only one conversation can be `current` at a time — creating or resuming swaps status. ConversationRouter determines whether an incoming message should target Conversation Nina or a Working Agent, and detects Web-to-WhatsApp switches that trigger new conversations. Chat-handler and message-handler are updated to use these new components.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Vitest

**Design doc:** `docs/plans/2026-03-04-conversation-nina-design.md` (Section 1: Conversation Lifecycle, Section 2: Channel Routing)

**Depends on:** M6.7-S1 (SystemPromptBuilder + unified buildQuery) — Complete

---

## Task 1: Add conversation status model (current/inactive)

Add a `status` field to conversations. Only one conversation can be `current` at a time. Creating a new conversation or resuming an inactive one swaps the status.

**Files:**
- Modify: `packages/dashboard/src/conversations/types.ts` — add `status` field
- Modify: `packages/dashboard/src/conversations/db.ts` — migration + swap logic
- Modify: `packages/dashboard/src/conversations/manager.ts` — `makeCurrent()` method
- Test: `packages/dashboard/tests/conversation-status.test.ts`

### Step 1: Write failing tests

Create `packages/dashboard/tests/conversation-status.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationManager } from "../src/conversations/manager.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Conversation status model", () => {
  let manager: ConversationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-status-"));
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
    manager = new ConversationManager(tmpDir);
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("new conversation is created as current", async () => {
    const conv = await manager.create("web");
    expect(conv.status).toBe("current");
  });

  it("only one conversation can be current at a time", async () => {
    const convA = await manager.create("web");
    expect(convA.status).toBe("current");

    const convB = await manager.create("web");
    expect(convB.status).toBe("current");

    // Conv A should now be inactive
    const reloadedA = await manager.get(convA.id);
    expect(reloadedA!.status).toBe("inactive");
  });

  it("makeCurrent swaps status", async () => {
    const convA = await manager.create("web");
    const convB = await manager.create("web");

    // B is current, A is inactive
    expect((await manager.get(convB.id))!.status).toBe("current");
    expect((await manager.get(convA.id))!.status).toBe("inactive");

    // Resume A
    await manager.makeCurrent(convA.id);

    expect((await manager.get(convA.id))!.status).toBe("current");
    expect((await manager.get(convB.id))!.status).toBe("inactive");
  });

  it("getCurrent returns the current conversation", async () => {
    await manager.create("web");
    const convB = await manager.create("web");

    const current = await manager.getCurrent();
    expect(current).not.toBeNull();
    expect(current!.id).toBe(convB.id);
  });

  it("getCurrent returns null when no conversations exist", async () => {
    const current = await manager.getCurrent();
    expect(current).toBeNull();
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd packages/dashboard && npx vitest run tests/conversation-status.test.ts`
Expected: FAIL — `status` property doesn't exist, `makeCurrent` not a function

### Step 3: Add status to Conversation type

In `packages/dashboard/src/conversations/types.ts`, add to `Conversation` interface after `isPinned`:

```typescript
  /** Conversation lifecycle status: one current, rest inactive */
  status: "current" | "inactive";
```

### Step 4: Add DB migration and swap methods

In `packages/dashboard/src/conversations/db.ts`:

1. Add migration in `initialize()` after the `is_pinned` migration block:

```typescript
    if (!columns.some((c) => c.name === "status")) {
      this.db.exec(
        "ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive'",
      );
      // Mark the most recently updated conversation as current
      this.db.exec(`
        UPDATE conversations SET status = 'current'
        WHERE id = (SELECT id FROM conversations ORDER BY updated DESC LIMIT 1)
      `);
    }
```

2. Add `makeCurrent()` method to `ConversationDatabase`:

```typescript
  /**
   * Make a conversation current. All others become inactive.
   * Uses a transaction for atomicity.
   */
  makeCurrent(conversationId: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare(
        "UPDATE conversations SET status = 'inactive' WHERE status = 'current'"
      ).run();
      this.db.prepare(
        "UPDATE conversations SET status = 'current' WHERE id = ?"
      ).run(conversationId);
    });
    transaction();
  }

  /**
   * Get the current conversation (status = 'current')
   */
  getCurrent(): Conversation | null {
    const stmt = this.db.prepare(
      "SELECT * FROM conversations WHERE status = 'current' LIMIT 1"
    );
    const row = stmt.get() as any;
    return row ? this.rowToConversation(row) : null;
  }
```

3. Update `rowToConversation()` — add `status` field:

```typescript
      status: (row.status as "current" | "inactive") ?? "inactive",
```

4. Update `insertConversation()` — add `status` to INSERT:
   - Add `status` to the column list and values
   - Pass `conversation.status` as value

5. Update `updateConversation()` — add `status` to the update handler:

```typescript
    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }
```

### Step 5: Add makeCurrent and getCurrent to ConversationManager

In `packages/dashboard/src/conversations/manager.ts`:

1. Update `create()` — before inserting the new conversation, demote current:

```typescript
    // Demote current conversation before creating new one
    const currentConv = this.db.getCurrent();
    if (currentConv) {
      this.db.updateConversation(currentConv.id, { status: "inactive" });
    }
```

And set `status: "current"` on the new conversation object.

2. Add `makeCurrent()`:

```typescript
  /**
   * Make a conversation current. Previous current becomes inactive.
   */
  async makeCurrent(conversationId: string): Promise<void> {
    this.db.makeCurrent(conversationId);
  }
```

3. Add `getCurrent()`:

```typescript
  /**
   * Get the current conversation
   */
  async getCurrent(): Promise<Conversation | null> {
    return this.db.getCurrent();
  }
```

### Step 6: Run tests to verify they pass

Run: `cd packages/dashboard && npx vitest run tests/conversation-status.test.ts`
Expected: PASS (5/5)

### Step 7: Type-check

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean (may need to add `status` to any place that constructs a Conversation literal)

### Step 8: Commit

```
git add packages/dashboard/src/conversations/types.ts packages/dashboard/src/conversations/db.ts packages/dashboard/src/conversations/manager.ts packages/dashboard/tests/conversation-status.test.ts
git commit -m "feat: add current/inactive conversation status model

Only one conversation can be current at a time. Creating a new
conversation demotes the previous current. makeCurrent() swaps
status atomically. Schema migration adds status column."
```

---

## Task 2: Create ConversationRouter

Channel-aware routing that determines:
1. Whether a message goes to Conversation Nina (owner) or Working Agent (external)
2. Whether a channel switch triggers a new conversation (Web to WhatsApp = yes, WhatsApp to Web = no)

**Files:**
- Create: `packages/dashboard/src/agent/conversation-router.ts`
- Test: `packages/dashboard/tests/conversation-router.test.ts`

### Step 1: Write failing tests

Create `packages/dashboard/tests/conversation-router.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { ConversationRouter } from "../src/agent/conversation-router.js";

describe("ConversationRouter", () => {
  let router: ConversationRouter;

  beforeEach(() => {
    router = new ConversationRouter(["owner@example.com", "+1555000000"]);
  });

  describe("owner vs external routing", () => {
    it("routes owner message to conversation-nina", () => {
      const result = router.route({ channel: "web", sender: "owner@example.com" });
      expect(result.target).toBe("conversation-nina");
    });

    it("routes owner message from any registered identity", () => {
      const result = router.route({ channel: "whatsapp", sender: "+1555000000" });
      expect(result.target).toBe("conversation-nina");
    });

    it("routes external message to working-agent", () => {
      const result = router.route({ channel: "whatsapp", sender: "+9876543210" });
      expect(result.target).toBe("working-agent");
    });

    it("routes unknown sender to working-agent", () => {
      const result = router.route({ channel: "web", sender: "stranger@test.com" });
      expect(result.target).toBe("working-agent");
    });
  });

  describe("channel switch detection", () => {
    it("detects Web to WhatsApp as new conversation", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      const result = router.route({ channel: "whatsapp", sender: "+1555000000" });
      expect(result.newConversation).toBe(true);
    });

    it("does NOT detect WhatsApp to Web as new conversation", () => {
      router.route({ channel: "whatsapp", sender: "+1555000000" });
      const result = router.route({ channel: "web", sender: "owner@example.com" });
      expect(result.newConversation).toBe(false);
    });

    it("first message is never a new conversation trigger", () => {
      const result = router.route({ channel: "whatsapp", sender: "+1555000000" });
      expect(result.newConversation).toBe(false);
    });

    it("same channel is not a new conversation trigger", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      const result = router.route({ channel: "web", sender: "owner@example.com" });
      expect(result.newConversation).toBe(false);
    });

    it("external messages do not trigger new conversation", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      const result = router.route({ channel: "whatsapp", sender: "+9876543210" });
      expect(result.newConversation).toBe(false);
    });
  });

  describe("getCurrentChannel", () => {
    it("returns null before any messages", () => {
      expect(router.getCurrentChannel()).toBeNull();
    });

    it("tracks the current channel after owner messages", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      expect(router.getCurrentChannel()).toBe("web");

      router.route({ channel: "whatsapp", sender: "+1555000000" });
      expect(router.getCurrentChannel()).toBe("whatsapp");
    });

    it("does not update channel on external messages", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      router.route({ channel: "whatsapp", sender: "+9876543210" });
      expect(router.getCurrentChannel()).toBe("web");
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd packages/dashboard && npx vitest run tests/conversation-router.test.ts`
Expected: FAIL — module does not exist

### Step 3: Implement ConversationRouter

Create `packages/dashboard/src/agent/conversation-router.ts`:

```typescript
/**
 * Conversation Router
 *
 * Determines routing for incoming messages:
 * - Owner messages go to Conversation Nina
 * - External messages go to Working Agent
 *
 * Detects channel switches that trigger new conversations:
 * - Web to WhatsApp = new conversation (user changing contexts)
 * - WhatsApp to Web = same conversation (web shows full transcript)
 */

export interface RouteResult {
  /** Where this message should be routed */
  target: "conversation-nina" | "working-agent";
  /** Whether this message should trigger a new conversation */
  newConversation: boolean;
  /** The channel the message came from */
  channel: string;
}

export class ConversationRouter {
  private ownerIdentifiers: Set<string>;
  private currentChannel: string | null = null;

  constructor(ownerIdentifiers: string[]) {
    this.ownerIdentifiers = new Set(
      ownerIdentifiers.map((id) => id.toLowerCase()),
    );
  }

  /**
   * Route an incoming message.
   *
   * Channel switch detection rules:
   * - Web to WhatsApp: new conversation (user moved to phone)
   * - WhatsApp to Web: NOT new (web UI shows full transcript)
   * - Same channel: NOT new
   * - External messages: never trigger new conversation
   */
  route(message: { channel: string; sender: string }): RouteResult {
    const isOwner = this.ownerIdentifiers.has(message.sender.toLowerCase());

    if (!isOwner) {
      return {
        target: "working-agent",
        newConversation: false,
        channel: message.channel,
      };
    }

    // Owner message — check for channel switch
    const previousChannel = this.currentChannel;
    this.currentChannel = message.channel;

    // Web to non-web = new conversation
    const isNewConversation =
      previousChannel !== null &&
      previousChannel === "web" &&
      message.channel !== "web";

    return {
      target: "conversation-nina",
      newConversation: isNewConversation,
      channel: message.channel,
    };
  }

  /**
   * Get the current channel (last channel an owner message came from).
   * Returns null if no owner messages received yet.
   */
  getCurrentChannel(): string | null {
    return this.currentChannel;
  }
}
```

### Step 4: Run tests to verify they pass

Run: `cd packages/dashboard && npx vitest run tests/conversation-router.test.ts`
Expected: PASS (10/10)

### Step 5: Commit

```
git add packages/dashboard/src/agent/conversation-router.ts packages/dashboard/tests/conversation-router.test.ts
git commit -m "feat: add ConversationRouter for owner/external routing

Routes owner messages to Conversation Nina, external to Working Agents.
Detects Web to WhatsApp switch as new conversation trigger.
WhatsApp to Web is NOT a new conversation (web shows full transcript)."
```

---

## Task 3: Wire status model + router into chat-handler and message-handler

Connect the new status model and ConversationRouter into the existing WebSocket handler and channel message handler. This replaces the current "most recent" conversation lookup with status-aware routing.

**Files:**
- Modify: `packages/dashboard/src/ws/chat-handler.ts` — status-aware conversation management
- Modify: `packages/dashboard/src/channels/message-handler.ts` — use ConversationRouter
- Modify: `packages/dashboard/src/ws/protocol.ts` — add `status` to ConversationMeta
- Test: Existing tests + manual verification

### Step 1: Update protocol.ts

In `packages/dashboard/src/ws/protocol.ts`, add `status` to the `ConversationMeta` type:

```typescript
  status: "current" | "inactive";
```

### Step 2: Update chat-handler.ts

**2a. Update `toConversationMeta()`** to include `status`:

```typescript
  status: conv.status,
```

**2b. Update `handleConnect()`:**

Replace:
```typescript
      // Load most recent web conversation
      conversation = await conversationManager.getMostRecent("web");
```

With:
```typescript
      // Load the current conversation
      conversation = await conversationManager.getCurrent();
```

**2c. Update `handleSwitchConversation()`:**

After loading the conversation, call `makeCurrent`:

```typescript
      // Make this the current conversation
      await conversationManager.makeCurrent(conversationId);
```

**2d. handleNewConversation and /new command in handleChatMessage:**

The `create()` method already handles demoting the current conversation.
No additional changes needed beyond what `create()` does.

### Step 3: Update message-handler.ts

**3a. Add ConversationRouter to MessageHandlerDeps:**

```typescript
interface MessageHandlerDeps {
  // ... existing deps ...
  conversationRouter?: ConversationRouter;
}
```

**3b. Update `handleOwnerMessage()` to use router for channel-switch detection:**

At the start of `handleOwnerMessage()`, check if the router says this is a new conversation:

```typescript
    // Check for channel-switch new conversation trigger
    if (this.deps.conversationRouter) {
      const routeResult = this.deps.conversationRouter.route({
        channel: channelId,
        sender: first.from,
      });

      if (routeResult.newConversation && existingConversation) {
        // Channel switch detected — unpin current and create new
        await this.deps.conversationManager.unpin(existingConversation.id);
        // Fall through to normal message processing (will create new conversation)
        conversation = null; // Force new conversation creation below
      }
    }
```

Note: Full integration of ConversationRouter into message-handler for external contact routing to Working Agents is deferred to M6.6. For now, external messages continue to be stored in the external message store.

### Step 4: Update tests

Run existing test suite to ensure nothing breaks:

Run: `cd packages/dashboard && npx vitest run tests/conversations.test.ts`
Expected: All existing tests pass (may need to add `status` to test fixtures)

### Step 5: Type-check

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: Clean

### Step 6: Prettier

Run: `cd packages/dashboard && npx prettier --write src/ tests/`

### Step 7: Commit

```
git add packages/dashboard/src/ws/chat-handler.ts packages/dashboard/src/channels/message-handler.ts packages/dashboard/src/ws/protocol.ts packages/dashboard/tests/conversations.test.ts
git commit -m "feat: wire conversation status + router into handlers

handleConnect loads current conversation (not most recent).
switchConversation calls makeCurrent for status swap.
ConversationRouter integrated into message-handler for
channel-switch detection."
```

---

## Task 4: Add E2E scenarios for S4

Add test scenarios from S2 to the E2E accumulation file.

**Files:**
- Modify: `docs/sprints/m6.7-s4-e2e-scenarios.md`

### Step 1: Append S2 scenarios

Add to `docs/sprints/m6.7-s4-e2e-scenarios.md`:

```markdown
## From S2: Conversation Lifecycle

### Scenario 5: Only one current conversation at a time
1. Open dashboard, note current conversation
2. Send `/new`, verify new conversation is current
3. Check sidebar: previous conversation shows as inactive (no bold/highlight)
4. Switch to previous conversation, it becomes current, new one becomes inactive

### Scenario 6: Connect loads current conversation
1. Have 3+ conversations (1 current, rest inactive)
2. Refresh browser / open new tab
3. Verify the current conversation loads automatically (not just most recent by timestamp)

### Scenario 7: Channel switch detection (Web to WhatsApp)
1. Send a message via web UI (establishes web as current channel)
2. Send a message via WhatsApp (same owner)
3. Verify: new conversation created for WhatsApp message
4. Verify: web conversation is now inactive

### Scenario 8: WhatsApp to Web is NOT a new conversation
1. Send a message via WhatsApp
2. Open web UI
3. Verify: same conversation continues (no new conversation created)
4. Send a message via web, verify response appears in same conversation
```

### Step 2: Commit

```
git add docs/sprints/m6.7-s4-e2e-scenarios.md
git commit -m "docs: add S2 E2E scenarios to S4 accumulation file

Scenarios 5-8: current/inactive model, connect loads current,
Web to WhatsApp switch detection, WhatsApp to Web continuity."
```

---

## Verification Checklist

Before declaring S2 done:

- [ ] `npx tsc --noEmit` passes (both core and dashboard)
- [ ] `npx prettier --write src/` applied
- [ ] `conversation-status.test.ts` — all tests pass
- [ ] `conversation-router.test.ts` — all tests pass
- [ ] `conversations.test.ts` — existing tests still pass
- [ ] E2E scenarios documented in `m6.7-s4-e2e-scenarios.md`
- [ ] No console/server errors on startup

## Task Summary

| Task | Component | Type |
|------|-----------|------|
| 1 | Conversation status model | Data model + DB migration |
| 2 | ConversationRouter | New module |
| 3 | Wire into handlers | Integration |
| 4 | E2E scenarios | Documentation |
