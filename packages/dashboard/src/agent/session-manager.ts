import {
  createBrainQuery,
  loadConfig,
  createHooks,
  createMemoryServer,
  filterSkillsByTools,
  cleanupSkillFilters,
  coreAgents,
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
import { createTodoServer } from "../mcp/todo-server.js";
import path from "node:path";
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

/** Pending briefing provider — returns formatted briefing lines and marks them delivered */
let pendingBriefingProvider:
  | (() => { lines: string[]; markDelivered: () => void })
  | null = null;

/**
 * Register a callback to fetch pending briefing items from the notification queue.
 * Returns formatted lines + a markDelivered callback to move them from pending/ to delivered/.
 */
export function setPendingBriefingProvider(
  provider: () => { lines: string[]; markDelivered: () => void },
): void {
  pendingBriefingProvider = provider;
}

/** Conversation todo provider — returns todo items for a conversation */
let conversationTodoProvider:
  | ((conversationId: string) => Array<{ text: string; status: string }>)
  | null = null;

/**
 * Register a callback to fetch Conversation Nina's own todo items.
 */
export function setConversationTodoProvider(
  provider: (conversationId: string) => Array<{ text: string; status: string }>,
): void {
  conversationTodoProvider = provider;
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
  options?: {
    getNotebookLastUpdated?: () => string | null;
    getCapabilities?: () => import("@my-agent/core").Capability[];
  },
): SystemPromptBuilder {
  sharedPromptBuilder = new SystemPromptBuilder({
    brainDir,
    agentDir,
    getNotebookLastUpdated: options?.getNotebookLastUpdated,
    getCapabilities: options?.getCapabilities,
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

/**
 * MCP server factories — create a new instance per session.
 * Use for in-process SDK MCP servers that can only bind to one transport
 * at a time (concurrent sessions would fail with "Already connected").
 */
const mcpServerFactories: Record<
  string,
  () => Promise<NonNullable<Options["mcpServers"]>[string]>
> = {};

export function addMcpServerFactory(
  name: string,
  factory: () => Promise<NonNullable<Options["mcpServers"]>[string]>,
): void {
  mcpServerFactories[name] = factory;
  console.log(`[SessionManager] MCP server factory added: ${name}`);
}

/**
 * Build MCP servers for a session — shared singletons + fresh factory instances.
 */
export async function buildMcpServersForSession(): Promise<
  Options["mcpServers"] | undefined
> {
  const servers: NonNullable<Options["mcpServers"]> = {
    ...(sharedMcpServers ?? {}),
  };
  for (const [name, factory] of Object.entries(mcpServerFactories)) {
    servers[name] = await factory();
  }
  return Object.keys(servers).length > 0 ? servers : undefined;
}

interface StreamOptions {
  /** Override the default model */
  model?: string;
  /** Enable extended thinking */
  reasoning?: boolean;
}

/** Conversation Nina's allowed tools — single source of truth for buildQuery and skill filtering */
const CONVERSATION_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Skill",
];

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
  private activeViewContext: {
    type: "space" | "automation" | "conversation" | "notebook" | "calendar";
    id: string;
    name: string;
  } | null = null;
  private agentDir: string | null = null;
  private disabledSkills: string[] = [];
  private pendingNotifications: string[] = [];

  constructor(conversationId: string, sdkSessionId?: string | null) {
    this.conversationId = conversationId;
    this.sdkSessionId = sdkSessionId ?? null;
  }

  /** Set the channel for the next query (per-message, not per-session) */
  setChannel(channel: string): void {
    this.channel = channel;
  }

  /** Set view context for the next query (cleared after use) */
  setViewContext(type: string, id: string, name: string): void {
    this.activeViewContext = { type: type as any, id, name };
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
    this.hooks = createHooks("brain", {
      agentDir,
      projectRoot: path.resolve(agentDir, ".."),
    });

    // Add model change broadcast on capability-builder start/stop
    if (!this.hooks.SubagentStart) this.hooks.SubagentStart = [];
    this.hooks.SubagentStart.push({
      matcher: "capability-builder",
      hooks: [
        async () => {
          broadcastModelChange("opus");
          return {};
        },
      ],
    });
    if (!this.hooks.SubagentStop) this.hooks.SubagentStop = [];
    this.hooks.SubagentStop.push({
      matcher: "capability-builder",
      hooks: [
        async () => {
          broadcastModelChange("sonnet");
          return {};
        },
      ],
    });
    console.log(
      `[SessionManager] Initialized (trust: brain, dir: ${agentDir})`,
    );

    // Disable skills whose required tools aren't available in Conversation Nina's session
    this.disabledSkills = await filterSkillsByTools(
      agentDir,
      CONVERSATION_TOOLS,
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

    // Drain pending notifications and prepend to content as system context
    if (this.pendingNotifications.length > 0) {
      const notifications = this.pendingNotifications.splice(0);
      const notificationBlock = notifications
        .map((n) => `[SYSTEM: ${n}]`)
        .join("\n\n");
      console.log(
        `[SessionManager] Delivering ${notifications.length} queued notification(s) for conversation ${this.conversationId}`,
      );

      if (typeof content === "string") {
        content = `${notificationBlock}\n\n${content}`;
      } else {
        // Prepend notification text block to content blocks array
        content = [
          { type: "text" as const, text: notificationBlock },
          ...content,
        ];
      }
    }

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

    // Fetch pending briefing (notifications from queue)
    const briefingResult = pendingBriefingProvider
      ? pendingBriefingProvider()
      : null;

    // Fetch conversation todos
    const conversationTodos = conversationTodoProvider
      ? conversationTodoProvider(this.conversationId)
      : [];

    const buildContext: BuildContext = {
      channel: this.channel,
      conversationId: this.conversationId,
      messageIndex: this.messageIndex,
      activeWorkingAgents,
      pendingBriefing: briefingResult?.lines,
      conversationTodos,
      activeViewContext: this.activeViewContext,
    };
    // Clear after use — only applies to this message
    this.activeViewContext = null;

    const systemPrompt = await this.promptBuilder!.build(buildContext);

    // Mark briefing notifications as delivered — they're now in Nina's context
    if (briefingResult && briefingResult.lines.length > 0) {
      briefingResult.markDelivered();
    }

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
        "capability-builder": coreAgents["capability-builder"],
      },
      includePartialMessages: true,
      reasoning,
      hooks: this.hooks ?? undefined,
      mcpServers: await buildMcpServersForSession(),
    };

    // Add per-conversation todo server (conversation-scoped, not shared)
    if (this.agentDir && opts.mcpServers) {
      const todoPath = path.join(
        this.agentDir,
        "conversations",
        this.conversationId,
        "todos.json",
      );
      opts.mcpServers["todo"] = createTodoServer(todoPath);
    }

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
  /** Whether the session is currently streaming a response. */
  isStreaming(): boolean {
    return this.activeQuery !== null;
  }

  /**
   * Queue a notification for delivery on the next streamMessage() call.
   * Used when a job completes while the session is busy streaming.
   * The notification will be prepended to the user's message as a [SYSTEM: ] block.
   */
  queueNotification(prompt: string): void {
    this.pendingNotifications.push(prompt);
    console.log(
      `[SessionManager] Queued notification (${this.pendingNotifications.length} pending) for conversation ${this.conversationId}`,
    );
  }

  /**
   * Check if there are pending notifications waiting to be delivered.
   */
  hasPendingNotifications(): boolean {
    return this.pendingNotifications.length > 0;
  }

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

/** Shared connection registry for model change broadcasts */
let sharedConnectionRegistry: {
  broadcastToAll: (msg: { type: "model_changed"; model: string }) => void;
} | null = null;

/** Set the connection registry for model change broadcasts. Called from App init. */
export function setConnectionRegistry(registry: {
  broadcastToAll: (msg: { type: "model_changed"; model: string }) => void;
}): void {
  sharedConnectionRegistry = registry;
}

/**
 * Broadcast a model change to all connected dashboard clients.
 * Called by the capability brainstorming/building system.
 */
export function broadcastModelChange(model: string): void {
  sharedConnectionRegistry?.broadcastToAll({ type: "model_changed", model });
}
