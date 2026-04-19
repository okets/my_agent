/**
 * Capability scanner — discovers capabilities from .my_agent/capabilities/
 *
 * Each capability is a folder with a CAPABILITY.md file containing YAML
 * frontmatter that declares name, interface, env requirements, etc.
 * The scanner checks env var availability and expands MCP configs.
 */

import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { readFrontmatter } from '../metadata/frontmatter.js'
import { getEnvValue } from '../env.js'
import {
  WELL_KNOWN_MULTI_INSTANCE,
  type Capability,
  type CapabilityFrontmatter,
  type CapabilityMcpConfig,
} from './types.js'
import { validateScriptExecBits } from './test-harness.js'

/**
 * Recursively replace `${CAPABILITY_ROOT}` in all string values of an object.
 */
function expandCapabilityRoot(obj: unknown, capRoot: string): unknown {
  if (typeof obj === 'string') {
    return obj.split('${CAPABILITY_ROOT}').join(capRoot)
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => expandCapabilityRoot(item, capRoot))
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandCapabilityRoot(value, capRoot)
    }
    return result
  }
  return obj
}

/**
 * Check whether a required env var is set.
 * Checks process.env first, then falls back to reading from the .env file.
 */
function hasEnvVar(envPath: string, key: string): boolean {
  if (process.env[key]) return true
  const fileValue = getEnvValue(envPath, key)
  return fileValue !== null && fileValue !== ''
}

/**
 * Check if a system CLI tool is available via `which`.
 */
function hasSystemTool(tool: string): boolean {
  try {
    execFileSync('which', [tool], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Load and expand .mcp.json from a capability folder.
 * Returns the parsed config with ${CAPABILITY_ROOT} replaced, or undefined.
 */
function loadMcpConfig(
  capabilityDir: string,
  envPath: string,
  requiredEnv: string[],
): CapabilityMcpConfig | undefined {
  const mcpPath = join(capabilityDir, '.mcp.json')
  if (!existsSync(mcpPath)) return undefined

  try {
    const raw = readFileSync(mcpPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const expanded = expandCapabilityRoot(parsed, capabilityDir) as CapabilityMcpConfig

    // Inject requires.env vars into the MCP server's env field
    if (requiredEnv.length > 0 && typeof expanded === 'object' && expanded !== null) {
      const envVars: Record<string, string> =
        ((expanded as Record<string, unknown>).env as Record<string, string>) ?? {}
      for (const key of requiredEnv) {
        const val = process.env[key] ?? getEnvValue(envPath, key)
        if (val) envVars[key] = val
      }
      if (Object.keys(envVars).length > 0) {
        ;(expanded as Record<string, unknown>).env = envVars
      }
    }

    return expanded
  } catch {
    return undefined
  }
}

/**
 * Scan for capabilities in the given directory.
 *
 * Looks for `* /CAPABILITY.md` one level deep, parses frontmatter,
 * checks env requirements, and returns the capability list.
 */
export async function scanCapabilities(
  capabilitiesDir: string,
  envPath: string,
): Promise<Capability[]> {
  const { globby } = await import('globby')
  const files = await globby('*/CAPABILITY.md', {
    cwd: capabilitiesDir,
    absolute: true,
  })

  const capabilities: Capability[] = []

  for (const filePath of files) {
    const capDir = dirname(filePath)
    try {
      const { data } = readFrontmatter<CapabilityFrontmatter>(filePath)
      if (!data.name) {
        capabilities.push({
          name: basename(capDir),
          interface: data.interface ?? 'script',
          path: capDir,
          status: 'invalid',
          error: 'Missing name in CAPABILITY.md frontmatter',
          health: 'untested',
          enabled: false,
          canDelete: false,
        })
        continue
      }

      const requiredEnv = data.requires?.env ?? []
      const missingVars = requiredEnv.filter((key) => !hasEnvVar(envPath, key))

      // Probe required system tools
      const requiredSystem = data.requires?.system ?? []
      const missingTools = requiredSystem.filter((tool) => !hasSystemTool(tool))

      // Combine missing env and system requirements
      const allMissing = [...missingVars, ...missingTools]

      // Read .enabled file
      const enabledPath = join(capDir, '.enabled')
      const enabled = existsSync(enabledPath)

      const capability: Capability = {
        name: data.name,
        provides: data.provides,
        interface: data.interface,
        path: capDir,
        status: allMissing.length === 0 ? 'available' : 'unavailable',
        health: 'untested',
        enabled,
        canDelete: data.provides ? WELL_KNOWN_MULTI_INSTANCE.has(data.provides) : false,
        iconSlug: data.icon,
        fallbackAction: data.fallback_action,    // S14
        multiInstance: data.multi_instance,      // S14
        friendlyName: data.friendly_name,        // S19
      }

      if (allMissing.length > 0) {
        capability.unavailableReason = `missing ${allMissing.join(', ')}`
      }

      // Read entrypoint for MCP capabilities
      if (data.entrypoint) {
        capability.entrypoint = data.entrypoint
      }

      // For MCP capabilities without entrypoint, load .mcp.json (mutually exclusive per spec)
      if (data.interface === 'mcp' && !data.entrypoint) {
        const mcpConfig = loadMcpConfig(capDir, envPath, requiredEnv)
        if (mcpConfig) {
          capability.mcpConfig = mcpConfig
        }
      }

      // Exec-bit validation for script-interface capabilities (M9.6-S10).
      // Any scripts/*.sh without the executable bit is an authoring error that
      // will silently fail at invocation time. Mark the plug invalid so the
      // registry drops it and the invoker emits not-installed (discoverable).
      if (data.interface === 'script' && capability.status === 'available') {
        const execCheck = validateScriptExecBits(capDir)
        if (!execCheck.valid) {
          capability.status = 'invalid'
          capability.error = execCheck.reason
        }
      }

      capabilities.push(capability)
    } catch (err) {
      capabilities.push({
        name: basename(capDir),
        interface: 'script',
        path: capDir,
        status: 'invalid',
        error: err instanceof Error ? err.message : 'Unknown error parsing CAPABILITY.md',
        health: 'untested',
        enabled: false,
        canDelete: false,
      })
    }
  }

  return capabilities
}
