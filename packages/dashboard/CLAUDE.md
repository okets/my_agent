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

## System Prompt Injections — Brain Notifications

**Two delivery shapes (M9.4-S4.2):**

1. **Action requests** (proactive scheduled deliveries — briefs, scheduled sessions, completion notifications). Use `sendActionRequest` / `injectActionRequest`. The prompt is sent as a bare USER-role turn — Nina's response loop is trained to fulfill it. Never wrap in `[SYSTEM: ]`. Examples: morning brief delivery, daily session delivery, `notify: immediate` job completion.

2. **System events** (genuine infrastructure notifications — mount failures, infra alerts, capability degradation). Use `sendSystemMessage` / `injectSystemTurn`. The prompt is wrapped in `[SYSTEM: …]` automatically by `injectSystemTurn`. Used for events the user did not ask for and that need to be surfaced as info, not delivered as content.

**Pattern for action requests:**

```typescript
// alert() routes through sendActionRequest (no wrap)
// fu2 (2026-04-29): INLINE the deliverable content. Do NOT reference a
// file path and ask Nina to Read it — Sonnet narrates Read calls and
// the brief opens with "Let me read that deliverable…" leakage.
const prompt =
  `It's time to deliver TODAY's results from a scheduled background task you (past-you) set up. ` +
  `Pause and deliver this now.\n\nDeliverable content:\n\n---\n${resolvedSummary}\n---\n\n` +
  `Render this in your voice — pick what matters, structure it, voice it — but do not silently drop sections.`;
const result = await ci.alert(prompt);
// alert() returns AlertResult: { status: "delivered" | "no_conversation" | "transport_failed" | ... }
if (result.status === "no_conversation") {
  // Fresh-install fallback: initiate() also routes through sendActionRequest now
  await ci.initiate({ firstTurnPrompt: prompt });
}
```

**Pattern for system events:**

```typescript
// Genuine infra alert — user did NOT ask for this
const prompt =
  `A filesystem watch on "${path}" has failed after ${attempts} retry attempts.\n\n` +
  `You are the conversation layer — let the user know about this infrastructure issue ` +
  `briefly. Don't be dramatic, just inform them.`;
await app.notificationQueue.enqueue({
  type: "infra_alert",
  summary: prompt,
  // …
});
// formatNotification's infra_alert branch passes through verbatim; the
// notification-queue path emits the prompt via sendActionRequest at the
// moment-of-delivery, but the framing is the user-facing one above.
```

**Rules:**

- **Never pre-wrap action-request prompts.** `sendActionRequest` does not wrap; the model reads as user-role.
- **Never pre-wrap initiate firstTurnPrompt.** `initiate()` routes through `sendActionRequest` since S4.2; passing `[SYSTEM: ${prompt}]` would deliver a literal `[SYSTEM:` prefix as content (defeats the action-request principle).
- **Never bypass the queue for proactive deliveries.** All briefs and session deliveries go through the notification queue → heartbeat → action-request injection. Do not call `injectActionRequest` directly except in unit tests.
- **Never pass raw status dumps** — "Automation X completed. Summary: …" gives the brain no guidance. It will respond as a worker ("Noted. Logging it.") instead of a mediator. Action-request prompts must say what to do (deliver, present, render).
- **Inline the deliverable content; do not reference files for the model to read.** Pre-S4.2 used inline content (clean Apr 24 baseline). S4.2 introduced a `Read the deliverable.md` directive which Sonnet narrated as tool-call leakage. fu2 (2026-04-29) restored inline content. The artifact still lives at `run_dir/deliverable.md` for provenance/inspection, but the model receives the resolved content directly in the prompt body — no Read call. Wrap the inlined content in `---` delimiters so the model treats it as content-to-render, not framing.

**Why:**

- On 2026-03-26, a test-watcher automation sent "Noted. Logging it." to the user via WhatsApp because the prompt was a raw status dump with no mediator framing. Always include a "what to do" instruction.
- On 2026-04-25–27, three consecutive morning briefs were dismissed as "background activity" because system-role injection reads as context-to-acknowledge, not action-to-perform. Action-request injection (M9.4-S4.2) shifts the model's interpretation by speaking in the user's voice — Nina fulfills requests; she dismisses context.
- On 2026-04-28–29, Nina's brief openers exposed Read tool narration ("Let me read that deliverable… Let me render this cleanly…") — a structural side effect of asking the model to Read a file path. Fu2 inlines the content so no tool call is invited. Soak surfaced that prompt-level "don't narrate tools" instructions cannot reliably override Sonnet's trained tool-call narration; the structural fix is to not trigger the call.

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
