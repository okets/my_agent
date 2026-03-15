/**
 * System Prompt Builder
 *
 * Assembles the 6-layer system prompt for Conversation Nina.
 * Layers 1-2 (identity + skills) are cached with cache_control.
 * Layers 3-6 (state, memory, metadata, session) are rebuilt every query.
 *
 * Design doc: docs/plans/2026-03-04-conversation-nina-design.md § 4
 */

import {
  assembleSystemPrompt,
  loadCalendarConfig,
  loadCalendarCredentials,
  createCalDAVClient,
  assembleCalendarContext,
  loadProperties,
} from "@my-agent/core";

export interface BuilderConfig {
  brainDir: string;
  agentDir: string;
  getNotebookLastUpdated?: () => string | null;
}

export interface BuildContext {
  channel: string;
  conversationId: string;
  messageIndex: number;
  hasPendingEscalations?: boolean;
  activeWorkingAgents?: string[];
  activeTaskContext?: { taskId: string; title: string } | null;
}

export interface SystemPromptBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export class SystemPromptBuilder {
  private config: BuilderConfig;
  private stablePromptCache: string | null = null;
  private sessionStartTime: Date = new Date();

  constructor(config: BuilderConfig) {
    this.config = config;
  }

  /** Reset session start time (call when a new conversation session begins). */
  resetSessionStart(): void {
    this.sessionStartTime = new Date();
  }

  /**
   * Build the full system prompt as an array of content blocks.
   * Layers 1-2 (identity + skills) are cached. Layers 3-6 are dynamic.
   */
  async build(context: BuildContext): Promise<SystemPromptBlock[]> {
    // Layers 1-2: Identity + Skills (stable, cached)
    const stablePrompt = await this.getStablePrompt();

    // Layers 3-6: Dynamic context (rebuilt every query)
    const dynamicParts: string[] = [];
    const now = new Date();

    // Layer 3: Temporal context + current state
    // current-state.md is included via assembleSystemPrompt → loadNotebookOperations.
    // Temporal context lets Nina reason about freshness ("updated this morning" vs "3 days old").
    const sessionStart = this.sessionStartTime ?? now;
    const tz = process.env.TZ || "Asia/Jerusalem";
    const localeOpts: Intl.DateTimeFormatOptions = {
      timeZone: tz,
      dateStyle: "full",
      timeStyle: "short",
    };
    const temporalLines = [
      `[Temporal Context]`,
      `Current time: ${now.toLocaleString("en-IL", localeOpts)}`,
      `Session started: ${sessionStart.toLocaleString("en-IL", localeOpts)}`,
    ];
    const notebookUpdated = this.config.getNotebookLastUpdated?.();
    if (notebookUpdated) {
      const notebookDate = new Date(notebookUpdated);
      temporalLines.push(
        `Notebook last updated: ${notebookDate.toLocaleString("en-IL", localeOpts)}`,
      );
    }
    temporalLines.push(`[End Temporal Context]`);
    dynamicParts.push(temporalLines.join("\n"));

    // Layer 4: Memory context
    // Daily summary is included in stable prompt via assembleSystemPrompt.
    // MCP memory server handles runtime retrievals — no extra injection needed.

    // Layer 4b: Dynamic properties (location, timezone, availability)
    const propertiesBlock = await loadProperties(this.config.agentDir);
    if (propertiesBlock) {
      dynamicParts.push(propertiesBlock);
    }

    // Layer 5: Inbound metadata (JSON, system-role, trusted)
    const metadata = {
      channel: context.channel,
      timestamp: now.toISOString(),
      message_index: context.messageIndex,
      conversation_id: context.conversationId,
      has_pending_escalations: context.hasPendingEscalations ?? false,
      active_working_agents: context.activeWorkingAgents ?? [],
    };
    dynamicParts.push(
      `[Inbound Metadata]\n${JSON.stringify(metadata, null, 2)}\n[End Inbound Metadata]`,
    );

    // Working agent awareness: tell conversation Nina when tasks are in progress
    const activeAgents = context.activeWorkingAgents ?? [];
    if (activeAgents.length > 0) {
      dynamicParts.push(
        `[Active Working Agents]\nThe following tasks are currently being worked on by background agents:\n${activeAgents.map((a) => `- ${a}`).join("\n")}\n\nIf the user's message is about these tasks, let them know you're still working on it and results will arrive shortly. Do not try to answer questions about these tasks yourself — wait for the working agent to finish.\n[End Active Working Agents]`,
      );
    }

    // Task context: tell conversation Nina when the user is viewing a specific task
    if (context.activeTaskContext) {
      dynamicParts.push(
        `[Active Task View]\nThe user is currently viewing task: "${context.activeTaskContext.title}" (${context.activeTaskContext.taskId})\nIf they ask about "this task" or request changes, use revise_task with this task ID.\n[End Active Task View]`,
      );
    }

    // Layer 6: Session context
    dynamicParts.push(
      `[Session Context]\nConversation ID: ${context.conversationId}\nMessage index: ${context.messageIndex}\n[End Session Context]`,
    );

    return [
      {
        type: "text",
        text: stablePrompt,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: dynamicParts.join("\n\n"),
      },
    ];
  }

  /**
   * Get layers 1-2 (identity + skills). Cached after first call.
   * Call invalidateCache() if brain files change at runtime.
   */
  private async getStablePrompt(): Promise<string> {
    if (!this.stablePromptCache) {
      // Try to include calendar context (graceful degradation)
      let calendarContext: string | undefined;
      try {
        const calendarConfig = loadCalendarConfig(this.config.agentDir);
        const credentials = loadCalendarCredentials(this.config.agentDir);
        if (calendarConfig && credentials) {
          const calendarRepo = await createCalDAVClient(
            calendarConfig,
            credentials,
          );
          calendarContext = await assembleCalendarContext(calendarRepo);
        }
      } catch {
        // Calendar unavailable — continue without it
      }

      this.stablePromptCache = await assembleSystemPrompt(
        this.config.brainDir,
        {
          calendarContext,
        },
      );
    }
    return this.stablePromptCache;
  }

  /** Invalidate the cached stable prompt (call when brain files change). */
  invalidateCache(): void {
    this.stablePromptCache = null;
  }
}
