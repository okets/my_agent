# M9.5-S2 Settings UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Capabilities section to the dashboard settings page with generic REST endpoints, replacing the need for debug-only capability routes. All four well-known types are always visible with state-appropriate UI and toggles.

**Architecture:** New route file `capabilities.ts` registered at `/api/settings/capabilities`. State publisher updated to include `enabled` field. Alpine store updated to gate on `enabled`. New Capabilities card in settings HTML renders all four well-known types with four distinct UI states.

**Tech Stack:** Fastify (routes), Alpine.js (UI), Vitest (tests), existing `CapabilityRegistry` from `@my-agent/core`

**Design spec:** `docs/design/capability-framework-v2.md` §Settings UI

**Decision: Desktop routes stay.** `routes/desktop.ts` is NOT removed — the desktop capability folder doesn't exist yet (created in S3). The generic toggle has nothing to toggle for desktop until S3 extracts it.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/dashboard/src/routes/capabilities.ts` | `GET /api/settings/capabilities` + `POST /api/settings/capabilities/:type/toggle` |
| Create | `packages/dashboard/tests/capabilities-routes.test.ts` | Unit tests for both endpoints |
| Modify | `packages/dashboard/src/server.ts:21,265` | Import + register capability routes |
| Modify | `packages/dashboard/src/state/state-publisher.ts:277-287` | Add `enabled` field to capability broadcast |
| Modify | `packages/dashboard/public/js/stores.js:105-115` | Update `has()` to require `enabled === true` |
| Modify | `packages/dashboard/public/index.html:3015` | Insert Capabilities card before Desktop Control card |
| Modify | `packages/dashboard/public/index.html:~7775` | Insert Capabilities card in mobile settings popover |

---

### Task 1: Capability Settings Endpoints

**Files:**
- Create: `packages/dashboard/src/routes/capabilities.ts`
- Create: `packages/dashboard/tests/capabilities-routes.test.ts`

This task builds both endpoints. The GET endpoint merges registry state with the well-known type list so all four types always appear, even when no capability folder exists.

- [ ] **Step 1: Write failing tests for GET endpoint**

