# Pre-Implementation Review: M2-S4 + M2-S5

> **Date:** 2026-02-14
> **Reviewer:** Claude Code (Opus 4.6)
> **Design spec:** `docs/design/conversation-system.md`
> **Plan doc:** `docs/plans/conversation-system.md`
> **Sprint plans:** `docs/sprints/m2-s4-conversations/plan.md`, `docs/sprints/m2-s5-naming/plan.md`

---

## 1. Coverage Summary

### What M2-S4 + M2-S5 Cover

These items from the design spec are addressed in the sprint plans:

| Design Spec Section | Covered By | Notes |
|---|---|---|
| Conversation lifecycle (create, active, close) | S4 Task 1 | Manager API covers create, close, list |
| JSONL transcript storage | S4 Task 1 | Format matches spec |
| SQLite metadata table | S4 Task 1 | Schema matches spec |
| FTS5 real-time indexing | S4 Task 1 | Turns indexed on append |
| Conversation resume on reconnect | S4 Task 2 | Hydration from transcript tail |
| Session binding per conversation | S4 Task 2 | SessionRegistry maps conversationId to SessionManager |
| WebSocket protocol (new/switch/list/load) | S4 Task 3 | Protocol types match design spec |
| Sidebar UI with conversation list | S4 Task 4 | Alpine.js implementation |
| Abbreviation on transition (background) | S4 Task 5 | AbbreviationQueue with Haiku |
| Abbreviation failure/retry | S4 Task 5 | needs_abbreviation flag, retry on startup |
| Haiku naming at turn 5 | S5 Task 1-2 | NamingService + trigger integration |
| Title display in sidebar + header | S5 Task 3 | Inline edit UI |
| Manual rename | S5 Task 3 | Click-to-edit pattern |
| Multi-topic detection (suggestSplit) | S5 Task 4 | System note injection |
| Topics array in metadata | S5 Task 2 | Updated at naming time |
| "New conversation" action | S4 Task 3-4 | Button + WS message |

### What Is Missing from M2 Scope

These items are described in the design spec as M2 behavior but are **not explicitly addressed** in either sprint:

1. **Conversation `state` field** -- The design spec defines `state: "active" | "closed" | "archived"` on the Conversation interface, but the SQLite schema in S4 has no `state` column. The sprint relies on `closed IS NULL` for active vs closed, but there is no distinction between "closed" and "archived" (archived = abbreviated + indexed). The plan doc says vector embeddings are M4b, so "archived" may not be needed yet, but the state field should be in the schema for forward compatibility.

2. **Conversation ID format** -- The design spec says `conv-{ulid}` (ULID). The plan doc data model says `conv-{uuid}`. These are different: ULIDs are time-sortable, UUIDs are not. The sprint plan file structure example uses a truncated ID (`conv-01HQXK5J7G8M3N4P5R`), which looks like ULID. This needs to be aligned. The `ulid` npm package is needed if ULID is used.

3. **Idle timeout (30 minutes) triggering abbreviation** -- The design spec defines a 30-minute idle timer that triggers abbreviation while keeping the conversation active. The S4 plan mentions abbreviation on transition but does not specify how idle timers are implemented. There is no timer infrastructure described. The 4-hour close timeout is also unaddressed.

4. **Close timeout (4 hours) for web conversations** -- The design spec says web conversations close after 4 hours of inactivity. No timer mechanism or check is described in either sprint.

5. **`turnCount` column in SQLite** -- The design spec's Conversation interface has `turnCount`, and the plan doc mentions it. The S4 SQL schema does not include a `turn_count` column. The ConversationMeta type in S4 Task 3 references `turnCount`.

6. **`updated` field on ConversationMeta** -- The WebSocket protocol in both the design spec and S4 Task 3 include `updated: string` (last activity timestamp). There is no `updated` column in the S4 schema, and no mechanism to update it.

