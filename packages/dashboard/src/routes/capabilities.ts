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
    const cap = allCaps.find(c => c.provides === type)

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

    const cap = registry.list().find(c => c.provides === type)
    const effective = cap?.interface === 'mcp' ? 'next_session' as const : 'immediate' as const

    fastify.app?.emit('capability:changed', registry.list())

    return { enabled: result, effective }
  })
}