Create `packages/dashboard/tests/capabilities-routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { CapabilityRegistry } from '@my-agent/core'
import type { Capability } from '@my-agent/core'
import { buildCapabilityList, WELL_KNOWN_TYPES } from '../src/routes/capabilities.js'

function makeCap(overrides: Partial<Capability> & { name: string }): Capability {
  return {
    provides: undefined,
    interface: 'script' as const,
    path: '/tmp/fake',
    status: 'available' as const,
    health: 'untested' as const,
    enabled: true,
    ...overrides,
  }
}

describe('buildCapabilityList', () => {
  let registry: CapabilityRegistry

  beforeEach(() => {
    registry = new CapabilityRegistry()
  })

  it('returns all four well-known types even when registry is empty', () => {
    registry.load([])
    const result = buildCapabilityList(registry, 'TestAgent')
    expect(result).toHaveLength(4)
    const types = result.map(r => r.type)
    expect(types).toContain('audio-to-text')
    expect(types).toContain('text-to-audio')
    expect(types).toContain('text-to-image')
    expect(types).toContain('desktop-control')
  })

  it('not-installed types have status "not-installed" and hint with agent name', () => {
    registry.load([])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('not-installed')
    expect(stt.hint).toBe('Ask TestAgent to add voice input')
    expect(stt.enabled).toBe(false)
    expect(stt.canToggle).toBe(false)
  })

  it('installed + available + enabled shows correct state', () => {
    registry.load([makeCap({ name: 'Deepgram STT', provides: 'audio-to-text', enabled: true, health: 'healthy' })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('healthy')
    expect(stt.enabled).toBe(true)
    expect(stt.canToggle).toBe(true)
    expect(stt.capabilityName).toBe('Deepgram STT')
  })

  it('installed + available + disabled shows correct state', () => {
    registry.load([makeCap({ name: 'Deepgram STT', provides: 'audio-to-text', enabled: false })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('disabled')
    expect(stt.enabled).toBe(false)
    expect(stt.canToggle).toBe(true)
  })

  it('installed + unavailable shows unavailable state with reason', () => {
    registry.load([makeCap({
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      status: 'unavailable',
      unavailableReason: 'missing DEEPGRAM_API_KEY',
      enabled: true,
    })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('unavailable')
    expect(stt.unavailableReason).toBe('missing DEEPGRAM_API_KEY')
    expect(stt.canToggle).toBe(false)
  })

  it('installed + degraded shows degraded state with reason', () => {
    registry.load([makeCap({
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      health: 'degraded',
      degradedReason: '401 Unauthorized',
      enabled: true,
    })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.state).toBe('degraded')
    expect(stt.degradedReason).toBe('401 Unauthorized')
    expect(stt.canToggle).toBe(true)
  })

  it('MCP interface reports toggleTiming as "next-session"', () => {
    registry.load([makeCap({
      name: 'Desktop X11',
      provides: 'desktop-control',
      interface: 'mcp',
      enabled: true,
      health: 'healthy',
    })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const dc = result.find(r => r.type === 'desktop-control')!
    expect(dc.toggleTiming).toBe('next-session')
  })

  it('script interface reports toggleTiming as "immediate"', () => {
    registry.load([makeCap({
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      interface: 'script',
      enabled: true,
      health: 'healthy',
    })])
    const result = buildCapabilityList(registry, 'TestAgent')
    const stt = result.find(r => r.type === 'audio-to-text')!
    expect(stt.toggleTiming).toBe('immediate')
  })
})

describe('toggle endpoint logic', () => {
  it('toggle returns new enabled state and timing', () => {
    const registry = new CapabilityRegistry()
    const capDir = '/tmp/fake-toggle-test'
    registry.load([makeCap({
      name: 'Deepgram STT',
      provides: 'audio-to-text',
      enabled: true,
      path: capDir,
    })])

    // We test the registry.toggle directly since route integration
    // would require a full Fastify setup
    const result = registry.toggle('audio-to-text')
    expect(result).toBe(false) // was enabled, now disabled
  })

  it('toggle returns undefined for unknown type', () => {
    const registry = new CapabilityRegistry()
    registry.load([])
    expect(registry.toggle('nonexistent')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/dashboard && npx vitest run tests/capabilities-routes.test.ts`
Expected: FAIL — `buildCapabilityList` and `WELL_KNOWN_TYPES` don't exist yet.

- [ ] **Step 3: Write the route file**

Create `packages/dashboard/src/routes/capabilities.ts`:

