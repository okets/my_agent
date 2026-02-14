# Sprint M2-S3 Review: Chat-Based Hatching

> **Reviewer:** Opus
> **Date:** 2026-02-14
> **Verdict:** PASS -- ship it

---

## 1. Summary

The sprint converts hatching from a form-based wizard to a two-phase chat-based flow. Phase 1 (scripted, no LLM) handles auth detection and credential collection. Phase 2 (Agent SDK + MCP tools) runs a conversational setup for agent name, personality, purpose, and operating rules. The implementation matches the plan with one reasonable deviation, blocker fixes are correct, and no security issues were found.

---

## 2. Plan-to-Execution Analysis

### Tasks Delivered

| Task | Plan | Status | Notes |
|------|------|--------|-------|
| 1: Protocol Extension | `protocol.ts` -- add ChatControl types, new message types | Done | `ButtonsControl`, `CardsControl`, `compose_hint`, `hatching_complete`, `control_response` all present |
| 2: Frontend Controls | `index.html`, `app.js`, `chat-controls.js`, `app.css` | Done | Controls render inline, compose bar toggles password mode, buttons/cards disable after selection |
| 3: Scripted Engine | `scripted-engine.ts` -- state machine for auth | Done | States: `AUTH_DETECT` -> `AUTH_INPUT` -> `DONE`. Handles env detection, API key, subscription token |
| 4: LLM Hatching Tools | `hatching-tools.ts`, `hatching-prompt.ts` | Done | 4 tools: `present_choices`, `request_compose_input`, `get_personalities`, `save_setup` |
| 5: Chat Handler Integration | `chat-handler.ts` -- routing through phases | Done | Routes: scripted engine -> LLM session -> normal SessionManager |
| 6: Cleanup + Migration | Delete old form files, trim hatching routes | Done | `hatching.html`, `hatching.css`, `hatching.js` deleted. `routes/hatching.ts` kept with GET `/status` only |
| 7: Integration + Review | tsc clean, Prettier | Done | `npx tsc --noEmit` passes clean |

### Deviation: `TextInputControl` replaced by `compose_hint`

The plan specified a `TextInputControl` as a `ChatControl` type rendered inline in messages. The implementation instead uses a `compose_hint` server message that activates the existing compose bar with dynamic placeholder/password mode.

**Assessment:** This is a better design. Inline text inputs would create a second input surface competing with the compose bar. Using `compose_hint` keeps text entry in one place and supports password masking natively. The deviation is intentional and an improvement.

---

## 3. Blocker Fixes Verification

### B1: Tool promises hang on disconnect

**Fix location:** `hatching-tools.ts:64-70`

```typescript
function cleanup() {
  for (const [id, pending] of pendingResponses) {
    pending.resolve("__session_closed__");
  }
  pendingResponses.clear();
}
```

**Called from:** `chat-handler.ts:100` (abort), `chat-handler.ts:208` (socket close)

**Assessment:** Correct. Resolving with a marker value instead of rejecting is the right call -- it allows the SDK query to receive the tool result and wind down naturally rather than throwing an unhandled rejection. The `interrupt()` call (B2) ensures the query stops processing the result.

**Minor note:** The `__session_closed__` value gets returned to the LLM as `"User selected: __session_closed__"` or `"User entered: __session_closed__"`. This is harmless because `interrupt()` fires first and the query is already aborting when the tool result arrives. If interrupt timing ever changes, a check like `if (value === "__session_closed__") return { content: [...], isError: true }` in the tool handlers would be defensive. Not blocking -- just noting.

### B2: SDK query abort on socket close

**Fix location:** `chat-handler.ts:97-99` (abort handler), `chat-handler.ts:204-206` (close handler)

```typescript
if (hatchingSession) {
  if (hatchingSession.query) {
    await hatchingSession.query.interrupt();
  }
  hatchingSession.cleanup();
  hatchingSession = null;
}
```