7. **`hasMore` pagination** -- The design spec and S4 Task 3 specify `hasMore: boolean` in `conversation_loaded`. The S4 plan does not describe how pagination works or what "more" means in terms of loading older messages on scroll.

8. **Reconnect protocol specifics** -- The design spec describes a specific reconnect flow (server identifies most recent active web conversation, sends `conversation_loaded` then `conversation_list`). S4 Task 3 mentions this but does not address the case where a WebSocket reconnects to an existing conversation that still has a live Agent SDK session vs. one that needs hydration.

9. **Transcript meta header** -- The design spec says the first line of every JSONL file is a `meta` line (`{ "type": "meta", "id": "...", "channel": "...", ... }`). S4 Task 1 describes transcript.ts but does not explicitly mention writing the meta header on creation.

10. **Compression event handling** -- The design spec says when the Agent SDK compresses context, a `compression` event should be appended to the transcript with `compressedThrough` and `summary`. Neither sprint addresses how to detect SDK compression events and write them to the transcript. The `stream-processor.ts` currently does not emit compression events.

11. **Conversation reopen on switch-back** -- The design spec Flow 2 says switching to a past conversation should "reopen" it (remove close event or append reopen event). Neither sprint describes this mechanism.

---

## 2. Blockers

### Must Resolve Before Starting

1. **ULID vs UUID decision** -- The design spec says ULID (`conv-{ulid}`), the plan doc says UUID. These are architecturally different (time-sortability, sorting behavior, package dependency). Must pick one. **Recommendation: ULID per the design spec.** This means adding the `ulid` package.

2. **`better-sqlite3` is a native dependency** -- The design spec lists `better-sqlite3` as the SQLite driver. This is a C++ native addon requiring node-gyp and build tools. On WSL2 this is usually fine, but it must be verified that build tools (`build-essential`, `python3`) are installed. If builds fail, this blocks Task 1 entirely.

3. **Agent SDK `continue: true` behavior with hydrated context** -- S4 Task 2 describes creating a new Agent SDK query with loaded context and `continue: true`. The current `createBrainQuery()` in `packages/core/src/brain.ts` accepts only a single `prompt` string. There is no mechanism to pass previous turns as context. The Agent SDK's `query()` function signature needs to be checked for how to inject history. This is a core package change, not just a dashboard change.

4. **`agentDir` access in ConversationManager** -- The ConversationManager needs `agentDir` to locate `.my_agent/conversations/`. Currently `agentDir` is available on the Fastify instance via a decorator, but ConversationManager is instantiated outside Fastify. The S4 plan says `constructor(agentDir: string)`, which is fine, but the wiring from `index.ts` -> `server.ts` -> chat-handler needs to be explicit.

---

## 3. Dependencies

### NPM Packages Required

| Package | Purpose | Risk |
|---|---|---|
| `ulid` | Generate ULID-based conversation IDs | Low risk, small package, no native deps |
| `better-sqlite3` | SQLite driver (sync API for FTS5) | Medium risk: native addon, needs build tools |
| `@types/better-sqlite3` | TypeScript types | Dev dependency |

### Core Package Changes Required

1. **`createBrainQuery()` must support history injection** -- Currently takes `(prompt, options)` with only a string prompt. To hydrate conversations, the Agent SDK needs to receive prior turns. Either:
   - Add a `history` parameter to `createBrainQuery()`
   - Or use a different Agent SDK API that accepts preceding messages
   - This affects `packages/core/src/brain.ts` and `packages/core/src/lib.ts`

2. **`findAgentDir()` may need to be shared** -- ConversationManager uses it to find `.my_agent/conversations/`. Already exported from core, so no change needed, but the path construction (`path.join(agentDir, 'conversations')`) should be consistent.

### Infrastructure

- `.my_agent/conversations/` directory -- Created lazily by ConversationManager (per design spec)
- SQLite database file -- Created on first use by `better-sqlite3`