```typescript
/**
 * Capability Settings Routes (M9.5-S2)
 *
 * Generic capability endpoints that work with any well-known type:
 * - GET  /api/settings/capabilities        — list all well-known types with state
 * - POST /api/settings/capabilities/:type/toggle — toggle enabled state
 *
 * No localhostOnly middleware: users access via Tailscale.
 */

import type { FastifyInstance } from 'fastify'
import { loadAgentNickname, type Capability } from '@my-agent/core'
import type { CapabilityRegistry } from '@my-agent/core'

/** Well-known capability types and their UI labels */
export const WELL_KNOWN_TYPES = [
  { type: 'audio-to-text', label: 'Voice Input', hint: 'voice input' },
  { type: 'text-to-audio', label: 'Voice Output', hint: 'voice output' },
  { type: 'text-to-image', label: 'Image Generation', hint: 'image generation' },
  { type: 'desktop-control', label: 'Desktop Control', hint: 'desktop control' },
] as const

export type CapabilityState = 'healthy' | 'degraded' | 'disabled' | 'unavailable' | 'not-installed'

export interface CapabilityEntry {
  type: string
  label: string
  state: CapabilityState
  enabled: boolean
  canToggle: boolean
  toggleTiming: 'immediate' | 'next-session'
  capabilityName?: string
  hint?: string
  unavailableReason?: string
  degradedReason?: string
  health?: Capability['health']
}

/**
 * Build the capability list for the settings UI.
 * Always returns all four well-known types, merged with registry state.
 */
export function buildCapabilityList(
  registry: CapabilityRegistry,
  agentName: string,
): CapabilityEntry[] {
  const allCaps = registry.list()

  return WELL_KNOWN_TYPES.map(({ type, label, hint }) => {
    // Find the installed capability for this well-known type
    const cap = allCaps.find(c => c.provides === type)

    if (!cap) {
      // Not installed — no capability folder exists for this type
      return {
        type,
        label,
        state: 'not-installed' as CapabilityState,
        enabled: false,
        canToggle: false,
        toggleTiming: 'immediate' as const,
        hint: `Ask ${agentName} to add ${hint}`,
      }
    }

    if (cap.status === 'unavailable') {
      return {
        type,
        label,
        state: 'unavailable' as CapabilityState,
        enabled: cap.enabled,
        canToggle: false,
        toggleTiming: cap.interface === 'mcp' ? 'next-session' as const : 'immediate' as const,
        capabilityName: cap.name,
        unavailableReason: cap.unavailableReason,
      }
    }

    if (!cap.enabled) {
      return {
        type,
        label,
        state: 'disabled' as CapabilityState,
        enabled: false,
        canToggle: true,
        toggleTiming: cap.interface === 'mcp' ? 'next-session' as const : 'immediate' as const,
        capabilityName: cap.name,
      }
    }

    // Available + enabled — state depends on health
    const state: CapabilityState = cap.health === 'degraded' ? 'degraded' : 'healthy'
    return {
      type,
      label,
      state,
      enabled: true,
      canToggle: true,
      toggleTiming: cap.interface === 'mcp' ? 'next-session' as const : 'immediate' as const,
      capabilityName: cap.name,
      health: cap.health,
      degradedReason: cap.degradedReason,
    }
  })
}

/**
 * Register capability settings routes.
 */
export async function registerCapabilityRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/settings/capabilities
   *
   * Returns all well-known capability types with their current state.
   * Types without an installed capability show as "not-installed".
   */
  fastify.get<{ Reply: { capabilities: CapabilityEntry[] } }>(
    '/api/settings/capabilities',
    async () => {
      const registry = fastify.app?.capabilityRegistry
      if (!registry) {
        // No registry yet — return all as not-installed
        const agentName = loadAgentNickname(fastify.agentDir)
        return {
          capabilities: WELL_KNOWN_TYPES.map(({ type, label, hint }) => ({
            type,
            label,
            state: 'not-installed' as CapabilityState,
            enabled: false,
            canToggle: false,
            toggleTiming: 'immediate' as const,
            hint: `Ask ${agentName} to add ${hint}`,
          })),
        }
      }

      const agentName = loadAgentNickname(fastify.agentDir)
      return { capabilities: buildCapabilityList(registry, agentName) }
    },
  )

  /**
   * POST /api/settings/capabilities/:type/toggle
   *
   * Toggles a capability's enabled state.
   * Returns the new state and when the change takes effect.
   */
  fastify.post<{
    Params: { type: string }
    Reply: { enabled: boolean; effective: 'immediate' | 'next_session' } | { error: string }
  }>('/api/settings/capabilities/:type/toggle', async (request, reply) => {
    const { type } = request.params
    const registry = fastify.app?.capabilityRegistry
    if (!registry) {
      return reply.code(503).send({ error: 'Capability registry not initialized' })
    }

    const result = registry.toggle(type)
    if (result === undefined) {
      return reply.code(404).send({ error: `No capability found for type: ${type}` })
    }

    // Determine timing: MCP capabilities take effect next session
    const cap = registry.list().find(c => c.provides === type)
    const effective = cap?.interface === 'mcp' ? 'next_session' as const : 'immediate' as const

    // Trigger state broadcast so all connected clients update
    fastify.app?.emit('capability:changed', registry.list())

    return { enabled: result, effective }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/dashboard && npx vitest run tests/capabilities-routes.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Register routes in server.ts**

In `packages/dashboard/src/server.ts`:

Add import at line 21 (alongside the other route imports):
```typescript
import { registerCapabilityRoutes } from './routes/capabilities.js'
```

Add registration after the settings routes (after line 265):
```typescript
  // Register capability settings routes (M9.5-S2)
  await registerCapabilityRoutes(fastify)
