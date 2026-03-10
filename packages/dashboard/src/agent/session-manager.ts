import {
  createBrainQuery,
  loadConfig,
  createHooks,
  createMemoryServer,
} from "@my-agent/core";
import type {
  Query,
  ContentBlock,
  BrainConfig,
  BrainSessionOptions,
  HookEvent,
  HookCallbackMatcher,
  SearchService,
} from "@my-agent/core";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { processStream, type StreamEvent } from "./stream-processor.js";
import { SystemPromptBuilder } from "./system-prompt-builder.js";
import type { BuildContext } from "./system-prompt-builder.js";
import { createConversationServer } from "../mcp/conversation-server.js";
import type { ConversationSearchService } from "../conversations/search-service.js";
import type { ConversationManager } from "../conversations/manager.js";

/** Cached MCP servers — initialized once via initMcpServers() */
let sharedMcpServers: Options["mcpServers"] | null = null;

/**
 * Initialize MCP servers for brain sessions.
 * Call once from index.ts after searchService is ready.
 */
export function initMcpServers(
  searchService: SearchService,
  notebookDir: string,
  conversationSearchService?: ConversationSearchService,
  conversationManager?: ConversationManager,
): void {
  const memoryServer = createMemoryServer({ notebookDir, searchService });
  const servers: NonNullable<Options["mcpServers"]> = {
    memory: memoryServer,
  };

  if (conversationSearchService && conversationManager) {
    servers.conversations = createConversationServer({
      conversationSearchService,
      conversationManager,
    });
    console.log(
      `[SessionManager] MCP servers initialized (memory → ${notebookDir}, conversations)`,
    );
  } else {
    console.log(
      `[SessionManager] MCP servers initialized (memory → ${notebookDir})`,
    );
  }

  sharedMcpServers = servers;
}

interface StreamOptions {
  /** Override the default model */
  model?: string;
  /** Enable extended thinking */
  reasoning?: boolean;
}

export class SessionManager {
  private conversationId: string;
  private channel: string;
  private sdkSessionId: string | null;
  private config: BrainConfig | null = null;
  private hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | null =
    null;
  private initPromise: Promise<void> | null = null;
  private activeQuery: Query | null = null;
  private messageIndex = 0;
  private promptBuilder: SystemPromptBuilder | null = null;

  constructor(
    conversationId: string,
    channel: string,
    sdkSessionId?: string | null,
  ) {
    this.conversationId = conversationId;
    this.channel = channel;
    this.sdkSessionId = sdkSessionId ?? null;
  }

  /**
   * Get the current SDK session ID (for persistence by the caller).
   */
  getSessionId(): string | null {
    return this.sdkSessionId;
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.config = loadConfig();

    const agentDir = this.config.brainDir.replace(/\/brain$/, "");

    // Create SystemPromptBuilder (handles calendar, identity, skills)
    this.promptBuilder = new SystemPromptBuilder({
      brainDir: this.config.brainDir,
      agentDir,
    });

    // Wire hooks for audit logging and safety
    this.hooks = createHooks("brain", { agentDir });
    console.log(
      `[SessionManager] Initialized (trust: brain, dir: ${agentDir})`,
    );
  }

  async *streamMessage(
    content: string | ContentBlock[],
    options?: StreamOptions,
  ): AsyncGenerator<StreamEvent> {
    await this.ensureInitialized();

    // Use override model if provided, otherwise use config default
    const model = options?.model || this.config!.model;

    // Debug logging to trace model flow
    console.log(
      `[SessionManager] options.model: ${options?.model}, config.model: ${this.config!.model}, final: ${model}`,
    );

    // Haiku doesn't support extended thinking — ignore reasoning flag for Haiku
    const isHaiku = model.includes("haiku");
    const reasoning = options?.reasoning && !isHaiku;

    // Increment once per user message — not per buildQuery call (avoids double-increment on fallback)
    this.messageIndex++;

    const q = await this.buildQuery(content, model, reasoning);

    this.activeQuery = q;
    let assistantContent = "";

    try {
      try {
        for await (const event of processStream(q)) {
          if (event.type === "session_init") {
            this.sdkSessionId = event.sessionId;
            console.log(
              `[SessionManager] Captured SDK session ID: ${this.sdkSessionId}`,
            );
          }

          if (event.type === "text_delta") {
            assistantContent += event.text;
          }
          yield event;
        }
      } catch (resumeError) {
        // If we were resuming and it failed, fall back to a fresh session
        if (!this.sdkSessionId) throw resumeError; // Already fresh — nothing to fall back to

        console.warn(
          `[SessionManager] SDK session resume failed (${this.sdkSessionId}), falling back to fresh session: ${resumeError instanceof Error ? resumeError.message : String(resumeError)}`,
        );

        // Clear stale session ID so buildQuery omits resume on retry
        this.sdkSessionId = null;
        assistantContent = "";

        // Build fresh query with same messageIndex (no re-increment)
        const freshQ = await this.buildQuery(content, model, reasoning);
        this.activeQuery = freshQ;

        for await (const event of processStream(freshQ)) {
          if (event.type === "session_init") {
            this.sdkSessionId = event.sessionId;
            console.log(
              `[SessionManager] Captured SDK session ID (fresh fallback): ${this.sdkSessionId}`,
            );
          }

          if (event.type === "text_delta") {
            assistantContent += event.text;
          }
          yield event;
        }
      }
    } finally {
      this.activeQuery = null;
    }
  }

  /**
   * Build the brain query — always passes systemPrompt (via SystemPromptBuilder)
   * and resume (when a session ID is available). Single code path.
   */
  private async buildQuery(
    content: string | ContentBlock[],
    model: string,
    reasoning: boolean | undefined,
  ): Promise<Query> {
    const buildContext: BuildContext = {
      channel: this.channel,
      conversationId: this.conversationId,
      messageIndex: this.messageIndex,
    };

    const systemPrompt = await this.promptBuilder!.build(buildContext);

    const opts: BrainSessionOptions = {
      model,
      systemPrompt,
      includePartialMessages: true,
      reasoning,
      hooks: this.hooks ?? undefined,
      mcpServers: sharedMcpServers ?? undefined,
    };

    if (this.sdkSessionId) {
      opts.resume = this.sdkSessionId;
      console.log(
        `[SessionManager] Resuming SDK session: ${this.sdkSessionId} (message ${this.messageIndex})`,
      );
    } else {
      console.log(
        `[SessionManager] Starting new SDK session (message ${this.messageIndex})`,
      );
    }

    return createBrainQuery(content, opts);
  }

  async abort(): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.interrupt();
    }
  }
}
