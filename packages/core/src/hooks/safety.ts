/**
 * Safety Hooks
 *
 * PreToolUse hooks for blocking dangerous operations.
 *
 * @module hooks/safety
 */

import { resolve } from 'path'
import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'

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