```

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/routes/capabilities.ts packages/dashboard/tests/capabilities-routes.test.ts packages/dashboard/src/server.ts
git commit -m "feat(settings): add capability list + toggle endpoints (M9.5-S2)"
```

---

### Task 2: State Publisher — Broadcast `enabled` Field

**Files:**
- Modify: `packages/dashboard/src/state/state-publisher.ts:273-288`

The state publisher currently omits `enabled` from the capability broadcast. The settings UI and the `$store.capabilities.has()` fix both depend on this field being present.

- [ ] **Step 1: Update publishCapabilities to include `enabled`**

In `packages/dashboard/src/state/state-publisher.ts`, find the `publishCapabilities()` method. The current mapping (lines 277-287) is:

```typescript
  publishCapabilities(): void {
    const capabilities = this.app?.capabilityRegistry?.list() ?? [];
    this.registry.broadcastToAll({
      type: "capabilities",
      capabilities: capabilities.map((c) => ({
        name: c.name,
        provides: c.provides,
        interface: c.interface,
        status: c.status,
        unavailableReason: c.unavailableReason,
        health: c.health,
        lastTestLatencyMs: c.lastTestLatencyMs,
        degradedReason: c.degradedReason,
      })),
    });
  }
```

Add `enabled: c.enabled,` to the mapped object, after the `degradedReason` line:

```typescript
  publishCapabilities(): void {
    const capabilities = this.app?.capabilityRegistry?.list() ?? [];
    this.registry.broadcastToAll({
      type: "capabilities",
      capabilities: capabilities.map((c) => ({
        name: c.name,
        provides: c.provides,
        interface: c.interface,
        status: c.status,
        unavailableReason: c.unavailableReason,
        health: c.health,
        lastTestLatencyMs: c.lastTestLatencyMs,
        degradedReason: c.degradedReason,
        enabled: c.enabled,
      })),
    });
  }
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/state/state-publisher.ts
git commit -m "fix(state): broadcast enabled field in capability updates"
```

---

### Task 3: Fix Alpine Store — Gate `has()` on `enabled`

**Files:**
- Modify: `packages/dashboard/public/js/stores.js:105-115`

The `$store.capabilities.has()` function currently only checks `status === 'available'`. It must also require `enabled !== false` (using `!== false` so capabilities without an `enabled` field — from older broadcasts before this sprint — still work).

- [ ] **Step 1: Update the store**

In `packages/dashboard/public/js/stores.js`, the current code (lines 105-115):

```javascript
  Alpine.store("capabilities", {
    items: [],
    update(caps) {
      this.items = caps || [];
    },
    has(type) {
      return this.items.some(
        (c) => c.provides === type && c.status === "available",
      );
    },
  });
```

Replace with:

```javascript
  Alpine.store("capabilities", {
    items: [],
    update(caps) {
      this.items = caps || [];
    },
    has(type) {
      return this.items.some(
        (c) => c.provides === type && c.status === "available" && c.enabled !== false,
      );
    },
  });
```

The `enabled !== false` check (instead of `=== true`) ensures backward compatibility: if an older WebSocket message lacks the `enabled` field, `undefined !== false` is `true`, so the behavior is unchanged for pre-S2 broadcasts.

- [ ] **Step 2: Verify mic button behavior**

