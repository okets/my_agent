# M6.9-S3 Conversation Initiation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** Enable the agent to proactively start conversations with the user — alerting in active conversations or initiating new ones on the preferred channel.

**Architecture:** Two primitives (alert + initiate) in a ConversationInitiator service, consumed first by the morning brief. Working agent produces artifacts, conversation agent presents them. Silent fallback to web when preferred channel is unavailable.

**Tech Stack:** TypeScript, Vitest, Fastify, Alpine.js, better-sqlite3, Claude Agent SDK

**Design spec:** `docs/superpowers/specs/2026-03-13-conversation-initiation-design.md`

---

## Chunk 1: Data Layer + Core Service

### Task 1: Database Migration — last_user_message_at Column

**Files:**
- Modify: `packages/dashboard/src/conversations/db.ts` (migration section, ~line 85-139)
- Modify: `packages/dashboard/src/conversations/types.ts` (Conversation interface)
- Create: `packages/dashboard/tests/conversation-initiator.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/dashboard/tests/conversation-initiator.test.ts` with test setup (temp dir, ConversationManager) and a test that checks the `last_user_message_at` column exists in the conversations table via `PRAGMA table_info`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/dashboard && npx vitest run tests/conversation-initiator.test.ts`
Expected: FAIL — column not found

- [ ] **Step 3: Add migration to db.ts**

In the migration section of `db.ts`, after existing ALTER TABLE statements:

```typescript
const hasLastUserMessageAt = columns.some(
  (c: { name: string }) => c.name === "last_user_message_at",
);
if (!hasLastUserMessageAt) {
  this.db.exec(
    "ALTER TABLE conversations ADD COLUMN last_user_message_at TEXT DEFAULT NULL",
  );
}
```

Also update: `rowToConversation()` to include the new field, `updateConversation()` to support updates.

- [ ] **Step 4: Add lastUserMessageAt to Conversation type**

In `types.ts`, add `lastUserMessageAt: Date | null` to the Conversation interface.

- [ ] **Step 5: Run test to verify it passes**

- [ ] **Step 6: Commit**

```
feat(conversations): add last_user_message_at column for active conversation detection
```

---

### Task 2: Track lastUserMessageAt in appendTurn()

**Files:**
- Modify: `packages/dashboard/src/conversations/manager.ts` (~line 133-153)
- Modify: `packages/dashboard/tests/conversation-initiator.test.ts`

- [ ] **Step 1: Write failing tests**

Two tests:
1. `updates lastUserMessageAt on user turn` — append a user turn, verify lastUserMessageAt is set
2. `does NOT update lastUserMessageAt on assistant turn` — append assistant turn, verify still null

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Update appendTurn()**

In the `if (turn.role === "user")` block, add:

```typescript
this.db.updateConversation(id, {
  lastUserMessageAt: new Date(turn.timestamp),
});
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```
feat(conversations): track lastUserMessageAt on user turns
```

---

### Task 3: getActiveConversation() Method

**Files:**
- Modify: `packages/dashboard/src/conversations/db.ts`
- Modify: `packages/dashboard/src/conversations/manager.ts`
- Modify: `packages/dashboard/tests/conversation-initiator.test.ts`

- [ ] **Step 1: Write failing tests**

Four tests:
1. Returns conversation with recent user message (within threshold)
2. Returns null when last user message is older than threshold (20 min ago, 15 min threshold)
3. Returns null when no conversations exist
4. Returns null when conversation has no user messages

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Add getActiveConversation() to db.ts**

```typescript
getActiveConversation(thresholdMinutes: number): ConversationRow | null {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();
  const row = this.db.prepare(
    `SELECT * FROM conversations
     WHERE status = 'current'
       AND last_user_message_at IS NOT NULL
       AND last_user_message_at > ?
     ORDER BY last_user_message_at DESC
     LIMIT 1`,
  ).get(cutoff);
  return (row as ConversationRow) ?? null;
}
```

- [ ] **Step 4: Add getActiveConversation() to manager.ts**

```typescript
async getActiveConversation(thresholdMinutes: number = 15): Promise<Conversation | null> {
  const row = this.db.getActiveConversation(thresholdMinutes);
  if (!row) return null;
  return this.db.rowToConversation(row);
}
```

