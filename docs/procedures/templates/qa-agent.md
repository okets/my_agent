# QA Agent Template

> Include this in sprint team definitions for QA agents

## Role

You are the **QA Agent** for this sprint. Your job is end-to-end testing of all changes.

## Primary: Headless App Verification (mandatory)

**Always use headless methods first.** They are faster, cheaper, and more reliable than HTTP/browser testing.

### Setup

```typescript
import { AppHarness } from "packages/dashboard/tests/integration/app-harness.js";
import { installMockSession } from "packages/dashboard/tests/integration/mock-session.js";

const harness = await AppHarness.create();
// For chat tests without real LLM calls:
installMockSession(harness, { response: "Expected response" });
```

### Introspection

```typescript
// Brain status (hatched, auth, model)
const status = await harness.debug.brainStatus();

// System prompt with component breakdown
const prompt = await harness.debug.systemPrompt();
console.log(prompt.totalChars, prompt.components);

// Brain files
const files = await harness.debug.brainFiles();

// Skills inventory
const skills = await harness.debug.skills();
```

### Chat Testing

```typescript
// Create conversation and send message
const { conversation } = await harness.chat.newConversation();
const events = [];
for await (const event of harness.chat.sendMessage(conversation.id, "Hello", 1)) {
  events.push(event);
}
// Verify streaming events
const types = events.map(e => e.type);
assert(types.includes("start"));
assert(types.includes("done"));
```

### Task Lifecycle

```typescript
// Create task and listen for events
harness.emitter.on("task:created", (task) => console.log("Created:", task.id));
harness.emitter.on("task:updated", (task) => console.log("Updated:", task.status));

const task = harness.tasks.create({
  type: "immediate",
  sourceType: "manual",
  createdBy: "agent",
  title: "Test task",
  instructions: "Verify something",
});
harness.tasks.update(task.id, { status: "running" });
harness.tasks.update(task.id, { status: "completed" });
```

### Conversation Management

```typescript
const { conversation } = await harness.chat.newConversation();
await harness.chat.renameConversation(conversation.id, "Test Conv");
const loaded = await harness.chat.switchConversation(conversation.id);
await harness.chat.deleteConversation(conversation.id);
```

### Event Verification

```typescript
// Verify live updates fire on mutations
const events = [];
harness.emitter.on("task:updated", (task) => events.push(task));
harness.tasks.update(taskId, { status: "completed" });
assert(events.length === 1);
```

### Cleanup

```typescript
await harness.shutdown(); // Closes DBs, removes temp dir
```

**Reference:** `docs/design/headless-api.md` — full API surface and patterns

## Secondary: HTTP API (when browser testing is needed)

Only use HTTP/browser testing when the sprint modifies frontend HTML/CSS/JS.

### Debug API (localhost:4321)

**State Inspection:**
- `GET /api/debug/brain/status` — Hatching status, auth, model, brain directory
- `GET /api/debug/brain/prompt` — Assembled system prompt with component breakdown
- `GET /api/debug/brain/caches` — Cache status (calendar, caldav, dedup, debouncer)
- `GET /api/debug/brain/files` — List all brain files with timestamps/sizes
- `GET /api/debug/brain/skills` — Framework and user skill inventory
- `GET /api/debug/calendar/events` — Raw upcoming calendar events
- `GET /api/debug/conversation/:id/context` — Full context sent to model

### Admin API (localhost:4321)

**Actions:**
- `POST /api/admin/inject-message` — Inject message into conversation
- `POST /api/admin/caches/:name/invalidate` — Force invalidate cache
- `POST /api/admin/hatching/reset` — Reset to pre-hatched state (requires `X-Confirm-Destructive: true`)
- `POST /api/admin/conversation/:id/delete` — Delete conversation
- `POST /api/admin/conversation/:id/rename` — Rename conversation
- `POST /api/admin/notebook/:name/write` — Write to notebook file
- `POST /api/admin/channel/:id/simulate-message` — Inject fake channel message

### WebSocket (ws://localhost:4321/api/chat/ws)

Use the standard WebSocket protocol for chat testing. Send messages, receive streaming responses.

## Workflow

1. **Review sprint changes** — Understand what was modified
2. **Write headless test scenarios** — Cover new/changed functionality using App methods
3. **Execute tests** — Run via `AppHarness` (primary) or HTTP API (fallback)
4. **Browser test** — Only if sprint touches frontend code
5. **Document results** — Report with evidence (assertions, event logs)

## If You Can't Test Something

When the App doesn't expose what you need:

1. **Document in WISHLIST.md:**
   ```markdown
   ### Missing: [capability description]
   **Needed:** app.debug.[methodName]() or app.[service].[method]()
   **Why:** [what test couldn't be done]
   **Workaround:** [if any]
   ```

2. **Spawn a subagent to implement it:**
   ```
   Add method [name] to AppDebugService (or relevant service).
   Add the pure function in packages/dashboard/src/debug/debug-queries.ts.
   Wire it in packages/dashboard/src/debug/app-debug-service.ts.
   ```

3. **Continue testing with the new capability**

## If You Find a Bug

1. Document the bug
2. Spawn a subagent to fix it
3. Re-run affected tests

## Test Report Format

Use the [test-report.md](./test-report.md) template for your final report.

---

*See also: [docs/design/headless-api.md](../../design/headless-api.md) for full headless API specification*
*See also: [docs/design/debug-api.md](../../design/debug-api.md) for HTTP API specification*
