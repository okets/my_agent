export type {
  Capability,
  CapabilityFrontmatter,
  CapabilityMcpConfig,
  CapabilityTestResult,
} from './types.js'
export { CapabilityRegistry } from './registry.js'
export { scanCapabilities } from './scanner.js'
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
