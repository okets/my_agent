# Sprint M2-S3 Review: Web Hatching Wizard

> **Status:** Complete
> **Date:** 2026-02-13

## Goal

Browser-based setup wizard that replaces the CLI hatching flow. Polished, conversational, fun.

## Completed Tasks

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Extract hatching logic from core | `hatching/logic.ts`, `lib.ts` | Done |
| 2 | REST routes for hatching | `routes/hatching.ts`, `server.ts` | Done |
| 3 | Wizard HTML + CSS | `hatching.html`, `hatching.css` | Done |
| 4 | Wizard JS logic | `hatching.js` | Done |
| 5 | Integration + review | All files | Done |

## Architecture

```
Browser (Alpine.js)
  hatching.html → hatchingWizard() component
    ├─ Screen state machine: welcome → steps(1-4) → celebration
    ├─ GET /api/hatching/env-auth → detect env API key
    ├─ POST /api/hatching/complete → single-shot hatching
    └─ Redirect to index.html on completion

  index.html → chat() component
    ├─ GET /api/hatching/status → check hatched + agent name
    ├─ If not hatched → redirect to hatching.html
    └─ Dynamic agent name in title, header, greeting, placeholder

Fastify Server
  routes/hatching.ts
    ├─ GET /api/hatching/status → { hatched, agentName }
    ├─ GET /api/hatching/env-auth → { detected }
    └─ POST /api/hatching/complete → validate, write all files, mark hatched

Core (pure functions)
  hatching/logic.ts
    ├─ createDirectoryStructure, writeMinimalConfig(agentDir, agentName?)
    ├─ writeIdentity, getPersonalities, applyPersonality, writeCustomPersonality
    ├─ checkEnvAuth, saveAuth, validateSetupToken
    └─ writeOperatingRules, writeHatchedMarker
```

## Wizard Flow

1. **Welcome** — First-person egg intro, "Let's begin"
2. **Identity** — Agent name (first!), user name, purpose pills, contacts
3. **Personality** — 6 preset cards (2-col grid) + custom option
4. **Auth** — Env detection, API key or subscription token input
5. **Rules** (optional) — Autonomy level, escalations, response style. Can skip.
6. **Celebration** — Egg wobble → crack → confetti → personalized greeting → "Start chatting"

## Code Quality Fixes (from Opus review)

| Issue | Severity | Fix |
|-------|----------|-----|
| Missing `/api/hatching/status` route | BUG | Added route returning `{ hatched, agentName }` |
| Token validation after file writes | BUG | Moved `validateSetupToken` before any file writes |
| `auth.json` world-readable permissions | SECURITY | Set `mode: 0o600` on writeFileSync |
| `applyPersonality` path traversal | SECURITY | Added `path.resolve` + startsWith check |
| Hardcoded "Nina" agent name | UX | Made agent name configurable in hatching, stored in config.yaml |
| Alpine expression error (escaped quote) | BUG | Used computed `greetingText` property instead of inline expression |
| Agent name race condition | BUG | Fetch agent name in Alpine `init()` instead of global var |
| Welcome screen mixed perspective | UX | Made title + body both first person |

## Files Created/Modified

```
packages/core/
  src/hatching/logic.ts       — NEW: pure hatching functions
  src/config.ts               — added loadAgentName()
  src/lib.ts                  — re-export hatching functions + loadAgentName
  src/auth.ts                 — auth.json file permissions (0o600)
  dist/                       — rebuilt

packages/dashboard/
  src/routes/hatching.ts      — NEW: REST routes (status, env-auth, complete)
  src/server.ts               — register hatching routes
  public/
    hatching.html             — NEW: wizard SPA (all steps + celebration)
    css/hatching.css          — NEW: wizard styles (Tokyo Night)
    js/hatching.js            — NEW: Alpine.js wizard component
    js/app.js                 — added agentName, greetingText
    index.html                — hatching redirect, dynamic agent name
```

## Verification

- `tsc --noEmit` clean on both packages
- `prettier --write` all files formatted
- Server starts, hatching redirect works
- Full wizard flow: welcome → identity → personality → auth → rules → celebration → chat
- Agent name persisted in config.yaml, displayed dynamically in chat page
- Revisiting `/` after hatching loads chat directly (no redirect)
