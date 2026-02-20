/**
 * Task System — Type Definitions
 *
 * Defines the core data structures for autonomous task execution,
 * including scheduled and immediate tasks.
 */

/**
 * Task execution status
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'deleted'

/**
 * Task type: how it was triggered
 */
export type TaskType = 'scheduled' | 'immediate'

/**
 * Source that created the task
 */
export type SourceType = 'caldav' | 'conversation' | 'webhook' | 'manual'

/**
 * Who created the task
 */
export type CreatedBy = 'scheduler' | 'user' | 'agent'

/**
 * Task entity - a unit of autonomous work
 */
export interface Task {
  /** Unique identifier: task-{ulid} */
  id: string

  /** How the task was triggered */
  type: TaskType

  /** Source that created this task */
  sourceType: SourceType

  /** Reference to the source (CalDAV UID, conversation ID, etc.) */
  sourceRef?: string

  /** Human-readable title */
  title: string

  /** What the agent should do */
  instructions: string

  /** Current execution status */
  status: TaskStatus

  /** Agent SDK session ID for continuity */
  sessionId: string

  /** Groups recurring task instances (shared session) */
  recurrenceId?: string

  /** This specific occurrence date (for recurring tasks) */
  occurrenceDate?: string

  /** When to execute (null for immediate) */
  scheduledFor?: Date

  /** When execution started */
  startedAt?: Date

  /** When execution completed */
  completedAt?: Date

  /** When the task was soft-deleted */
  deletedAt?: Date

  /** When the task was created */
  created: Date

  /** Who created the task */
  createdBy: CreatedBy

  /** Path to execution log JSONL file */
  logPath: string
}

/**
 * Input for creating a new task
 */
export interface CreateTaskInput {
  type: TaskType
  sourceType: SourceType
  sourceRef?: string
  title: string
  instructions: string
  recurrenceId?: string
  occurrenceDate?: string
  scheduledFor?: Date
  createdBy: CreatedBy
}

/**
 * Filters for listing tasks
 */
export interface ListTasksFilter {
  /** Filter by status */
  status?: TaskStatus | TaskStatus[]

  /** Filter by type */
  type?: TaskType

  /** Filter by source type */
  sourceType?: SourceType

  /** Filter by recurrence ID (get all instances of a recurring task) */
  recurrenceId?: string

  /** Include soft-deleted tasks (default: false) */
  includeDeleted?: boolean

  /** Maximum number of results */
  limit?: number

  /** Number of results to skip */
  offset?: number
}

/**
 * Options for reading execution logs
 */
export interface GetLogOptions {
  /** Maximum number of entries to return */
  limit?: number

  /** Number of entries to skip from the start */
  offset?: number
}
