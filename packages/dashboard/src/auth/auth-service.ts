/**
 * AppAuthService — App-owned auth and hatching flow.
 *
 * Manages the two-phase authentication/hatching lifecycle:
 * - Phase 1 (ScriptedHatchingEngine): Collect API key via interactive controls
 * - Phase 2 (createHatchingSession): LLM-driven personality setup
 *
 * Transport adapters call createSession() with a send callback.
 * The service manages state; the adapter just forwards messages.
 *
 * M6.10-S3: Extracted from chat-handler.ts
 */

import * as path from "node:path";
import { resolveAuth, isAuthenticated } from "@my-agent/core";
import { ScriptedHatchingEngine } from "../hatching/scripted-engine.js";
import { createHatchingSession } from "../hatching/hatching-tools.js";
import type { ServerMessage } from "../ws/protocol.js";
import type { App } from "../app.js";

/**
 * Per-connection auth session.
 * Each transport connection gets its own session instance.
 */
export class AuthSession {
  private scriptedEngine: ScriptedHatchingEngine | null = null;
  private hatchingSession: ReturnType<typeof createHatchingSession> | null =
    null;
  isCompleted = false;

  constructor(
    private app: App,
    private send: (msg: ServerMessage) => void,
    private onAuthCompleted: () => void,
    private onHatchingCompleted: (agentName: string) => void,
  ) {}

  /**
   * Start the auth flow. Call this on connection open.
   * Returns true if auth was already complete (skip to post-auth).
   */
  start(): boolean {
    if (isAuthenticated()) {
      this.completeAuth();
      return true;
    }

    this.send({ type: "auth_required" });
    // .env lives at packages/dashboard/.env — resolve from this module's location
    const envPath = path.resolve(import.meta.dirname, "../../.env");

    this.scriptedEngine = new ScriptedHatchingEngine(
      this.app.agentDir,
      envPath,
      {
        send: this.send,
        onComplete: () => {
          this.scriptedEngine = null;
          this.completeAuth();
        },
      },
    );

    this.scriptedEngine.start();
    return false;
  }

  /**
   * Handle a control_response message (buttons/cards selection).
   */
  handleControlResponse(controlId: string, value: string): void {
    if (this.scriptedEngine) {
      this.scriptedEngine.handleControlResponse(controlId, value);
    } else if (this.hatchingSession) {
      this.hatchingSession.handleControlResponse(controlId, value);
    }
  }

  /**
   * Handle free text during auth/hatching.
   * Returns true if the text was consumed.
   */
  handleFreeText(content: string): boolean {
    if (this.scriptedEngine) {
      this.scriptedEngine.handleFreeText(content);
      return true;
    }
    if (this.hatchingSession) {
      const handled = this.hatchingSession.handleFreeText(content);
      if (!handled) {
        this.send({
          type: "error",
          message: "Please wait for the question to finish loading",
        });
      }
      return true;
    }
    return false;
  }

  /**
   * Abort any active auth/hatching session.
   */
  async abort(): Promise<void> {
    if (this.scriptedEngine) {
      this.scriptedEngine = null;
    }
    if (this.hatchingSession) {
      if (this.hatchingSession.query) {
        await this.hatchingSession.query.interrupt();
      }
      this.hatchingSession.cleanup();
      this.hatchingSession = null;
    }
  }

  /**
   * Whether this session is in an active auth/hatching flow.
   */
  get isActive(): boolean {
    return this.scriptedEngine !== null || this.hatchingSession !== null;
  }

  /**
   * Clean up on connection close.
   */
  async cleanup(): Promise<void> {
    await this.abort();
  }

  // ─── Private ────────────────────────────────────────────────────

  private completeAuth(): void {
    this.isCompleted = true;
    this.send({ type: "auth_ok" });

    if (!this.app.isHatched) {
      this.startHatchingPhase2();
    } else {
      this.onAuthCompleted();
    }
  }

  private startHatchingPhase2(): void {
    try {
      resolveAuth(this.app.agentDir);
    } catch {
      // Auth might not be ready yet if using env auth
    }

    this.hatchingSession = createHatchingSession(this.app.agentDir, {
      send: this.send,
      onComplete: (agentName) => {
        this.hatchingSession = null;
        this.onHatchingCompleted(agentName);
      },
    });

    (async () => {
      try {
        for await (const event of this.hatchingSession!.start()) {
          // Events forwarded by session callbacks
        }
      } catch (err) {
        console.error("[AuthSession] Phase 2 hatching error:", err);
        this.send({
          type: "error",
          message: err instanceof Error ? err.message : "Hatching error",
        });
      }
    })();
  }
}

export class AppAuthService {
  constructor(private app: App) {}

  /**
   * Check if the system is currently authenticated.
   */
  checkAuthenticated(): boolean {
    return isAuthenticated();
  }

  /**
   * Create a new auth session for a transport connection.
   * Each connection gets its own session to manage its auth state independently.
   */
  createSession(
    send: (msg: ServerMessage) => void,
    callbacks: {
      onAuthCompleted: () => void;
      onHatchingCompleted: (agentName: string) => void;
    },
  ): AuthSession {
    return new AuthSession(
      this.app,
      send,
      callbacks.onAuthCompleted,
      callbacks.onHatchingCompleted,
    );
  }
}
