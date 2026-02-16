# Sprint M2-S5 Review: Conversation Naming

> **Reviewer:** Opus 4.6 (Independent)
> **Date:** 2026-02-16
> **Sprint plan:** [plan.md](plan.md)
> **Design spec:** `docs/design/conversation-system.md` (Section: Conversation Naming)

---

## Verdict: PASS

All three tasks are implemented and verified working. The naming trigger fires at turn 5, NamingService calls Haiku and generates valid titles, and the frontend displays/edits titles correctly. TypeScript compiles clean, Prettier passes. Two medium-severity notes from the initial review (title-exists guard and closure capture) were fixed during the sprint. Two additional bug fixes (model ID and response parsing) were required and applied.

---

## Review Summary

| Area | Status | Notes |
|------|--------|-------|
| Task 1: NamingService | PASS | Clean implementation, good validation and retry logic |
| Task 2: Naming Trigger | PASS | Working, title-exists guard added, closure captured by value |
| Task 3: Frontend Title | PASS | Header edit + sidebar display + CSS styles all present |
| TypeScript | PASS | `npx tsc --noEmit` clean |
| Prettier | PASS | `npx prettier --check src/` clean |
| Security | PASS | Title truncated, `x-text` used (no XSS), API key not exposed |
| Integration | PASS | No regressions to existing chat/sidebar/conversation features |

---

## Detailed Findings

### Task 1: NamingService (PASS)

**File:** `packages/dashboard/src/conversations/naming.ts`

Well-implemented:
- Correct Haiku model (`claude-haiku-4-5-20251001`)
- Retry logic (2 attempts) for invalid title format
- JSON parsing with markdown code block fallback (handles Haiku wrapping JSON in triple backticks)
- Title validation: exactly 3 lowercase-alpha words separated by hyphens
- Topic normalization to kebab-case via regex
- Cost-efficient: `max_tokens: 200`, single prompt, no system message overhead

Minor note (non-blocking):
- `isValidTitle` only allows `[a-z]+` per word. This is correct per the design spec ("3-word haiku-style phrase using lowercase words separated by hyphens"). Words like "AI" or "GPT" would be rejected, which is the desired behavior since haiku titles should be evocative.

### Task 2: Naming Trigger Integration (PASS)

**File:** `packages/dashboard/src/ws/chat-handler.ts` (lines 617-668)

The trigger is implemented as a fire-and-forget async IIFE after the assistant turn is saved at turn 5. It lazily initializes `NamingService` using `process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN` (matching the pattern in `index.ts` for `AbbreviationQueue`), calls `generateName()`, updates the DB via `conversationManager.setTitle()` and `setTopics()`, and broadcasts `conversation_renamed` to all clients.

**Note 1 (Medium, RESOLVED): Title-exists guard**

Title-exists guard was added to the turn-5 trigger. If the conversation already has a title (e.g., from manual rename), auto-naming is skipped.

**Note 2 (Medium, RESOLVED): Closure captures `currentConversationId` by value**

`currentConversationId` is now captured by value at the top of the IIFE, preventing race conditions if the user switches conversations during the Haiku API call.

**Note 3 (Low, RESOLVED): Auth token fallback**

~~Previously only checked `ANTHROPIC_API_KEY`.~~ Now checks `ANTHROPIC_API_KEY || CLAUDE_CODE_OAUTH_TOKEN`, matching the pattern in `index.ts` for `AbbreviationQueue`. Fixed.

**Note 4 (Low): `broadcastToAll` vs `broadcastToConversation`**

The trigger uses `broadcastToAll` instead of `broadcastToConversation`. This is actually correct behavior: all clients need the rename event to update their sidebar conversation list, regardless of which conversation they're viewing. Good call.

### Task 3: Frontend Title Display + Manual Rename (PASS)

**Files:** `index.html` (lines 205-227), `app.js` (lines 648-671), `app.css` (lines 497-519)

All components present and working:

1. **Header title display** (`index.html`): Shows `currentTitle || 'New conversation'` with click-to-edit. Uses `x-show` toggle between display div and input.

