/**
 * Credential save queue — serializes all creds.update calls to prevent
 * file corruption from concurrent writes.
 */
export class CredentialSaveQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;

  enqueue(saveFn: () => Promise<void>): void {
    this.queue.push(saveFn);
    if (!this.processing) {
      void this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
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