Expose `rowToConversation` if it's private.

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```
feat(conversations): add getActiveConversation() with activity threshold
```

---

### Task 4: Add outboundChannel to Config

**Files:**
- Modify: `packages/core/src/config.ts` (~line 338-374)
- Modify: `packages/dashboard/tests/config-preferences.test.ts`

- [ ] **Step 1: Write failing tests**

Two tests:
1. `loadPreferences returns outboundChannel with default` — expect "web"
2. `loadPreferences reads outboundChannel from config` — write whatsapp to yaml, expect "whatsapp"

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Update config.ts**

Add `outboundChannel: string` to `UserPreferences` interface.
Add `outboundChannel: "web"` to `DEFAULT_PREFERENCES`.
Add `outboundChannel?: string` to `YamlConfig` preferences type.
Update `loadPreferences()` return to include `outboundChannel`.

Note: `morningBrief.channel` is now deprecated — `outboundChannel` supersedes it. `loadPreferences()` should prefer `outboundChannel` when present, fall back to `morningBrief.channel` for backwards compat, then default to `"web"`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```
feat(config): add outboundChannel preference with web default
```

---

### Task 5: ConversationInitiator Service

**Files:**
- Create: `packages/dashboard/src/agent/conversation-initiator.ts`
- Modify: `packages/dashboard/tests/conversation-initiator.test.ts`

- [ ] **Step 1: Write failing tests for alert()**

Tests with mock session factory, mock channel manager, and real ConversationManager:
1. `alert() injects system turn into active conversation` — create conv, add recent user turn, call alert, expect true
2. `alert() returns false when no active conversation` — no conversations, call alert, expect false

- [ ] **Step 2: Write failing tests for initiate()**

1. `initiate() creates new conversation and streams first turn` — expect conversation returned with valid id
2. `initiate() falls back to web when preferred channel is disconnected` — mock disconnected, expect no channel send
3. `initiate() demotes existing current conversation` — create one, initiate another, verify old is inactive

- [ ] **Step 3: Implement ConversationInitiator**

```typescript
export class ConversationInitiator {
  constructor(options: {
    conversationManager: ConversationManager;
    sessionFactory: SessionFactory;
    channelManager: ChannelManagerLike;
    getOutboundChannel: () => string;
    getOwnerIdentity?: () => string | null;
    activityThresholdMinutes?: number;
  })

  async alert(prompt: string): Promise<boolean>
  // Check active conversation → inject synthetic turn → send via channel → return true
  // No active conversation → log warning → return false

  async initiate(options?: { firstTurnPrompt?: string }): Promise<Conversation>
  // Create conversation → stream brain first turn → send via channel (fallback to web)

  private async trySendViaChannel(content: string): Promise<void>
  // Try preferred channel, catch errors, silent fallback
}
```

Key interfaces:
- `SessionFactory` with `injectSystemTurn()` and `streamNewConversation()` (both return AsyncGenerator)
- `ChannelManagerLike` with `send()` and `isConnected()`

**Important:** `alert()` must NOT append the synthetic system turn to the transcript. Only the brain's response (assistant turn) is appended. The `[SYSTEM: ...]` prompt is internal routing only — the user never sees it in the conversation history.

- [ ] **Step 4: Run all tests to verify they pass**

- [ ] **Step 5: Commit**

```
feat: add ConversationInitiator service with alert() and initiate()
```

---

### Task 6: injectSystemTurn() on SessionManager

**Files:**
- Modify: `packages/dashboard/src/agent/session-manager.ts`

- [ ] **Step 1: Write test verifying method exists**

```typescript
expect(typeof SessionManager.prototype.injectSystemTurn).toBe("function");
```

- [ ] **Step 2: Write test for [SYSTEM: ] formatting**

```typescript
it("wraps prompt in [SYSTEM: ] format", async () => {
  // This requires integration-level testing or checking the content passed to streamMessage
  // At minimum, verify the method exists and returns an AsyncGenerator
  const sm = new SessionManager("test-conv-id");
  const gen = sm.injectSystemTurn("Test prompt");
  expect(gen[Symbol.asyncIterator]).toBeDefined();
});
```

