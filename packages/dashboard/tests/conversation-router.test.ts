import { describe, it, expect, beforeEach } from "vitest";
import { ConversationRouter } from "../src/agent/conversation-router.js";

describe("ConversationRouter", () => {
  let router: ConversationRouter;

  beforeEach(() => {
    router = new ConversationRouter(["owner@example.com", "+1555000000"]);
  });

  describe("owner vs external routing", () => {
    it("routes owner message to conversation-nina", () => {
      const result = router.route({
        channel: "web",
        sender: "owner@example.com",
      });
      expect(result.target).toBe("conversation-nina");
    });

    it("routes owner message from any registered identity", () => {
      const result = router.route({
        channel: "whatsapp",
        sender: "+1555000000",
      });
      expect(result.target).toBe("conversation-nina");
    });

    it("routes external message to working-agent", () => {
      const result = router.route({
        channel: "whatsapp",
        sender: "+9876543210",
      });
      expect(result.target).toBe("working-agent");
    });

    it("routes unknown sender to working-agent", () => {
      const result = router.route({
        channel: "web",
        sender: "stranger@test.com",
      });
      expect(result.target).toBe("working-agent");
    });
  });

  describe("channel switch detection", () => {
    it("detects Web to WhatsApp as new conversation", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      const result = router.route({
        channel: "whatsapp",
        sender: "+1555000000",
      });
      expect(result.newConversation).toBe(true);
    });

    it("does NOT detect WhatsApp to Web as new conversation", () => {
      router.route({ channel: "whatsapp", sender: "+1555000000" });
      const result = router.route({
        channel: "web",
        sender: "owner@example.com",
      });
      expect(result.newConversation).toBe(false);
    });

    it("first message is never a new conversation trigger", () => {
      const result = router.route({
        channel: "whatsapp",
        sender: "+1555000000",
      });
      expect(result.newConversation).toBe(false);
    });

    it("same channel is not a new conversation trigger", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      const result = router.route({
        channel: "web",
        sender: "owner@example.com",
      });
      expect(result.newConversation).toBe(false);
    });

    it("external messages do not trigger new conversation", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      const result = router.route({
        channel: "whatsapp",
        sender: "+9876543210",
      });
      expect(result.newConversation).toBe(false);
    });
  });

  describe("getCurrentChannel", () => {
    it("returns null before any messages", () => {
      expect(router.getCurrentChannel()).toBeNull();
    });

    it("tracks the current channel after owner messages", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      expect(router.getCurrentChannel()).toBe("web");

      router.route({ channel: "whatsapp", sender: "+1555000000" });
      expect(router.getCurrentChannel()).toBe("whatsapp");
    });

    it("does not update channel on external messages", () => {
      router.route({ channel: "web", sender: "owner@example.com" });
      router.route({ channel: "whatsapp", sender: "+9876543210" });
      expect(router.getCurrentChannel()).toBe("web");
    });
  });
});