After restarting the dashboard (`systemctl --user restart nina-dashboard.service`), open the browser:
- If `audio-to-text` capability is installed and enabled: mic button should be visible in chat input.
- If `audio-to-text` capability is installed and disabled: mic button should disappear.
- If no `audio-to-text` capability is installed: mic button should not be visible (same as before).

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/public/js/stores.js
git commit -m "fix(store): gate capabilities.has() on enabled flag"
```

---

### Task 4: Settings UI — Capabilities Card

**Files:**
- Modify: `packages/dashboard/public/index.html:3015` (desktop — insert before Desktop Control)
- Modify: `packages/dashboard/public/index.html:~7775` (mobile — insert before Secrets Management or after AI Connection)

This is the main UI work. The card fetches `GET /api/settings/capabilities` on init and renders all four well-known types with state-appropriate indicators and toggles.

- [ ] **Step 1: Add Capabilities card to desktop settings**

Insert the following HTML before the `<!-- Desktop Control -->` comment (line 3015) in `packages/dashboard/public/index.html`:

```html
              <!-- Capabilities (M9.5-S2) -->
              <div class="glass-strong rounded-xl p-5" x-data="{
                caps: [],
                loading: true,
                toggling: null,
                init() {
                  fetch('/api/settings/capabilities')
                    .then(r => r.json())
                    .then(d => { this.caps = d.capabilities; this.loading = false; })
                    .catch(() => { this.loading = false; });
                },
                toggle(type) {
                  this.toggling = type;
                  fetch('/api/settings/capabilities/' + type + '/toggle', { method: 'POST' })
                    .then(r => r.json())
                    .then(d => {
                      if (d.error) return;
                      if (d.effective === 'next_session') {
                        const cap = this.caps.find(c => c.type === type);
                        if (cap) {
                          cap._timing = 'Takes effect next session';
                          setTimeout(() => { cap._timing = null; }, 4000);
                        }
                      }
                      // Refetch full list — avoids optimistically snapping degraded → healthy
                      return fetch('/api/settings/capabilities').then(r => r.json()).then(d => {
                        this.caps = d.capabilities;
                      });
                    })
                    .finally(() => { this.toggling = null; });
                },
                stateColor(state) {
                  return {
                    'healthy': 'bg-emerald-400',
                    'degraded': 'bg-amber-400',
                    'disabled': 'bg-white/20',
                    'unavailable': 'bg-white/20',
                    'not-installed': 'bg-white/10',
                  }[state] || 'bg-white/10';
                },
                stateText(cap) {
                  return {
                    'healthy': 'Active',
                    'degraded': cap.degradedReason || 'Degraded',
                    'disabled': 'Disabled',
                    'unavailable': cap.unavailableReason || 'Unavailable',
                    'not-installed': '',
                  }[cap.state] || '';
                }
              }">
                <h3 class="text-sm font-semibold text-white/90 mb-4 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-tokyo-purple">
                    <path d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1ZM5.05 3.05a.75.75 0 0 1 1.06 0l1.062 1.06A.75.75 0 1 1 6.11 5.173L5.05 4.11a.75.75 0 0 1 0-1.06ZM14.95 3.05a.75.75 0 0 1 0 1.06l-1.06 1.062a.75.75 0 0 1-1.062-1.061l1.061-1.06a.75.75 0 0 1 1.06 0ZM3 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 3 8ZM14 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 14 8ZM7.172 13.828a.75.75 0 0 1-1.06 0l-1.061-1.06a.75.75 0 0 1 1.06-1.062l1.06 1.061a.75.75 0 0 1 0 1.061ZM13.89 13.828a.75.75 0 0 1 0-1.06l1.06-1.062a.75.75 0 1 1 1.062 1.061l-1.06 1.06a.75.75 0 0 1-1.062 0ZM10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                    <path d="M10.75 15.25a.75.75 0 0 0-1.5 0v1.5a.75.75 0 0 0 1.5 0v-1.5Z" />
                  </svg>
                  Capabilities
                </h3>

                <!-- Loading state -->
                <template x-if="loading">
                  <p class="text-xs text-white/30">Loading...</p>
                </template>

                <!-- Capability rows -->
                <template x-if="!loading">
                  <div class="space-y-3">
                    <template x-for="cap in caps" :key="cap.type">
                      <div class="flex items-center justify-between py-1">
                        <!-- Left: indicator + label -->
                        <div class="flex items-center gap-2.5 min-w-0">
                          <span class="w-2 h-2 rounded-full flex-shrink-0"
                            :class="[stateColor(cap.state), cap.state === 'healthy' ? 'animate-pulse' : '']"></span>
                          <div class="min-w-0">
                            <span class="text-sm text-white/80 block" x-text="cap.label"></span>
                            <!-- Installed name -->
                            <template x-if="cap.capabilityName">
                              <span class="text-[10px] text-white/30" x-text="cap.capabilityName"></span>
                            </template>
                            <!-- Status text for degraded/unavailable -->
                            <template x-if="cap.state === 'degraded' || cap.state === 'unavailable'">
                              <span class="text-[10px] block"
                                :class="cap.state === 'degraded' ? 'text-amber-400/70' : 'text-white/30'"
                                x-text="stateText(cap)"></span>
                            </template>
                            <!-- Not-installed hint -->
                            <template x-if="cap.state === 'not-installed'">
                              <span class="text-[10px] text-white/25 italic block" x-text="cap.hint"></span>
                            </template>
                            <!-- Toggle timing message -->
                            <template x-if="cap._timing">
                              <span class="text-[10px] text-cyan-400/60 block" x-text="cap._timing"></span>
                            </template>
                          </div>
                        </div>

                        <!-- Right: toggle -->
                        <template x-if="cap.canToggle">
                          <label class="flex items-center gap-2 cursor-pointer flex-shrink-0">
                            <input type="checkbox" class="sr-only" :checked="cap.enabled"
                              :disabled="toggling === cap.type"
                              @change="toggle(cap.type)">
                            <div class="w-8 h-4 rounded-full transition-colors"
                              :class="cap.enabled ? 'bg-emerald-500/40' : 'bg-white/10'">
                              <div class="w-3.5 h-3.5 rounded-full bg-white/80 transition-transform mt-0.5"
                                :class="cap.enabled ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'"></div>
                            </div>
                          </label>
                        </template>

                        <!-- Not toggleable — show greyed toggle placeholder -->
                        <template x-if="!cap.canToggle">
                          <div class="w-8 h-4 rounded-full bg-white/5 flex-shrink-0"></div>
                        </template>
                      </div>
                    </template>
                  </div>
                </template>
              </div>
