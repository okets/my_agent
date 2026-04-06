/**
 * Safety Hooks
 *
 * PreToolUse hooks for blocking dangerous operations.
 *
 * @module hooks/safety
 */

import { resolve, relative } from 'path'
import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'

/**
 * Source code patterns that Nina should never modify.
 * These are developer-maintained framework files.
 */
const SOURCE_CODE_PATTERNS = [
  /^packages\//,
  /^skills\//,
  /^docs\//,
  /^scripts\//,
  /^\.github\//,
  /^tsconfig/,
  /^package\.json$/,
  /^CLAUDE\.md$/,
]

/**
 * Capability/infrastructure paths that Conversation Nina must not edit directly.
 * Workers (task level) ARE allowed — they write through the automation system.
 */
const CAPABILITY_ROUTING_PATTERNS = [
  /\.my_agent\/capabilities\//,
  /\.my_agent\/spaces\//,
  /\.my_agent\/config\.yaml$/,
]

/**
 * Dangerous bash patterns that should always be blocked.
 */
const BLOCKED_BASH_PATTERNS = [
  /rm\s+-rf\s+\//, // rm -rf /
  /rm\s+-rf\s+~\//, // rm -rf ~/
  /git\s+push\s+--force/, // git push --force
  /git\s+push\s+-f\b/, // git push -f
  /DROP\s+TABLE/i, // DROP TABLE
  /DROP\s+DATABASE/i, // DROP DATABASE
  /mkfs\./, // mkfs.* (format filesystem)
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, // fork bomb
  />\s*\/dev\/sd[a-z]/, // write to raw disk
  /systemctl\s+(stop|disable)\s+nina-/i, // stop/disable agent services
  /kill(?:all)?\s+.*nina/i, // kill / killall agent process
  /chmod\s+000\s/i, // remove all permissions
  /chown\s+.*\/(brain|config|auth|\.env)/i, // chown on infrastructure paths
]

/**
 * Create a bash command blocker hook.
 *
 * Blocks dangerous bash commands like rm -rf /, git push --force, DROP TABLE, etc.
 * Applied at task and subagent trust levels.
 */
export function createBashBlocker(): HookCallback {
  return async (input) => {
    const preInput = input as PreToolUseHookInput
    const toolInput = preInput.tool_input as Record<string, unknown> | undefined
    const commandStr = toolInput?.command as string | undefined

    if (!commandStr) return {}

    for (const pattern of BLOCKED_BASH_PATTERNS) {
      if (pattern.test(commandStr)) {
        return {
          decision: 'block' as const,
          reason: `Blocked dangerous command matching pattern: ${pattern.source}`,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse' as const,
            permissionDecision: 'deny' as const,
            permissionDecisionReason: `Blocked: command matches dangerous pattern "${pattern.source}"`,
          },
        }
      }
    }

    return {}
  }
}

/**
 * Escape a string for use in a RegExp.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Create an infrastructure guard hook for Write/Edit tools.
 *
 * Blocks writes to protected infrastructure files regardless of trust level.
 * Applied at task trust level (and above) so task agents cannot tamper with
 * brain identity, config, secrets, database files, or safety hooks.
 */
