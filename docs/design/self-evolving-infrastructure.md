# Self-Evolving Agent Infrastructure

> *"The App is for agents, maintained by agents."*

---

## The Problem

When Claude Code sessions debug my_agent, they hit walls:

- Can't see what system prompt the brain assembled
- Can't inspect cache state to understand why context is stale
- Can't inject test scenarios without manual UI interaction
- Can't verify calendar integration is working

Each debugging session reinvents the wheel. Knowledge is lost between sessions. The same questions get asked: "Why doesn't Nina see this?" "What's in the context?" "Is the cache stale?"

Manual testing is slow. Humans click through UIs. Agents could test programmatically — if they had the tools.

---

## The Philosophy

**Infrastructure should serve its users. Agents are users.**

Traditional software development: humans write APIs, humans maintain APIs, humans use APIs.

Agentic software development: agents use the App directly. When the App doesn't expose what they need, agents extend it.

This isn't about replacing human oversight. It's about reducing friction. When a QA agent needs to verify a new feature but the App doesn't expose the relevant state, the agent shouldn't file a ticket and wait. It should:

1. Document what it needs
2. Implement the App method
3. Continue testing
4. Report what it added

The human reviews the sprint output — including App method additions — and approves or revises.

---

## The Headless App

Since M6.10, the application core is a headless `App` class that agents drive directly — no HTTP server, no browser, no WebSocket. The web dashboard is a thin adapter over the App.

**Headless API reference:** `docs/design/headless-api.md`

### What agents can do headlessly

| Capability | App Method | Replaces |
|------------|-----------|----------|
| Send messages, get streaming response | `app.chat.sendMessage()` | WebSocket chat UI |
| Inspect system prompt + components | `app.debug.systemPrompt()` | `GET /api/debug/brain/prompt` |
| Check brain status (hatched, auth, model) | `app.debug.brainStatus()` | `GET /api/debug/brain/status` |
| List brain files | `app.debug.brainFiles()` | `GET /api/debug/brain/files` |
| List skills | `app.debug.skills()` | `GET /api/debug/brain/skills` |
| Create/manage tasks | `app.tasks.create()`, `.update()` | `POST /api/admin/tasks` |
| Manage conversations | `app.chat.newConversation()`, `.switch()` | WebSocket + REST |
| Listen for state changes | `app.on('task:updated', ...)` | WebSocket state messages |

### Why headless-first

- **Faster** — no HTTP roundtrip, no browser startup, no Playwright overhead
- **Cheaper** — fewer tokens spent on curl commands and HTML parsing
- **Deterministic** — no UI rendering timing, no WebSocket race conditions
- **Parallel-safe** — multiple App instances can coexist (separate databases)

The HTTP Debug/Admin API still exists as one adapter over the App. Agents should prefer headless methods. HTTP is for browser-based debugging when a human needs it.

---

## The Pattern: Wishlist → Implementation → Verification

Every sprint team includes a **QA agent**. The QA agent has three responsibilities:

### 1. Test Everything

Use the headless App to verify sprint changes:
- `app.chat.sendMessage()` — send messages, collect streaming events, verify responses
- `app.debug.systemPrompt()` — inspect system prompt assembly and components
- `app.debug.brainStatus()` — check hatching, auth, model configuration
- `app.tasks.create()` / `app.on('task:updated', ...)` — test task lifecycle
- `app.conversations.*` — test conversation management
- Listen for events via `app.on(eventName, handler)` — verify live updates fire

### 2. Document Gaps

When testing reveals missing capabilities, document them:

```markdown
## WISHLIST.md

### Missing: Conversation token count
**Needed:** app.debug.conversationTokens(conversationId)
**Why:** Can't verify context window usage before sending messages
**Workaround used:** None, had to skip this test
```

### 3. Fill Gaps

Spawn a subagent to implement the missing capability:

```
Add method conversationTokens(conversationId) to AppDebugService.
Should return: { inputTokens, outputTokens, total, limit }
See packages/dashboard/src/debug/debug-queries.ts for patterns.
Add the corresponding pure function in debug-queries.ts, then wire it in app-debug-service.ts.
```

Then continue testing with the new capability.

---

## Why This Works

### Aligned Incentives

