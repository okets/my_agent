# Dashboard Package — Development Guide

## Overview

Web UI for my_agent: chat interface + hatching wizard. Built with Alpine.js + Tailwind CSS (CDN) + Fastify backend.

## Design Language

**CRITICAL:** All frontend work MUST follow the Nina V1 Design Language.

**Reference:** [`/docs/design/nina-v1-design-language.md`](../../docs/design/nina-v1-design-language.md)

### Quick Reference

#### Color System (Tokyo Night)

| Token | Hex | Usage |
|-------|-----|-------|
| `surface-900` | `#1a1b26` | Body background |
| `surface-800` | `#1f2335` | Panels, cards |
| `accent-blue` | `#7aa2f7` | Primary accent, links, focus |
| `accent-purple` | `#bb9af7` | Model badges, reasoning, phase |
| `accent-pink` | `#f7768e` | Alerts, stop button |
| `coral` | `#e07a5f` | Send button (solid) |

#### Glass Panels

```css
.glass-strong {
  background: rgba(30, 30, 46, 0.8);  /* Purple-tinted, NOT transparent */
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

#### Buttons

- **Send button:** Solid coral `#e07a5f`, NOT ghost style
- **Primary CTA:** Purple-to-pink gradient `from-purple-500 to-pink-500`
- **Toggle active:** `bg-violet-500/20 text-violet-300 border-violet-500/30`

#### Capability Badges

```html
<!-- Thinking --> <span class="text-[9px] px-1 py-px rounded bg-violet-500/15 text-violet-400">Thinking</span>
<!-- Vision -->   <span class="text-[9px] px-1 py-px rounded bg-blue-500/15 text-blue-400">Vision</span>
<!-- Tools -->    <span class="text-[9px] px-1 py-px rounded bg-amber-500/15 text-amber-400">Tools</span>
```

#### Compose Box

- Border: `rgba(255,255,255,0.15)` normal, `rgba(255,255,255,0.35)` focused
- Background: `#1e1e2e` (explicit, not transparent)

#### Status Colors

| Status | Background | Text |
|--------|------------|------|
| Active | `bg-green-500/20` | `text-green-400` |
| Planning | `bg-cyan-500/15` | `text-cyan-400` |
| Paused | `bg-orange-500/15` | `text-orange-400` |
| Error | `bg-red-500/20` | `text-red-400` |

### Anti-Patterns (DO NOT)

- Ghost-style send button (use solid coral)
- Transparent glass panels (use purple-tinted)
- Plain text model selector (use purple badge + capability icons)
- Static compose border (use dynamic focus state)
- Missing capability badges on models

## File Structure

```
packages/dashboard/
├── src/                    # Backend (TypeScript)
│   ├── index.ts           # Entry point, Fastify server
│   ├── server.ts          # Route registration
│   ├── ws/                # WebSocket handlers
│   ├── agent/             # Agent SDK integration
│   ├── conversations/     # Persistence layer
│   └── hatching/          # Hatching flow
├── public/                # Frontend (served static)
│   ├── index.html         # Single-page app (Alpine.js)
│   ├── css/app.css        # Custom styles
│   └── js/
│       ├── app.js         # Alpine.js application
│       └── ws-client.js   # WebSocket client
└── CLAUDE.md              # This file
```

## Tech Stack

- **Frontend:** Alpine.js + Tailwind CSS (both via CDN, no build step)
- **Backend:** Fastify + WebSocket
- **Database:** SQLite (better-sqlite3)
- **Agent:** Claude Agent SDK

## Scripts

```bash
npm run dev        # Start development server (port 4321)
npm run format     # Run Prettier on src/ and public/
```

## Common Tasks

### Adding UI Components

1. Read the design language doc first
2. Follow the glass-strong, badge, and button patterns
3. Use the correct color tokens
4. Run `npm run format` after changes

### Adding WebSocket Messages

1. Define types in `src/ws/protocol.ts`
2. Add handler in `src/ws/chat-handler.ts`
3. Add client handler in `public/js/ws-client.js`
4. Update Alpine state in `public/js/app.js`
