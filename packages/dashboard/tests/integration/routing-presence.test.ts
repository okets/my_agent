/**
 * M10-S0: Routing Presence Rule (integration)
 *
 * Locks in the architectural fix for WhatsApp bleed (Issues #2/#3/#4).
 *
 * Rule: For "Working Nina escalations" (job_completed, job_failed, mount_failure,
 * stop-job confirmations, infra alerts):
 *   - If the user's most recent user turn (any channel) was within the last 15
 *     minutes, deliver to that turn's channel.
 *   - Otherwise, deliver to the preferred outbound channel.
 *   - No exceptions. No source-channel carve-out.
 *
 * These tests run end-to-end through:
 *   notification queue → heartbeat → ConversationInitiator → mock transport
 *
 * The chat layer is stubbed (we assert that sendSystemMessage was called and
 * what content/channel it received), but ConversationManager + initiator +
 * heartbeat are real.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { AppHarness } from "./app-harness.js";
import {
  ConversationInitiator,
  type ChatServiceLike,
  type TransportManagerLike,
} from "../../src/agent/conversation-initiator.js";
import { HeartbeatService } from "../../src/automations/heartbeat-service.js";
import {
  PersistentNotificationQueue,
  type PersistentNotification,
} from "../../src/notifications/persistent-queue.js";
import type { ChatEvent } from "../../src/chat/types.js";
import type { TranscriptTurn } from "../../src/conversations/types.js";

const WA_OWNER_JID = "1234567890@s.whatsapp.net";

interface RecordedSystemCall {
  conversationId: string;
  prompt: string;
  turnNumber: number;
  channel?: string;
  triggerJobId?: string;
}

function makeChatService(response = "system response"): ChatServiceLike & {
  calls: RecordedSystemCall[];
} {
  const calls: RecordedSystemCall[] = [];
  return {
    calls,
    async *sendSystemMessage(
      conversationId,
      prompt,
      turnNumber,
      options,
    ): AsyncGenerator<ChatEvent> {
      calls.push({
        conversationId,
        prompt,
        turnNumber,
        channel: options?.channel,
        triggerJobId: options?.triggerJobId,
      });
      yield { type: "start" };
      yield { type: "text_delta", text: response };
      yield { type: "done" };
    },
  };
}

interface RecordedSend {
  transportId: string;
  to: string;
  content: string;
}

function makeChannelManager(opts?: {
  connected?: boolean;
}): TransportManagerLike & { sent: RecordedSend[] } {
  const connected = opts?.connected ?? true;
  const sent: RecordedSend[] = [];
  return {
    sent,
    async send(transportId, to, message) {
      sent.push({ transportId, to, content: message.content });
    },
    getTransportConfig(_id) {
      return connected ? { ownerJid: WA_OWNER_JID } : undefined;
    },
    getTransportInfos() {
      return [
        {
          id: "whatsapp",
          plugin: "baileys",
          statusDetail: { connected },
        },
      ];
    },
  };
}

function appendTurn(
  harness: AppHarness,
  conversationId: string,
  options: {
    role: "user" | "assistant";
    turnNumber: number;
    channel?: string;
    ageMinutes?: number;
  },
): Promise<void> {
  const ts = new Date(
    Date.now() - (options.ageMinutes ?? 0) * 60 * 1000,
  ).toISOString();
  const turn: TranscriptTurn = {
    type: "turn",
    role: options.role,
    content: `${options.role} message`,
    timestamp: ts,
    turnNumber: options.turnNumber,
    channel: options.channel,
  };
  return harness.conversationManager.appendTurn(conversationId, turn);
}

function makeNotification(
  overrides: Partial<PersistentNotification> = {},
): Omit<PersistentNotification, "_filename"> {
  return {
    job_id: overrides.job_id ?? "job-test-001",
    automation_id: overrides.automation_id ?? "test-automation",
    type: overrides.type ?? "job_completed",
    summary: overrides.summary ?? "Background work finished.",
    created: overrides.created ?? new Date().toISOString(),
    delivery_attempts: overrides.delivery_attempts ?? 0,
    ...overrides,
  };
}

describe("M10-S0: routing presence rule (integration)", () => {
  let harness: AppHarness;
  let notifQueue: PersistentNotificationQueue;
  let chatService: ReturnType<typeof makeChatService>;
  let channelManager: ReturnType<typeof makeChannelManager>;
  let initiator: ConversationInitiator;
  let heartbeat: HeartbeatService;

  async function setup(opts?: { preferredChannel?: string }) {
    harness = await AppHarness.create({ withAutomations: true });
    notifQueue = new PersistentNotificationQueue(
      path.join(harness.agentDir, "notifications"),
    );
    chatService = makeChatService("forwarded body");
    channelManager = makeChannelManager({ connected: true });
    initiator = new ConversationInitiator({
      conversationManager: harness.conversationManager,
      chatService,
      channelManager,
      getOutboundChannel: () => opts?.preferredChannel ?? "whatsapp",
    });
    heartbeat = new HeartbeatService({
      jobService: harness.automationJobService!,
      notificationQueue: notifQueue,
      conversationInitiator: initiator,
      staleThresholdMs: 60_000,
      tickIntervalMs: 999_999, // never auto-tick during tests
      capabilityHealthIntervalMs: 999_999,
    });
  }

  afterEach(async () => {
    heartbeat?.stop();
    if (harness) await harness.shutdown();
  });

  it("WA inbound → automation completion → delivered to WA", async () => {
    await setup({ preferredChannel: "whatsapp" });

    const conv = await harness.conversationManager.create({
      externalParty: WA_OWNER_JID,
    });
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 1,
      channel: "whatsapp",
      ageMinutes: 1,
    });

    // Mirror current Brain behavior: sourceChannel="dashboard" stamped by
    // automation-server when fire_automation runs from MCP context. Under
    // the OLD model this hardcode forced web delivery — Issue #4.
    notifQueue.enqueue(
      makeNotification({
        job_id: "job-wa-001",
        type: "job_completed",
        summary: "Chiang Mai houses found.",
        source_channel: "dashboard",
      }),
    );

    await heartbeat.drainNow();

    expect(channelManager.sent).toHaveLength(1);
    expect(channelManager.sent[0].transportId).toBe("whatsapp");
    expect(channelManager.sent[0].to).toBe(WA_OWNER_JID);
    expect(channelManager.sent[0].content).toContain("forwarded body");

    // sendSystemMessage is invoked once on the SAME conversation (no channel
    // switch — externalParty matches WA ownerJid) with channel=whatsapp.
    expect(chatService.calls).toHaveLength(1);
    expect(chatService.calls[0].conversationId).toBe(conv.id);
    expect(chatService.calls[0].channel).toBe("whatsapp");
    expect(chatService.calls[0].triggerJobId).toBe("job-wa-001");

    expect(notifQueue.listPending()).toHaveLength(0);
  });

  it("dashboard-only inbound → automation completion → delivered to web", async () => {
    await setup({ preferredChannel: "whatsapp" });

    const conv = await harness.conversationManager.create();
    // No channel = web turn
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 1,
      ageMinutes: 1,
    });

    notifQueue.enqueue(
      makeNotification({
        job_id: "job-web-001",
        source_channel: "dashboard",
      }),
    );

    await heartbeat.drainNow();

    // Web delivery: sendSystemMessage called WITHOUT channel option, no forward.
    expect(chatService.calls).toHaveLength(1);
    expect(chatService.calls[0].conversationId).toBe(conv.id);
    expect(chatService.calls[0].channel).toBeUndefined();
    expect(channelManager.sent).toHaveLength(0);
  });

  it("channel switch within 15 min: WA inbound then web turn → completion lands on web", async () => {
    await setup({ preferredChannel: "whatsapp" });

    const conv = await harness.conversationManager.create({
      externalParty: WA_OWNER_JID,
    });
    // Earlier WA turn
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 1,
      channel: "whatsapp",
      ageMinutes: 5,
    });
    // Newer web turn — user moved to dashboard
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 2,
      ageMinutes: 1,
    });

    notifQueue.enqueue(
      makeNotification({
        job_id: "job-switch-001",
        source_channel: "dashboard",
      }),
    );

    await heartbeat.drainNow();

    // Last user turn was web → web delivery, no WA forward.
    expect(channelManager.sent).toHaveLength(0);
    expect(chatService.calls).toHaveLength(1);
    expect(chatService.calls[0].channel).toBeUndefined();
  });

  it("stale conversation, scheduled job completes → preferred channel (WA) when externalParty matches", async () => {
    await setup({ preferredChannel: "whatsapp" });

    const conv = await harness.conversationManager.create({
      externalParty: WA_OWNER_JID,
    });
    // Stale: last user turn 30 min ago, on WA
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 1,
      channel: "whatsapp",
      ageMinutes: 30,
    });

    notifQueue.enqueue(
      makeNotification({
        job_id: "job-cron-001",
        // Scheduled jobs do NOT stamp source_channel (per
        // automation-scheduler.ts); old code path bypassed the queue entirely.
        // After M10-S0 the rule should still send via WA because that's the
        // preferred channel and the conversation is bound to WA.
      }),
    );

    await heartbeat.drainNow();

    expect(channelManager.sent).toHaveLength(1);
    expect(channelManager.sent[0].transportId).toBe("whatsapp");
    expect(chatService.calls).toHaveLength(1);
    expect(chatService.calls[0].channel).toBe("whatsapp");
  });

  it("mount_failure with no recent user activity → preferred channel (WA), not forced web", async () => {
    await setup({ preferredChannel: "whatsapp" });

    const conv = await harness.conversationManager.create({
      externalParty: WA_OWNER_JID,
    });
    // Stale: last user turn 25 min ago, on WA
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 1,
      channel: "whatsapp",
      ageMinutes: 25,
    });

    // mount_failure currently calls alert() directly with sourceChannel="dashboard"
    // (app.ts:1623). Simulate the call shape post-fix: no sourceChannel option.
    // Under the OLD model + the dashboard-source carve-out the alert was forced
    // to web; under the new rule, stale → preferred → WA.
    const result = await initiator.alert(
      "A filesystem watch has failed. Let the user know.",
    );

    expect(result).toBe(true);
    expect(channelManager.sent).toHaveLength(1);
    expect(channelManager.sent[0].transportId).toBe("whatsapp");
  });

  it("legacy on-disk notification with source_channel field deserializes cleanly", async () => {
    await setup({ preferredChannel: "whatsapp" });

    const conv = await harness.conversationManager.create({
      externalParty: WA_OWNER_JID,
    });
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 1,
      channel: "whatsapp",
      ageMinutes: 1,
    });

    // Hand-craft a notification record with the legacy field still present.
    // Post-fix, the type may not declare source_channel anymore but listPending()
    // must still parse it without throwing — graceful tolerance of stale records.
    notifQueue.enqueue({
      job_id: "job-legacy-001",
      automation_id: "test",
      type: "job_completed",
      summary: "legacy notification",
      created: new Date().toISOString(),
      delivery_attempts: 0,
      // @ts-expect-error — legacy field, may be removed from the type
      source_channel: "dashboard",
    });

    expect(() => notifQueue.listPending()).not.toThrow();
    await expect(heartbeat.drainNow()).resolves.toBeUndefined();

    // Last user turn on WA → routes to WA regardless of legacy field.
    expect(channelManager.sent).toHaveLength(1);
    expect(channelManager.sent[0].transportId).toBe("whatsapp");
  });
});
