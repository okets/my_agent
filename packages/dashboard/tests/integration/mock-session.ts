/**
 * Mock SDK session for headless QA testing.
 *
 * Replaces the real SessionRegistry.getOrCreate() to return a mock
 * SessionManager that yields configurable StreamEvents without
 * requiring a real Claude API key or LLM call.
 *
 * M6.10-S4: Key enabler for headless agent QA tests.
 */

import type { AppHarness } from "./app-harness.js";
import type { StreamEvent } from "../../src/agent/stream-processor.js";

export interface MockSessionOptions {
  /** The text the mock agent will respond with */
  response?: string;
  /** Custom stream events to yield (overrides response text) */
  events?: StreamEvent[];
  /** Simulated cost in USD */
  cost?: number;
  /** Simulated token usage */
  usage?: { input: number; output: number };
  /** If true, yield an error event instead of a response */
  error?: string;
}

/**
 * A mock session object that matches the SessionManager interface
 * as consumed by ChatService.sendMessage().
 */
class MockSessionManager {
  private options: MockSessionOptions;
  private sessionId: string;
  private taskContext: { taskId: string; title: string } | null = null;

  constructor(conversationId: string, options: MockSessionOptions) {
    this.options = options;
    this.sessionId = `mock-session-${conversationId}`;
  }

  /** Called by ChatService when task context is provided */
  setTaskContext(taskId: string, title: string): void {
    this.taskContext = { taskId, title };
  }

  /** Called by ChatService after streaming to persist the session ID */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Called by SessionRegistry.remove() for cleanup */
  async abort(): Promise<void> {
    // No-op for mock
  }

  /**
   * Stream a mock response. Yields the same StreamEvent types
   * that the real SessionManager produces via processStream().
   */
  async *streamMessage(
    _content: string | unknown[],
    _options?: { model?: string; reasoning?: boolean },
  ): AsyncGenerator<StreamEvent> {
    // If custom events are provided, yield those directly
    if (this.options.events) {
      for (const event of this.options.events) {
        yield event;
      }
      return;
    }

    // If error mode, yield error + done
    if (this.options.error) {
      yield { type: "error", message: this.options.error };
      yield {
        type: "done",
        cost: undefined,
        usage: undefined,
      };
      return;
    }

    // Default: yield text_delta chunks + done
    const responseText = this.options.response ?? "Mock response";

    // Simulate session init (real sessions emit this)
    yield { type: "session_init", sessionId: this.sessionId };

    // Yield text in a single delta (sufficient for testing)
    yield { type: "text_delta", text: responseText };

    // Yield done with optional cost/usage
    yield {
      type: "done",
      cost: this.options.cost,
      usage: this.options.usage,
    };
  }
}

/**
 * Install a mock session into the AppHarness.
 *
 * Overrides sessionRegistry.getOrCreate() to return a MockSessionManager
 * instead of a real SessionManager that would call the Claude API.
 *
 * Also wires minimal ChatServiceDeps so sendMessage() can run without
 * external services.
 */
export function installMockSession(
  harness: AppHarness,
  options: MockSessionOptions = {},
): void {
  // Override getOrCreate to return mock sessions
  const mockSessions = new Map<string, MockSessionManager>();

  harness.sessionRegistry.getOrCreate = async (
    conversationId: string,
    _sdkSessionId?: string | null,
  ) => {
    if (!mockSessions.has(conversationId)) {
      mockSessions.set(
        conversationId,
        new MockSessionManager(conversationId, options),
      );
    }
    return mockSessions.get(conversationId)! as any;
  };

  // Wire minimal deps so sendMessage() doesn't fail on missing log functions
  harness.chat.setDeps({
    log: () => {},
    logError: () => {},
    abbreviationQueue: null,
    idleTimerManager: null,
    attachmentService: null,
    conversationSearchService: null,
    postResponseHooks: null,
  });
}