---

## 4. Gaps Found

### Gap 1: No `updated` or `turn_count` in Schema

The S4 Task 1 schema defines:
```sql
CREATE TABLE conversations (
    id, channel, title, topics, created, closed,
    participants, abbreviation, needs_abbreviation
);
```

Missing columns that the design spec and ConversationMeta type require:
- `turn_count INTEGER DEFAULT 0` -- needed for naming trigger and display
- `updated TEXT` -- needed for ConversationMeta.updated, sorting sidebar by recency

### Gap 2: No Timer Infrastructure for Timeouts

The design spec defines two timers:
- **Idle timeout (30 min):** triggers abbreviation
- **Close timeout (4 hours web):** closes conversation

Neither sprint describes:
- Where timers live (server process, per-conversation)
- How they are reset on new messages
- How they survive server restart (last message timestamp in DB, check on startup)

This is significant for M2 because without the 4-hour close timeout, conversations never close automatically. They just accumulate as "active" forever.

### Gap 3: Compression Event Capture

The design spec says compression events from the Agent SDK should be appended to the transcript. The current `stream-processor.ts` processes `stream_event` messages but does not detect compression. The Agent SDK may surface compression differently. This needs investigation.

### Gap 4: No `conversation_closed` Server Event Emission

S4 Task 3 defines a `conversation_closed` server message type, but there is no described mechanism for the server to emit it. Close events come from:
- User clicking "New conversation" (handled)
- Timeout (no timer implemented)
- Server deciding to close (no logic)

The `conversation_closed` message is only useful with timeouts, which are missing.

### Gap 5: Transcript Read Direction

The design spec says "load the last N turns." JSONL files are append-only, meaning reading the tail requires reading the entire file or using a reverse reader. For small files this is fine, but the implementation needs to either:
- Read the whole file and take the last N lines
- Use a reverse line reader
- Keep an index of line byte offsets (over-engineering for now)

The S4 plan does not address this. For MVP, reading the whole file is likely fine, but worth noting.

### Gap 6: Hatching Flow Interaction

The current `chat-handler.ts` has significant hatching logic (scripted engine, LLM hatching). When conversations are introduced, the hatching flow needs to be excluded from conversation persistence. Hatching is not a conversation -- it is a one-time setup flow. The plan does not describe how to handle this:
- Does a conversation get created during hatching? (It should not.)
- How does the chat handler know to skip ConversationManager during hatching?
- The `isHatched` flag already exists on the Fastify instance.

### Gap 7: Multi-Tab Behavior

The design spec says "Same conversation across tabs (single WebSocket per session)." The current implementation creates a new `SessionManager` per WebSocket connection (per tab). With conversations, multiple tabs should share the same conversation. S4 does not address this. If two tabs connect:
- Both should load the same active conversation
- Messages from one tab should appear in the other
- Only one Agent SDK session should be active per conversation

This is non-trivial and likely needs a shared server-side session concept.

### Gap 8: Abort During Conversation Switch

When the user switches conversations while a response is streaming:
- The current response must be aborted
- The partial response must be saved to the transcript
- The new conversation must be loaded

S4 Task 3 does not describe the abort-on-switch flow.

---

## 5. Scope Issues

### Should Be Deferred

1. **Vector embeddings / SQLite-vec** -- Correctly deferred to M4b. Both sprint plans explicitly exclude this.

2. **Cross-conversation search** -- Correctly deferred to M4b.

3. **Channel conversations (WhatsApp, email)** -- Correctly deferred to M3/M6.

4. **`search_conversations` / `fetch_context` MCP tools** -- Correctly deferred to M4b.

### Borderline -- Evaluate

1. **Idle timeout (30 min abbreviation trigger)** -- The design spec puts this in M2, but implementing timers adds complexity. Could defer to M4b and only abbreviate on explicit close/switch in M2. The abbreviation infrastructure from S4 Task 5 works either way; this is just a trigger question.

