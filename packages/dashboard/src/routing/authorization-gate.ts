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

/** Interface for token storage — swappable between in-memory and persistent */
export interface TokenStore {
  getPendingToken(
    transportId: string,
  ): { token: string; expiresAt: Date } | null;
  clearToken(transportId: string): void;
  /** Validate a token attempt. Returns true if the token is correct. */
  validateToken?(transportId: string, input: string): boolean;
}

/** In-memory token store (for tests) */
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

  validateToken(transportId: string, input: string): boolean {
    const pending = this.tokens.get(transportId);
    if (!pending) return false;
    if (new Date() >= pending.expiresAt) return false;
    return input.trim().toUpperCase() === pending.token;
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
   * Check if an incoming message is an authorization token.
   * Returns true if the message was handled (token matched).
   * Returns false if no pending token or no match — message continues to routing.
   */
  async checkMessage(
    transportId: string,
    msg: IncomingMessage,
  ): Promise<boolean> {
    const pending = this.tokenStore.getPendingToken(transportId);
    if (!pending) return false;

    const content = msg.content.trim();

    // Use validateToken if available (TokenManager with hashing)
    // Fall back to plaintext comparison (InMemoryTokenStore for tests)
    let isValid: boolean;
    if (this.tokenStore.validateToken) {
      isValid = this.tokenStore.validateToken(transportId, content);
    } else {
      isValid =
        content.toUpperCase() === pending.token &&
        new Date() < pending.expiresAt;
    }

    if (isValid) {
      this.tokenStore.clearToken(transportId);
      await this.deps.onAuthorized(transportId, msg);
      return true;
    }

    // No match — not a token attempt, continue to routing
    return false;
  }
}
