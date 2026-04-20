/**
 * Capability Settings Routes (M9.5-S2 → S7)
 *
 * - GET    /api/settings/capabilities                    — v1, singleton-shaped, unchanged
 * - POST   /api/settings/capabilities/:type/toggle       — v1 toggle, singleton (delegates to toggleByName)
 * - GET    /api/settings/capabilities/v2                 — v2, multi-instance shape
 * - POST   /api/settings/capabilities/:type/:instance/toggle  — v2, per-instance toggle
 * - DELETE /api/settings/capabilities/:type/:instance    — v2, per-instance delete
 *
 * No localhostOnly middleware: users access via Tailscale.
 */

import type { FastifyInstance } from 'fastify'
import {
  loadAgentNickname,
  CAPABILITY_WELL_KNOWN_TYPES,
  type Capability,
  type WellKnownCapabilityType,
} from '@my-agent/core'
import type { CapabilityRegistry } from '@my-agent/core'

/**
 * Legacy v1 type list (singleton-only). Kept exported for the existing
 * tests + callers that still expect this shape.
 */
export const WELL_KNOWN_TYPES = CAPABILITY_WELL_KNOWN_TYPES
  .filter((t) => !t.multiInstance)
  .map((t) => ({
    type: t.type,
    label: t.label,
    hint: hintWord(t),
  })) as readonly { type: string; label: string; hint: string }[]

/** Strip the leading "Ask {agent} to add " from the v2 hint to recover the
 *  short hint word the v1 entries used to use. */
function hintWord(t: WellKnownCapabilityType): string {
  const m = t.hint.match(/^Ask \{agent\} to add (.+?)\.?$/)
  return m ? m[1] : t.label.toLowerCase()
}

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

/* -------------------------------------------------------------------------
 * v2 shapes
 * ----------------------------------------------------------------------- */

export interface CapabilityInstanceV2 {
  /** unique capability name (e.g. `browser-chrome`) */
  name: string
  /** display label */
  label: string
  /** simple-icons slug, fallback to type-level slug, fallback to 'generic' */
  iconSlug?: string
  enabled: boolean
  state: CapabilityState
  canToggle: boolean
  canDelete: boolean
  toggleTiming: 'immediate' | 'next-session'
  unavailableReason?: string
  degradedReason?: string
  health?: Capability['health']
}

export interface CapabilityTypeV2 {
  type: string
  label: string
  multiInstance: boolean
  /** Persistent hint with `{agent}` already substituted. */
  hint: string
  iconSlug?: string
  instances: CapabilityInstanceV2[]
}

/* -------------------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------------------- */

function deriveInstanceState(cap: Capability): CapabilityState {
  if (cap.status === 'unavailable') return 'unavailable'
  if (!cap.enabled) return 'disabled'
  if (cap.health === 'degraded') return 'degraded'
  return 'healthy'
}

function toggleTimingFor(cap: Capability): 'immediate' | 'next-session' {
  return cap.interface === 'mcp' ? 'next-session' : 'immediate'
}

function toInstanceV2(cap: Capability, typeFallbackIcon?: string): CapabilityInstanceV2 {
  const state = deriveInstanceState(cap)
  return {
    name: cap.name,
    label: cap.name,
    iconSlug: cap.iconSlug ?? typeFallbackIcon,
    enabled: cap.enabled,
    state,
    canToggle: cap.status === 'available',
    canDelete: cap.canDelete === true,
    toggleTiming: toggleTimingFor(cap),
    unavailableReason: cap.unavailableReason,
    degradedReason: cap.degradedReason,
    health: cap.health,
  }
}

/**
 * Build the v2 capability list — one entry per well-known type, each with
 * an `instances[]` array. Singletons get one (or zero) instance; multi-
 * instance types get all matching capabilities.
 *
 * Capabilities whose `provides` is not a well-known type are dropped from
 * the settings UI by design — they are not user-toggleable.
 */
export function buildCapabilityListV2(
  registry: CapabilityRegistry,
  agentName: string,
): CapabilityTypeV2[] {
  const allCaps = registry.list()
  return CAPABILITY_WELL_KNOWN_TYPES.map((wkt) => {
    const matching = allCaps.filter((c) => c.provides === wkt.type)
    return {
      type: wkt.type,
      label: wkt.label,
      multiInstance: wkt.multiInstance,
      hint: wkt.hint.replace('{agent}', agentName),
      iconSlug: wkt.iconSlug,
      instances: matching.map((c) => toInstanceV2(c, wkt.iconSlug)),
    }
  })
}

/**
 * Build the v1 capability list for the settings UI.
 * Always returns all four singleton well-known types, merged with registry state.
 *
 * Kept for the legacy `GET /api/settings/capabilities` endpoint and for tests
 * that import it directly.
 */
export function buildCapabilityList(
  registry: CapabilityRegistry,
  agentName: string,
): CapabilityEntry[] {
  const allCaps = registry.list()

  return WELL_KNOWN_TYPES.map(({ type, label, hint }) => {
    const cap = allCaps.find((c) => c.provides === type)

    if (!cap) {
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
        toggleTiming: cap.interface === 'mcp' ? ('next-session' as const) : ('immediate' as const),
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
        toggleTiming: cap.interface === 'mcp' ? ('next-session' as const) : ('immediate' as const),
        capabilityName: cap.name,
      }
    }

    const state: CapabilityState = cap.health === 'degraded' ? 'degraded' : 'healthy'
    return {
      type,
      label,
      state,
      enabled: true,
      canToggle: true,
      toggleTiming: cap.interface === 'mcp' ? ('next-session' as const) : ('immediate' as const),
      capabilityName: cap.name,
      health: cap.health,
      degradedReason: cap.degradedReason,
    }
  })
}

