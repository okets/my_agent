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
