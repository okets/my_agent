import {
  createBrainQuery,
  loadConfig,
  createHooks,
  createMemoryServer,
  filterSkillsByTools,
  cleanupSkillFilters,
  coreAgents,
  createDelegationEnforcer,
  createCapabilityRateLimiter,
  createCapabilityAuditLogger,
  storeAndInject,
  parseMcpToolName,
  McpCapabilityCfrDetector,
} from "@my-agent/core";
import type { DelegationEnforcer, AuditEntry, StoreCallback } from "@my-agent/core";
import type {
  Query,
  ContentBlock,
  BrainConfig,
  BrainSessionOptions,
  HookEvent,
  HookCallbackMatcher,
  SearchService,
  CapabilityRegistry,
  CfrEmitter,
  TriggeringOrigin,
  ConversationSessionContext,
  ChannelContext,
} from "@my-agent/core";
import type { Options, PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
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

/** VAS store callback — set from app.ts so PostToolUse hook can store screenshots */
let vasStoreCallback: StoreCallback | null = null;

/**
 * Register the VisualActionService store callback for screenshot interception.
 * Called from app.ts after VAS is created.
 */
export function setVasStoreCallback(store: StoreCallback): void {
  vasStoreCallback = store;
}

/**
 * CFR wiring for the McpCapabilityCfrDetector (M9.6-S12).
 * Set from app.ts once the CfrEmitter and CapabilityRegistry are available.
 * When both are present, each SessionManager attaches a per-session
 * McpCapabilityCfrDetector to its brain query hooks and calls
 * `processSystemInit()` on the init frame of the message loop.
 */
let sharedCfrEmitter: CfrEmitter | null = null;
let sharedCapabilityRegistry: CapabilityRegistry | null = null;

/**
 * Register CFR detector dependencies. Called from app.ts after CapabilityRegistry
 * is scanned and CfrEmitter is wired. Without this, brain sessions do not detect
 * MCP plug failures.
 */
export function setCfrDetectorDeps(
  cfr: CfrEmitter,
  registry: CapabilityRegistry,
): void {
  sharedCfrEmitter = cfr;
  sharedCapabilityRegistry = registry;
  console.log(`[SessionManager] CFR detector deps registered`);
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
    getDegradedCapabilities?: () => { type: string; name: string; friendlyName: string }[];
  },
): SystemPromptBuilder {
  sharedPromptBuilder = new SystemPromptBuilder({
    brainDir,
    agentDir,
    getNotebookLastUpdated: options?.getNotebookLastUpdated,
    getCapabilities: options?.getCapabilities,
    getDegradedCapabilities: options?.getDegradedCapabilities,
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
  capabilityRegistry?: CapabilityRegistry,
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

  // Browser-control capabilities (M9.5-S7: registry-only)
  const browserCaps =
    capabilityRegistry
      ?.listByProvides("browser-control")
      .filter((c) => c.status === "available" && c.enabled) ?? [];

  for (const cap of browserCaps) {
    const { command, args } = parseEntrypoint(cap.entrypoint ?? "", cap.path);
    // SDK type has no `cwd`; parseEntrypoint absolutizes script paths and
    // the wrapper resolves capabilityRoot via import.meta.url.
    servers[cap.name] = {
      type: "stdio" as const,
      command,
      args,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          (e): e is [string, string] => e[1] !== undefined,
        ),
      ),
    };
  }
  if (browserCaps.length > 0) {
    console.log(
      `[SessionManager] browser-control: ${browserCaps.length} registry capability(ies) — ${browserCaps.map((c) => c.name).join(", ")}`,
    );
  } else {
    console.log(
      `[SessionManager] browser-control: no capabilities registered — browser tools unavailable`,
    );
  }

  sharedMcpServers = servers;
}

/**
 * Parse a CAPABILITY.md `entrypoint` string into `{ command, args }`.
 * Args that look like relative paths (start with `.` or contain `/` without
 * starting with `/`) are resolved against the capability folder.
 */
