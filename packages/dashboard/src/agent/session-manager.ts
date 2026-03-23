import {
  createBrainQuery,
  loadConfig,
  createHooks,
  createMemoryServer,
  filterSkillsByTools,
  cleanupSkillFilters,
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
import { createKnowledgeServer } from "../mcp/knowledge-server.js";
import { createDebriefMcpServer } from "../mcp/debrief-server.js";
import type { DebriefSchedulerLike } from "../mcp/debrief-server.js";
import type { ConversationSearchService } from "../conversations/search-service.js";
import type { ConversationManager } from "../conversations/manager.js";

/** Cached MCP servers — initialized once via initMcpServers() */
let sharedMcpServers: Options["mcpServers"] | null = null;

/** Optional callback to check for running tasks linked to a conversation */
let runningTasksChecker: ((conversationId: string) => string[]) | null = null;

/**
 * Register a callback to check for running tasks linked to a conversation.
 * SessionManager uses this to populate activeWorkingAgents in the system prompt.
 */
export function setRunningTasksChecker(
  checker: (conversationId: string) => string[],
): void {
  runningTasksChecker = checker;
}

/** Shared prompt builder — initialized once via initPromptBuilder(), shared across all sessions */
let sharedPromptBuilder: SystemPromptBuilder | null = null;

/**
 * Initialize the shared SystemPromptBuilder.
 * Call once from index.ts after agent dir is known.
 * Returns the builder so index.ts can wire cache invalidation.
 */
export function initPromptBuilder(
  brainDir: string,
  agentDir: string,
  options?: { getNotebookLastUpdated?: () => string | null },
): SystemPromptBuilder {
  sharedPromptBuilder = new SystemPromptBuilder({
    brainDir,
    agentDir,
    getNotebookLastUpdated: options?.getNotebookLastUpdated,
  });
  console.log(`[SessionManager] Shared SystemPromptBuilder initialized`);
  return sharedPromptBuilder;
}

/**
 * Get the shared prompt builder (for cache invalidation wiring).
 */
export function getPromptBuilder(): SystemPromptBuilder | null {
  return sharedPromptBuilder;
}

/**
 * Initialize MCP servers for brain sessions.
 * Call once from index.ts after searchService is ready.
 */
export function initMcpServers(
  searchService: SearchService,
  notebookDir: string,
  conversationSearchService?: ConversationSearchService,
  conversationManager?: ConversationManager,
  debriefScheduler?: DebriefSchedulerLike,
): void {
  // Derive agentDir from notebookDir (parent directory)
  const agentDir = notebookDir.replace(/\/notebook$/, "");

  const memoryServer = createMemoryServer({ notebookDir, searchService });
  const servers: NonNullable<Options["mcpServers"]> = {
    memory: memoryServer,
  };

  if (conversationSearchService && conversationManager) {
    servers.conversations = createConversationServer({
      conversationSearchService,
      conversationManager,
    });
    servers.knowledge = createKnowledgeServer({ agentDir });
    console.log(
      `[SessionManager] MCP servers initialized (memory → ${notebookDir}, conversations, knowledge)`,
    );
  } else {
    servers.knowledge = createKnowledgeServer({ agentDir });
    console.log(
      `[SessionManager] MCP servers initialized (memory → ${notebookDir}, knowledge)`,
    );
  }

  if (debriefScheduler) {
    servers.debrief = createDebriefMcpServer(debriefScheduler);
    console.log(`[SessionManager] Debrief MCP server registered`);
  }

  // Playwright browser automation MCP server (stdio transport)
  servers.playwright = {
    type: "stdio" as const,
    command: "npx",
    args: ["@playwright/mcp"],
  };
  console.log(`[SessionManager] Playwright MCP server registered`);

  sharedMcpServers = servers;
}

/**
 * Get the shared MCP servers (for TaskExecutor and other consumers).
 * Returns null if initMcpServers() has not been called yet.
 */
export function getSharedMcpServers(): Options["mcpServers"] | null {
  return sharedMcpServers;
}

/**
 * Add a single MCP server to the shared pool.
 * Must be called after initMcpServers() has been called.
 * Allows index.ts to register additional servers (e.g. task-revision)
 * that depend on services not yet available when initMcpServers() runs.
 */
export function addMcpServer(
  name: string,
  server: NonNullable<Options["mcpServers"]>[string],
): void {
  if (!sharedMcpServers) {
    sharedMcpServers = {};
  }
  sharedMcpServers[name] = server;
  console.log(`[SessionManager] MCP server added: ${name}`);
}

interface StreamOptions {
  /** Override the default model */
  model?: string;
  /** Enable extended thinking */
  reasoning?: boolean;
}

/** Conversation Nina's allowed tools — single source of truth for buildQuery and skill filtering */
const CONVERSATION_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "Skill"];