**Assessment:** Correct. Order is right: `interrupt()` first (stops SDK processing), then `cleanup()` (resolves pending promises), then null the reference. The `query` getter on the return object uses `activeQuery` which is set once the SDK query starts iterating -- so the null check (`if (hatchingSession.query)`) correctly handles the window between `createHatchingSession()` and the first `for await` iteration.

One observation: `socket.on("close")` uses `await` on `interrupt()` inside a non-async callback. The `on("close")` handler is registered as `async () => { ... }` so this works, but if the `interrupt()` call throws, the error is swallowed (unhandled promise on the async callback). Low risk since `interrupt()` is unlikely to throw.

---

## 4. Remaining Issues

### Issue 1: Console.log statements in hatching-tools.ts (Cosmetic)

`hatching-tools.ts` has multiple `console.log` debug statements (lines 136-140, 147, 253, 271, 277, 336). These are fine for development but should be removed or moved behind a debug flag before production.

### Issue 2: No timeout on `waitForControlResponse` (Low)

If the LLM calls a tool and the user never responds (but keeps the socket open), the promise hangs indefinitely. The `cleanup()` function handles the disconnect case, but the "user walks away with socket open" case has no timeout. Low priority for a single-user app.

### No security issues found

- Auth tokens are sent via WebSocket (not logged, not stored in messages array)
- Password input uses `type="password"` in the compose bar
- `escapeHtml` and `escapeAttr` in `chat-controls.js` prevent XSS in control rendering
- DOMPurify sanitizes all markdown rendering
- The `compose_hint` password mode masks display text as bullet characters in the user bubble

---

## 5. User Stories for Testing

### US1: Fresh hatching with environment API key

1. Ensure `ANTHROPIC_API_KEY` is set in your environment
2. Delete `.my_agent/` directory if it exists
3. Start the server: `cd packages/dashboard && npm run dev`
4. Open `http://localhost:4321`
5. **Expected:** Welcome screen says "Let's get started!", then a message appears asking about your API key with "Use this" and "Enter different" buttons
6. Click "Use this"
7. **Expected:** Brief "credentials saved" message, then the LLM starts asking setup questions
8. Answer the LLM's questions (agent name, your name, purpose, personality)
9. **Expected:** Personality options appear as interactive cards
10. After final setup, a welcome message appears with the chosen agent name, header updates

### US2: Fresh hatching with manual API key entry

1. Unset `ANTHROPIC_API_KEY` from environment
2. Delete `.my_agent/` directory
3. Start server and open the page
4. **Expected:** Two buttons appear: "I have an API Key" and "I have a subscription"
5. Click "I have an API Key"
6. **Expected:** Compose bar switches to password mode with placeholder "Paste API key here..."
7. Paste an API key and press Enter
8. **Expected:** User bubble shows bullet characters (not the real key), flow continues to Phase 2

### US3: Disconnect and reconnect during hatching

1. Start a fresh hatching flow
2. After Phase 1 completes and Phase 2 starts (LLM is asking questions), close the browser tab
3. Reopen `http://localhost:4321`
4. **Expected:** Hatching restarts from the beginning (auth check). No server crash or hung processes.

### US4: Post-hatching normal chat

1. Complete the full hatching flow
2. Send a message in the chat
3. **Expected:** Agent responds with streaming text. Typing indicator shows while streaming. Stop button works.
4. Refresh the page
5. **Expected:** Goes straight to chat (no hatching flow). Agent name displays in header. Title shows "{AgentName} -- Dashboard".

### US5: Button and card control interactions

1. During hatching, when buttons appear (auth choice), verify:
   - Clicking one button disables all buttons and highlights the selected one
   - A user bubble appears with the button text
2. During Phase 2, when personality cards appear, verify:
   - Cards display with emoji, name, and description
   - Clicking one card disables all cards and highlights the selected one
   - A user bubble appears with the card label

---

*Review completed: 2026-02-14*
