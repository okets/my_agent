// packages/dashboard/src/automations/index.ts
export { AutomationManager } from "./automation-manager.js";
export { AutomationJobService } from "./automation-job-service.js";
export { AutomationExecutor } from "./automation-executor.js";
export type {
  AutomationExecutorConfig,
  ExecutionResult,
} from "./automation-executor.js";
export { AutomationProcessor } from "./automation-processor.js";
export type {
  AutomationProcessorConfig,
  JobEventName,
} from "./automation-processor.js";
export { AutomationScheduler } from "./automation-scheduler.js";
export type { AutomationSchedulerConfig } from "./automation-scheduler.js";
export { AutomationSyncService } from "./automation-sync-service.js";
export { WatchTriggerService } from "./watch-trigger-service.js";
export type {
  WatchTriggerConfig,
  WatchEvent,
  WatchTriggerServiceDeps,
} from "./watch-trigger-service.js";
export {
  ensureStagingDir,
  stagingPath,
  cleanStaging,
} from "./media-staging.js";
export { extractTaskFromMessage } from "./automation-extractor.js";
export type {
  AutomationMatch,
  AutomationHint,
  ExtractionResult,
  ExtractedTask,
} from "./automation-extractor.js";