export class SessionManager {
  private conversationId: string;
  private channel: string = "web";
  private sdkSessionId: string | null;
  private config: BrainConfig | null = null;
  private hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | null =
    null;
  private initPromise: Promise<void> | null = null;
  private activeQuery: Query | null = null;
  private messageIndex = 0;
  private promptBuilder: SystemPromptBuilder | null = null;
  private activeTaskContext: { taskId: string; title: string } | null = null;
  private activeAutomationContext: {
    automationId: string;
    name: string;
  } | null = null;
  private agentDir: string | null = null;
  private disabledSkills: string[] = [];

  constructor(conversationId: string, sdkSessionId?: string | null) {
    this.conversationId = conversationId;
    this.sdkSessionId = sdkSessionId ?? null;
  }

  /** Set the channel for the next query (per-message, not per-session) */
  setChannel(channel: string): void {
    this.channel = channel;
  }

  /** Set task context for the next query (cleared after use) */
  setTaskContext(taskId: string, title: string): void {
    this.activeTaskContext = { taskId, title };
  }

  /** Set automation context for the next query (cleared after use) */
  setAutomationContext(automationId: string, name: string): void {
    this.activeAutomationContext = { automationId, name };
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
    this.agentDir = agentDir;

    // Use shared SystemPromptBuilder (initialized in index.ts), fall back to local instance
    this.promptBuilder =
      sharedPromptBuilder ??
      new SystemPromptBuilder({
        brainDir: this.config.brainDir,
        agentDir,
      });

    // Wire hooks for audit logging and safety
    this.hooks = createHooks("brain", { agentDir });
    console.log(
      `[SessionManager] Initialized (trust: brain, dir: ${agentDir})`,
    );

    // Disable skills whose required tools aren't available in Conversation Nina's session
    this.disabledSkills = await filterSkillsByTools(agentDir, CONVERSATION_TOOLS);
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
    const activeWorkingAgents = runningTasksChecker
      ? runningTasksChecker(this.conversationId)
      : [];

    const buildContext: BuildContext = {
      channel: this.channel,
      conversationId: this.conversationId,
      messageIndex: this.messageIndex,
      activeWorkingAgents,
      activeTaskContext: this.activeTaskContext,
      activeAutomationContext: this.activeAutomationContext,
    };
    // Clear after use — only applies to this message
    this.activeTaskContext = null;
    this.activeAutomationContext = null;

    const systemPrompt = await this.promptBuilder!.build(buildContext);

    const opts: BrainSessionOptions = {
      model,
      systemPrompt,
      cwd: this.agentDir!,
      settingSources: ["project"],
      tools: CONVERSATION_TOOLS,
      agents: {
        researcher: {
          description:
            "Read-only helper for quick lookups — reading files, searching code, gathering context. Never makes changes.",
          prompt:
            "You are a read-only research helper. Read files, search code, gather context. Return a concise summary. Never write, edit, or execute commands.",
          tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
          model: "haiku",
        },
      },
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

  /**
   * Inject a synthetic system turn into the active session.
   * Used by ConversationInitiator to alert in active conversations.
   *
   * Wraps the prompt in [SYSTEM: ] format so the brain can distinguish
   * system injections from user messages. The caller is responsible for
   * NOT appending this synthetic turn to the transcript — only the
   * brain's response should be recorded.
   */
  async *injectSystemTurn(prompt: string): AsyncGenerator<StreamEvent> {
    yield* this.streamMessage(`[SYSTEM: ${prompt}]`);
  }

  async abort(): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.interrupt();
    }
    if (this.disabledSkills.length > 0 && this.agentDir) {
      await cleanupSkillFilters(this.agentDir, this.disabledSkills);
      this.disabledSkills = [];
    }
  }
}
