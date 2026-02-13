# Sprint M2-S1 Review: Server Foundation + Static Chat

> **Status:** Complete
> **Date:** 2026-02-13

## Goal

Get Fastify serving the SPA, WebSocket connected, single-turn (non-streaming) chat working end-to-end.

## Completed Tasks

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Package scaffolding | `packages/dashboard/package.json`, `tsconfig.json`, `packages/core/src/lib.ts` | Done |
| 2 | Fastify server foundation | `src/server.ts`, `src/index.ts` | Done |
| 3 | Chat UI (HTML + CSS) | `public/index.html`, `public/css/app.css` | Done |
| 4 | Alpine.js app + WebSocket client | `public/js/app.js`, `public/js/ws-client.js` | Done |
| 5 | Chat WebSocket handler + session manager | `src/ws/chat-handler.ts`, `src/ws/protocol.ts`, `src/agent/session-manager.ts` | Done |
| 6 | Integration + verification | All files | Done |

## Architecture Decisions

- **Core lib exports:** Created `packages/core/src/lib.ts` to re-export public API for dashboard consumption, avoiding direct deep imports.
- **No `streamResponse()` reuse:** Session manager iterates the query directly instead of using `streamResponse()` which writes to stdout. Same logic, appropriate for server context.
- **Per-connection SessionManager:** Each WebSocket connection gets its own `SessionManager` instance to prevent conversation cross-contamination.
- **PORT env var:** Server port configurable via `PORT` environment variable, defaults to 3456.

## Code Quality Fixes (from review)

| Issue | Severity | Fix |
|-------|----------|-----|
| XSS via unsanitized markdown | SECURITY | Added DOMPurify for all `marked.parse()` output |
| Shared SessionManager across connections | BUG | Moved instantiation inside per-connection handler |
| `isResponding` stuck after WS disconnect | BUG | Reset `isResponding` and `currentAssistantMessage` on reconnect |
| No message length validation | BUG | Added 10,000 char limit with error response |
| Double-initialization race | BUG | Lazy promise pattern (`ensureInitialized()`) |
| Stale `sanitize: false` option | QUALITY | Removed (deprecated in marked v1.0+) |

## Verification

- `tsc --noEmit` — clean on both `core` and `dashboard` packages
- `prettier --write` — all files formatted
- Server starts, WebSocket connects, graceful shutdown works
- End-to-end chat flow: message → WS → Agent SDK → response (requires hatched agent)

## Files Created

```
packages/dashboard/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Fastify setup
│   ├── agent/
│   │   └── session-manager.ts  # Agent SDK wrapper
│   └── ws/
│       ├── chat-handler.ts   # WebSocket route
│       └── protocol.ts       # Message types
└── public/
    ├── index.html            # SPA shell
    ├── css/
    │   └── app.css           # Tokyo Night styles
    └── js/
        ├── app.js            # Alpine.js chat component
        └── ws-client.js      # WebSocket client

packages/core/
└── src/
    └── lib.ts                # Re-exports for dashboard
```

## Next Sprint (M2-S2)

Streaming + thinking indicators + enhanced markdown rendering.