export function createInfrastructureGuard(agentDir: string): HookCallback {
  const protectedPatterns: Array<{ pattern: RegExp; reason: string }> = [
    {
      pattern: new RegExp(`${escapeRegex(agentDir)}/brain/AGENTS\\.md$`),
      reason: "Identity file — conversation Nina's domain",
    },
    {
      pattern: new RegExp(`${escapeRegex(agentDir)}/\\.claude/skills/`),
      reason: 'SDK skills directory — not modifiable by tasks',
    },
    {
      pattern: new RegExp(`${escapeRegex(agentDir)}/config\\.yaml$`),
      reason: 'Agent configuration',
    },
    { pattern: /\.env$/, reason: 'Environment secrets' },
    {
      pattern: new RegExp(`${escapeRegex(agentDir)}/auth/`),
      reason: 'Channel credentials',
    },
    { pattern: /\.db$/, reason: 'Database files' },
    { pattern: /\.guardrails$/, reason: 'Safety patterns' },
    { pattern: /\.git\/hooks\//, reason: 'Git hook scripts' },
    { pattern: /\.service$/, reason: 'Systemd service definitions' },
  ]

  return async (input, _toolUseId, _options) => {
    try {
      const preInput = input as PreToolUseHookInput
      const toolInput = preInput.tool_input as Record<string, unknown> | null

      if (!toolInput) {
        return {
          decision: 'block' as const,
          reason: 'Infrastructure guard: no tool_input',
        }
      }

      const filePath = toolInput.file_path as string | undefined

      if (!filePath) {
        return {
          decision: 'block' as const,
          reason: 'Infrastructure guard: no file_path in tool input',
        }
      }

      for (const { pattern, reason } of protectedPatterns) {
        if (pattern.test(filePath)) {
          return {
            decision: 'block' as const,
            reason: `Infrastructure guard: ${reason}`,
            systemMessage: `Blocked: ${reason}. This file is protected infrastructure. Try an alternative approach or write to your workspace instead.`,
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'deny' as const,
              permissionDecisionReason: reason,
            },
          }
        }
      }

      return {}
    } catch (err) {
      return {
        decision: 'block' as const,
        reason: `Infrastructure guard error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }
}

/**
 * Source code protection — blocks Write/Edit to framework code.
 *
 * Applied at ALL trust levels. Nina should never modify her own code.
 * Read access is unrestricted. Matches against path components.
 */
export function createSourceCodeProtection(projectRoot?: string): HookCallback {
  return async (input) => {
    const preInput = input as PreToolUseHookInput
    const toolName = preInput.tool_name
    if (toolName !== 'Write' && toolName !== 'Edit') return {}

    const toolInput = preInput.tool_input as Record<string, unknown> | undefined
    const filePath = toolInput?.file_path as string | undefined
    if (!filePath) return {}

    const root = projectRoot ?? process.cwd()
    const rel = relative(root, filePath)
    if (rel.startsWith('..')) return {} // Outside project root — not our concern

    if (SOURCE_CODE_PATTERNS.some((p) => p.test(rel))) {
      return {
        decision: 'block' as const,
        reason:
          'This path is developer-maintained code. You cannot modify it. If something needs fixing, escalate to the user.',
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'deny' as const,
          permissionDecisionReason: 'Source code protection: developer-maintained code',
        },
      }
    }
    return {}
  }
}

/**
 * Capability routing — blocks Conversation Nina from direct capability edits.
 *
 * Applied at brain trust level ONLY. Workers (task) need to write to capabilities.
 * Forces infrastructure changes through the automation system for paper trails.
 */
export function createCapabilityRouting(): HookCallback {
  return async (input) => {
    const preInput = input as PreToolUseHookInput
    const toolName = preInput.tool_name
    if (toolName !== 'Write' && toolName !== 'Edit') return {}

    const toolInput = preInput.tool_input as Record<string, unknown> | undefined
    const filePath = toolInput?.file_path as string | undefined
    if (!filePath) return {}

    if (CAPABILITY_ROUTING_PATTERNS.some((p) => p.test(filePath))) {
      return {
        decision: 'block' as const,
        reason:
          'Direct edits to this path are not allowed. Use create_automation with a tracked job to modify this through the proper flow.',
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'deny' as const,
          permissionDecisionReason: 'Capability routing: use automation system',
        },
      }
    }
    return {}
  }
}

/**
 * Create a path restrictor hook for Write/Edit tools.
 *
 * Blocks writes to files outside the allowed paths.
 * Applied at subagent trust level only.
 */
export function createPathRestrictor(allowedPaths?: string[]): HookCallback {
  return async (input) => {
    if (!allowedPaths || allowedPaths.length === 0) return {}

    const preInput = input as PreToolUseHookInput
    const toolInput = preInput.tool_input as Record<string, unknown> | undefined
    const filePath = toolInput?.file_path as string | undefined

    if (!filePath) return {}

    const resolvedPath = resolve(filePath)
    const isAllowed = allowedPaths.some((allowed) => {
      const resolvedAllowed = resolve(allowed)
      return resolvedPath.startsWith(resolvedAllowed + '/') || resolvedPath === resolvedAllowed
    })

    if (!isAllowed) {
      return {
        decision: 'block' as const,
        reason: `Path "${filePath}" is outside allowed paths`,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'deny' as const,
          permissionDecisionReason: `Blocked: "${filePath}" is outside allowed write paths`,
        },
      }
    }

    return {}
  }
}
