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
import type { Capability } from "@my-agent/core";
import { resolveTimezone } from "../utils/timezone.js";

export interface BuilderConfig {
  brainDir: string;
  agentDir: string;
  getNotebookLastUpdated?: () => string | null;
  getCapabilities?: () => Capability[];
  // BUG-6 (M9.6-S21): brain awareness of degraded output capabilities.
  // When set, the builder injects a "Currently Degraded" section into
  // Layer 3 so the brain knows not to claim a capability works when it doesn't.
  getDegradedCapabilities?: () => { type: string; name: string; friendlyName: string }[];
}

export interface BuildContext {
  channel: string;
  conversationId: string;
  messageIndex: number;
  hasPendingEscalations?: boolean;
  activeWorkingAgents?: string[];
  pendingBriefing?: string[];
  conversationTodos?: Array<{ text: string; status: string }>;
  activeViewContext?: {
    type: "space" | "automation" | "conversation" | "notebook" | "calendar";
    id: string;
    name: string;
  } | null;
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
  private _excludeSkills: Set<string> = new Set();

  constructor(config: BuilderConfig) {
    this.config = config;
  }

  /** Set skills to exclude from prompt assembly (from filterSkillsByTools). Invalidates cache. */
  set excludeSkills(skills: Set<string>) {
    this._excludeSkills = skills;
    this.stablePromptCache = null;
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
    const tz = await resolveTimezone(this.config.agentDir);
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

    // Layer 3b: Degraded capabilities (BUG-6, M9.6-S21).
    // Omitted entirely when everything is healthy — no empty header.
    const degraded = this.config.getDegradedCapabilities?.() ?? [];
    if (degraded.length > 0) {
      const list = degraded.map((c) => `- ${c.friendlyName}`).join("\n");
      dynamicParts.push(
        `[Currently Degraded Capabilities]\n` +
        `${list}\n\n` +
        `If a capability listed above is relevant to the reply you are about to write, briefly acknowledge the degradation in your own voice (one short sentence — no padding, no apologies). ` +
        `Do not mention capabilities that are not relevant to this reply. ` +
        `If nothing above affects this reply, ignore this section entirely.\n` +
        `[End Currently Degraded Capabilities]`,
      );
    }

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

    // Pending deliveries: events that occurred since last interaction
    // (restart, job completions). M9.4-S4.2 — renamed from [Pending Briefing]
    // and reframed as action requests rather than status notes. Past-Nina
    // scheduled these; present-Nina is being asked to deliver them now.
    const briefing = context.pendingBriefing ?? [];
    if (briefing.length > 0) {
      dynamicParts.push(
        `[Pending Deliveries]\nThe following scheduled deliveries are pending — past-you set these up and asked future-you to present them when ready:\n${briefing.map((b) => `- ${b}`).join("\n")}\n\nPresent these to the user now in your voice. Render — pick what matters, structure it, voice it — but do not silently drop sections. For interrupted jobs, ask whether to resume or discard.\n[End Pending Deliveries]`,
      );
    }

    // Conversation Nina's own pending tasks
    const todos = context.conversationTodos ?? [];
    if (todos.length > 0) {
      const lines = todos.map(
        (t) => `${t.status === "done" ? "\u2713" : "\u2610"} ${t.text} (${t.status})`,
      );
      dynamicParts.push(
        `[Your Pending Tasks]\n${lines.join("\n")}\n[End Pending Tasks]`,
      );
    }

    // View context: tell conversation Nina what the user is currently viewing
    if (context.activeViewContext) {
      const v = context.activeViewContext;
      const typeLabel = v.type.charAt(0).toUpperCase() + v.type.slice(1);
      dynamicParts.push(
        `[Active ${typeLabel} View]\nThe user is viewing ${v.type}: "${v.name}" (${v.id})\nIf they ask about "this ${v.type}" or want changes, use the relevant ${v.type} tools.\n[End Active ${typeLabel} View]`,
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
          capabilities: this.config.getCapabilities?.(),
          excludeSkills: this._excludeSkills.size > 0 ? this._excludeSkills : undefined,
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
