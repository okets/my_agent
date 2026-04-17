/**
 * ack-delivery.ts — Channel-aware delivery of framework-originated ack messages.
 *
 * The recovery orchestrator calls AckDelivery.deliver() to tell the user that
 * a capability failed and a fix is in progress. The ack must go back on the
 * same channel the user's original turn arrived on: WhatsApp voice note → WhatsApp
 * text reply; dashboard user turn → dashboard WS broadcast.
 *
 * This module lives in `packages/core` and therefore cannot import from
 * `packages/dashboard` (circular). The deps it needs are expressed as
 * structural `*Like` interfaces the dashboard layer satisfies — same pattern
 * used by orphan-watchdog.ts in S5.
 *
 * Created in M9.6-S6.
 */

import type { CapabilityFailure } from "./cfr-types.js";

// ─── Structural types (no cross-package imports) ─────────────────────────────

/**
 * Minimal TransportManager shape — matches
 * `packages/dashboard/src/channels/manager.ts:70`.
 */
export interface TransportManagerLike {
  /**
   * Send a message to the recipient identified by `to` via the named transport.
   * Throws if the transport is unknown or disconnected.
   */
  send(
    transportId: string,
    to: string,
    message: { content: string; replyTo?: string },
  ): Promise<void>;
}

/**
 * Minimal ConnectionRegistry shape — matches
 * `packages/dashboard/src/ws/connection-registry.ts:19`.
 *
 * We use `broadcastToConversation` with a loose `ServerMessage`-compatible
 * payload so the dashboard surfaces the ack as a normal assistant turn.
 */
export interface ConnectionRegistryLike {
  broadcastToConversation(
    conversationId: string,
    message: unknown,
  ): void;
}

// ─── AckDelivery ─────────────────────────────────────────────────────────────

/** Transport ID used by the dashboard (WS) channel. */
const DASHBOARD_TRANSPORT_ID = "dashboard";

/**
 * Deliver a framework-originated ack to the same channel the user's triggering
 * turn arrived on. Exceptions are caught and logged — a failed ack must not
 * crash the orchestrator.
 */
export class AckDelivery {
  constructor(
    private transportManager: TransportManagerLike,
    private connectionRegistry: ConnectionRegistryLike,
  ) {}

  async deliver(failure: CapabilityFailure, text: string): Promise<void> {
    const { origin } = failure.triggeringInput;

    // S12 wires automation and system origins with their own routing branches.
    if (origin.kind !== "conversation") {
      // unreachable in S9 — wired in S12
      throw new Error(`unreachable in S9 — wired in S12: origin.kind === "${origin.kind}"`);
    }

    const { channel, conversationId } = origin;

    // Dashboard channel: broadcast as an assistant-style system message over WS.
    if (channel.transportId === DASHBOARD_TRANSPORT_ID) {
      try {
        this.connectionRegistry.broadcastToConversation(conversationId, {
          type: "capability_ack",
          conversationId,
          content: text,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error(
          "[AckDelivery] Failed to broadcast dashboard ack:",
          err,
        );
      }
      return;
    }

    // External transport (WhatsApp, etc.): route through TransportManager.
    try {
      await this.transportManager.send(channel.transportId, channel.sender, {
        content: text,
        replyTo: channel.replyTo,
      });
    } catch (err) {
      console.error(
        `[AckDelivery] Failed to send ack via ${channel.transportId} to ${channel.sender}:`,
        err,
      );
    }
  }
}
