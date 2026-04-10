/**
 * System Message — inject a system prompt into an existing conversation's
 * brain session, stream the response, save it, and emit App events.
 *
 * Unlike sendMessage(), this does NOT:
 * - Save a user turn (the system prompt is ephemeral)
 * - Handle attachments, STT, skill expansion
 * - Auto-create conversations
 *
 * It DOES:
 * - Get/create an SDK session for the conversation
 * - Inject the prompt via SessionManager.injectSystemTurn()
 * - Yield ChatEvent stream (text_delta, done)
 * - Save the assistant response turn
 * - Persist SDK session ID
 * - Emit chat:done App event
 */

import type { ConversationManager } from "../conversations/manager.js";
import type { SessionRegistry } from "../agent/session-registry.js";
import type { TranscriptTurn } from "../conversations/types.js";
import type { ChatEvent, SystemMessageOptions } from "./types.js";
import type { App } from "../app.js";

export async function* sendSystemMessage(
  app: App,
  conversationId: string,
  prompt: string,
  turnNumber: number,
  options?: SystemMessageOptions,
): AsyncGenerator<ChatEvent> {
  const conversationManager = app.conversationManager;
  const sessionRegistry = app.sessionRegistry;

  // Get or create session
  const storedSid = conversationManager
    .getConversationDb()
    .getSdkSessionId(conversationId);
  const sessionManager = await sessionRegistry.getOrCreate(
    conversationId,
    storedSid,
  );

  // If session is busy, skip (caller handles this — e.g. queue notification)
  if (sessionManager.isStreaming()) {
    console.log(
      `[sendSystemMessage] Session busy for ${conversationId}, skipping`,
    );
    return;
  }

  yield { type: "start" as const };
  app.emit("chat:start", conversationId);

  let assistantContent = "";

  try {
    for await (const event of sessionManager.injectSystemTurn(prompt)) {
      if (event.type === "text_delta" && event.text) {
        assistantContent += event.text;
        yield { type: "text_delta" as const, text: event.text };
        app.emit("chat:text_delta", conversationId, event.text);
      }
    }

    // Save assistant response (not the system prompt)
    if (assistantContent) {
      const assistantTurn: TranscriptTurn = {
        type: "turn",
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
        turnNumber,
        channel: options?.channel,
      };

      await conversationManager.appendTurn(conversationId, assistantTurn);
    }

    // Persist SDK session ID
    const sdkSid = sessionManager.getSessionId();
    if (sdkSid) {
      conversationManager
        .getConversationDb()
        .updateSdkSessionId(conversationId, sdkSid);
    }

    yield { type: "done" as const };

    // Emit App event — triggers StatePublisher broadcast to WS clients
    app.emit("chat:done", conversationId, undefined, undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[sendSystemMessage] Error:", err);
    yield { type: "error" as const, message };
  }
}
