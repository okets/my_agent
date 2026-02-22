/**
 * Delivery Executor — Sends validated deliverables to channels
 *
 * Iterates typed DeliveryAction[] and sends content.
 * Replaces the old StepExecutor (regex-based step matching).
 */

import type { Task, DeliveryAction } from "@my-agent/core";
import type { ChannelManager } from "../channels/index.js";
import type { ConversationManager } from "../conversations/index.js";

export interface DeliveryActionResult {
  channel: string;
  success: boolean;
  error?: string;
}

export interface DeliveryResult {
  allSucceeded: boolean;
  results: DeliveryActionResult[];
}

/**
 * DeliveryExecutor — sends deliverable content to channels
 */
export class DeliveryExecutor {
  private channelManager: ChannelManager | null;
  private conversationManager: ConversationManager | null;

  constructor(
    channelManager: ChannelManager | null,
    conversationManager?: ConversationManager | null,
  ) {
    this.channelManager = channelManager;
    this.conversationManager = conversationManager ?? null;
  }

  /**
   * Execute all pending delivery actions for a task
   *
   * @param task - The task with delivery actions
   * @param deliverable - The validated deliverable content from the brain
   */
  async executeDeliveryActions(
    task: Task,
    deliverable: string,
  ): Promise<DeliveryResult> {
    const actions = task.delivery ?? [];
    const results: DeliveryActionResult[] = [];
    let allSucceeded = true;

    for (const action of actions) {
      if (action.status !== "pending") continue;

      // Use pre-composed content if available, otherwise use brain's deliverable
      const content = action.content ?? deliverable;

      const result = await this.deliver(action.channel, content, task);
      results.push(result);

      if (!result.success) {
        allSucceeded = false;
      }
    }

    return { allSucceeded, results };
  }

  /**
   * Deliver content to a channel
   */
  private async deliver(
    channel: string,
    content: string,
    task: Task,
  ): Promise<DeliveryActionResult> {
    switch (channel) {
      case "whatsapp":
        return this.sendWhatsApp(content, task);
      case "email":
        return this.sendEmail(content, task);
      default:
        return {
          channel,
          success: false,
          error: `Unknown delivery channel: ${channel}`,
        };
    }
  }

  /**
   * Send WhatsApp message
   */
  private async sendWhatsApp(
    content: string,
    task: Task,
  ): Promise<DeliveryActionResult> {
    if (!this.channelManager) {
      return {
        channel: "whatsapp",
        success: false,
        error: "Channel manager not available",
      };
    }

    // Find a WhatsApp channel (first one with baileys plugin)
    const channelInfos = this.channelManager.getChannelInfos();
    let whatsappChannelId: string | null = null;

    for (const info of channelInfos) {
      if (info.plugin === "baileys") {
        whatsappChannelId = info.id;
        break;
      }
    }

    if (!whatsappChannelId) {
      return {
        channel: "whatsapp",
        success: false,
        error: "No WhatsApp channel configured",
      };
    }

    // Get owner JID from channel config
    const config = this.channelManager.getChannelConfig(whatsappChannelId);
    const ownerJid = config?.ownerJid;

    if (!ownerJid) {
      return {
        channel: "whatsapp",
        success: false,
        error:
          "No owner JID configured for WhatsApp channel. Re-authorize with a token to fix.",
      };
    }

    try {
      await this.channelManager.send(whatsappChannelId, ownerJid, {
        content,
      });

      console.log(
        `[DeliveryExecutor] WhatsApp message sent to ${ownerJid} for task ${task.id}`,
      );

      // Record the sent message in the WhatsApp conversation
      await this.recordInChannelConversation(whatsappChannelId, content);

      return { channel: "whatsapp", success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[DeliveryExecutor] WhatsApp send failed: ${error}`);
      return { channel: "whatsapp", success: false, error };
    }
  }

  /**
   * Record an outbound message in the channel's active conversation
   *
   * Ensures the brain has context when the user replies on that channel.
   */
  private async recordInChannelConversation(
    channelId: string,
    content: string,
  ): Promise<void> {
    if (!this.conversationManager) return;

    try {
      const conversation =
        await this.conversationManager.getMostRecent(channelId);
      if (!conversation) return;

      const turnNumber = conversation.turnCount + 1;
      await this.conversationManager.appendTurn(conversation.id, {
        type: "turn",
        role: "assistant",
        content,
        timestamp: new Date().toISOString(),
        turnNumber,
      });

      console.log(
        `[DeliveryExecutor] Recorded outbound message in conversation ${conversation.id}`,
      );
    } catch (err) {
      // Non-fatal — message was already sent, just context is missing
      console.warn(
        `[DeliveryExecutor] Failed to record in conversation:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Send email (stub — implement when email channel is ready)
   */
  private async sendEmail(
    content: string,
    task: Task,
  ): Promise<DeliveryActionResult> {
    console.log(
      `[DeliveryExecutor] Email delivery requested but not implemented`,
    );
    return {
      channel: "email",
      success: false,
      error: "Email delivery not yet implemented",
    };
  }
}
