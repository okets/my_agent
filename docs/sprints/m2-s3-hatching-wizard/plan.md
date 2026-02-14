# Sprint M2-S3: Web Hatching Wizard

> **Status:** Complete
> **Started:** 2026-02-13

## Goal

Browser-based setup wizard that replaces the CLI hatching flow. Polished, conversational, fun — like meeting a new friend, not filling out a form.

## UX Design

Full UX spec from the design phase. Key points:

**Flow:** Welcome → Identity → Personality → Auth → Rules (optional) → Celebration → Chat

**Tone:** Nina speaks in first person. Warm, slightly playful, never robotic.

**Visual:** Tokyo Night dark theme, centered card (~560px), step indicator dots, smooth slide transitions, purple-pink gradient accents.

**Personality cards:** 2-column grid, emoji + name + tagline, gradient border on select.

**Celebration:** Egg wobble → crack → confetti burst → personalized greeting → "Start chatting" button.

## Tasks

### Task 1: Extract Hatching Logic from Core

Extract pure data/file-writing logic from CLI hatching steps into reusable functions. The CLI steps currently mix readline I/O with file operations. We need the file operations separated so the web can call them.

**Files:**
- `packages/core/src/hatching/logic.ts` — NEW: pure functions for each step
- `packages/core/src/lib.ts` — MODIFY: re-export new functions

**Functions to extract:**
```typescript
// From identity step
writeIdentity(agentDir: string, data: { name: string, purpose: string, contacts?: string }): Promise<void>

// From personality step
getPersonalities(): Promise<{ name: string, description: string, filename: string }[]>
applyPersonality(agentDir: string, choice: string): Promise<void>  // name or 'custom'
writeCustomPersonality(agentDir: string, text: string): Promise<void>

// From auth step
checkEnvAuth(): { type: 'api_key' | 'oauth', preview: string } | null
saveAuth(agentDir: string, method: 'api_key' | 'setup_token', token: string): void

// From operating-rules step
writeOperatingRules(agentDir: string, data: { autonomy: string, escalations: string, style: string }): Promise<void>

// From hatching/index.ts
createDirectoryStructure(agentDir: string): Promise<void>
writeMinimalConfig(agentDir: string): Promise<void>
writeHatchedMarker(agentDir: string): Promise<void>
```

**Done when:** All functions exported and `tsc --noEmit` clean. Existing CLI hatching still works.

### Task 2: REST Routes for Hatching

Fastify routes that the wizard frontend calls.

**Files:**
- `packages/dashboard/src/routes/hatching.ts` — NEW: REST routes
- `packages/dashboard/src/server.ts` — MODIFY: register hatching routes

**Routes:**
```
GET  /api/hatching/status
  → { hatched: boolean, envAuth: { type, preview } | null }

GET  /api/hatching/personalities
  → { personalities: { name, description, emoji }[] }

POST /api/hatching/step/identity
  body: { name, purpose, contacts? }
  → { success: true }

POST /api/hatching/step/personality
  body: { choice: string } | { custom: string }
  → { success: true }

POST /api/hatching/step/auth
  body: { method: 'api_key'|'setup_token'|'env', token?: string }
  → { success: true } | { success: false, error: string }

POST /api/hatching/step/rules
  body: { autonomy, escalations, style }
  → { success: true }

POST /api/hatching/complete
  → { success: true }
  (writes config + .hatched marker, sets server.isHatched = true)
```

**Done when:** All routes work via curl, proper validation and error responses.

### Task 3: Wizard Frontend — HTML + CSS

The wizard view with all steps, following the UX spec exactly.

**Files:**
- `packages/dashboard/public/hatching.html` — NEW: wizard SPA (separate from chat)
- `packages/dashboard/public/css/hatching.css` — NEW: wizard-specific styles
- `packages/dashboard/public/index.html` — MODIFY: detect hatching state, redirect

**Implementation:**
- Alpine.js component `hatchingWizard()` with state machine for steps
- Welcome screen, 4 step screens, celebration screen
- Step indicator dots
- Personality cards (2-column grid with emojis)
- Auth method cards with env detection
- Operating rules with card selection
- All copy from UX spec
- Slide transitions between steps
- Confetti animation on completion
- "Start chatting" redirects to index.html (chat)

**Routing:**
- `index.html` on load calls `GET /api/hatching/status`
- If not hatched → redirect to `hatching.html`
- After hatching complete → redirect to `index.html` (chat)

**Done when:** Opening hatching.html shows the full wizard with all steps navigable.

### Task 4: Wizard Frontend — JavaScript Logic

The Alpine.js component that drives the wizard: API calls, validation, state management.

**Files:**
- `packages/dashboard/public/js/hatching.js` — NEW: Alpine.js wizard component

**Component state:**
```javascript
{
  currentStep: 'welcome',  // welcome, identity, personality, auth, rules, celebration
  // Identity
  name: '', purpose: '', purposeSpecific: '', contacts: '',
  // Personality
  personalities: [], selectedPersonality: null, customText: '',
  // Auth
  envAuth: null, authMethod: null, authToken: '', authError: '',
  // Rules
  autonomy: 'balanced', escalations: '', style: 'adaptive',
  // UI
  isSubmitting: false, errors: {}
}
```

**Methods:** `goNext()`, `goBack()`, `submitStep()`, `skipRules()`, `startChatting()`

**Done when:** Full wizard flow works: fill fields → submit each step → see celebration → redirect to chat.

### Task 5: Integration + Review

Wire everything together, test full flow, handle edge cases.

**Verification:**
1. `npx tsc --noEmit` — clean compilation
2. Fresh start (delete .my_agent/) → navigate to dashboard → wizard appears
3. Complete all steps → celebration → chat loads
4. Refresh page → chat loads (already hatched)
5. All validation messages work
6. Auth step detects env vars

## Dependencies

```
Task 1 (core logic extraction)
  └── Task 2 (REST routes) ──────────┐
                                      ├── Task 5 (integration)
  Task 3 (HTML/CSS) ──┐              │
                       ├── Task 4 ────┘
  Task 3 doesn't need Task 1
```

Task 1 and Task 3 can be parallel. Task 2 needs Task 1. Task 4 needs Task 3. Task 5 needs all.
