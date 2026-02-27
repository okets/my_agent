/**
 * Hook Infrastructure
 *
 * Trust-tiered hooks for safety and auditing.
 *
 * @module hooks
 */

export { createHooks } from './factory.js'
export { createAuditHook } from './audit.js'
export { createBashBlocker, createPathRestrictor } from './safety.js'
export type { TrustLevel, HookFactoryOptions } from './types.js'
