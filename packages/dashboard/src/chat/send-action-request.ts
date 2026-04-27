/**
 * Action Request — inject a user-role action request into an existing
 * conversation's brain session, stream the response, save it, and emit App
 * events.
 *
 * Companion to sendSystemMessage(). Both functions share the same App-side
 * plumbing (session lookup, busy-skip, ChatEvent emission, transcript save,
 * SDK session ID persistence) — the only behavioral difference is the call
 * to SessionManager.injectActionRequest() instead of injectSystemTurn().
 *
 * **Why two paths:**
 *
 * `sendSystemMessage` wraps the prompt in `[SYSTEM: …]` so the model reads
 * it as instructional context to acknowledge. Used for genuine system events
 * (mount failures, infra alerts) that are not actions Nina was asked to
 * perform.
 *
 * `sendActionRequest` (this function) leaves the prompt unwrapped. The model
 * receives a bare user-role turn. Used for proactive deliveries (briefs,
 * scheduled sessions, `notify: immediate` job completions) where past-Nina
 * scheduled the work and is asking present-Nina to deliver it now.
 *
 * Design principle (M9.4-S4.2): proactive deliveries are user-role action
 * requests, not system-role status notes. The model's response loop is
 * trained to fulfill requests, not factor status into context.
 */

import type { TranscriptTurn } from "../conversations/types.js";
import type { ChatEvent, SystemMessageOptions } from "./types.js";
import type { App } from "../app.js";

export async function* sendActionRequest(
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
      `[sendActionRequest] Session busy for ${conversationId}, skipping`,
    );
    return;
  }

  yield options?.triggerJobId
    ? { type: "start" as const, triggerJobId: options.triggerJobId }
    : { type: "start" as const };
  app.emit("chat:start", conversationId);

  let assistantContent = "";

  try {
    for await (const event of sessionManager.injectActionRequest(prompt)) {
      if (event.type === "text_delta" && event.text) {
        assistantContent += event.text;
        yield { type: "text_delta" as const, text: event.text };
        app.emit("chat:text_delta", conversationId, event.text);
      }
    }

    // Save assistant response (not the action-request prompt — only Nina's
    // rendering of it persists in the transcript).
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
    console.error("[sendActionRequest] Error:", err);
    yield { type: "error" as const, message };
  }
}
