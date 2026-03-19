import { describe, it, expect } from "vitest";
import { MessageRouter, normalizeIdentity } from "../src/routing/message-router.js";
import type { ChannelBinding } from "@my-agent/core";

describe("MessageRouter", () => {
  const binding: ChannelBinding = {
    id: "whatsapp_binding",
    transport: "whatsapp_main",
    ownerIdentity: "41433650172129",
    ownerJid: "41433650172129@lid",
  };

  it("routes owner messages when binding exists and sender matches", () => {
    const router = new MessageRouter([binding]);

    const decision = router.route("whatsapp_main", "41433650172129@lid");
    expect(decision.type).toBe("owner");
    if (decision.type === "owner") {
      expect(decision.binding.id).toBe("whatsapp_binding");
    }
  });

  it("routes external messages when sender doesn't match", () => {
    const router = new MessageRouter([binding]);

    const decision = router.route("whatsapp_main", "99999999999@s.whatsapp.net");
    expect(decision.type).toBe("external");
  });

  it("routes external when no binding exists for transport", () => {
    const router = new MessageRouter([]);

    const decision = router.route("whatsapp_main", "41433650172129@lid");
    expect(decision.type).toBe("external");
  });

  it("addBinding replaces existing binding for same transport", () => {
    const router = new MessageRouter([binding]);

    const newBinding: ChannelBinding = {
      id: "new_binding",
      transport: "whatsapp_main",
      ownerIdentity: "99999999999",
      ownerJid: "99999999999@s.whatsapp.net",
    };
    router.addBinding(newBinding);

    // Old owner should now be external
    const oldDecision = router.route("whatsapp_main", "41433650172129@lid");
    expect(oldDecision.type).toBe("external");

    // New owner should route as owner
    const newDecision = router.route("whatsapp_main", "99999999999@s.whatsapp.net");
    expect(newDecision.type).toBe("owner");
  });

  it("getBindingForTransport returns binding when exists", () => {
    const router = new MessageRouter([binding]);

    const result = router.getBindingForTransport("whatsapp_main");
    expect(result).toBeDefined();
    expect(result!.ownerIdentity).toBe("41433650172129");
  });

  it("getBindingForTransport returns undefined when no binding", () => {
    const router = new MessageRouter([]);

    const result = router.getBindingForTransport("whatsapp_main");
    expect(result).toBeUndefined();
  });
});

describe("normalizeIdentity", () => {
  it("strips WhatsApp JID suffixes", () => {
    expect(normalizeIdentity("1234567890@s.whatsapp.net")).toBe("1234567890");
    expect(normalizeIdentity("1234567890@lid")).toBe("1234567890");
    expect(normalizeIdentity("1234567890@g.us")).toBe("1234567890");
  });

  it("handles plain numbers", () => {
    expect(normalizeIdentity("41433650172129")).toBe("41433650172129");
  });

  it("preserves leading +", () => {
    expect(normalizeIdentity("+41433650172129")).toBe("+41433650172129");
  });
});