/* -------------------------------------------------------------------------
 * Routes
 * ----------------------------------------------------------------------- */

export async function registerCapabilityRoutes(fastify: FastifyInstance): Promise<void> {
  // ---- v1: GET singleton-shape list (unchanged behaviour) ----
  fastify.get<{ Reply: { capabilities: CapabilityEntry[] } }>(
    '/api/settings/capabilities',
    async () => {
      const registry = fastify.app?.capabilityRegistry
      if (!registry) {
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

  // ---- v1: per-type toggle (delegates to toggleByName under the hood) ----
  fastify.post<{
    Params: { type: string }
    Reply: { enabled: boolean; effective: 'immediate' | 'next_session' } | { error: string }
  }>('/api/settings/capabilities/:type/toggle', async (request, reply) => {
    const { type } = request.params
    const registry = fastify.app?.capabilityRegistry
    if (!registry) {
      return reply.code(503).send({ error: 'Capability registry not initialized' })
    }

    // Find the first instance of this type so we can use toggleByName.
    const instances = registry.listByProvides(type)
    if (instances.length === 0) {
      return reply.code(404).send({ error: `No capability found for type: ${type}` })
    }
    const target = instances[0]
    const result = registry.toggleByName(target.name)
    if (result === undefined) {
      return reply.code(404).send({ error: `No capability found for type: ${type}` })
    }

    const effective = target.interface === 'mcp' ? ('next_session' as const) : ('immediate' as const)
    fastify.app?.emit('capability:changed', registry.list())

    return { enabled: result, effective }
  })

  // ---- v2: GET multi-instance list ----
  fastify.get<{ Reply: { capabilities: CapabilityTypeV2[] } }>(
    '/api/settings/capabilities/v2',
    async () => {
      const registry = fastify.app?.capabilityRegistry
      const agentName = loadAgentNickname(fastify.agentDir)
      if (!registry) {
        return {
          capabilities: CAPABILITY_WELL_KNOWN_TYPES.map((wkt) => ({
            type: wkt.type,
            label: wkt.label,
            multiInstance: wkt.multiInstance,
            hint: wkt.hint.replace('{agent}', agentName),
            iconSlug: wkt.iconSlug,
            instances: [],
          })),
        }
      }
      return { capabilities: buildCapabilityListV2(registry, agentName) }
    },
  )

  // ---- v2: per-instance toggle ----
  fastify.post<{
    Params: { type: string; instance: string }
    Reply: { enabled: boolean; effective: 'immediate' | 'next_session' } | { error: string }
  }>('/api/settings/capabilities/:type/:instance/toggle', async (request, reply) => {
    const { type, instance } = request.params
    const registry = fastify.app?.capabilityRegistry
    if (!registry) {
      return reply.code(503).send({ error: 'Capability registry not initialized' })
    }

    const target = registry.list().find((c) => c.name === instance)
    if (!target) {
      return reply.code(404).send({ error: `No capability instance: ${instance}` })
    }
    if (target.provides !== type) {
      return reply
        .code(400)
        .send({ error: `Instance ${instance} does not provide type ${type}` })
    }

    const result = registry.toggleByName(instance)
    if (result === undefined) {
      return reply.code(404).send({ error: `No capability instance: ${instance}` })
    }

    const effective = target.interface === 'mcp' ? ('next_session' as const) : ('immediate' as const)
    fastify.app?.emit('capability:changed', registry.list())

    return { enabled: result, effective }
  })

  // ---- v2: per-instance delete ----
  fastify.delete<{
    Params: { type: string; instance: string }
    Querystring: { wipeProfile?: string }
    Reply: { deleted: boolean; wipedProfile: boolean } | { error: string }
  }>('/api/settings/capabilities/:type/:instance', async (request, reply) => {
    const { type, instance } = request.params
    const wipeProfile = request.query.wipeProfile === 'true'
    const registry = fastify.app?.capabilityRegistry
    if (!registry) {
      return reply.code(503).send({ error: 'Capability registry not initialized' })
    }

    const target = registry.list().find((c) => c.name === instance)
    if (!target) {
      return reply.code(404).send({ error: `No capability instance: ${instance}` })
    }
    if (target.provides !== type) {
      return reply
        .code(400)
        .send({ error: `Instance ${instance} does not provide type ${type}` })
    }
    if (!target.canDelete) {
      return reply
        .code(403)
        .send({ error: `Capability ${instance} is not deletable (singleton type).` })
    }

    try {
      const removed = registry.delete(instance, { wipeProfile })
      if (!removed) {
        return reply.code(404).send({ error: `No capability instance: ${instance}` })
      }
    } catch (err) {
      return reply
        .code(500)
        .send({ error: err instanceof Error ? err.message : 'Failed to delete capability' })
    }

    fastify.app?.emit('capability:changed', registry.list())
    return { deleted: true, wipedProfile: wipeProfile }
  })

  // ─── S19: system-origin CFR event ring buffer ──────────────────────────────
  fastify.get('/api/capabilities/cfr-system-events', async () => {
    const events = fastify.app?.ackDelivery?.getSystemEvents() ?? [];
    return { events };
  });
}
