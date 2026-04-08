/**
 * Hook Infrastructure
 *
 * Trust-tiered hooks for safety and auditing.
 *
 * @module hooks
 */

export { createHooks } from './factory.js'
export { createAuditHook } from './audit.js'
export {
  createBashBlocker,
  createInfrastructureGuard,
  createPathRestrictor,
  createSourceCodeProtection,
  createCapabilityRouting,
  createStopReminder,
} from './safety.js'
export type { TrustLevel, HookFactoryOptions } from './types.js'
export { createDelegationEnforcer } from './delegation.js'
export type { DelegationEnforcer } from './delegation.js'
