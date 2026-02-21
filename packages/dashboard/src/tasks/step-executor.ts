/**
 * Step Executor — Executes task steps with proper status reporting
 *
 * Handles delivery and action steps that need deterministic execution.
 * The brain handles research/reasoning; this handles execution.
 */

import type { Task } from "@my-agent/core";
import type { ChannelManager } from "../channels/index.js";

export interface StepResult {
  stepNumber: number;
  description: string;
  success: boolean;
  error?: string;
}

export interface ExecuteStepsResult {
  allSucceeded: boolean;
  results: StepResult[];
}

/**
 * Parse task steps from markdown checkbox format
 */
export function parseSteps(
  steps: string,
): Array<{ number: number; description: string; completed: boolean }> {
  const lines = steps.split("\n");
  const parsed: Array<{
    number: number;
    description: string;
    completed: boolean;
  }> = [];
  let stepNumber = 0;

  for (const line of lines) {
    const uncheckedMatch = line.match(/^- \[ \] (.+)$/);
    const checkedMatch = line.match(/^- \[x\] (.+)$/i);

    if (uncheckedMatch) {
      stepNumber++;
      parsed.push({
        number: stepNumber,
        description: uncheckedMatch[1],
        completed: false,
      });
    } else if (checkedMatch) {
      stepNumber++;
      parsed.push({
        number: stepNumber,
        description: checkedMatch[1],
        completed: true,
      });
    }
  }

  return parsed;
}

/**
 * Detect if a step is a delivery action
 */
export function isDeliveryStep(description: string): {
  isDelivery: boolean;
  channel?: string;
  recipient?: string;
} {
  const lower = description.toLowerCase();

  // WhatsApp delivery
  if (
    lower.includes("whatsapp") ||
    (lower.includes("send") && lower.includes("message"))
  ) {
    // Try to extract recipient
    const recipientMatch = description.match(/to\s+(\w+)/i);
    return {
      isDelivery: true,
      channel: "whatsapp",
      recipient: recipientMatch?.[1],
    };
  }

  // Email delivery
  if (lower.includes("email") || lower.includes("mail")) {
    return {
      isDelivery: true,
      channel: "email",
    };
  }

  return { isDelivery: false };
}

/**
 * Step Executor class
 */
export class StepExecutor {
  private channelManager: ChannelManager | null;

  constructor(channelManager: ChannelManager | null) {
    this.channelManager = channelManager;
  }

  /**
   * Execute delivery steps from a completed task
   *
   * @param task - The task with steps
   * @param content - The content to deliver (e.g., research results)
   */
  async executeDeliverySteps(
    task: Task,
    content: string,
  ): Promise<ExecuteStepsResult> {
    if (!task.steps) {
      return { allSucceeded: true, results: [] };
    }

    const steps = parseSteps(task.steps);
    const results: StepResult[] = [];
    let allSucceeded = true;

    for (const step of steps) {
      // Skip already completed steps
      if (step.completed) {
        continue;
      }

      const delivery = isDeliveryStep(step.description);
      if (!delivery.isDelivery) {
        // Not a delivery step, skip (brain should have handled it)
        continue;
      }

      // Execute delivery
      const result = await this.executeDelivery(
        delivery.channel!,
        delivery.recipient,
        content,
        task,
      );

      results.push({
        stepNumber: step.number,
        description: step.description,
        success: result.success,
        error: result.error,
      });

      if (!result.success) {
        allSucceeded = false;
      }
    }

    return { allSucceeded, results };
  }

  /**
   * Execute a delivery action
   */
  private async executeDelivery(
    channel: string,
    recipient: string | undefined,
    content: string,
    task: Task,
  ): Promise<{ success: boolean; error?: string }> {
    if (channel === "whatsapp") {
      return this.sendWhatsApp(recipient, content, task);
    }

    if (channel === "email") {
      return this.sendEmail(recipient, content, task);
    }

    return {
      success: false,
      error: `Unknown delivery channel: ${channel}`,
    };
  }

  /**
   * Send WhatsApp message
   */
  private async sendWhatsApp(
    recipient: string | undefined,
    content: string,
    task: Task,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.channelManager) {
      return {
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
        success: false,
        error: "No WhatsApp channel configured",
      };
    }

    // Get owner JID from channel config
    const config = this.channelManager.getChannelConfig(whatsappChannelId);
    const ownerJid = config?.ownerIdentities?.[0];

    if (!ownerJid) {
      return {
        success: false,
        error: "No owner configured for WhatsApp channel",
      };
    }

    try {
      // Format message with task context
      const message = `📋 *Task Complete: ${task.title}*\n\n${content}`;

      await this.channelManager.send(whatsappChannelId, ownerJid, {
        content: message,
      });

      console.log(
        `[StepExecutor] WhatsApp message sent to ${ownerJid} for task ${task.id}`,
      );

      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[StepExecutor] WhatsApp send failed: ${error}`);
      return { success: false, error };
    }
  }

  /**
   * Send email (stub - implement when email channel is ready)
   */
  private async sendEmail(
    recipient: string | undefined,
    content: string,
    task: Task,
  ): Promise<{ success: boolean; error?: string }> {
    // Email channel not yet implemented
    console.log(`[StepExecutor] Email delivery requested but not implemented`);
    return {
      success: false,
      error: "Email delivery not yet implemented",
    };
  }
}