2. **Close timeout (4 hours)** -- Same concern. Without it, conversations never auto-close. Could implement a simple "check on connect" mechanism: if the last message in the active conversation is older than 4 hours, treat it as closed and start a new one. This is simpler than running timers.

3. **Multi-tab support** -- The design spec mentions it, but implementing shared sessions across WebSocket connections is complex. Could defer to a later sprint and document "one tab at a time" as an MVP limitation.

4. **Pagination (`hasMore`)** -- Loading the full transcript for display is fine for MVP. Pagination (scroll up to load more) can be added later. But the `hasMore` field should still be in the protocol for forward compatibility.

### Potentially Scope Creep

1. **`suggestSplit` in M2-S5** -- The multi-topic split suggestion (S5 Task 4) injects a system note into the agent's context. This requires modifying how the system prompt or conversation context is assembled, which touches core behavior. It is a nice-to-have for M2. The naming service (S5 Tasks 1-3) delivers the primary value. Consider making Task 4 optional.

---

## 6. Risks

### Risk 1: Agent SDK History Injection (HIGH)

**Issue:** The current `createBrainQuery()` takes a single string prompt. Hydrating a conversation requires passing prior turns as message history. The Agent SDK documentation should be checked for how `query()` accepts conversation history.

**Impact:** If the SDK does not support history injection easily, the entire conversation resume mechanism needs rethinking. This could mean using a different SDK API or maintaining a persistent session differently.

**Mitigation:** Investigate the Agent SDK `query()` options before starting implementation. Check if there is a `messages` or `history` parameter.

### Risk 2: `better-sqlite3` Build Failures (MEDIUM)

**Issue:** Native Node.js addon requiring C++ compilation. Can fail due to missing build tools, incompatible Node.js version, or WSL2 quirks.

**Impact:** Blocks the entire persistence layer (Task 1).

**Mitigation:** Test `npm install better-sqlite3` in the dashboard package before starting sprint work. Ensure `build-essential` and `python3` are installed in WSL2.

### Risk 3: Conversation Manager as Singleton (MEDIUM)

**Issue:** ConversationManager needs to be a singleton shared across all WebSocket connections. The current pattern creates a new SessionManager per WS connection. ConversationManager must be created once (at server startup) and shared.

**Impact:** Requires restructuring how the chat handler accesses shared state. Not hard, but easy to get wrong (race conditions on concurrent writes to SQLite).

**Mitigation:** Create ConversationManager in `index.ts` or `server.ts`, pass it as a Fastify decorator (like `agentDir`). `better-sqlite3` is synchronous and single-connection, which avoids SQLite concurrency issues.

### Risk 4: JSONL + SQLite Consistency (MEDIUM)

**Issue:** Every turn must be written to both the JSONL transcript and the FTS5 index. If one write succeeds and the other fails, they go out of sync.

**Impact:** FTS search returns incorrect results. Transcript has data that FTS does not, or vice versa.

**Mitigation:** Write to JSONL first (source of truth), then FTS. On FTS failure, log and continue. On startup, rebuild FTS from transcripts if counts do not match (per design spec Flow 6). This is already described in the design spec but not in the sprint plan.

### Risk 5: Frontend Layout Rework (LOW-MEDIUM)

**Issue:** The current HTML has a single-column layout (`max-w-3xl mx-auto`). Adding a sidebar requires converting to a two-column layout (sidebar + main content). This changes the entire page structure.

**Impact:** Could break existing CSS, hatching flow display, and responsive behavior.

**Mitigation:** Plan the layout change carefully. The sidebar can be a collapsible panel that does not affect the main chat column on mobile.

### Risk 6: Abbreviation API Key Access (LOW)

**Issue:** AbbreviationQueue needs an API key to call Haiku. The current auth flow resolves keys via `resolveAuth()`. The queue constructor takes `haikuApiKey: string`, but the API key might be resolved differently (env var, auth.json). The queue should use the same auth resolution path as the rest of the system.

