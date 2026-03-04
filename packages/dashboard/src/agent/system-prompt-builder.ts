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
} from "@my-agent/core";

export interface BuilderConfig {
  brainDir: string;
  agentDir: string;
}

export interface BuildContext {
  channel: string;
  conversationId: string;
  messageIndex: number;
  hasPendingEscalations?: boolean;
  activeWorkingAgents?: string[];
}

export interface SystemPromptBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export class SystemPromptBuilder {
  private config: BuilderConfig;
  private stablePromptCache: string | null = null;

  constructor(config: BuilderConfig) {
    this.config = config;
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

    // Layer 3: Current state
    // Populated by work loop in M6.6 — timestamp placeholder for now
    dynamicParts.push(
      `[Current State]\nTimestamp: ${now.toISOString()}\n[End Current State]`,
    );

    // Layer 4: Memory context
    // Daily summary is included in stable prompt via assembleSystemPrompt.
    // MCP memory server handles runtime retrievals — no extra injection needed.

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
