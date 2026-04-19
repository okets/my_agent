/** Parsed and expanded .mcp.json config from a capability folder */
export interface CapabilityMcpConfig {
  [key: string]: unknown
}

export interface Capability {
  name: string
  provides?: string // well-known type (e.g. 'audio-to-text') or undefined for custom
  interface: 'script' | 'mcp'
  path: string // absolute path to capability folder
  status: 'available' | 'unavailable' | 'invalid'
  unavailableReason?: string // e.g. "missing DEEPGRAM_API_KEY"
  error?: string // parse/validation error when status is 'invalid'
  health: 'healthy' | 'degraded' | 'untested'
  degradedReason?: string // e.g. "401 Unauthorized"
  lastTestLatencyMs?: number // milliseconds for last successful test
  mcpConfig?: CapabilityMcpConfig // expanded .mcp.json for interface: 'mcp' capabilities
  enabled: boolean // read from .enabled file in capability folder
  entrypoint?: string // command to start MCP server (mcp interface only)
  /**
   * Whether this capability may be deleted via the UI / API.
   * True for instances of well-known multi-instance types (e.g. `browser-control`),
   * false for singletons (e.g. `desktop-control`, `audio-to-text`). Populated by the scanner.
   */
  canDelete: boolean
  /**
   * simple-icons slug (e.g. `googlechrome`, `microsoftedge`) used by the UI to
   * pick a bundled SVG. Populated from the `icon:` frontmatter field. Optional;
   * falls back to a generic icon when absent.
   */
  iconSlug?: string
  fallbackAction?: string   // sourced from fallback_action frontmatter (S14)
  multiInstance?: boolean   // sourced from multi_instance frontmatter (S14)
  friendlyName?: string     // sourced from friendly_name frontmatter (S19)
}

/**
 * Well-known capability `provides:` types whose instances the user may install,
 * toggle, and delete freely from the settings UI. Any capability whose
 * `provides` is in this set gets `canDelete: true` at scan time.
 *
 * Keep this list conservative — deletion is destructive. New entries require
 * a UI card layout that supports multi-instance rendering.
 */
export const WELL_KNOWN_MULTI_INSTANCE: ReadonlySet<string> = new Set([
  'browser-control',
])

/** Result from running a capability test */
export interface CapabilityTestResult {
  status: 'ok' | 'error'
  latencyMs: number
  message?: string // error details when status is 'error'
}

/** CAPABILITY.md frontmatter shape */
export interface CapabilityFrontmatter {
  name: string
  provides?: string
  interface: 'script' | 'mcp'
  entrypoint?: string // command to start the MCP server
  icon?: string // simple-icons slug (e.g. 'googlechrome', 'firefox')
  requires?: {
    env?: string[]
    system?: string[] // CLI tools that must be present
  }
  fallback_action?: string  // e.g. "could you resend as text" (S14)
  multi_instance?: boolean  // true → instance name appended in ack copy (S14)
  friendly_name?: string    // e.g. "voice transcription" (S19)
}