**Mitigation:** Use `resolveAuth()` from `@my-agent/core` rather than passing a raw key. Or use the Anthropic SDK client directly with auto-detected credentials.

---

## 7. Recommendations

Ordered by priority (address before or during implementation):

### Before Starting

1. **Verify Agent SDK history injection API.** Read the Agent SDK docs or source to confirm how `query()` accepts prior conversation turns. This is the highest-risk unknown. If it does not support history, the resume mechanism needs a different approach.

2. **Test `better-sqlite3` installation.** Run `npm install better-sqlite3` in `packages/dashboard/` and verify it compiles. If it fails, debug immediately.

3. **Align on ULID vs UUID.** Both sprint plans should use the design spec's `conv-{ulid}` format. Add the `ulid` npm package to `packages/dashboard/package.json`.

### Schema Fixes

4. **Add missing columns to the conversations table:**
   - `turn_count INTEGER DEFAULT 0`
   - `updated TEXT` (last activity timestamp, indexed for sorting)
   - `state TEXT DEFAULT 'active'` (for forward compatibility with "archived")

5. **Add transcript meta header to Task 1.** The `create()` method should write the first JSONL line as a `meta` record per the design spec.

### Architecture

6. **Create ConversationManager as a Fastify decorator (singleton).** Instantiate in `server.ts` or `index.ts`, register as `fastify.conversationManager`. All WebSocket handlers share the same instance.

7. **Add startup recovery flow.** On server start, scan existing transcripts and verify FTS integrity (per design spec Flow 6). This can be a simple `ConversationManager.initialize()` method.

8. **Guard hatching from conversation persistence.** Add a check in the chat handler: if `!fastify.isHatched`, do not create conversations or write transcripts. This is a small but important detail.

### Defer or Simplify

9. **Simplify timeout handling for M2.** Instead of running idle/close timers, implement "check on connect": if the active conversation's last message is older than 4 hours, close it and create a new one. The 30-minute abbreviation-on-idle can be deferred to a post-M2 patch.

10. **Defer multi-tab support.** Document as MVP limitation. Multiple tabs will each get their own session. Fix in a later sprint.

11. **Make M2-S5 Task 4 (suggestSplit) optional.** The naming service (Tasks 1-3) provides the primary value. System note injection for split suggestions adds complexity that can wait.

12. **Set `hasMore: false` as a stub.** Include the field in the protocol for forward compatibility but always return `false` in M2. Implement actual pagination later.

### Implementation Notes

13. **Write JSONL first, then FTS.** Always treat the transcript as source of truth. FTS is derived and rebuildable.

14. **Handle abort-on-switch.** When switching conversations, abort the current streaming response, save partial content to the transcript, then load the new conversation.

15. **Ensure compression events are captured.** Investigate how the Agent SDK surfaces compression. If it appears as a `stream_event`, add handling in `stream-processor.ts` to yield it, and write it to the transcript.

---

## Summary

M2-S4 and M2-S5 cover the core conversation persistence and naming features well. The sprint plans are well-structured with clear task dependencies. The main concerns are:

- **High risk:** Agent SDK history injection for conversation resume (untested assumption)
- **Missing from schema:** `turn_count`, `updated`, `state` columns
- **Missing infrastructure:** Timeout timers (recommend simplifying to "check on connect")
- **Missing detail:** Hatching flow exclusion, abort-on-switch, compression capture
- **Dependency risk:** `better-sqlite3` native build (test early)
- **Scope question:** Multi-tab support (recommend deferring)

With the recommendations above addressed, both sprints are ready for implementation. The highest priority action is verifying the Agent SDK history injection API, as it affects the core resume mechanism in S4 Task 2.

---

*Review completed: 2026-02-14*
*Reviewer: Claude Code (Opus 4.6)*