- [ ] **Step 3: Implement injectSystemTurn()**

After `streamMessage()` in session-manager.ts:

```typescript
async *injectSystemTurn(prompt: string): AsyncGenerator<StreamEvent> {
  yield* this.streamMessage(`[SYSTEM: ${prompt}]`);
}
```

Wraps in `[SYSTEM: ]` format so the brain can distinguish system injections from user messages. The synthetic turn is NOT appended to the transcript by this method — the caller (ConversationInitiator) only appends the brain's response as an assistant turn.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```
feat(session-manager): add injectSystemTurn() for synthetic system turns
```

---

## Chunk 2: Wiring + Morning Brief Integration

### Task 7: Wire ConversationInitiator in index.ts

**Files:**
- Modify: `packages/dashboard/src/index.ts`

- [ ] **Step 1: Import and instantiate ConversationInitiator**

After ConversationManager initialization (~line 132):
- Create session factory adapter that wraps per-conversation SessionManager instances
- Create ConversationInitiator with: conversationManager, sessionFactory, channelManager, getOutboundChannel (reads from loadPreferences), getOwnerIdentity (reads ownerJid from config)

- [ ] **Step 2: Pass to WorkLoopScheduler constructor**

Add `conversationInitiator` to the scheduler options.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/dashboard && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```
feat: wire ConversationInitiator into application startup
```

---

### Task 8: Morning Brief Integration

**Files:**
- Modify: `packages/dashboard/src/scheduler/work-loop-scheduler.ts`
- Modify: `packages/dashboard/tests/conversation-initiator.test.ts`

- [ ] **Step 1: Add conversationInitiator to constructor options**

Update WorkLoopSchedulerOptions interface, store on instance.

- [ ] **Step 2: Add initiation step after morning prep with guards**

At end of `handleMorningPrep()`, after writing current-state.md. Two guards:
1. **Haiku failure guard:** Only call initiator if `runMorningPrep()` succeeded (output is truthy)
2. **Duplicate guard:** The existing `work_loop_runs` table already prevents re-running the same job within its cadence window. Verify this is sufficient; if not, add an explicit `morningBriefInitiatedToday` check.

```typescript
// Only initiate if the morning prep actually produced output
if (this.conversationInitiator && output) {
  try {
    const alerted = await this.conversationInitiator.alert(
      "The morning brief has been updated. Ask the user if they'd like to go through it now, or present it naturally if starting a new conversation.",
    );
    if (!alerted) {
      await this.conversationInitiator.initiate();
    }
  } catch (err) {
    console.error("[WorkLoop] Morning brief initiation failed:", err);
  }
}
```

- [ ] **Step 3: Write integration tests**

Two tests with mock initiator:
1. Calls initiate() when no active conversation (alert returns false)
2. Does not call initiate() when alert succeeds (alert returns true)

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Verify TypeScript compiles**

- [ ] **Step 6: Commit**

```
feat: integrate ConversationInitiator into morning brief flow
```

---

## Chunk 3: Settings + Hatching

### Task 9: Settings API — outboundChannel

**Files:**
- Modify: `packages/dashboard/src/routes/settings.ts` (~line 84-96)

- [ ] **Step 1: Update PUT handler merge logic**

Add outboundChannel to the merge in the PUT /api/settings/preferences handler:

```typescript
yaml.preferences = {
  ...existingPrefs,
  ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
  ...(body.outboundChannel !== undefined ? { outboundChannel: body.outboundChannel } : {}),
  morningBrief: newBrief,
};
```

- [ ] **Step 2: Verify with curl**

```bash
curl -s http://localhost:4321/api/settings/preferences | jq .outboundChannel
# Expected: "web"

curl -s -X PUT http://localhost:4321/api/settings/preferences \
  -H "Content-Type: application/json" \
  -d '{"outboundChannel":"whatsapp"}' | jq .outboundChannel
