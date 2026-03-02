# Design Brief: Memory-First Agent Behavior

> **Status:** Research / Brainstorming
> **Problem:** Agent has memory but doesn't use it naturally
> **Goal:** Make memory use second nature, not a rule to follow

---

## The Problem

During live testing, Nina was asked "What's the weather like?" and responded:

> "I don't know your location."

She has a `recall()` tool. She has instructions to search memory before asking. But she ignored them and asked directly.

**Why?** Because memory use is an *instruction* competing with 50 other instructions. Task extraction works because it's a *hook* — code that runs regardless of model discretion.

But hooks alone won't solve this. The deeper issue is the agent's mental model.

---

## The Insight

It's not about "search when stuck." It's about **associative enrichment**.

When a human hears "What's the weather?", they don't think "I should search my memory for location." They just *know* where they are because that context is always present.

The agent should work similarly:
- Topic detected → relevant memories surface
- Person mentioned → everything known about them becomes available
- Food discussed → dietary preferences are already in mind

This is what differentiates a persistent agent from a stateless chatbot.

---

## Examples

| User says | Agent should automatically know |
|-----------|--------------------------------|
| "What's the weather?" | User's location |
| "What should I eat?" | Dietary restrictions, preferences |
| "John called" | Who John is, relationship, recent context |
| "Book me a flight" | Home airport, seating preferences, loyalty programs |
| "When's my next meeting?" | Calendar access, schedule patterns |
| "Remember I'm allergic to nuts" | *Write* to memory, then apply to all future food discussions |

---

## Current Architecture

```
User message → Model processes → (maybe calls recall() if it decides to) → Response
```

**Problem:** Model decides whether to search. Often skips it.

---

## Desired Architecture

```
User message → Extract topics/entities → Enrich with relevant memory → Model responds with context
```

**Key shift:** Enrichment happens *before* the model sees the message, not as an optional tool call.

---

## Design Questions

### 1. How do we detect what's relevant?

Options:
- **Keyword matching** — "weather" triggers location lookup
- **Topic classification** — Haiku classifies message into categories (food, travel, people, etc.)
- **Entity extraction** — NER to find names, places, etc.
- **Semantic search** — Embed the message, find similar memory chunks

Trade-offs:
- Keywords are fast but brittle
- Classification adds latency but is more robust
- Semantic search is powerful but might over-fetch

### 2. Where does enrichment happen?

Options:
- **Pre-prompt injection** — Before the model sees the message, append relevant memories to system prompt
- **Middleware** — A processing step between user message and model call
- **Tool enforcement** — Hook that forces `recall()` call on every turn
- **Haiku pre-processor** — Fast model extracts topics, routes to memory, injects results

### 3. What gets searched?

Current memory sources:
- `notebook/reference/` — Stable facts (contacts, preferences)
- `notebook/knowledge/` — Learned information
- `notebook/daily/` — Daily logs
- Past conversations — Via `conversation_search()`

Should we search all? Route based on topic?

### 4. How do we avoid over-fetching?

"Hi" shouldn't trigger a memory search.
"Thanks!" shouldn't either.

Need a gate: "Is this message likely to benefit from memory enrichment?"

### 5. How do we inject results?

Options:
- Append to system prompt as a "Memory Context" section
- Inject as a synthetic assistant message ("I recall that...")
- Add as tool results in the conversation

---

## Success Criteria

1. "What's the weather?" → Agent checks memory for location before responding
2. "What should I order?" → Agent recalls dietary preferences
3. "John said hi" → Agent knows who John is
4. "Hi" → No unnecessary memory search
5. No noticeable latency increase for simple queries

---

## Related Work

- **Task extraction hook** — Working example of forced behavior via hooks
- **Reference auto-load** — `reference/` files already injected at conversation start
- **Compaction context injection** — Similar pattern of pre-loading context

---

## Non-Goals (for now)

- Perfect recall of everything ever discussed
- Complex reasoning about what's relevant
- Multi-hop memory chains ("John works at Acme, Acme is in NYC, so John is in NYC")

Keep it simple. Get the 80% case working first.

---

## Next Steps

1. Decide on detection mechanism (keywords vs classification vs semantic)
2. Prototype the simplest version that could work
3. Test with real examples
4. Iterate based on what fails

---

## Open Questions

- Should enrichment be visible to the user? ("I found this in my notes...")
- How do we handle conflicting memories?
- Should the agent explain *why* it knows something?
- How does this interact with conversation context (already in the thread)?

---

*Created: 2026-03-01*
*Status: Awaiting design session*
