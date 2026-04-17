/**
 * AppChatService — App-owned chat business logic.
 *
 * Stateless service namespace. Takes explicit IDs, returns typed results
 * or async generators. Zero knowledge of WebSocket transport.
 *
 * M6.10-S3: Design spec §S3 (Chat Handler Decomposition)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { App } from "../app.js";
import type { ConversationManager } from "../conversations/index.js";
import { NamingService } from "../conversations/naming.js";
import type { SessionRegistry } from "../agent/session-registry.js";
import type { Conversation, TranscriptTurn } from "../conversations/types.js";
import type { ConversationMeta, Turn } from "../ws/protocol.js";
import { loadModels, classifyEmptyStt, conversationOrigin } from "@my-agent/core";
import type { TriggeringInput } from "@my-agent/core";
import { expandSkillCommand } from "./skill-expander.js";
import type {
  ChatEvent,
  ChatMessageOptions,
  ChatServiceDeps,
  ConnectResult,
  ConversationSwitchResult,
  LoadMoreResult,
  StartEffects,
  SystemMessageOptions,
} from "./types.js";
import { sendSystemMessage } from "./send-system-message.js";

const TURNS_PER_PAGE = 50;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_TITLE_LENGTH = 100;

/**
 * Injected into the user message when input is voice.
 * Guides the brain to write for speech, not for reading.
 */
const VOICE_MODE_HINT = `[VOICE MODE: The user sent a voice message. Your response will be spoken aloud via TTS.

Write for the ear, not the eye:
- Natural conversational sentences — no bullet points, numbered lists, or tables
- No emojis — they don't translate to speech
- No markdown formatting — bold, italic, and headers are invisible in audio
- Keep it concise — spoken responses should be shorter than written ones
- Use punctuation expressively — commas for pauses, em-dashes for emphasis, question marks for rising tone
- No URLs — if you need to share a link, say "I'll send you the link" and follow up in text
- Don't mention that this is a voice message or that you're in voice mode]`;

/**
 * Convert markdown/rich text to speech-friendly plain text.
 * Strips URLs, code blocks, images, and formatting that sounds wrong when spoken.
 */
