/**
 * Notification System Types
 *
 * Types for Nina's communication with users about task status,
 * requests for input, and escalations.
 */

/**
 * Importance levels for notifications
 */
export type NotificationImportance = "info" | "warning" | "success" | "error";

/**
 * Severity levels for escalations
 */
export type EscalationSeverity = "low" | "medium" | "high" | "critical";

/**
 * Status of a notification
 */
export type NotificationStatus = "pending" | "delivered" | "read" | "dismissed";

/**
 * Type of notification
 */
export type NotificationType = "notify" | "request_input" | "escalate";

/**
 * Base notification fields
 */
interface BaseNotification {
  id: string;
  type: NotificationType;
  taskId?: string;
  created: Date;
  status: NotificationStatus;
  readAt?: Date;
}

/**
 * Simple notification (fire-and-forget)
 */
export interface Notification extends BaseNotification {
  type: "notify";
  message: string;
  importance: NotificationImportance;
}

/**
 * Option for request_input
 */
export interface InputOption {
  label: string;
  value: string;
}

/**
 * Request for user input
 */
export interface InputRequest extends BaseNotification {
  type: "request_input";
  question: string;
  options: InputOption[];
  response?: string;
  respondedAt?: Date;
}

/**
 * Escalation (urgent notification)
 */
export interface Escalation extends BaseNotification {
  type: "escalate";
  problem: string;
  severity: EscalationSeverity;
}

/**
 * Union type for all notification types
 */
export type AnyNotification = Notification | InputRequest | Escalation;

/**
 * Input for creating a simple notification
 */
export interface NotifyInput {
  message: string;
  importance?: NotificationImportance;
  taskId?: string;
}

/**
 * Input for creating an input request
 */
export interface RequestInputInput {
  question: string;
  options: string[] | InputOption[];
  taskId?: string;
}

/**
 * Input for creating an escalation
 */
export interface EscalateInput {
  problem: string;
  severity?: EscalationSeverity;
  taskId?: string;
}

/**
 * Event emitted when notification state changes
 */
export interface NotificationEvent {
  type:
    | "notification:created"
    | "notification:delivered"
    | "notification:read"
    | "notification:responded";
  notification: AnyNotification;
}
