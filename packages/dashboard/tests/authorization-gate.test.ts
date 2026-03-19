import { describe, it, expect, vi } from "vitest";
import {
  AuthorizationGate,
  InMemoryTokenStore,
} from "../src/routing/authorization-gate.js";
import type { IncomingMessage } from "@my-agent/core";

function makeMsg(content: string, from = "+1555000001"): IncomingMessage {
  return {
    id: `msg-${Date.now()}`,
    from,
    content,
    timestamp: new Date(),
    channelId: "whatsapp_main",
  };
}

describe("AuthorizationGate", () => {
  it("returns false when no pending token", async () => {
    const store = new InMemoryTokenStore();
    const onAuthorized = vi.fn();
    const gate = new AuthorizationGate(store, { onAuthorized });

    const result = await gate.checkMessage("whatsapp_main", makeMsg("hello"));
    expect(result).toBe(false);
    expect(onAuthorized).not.toHaveBeenCalled();
  });

  it("validates correct token and fires onAuthorized", async () => {
    const store = new InMemoryTokenStore();
    const onAuthorized = vi.fn();
    const gate = new AuthorizationGate(store, { onAuthorized });

    const token = gate.generateToken("whatsapp_main");
    const result = await gate.checkMessage(
      "whatsapp_main",
      makeMsg(token),
    );

    expect(result).toBe(true);
    expect(onAuthorized).toHaveBeenCalledOnce();
    expect(onAuthorized).toHaveBeenCalledWith(
      "whatsapp_main",
      expect.objectContaining({ content: token }),
    );
  });

  it("clears token after successful validation", async () => {
    const store = new InMemoryTokenStore();
    const onAuthorized = vi.fn();
    const gate = new AuthorizationGate(store, { onAuthorized });

    const token = gate.generateToken("whatsapp_main");
    await gate.checkMessage("whatsapp_main", makeMsg(token));

    // Second attempt should return false (token cleared)
    const result = await gate.checkMessage("whatsapp_main", makeMsg(token));
    expect(result).toBe(false);
    expect(onAuthorized).toHaveBeenCalledOnce();
  });

  it("rejects expired token", async () => {
    const store = new InMemoryTokenStore();
    const onAuthorized = vi.fn();
    const gate = new AuthorizationGate(store, { onAuthorized });

    const token = gate.generateToken("whatsapp_main");

    // Manually expire the token
    store.set("whatsapp_main", token, new Date(Date.now() - 1000));

    const result = await gate.checkMessage("whatsapp_main", makeMsg(token));
    expect(result).toBe(false);
    expect(onAuthorized).not.toHaveBeenCalled();
  });

  it("returns false for non-matching content (not a token attempt)", async () => {
    const store = new InMemoryTokenStore();
    const onAuthorized = vi.fn();
    const gate = new AuthorizationGate(store, { onAuthorized });

    gate.generateToken("whatsapp_main");

    const result = await gate.checkMessage(
      "whatsapp_main",
      makeMsg("hello world"),
    );
    expect(result).toBe(false);
    expect(onAuthorized).not.toHaveBeenCalled();
  });

  it("is case-insensitive for token matching", async () => {
    const store = new InMemoryTokenStore();
    const onAuthorized = vi.fn();
    const gate = new AuthorizationGate(store, { onAuthorized });

    const token = gate.generateToken("whatsapp_main");
    const result = await gate.checkMessage(
      "whatsapp_main",
      makeMsg(token.toLowerCase()),
    );

    expect(result).toBe(true);
  });
});
