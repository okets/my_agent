/**
 * Authorization Gate
 *
 * Sits between transport and channel routing.
 * Validates authorization tokens and creates channel bindings.
 *
 * Phase 2: in-memory TokenStore (same as current behavior).
 * Phase 3: TokenManager implements TokenStore with persistent hashed tokens.
 */

import type { IncomingMessage } from "@my-agent/core";

/** Interface for token storage — swappable in Phase 3 */
export interface TokenStore {
  getPendingToken(
    transportId: string,
  ): { token: string; expiresAt: Date } | null;
  clearToken(transportId: string): void;
}

/** In-memory token store (Phase 2) */
export class InMemoryTokenStore implements TokenStore {
  private tokens = new Map<string, { token: string; expiresAt: Date }>();

  set(transportId: string, token: string, expiresAt: Date): void {
    this.tokens.set(transportId, { token, expiresAt });
  }

  getPendingToken(
    transportId: string,
  ): { token: string; expiresAt: Date } | null {
    return this.tokens.get(transportId) ?? null;
  }

  clearToken(transportId: string): void {
    this.tokens.delete(transportId);
  }
}

export interface AuthorizationGateDeps {
  /** Callback when authorization succeeds — handler creates the channel binding */
  onAuthorized: (
    transportId: string,
    msg: IncomingMessage,
  ) => Promise<void>;
}

/**
 * AuthorizationGate — validates tokens on incoming messages.
 *
 * If a pending token exists for the transport and the message content matches,
 * fires onAuthorized callback and returns true.
 * Otherwise returns false (message should continue to routing).
 */
export class AuthorizationGate {
  private tokenStore: TokenStore;
  private deps: AuthorizationGateDeps;

  constructor(tokenStore: TokenStore, deps: AuthorizationGateDeps) {
    this.tokenStore = tokenStore;
    this.deps = deps;
  }

  /**
   * Generate a 6-character authorization token for a transport.
   * Returns the plaintext token to display in the dashboard.
   */
  generateToken(transportId: string): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
    let token = "";
    for (let i = 0; i < 6; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }

    if (this.tokenStore instanceof InMemoryTokenStore) {
      (this.tokenStore as InMemoryTokenStore).set(
        transportId,
        token,
        new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      );
    }

    return token;
  }

  /**
   * Check if an incoming message is an authorization token.
   * Returns true if the message was handled (token matched or rejected).
   * Returns false if no pending token — message should continue to routing.
   */
  async checkMessage(
    transportId: string,
    msg: IncomingMessage,
  ): Promise<boolean> {
    const pending = this.tokenStore.getPendingToken(transportId);
    if (!pending) return false;

    const content = msg.content.trim().toUpperCase();

    if (content === pending.token && new Date() < pending.expiresAt) {
      this.tokenStore.clearToken(transportId);
      await this.deps.onAuthorized(transportId, msg);
      return true;
    }

    // Message exists but doesn't match — not a token attempt, continue routing
    return false;
  }
}
