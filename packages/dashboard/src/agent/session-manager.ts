import {
  createBrainQuery,
  loadConfig,
  assembleSystemPrompt,
} from "@my-agent/core";
import type { Query } from "@my-agent/core";
import { processStream, type StreamEvent } from "./stream-processor.js";

export class SessionManager {
  private isFirstTurn = true;
  private config: { model: string; brainDir: string } | null = null;
  private systemPrompt: string | null = null;
  private initPromise: Promise<void> | null = null;
  private activeQuery: Query | null = null;

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    this.config = loadConfig();
    this.systemPrompt = await assembleSystemPrompt(this.config.brainDir);
  }

  async *streamMessage(content: string): AsyncGenerator<StreamEvent> {
    await this.ensureInitialized();

    const q = createBrainQuery(content, {
      model: this.config!.model,
      systemPrompt: this.systemPrompt!,
      continue: !this.isFirstTurn,
      includePartialMessages: true,
    });

    this.activeQuery = q;

    try {
      yield* processStream(q);
      this.isFirstTurn = false;
    } finally {
      this.activeQuery = null;
    }
  }

  async abort(): Promise<void> {
    if (this.activeQuery) {
      await this.activeQuery.interrupt();
    }
  }
}
