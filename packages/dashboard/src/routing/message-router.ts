/**
 * Message Router
 *
 * Looks up channel bindings to determine message routing.
 * Owner messages → brain conversation flow.
 * Unbound messages → external store.
 */

import type { ChannelBinding } from "@my-agent/core";

/**
 * Strip platform-specific suffixes and normalise to digits + optional leading +.
 * Handles WhatsApp JIDs: @s.whatsapp.net, @lid, @g.us
 */
export function normalizeIdentity(identity: string): string {
  let normalized = identity.replace(/@(s\.whatsapp\.net|lid|g\.us)$/, "");
  normalized = normalized.replace(/[^\d+]/g, "");
  return normalized;
}

export type RouteDecision =
  | { type: "owner"; binding: ChannelBinding }
  | { type: "suspended"; binding: ChannelBinding }
  | { type: "external" };

/**
 * MessageRouter — determines routing based on channel bindings.
 */
export class MessageRouter {
  private bindings: ChannelBinding[];
  private warnedMissingBinding = new Set<string>();

  constructor(initialBindings: ChannelBinding[]) {
    this.bindings = initialBindings;
  }

  /**
   * Update the binding list (e.g., after a new binding is created).
   */
  setBindings(bindings: ChannelBinding[]): void {
    this.bindings = bindings;
  }

  /**
   * Add a single binding (e.g., after authorization).
   */
  addBinding(binding: ChannelBinding): void {
    // Remove existing binding for same transport (one owner per transport)
    this.bindings = this.bindings.filter(
      (b) => b.transport !== binding.transport,
    );
    this.bindings.push(binding);
    this.warnedMissingBinding.delete(binding.transport);
  }

  /**
   * Get the binding for a transport, if one exists.
   */
  getBindingForTransport(transportId: string): ChannelBinding | undefined {
    return this.bindings.find((b) => b.transport === transportId);
  }

  /**
   * Determine routing for a message based on channel bindings.
   */
  route(transportId: string, senderIdentity: string): RouteDecision {
    const binding = this.getBindingForTransport(transportId);
    console.log(
      `[E2E][Router] route("${transportId}", "${senderIdentity}") — binding=${binding ? JSON.stringify({ id: binding.id, ownerIdentity: binding.ownerIdentity, previousOwner: binding.previousOwner }) : "none"}`,
    );

    if (!binding) {
      // No binding = no owner = all messages are external
      if (!this.warnedMissingBinding.has(transportId)) {
        this.warnedMissingBinding.add(transportId);
        console.warn(
          `[MessageRouter] Transport "${transportId}" has no channel binding — all messages treated as external`,
        );
      }
      return { type: "external" };
    }

    // Check for suspended state (re-authorization in progress)
    if (binding.previousOwner) {
      const normalizedSender = normalizeIdentity(senderIdentity);
      const normalizedPrevOwner = normalizeIdentity(binding.previousOwner);

      if (normalizedSender === normalizedPrevOwner) {
        // Previous owner during re-auth — suspended, messages dropped
        return { type: "suspended", binding };
      }
      // Other senders during re-auth — treat as external
      return { type: "external" };
    }

    // Check if sender matches the binding's owner identity
    const normalizedSender = normalizeIdentity(senderIdentity);
    const normalizedOwner = normalizeIdentity(binding.ownerIdentity);

    if (normalizedSender === normalizedOwner) {
      return { type: "owner", binding };
    }

    return { type: "external" };
  }
}
