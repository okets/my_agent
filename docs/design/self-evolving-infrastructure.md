# Self-Evolving Agent Infrastructure

> *"The API is for agents, maintained by agents."*

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

Agentic software development: agents use APIs. When the API doesn't serve their needs, agents should be able to extend it.

This isn't about replacing human oversight. It's about reducing friction. When a QA agent needs to verify a new feature but the API doesn't expose the relevant state, the agent shouldn't file a ticket and wait. It should:

1. Document what it needs
2. Implement the endpoint
3. Continue testing
4. Report what it added

The human reviews the sprint output — including API changes — and approves or revises.

---

## The Pattern: Wishlist → Implementation → Verification

Every sprint team includes a **QA agent**. The QA agent has three responsibilities:

### 1. Test Everything

Use the Debug/Admin API to verify sprint changes:
- Send messages, verify responses
- Inspect system prompt assembly
- Check cache state before and after operations
- Simulate channel messages
- Verify calendar integration

### 2. Document Gaps

When testing reveals missing capabilities, document them:

```markdown
## WISHLIST.md

### Missing: Conversation token count
**Needed:** GET /api/debug/conversation/:id/tokens
**Why:** Can't verify context window usage before sending messages
**Workaround used:** None, had to skip this test
```

### 3. Fill Gaps

Spawn a subagent to implement the missing capability:

```
Add endpoint GET /api/debug/conversation/:id/tokens to the debug API.
Should return: { inputTokens, outputTokens, total, limit }
See docs/design/debug-api.md for patterns.
Follow existing code style in packages/dashboard/src/routes/debug.ts
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

| Agent | Can Use API | Can Extend API | Can Modify Core |
|-------|-------------|----------------|-----------------|
| QA Agent | ✓ | ✓ (via subagent) | ✗ |
| Dev Agent | ✓ | ✓ | ✓ (reviewed) |
| Brain (Nina) | ✓ (limited) | ✗ | ✗ |

The QA agent can extend the API but not touch core business logic. Extensions go through the same review as any other code change.

---

## Implementation Requirements

### Debug API (`/api/debug/*`)

Read-only inspection of agent internals:
- System prompt assembly and components
- Cache state (TTL, size, contents)
- Conversation context being sent to model
- Brain file inventory
- Skill registry

### Admin API (`/api/admin/*`)

Mutating operations for test scenarios:
- Inject messages into conversations
- Invalidate caches
- Reset hatching state
- Simulate channel messages
- Create/delete calendar events
- Write to notebook files

### WebSocket QA Mode (`?qa=true`)

Extensions for programmatic chat testing:
- Send messages to specific conversations (not just "current")
- Get immediate conversation ID on creation
- Receive complete turn data after streaming
- Wait-for-idle synchronization

### Security

- Localhost-only access (no remote exploitation)
- Actions logged to debug.log
- QA mode clearly marked in logs

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

### Risk: API grows without coherence

**Mitigation:** Design doc (`docs/design/debug-api.md`) defines patterns. Agents follow patterns or explain deviations.

### Risk: Security holes introduced

**Mitigation:** Localhost-only. No auth means no auth bugs. Logging provides audit trail.

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
*Part of: my_agent framework*
