import {
  checkEnvAuth,
  createDirectoryStructure,
  writeMinimalConfig,
  saveAuth,
  validateSetupToken,
} from "@my-agent/core";
import type { ServerMessage } from "../ws/protocol.js";

type State = "AUTH_DETECT" | "AUTH_INPUT" | "DONE";

type AuthMethod = "api_key" | "subscription";

interface ScriptedEngineCallbacks {
  send: (msg: ServerMessage) => void;
  onComplete: () => void;
}

export class ScriptedHatchingEngine {
  private state: State = "AUTH_DETECT";
  private authMethod: AuthMethod | null = null;
  private authToken = "";
  private useEnvAuth = false;
  private currentControlId = "";

  constructor(
    private agentDir: string,
    private callbacks: ScriptedEngineCallbacks,
  ) {}

  start(): void {
    this.sendAuthDetectStep();
  }

  handleControlResponse(controlId: string, value: string): void {
    if (controlId !== this.currentControlId) {
      return; // Ignore stale responses
    }

    this.currentControlId = ""; // Clear after handling

    switch (this.state) {
      case "AUTH_DETECT":
        if (value === "env") {
          this.useEnvAuth = true;
          this.finalize();
        } else if (value === "api_key") {
          this.authMethod = "api_key";
          this.state = "AUTH_INPUT";
          this.sendAuthInputStep();
        } else if (value === "subscription") {
          this.authMethod = "subscription";
          this.state = "AUTH_INPUT";
          this.sendAuthInputStep();
        } else if (value === "different") {
          // User wants to enter different auth
          this.sendAuthMethodChoice();
        }
        break;

      case "AUTH_INPUT":
        if (!value.trim()) {
          this.callbacks.send({
            type: "error",
            message: "Authentication token cannot be empty",
          });
          this.resendComposeHint(
            "auth-token",
            this.authMethod === "api_key"
              ? "Paste API key here..."
              : "Paste setup token here...",
            true,
          );
          return;
        }

        // Validate subscription tokens
        if (this.authMethod === "subscription") {
          const validationError = validateSetupToken(value.trim());
          if (validationError) {
            this.callbacks.send({
              type: "error",
              message:
                "That doesn't look like a setup token. It should start with `sk-ant-oat01-`. Try generating a new one with `claude setup-token`.",
            });
            this.resendComposeHint(
              "auth-token",
              "Paste setup token here...",
              true,
            );
            return;
          }
        }

        this.authToken = value.trim();
        this.finalize();
        break;
    }
  }

  handleFreeText(text: string): void {
    // Treat free text as control response if we're waiting for compose input
    if (this.currentControlId) {
      this.handleControlResponse(this.currentControlId, text);
    }
  }

  private resendComposeHint(
    controlId: string,
    placeholder: string,
    password = false,
  ): void {
    this.currentControlId = controlId;
    this.callbacks.send({
      type: "compose_hint",
      placeholder,
      password,
      controlId,
    });
  }

  private sendAuthDetectStep(): void {
    const envAuth = checkEnvAuth();

    if (envAuth) {
      this.callbacks.send({ type: "start" });
      this.callbacks.send({
        type: "text_delta",
        content: `Hey! I found an API key in your environment (\`${envAuth.preview}\`). Want to use it?`,
      });
      this.callbacks.send({ type: "done" });

      this.currentControlId = "auth-choice";
      this.callbacks.send({
        type: "controls",
        controls: [
          {
            type: "buttons",
            id: "auth-choice",
            options: [
              { label: "Use this", value: "env", variant: "primary" },
              { label: "Enter different", value: "different" },
            ],
          },
        ],
      });
    } else {
      this.sendAuthMethodChoice();
    }
  }

  private sendAuthMethodChoice(): void {
    this.callbacks.send({ type: "start" });
    this.callbacks.send({
      type: "text_delta",
      content:
        "Hey! Before we get started, I need a connection to Anthropic. You have two options:\n\n" +
        "**API Key** -- For developers. Create one at [console.anthropic.com](https://console.anthropic.com/) " +
        "under API Keys. Usage is billed to your account.\n\n" +
        "**Claude Subscription** -- Already paying for Claude Max/Pro? " +
        "Run `claude setup-token` in your terminal to generate a token. " +
        "This lets me use your subscription -- no extra API costs.",
    });
    this.callbacks.send({ type: "done" });

    this.currentControlId = "auth-method";
    this.callbacks.send({
      type: "controls",
      controls: [
        {
          type: "buttons",
          id: "auth-method",
          options: [
            { label: "I have an API Key", value: "api_key" },
            { label: "I have a subscription", value: "subscription" },
          ],
        },
      ],
    });
  }

  private sendAuthInputStep(): void {
    this.callbacks.send({ type: "start" });

    if (this.authMethod === "api_key") {
      this.callbacks.send({
        type: "text_delta",
        content:
          "Paste your API key below. It starts with `sk-ant-api03-...` and you can find or create one at " +
          "[console.anthropic.com](https://console.anthropic.com/).\n\n" +
          "Don't worry -- it's stored locally and never leaves this machine.",
      });
    } else {
      this.callbacks.send({
        type: "text_delta",
        content:
          "Run `claude setup-token` in your terminal -- it'll open a browser to authenticate, " +
          "then print a token that starts with `sk-ant-oat01-...`\n\n" +
          "Paste it below. This connects me to your Claude subscription -- no separate API billing.",
      });
    }

    this.callbacks.send({ type: "done" });

    this.currentControlId = "auth-token";
    this.callbacks.send({
      type: "compose_hint",
      placeholder:
        this.authMethod === "api_key"
          ? "Paste API key here..."
          : "Paste setup token here...",
      password: true,
      controlId: "auth-token",
    });
  }

  private async finalize(): Promise<void> {
    try {
      // Create directory structure
      await createDirectoryStructure(this.agentDir);

      // Write minimal config (without agent name - Phase 2 will set it)
      await writeMinimalConfig(this.agentDir);

      // Save auth if not using env
      if (!this.useEnvAuth && this.authToken && this.authMethod) {
        const method =
          this.authMethod === "api_key" ? "api_key" : "setup_token";
        saveAuth(this.agentDir, method, this.authToken);
      }

      // Bridge message before Phase 2
      this.callbacks.send({ type: "start" });
      this.callbacks.send({
        type: "text_delta",
        content: "Got it -- credentials saved. Now let me get to know you...",
      });
      this.callbacks.send({ type: "done" });

      this.state = "DONE";
      this.callbacks.onComplete();
    } catch (err) {
      this.callbacks.send({
        type: "error",
        message: err instanceof Error ? err.message : "Setup failed",
      });
    }
  }
}