2. **Alpine.js state** (`app.js:33-34`): `editingTitle: false` and `editTitleValue: ""`.

3. **Computed property** (`app.js:76-82`): `currentTitle` getter derives title from the `conversations` array by finding the matching ID. Avoids stale state.

4. **Title edit methods** (`app.js:648-671`):
   - `startTitleEdit()`: Guards on `currentConversationId` and `wsConnected`, focuses input, selects text via `$nextTick`
   - `confirmTitleEdit()`: Validates non-empty, sends `rename_conversation` WS message
   - `cancelTitleEdit()`: Resets `editingTitle` flag
   - `@blur` cancels edit (explicit Enter required to confirm) -- consistent UX pattern

5. **`conversation_renamed` handler** (`app.js:545-553`): Updates sidebar title in the conversations array.

6. **CSS styles** (`app.css:497-519`): `.conversation-title-display` has hover highlight, `.conversation-title-input` has focused border styling with Tokyo Night blue (#7aa2f7). Clean.

### Existing Manual Rename Handler (PASS)

**File:** `packages/dashboard/src/ws/chat-handler.ts` (lines 444-462)

The `handleRenameConversation` function correctly:
- Validates `currentConversationId` exists
- Truncates title to `MAX_TITLE_LENGTH` (100 chars)
- Calls `conversationManager.setTitle()`
- Broadcasts to all clients

### Exports (PASS)

**File:** `packages/dashboard/src/conversations/index.ts`

`NamingService` and `NamingResult` type are correctly exported.

---

## Security Assessment

| Check | Result |
|-------|--------|
| API key handling | Passed as constructor param from env var, not hardcoded |
| XSS in title display | `x-text` used (safe text interpolation), not `x-html` |
| Title input sanitization | Server truncates to 100 chars via `MAX_TITLE_LENGTH` |
| Conversation ID validation | Regex check `^conv-[A-Z0-9]{26}$` applied on rename |
| DOMPurify for markdown | Used in all `renderMarkdown()` calls (unrelated to naming, but verified) |
| No secrets in public files | Clean |

---

## Plan Adherence

| Plan Item | Implemented | Notes |
|-----------|-------------|-------|
| NamingService class | Yes | As specified |
| Haiku model call | Yes | `claude-haiku-4-5-20251001` |
| 3-word hyphenated title | Yes | Validated by `isValidTitle()` |
| Topic tags (kebab-case) | Yes | Normalized by regex |
| Turn 5 trigger | Yes | `currentTurnNumber === 5` check |
| Fire-and-forget pattern | Yes | Async IIFE with try/catch |
| `conversation_renamed` WS | Yes | Broadcasts to all clients |
| Header title display | Yes | With inline edit |
| Sidebar title update | Yes | Via `conversation_renamed` handler |
| `getTurnCount()` on manager | No | Used local `currentTurnNumber` instead (functionally equivalent) |
| Fastify decorator for naming | No | Used lazy init in chat-handler (functionally equivalent) |

Deviations are minor and pragmatic. The lazy initialization pattern avoids touching `server.ts` type augmentation and `index.ts` startup, keeping changes localized. Acceptable.

---

## Bug Fixes Applied During Sprint

Two additional bugs were discovered and fixed after the initial review:

1. **Model ID fix:** `claude-haiku-4` is not a valid model ID and caused `createBrainQuery` to fail with "process exited with code 1". Changed to `claude-haiku-4-5-20251001` in both `naming.ts` and `abbreviation.ts`.

2. **Response parsing fix:** With `includePartialMessages: false`, the Agent SDK returns `assistant` type messages (with `message.content` blocks), not `stream_event` type messages. Both `naming.ts` and `abbreviation.ts` were parsing `stream_event` messages, so `responseText` was always empty. Changed to extract text from `assistant` message content blocks, with `result` type as fallback.

**Final verified result:** Turn 5 triggers naming, produces "curious-rapid-answers" with topics ["general-knowledge", "quick-reference"]. Manual rename also works.

---

*Review completed: 2026-02-16*
*Reviewer: Opus 4.6 (Independent)*
