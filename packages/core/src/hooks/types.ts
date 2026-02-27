/**
 * Hook Types
 *
 * @module hooks/types
 */

/**
 * Trust levels determine which hooks are applied.
 *
 * - brain: The main brain session. Only audit logging.
 * - task: A task execution session. Audit + bash blocker.
 * - subagent: A subagent session. Audit + bash blocker + path restrictor.
 */
export type TrustLevel = 'brain' | 'task' | 'subagent'

export interface HookFactoryOptions {
  /** Agent directory for audit log storage */
  agentDir?: string
  /** Paths that Write/Edit are allowed to touch (subagent level only) */
  allowedPaths?: string[]
}
