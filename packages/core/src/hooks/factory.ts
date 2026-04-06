/**
 * Hook Factory
 *
 * Creates trust-tiered hooks for the brain, tasks, and subagents.
 *
 * Trust levels (M9.1-S4):
 * - brain: Audit + source code protection + capability routing
 * - task: Audit + source code protection + bash blocker + infrastructure guard + Stop reminder
 * - subagent: Audit + source code protection + bash blocker + path restrictor
 *
 * @module hooks/factory
 */

import type { HookEvent, HookCallbackMatcher } from '@anthropic-ai/claude-agent-sdk'
import { createAuditHook } from './audit.js'
import {
  createBashBlocker,
  createInfrastructureGuard,
  createPathRestrictor,
  createSourceCodeProtection,
  createCapabilityRouting,
  createStopReminder,
} from './safety.js'
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

  // Source code protection — all trust levels block Write/Edit to framework code
  hooks.PreToolUse = [
    {
      matcher: 'Write|Edit',
      hooks: [createSourceCodeProtection(options?.projectRoot)],
    },
  ]

  // Capability routing — brain only (workers need to write capabilities)
  if (trustLevel === 'brain') {
    hooks.PreToolUse.push({
      matcher: 'Write|Edit',
      hooks: [createCapabilityRouting()],
    })
  }

  if (trustLevel === 'task' || trustLevel === 'subagent') {
    hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: [createBashBlocker()],
    })
  }

  if (trustLevel === 'task' && options?.agentDir) {
    hooks.PreToolUse.push({
      matcher: 'Write|Edit',
      hooks: [createInfrastructureGuard(options.agentDir)],
    })
  }

  if (trustLevel === 'subagent' && options?.allowedPaths) {
    hooks.PreToolUse.push({
      matcher: 'Write|Edit',
      hooks: [createPathRestrictor(options.allowedPaths)],
    })
  }

  // Stop hook — task level only. Reminds worker about incomplete mandatory items.
  if (trustLevel === 'task' && options?.todoPath) {
    hooks.Stop = [
      {
        hooks: [createStopReminder(options.todoPath)],
      },
    ]
  }

  return hooks
}
