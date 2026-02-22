/**
 * Task System — Module Exports
 */

export { TaskManager } from "./task-manager.js";
export { TaskLogStorage } from "./log-storage.js";
export { TaskExecutor } from "./task-executor.js";
export { TaskProcessor } from "./task-processor.js";
export { TaskScheduler } from "./task-scheduler.js";
export { DeliveryExecutor } from "./delivery-executor.js";
export type { TaskLogMeta } from "./log-storage.js";
export type {
  DeliveryActionResult,
  DeliveryResult,
} from "./delivery-executor.js";
export type { TaskExecutorConfig, ExecutionResult } from "./task-executor.js";
export type { TaskProcessorConfig } from "./task-processor.js";
export type { TaskSchedulerConfig } from "./task-scheduler.js";

// Re-export types from core for convenience
export type {
  Task,
  TaskStatus,
  TaskType,
  SourceType,
  CreatedBy,
  CreateTaskInput,
  ListTasksFilter,
  GetLogOptions,
  WorkItem,
  DeliveryAction,
} from "@my-agent/core";