function parseEntrypoint(
  entrypoint: string,
  capPath: string,
): { command: string; args: string[] } {
  const parts = entrypoint.trim().split(/\s+/);
  const command = parts[0] ?? "";
  const args = parts.slice(1).map((arg) =>
    arg.startsWith(".") || (!arg.startsWith("/") && arg.includes("/"))
      ? path.join(capPath, arg)
      : arg,
  );
  return { command, args };
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

/** Shape of the briefing result returned by pendingBriefingProvider. */
export interface BriefingResult {
  lines: string[];
  markDelivered: () => void;
}

/**
 * Wrap a StreamEvent async iterable, firing briefingResult.markDelivered() exactly
 * once after the first text_delta event. If the stream ends or throws without
 * yielding a text_delta, markDelivered is never called — the briefing stays
 * in pending/ and will be re-included by the next session.
 *
 * Exported so tests can exercise the timing invariant without a full SessionManager.
 */
export async function* ackBriefingOnFirstOutput(
  stream: AsyncIterable<StreamEvent>,
  briefingResult: BriefingResult | null,
): AsyncGenerator<StreamEvent> {
  let delivered = false;
  for await (const event of stream) {
    if (!delivered && briefingResult && event.type === "text_delta") {
      briefingResult.markDelivered();
      delivered = true;
    }
    yield event;
  }
}

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
  private delegationEnforcer: DelegationEnforcer = createDelegationEnforcer(2);
  /** Briefing captured in buildQuery, marked delivered after first model output. */
  private pendingBriefingResult: { lines: string[]; markDelivered: () => void } | null = null;

  /**
   * M9.6-S12 — per-session context map, keyed by SDK `session_id`.
   * Populated when the SDK's `system.init` event fires (captures `session_id`).
   * Cleared at end of `streamMessage()` in the `finally` block.
   * Consumed by the McpCapabilityCfrDetector's originFactory to resolve the
   * TriggeringOrigin for MCP plug failures detected in this session.
   */
  private sessionContexts = new Map<string, ConversationSessionContext>();

  /**
   * M9.6-S12 — turn context captured from the caller before `streamMessage()`
   * starts streaming. Promoted into `sessionContexts` once the SDK delivers a
   * `session_id`. Null when no turn context is pending (e.g. injectSystemTurn
   * without a preceding setTurnContext call).
   */
  private pendingTurnContext: ConversationSessionContext | null = null;

  /**
   * M9.6-S12 — per-session McpCapabilityCfrDetector. Instantiated lazily in
   * `doInitialize()` when CFR deps are present; one instance per SessionManager
   * so the Mode-3 idempotency `initEmitted` set is session-scoped.
   */
  private cfrDetector: McpCapabilityCfrDetector | null = null;

  constructor(conversationId: string, sdkSessionId?: string | null) {
    this.conversationId = conversationId;
    this.sdkSessionId = sdkSessionId ?? null;
  }

  /** Set the channel for the next query (per-message, not per-session) */
  setChannel(channel: string): void {
    this.channel = channel;
  }

  /**
   * M9.6-S12 — record the full turn context that will seed
   * `ConversationSessionContext` when the SDK session opens.
   *
   * Called by chat-service immediately before `streamMessage()` so the MCP CFR
   * detector's originFactory can resolve the full origin (channel, conversation,
   * turn number) for failures that fire mid-session. The struct must be fully
   * populated per the S12 D3 ChannelContext-completeness constraint — empty
   * defaults would produce an un-deliverable ack.
   *
   * If the caller does not invoke this before `streamMessage()`, the detector's
   * originFactory will throw at hook-fire time (by design — a missing context
   * is a programming error, not a runtime path).
   */
  setTurnContext(channel: ChannelContext, turnNumber: number): void {
    this.pendingTurnContext = {
      kind: "conversation",
      channel,
      conversationId: this.conversationId,
      turnNumber,
    };
  }

  /**
   * M9.6-S12 — return the origin for a given SDK session_id, or `undefined`
   * if no context is tracked. Used by the detector's originFactory (which
   * throws on undefined, per D1) and by the app-level CapabilityInvoker
   * factory (which needs to resolve "the currently active session").
   */
  getSessionContext(
    sessionId: string,
  ): ConversationSessionContext | undefined {
    return this.sessionContexts.get(sessionId);
  }

  /**
   * M9.6-S12 — return the origin for this SessionManager's current active
   * SDK session, or `undefined` if no session is active. Consumers that need
   * "throw-on-miss" behavior (the detector; the CapabilityInvoker) must
   * handle the undefined case themselves.
   */
  getCurrentOrigin(): TriggeringOrigin | undefined {
    if (!this.sdkSessionId) return undefined;
    const ctx = this.sessionContexts.get(this.sdkSessionId);
    if (!ctx) return undefined;
    return {
      kind: "conversation",
      channel: ctx.channel,
      conversationId: ctx.conversationId,
      turnNumber: ctx.turnNumber,
    };
  }

  /** True when this session is the currently-streaming brain session. */
  hasActiveSession(): boolean {
    return this.activeQuery !== null && this.sdkSessionId !== null;
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
    // Add delegation enforcement — limit WebSearch calls per turn
    if (!this.hooks.PreToolUse) this.hooks.PreToolUse = [];
    this.hooks.PreToolUse.push({
      matcher: "WebSearch",
      hooks: [this.delegationEnforcer.preToolUse],
    });

    // Capability rate limiter — PreToolUse: block tool call when limit exceeded (S1 deferred, wired in S3)
    const capRateLimiter = createCapabilityRateLimiter({ maxPerMinute: 30 })

    this.hooks!.PreToolUse!.push({
      matcher: 'desktop_.*',
      hooks: [
        async (_input) => {
          const allowed = capRateLimiter.check('desktop-control')
          if (!allowed) {
            return {
              systemMessage: `Rate limit exceeded for desktop-control (30/min). Wait before retrying.`,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: 'deny' as const,
                permissionDecisionReason: 'Capability rate limit exceeded (30 calls per minute)',
              },
            }
          }
          return {}
        },
      ],
    })

    // Capability audit logger + screenshot pipeline — PostToolUse
    const auditLogPath = join(agentDir, 'logs', 'capability-audit.jsonl')
    const capAuditLogger = createCapabilityAuditLogger(async (entry: AuditEntry) => {
      try {
        await mkdir(dirname(auditLogPath), { recursive: true })
        await appendFile(auditLogPath, JSON.stringify(entry) + '\n', 'utf-8')
      } catch {
        // Audit logging is best-effort
      }
    })

    if (!this.hooks!.PostToolUse) this.hooks!.PostToolUse = []
    this.hooks!.PostToolUse.push({
      hooks: [
        async (input) => {
          const postInput = input as PostToolUseHookInput
          const toolName = postInput.tool_name ?? 'unknown'

          // Audit logging — framework is capability-agnostic, derive server name from tool prefix
          const parsed = parseMcpToolName(toolName)
          if (parsed) {
            await capAuditLogger.log({
              capabilityName: parsed.server,
              toolName: parsed.tool,
              sessionId: postInput.session_id,
            })
          }

          // Screenshot pipeline — store and inject URL for any image-producing tool
          if (vasStoreCallback) {
            return storeAndInject(postInput.tool_response, toolName, vasStoreCallback)
          }

          return {}
        },
      ],
    })

    // M9.6-S12 — MCP CFR detector. One instance per SessionManager so the
    // Mode-3 idempotency `initEmitted` set stays session-scoped. Hooks fire
    // with `BaseHookInput.session_id`, which the originFactory uses to look up
    // the owning ConversationSessionContext from this manager's `sessionContexts` map.
    if (sharedCfrEmitter && sharedCapabilityRegistry) {
      const detectorSessionContexts = this.sessionContexts;
      this.cfrDetector = new McpCapabilityCfrDetector({
        cfr: sharedCfrEmitter,
        registry: sharedCapabilityRegistry,
        originFactory: () => {
          // The detector's hook callback captures `input.session_id` and calls
          // originFactory synchronously. We read `this.sdkSessionId` which is
          // current at the moment of the hook fire (single-threaded per session).
          const sessionId = this.sdkSessionId;
          if (!sessionId) {
            throw new Error(
              "[McpCfrDetector] originFactory called with no active SDK session",
            );
          }
          const ctx = detectorSessionContexts.get(sessionId);
          if (!ctx) {
            throw new Error(
              `[McpCfrDetector] No SessionContext for session_id "${sessionId}" — ` +
                "this is a programming error: originFactory called outside an active session",
            );
          }
          return {
            kind: "conversation",
            channel: ctx.channel,
            conversationId: ctx.conversationId,
            turnNumber: ctx.turnNumber,
          };
        },
      });

      // Attach detector's hooks alongside audit/screenshot hooks.
      for (const [event, matchers] of Object.entries(this.cfrDetector.hooks) as [
        HookEvent,
        HookCallbackMatcher[] | undefined,
      ][]) {
        if (!matchers) continue;
        if (!this.hooks![event]) this.hooks![event] = [];
        this.hooks![event]!.push(...matchers);
      }
      console.log(
        `[SessionManager] McpCapabilityCfrDetector attached to brain hooks`,
      );
    }

    console.log(
      `[SessionManager] Initialized (trust: brain, dir: ${agentDir})`,
    );

    // Disable skills whose required tools aren't available in Conversation Nina's session
    this.disabledSkills = await filterSkillsByTools(
      agentDir,
      CONVERSATION_TOOLS,
    );

    // Wire excluded skills into prompt builder so they're omitted from system prompt
    if (this.disabledSkills.length > 0 && this.promptBuilder) {
      this.promptBuilder.excludeSkills = new Set(this.disabledSkills);
    }
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
    // M9.6-S12: track the session_id(s) promoted into sessionContexts during
    // this call so the `finally` block can clean them up — both the originally
    // captured session (resume case) and any fresh-fallback session.
    const promotedSessionIds = new Set<string>();

    try {
      try {
        for await (const event of ackBriefingOnFirstOutput(processStream(q), this.pendingBriefingResult)) {
          if (event.type === "session_init") {
            this.sdkSessionId = event.sessionId;
            console.log(
              `[SessionManager] Captured SDK session ID: ${this.sdkSessionId}`,
            );
            // M9.6-S12: promote pending turn context into the session map.
            if (this.pendingTurnContext) {
              this.sessionContexts.set(event.sessionId, this.pendingTurnContext);
              promotedSessionIds.add(event.sessionId);
            }
          }
          if (event.type === "system_init_raw") {
            // M9.6-S12: Mode-3 MCP detection — scan mcp_servers[] for failed plugs.
            this.cfrDetector?.processSystemInit(event.message);
          }

          if (event.type === "text_delta") {
            assistantContent += event.text;
          }
          yield event;
        }
        // ackBriefingOnFirstOutput fired markDelivered on first text_delta (if any).
        // Clear local ref so the fresh-fallback loop doesn't double-fire.
        this.pendingBriefingResult = null;
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

        for await (const event of ackBriefingOnFirstOutput(processStream(freshQ), this.pendingBriefingResult)) {
          if (event.type === "session_init") {
            this.sdkSessionId = event.sessionId;
            console.log(
              `[SessionManager] Captured SDK session ID (fresh fallback): ${this.sdkSessionId}`,
            );
            // M9.6-S12: promote pending turn context into the session map.
            if (this.pendingTurnContext) {
              this.sessionContexts.set(event.sessionId, this.pendingTurnContext);
              promotedSessionIds.add(event.sessionId);
            }
          }
          if (event.type === "system_init_raw") {
            this.cfrDetector?.processSystemInit(event.message);
          }

          if (event.type === "text_delta") {
            assistantContent += event.text;
          }
          yield event;
        }
        this.pendingBriefingResult = null;
      }
    } finally {
      this.activeQuery = null;
      // M9.6-S12: clear session contexts for sessions promoted in this call.
      // `pendingTurnContext` is cleared regardless; a stale pending context
      // would be threaded into the next turn otherwise.
      for (const sid of promotedSessionIds) {
        this.sessionContexts.delete(sid);
      }
      this.pendingTurnContext = null;
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
    // Reset WebSearch budget for each new user message
    this.delegationEnforcer.resetTurn();

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

    // Store briefing result — markDelivered fires after first model output in streamMessage,
    // not here. Firing here risks marking delivered when the session throws before generating output.
    if (briefingResult && briefingResult.lines.length > 0) {
      this.pendingBriefingResult = briefingResult;
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

  /** Whether the session is currently streaming a response. */
  isStreaming(): boolean {
    return this.activeQuery !== null;
  }

  /**
   * Inject a synthetic system turn into the active session.
   * Used for genuine system events (mount failures, infra alerts).
   *
   * Wraps the prompt in [SYSTEM: ] format so the brain reads it as
   * instructional context to acknowledge, not as a user-role action to
   * perform. The caller is responsible for NOT appending this synthetic
   * turn to the transcript — only the brain's response should be recorded.
   *
   * For proactive deliveries (briefs, scheduled sessions, `notify: immediate`
   * job completions), use `injectActionRequest` instead — that path delivers
   * the prompt as a bare user-role turn, which Nina's response loop
   * interprets as a request to fulfill.
   */
  async *injectSystemTurn(prompt: string): AsyncGenerator<StreamEvent> {
    yield* this.streamMessage(`[SYSTEM: ${prompt}]`);
  }

  /**
   * Inject a synthetic user-role action request into the active session.
   * Used by ConversationInitiator for proactive deliveries (briefs, scheduled
   * sessions, `notify: immediate` job completions).
   *
   * Unlike `injectSystemTurn`, this does NOT wrap the prompt in `[SYSTEM: …]`.
   * The prompt is delivered as a bare user-role turn — the model's response
   * loop interprets it as a request to fulfill, not status context to
   * acknowledge. M9.4-S4.2 design principle: proactive deliveries are
   * action requests, not status notes.
   *
   * Caller is responsible for NOT appending the synthetic prompt to the
   * transcript — only the brain's response should be recorded.
   */
  async *injectActionRequest(prompt: string): AsyncGenerator<StreamEvent> {
    yield* this.streamMessage(prompt);
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
