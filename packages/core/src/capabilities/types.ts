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
}

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
  requires?: {
    env?: string[]
    system?: string[] // CLI tools that must be present
  }
}
