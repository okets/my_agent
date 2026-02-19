/**
 * Task System — Module Exports
 */

export { TaskManager } from "./task-manager.js";
export { TaskLogStorage } from "./log-storage.js";
export { TaskExecutor } from "./task-executor.js";
export type { TaskLogMeta } from "./log-storage.js";
export type { TaskExecutorConfig, ExecutionResult } from "./task-executor.js";

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
} from "@my-agent/core";
