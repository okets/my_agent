import { describe, it, expect } from "vitest";
import { MessageRouter } from "../src/routing/message-router.js";
import type { ChannelBinding } from "@my-agent/core";

describe("Re-authorization flow (MessageRouter)", () => {
  it("routes messages from previous owner as external during suspension", () => {
    const binding: ChannelBinding = {
      id: "whatsapp_binding",
      transport: "whatsapp_main",
      ownerIdentity: "41433650172129",
      ownerJid: "41433650172129@lid",
      previousOwner: "41433650172129", // suspended — same person re-authorizing
    };

    const router = new MessageRouter([binding]);

    // During suspension, owner messages should be treated as external
    const decision = router.route("whatsapp_main", "41433650172129@lid");
    expect(decision.type).toBe("suspended");
  });

  it("successful re-auth clears previousOwner", () => {
    const binding: ChannelBinding = {
      id: "whatsapp_binding",
      transport: "whatsapp_main",
      ownerIdentity: "new_owner",
      ownerJid: "new_owner@lid",
      previousOwner: "old_owner",
    };

    const router = new MessageRouter([binding]);

    // Clear previousOwner (simulating successful re-auth)
    router.addBinding({
      ...binding,
      previousOwner: undefined,
    });

    // New owner should now route correctly
    const decision = router.route("whatsapp_main", "new_owner@lid");
    expect(decision.type).toBe("owner");
  });

  it("expiry revert restores previousOwner as current owner", () => {
    const binding: ChannelBinding = {
      id: "whatsapp_binding",
      transport: "whatsapp_main",
      ownerIdentity: "old_owner",
      ownerJid: "old_owner@lid",
      previousOwner: "old_owner", // suspended
    };

    const router = new MessageRouter([binding]);

    // Revert: remove previousOwner, restore original routing
    router.addBinding({
      ...binding,
      previousOwner: undefined,
    });

    // Old owner should route as owner again
    const decision = router.route("whatsapp_main", "old_owner@lid");
    expect(decision.type).toBe("owner");
  });
});
