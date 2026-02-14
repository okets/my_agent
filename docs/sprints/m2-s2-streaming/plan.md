# Sprint M2-S2: Streaming + Thinking + Stop

> **Status:** Complete
> **Started:** 2026-02-13

## Goal

Real-time token streaming, thinking blocks (expand/collapse), and stop button. Responses appear word-by-word instead of all at once.

## Tasks

### Task 1: Stream Processor + Updated Session Manager

Transform the session manager from "collect full text, return string" to "yield events as they arrive." Add a stream processor that parses SDK `stream_event` messages.

**Files:**
- `packages/dashboard/src/agent/stream-processor.ts` — NEW: parses `SDKMessage` events, yields `StreamEvent` objects
- `packages/dashboard/src/agent/session-manager.ts` — MODIFY: enable `includePartialMessages: true`, change `sendMessage()` to `streamMessage()` returning `AsyncGenerator<StreamEvent>`

**Stream processor behavior:**
- Input: SDK `SDKMessage` from the async generator
- Output: `StreamEvent` union type:
  - `{ type: 'text_delta', text: string }` — from `content_block_delta` with `text_delta`
  - `{ type: 'thinking_delta', text: string }` — from `content_block_delta` with `thinking_delta`
  - `{ type: 'thinking_end' }` — from `content_block_stop` for a thinking block
  - `{ type: 'done', cost?: number, usage?: { input: number, output: number } }` — from `result` message
  - `{ type: 'error', message: string }` — from result error or assistant error

**Session manager changes:**
- Add `includePartialMessages: true` to query options
- New method: `async *streamMessage(content: string): AsyncGenerator<StreamEvent>`
- Keep tracking `isFirstTurn` for `continue: true`
- Import and use `processStream()` from stream-processor

**SDK message types to handle:**
- `msg.type === 'stream_event'` → `msg.event` is a `BetaRawMessageStreamEvent`
  - `event.type === 'content_block_start'` → check `event.content_block.type` (text vs thinking)
  - `event.type === 'content_block_delta'` → check `event.delta.type` (text_delta vs thinking_delta)
  - `event.type === 'content_block_stop'` → emit thinking_end if current block was thinking
- `msg.type === 'result'` → emit done with cost/usage
- `msg.type === 'assistant'` → skip (redundant when streaming)

**Done when:** `streamMessage()` yields real-time `StreamEvent` objects when iterating the SDK query.

### Task 2: WebSocket Protocol + Handler Updates

Update the WS protocol to support streaming deltas and thinking blocks. Update the handler to use `streamMessage()`.

**Files:**
- `packages/dashboard/src/ws/protocol.ts` — MODIFY: add new server message types
- `packages/dashboard/src/ws/chat-handler.ts` — MODIFY: use `streamMessage()`, forward events as WS messages

**Protocol additions (ServerMessage):**
```typescript
| { type: 'text_delta'; content: string }      // replaces 'chunk' for streaming
| { type: 'thinking_delta'; content: string }   // thinking token
| { type: 'thinking_end' }                      // collapse thinking block
```
Keep `chunk` for backwards compat but prefer `text_delta` for streaming.

**ClientMessage additions:**
```typescript
| { type: 'abort' }                             // stop generation
```

**Handler changes:**
- Replace `await sessionManager.sendMessage()` with `for await (const event of sessionManager.streamMessage())`
- Map each `StreamEvent` to the corresponding `ServerMessage` and send via WS
- Send `{ type: 'start' }` before streaming begins
- Send `{ type: 'done' }` when stream completes
- Handle `abort` client message: call `query.interrupt()` (need to expose query reference)

**Done when:** WebSocket sends real-time text_delta and thinking_delta messages as the agent responds.

### Task 3: Frontend Streaming + Thinking UI

Update the Alpine.js app to handle streaming deltas and render thinking blocks.

**Files:**
- `packages/dashboard/public/js/app.js` — MODIFY: handle text_delta, thinking_delta, thinking_end; add stop button logic
- `packages/dashboard/public/index.html` — MODIFY: add thinking block HTML, stop button
- `packages/dashboard/public/css/app.css` — MODIFY: add thinking block styles

**app.js changes:**
- `handleWsMessage()` new cases:
  - `text_delta`: append `data.content` to `currentAssistantMessage.content`, re-render markdown
  - `thinking_delta`: append to `currentThinkingText`, show in thinking block
  - `thinking_end`: mark thinking complete, auto-collapse
- New state:
  - `currentThinkingText: ''` — accumulates thinking tokens
  - `isThinking: false` — true while thinking block is active
  - `thinkingExpanded: false` — toggle for thinking block visibility
- `stopResponse()` method: sends `{ type: 'abort' }` via WS
- Keep handling `chunk` type for backwards compat (full text replacement)

**index.html changes:**
- Thinking block inside assistant message bubble:
  ```html
  <div x-show="msg.thinkingText" class="thinking-block">
    <button @click="msg.thinkingExpanded = !msg.thinkingExpanded">
      Thinking... (click to expand/collapse)
    </button>
    <div x-show="msg.thinkingExpanded" x-collapse>
      <pre x-text="msg.thinkingText"></pre>
    </div>
  </div>
  ```
- Stop button: replaces send button while `isResponding` is true
  ```html
  <button x-show="isResponding" @click="stopResponse()">Stop</button>
  ```

**css/app.css changes:**
- `.thinking-block` styles: subtle bg, border-left accent, monospace text
- Thinking toggle button styles
- Stop button styles (red accent)

**Done when:** Typing a message shows real-time streaming text, thinking blocks expand/collapse, stop button aborts generation.

### Task 4: Integration + Verification

Wire everything together, verify end-to-end streaming flow.

**Verification:**
1. `npx tsc --noEmit` — clean compilation
2. `npx prettier --write packages/dashboard/` — formatting
3. Server starts, WebSocket connects
4. Type message → see text appear word-by-word (streaming)
5. If agent uses thinking → thinking block appears, auto-collapses when text starts
6. Click stop → generation aborts
7. Send follow-up → multi-turn works

## Dependencies

```
Task 1 (stream processor + session manager)
  └── Task 2 (WS protocol + handler) ──┐
                                         ├── Task 4 (integration)
       Task 3 (frontend streaming UI) ──┘
```

Task 1 must complete first. Tasks 2 and 3 can be parallel after Task 1.
