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

    expect(result).toMatchObject({ status: "delivered" });
    expect(channelManager.sent).toHaveLength(1);
    expect(channelManager.sent[0].transportId).toBe("whatsapp");
  });

  it("transport failure does not silently mark notification delivered (architect fix 2)", async () => {
    // WA-bound conversation + recent WA user turn → presence rule says WA.
    // WA transport is disconnected → alert() must NOT return delivered, and
    // heartbeat must NOT markDelivered. Notification stays pending with
    // attempts incremented. On reconnect, drainNow redelivers.
    await setup({ preferredChannel: "whatsapp" });

    // Override channel manager with disconnected variant for phase 1.
    channelManager = makeChannelManager({ connected: false });
    initiator = new ConversationInitiator({
      conversationManager: harness.conversationManager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });
    heartbeat.stop();
    heartbeat = new HeartbeatService({
      jobService: harness.automationJobService!,
      notificationQueue: notifQueue,
      conversationInitiator: initiator,
      staleThresholdMs: 60_000,
      tickIntervalMs: 999_999,
      capabilityHealthIntervalMs: 999_999,
    });

    const conv = await harness.conversationManager.create({
      externalParty: WA_OWNER_JID,
    });
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 1,
      channel: "whatsapp",
      ageMinutes: 1,
    });

    notifQueue.enqueue(
      makeNotification({ job_id: "job-retry-001" }),
    );

    await heartbeat.drainNow();

    expect(channelManager.sent).toHaveLength(0);
    const pendingAfterFailure = notifQueue.listPending();
    expect(pendingAfterFailure).toHaveLength(1);
    expect(pendingAfterFailure[0].delivery_attempts).toBe(1);

    // Reconnect the transport and drain again — must succeed.
    channelManager = makeChannelManager({ connected: true });
    initiator = new ConversationInitiator({
      conversationManager: harness.conversationManager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });
    heartbeat.stop();
    heartbeat = new HeartbeatService({
      jobService: harness.automationJobService!,
      notificationQueue: notifQueue,
      conversationInitiator: initiator,
      staleThresholdMs: 60_000,
      tickIntervalMs: 999_999,
      capabilityHealthIntervalMs: 999_999,
    });

    await heartbeat.drainNow();

    expect(channelManager.sent).toHaveLength(1);
    expect(channelManager.sent[0].transportId).toBe("whatsapp");
    expect(notifQueue.listPending()).toHaveLength(0);
  });

  it("transient transport disconnect does not demote the current conversation (architect fix 3)", async () => {
    // WA-bound conversation is current. WA transport disconnected. Recent WA
    // user turn → presence rule says WA. Pre-fix: alert() falls into initiate()
    // because isSameChannel=false when resolved ownerJid is null, and initiate
    // creates a new conversation which demotes the current one.
    await setup({ preferredChannel: "whatsapp" });
    channelManager = makeChannelManager({ connected: false });
    initiator = new ConversationInitiator({
      conversationManager: harness.conversationManager,
      chatService,
      channelManager,
      getOutboundChannel: () => "whatsapp",
    });

    const conv = await harness.conversationManager.create({
      externalParty: WA_OWNER_JID,
    });
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 1,
      channel: "whatsapp",
      ageMinutes: 1,
    });

    const convsBefore = await harness.conversationManager.list({});
    const beforeIds = new Set(convsBefore.map((c) => c.id));

    const result = await initiator.alert("test");
    expect(result).toMatchObject({ status: "transport_failed" });

    const convsAfter = await harness.conversationManager.list({});
    expect(convsAfter.length).toBe(convsBefore.length);
    for (const c of convsAfter) {
      expect(beforeIds.has(c.id)).toBe(true);
    }
    const stillCurrent = await harness.conversationManager.get(conv.id);
    expect(stillCurrent!.status).toBe("current");
    expect(channelManager.sent).toHaveLength(0);
  });

  it("Issue 4 (April 16 production bug): dual-channel conversation triggers new conversation on WA", async () => {
    // Reproduces the exact production scenario:
    // 1. Conversation received WA messages (externalParty set).
    // 2. User switched to dashboard — last user turns are on web (no channel).
    // 3. Job completion fires when conversation is stale → preferred channel = WA.
    // Old code: externalParty matches ownerJid → isSameChannel=true → wrong continuation.
    // New code: last turn channel (web/undefined) ≠ targetChannel (WA) → new conversation.
    await setup({ preferredChannel: "whatsapp" });

    const conv = await harness.conversationManager.create({
      externalParty: WA_OWNER_JID,
    });
    // Earlier WA turns (simulating the Apr 13-15 WA history)
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 1,
      channel: "whatsapp",
      ageMinutes: 600, // 10 hours ago
    });
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 2,
      channel: "whatsapp",
      ageMinutes: 300, // 5 hours ago
    });
    // User switched to dashboard — last user turn is a web turn (stale, no channel).
    await appendTurn(harness, conv.id, {
      role: "user",
      turnNumber: 3,
      // no channel = web
      ageMinutes: 60, // 1 hour ago (stale — past 15 min threshold)
    });

    // Enqueue the job_completed notification (the morning brief scenario).
    notifQueue.enqueue(
      makeNotification({
        job_id: "job-apr16-001",
        type: "job_completed",
        summary: "Morning brief compiled.",
      }),
    );

    await heartbeat.drainNow();

    // A NEW conversation must have been created — original should NOT be continued.
    const allConversations = await harness.conversationManager.list({});
    expect(allConversations.length).toBe(2);
    const newConv = allConversations.find((c) => c.id !== conv.id);
    expect(newConv).toBeDefined();

    // sendSystemMessage called on the NEW conversation (initiate path).
    const lastCall = chatService.calls[chatService.calls.length - 1];
    expect(lastCall.conversationId).not.toBe(conv.id);

    // WA transport received the outbound on the new conversation.
    expect(channelManager.sent).toHaveLength(1);
    expect(channelManager.sent[0].transportId).toBe("whatsapp");

    // Notification consumed.
    expect(notifQueue.listPending()).toHaveLength(0);
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
