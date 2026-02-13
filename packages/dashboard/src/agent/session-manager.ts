import {
  createBrainQuery,
  loadConfig,
  assembleSystemPrompt,
} from "@my-agent/core";

export class SessionManager {
  private isFirstTurn = true;
  private config: { model: string; brainDir: string } | null = null;
  private systemPrompt: string | null = null;
  private initPromise: Promise<void> | null = null;

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    // Load config and system prompt (do this once, reuse)
    this.config = loadConfig();
    this.systemPrompt = await assembleSystemPrompt(this.config.brainDir);
  }

  async sendMessage(content: string): Promise<string> {
    await this.ensureInitialized();

    // Create query with continue:true for subsequent turns
    const query = createBrainQuery(content, {
      model: this.config!.model,
      systemPrompt: this.systemPrompt!,
      continue: !this.isFirstTurn,
    });

    // Collect the full response text
    // NOTE: Don't use streamResponse() because it writes to stdout
    // Instead, iterate the query directly:
    let fullText = "";
    for await (const msg of query) {
      if (msg.type === "assistant") {
        const text = msg.message.content
          .filter((block: { type: string }) => block.type === "text")
          .map((block: { type: string; text?: string }) => block.text ?? "")
          .join("");
        fullText = text;
      }
      if (msg.type === "result") break;
    }

    this.isFirstTurn = false;
    return fullText;
  }
}
