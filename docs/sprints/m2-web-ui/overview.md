# Milestone 2: Web UI

> **Status:** Planning Complete — Ready for Implementation
> **Date:** 2026-02-13
> **Sprints:** 4 planned

---

## Goal

Replace the CLI REPL with a browser-based chat interface and hatching wizard. The web UI becomes the primary way to interact with Nina.

## Design Reference

OpenClaw dashboard (see private references in `.my_agent/docs/references.md`) — use its visual design and feature patterns (streaming, thinking blocks, file uploads, markdown). Build fresh, don't port.

## Tech Stack

- **Backend:** Fastify (static files, REST for hatching, WebSocket for chat)
- **Frontend:** Alpine.js + Tailwind CSS (CDN, no build step)
- **Agent:** Claude Agent SDK via `packages/core`
- **Markdown:** marked.js (GFM)
- **Communication:** WebSocket (chat streaming), REST (hatching wizard)

## Architecture

```
Browser (Alpine.js + Tailwind SPA)
    |
    |-- REST: /api/hatching/* (setup wizard)
    |-- REST: /api/uploads (file attachments)
    |-- WebSocket: /api/chat/ws (streaming chat)
    |
Fastify Server (packages/dashboard/)
    |
    |-- step-adapter.ts (hatching step metadata + execution)
    |-- session-manager.ts (Agent SDK query lifecycle)
    |-- stream-processor.ts (SDKMessage → WS message)
    |
Core Package (packages/core/) — shared logic
```

## Sprint Plan

### M2-S1: Server Foundation + Static Chat
Fastify serves the SPA, WebSocket connects, single-turn non-streaming chat works.

### M2-S2: Streaming + Thinking + Markdown
Real-time token streaming, thinking blocks (collapsible), markdown, multi-turn.

### M2-S3: Web Hatching Wizard
Browser-based setup wizard replaces CLI hatching. REST-based step submission.

### M2-S4: Slash Commands + File Upload + Interactive Tools + Polish
Slash command autocomplete, file uploads, tool-based interactive UI (AskUserQuestion), dark theme polish.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multi-turn | `query()` with `continue: true` | Proven in M1, stable API |
| Hatching transport | REST | Sequential form, request/response is natural |
| Chat transport | WebSocket | Bidirectional streaming required |
| Frontend | Single HTML + JS files (CDN) | No build step, matches OpenClaw pattern |
| Slash commands | Autocomplete dropdown on `/` | Discord/Slack-style UX |

## Scope

**In scope:** Chat interface, hatching wizard, streaming, thinking blocks, file uploads, slash commands, tool-based interactive UI

**Out of scope:** Session management, operations dashboard, multi-user, model selection

---

*Plan approved: 2026-02-13*
*Session: Hanan + Claude Code (Opus 4.6)*
