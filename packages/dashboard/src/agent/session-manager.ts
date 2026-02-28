import {
  createBrainQuery,
  loadConfig,
  assembleSystemPrompt,
  assembleCalendarContext,
  createCalDAVClient,
  loadCalendarConfig,
  loadCalendarCredentials,
  createHooks,
  createMemoryServer,
} from "@my-agent/core";
import type {
  Query,
  ContentBlock,
  BrainConfig,
  HookEvent,
  HookCallbackMatcher,
  SearchService,
} from "@my-agent/core";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { processStream, type StreamEvent } from "./stream-processor.js";

/** Cached MCP servers — initialized once via initMcpServers() */
let sharedMcpServers: Options["mcpServers"] | null = null;

/**
 * Initialize MCP servers for brain sessions.
 * Call once from index.ts after searchService is ready.
 */
export function initMcpServers(
  searchService: SearchService,
  notebookDir: string,
): void {
  const memoryServer = createMemoryServer({ notebookDir, searchService });
  sharedMcpServers = { memory: memoryServer };
  console.log(
    `[SessionManager] MCP servers initialized (memory → ${notebookDir})`,
  );
}

interface StreamOptions {
  /** Override the default model */
  model?: string;
  /** Enable extended thinking */
  reasoning?: boolean;
}

export class SessionManager {
  private conversationId: string | null;
  private contextInjection: string | null;
  private sdkSessionId: string | null;
  private config: BrainConfig | null = null;
  private baseSystemPrompt: string | null = null;
  private hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> | null =
    null;
  private initPromise: Promise<void> | null = null;
  private activeQuery: Query | null = null;

  constructor(
    conversationId?: string | null,
    contextInjection?: string | null,
    sdkSessionId?: string | null,
  ) {
    this.conversationId = conversationId ?? null;
    this.contextInjection = contextInjection ?? null;
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

    // Try to assemble calendar context (graceful degradation if offline)
    let calendarContext: string | undefined;
    try {
      const agentDir = this.config.brainDir.replace(/\/brain$/, "");
      console.log(
        `[SessionManager] Loading calendar from agentDir: ${agentDir}`,
      );
      const calendarConfig = loadCalendarConfig(agentDir);
      const credentials = loadCalendarCredentials(agentDir);

      console.log(
        `[SessionManager] Calendar config loaded: ${!!calendarConfig}, credentials: ${!!credentials}`,
      );

      if (calendarConfig && credentials) {
        const calendarRepo = await createCalDAVClient(
          calendarConfig,
          credentials,
        );
        calendarContext = await assembleCalendarContext(calendarRepo);
        console.log(
          `[SessionManager] Calendar context assembled (${calendarContext?.length ?? 0} chars)`,
        );
      }
    } catch (err) {
      console.warn(
        `[SessionManager] Calendar context unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.baseSystemPrompt = await assembleSystemPrompt(this.config.brainDir, {
      calendarContext,
    });

    // Wire hooks for audit logging and safety
    const agentDir = this.config.brainDir.replace(/\/brain$/, "");
    this.hooks = createHooks("brain", { agentDir });
    console.log(
      `[SessionManager] Hooks wired (trust: brain, dir: ${agentDir})`,
    );

    console.log(
      `[SessionManager] System prompt assembled (${this.baseSystemPrompt?.length ?? 0} chars), has calendar: ${!!calendarContext}`,
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

    const q = this.buildQuery(content, model, reasoning);

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

        // Clear stale session ID so caller persists null
        this.sdkSessionId = null;
        assistantContent = "";

        // Build fresh query and retry
        const freshQ = this.buildQuery(content, model, reasoning);
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
   * Build the appropriate brain query — resume if we have a session ID, fresh otherwise.
   */
  private buildQuery(
    content: string | ContentBlock[],
    model: string,
    reasoning: boolean | undefined,
  ): Query {
    if (this.sdkSessionId) {
      // Resume existing session — SDK has full context (system prompt, history)
      console.log(
        `[SessionManager] Resuming SDK session: ${this.sdkSessionId}`,
      );
      return createBrainQuery(content, {
        model,
        resume: this.sdkSessionId,
        includePartialMessages: true,
        reasoning,
        hooks: this.hooks ?? undefined,
        mcpServers: sharedMcpServers ?? undefined,
      });
    }

    // First message — build system prompt with context injection
    let systemPrompt = this.baseSystemPrompt!;

    // Inject conversation ID for task-conversation linking
    if (this.conversationId) {
      systemPrompt += `\n\n[Session Context]\nCurrent conversation ID: ${this.conversationId}\n[End Session Context]`;
    }

    // Add cold-start context injection (abbreviation + older turns from transcript)
    if (this.contextInjection) {
      systemPrompt += `\n\n${this.contextInjection}`;
    }

    console.log(
      `[SessionManager] Starting new SDK session (systemPrompt: ${systemPrompt.length} chars)`,
    );
    return createBrainQuery(content, {
      model,
      systemPrompt,
      continue: false,
      includePartialMessages: true,
      reasoning,
      hooks: this.hooks ?? undefined,
      mcpServers: sharedMcpServers ?? undefined,
    });
  }

  async abort(): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.interrupt();
    }
  }
}
