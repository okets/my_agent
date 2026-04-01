/**
 * Token Manager — Persistent Hashed Token Storage
 *
 * Generates authorization tokens using crypto.randomInt() (CSPRNG),
 * stores SHA-256 hashes in ephemeral .pending-auth.json files,
 * and validates incoming messages against cached hashes.
 *
 * Implements the TokenStore interface from AuthorizationGate.
 */

import { randomInt, createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { TokenStore } from "./authorization-gate.js";

const AUTH_DIR = "auth";
const PENDING_AUTH_FILE = ".pending-auth.json";
const TOKEN_EXPIRY_MS = 20 * 60 * 1000; // 20 minutes
const MAX_ATTEMPTS = 5;
const TOKEN_LENGTH = 6;
const TOKEN_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1

interface PendingAuthFile {
  tokenHash: string;
  expiresAt: string;
  failedAttempts: number;
}

interface CachedToken {
  hash: string;
  expiresAt: Date;
  failedAttempts: number;
  transportId: string;
}

function hashToken(token: string): string {
  return (
    "sha256:" + createHash("sha256").update(token.toUpperCase()).digest("hex")
  );
}

export class TokenManager implements TokenStore {
  private agentDir: string;
  private cache = new Map<string, CachedToken>();
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private onExpired?: (transportId: string) => void;

  constructor(
    agentDir: string,
    options?: { onExpired?: (transportId: string) => void },
  ) {
    this.agentDir = agentDir;
    this.onExpired = options?.onExpired;
    this.loadPendingTokens();
  }

  /**
   * Generate a 6-character alphanumeric token using CSPRNG.
   * Writes hashed token to .pending-auth.json with 0600 permissions.
   * Returns plaintext token for dashboard display.
   */
  generateToken(transportId: string): string {
    // Generate token using crypto.randomInt (CSPRNG)
    let token = "";
    for (let i = 0; i < TOKEN_LENGTH; i++) {
      token += TOKEN_CHARS[randomInt(TOKEN_CHARS.length)];
    }

    const hash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);

    // Write to disk
    const authDir = join(this.agentDir, AUTH_DIR, transportId);
    mkdirSync(authDir, { recursive: true });

    const authFile = join(authDir, PENDING_AUTH_FILE);
    const data: PendingAuthFile = {
      tokenHash: hash,
      expiresAt: expiresAt.toISOString(),
      failedAttempts: 0,
    };
    writeFileSync(authFile, JSON.stringify(data, null, 2), {
      mode: 0o600,
    });

    // Cache in memory
    this.cache.set(transportId, {
      hash,
      expiresAt,
      failedAttempts: 0,
      transportId,
    });

    // Schedule cleanup
    this.scheduleCleanup(transportId, expiresAt);

    return token;
  }

  /**
   * Validate a token attempt against the cached hash.
   * Returns true if valid, false if invalid or expired.
   * Increments failure counter on mismatch.
   * Invalidates after MAX_ATTEMPTS failures.
   */
  validateToken(transportId: string, input: string): boolean {
    const cached = this.cache.get(transportId);
    console.log(
      `[E2E][TokenMgr] validateToken("${transportId}") — cached=${cached ? "yes" : "no"}, input="${input.substring(0, 10)}"`,
    );
    if (!cached) return false;

    // Check expiry
    if (new Date() >= cached.expiresAt) {
      this.clearToken(transportId);
      return false;
    }

    // Hash input and compare
    const inputHash = hashToken(input);

    if (inputHash === cached.hash) {
      // Success — token is valid
      return true;
    }

    // Mismatch — increment failure counter
    cached.failedAttempts++;

    // Persist updated counter
    this.persistAuthFile(transportId, cached);

    // Check brute force limit
    if (cached.failedAttempts >= MAX_ATTEMPTS) {
      console.warn(
        `[TokenManager] Token for "${transportId}" invalidated after ${MAX_ATTEMPTS} failed attempts`,
      );
      this.clearToken(transportId);
    }

    return false;
  }

  /**
   * TokenStore interface: get pending token info.
   * Returns hash (not plaintext) and expiry.
   */
  getPendingToken(
    transportId: string,
  ): { token: string; expiresAt: Date } | null {
    const cached = this.cache.get(transportId);
    if (!cached) return null;

    if (new Date() >= cached.expiresAt) {
      this.clearToken(transportId);
      return null;
    }

    return { token: cached.hash, expiresAt: cached.expiresAt };
  }

  /**
   * Clear token — delete auth file and cache entry.
   */
  clearToken(transportId: string): void {
    this.cache.delete(transportId);

    // Cancel cleanup timer
    const timer = this.cleanupTimers.get(transportId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(transportId);
    }

    // Delete auth file
    const authFile = join(
      this.agentDir,
      AUTH_DIR,
      transportId,
      PENDING_AUTH_FILE,
    );
    try {
      if (existsSync(authFile)) unlinkSync(authFile);
    } catch {
      // Ignore deletion errors
    }
  }

  /**
   * Load pending tokens from disk on startup.
   * Skips expired tokens, schedules cleanup for valid ones.
   */
  private loadPendingTokens(): void {
    const authBase = join(this.agentDir, AUTH_DIR);
    if (!existsSync(authBase)) return;

    try {
      const dirs = readdirSync(authBase);
      for (const dir of dirs) {
        const authFile = join(authBase, dir, PENDING_AUTH_FILE);
        if (!existsSync(authFile)) continue;

        try {
          const data: PendingAuthFile = JSON.parse(
            readFileSync(authFile, "utf-8"),
          );
          const expiresAt = new Date(data.expiresAt);

          if (new Date() >= expiresAt) {
            // Expired — clean up
            try {
              unlinkSync(authFile);
            } catch {
              /* ignore */
            }
            continue;
          }

          // Valid — cache and schedule cleanup
          this.cache.set(dir, {
            hash: data.tokenHash,
            expiresAt,
            failedAttempts: data.failedAttempts,
            transportId: dir,
          });

          this.scheduleCleanup(dir, expiresAt);
        } catch {
          // Skip malformed files
        }
      }
    } catch {
      // Auth directory might not exist yet
    }
  }

  /**
   * Schedule cleanup for a token at its expiry time.
   */
  private scheduleCleanup(transportId: string, expiresAt: Date): void {
    const existing = this.cleanupTimers.get(transportId);
    if (existing) clearTimeout(existing);

    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.clearToken(transportId);
      this.onExpired?.(transportId);
    }, delay);

    // Unref so it doesn't prevent process exit
    timer.unref();
    this.cleanupTimers.set(transportId, timer);
  }

  /**
   * Persist current cache state to auth file.
   */
  private persistAuthFile(transportId: string, cached: CachedToken): void {
    const authDir = join(this.agentDir, AUTH_DIR, transportId);
    mkdirSync(authDir, { recursive: true });

    const authFile = join(authDir, PENDING_AUTH_FILE);
    const data: PendingAuthFile = {
      tokenHash: cached.hash,
      expiresAt: cached.expiresAt.toISOString(),
      failedAttempts: cached.failedAttempts,
    };
    writeFileSync(authFile, JSON.stringify(data, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * Clean up all timers (call on shutdown).
   */
  dispose(): void {
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
  }
}
