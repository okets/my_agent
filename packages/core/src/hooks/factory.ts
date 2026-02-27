/**
 * Hook Factory
 *
 * Creates trust-tiered hooks for the brain, tasks, and subagents.
 *
 * Trust levels:
 * - brain: Audit logging only (PostToolUse)
 * - task: Audit + bash command blocker (PostToolUse + PreToolUse)
 * - subagent: Audit + bash blocker + path restrictor (most restrictive)
 *
 * @module hooks/factory
 */

import type { HookEvent, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { createAuditHook } from './audit.js'
import { createBashBlocker, createPathRestrictor } from './safety.js'
import type { TrustLevel, HookFactoryOptions } from './types.js'

/**
 * Create hooks appropriate for the given trust level.
 */
export function createHooks(
  trustLevel: TrustLevel,
  options?: HookFactoryOptions,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
    PostToolUse: [
      {
        matcher: '.*',
        hooks: [createAuditHook(options?.agentDir)],
      },
    ],
  }

  if (trustLevel === 'task' || trustLevel === 'subagent') {
    hooks.PreToolUse = [
      {
        matcher: 'Bash',
        hooks: [createBashBlocker()],
      },
    ]
  }

  if (trustLevel === 'subagent' && options?.allowedPaths) {
    hooks.PreToolUse = hooks.PreToolUse ?? []
    hooks.PreToolUse.push({
      matcher: 'Write|Edit',
      hooks: [createPathRestrictor(options.allowedPaths)],
    })
  }

  return hooks
}
