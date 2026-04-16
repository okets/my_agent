export type {
  Capability,
  CapabilityFrontmatter,
  CapabilityMcpConfig,
  CapabilityTestResult,
} from './types.js'
export type {
  CapabilityFailureSymptom,
  TriggeringInput,
  FixAttempt,
  CapabilityFailure,
  SurrenderScope,
} from './cfr-types.js'
export { CfrEmitter } from './cfr-emitter.js'
export { classifySttError, classifyEmptyStt } from './failure-symptoms.js'
export { CapabilityRegistry } from './registry.js'
export type { CapabilityHealthReport } from './registry.js'
export { CapabilityWatcher } from './watcher.js'
export { scanCapabilities } from './scanner.js'
export {
  WELL_KNOWN_TYPES,
  getWellKnownType,
  type WellKnownType,
} from './well-known-types.js'
export { testCapability, testMcpScreenshot } from './test-harness.js'
export { McpCapabilitySpawner, type McpHandle } from './mcp-spawner.js'
export {
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  createScreenshotInterceptor,
  inferSource,
  parseImageMetadata,
  parseMcpToolName,
  storeAndInject,
  type RateLimiter,
  type AuditLogger,
  type AuditEntry,
  type ScreenshotInterceptor,
  type StoreCallback,
  type StoreAndInjectResult,
} from './mcp-middleware.js'
export {
  validateToolContract,
  getToolContract,
  DESKTOP_CONTROL_CONTRACT,
  type ToolContract,
  type ToolSpec,
  type ValidationResult,
} from './tool-contracts.js'
export {
  nextAction,
  type OrchestratorState,
  type OrchestratorEvent,
  type FixSession,
  type Action,
} from './orchestrator-state-machine.js'
export {
  RecoveryOrchestrator,
  type OrchestratorDeps,
  type AckKind,
  type AutomationSpec,
  type AutomationResult,
} from './recovery-orchestrator.js'
export { reverify, type ReverifyResult } from './reverify.js'
export {
  defaultCopy,
  type ResilienceCopy,
  type SurrenderReason,
} from './resilience-messages.js'
export {
  AckDelivery,
  type TransportManagerLike,
  type ConnectionRegistryLike,
} from './ack-delivery.js'