# Expected: "whatsapp"
```

- [ ] **Step 3: Commit**

```
feat(settings): add outboundChannel to preferences API
```

---

### Task 10: Settings UI — Outbound Channel Dropdown

**Files:**
- Modify: `packages/dashboard/public/js/app.js`
- Modify: `packages/dashboard/public/index.html`

- [ ] **Step 1: Add state to app.js**

In preferences state section (~line 211): `briefOutboundChannel: "web"`

- [ ] **Step 2: Load from API in loadPreferences()**

Around line 2588: `this.briefOutboundChannel = data.outboundChannel ?? "web"`

- [ ] **Step 3: Save in savePreferences()**

Add `outboundChannel: this.briefOutboundChannel` to the PUT body.

- [ ] **Step 4: Add dropdown to index.html (desktop)**

After model selector (~line 2305):

```html
<div class="space-y-1">
  <label class="text-xs text-slate-400 uppercase tracking-wider">Outbound Channel</label>
  <select x-model="briefOutboundChannel"
          class="w-full bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50">
    <option value="web">Web Only</option>
    <option value="whatsapp">WhatsApp</option>
  </select>
  <p class="text-xs text-slate-500">Where to send proactive messages</p>
</div>
```

- [ ] **Step 5: Add to mobile settings section**

Duplicate the dropdown in the mobile settings section (~line 6582).

- [ ] **Step 6: Browser verify**

Open dashboard, Settings, verify dropdown appears. Change value, save, refresh, verify persisted. Check mobile.

- [ ] **Step 7: Commit**

```
feat(ui): add outbound channel selector to Settings
```

---

### Task 11: Hatching — Outbound Channel Question

**Files:**
- Modify: `packages/dashboard/src/agent/hatching/operating-rules.ts`

- [ ] **Step 1: Read current hatching flow for question pattern**

- [ ] **Step 2: Add outbound channel question**

After morning brief time/timezone questions:

```typescript
{
  key: "outboundChannel",
  question: "How should I reach you when I need to tell you something?",
  options: [
    { label: "WhatsApp", value: "whatsapp" },
    { label: "Web dashboard only", value: "web" },
  ],
  default: "web",
}
```

Follow existing pattern for writing to `config.yaml` preferences.

- [ ] **Step 3: Commit**

```
feat(hatching): add outbound channel question to hatching flow
```

---

## Chunk 4: Verification

### Task 12: Full Test Suite

- [ ] **Step 1: Run all unit tests**

```bash
cd packages/dashboard && npx vitest run
```

Expected: All pass (note pre-existing haiku-jobs failures are known).

- [ ] **Step 2: Run TypeScript compilation for both packages**

```bash
cd packages/dashboard && npx tsc --noEmit
cd packages/core && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Commit fixes if needed**

---

### Task 13: Browser Verification

- [ ] **Step 1: Restart dashboard service**

```bash
systemctl --user restart nina-dashboard.service
```

- [ ] **Step 2: Verify Settings UI**

1. Open dashboard
2. Go to Settings
3. Verify "Outbound Channel" dropdown exists
4. Default is "Web Only"
5. Change to "WhatsApp", save, refresh — persisted
6. Check mobile view

- [ ] **Step 3: Verify preferences API**

```bash
curl -s http://localhost:4321/api/settings/preferences | jq .
```

Should include `outboundChannel`.

- [ ] **Step 4: Verify morning brief trigger**

```bash
curl -s -X POST http://localhost:4321/api/work-loop/trigger/morning-prep
```

Check logs for `[ConversationInitiator]` messages. Verify conversation created or alert sent.

- [ ] **Step 5: Document results in test-report.md**

---

### Task 14: Sprint Artifacts

- [ ] **Step 1: Create DECISIONS.md if any decisions were made during implementation**

- [ ] **Step 2: Create DEVIATIONS.md if any spec deviations occurred**

- [ ] **Step 3: Update ROADMAP.md — M6.9 S3 from "Planned" to "Complete"**

- [ ] **Step 4: Dispatch external reviewer**

Per `docs/procedures/external-reviewer.md`:
- Gather: spec, plan, `git diff master...HEAD`, test results, file list
- Spawn external reviewer agent
- Reviewer writes `review.md` and `test-report.md`

- [ ] **Step 5: Notify CTO — "Sprint complete. Run /trip-review when ready."**
