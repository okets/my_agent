import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenManager } from "../src/routing/token-manager.js";

describe("TokenManager", () => {
  let tmpDir: string;
  let manager: TokenManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "token-manager-"));
    manager = new TokenManager(tmpDir);
  });

  afterEach(() => {
    manager.dispose();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateToken creates a .pending-auth.json file with hash (not plaintext)", () => {
    const token = manager.generateToken("whatsapp_main");

    expect(token).toMatch(/^[A-Z2-9]{6}$/);

    const authFile = join(tmpDir, "auth", "whatsapp_main", ".pending-auth.json");
    expect(existsSync(authFile)).toBe(true);

    const content = JSON.parse(readFileSync(authFile, "utf-8"));
    expect(content.tokenHash).toMatch(/^sha256:/);
    // Plaintext should NOT appear in the file
    expect(JSON.stringify(content)).not.toContain(token);
    expect(content.expiresAt).toBeDefined();
    expect(content.failedAttempts).toBe(0);
  });

  it("validateToken returns true for correct token", () => {
    const token = manager.generateToken("whatsapp_main");
    const result = manager.validateToken("whatsapp_main", token);
    expect(result).toBe(true);
  });

  it("validateToken returns false for wrong token", () => {
    manager.generateToken("whatsapp_main");
    const result = manager.validateToken("whatsapp_main", "WRONG1");
    expect(result).toBe(false);
  });

  it("validateToken is case-insensitive", () => {
    const token = manager.generateToken("whatsapp_main");
    const result = manager.validateToken("whatsapp_main", token.toLowerCase());
    expect(result).toBe(true);
  });

  it("validateToken rejects after 5 failed attempts", () => {
    const token = manager.generateToken("whatsapp_main");

    // 5 wrong attempts
    for (let i = 0; i < 5; i++) {
      manager.validateToken("whatsapp_main", "WRONG1");
    }

    // Correct token should now be rejected (invalidated)
    const result = manager.validateToken("whatsapp_main", token);
    expect(result).toBe(false);

    // Token should be cleared
    expect(manager.getPendingToken("whatsapp_main")).toBeNull();
  });

  it("clearToken deletes auth file and clears cache", () => {
    manager.generateToken("whatsapp_main");
    manager.clearToken("whatsapp_main");

    expect(manager.getPendingToken("whatsapp_main")).toBeNull();

    const authFile = join(tmpDir, "auth", "whatsapp_main", ".pending-auth.json");
    expect(existsSync(authFile)).toBe(false);
  });

  it("loadPendingTokens loads from disk on startup, skips expired", () => {
    // Generate a token, then create a new manager that loads from disk
    const token = manager.generateToken("whatsapp_main");
    manager.dispose();

    const manager2 = new TokenManager(tmpDir);
    const pending = manager2.getPendingToken("whatsapp_main");
    expect(pending).not.toBeNull();

    // Should still validate
    const result = manager2.validateToken("whatsapp_main", token);
    expect(result).toBe(true);
    manager2.dispose();
  });

  it("getPendingToken returns null when no token exists", () => {
    expect(manager.getPendingToken("nonexistent")).toBeNull();
  });

  it("implements TokenStore interface", () => {
    const token = manager.generateToken("whatsapp_main");
    const pending = manager.getPendingToken("whatsapp_main");
    expect(pending).not.toBeNull();
    expect(pending!.expiresAt).toBeInstanceOf(Date);
    // TokenStore.token field contains the hash, not plaintext
    expect(pending!.token).toMatch(/^sha256:/);
  });
});
