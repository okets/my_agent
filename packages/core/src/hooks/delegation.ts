/**
 * Delegation Enforcement Hook
 *
 * PreToolUse hook that limits WebSearch calls per turn.
 * When exceeded, blocks further searches and nudges the brain
 * toward delegating via create_automation.
 *
 * @module hooks/delegation
 */

import type { HookCallback, HookJSONOutput, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk'

export interface DelegationEnforcer {
  /** PreToolUse hook callback — wire into brain session hooks */
  preToolUse: HookCallback
  /** Call when a new user message arrives to reset the per-turn counter */
  resetTurn: () => void
}

/**
 * Create a delegation enforcer that limits WebSearch calls per turn.
 *
 * @param budget - Maximum allowed WebSearch calls before blocking (default: 2)
 */
export function createDelegationEnforcer(budget: number = 2): DelegationEnforcer {
  let webSearchCount = 0

  const preToolUse: HookCallback = async (input): Promise<HookJSONOutput> => {
    const preInput = input as PreToolUseHookInput
    if (preInput.tool_name !== 'WebSearch') return {}

    webSearchCount++

    if (webSearchCount > budget) {
      return {
        systemMessage:
          `WebSearch blocked (${webSearchCount - 1} searches already used, limit is ${budget}). ` +
          `This is research-level work — delegate it to a working agent via create_automation ` +
          `with notify: "immediate" so the user gets results quickly. ` +
          `Include the full research context in the instructions field.`,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse' as const,
          permissionDecision: 'deny' as const,
          permissionDecisionReason:
            `WebSearch budget exceeded (${budget} max per turn). Delegate via create_automation.`,
        },
      }
    }

    return {}
  }

  const resetTurn = () => {
    webSearchCount = 0
  }

  return { preToolUse, resetTurn }
}