The QA agent needs the API to do its job. It has direct incentive to make the API better. No ticket queues, no prioritization debates — just immediate need → immediate solution.

### Knowledge Capture

Every wishlist item documents a real need. Even if the subagent's implementation isn't perfect, the wishlist captures what agents actually need. This is better than guessing what APIs to build.

### Incremental Growth

The API starts minimal and grows based on actual usage. No speculative endpoints that never get used. Every endpoint exists because an agent needed it.

### Human Oversight Preserved

The sprint review includes:
- What was tested
- What API changes were made
- Why they were needed

Humans can reject, revise, or refine. But the work is done. Review is faster than specification.

---

## The Trust Gradient

Not all agents get the same capabilities:

| Agent | Can Use App | Can Extend App | Can Modify Core |
|-------|------------|----------------|-----------------|
| QA Agent | ✓ | ✓ (via subagent — add debug queries, App methods) | ✗ |
| Dev Agent | ✓ | ✓ | ✓ (reviewed) |
| Brain (Nina) | ✓ (limited) | ✗ | ✗ |

The QA agent can extend the App's debug/introspection surface but not touch core business logic. Extensions go through the same review as any other code change.

---

## Implementation Layers

### Primary: Headless App (M6.10+)

Agents drive the App class directly — no server required:

**Introspection (`app.debug.*`):**
- `brainStatus()` — hatching, auth, model
- `systemPrompt()` — assembled prompt with component breakdown
- `brainFiles()` — brain directory listing
- `skills()` — framework and user skill inventory

**Chat (`app.chat.*`):**
- `sendMessage(conversationId, content, turnNumber)` — streaming via AsyncGenerator
- `newConversation()`, `switchConversation()`, `deleteConversation()`
- `connect()` — get current conversation state

**State (`app.tasks.*`, `app.conversations.*`):**
- Full CRUD on tasks and conversations
- Event subscription via `app.on('task:updated', handler)`

**Test harness (`AppHarness`):**
- Lightweight App-compatible environment for integration tests
- Mock SDK sessions for testing chat without LLM calls
- Broadcast capture for verifying event emission

### Secondary: HTTP API (adapter)

The Debug/Admin REST API remains available as a thin adapter over the App. Useful when:
- A human needs to debug via browser
- An external tool requires HTTP
- The headless App doesn't expose something yet (add it — see pattern above)

**Debug routes:** `GET /api/debug/*` — read-only inspection
**Admin routes:** `POST /api/admin/*` — mutating operations
**WebSocket:** `ws://localhost:4321/api/chat/ws` — real-time chat

### Security

- Headless App: in-process, no network exposure
- HTTP API: localhost-only access, actions logged to debug.log

---

## The Recursive Vision

Today: Agents test the agent framework and extend the testing API.

Tomorrow: Agents develop the agent framework and extend their own capabilities.

The same pattern scales. When a development agent needs a capability that doesn't exist, it can propose and implement it. The human reviews. The framework grows.

This is how agent infrastructure should work: **serving agents, maintained by agents, supervised by humans**.

---

## Risks and Mitigations

### Risk: Agents add bad APIs

**Mitigation:** All changes go through sprint review. Humans approve the diff.

### Risk: App surface grows without coherence

**Mitigation:** Debug queries are pure functions in `debug-queries.ts`. Design doc (`docs/design/headless-api.md`) defines patterns. Agents follow patterns or explain deviations.

### Risk: Security holes introduced

**Mitigation:** Headless App is in-process (no network). HTTP adapter is localhost-only. Logging provides audit trail.

### Risk: Agents get stuck in loops

**Mitigation:** QA agent has bounded scope. If it can't implement something, it documents and moves on. Human handles in review.

---

## Conclusion

The traditional model — humans anticipate agent needs and build APIs — doesn't scale. Agents discover needs faster than humans can build.

The new model — agents document needs and implement solutions — keeps pace with development. Humans review and approve.

This isn't AGI. It's good software engineering: **the users of a system should be able to improve it**.

Agents are users now.

---

*Philosophy documented: 2026-02-18*
*Updated: 2026-03-20 — Headless App replaces HTTP as primary agent interface (M6.10)*
*Part of: my_agent framework*