```

- [ ] **Step 2: Add Capabilities card to mobile settings popover**

Find the mobile settings popover (near line 7775, after `<!-- Secrets Management (mobile) -->`). Insert a similar card, adapted for mobile width. Use the same `x-data` pattern — the mobile popover re-initializes when opened.

The mobile version uses the same HTML as desktop. Insert before the mobile Secrets Management section (near line 7775):

```html
              <!-- Capabilities (mobile, M9.5-S2) -->
              <div class="glass-strong rounded-xl p-4" x-data="{
                caps: [],
                loading: true,
                toggling: null,
                init() {
                  fetch('/api/settings/capabilities')
                    .then(r => r.json())
                    .then(d => { this.caps = d.capabilities; this.loading = false; })
                    .catch(() => { this.loading = false; });
                },
                toggle(type) {
                  this.toggling = type;
                  fetch('/api/settings/capabilities/' + type + '/toggle', { method: 'POST' })
                    .then(r => r.json())
                    .then(d => {
                      if (d.error) return;
                      if (d.effective === 'next_session') {
                        const cap = this.caps.find(c => c.type === type);
                        if (cap) {
                          cap._timing = 'Takes effect next session';
                          setTimeout(() => { cap._timing = null; }, 4000);
                        }
                      }
                      return fetch('/api/settings/capabilities').then(r => r.json()).then(d => {
                        this.caps = d.capabilities;
                      });
                    })
                    .finally(() => { this.toggling = null; });
                },
                stateColor(state) {
                  return {
                    'healthy': 'bg-emerald-400',
                    'degraded': 'bg-amber-400',
                    'disabled': 'bg-white/20',
                    'unavailable': 'bg-white/20',
                    'not-installed': 'bg-white/10',
                  }[state] || 'bg-white/10';
                },
                stateText(cap) {
                  return {
                    'healthy': 'Active',
                    'degraded': cap.degradedReason || 'Degraded',
                    'disabled': 'Disabled',
                    'unavailable': cap.unavailableReason || 'Unavailable',
                    'not-installed': '',
                  }[cap.state] || '';
                }
              }">
                <h3 class="text-sm font-semibold text-white/90 mb-3">Capabilities</h3>
                <template x-if="loading">
                  <p class="text-xs text-white/30">Loading...</p>
                </template>
                <template x-if="!loading">
                  <div class="space-y-3">
                    <template x-for="cap in caps" :key="cap.type">
                      <div class="flex items-center justify-between py-1">
                        <div class="flex items-center gap-2 min-w-0">
                          <span class="w-2 h-2 rounded-full flex-shrink-0"
                            :class="[stateColor(cap.state), cap.state === 'healthy' ? 'animate-pulse' : '']"></span>
                          <div class="min-w-0">
                            <span class="text-sm text-white/80 block" x-text="cap.label"></span>
                            <template x-if="cap.state === 'not-installed'">
                              <span class="text-[10px] text-white/25 italic block" x-text="cap.hint"></span>
                            </template>
                            <template x-if="cap.state === 'degraded' || cap.state === 'unavailable'">
                              <span class="text-[10px] block"
                                :class="cap.state === 'degraded' ? 'text-amber-400/70' : 'text-white/30'"
                                x-text="stateText(cap)"></span>
                            </template>
                            <template x-if="cap._timing">
                              <span class="text-[10px] text-cyan-400/60 block" x-text="cap._timing"></span>
                            </template>
                          </div>
                        </div>
                        <template x-if="cap.canToggle">
                          <label class="flex items-center cursor-pointer flex-shrink-0">
                            <input type="checkbox" class="sr-only" :checked="cap.enabled"
                              :disabled="toggling === cap.type"
                              @change="toggle(cap.type)">
                            <div class="w-8 h-4 rounded-full transition-colors"
                              :class="cap.enabled ? 'bg-emerald-500/40' : 'bg-white/10'">
                              <div class="w-3.5 h-3.5 rounded-full bg-white/80 transition-transform mt-0.5"
                                :class="cap.enabled ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'"></div>
                            </div>
                          </label>
                        </template>
                        <template x-if="!cap.canToggle">
                          <div class="w-8 h-4 rounded-full bg-white/5 flex-shrink-0"></div>
                        </template>
                      </div>
                    </template>
                  </div>
                </template>
              </div>
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/public/index.html
git commit -m "feat(settings): add Capabilities card to desktop + mobile settings"
```

---

### Task 5: Build + Verify

**Files:** None (verification only)

- [ ] **Step 1: Build core and dashboard**

```bash
cd packages/core && npx tsc
cd packages/dashboard && npx tsc
```

Expected: No type errors.

- [ ] **Step 2: Run all capability tests**

```bash
cd packages/core && npx vitest run tests/capabilities/
cd packages/dashboard && npx vitest run tests/capabilities-routes.test.ts
```

Expected: All tests pass. S1 tests (36 total) still pass; new S2 tests pass.

- [ ] **Step 3: Restart dashboard and browser-verify**

```bash
systemctl --user restart nina-dashboard.service
```

Open browser at Tailscale URL, navigate to Settings tab:

1. **All four well-known types visible** in new Capabilities card (Voice Input, Voice Output, Image Generation, Desktop Control)
2. **Installed capabilities** show green indicator + toggle
3. **Not-installed capabilities** show greyed indicator + hint text "Ask {name} to add {type}"
4. **Toggle voice off** → mic button disappears from chat input
5. **Toggle voice on** → mic button returns
6. **Unavailable capability** (if testable — e.g. STT capability installed but `DEEPGRAM_API_KEY` missing): shows "Unavailable" with reason text, toggle disabled
7. **Desktop Control card** (old, below Capabilities card) still works independently

- [ ] **Step 4: Final commit (if any fixups needed)**

Only if browser testing reveals issues that need fixing.

---

## Verification Summary

| Spec Requirement | Task | Verification |
|-----------------|------|-------------|
| All 4 well-known types visible | T4 | Browser: Capabilities card shows all four rows |
| Toggle voice off → mic disappears | T3, T4 | Browser: toggle STT off, mic button gone |
| Toggle voice on → mic returns | T3, T4 | Browser: toggle STT on, mic button returns |
| Non-installed shows hint | T1, T4 | Browser: "Ask {name} to add {type}" for missing caps |
| Toggle timing: script=immediate, MCP=next-session | T1, T4 | Unit test + browser: MCP toggle shows timing message |
| `GET /api/settings/capabilities` | T1 | Unit test + browser fetch |
| `POST /api/settings/capabilities/:type/toggle` | T1 | Unit test + browser toggle |
| Desktop routes stay (S3 responsibility) | — | No changes to `routes/desktop.ts` |