export function prepareForSpeech(text: string): string {
  let s = text;

  // Remove code blocks (``` ... ```)
  s = s.replace(/```[\s\S]*?```/g, "");

  // Remove inline code (`...`)
  s = s.replace(/`([^`]+)`/g, "$1");

  // Remove image references ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

  // Convert markdown links [text](url) → keep text only
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Remove bare URLs (http/https)
  s = s.replace(/https?:\/\/[^\s)>\]]+/g, "");

  // Remove markdown headings (# ## ### etc) — keep the text
  s = s.replace(/^#{1,6}\s+/gm, "");

  // Remove bold/italic markers
  s = s.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  s = s.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");

  // Remove strikethrough
  s = s.replace(/~~([^~]+)~~/g, "$1");

  // Remove HTML tags
  s = s.replace(/<[^>]+>/g, "");

  // Remove horizontal rules
  s = s.replace(/^[-*_]{3,}\s*$/gm, "");

  // Remove table formatting (pipes and dashes)
  s = s.replace(/^\|.*\|$/gm, "");
  s = s.replace(/^[-|: ]+$/gm, "");

  // Remove bullet markers (-, *, numbered lists)
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");

  // Collapse multiple newlines
  s = s.replace(/\n{3,}/g, "\n\n");

  // Collapse multiple spaces
  s = s.replace(/ {2,}/g, " ");

  return s.trim();
}
const CONVERSATION_ID_RE = /^conv-[A-Z0-9]{26}$/;

export function isValidConversationId(id: string): boolean {
  return CONVERSATION_ID_RE.test(id);
}

// ── CFR helpers (M9.6-S1) ───────────────────────────────────────────────────

/** Map the primary MIME type of an attachment list to a capability type string. */
function detectCapabilityTypeFromMimes(
  attachments: Array<{ mimeType: string }>,
): string {
  const first = attachments[0];
  if (!first) return "attachment-handler";
  if (first.mimeType.startsWith("audio/")) return "audio-to-text";
  if (first.mimeType.startsWith("image/")) return "image-to-text";
  return "attachment-handler";
}

/** Build a TriggeringInput from sendMessage's options and conversation context. */
function buildTriggeringInput(
  options: ChatMessageOptions | undefined,
  convId: string,
  turnNumber: number,
  audioAttachment?: { mimeType: string } | null,
): TriggeringInput {
  const ch = options?.channel ?? {
    transportId: "dashboard",
    channelId: "dashboard",
    sender: "user",
  };
  const channel = {
    transportId: ch.transportId,
    channelId: ch.channelId,
    sender: ch.sender,
    replyTo: ch.replyTo,
    senderName: ch.senderName,
    groupId: ch.groupId,
  };
  const input: TriggeringInput = {
    origin: conversationOrigin(channel, convId, turnNumber),
  };
  if (options?.rawMediaPath) {
    const mimeType = audioAttachment?.mimeType ?? options.attachments?.[0]?.mimeType ?? "application/octet-stream";
    const artifactType: "audio" | "image" | "document" = mimeType.startsWith("audio/")
      ? "audio"
      : mimeType.startsWith("image/")
        ? "image"
        : "document";
    input.artifact = {
      type: artifactType,
      rawMediaPath: options.rawMediaPath,
      mimeType,
    };
  }
  return input;
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert Conversation to ConversationMeta for protocol.
 */
export function toConversationMeta(conv: Conversation): ConversationMeta {
  return {
    id: conv.id,
    title: conv.title,
    topics: conv.topics,
    created: conv.created.toISOString(),
    updated: conv.updated.toISOString(),
    turnCount: conv.turnCount,
    model: conv.model,
    externalParty: conv.externalParty,
    isPinned: conv.isPinned,
    status: conv.status,
  };
}

/**
 * Convert TranscriptTurn to Turn for protocol.
 */
export function toTurn(turn: TranscriptTurn): Turn {
  return {
    role: turn.role,
    content: turn.content,
    timestamp: turn.timestamp,
    turnNumber: turn.turnNumber,
    thinkingText: turn.thinkingText,
    usage: turn.usage,
    cost: turn.cost,
    attachments: turn.attachments,
    audioUrl: turn.audioUrl,
    channel: turn.channel,
  };
}

export class AppChatService {
  private namingService: NamingService | null = null;
  private deps: ChatServiceDeps | null = null;

  constructor(private app: App) {}

  /** Set runtime dependencies (called once from adapter wiring). */
  setDeps(deps: ChatServiceDeps): void {
    this.deps = deps;
  }

  // ─── Read helpers ──────────────────────────────────────────────────

  get conversationManager(): ConversationManager {
    return this.app.conversationManager;
  }

  get sessionRegistry(): SessionRegistry {
    return this.app.sessionRegistry;
  }

  // ─── Conversation Operations ───────────────────────────────────────

  /**
   * Load conversation state (on initial connect or reconnect).
   */
  async connect(conversationId?: string | null): Promise<ConnectResult> {
    let conversation: Conversation | null;

    if (conversationId) {
      conversation = await this.conversationManager.get(conversationId);
      if (!conversation) {
        throw new Error("Conversation not found");
      }
    } else {
      conversation = await this.conversationManager.getCurrent();
    }

    let turns: TranscriptTurn[] = [];
    let meta: ConversationMeta | null = null;

    if (conversation) {
      turns = await this.conversationManager.getTurns(conversation.id, {
        limit: TURNS_PER_PAGE,
      });
      meta = toConversationMeta(conversation);
    }

    const allConversations = await this.conversationManager.list({});

    return {
      conversation: meta,
      turns: turns.map(toTurn),
      hasMore: turns.length === TURNS_PER_PAGE,
      allConversations: allConversations.slice(0, 50).map(toConversationMeta),
    };
  }

  /**
   * Create a new conversation.
   */
  async newConversation(): Promise<ConversationSwitchResult> {
    const conversation = await this.app.conversations.create();
    return {
      conversation: toConversationMeta(conversation),
      turns: [],
      hasMore: false,
    };
  }

  /**
   * Create a new conversation with a welcome message (for /new command).
   */
  async newConversationWithWelcome(): Promise<ConversationSwitchResult> {
    const conversation = await this.app.conversations.create();

    const confirmationTurn: Turn = {
      role: "assistant",
      content: "Starting fresh! How can I help?",
      timestamp: new Date().toISOString(),
      turnNumber: 0,
    };

    return {
      conversation: toConversationMeta(conversation),
      turns: [confirmationTurn],
      hasMore: false,
    };
  }

  /**
   * Switch to an existing conversation.
   */
  async switchConversation(
    conversationId: string,
  ): Promise<ConversationSwitchResult> {
    const conversation = await this.conversationManager.get(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    await this.app.conversations.makeCurrent(conversationId);

    const turns = await this.conversationManager.getTurns(conversation.id, {
      limit: TURNS_PER_PAGE,
    });

    return {
      conversation: toConversationMeta(conversation),
      turns: turns.map(toTurn),
      hasMore: turns.length === TURNS_PER_PAGE,
    };
  }

  /**
   * Rename a conversation. Returns the (possibly truncated) title.
   */
  async renameConversation(
    conversationId: string,
    title: string,
  ): Promise<string> {
    const trimmedTitle = title.slice(0, MAX_TITLE_LENGTH);
    await this.conversationManager.setTitleManual(conversationId, trimmedTitle);
    return trimmedTitle;
  }

  /**
   * Load more turns (pagination).
   */
  async loadMoreTurns(
    conversationId: string,
    before: string,
  ): Promise<LoadMoreResult> {
    const { turns, hasMore } = await this.conversationManager.getTurnsBefore(
      conversationId,
      before,
      TURNS_PER_PAGE,
    );

    return {
      turns: turns.map(toTurn),
      hasMore,
    };
  }

  /**
   * Delete a conversation with full cleanup.
   */
  async deleteConversation(
    conversationId: string,
    cleanup?: {
      cancelAbbreviation?: (convId: string) => void;
      clearIdleTimer?: (convId: string) => void;
      deleteAttachments?: (convId: string) => void;
      removeSearchEmbeddings?: (convId: string) => void;
    },
  ): Promise<void> {
    const conversation = await this.conversationManager.get(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    cleanup?.cancelAbbreviation?.(conversationId);
    cleanup?.clearIdleTimer?.(conversationId);
    cleanup?.deleteAttachments?.(conversationId);
    cleanup?.removeSearchEmbeddings?.(conversationId);

    this.sessionRegistry.remove(conversationId);

    await this.app.conversations.delete(conversationId);
  }

  /**
   * Set model for a conversation. Throws if model is invalid.
   */
  async setModel(conversationId: string, model: string): Promise<void> {
    const models = loadModels();
    const validModels = Object.values(models);
    if (!validModels.includes(model)) {
      throw new Error("Invalid model");
    }

    await this.conversationManager.setModel(conversationId, model);
    this.app.emit("conversation:updated", conversationId);
  }

  /**
   * Delete a conversation if it has no turns (empty conversation cleanup).
   */
  async deleteIfEmpty(conversationId: string): Promise<void> {
    const conv = await this.conversationManager.get(conversationId);
    if (conv && conv.turnCount === 0) {
      await this.app.conversations.delete(conversationId);
    }
  }

  // ─── Slash Commands ────────────────────────────────────────────────

  /**
   * Handle /model slash command.
   */
  async *handleModelCommand(
    conversationId: string | null,
    modelArg?: string,
  ): AsyncGenerator<ChatEvent> {
    const models = loadModels();

    if (!modelArg) {
      const conversation = conversationId
        ? await this.conversationManager.get(conversationId)
        : null;
      const currentModel = conversation?.model || models.sonnet;
      const modelName = currentModel.includes("opus")
        ? "Opus"
        : currentModel.includes("haiku")
          ? "Haiku"
          : "Sonnet";

      yield { type: "start" };
      yield {
        type: "text_delta",
        text: `Current model: ${modelName}\n\nAvailable: /model opus, /model sonnet, /model haiku`,
      };
      yield { type: "done" };
      return;
    }

    const modelMap: Record<string, string> = {
      opus: models.opus,
      sonnet: models.sonnet,
      haiku: models.haiku,
    };

    const newModelId = modelMap[modelArg];
    if (!newModelId) {
      yield { type: "start" };
      yield {
        type: "text_delta",
        text: `Unknown model "${modelArg}". Available: opus, sonnet, haiku`,
      };
      yield { type: "done" };
      return;
    }

    if (!conversationId) {
      yield { type: "start" };
      yield {
        type: "text_delta",
        text: "No active conversation. Send a message first to start one.",
      };
      yield { type: "done" };
      return;
    }

    await this.conversationManager.setModel(conversationId, newModelId);

    // Invalidate cached session — model change requires fresh SDK session
    this.sessionRegistry.remove(conversationId);
    this.conversationManager
      .getConversationDb()
      .updateSdkSessionId(conversationId, null);

    const modelName = modelArg.charAt(0).toUpperCase() + modelArg.slice(1);
    yield { type: "start" };
    yield { type: "text_delta", text: `Switched to ${modelName}.` };
    yield { type: "done" };
  }

  // ─── Chat Message Processing ───────────────────────────────────────

  /**
   * Send a chat message and stream the response.
   *
   * Returns an async generator of ChatEvents. The first event is always
   * "start" with a `_effects` property containing side-effect metadata
   * (conversationId, userTurn for broadcast, auto-created conversation).
   *
   * The adapter iterates this generator, sending each event to the client
   * and handling side effects from the start event.
   */
  async *sendMessage(
    conversationId: string | null,
    content: string,
    turnNumber: number,
    options?: ChatMessageOptions,
  ): AsyncGenerator<ChatEvent & { _effects?: StartEffects }> {
    const deps = this.deps;
    const log = deps?.log ?? console.log;
    const logError = deps?.logError ?? console.error;

    // ── Validation ──────────────────────────────────────────────
    if (content.length > MAX_MESSAGE_LENGTH) {
      yield {
        type: "error",
        message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`,
      };
      return;
    }

    // ── Skill expansion ─────────────────────────────────────────
    const expandedContent = await expandSkillCommand(
      content,
      this.app.agentDir,
    );
    if (expandedContent !== content) {
      log("Expanded skill command in message");
    }

    // ── Auto-create conversation if needed ───────────────────────
    let convId = conversationId;
    let conversationCreated: ConversationMeta | undefined;

    if (!convId) {
      const conversation = await this.app.conversations.create();
      convId = conversation.id;

      if (options?.model) {
        await this.conversationManager.setModel(conversation.id, options.model);
        conversation.model = options.model;
      }

      conversationCreated = toConversationMeta(conversation);
    }

    // ── Get or create session ───────────────────────────────────
    const storedSid = this.conversationManager
      .getConversationDb()
      .getSdkSessionId(convId);
    const sessionManager = await this.sessionRegistry.getOrCreate(
      convId,
      storedSid,
    );

    if (options?.channel?.channelId) {
      sessionManager.setChannel(options.channel.channelId);
    }

    // ── View context (generic) ────────────────────────────────────
    if (options?.context) {
      const ctx = options.context;
      if (ctx.type === "automation" && ctx.automationId) {
        sessionManager.setViewContext(
          "automation",
          ctx.automationId,
          ctx.automationName || ctx.title || "",
        );
      } else if (ctx.type === "space" && ctx.spaceName) {
        sessionManager.setViewContext(
          "space",
          ctx.spaceName,
          ctx.title || ctx.spaceName,
        );
      } else if (ctx.type === "conversation" && ctx.conversationId) {
        sessionManager.setViewContext(
          "conversation",
          ctx.conversationId,
          ctx.title || "",
        );
      } else if (ctx.type === "notebook" && ctx.file) {
        sessionManager.setViewContext("notebook", ctx.file, ctx.title || "");
      } else if (ctx.type === "calendar") {
        sessionManager.setViewContext(
          "calendar",
          "calendar",
          ctx.title || "Calendar",
        );
      }
    }

    // ── Process attachments ─────────────────────────────────────
    type ContentBlock =
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        };

    let contentBlocks: ContentBlock[] | undefined;
    const savedAttachments: Array<{
      id: string;
      filename: string;
      localPath: string;
      mimeType: string;
      size: number;
    }> = [];

    if (options?.attachments?.length && !deps?.attachmentService) {
      // AttachmentService unavailable — emit CFR so recovery orchestrator can fix it (M9.6-S1)
      this.app.cfr.emitFailure({
        capabilityType: detectCapabilityTypeFromMimes(options.attachments),
        symptom: "deps-missing",
        detail: "AttachmentService unavailable at chat-service entry",
        triggeringInput: buildTriggeringInput(options, convId!, turnNumber),
      });
    }

    if (options?.attachments?.length && deps?.attachmentService) {
      contentBlocks = [];

      if (expandedContent.trim()) {
        contentBlocks.push({ type: "text", text: expandedContent });
      } else {
        contentBlocks.push({ type: "text", text: "What is this?" });
      }

      for (const attachment of options.attachments) {
        try {
          const saved = await deps.attachmentService.save(
            convId,
            attachment.filename,
            attachment.mimeType,
            attachment.base64Data,
          );
          savedAttachments.push(saved.meta);

          if (deps.attachmentService.isImage(attachment.mimeType)) {
            contentBlocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: attachment.mimeType,
                data: attachment.base64Data,
              },
            });
          } else {
            const textContent = Buffer.from(
              attachment.base64Data,
              "base64",
            ).toString("utf-8");
            contentBlocks.push({
              type: "text",
              text: `<file name="${attachment.filename}">\n${textContent}\n</file>`,
            });
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to save attachment";
          yield { type: "error" as const, message };
          logError(err, `Attachment save failed: ${message}`);
        }
      }

      if (contentBlocks.length === 0) {
        contentBlocks = undefined;
      }
    }

    // ── STT: Transcribe audio attachments ────────────────────────
    const isAudioInput = options?.inputMedium === "audio";
    let transcribedContent = expandedContent;
    let detectedLanguage: string | undefined;

    if (isAudioInput && savedAttachments.length > 0) {
      const audioAttachment = savedAttachments.find((a) =>
        a.mimeType.startsWith("audio/"),
      );
      if (audioAttachment) {
        const absoluteAudioPath = deps?.attachmentService
          ? deps.attachmentService.getAbsolutePath(audioAttachment.localPath)
          : audioAttachment.localPath;
        const trigInput = buildTriggeringInput(options, convId!, turnNumber, audioAttachment);
        const sttResult = await this.transcribeAudio(absoluteAudioPath, trigInput);
        if (sttResult === null) {
          // Invoker already emitted CFR — use placeholder text
          transcribedContent = `[Voice message — transcription unavailable]`;
          contentBlocks = [{ type: "text", text: transcribedContent }];
        } else if (sttResult.text) {
          transcribedContent = `[Voice message] ${sttResult.text}`;
          detectedLanguage = sttResult.language;
          // Replace content blocks with transcribed text + voice mode hint
          contentBlocks = [
            {
              type: "text",
              text: VOICE_MODE_HINT + "\n\n" + transcribedContent,
            },
          ];
        } else {
          // Empty transcription with no technical error — check if this looks like a broken capability
          // (durationMs/confidence added in S6; returns null for S1 since script doesn't report them yet)
          const emptySym = classifyEmptyStt(sttResult.text, sttResult.durationMs, sttResult.confidence);
          if (emptySym) {
            const cap = this.app.capabilityRegistry?.get("audio-to-text");
            this.app.cfr.emitFailure({
              capabilityType: "audio-to-text",
              capabilityName: cap?.name,
              symptom: emptySym,
              detail: "Script returned empty transcription",
              triggeringInput: trigInput,
            });
          }
          transcribedContent = `[Voice message — could not transcribe audio]`;
          contentBlocks = [{ type: "text", text: transcribedContent }];
        }
      }
    }

    // ── Save user turn ──────────────────────────────────────────
    // Use transcribed content for voice messages so the transcript shows actual text
    const savedContent =
      isAudioInput && transcribedContent !== expandedContent
        ? transcribedContent
        : content;
    const userTimestamp = new Date().toISOString();
    const userTurn: TranscriptTurn = {
      type: "turn",
      role: "user",
      content: savedContent,
      timestamp: userTimestamp,
      turnNumber,
      attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
      channel: options?.channel?.channelId,
      sender: options?.channel?.sender,
    };

    await this.conversationManager.appendTurn(convId, userTurn);

    // Fire-and-forget search indexing
    if (deps?.conversationSearchService) {
      deps.conversationSearchService
        .indexTurn(convId, turnNumber, "user", savedContent)
        .catch(() => {});
    }

    // Touch idle timer
    deps?.idleTimerManager?.touch(convId);

    // Yield start with side effects for the adapter
    yield {
      type: "start" as const,
      _effects: {
        conversationId: convId,
        userTurn: toTurn(userTurn),
        conversationCreated,
      },
    };

    // Emit App events for user turn + new conversation (broadcast to all WS clients)
    this.app.emit("chat:start", convId);
    this.app.emit("chat:user_turn", convId, userTurn);
    if (conversationCreated) {
      this.app.emit("chat:conversation_created", convId, conversationCreated);
    }

    // ── Stream response ─────────────────────────────────────────
    let assistantContent = "";
    let thinkingText = "";
    let usage: { input: number; output: number } | undefined;
    let cost: number | undefined;
    let finalAudioUrl: string | undefined;
    let hasSplit = false;
    const originalTurnNumber = turnNumber;

    // Track stream metadata for response watchdog
    let toolUseCount = 0;
    let textLengthAfterLastTool = 0;
    let fullAssistantContent = ""; // tracks across splits (assistantContent resets on split)

    const conversation = await this.conversationManager.get(convId);
    const modelOverride = options?.model || conversation?.model || undefined;

    log(
      `[Model Debug] Message model: ${options?.model}, Conversation model: ${conversation?.model}, Override: ${modelOverride}, ConvId: ${convId}`,
    );

    if (options?.model && options.model !== conversation?.model) {
      await this.conversationManager.setModel(convId, options.model);
    }

    try {
      const messageContent = contentBlocks || expandedContent;
      log(
        `Sending message with ${Array.isArray(messageContent) ? messageContent.length + " content blocks" : "text"}`,
      );

      for await (const event of sessionManager.streamMessage(messageContent, {
        model: modelOverride,
        reasoning: options?.reasoning,
      })) {
        switch (event.type) {
          case "text_delta":
            assistantContent += event.text;
            fullAssistantContent += event.text;
            textLengthAfterLastTool += event.text.length;
            yield { type: "text_delta" as const, text: event.text };
            this.app.emit("chat:text_delta", convId, event.text);
            break;
          case "thinking_delta":
            thinkingText += event.text;
            yield { type: "thinking_delta" as const, text: event.text };
            this.app.emit("chat:thinking_delta", convId, event.text);
            break;
          case "thinking_end":
            yield { type: "thinking_end" as const };
            this.app.emit("chat:thinking_end", convId);
            break;
          case "tool_use_start": {
            toolUseCount++;
            textLengthAfterLastTool = 0;
            // Split on first tool use if there's meaningful text before it.
            // This delivers the ack ("On it") as a complete message immediately,
            // instead of making the user wait for the full tool execution.
            if (!hasSplit && assistantContent.trim().length > 0) {
              hasSplit = true;

              // Close message 1 (no cost/usage — those come with the final done)
              yield { type: "done" as const };

              // Save message 1
              const splitTurn: TranscriptTurn = {
                type: "turn",
                role: "assistant",
                content: assistantContent,
                timestamp: new Date().toISOString(),
                turnNumber,
                thinkingText: thinkingText || undefined,
                channel: options?.channel?.channelId,
              };
              await this.conversationManager.appendTurn(convId, splitTurn);

              if (deps?.conversationSearchService && assistantContent) {
                deps.conversationSearchService
                  .indexTurn(convId, turnNumber, "assistant", assistantContent)
                  .catch(() => {});
              }

              // TTS for split turn if input was voice
              let splitAudioUrl: string | undefined;
              if (isAudioInput && assistantContent.trim()) {
                splitAudioUrl =
                  (await this.synthesizeAudio(
                    assistantContent,
                    convId,
                    detectedLanguage,
                  )) ?? undefined;
              }

              // Advance to message 2
              turnNumber++;
              assistantContent = "";
              thinkingText = "";

              yield {
                type: "done" as const,
                cost: undefined,
                usage: undefined,
                audioUrl: splitAudioUrl,
              };
              yield { type: "turn_advanced" as const, turnNumber };
              yield { type: "start" as const };
              // Signal start of message 2 (post-tool-use continuation)
              this.app.emit("chat:start", convId);
            }
            break;
          }
          case "done": {
            usage = event.usage;
            cost = event.cost;

            // TTS: synthesize audio response if input was voice + TTS available
            let audioUrl: string | undefined;
            if (isAudioInput && assistantContent.trim()) {
              audioUrl =
                (await this.synthesizeAudio(
                  assistantContent,
                  convId,
                  detectedLanguage,
                )) ?? undefined;
            }

            finalAudioUrl = audioUrl;
            yield {
              type: "done" as const,
              cost: event.cost,
              usage: event.usage,
              audioUrl,
              detectedLanguage,
            };
            break;
          }
          case "error":
            yield { type: "error" as const, message: event.message };
            break;
        }
      }

      // ── Post-stream processing ──────────────────────────────────
      // Save message 2 (or the only message if no split occurred).
      // Skip if split produced an empty message 2.
      if (assistantContent.trim() || !hasSplit) {
        const assistantTurn: TranscriptTurn = {
          type: "turn",
          role: "assistant",
          content: assistantContent,
          timestamp: new Date().toISOString(),
          turnNumber,
          thinkingText: thinkingText || undefined,
          usage,
          cost,
          channel: options?.channel?.channelId,
          audioUrl: finalAudioUrl || undefined,
        };

        await this.conversationManager.appendTurn(convId, assistantTurn);

        // Search indexing
        if (deps?.conversationSearchService && assistantContent) {
          deps.conversationSearchService
            .indexTurn(convId, turnNumber, "assistant", assistantContent)
            .catch(() => {});
        }
      }

      // Persist SDK session ID
      const sdkSid = sessionManager.getSessionId();
      if (sdkSid) {
        this.conversationManager
          .getConversationDb()
          .updateSdkSessionId(convId, sdkSid);
      }

      // Touch idle timer
      deps?.idleTimerManager?.touch(convId);

      log(`Turn ${turnNumber} completed for ${convId}`);

      // Trigger naming at turn 5 (use original turn number, not split-advanced)
      if (originalTurnNumber === 5) {
        const conv = await this.conversationManager.get(convId);
        if (!conv?.title || !options?.channel) {
          this.triggerNaming(convId).catch(() => {});
        }
      }

      // Post-response hooks (if split, include both halves for full context)
      if (deps?.postResponseHooks) {
        deps.postResponseHooks
          .run(
            convId,
            content.trim().toLowerCase(),
            fullAssistantContent || assistantContent,
            {
              streamMetadata: {
                toolUseCount,
                cost,
                textLengthAfterLastTool,
              },
              source: options?.source ?? "dashboard",
            },
          )
          .catch(() => {});
      }

      // Emit App event for structural live updates
      this.app.emit("chat:done", convId, cost, usage, finalAudioUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logError(err, "Error in streamMessage");
      yield { type: "error" as const, message };
      this.app.emit("chat:error", convId, message);
    }
  }

  /**
   * Inject a system prompt into an existing conversation's brain session.
   * Streams the response and saves the assistant turn.
   * Does NOT save a user turn — the system prompt is ephemeral.
   */
  async *sendSystemMessage(
    conversationId: string,
    prompt: string,
    turnNumber: number,
    options?: SystemMessageOptions,
  ): AsyncGenerator<ChatEvent> {
    yield* sendSystemMessage(
      this.app,
      conversationId,
      prompt,
      turnNumber,
      options,
    );
  }

  /**
   * Write a turn directly to the transcript without invoking the brain.
   * Emits conversation:updated event (triggers StatePublisher).
   *
   * Used for: admin inject-message, scheduler event logging.
   */
  async injectTurn(
    conversationId: string,
    turn: {
      role: "user" | "assistant";
      content: string;
      turnNumber: number;
      channel?: string;
    },
  ): Promise<void> {
    const transcriptTurn: TranscriptTurn = {
      type: "turn",
      role: turn.role,
      content: turn.content,
      timestamp: new Date().toISOString(),
      turnNumber: turn.turnNumber,
      channel: turn.channel,
    };

    await this.conversationManager.appendTurn(conversationId, transcriptTurn);
    this.app.emit("conversation:updated", conversationId);
  }

  // ─── Private helpers ───────────────────────────────────────────────

  /**
   * Transcribe audio via the STT capability script through CapabilityInvoker.
   *
   * Returns parsed transcription on success, or null when the invoker already
   * emitted a CFR failure (caller should use a placeholder, not re-emit).
   *
   * Routing through the invoker (M9.6-S10) means no per-call-site CFR detection:
   * not-installed / not-enabled / execution-error / timeout / validation-failed
   * are all handled by the invoker.
   */
  private async transcribeAudio(
    audioPath: string,
    triggeringInput: TriggeringInput,
  ): Promise<{ text: string; language?: string; confidence?: number; durationMs?: number } | null> {
    if (!this.app.capabilityInvoker) {
      // Invoker not wired (e.g. pre-hatch) — fall back to legacy direct call
      const cap = this.app.capabilityRegistry?.get("audio-to-text");
      if (!cap) return null;
      const scriptPath = join(cap.path, "scripts", "transcribe.sh");
      try {
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync(scriptPath, [audioPath], { timeout: 30000 });
        const result = JSON.parse(stdout.trim()) as Record<string, unknown>;
        return { text: typeof result.text === "string" ? result.text : stdout.trim() };
      } catch {
        return null;
      }
    }

    const result = await this.app.capabilityInvoker.run({
      capabilityType: "audio-to-text",
      scriptName: "transcribe.sh",
      args: [audioPath],
      triggeringInput,
      expectJson: true,
    });

    if (result.kind === "failure") return null; // CFR already emitted

    const parsed = result.parsed as Record<string, unknown>;
    const rawText = parsed?.text;
    const text = typeof rawText === "string" ? rawText : result.stdout.trim();
    const language = typeof parsed?.language === "string" ? parsed.language : undefined;
    const rawConfidence = parsed?.confidence;
    const rawDuration = parsed?.duration_ms;
    const confidence =
      typeof rawConfidence === "number" && Number.isFinite(rawConfidence) ? rawConfidence : undefined;
    const durationMs =
      typeof rawDuration === "number" && Number.isFinite(rawDuration) ? rawDuration : undefined;
    return { text, language, confidence, durationMs };
  }

  /**
   * Synthesize audio via the TTS capability script.
   * Returns the audio file path or null.
   *
   * TODO(S15/S18): route through CapabilityInvoker so TTS failures emit CFR.
   * Deferred per plan-phase2-coverage.md §2.2 — S15 may pre-wire if exit gate
   * needs it; S18 (Phase 3, "Duplicate TTS path collapse") formalizes.
   */
  private async synthesizeAudio(
    text: string,
    conversationId: string,
    language?: string,
  ): Promise<string | null> {
    const cap = this.app.capabilityRegistry?.get("text-to-audio");
    if (!cap || cap.status !== "available") return null;

    const scriptPath = join(cap.path, "scripts", "synthesize.sh");
    const audioDir = join(this.app.agentDir, "audio");
    mkdirSync(audioDir, { recursive: true });
    const outputFile = join(audioDir, `tts-${randomUUID()}.ogg`);

    const spokenText = prepareForSpeech(text);
    if (!spokenText.trim()) return null;

    try {
      const execFileAsync = promisify(execFile);
      const args = [spokenText, outputFile];
      if (language) args.push(language);
      await execFileAsync(scriptPath, args, {
        timeout: 30000,
      });
      return `/api/assets/audio/${outputFile.split("/").pop()}`;
    } catch {
      return null;
    }
  }

  private async triggerNaming(conversationId: string): Promise<void> {
    const conv = await this.conversationManager.get(conversationId);
    if (conv?.title) return;

    if (!this.namingService) {
      this.namingService = new NamingService();
    }

    const turns = await this.conversationManager.getRecentTurns(
      conversationId,
      10,
    );
    const result = await this.namingService.generateName(turns);
    await this.conversationManager.setTitle(conversationId, result.title);
    await this.conversationManager.setTopics(conversationId, result.topics);

    this.app.emit("conversation:updated", conversationId);
  }
}
