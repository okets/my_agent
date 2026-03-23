/**
 * Automation + Job type definitions
 *
 * Automations are standing instructions stored as markdown files
 * in `.my_agent/automations/`. Jobs are individual execution runs.
 */

export interface TriggerConfig {
  type: "schedule" | "channel" | "watch" | "manual";
  /** Cron expression for schedule triggers */
  cron?: string;
  /** Hint keywords for channel triggers */
  hint?: string;
  /** Watch path (resolved from space or absolute) */
  path?: string;
  /** Space name for watch triggers */
  space?: string;
  /** File events to watch (default: ["add"]) */
  events?: string[];
  /** Use polling for NAS/SMB (default: false) */
  polling?: boolean;
  /** Polling interval in ms (default: 5000) */
  interval?: number;
}

export interface AutomationDeliveryAction {
  channel: "whatsapp" | "email" | "dashboard";
  content?: string;
  status?: "pending" | "completed" | "failed";
}

export interface AutomationManifest {
  name: string;
  status: "active" | "disabled";
  trigger: TriggerConfig[];
  spaces?: string[];
  model?: string;
  notify?: "immediate" | "debrief" | "none";
  persist_session?: boolean;
  autonomy?: "full" | "cautious" | "review";
  once?: boolean;
  delivery?: AutomationDeliveryAction[];
  created: string;
}

export interface Automation {
  /** ID derived from filename (without .md) */
  id: string;
  /** Parsed manifest */
  manifest: AutomationManifest;
  /** Absolute path to the .md file */
  filePath: string;
  /** Markdown body (instructions) */
  instructions: string;
  /** When last indexed */
  indexedAt: string;
}

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "needs_review";

export interface Job {
  id: string;
  automationId: string;
  status: JobStatus;
  created: string;
  completed?: string;
  summary?: string;
  context?: Record<string, unknown>;
  sdk_session_id?: string;
  run_dir?: string;
}

/**
 * Input for creating a new automation via MCP tools
 */
export interface CreateAutomationInput {
  name: string;
  instructions: string;
  trigger: TriggerConfig[];
  spaces?: string[];
  model?: string;
  notify?: "immediate" | "debrief" | "none";
  persist_session?: boolean;
  autonomy?: "full" | "cautious" | "review";
  once?: boolean;
  delivery?: AutomationDeliveryAction[];
}
