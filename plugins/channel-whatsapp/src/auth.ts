import { promises as fs } from "fs";
import { join } from "path";

/**
 * Credential save queue — serializes all creds.update calls to prevent
 * file corruption from concurrent writes.
 */
export class CredentialSaveQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private currentPromise: Promise<void> | null = null;

  enqueue(saveFn: () => Promise<void>): void {
    this.queue.push(saveFn);
    if (!this.processing) {
      this.currentPromise = this.processNext();
    }
  }

  /**
   * Wait for all pending credential saves to complete.
   * Call this before reconnecting to ensure credentials are persisted.
   */
  async flush(): Promise<void> {
    if (this.currentPromise) {
      await this.currentPromise;
    }
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      this.currentPromise = null;
      return;
    }

    this.processing = true;
    const fn = this.queue.shift()!;

    try {
      await fn();
    } catch (err) {
      // Log but do not halt the queue — a single failed save should not
      // block subsequent credential updates.
      console.error("[channel-whatsapp] credential save error:", err);
    }

    await this.processNext();
  }
}

/**
 * Credential backup manager — protects against truncated/corrupted creds.json
 * by maintaining a backup and restoring on startup if needed.
 */
export class CredentialBackupManager {
  private authDir: string;
  private credsPath: string;
  private backupPath: string;

  constructor(authDir: string) {
    this.authDir = authDir;
    this.credsPath = join(authDir, "creds.json");
    this.backupPath = join(authDir, "creds.json.bak");
  }

  /**
   * Check if creds.json is valid. If corrupted/empty, restore from backup.
   * Call this BEFORE useMultiFileAuthState().
   */
  async ensureValidCredentials(): Promise<void> {
    const credsValid = await this.isValidJson(this.credsPath);

    if (credsValid) {
      // Creds are valid — update backup
      await this.createBackup();
      return;
    }

    // Creds missing or corrupted — try to restore from backup
    const backupValid = await this.isValidJson(this.backupPath);

    if (backupValid) {
      console.log("[channel-whatsapp] creds.json corrupted, restoring from backup...");
      try {
        await fs.copyFile(this.backupPath, this.credsPath);
        console.log("[channel-whatsapp] Credentials restored from backup");
      } catch (err) {
        console.error("[channel-whatsapp] Failed to restore credentials:", err);
      }
    } else {
      // No valid backup either — fresh pairing required
      console.log("[channel-whatsapp] No valid credentials or backup — fresh pairing required");
    }
  }

  /**
   * Create a backup of current creds.json.
   * Called after successful save operations.
   */
  async createBackup(): Promise<void> {
    try {
      const exists = await this.fileExists(this.credsPath);
      if (exists) {
        await fs.copyFile(this.credsPath, this.backupPath);
      }
    } catch (err) {
      // Non-critical — log but don't fail
      console.warn("[channel-whatsapp] Failed to create credentials backup:", err);
    }
  }

  /**
   * Check if a file contains valid JSON (non-empty, parseable).
   */
  private async isValidJson(path: string): Promise<boolean> {
    try {
      const content = await fs.readFile(path, "utf8");
      if (!content || content.trim().length === 0) {
        return false;
      }
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}
