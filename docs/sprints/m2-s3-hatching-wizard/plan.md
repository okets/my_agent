# Sprint M2-S3: Chat-Based Hatching

> **Status:** In Review
> **Started:** 2026-02-13
> **Revised:** 2026-02-14 — Shifted from form-wizard to chat-based approach

## Goal

The agent comes alive through conversation, not forms. Hatching happens inside the chat page with a two-phase flow: scripted questions (no LLM) then LLM-driven setup with interactive controls.

## Architecture

```
index.html (single page)
  └─ WebSocket /api/chat/ws
       ├─ Phase 1: ScriptedHatchingEngine (no LLM)
       │     ├─ Collects agent name, user name, auth
       │     ├─ Sends messages with inline controls
       │     └─ On auth success → transitions to Phase 2
       │
       ├─ Phase 2: Agent SDK with hatching tools
       │     ├─ System prompt guides setup conversation
       │     ├─ MCP tools: present_choices, ask_text, save_setup
       │     ├─ Tool calls pause stream → controls appear → user responds
       │     └─ save_setup writes files + sends hatching_complete
       │
       └─ Hatched: Normal SessionManager flow
```

## Chat Controls Protocol

### Control types

```typescript
interface TextInputControl {
  type: "text_input";
  id: string;
  placeholder?: string;
  password?: boolean;
}

interface ButtonsControl {
  type: "buttons";
  id: string;
  options: Array<{ label: string; value: string; variant?: "primary" | "secondary" }>;
}

interface CardsControl {
  type: "cards";
  id: string;
  columns?: 1 | 2;
  options: Array<{ label: string; value: string; emoji?: string; description?: string }>;
}
```

### WebSocket messages

```typescript
// Server → Client
| { type: "controls"; controls: ChatControl[] }
| { type: "hatching_complete"; agentName: string }

// Client → Server
| { type: "control_response"; controlId: string; value: string }
```

## Tasks

### Task 1: Protocol Extension

Add ChatControl types and hatching messages to protocol.

**Files:**
- `packages/dashboard/src/ws/protocol.ts` — ADD: ChatControl types, controls/hatching_complete/control_response

### Task 2: Frontend Controls

Control templates in chat, handlers in app.js.

**Files:**
- `packages/dashboard/public/index.html` — ADD: control templates in message bubbles
- `packages/dashboard/public/js/app.js` — ADD: handle controls event, submitControl()
- `packages/dashboard/public/js/chat-controls.js` — NEW: control interaction helpers
- `packages/dashboard/public/css/app.css` — ADD: chat control styles

### Task 3: Scripted Hatching Engine (Phase 1)

State machine for pre-auth setup: agent name → user name → auth.

**Files:**
- `packages/dashboard/src/hatching/scripted-engine.ts` — NEW: ScriptedHatchingEngine class

### Task 4: LLM Hatching Tools (Phase 2)

MCP tools the agent uses to show interactive controls.

**Files:**
- `packages/dashboard/src/hatching/hatching-tools.ts` — NEW: createHatchingSession with tools
- `packages/dashboard/src/hatching/hatching-prompt.ts` — NEW: system prompt for hatching agent

### Task 5: Chat Handler Integration

Route to scripted engine → Phase 2 agent → normal chat.

**Files:**
- `packages/dashboard/src/ws/chat-handler.ts` — MODIFY: hatching state routing

### Task 6: Cleanup + Migration

Remove old form-based hatching files.

**Files:**
- DELETE: `public/hatching.html`, `public/css/hatching.css`, `public/js/hatching.js`
- MODIFY: `src/routes/hatching.ts` — keep GET /status, remove POST /complete

### Task 7: Integration + Review

Full flow test, TypeScript check, Prettier.

## Blockers Fixed

### B1: Tool promises hang on disconnect

**Problem:** `waitForControlResponse()` promises hang forever if WebSocket closes.

**Fix:** Added `cleanup()` function that resolves all pending promises with `"__session_closed__"` marker.

```typescript
// hatching-tools.ts
function cleanup() {
  for (const [id, pending] of pendingResponses) {
    pending.resolve("__session_closed__");
  }
  pendingResponses.clear();
}
```

### B2: No SDK query abort on socket close

**Problem:** WebSocket close nulled hatchingSession but SDK query continued running.

**Fix:** Store Query reference, call `interrupt()` on cleanup. Order matters: `interrupt()` first, then `cleanup()`.

```typescript
// chat-handler.ts
if (hatchingSession) {
  if (hatchingSession.query) {
    await hatchingSession.query.interrupt();
  }
  hatchingSession.cleanup();
  hatchingSession = null;
}
```

## Dependencies

```
Task 1 (Protocol)
  ├── Task 2 (Frontend) ─────────────────────┐
  ├── Task 3 (Scripted Engine) ──┐           │
  └── Task 4 (LLM Tools) ────────┼── Task 5 ─┼── Task 6 ── Task 7
                                 └───────────┘
```

## Verification

1. `npx tsc --noEmit` — clean on both packages
2. Delete `.my_agent/`, start server → chat page loads → hatching conversation starts
3. Phase 1: name your agent, name yourself, auth (env detected or manual)
4. Phase 2: agent asks about purpose, shows personality cards
5. Agent calls save_setup → files written → hatching_complete → seamless transition
6. Send a message → normal chat works (streaming, thinking, stop)
7. Refresh → straight to chat (already hatched)
