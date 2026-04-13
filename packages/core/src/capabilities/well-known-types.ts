/**
 * Well-known capability type registry (M9.5-S7).
 *
 * The dashboard renders these types regardless of whether any instance is
 * installed, so users see a consistent settings layout and a hint pointing
 * them at the agent for installation.
 *
 * `multiInstance: true` means the type can have several instances rendered
 * side-by-side in a group card (e.g. `browser-control`). Singletons render
 * exactly one row.
 */

export interface WellKnownType {
  type: string
  label: string
  multiInstance: boolean
  /** simple-icons slug used as a fallback when an instance has no icon. */
  iconSlug?: string
  /**
   * UI hint for the empty / always-visible "ask the agent to add one" line.
   * `{agent}` is replaced by the agent's nickname at render time.
   */
  hint: string
}

export const WELL_KNOWN_TYPES: readonly WellKnownType[] = [
  {
    type: 'audio-to-text',
    label: 'Voice Input',
    multiInstance: false,
    hint: 'Ask {agent} to add voice input',
  },
  {
    type: 'text-to-audio',
    label: 'Voice Output',
    multiInstance: false,
    hint: 'Ask {agent} to add voice output',
  },
  {
    type: 'text-to-image',
    label: 'Image Generation',
    multiInstance: false,
    hint: 'Ask {agent} to add image generation',
  },
  {
    type: 'desktop-control',
    label: 'Desktop Control',
    multiInstance: false,
    hint: 'Ask {agent} to add desktop control',
  },
  {
    type: 'browser-control',
    label: 'Browsers',
    multiInstance: true,
    iconSlug: 'browser',
    hint: 'Ask {agent} to add any browser.',
  },
] as const

export function getWellKnownType(type: string): WellKnownType | undefined {
  return WELL_KNOWN_TYPES.find((t) => t.type === type)
}
