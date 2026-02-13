# Sprint M2-S1: Server Foundation + Static Chat

> **Status:** Complete
> **Started:** 2026-02-13
> **Completed:** 2026-02-13

## Goal

Get Fastify serving the SPA, WebSocket connected, single-turn (non-streaming) chat working end-to-end.

## Tasks

### Task 1: Package Scaffolding
Create `packages/dashboard/` with package.json, tsconfig.json, directory structure, and core library exports.

**Files:**
- `packages/dashboard/package.json`
- `packages/dashboard/tsconfig.json`
- `packages/dashboard/src/` (empty, ready for server code)
- `packages/dashboard/public/` (empty, ready for frontend)
- `packages/core/src/lib.ts` — re-exports for dashboard consumption

**Done when:** `npm install` succeeds, `tsc --noEmit` clean on both packages.

### Task 2: Fastify Server Foundation
Fastify server with static file serving, CORS, WebSocket plugin, multipart plugin. Serves `public/` at root.

**Files:**
- `packages/dashboard/src/server.ts` — Fastify setup (static, cors, websocket, multipart)
- `packages/dashboard/src/index.ts` — Entry: findAgentDir, resolveAuth, start server

**Done when:** `npm run dev` starts server, `http://localhost:3456` serves static files.

### Task 3: Chat UI (HTML + CSS)
Dark-themed chat interface inspired by OpenClaw design. Full-height layout with message area and input.

**Design reference:** OpenClaw dashboard uses Tokyo Night color palette:
- Background: `#1a1b26` (surface-900), `#1f2335` (slightly lighter)
- Borders: `rgba(255,255,255,0.06)`
- Text: `gray-100` primary, `gray-400` secondary
- Accent: `#7aa2f7` (blue), gradient `from-purple-500 to-pink-500`
- Glass effect: `background: rgba(255,255,255,0.03); backdrop-filter: blur(10px)`
- Font: Inter
- Chat panel: `rgba(31, 35, 53, 0.6)` bg, messages in rounded bubbles
- User messages: right-aligned, accent-colored bg
- Assistant messages: left-aligned, `bg-white/5` with avatar
- Input: textarea with auto-resize, send button

**Files:**
- `packages/dashboard/public/index.html` — SPA shell with Alpine.js + Tailwind CDN
- `packages/dashboard/public/css/app.css` — Custom styles (scrollbar, glass, chat-md, compose)

**Done when:** Opening the HTML in a browser shows a polished dark chat interface with message area and input.

### Task 4: Alpine.js App + WebSocket Client
Alpine.js data/methods for chat state. WebSocket client with auto-reconnect.

**Files:**
- `packages/dashboard/public/js/app.js` — Alpine.js component: messages array, sendMessage(), receiveMessage(), scroll management
- `packages/dashboard/public/js/ws-client.js` — WebSocket class with auto-reconnect, message callbacks

**WebSocket protocol (client → server):**
- `{ type: 'message', content: string }`

**WebSocket protocol (server → client):**
- `{ type: 'start' }` — response begins
- `{ type: 'chunk', content: string }` — text delta (S1: full text, not streaming)
- `{ type: 'done' }` — response complete
- `{ type: 'error', message: string }` — error

**Done when:** Alpine.js app renders messages, WebSocket connects with reconnect on disconnect.

### Task 5: Chat WebSocket Handler + Session Manager
Server-side WebSocket handler that receives messages, calls Agent SDK, sends response back.

**Files:**
- `packages/dashboard/src/ws/chat-handler.ts` — WebSocket route, message dispatch
- `packages/dashboard/src/ws/protocol.ts` — Shared WS message type definitions
- `packages/dashboard/src/agent/session-manager.ts` — Wraps createBrainQuery() for single-turn

**Behavior:**
- On WS `message` event: parse JSON, call session-manager, collect full response, send back
- Session manager: calls `createBrainQuery()` → iterates `streamResponse()` → returns text
- First turn: `continue: false`. Subsequent: `continue: true`.
- Error handling: catch SDK errors, send `{ type: 'error', message }` back

**Done when:** Send message via WebSocket → receive agent response.

### Task 6: Integration + Verification
Wire everything together, verify end-to-end flow.

**Verification:**
1. `npx tsc --noEmit` — clean compilation
2. `npx prettier --write packages/dashboard/` — formatting
3. `npm run dev` → open `http://localhost:3456` → see chat UI
4. Type message → receive response from Agent SDK
5. Send follow-up → agent remembers context (multi-turn via `continue: true`)

## Dependencies

```
Task 1 (scaffolding)
  ├── Task 2 (server) ──┐
  └── Task 3 (UI HTML) ──├── Task 6 (integration)
       └── Task 4 (JS) ──┤
            Task 5 (WS) ──┘
```

Task 2 + Task 3 can be parallel. Task 4 depends on Task 3. Task 5 depends on Task 2.
