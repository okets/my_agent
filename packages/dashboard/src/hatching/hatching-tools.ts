import { z } from "zod";
import {
  query,
  createSdkMcpServer,
  tool,
  type Query,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import {
  getPersonalities,
  writeIdentity,
  applyPersonality,
  writeOperatingRules,
  writeHatchedMarker,
  writeMinimalConfig,
  type PersonalityOption,
} from "@my-agent/core";
import type { ServerMessage, ChatControl } from "../ws/protocol.js";
import { buildHatchingPrompt } from "./hatching-prompt.js";

interface HatchingSessionCallbacks {
  send: (msg: ServerMessage) => void;
  onComplete: (agentName: string) => void;
}

export function createHatchingSession(
  agentDir: string,
  callbacks: HatchingSessionCallbacks,
): {
  start: () => AsyncGenerator<unknown>;
  handleControlResponse: (controlId: string, value: string) => boolean;
  handleFreeText: (text: string) => boolean;
  cleanup: () => void;
  query: Query | null;
} {
  // Session-scoped state
  let controlIdCounter = 0;
  const pendingResponses = new Map<
    string,
    { resolve: (value: string) => void }
  >();
  let activeQuery: Query | null = null;

  function generateControlId(): string {
    return `hatching-control-${++controlIdCounter}`;
  }

  function waitForControlResponse(controlId: string): Promise<string> {
    return new Promise((resolve) => {
      pendingResponses.set(controlId, { resolve });
    });
  }

  function resolveResponse(controlId: string, value: string): boolean {
    const pending = pendingResponses.get(controlId);
    if (pending) {
      pending.resolve(value);
      pendingResponses.delete(controlId);
      return true;
    }
    return false;
  }

  function cleanup() {
    // Resolve all pending promises with a session closed marker
    for (const [id, pending] of pendingResponses) {
      pending.resolve("__session_closed__");
    }
    pendingResponses.clear();
  }

  // Define tools using the SDK's tool() helper for proper type inference
  const presentChoicesTool = tool(
    "present_choices",
    "Show interactive buttons or cards to the user and wait for their selection. The user sees your preceding text as the prompt — just call this tool with the options.",
    {
      options: z
        .array(
          z.object({
            label: z.string(),
            value: z.string(),
            emoji: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .describe("Options to present to the user"),
      style: z
        .enum(["buttons", "cards"])
        .describe("How to display the choices"),
      columns: z
        .number()
        .optional()
        .describe("For cards: 1 or 2 columns (default 2)"),
    },
    async (args) => {
      const controlId = generateControlId();

      const controls: ChatControl[] = [];
      if (args.style === "buttons") {
        controls.push({
          type: "buttons",
          id: controlId,
          options: args.options.map((opt) => ({
            label: opt.label,
            value: opt.value,
          })),
        });
      } else {
        controls.push({
          type: "cards",
          id: controlId,
          columns: (args.columns as 1 | 2) || 2,
          options: args.options,
        });
      }

      callbacks.send({ type: "controls", controls });
      const value = await waitForControlResponse(controlId);

      return {
        content: [{ type: "text" as const, text: `User selected: ${value}` }],
      };
    },
  );

  const requestComposeInputTool = tool(
    "request_compose_input",
    "Ask the user to type a response in the compose bar. Sets the placeholder text. The user sees your preceding text as the prompt -- just call this to activate the compose bar for text input.",
    {
      placeholder: z
        .string()
        .optional()
        .describe("Placeholder text for the compose bar"),
    },
    async (args) => {
      console.log("[Hatching] request_compose_input called with:", args);
      const controlId = generateControlId();

      console.log("[Hatching] Sending compose_hint with controlId:", controlId);
      callbacks.send({
        type: "compose_hint",
        placeholder: args.placeholder || "Type your answer...",
        controlId,
      });

      console.log("[Hatching] Waiting for control response...");
      const value = await waitForControlResponse(controlId);
      console.log("[Hatching] Got response:", value);

      return {
        content: [{ type: "text" as const, text: `User entered: ${value}` }],
      };
    },
  );

  const getPersonalitiesTool = tool(
    "get_personalities",
    "Get the list of available personality templates",
    {},
    async () => {
      const personalities = await getPersonalities();
      const formatted = personalities
        .map(
          (p: PersonalityOption) =>
            `${p.emoji} ${p.name}: ${p.description} (filename: ${p.filename})`,
        )
        .join("\n");

      return {
        content: [{ type: "text" as const, text: formatted }],
      };
    },
  );

  const saveSetupTool = tool(
    "save_setup",
    "Finalize the hatching process with all collected information",
    {
      agentName: z.string().describe("The name chosen for the agent"),
      userName: z.string().describe("The user's name"),
      purpose: z.string().describe("What the agent will work on"),
      personalityFilename: z
        .string()
        .describe("Filename of the chosen personality (without .md)"),
      autonomy: z.string().optional().describe("Autonomy level (optional)"),
      escalations: z
        .string()
        .optional()
        .describe("When to escalate (optional)"),
      style: z.string().optional().describe("Communication style (optional)"),
    },
    async (args) => {
      try {
        // Update config with agent name
        await writeMinimalConfig(agentDir, { nickname: args.agentName });

        // Write identity
        await writeIdentity(agentDir, {
          nickname: args.userName,
          purpose: args.purpose,
        });

        // Apply personality
        await applyPersonality(agentDir, args.personalityFilename);

        // Write operating rules if provided
        if (args.autonomy || args.escalations || args.style) {
          await writeOperatingRules(agentDir, {
            autonomy: args.autonomy || "Medium — decide routine tasks",
            escalations: args.escalations || "Nothing specified",
            style: args.style || "Direct and concise",
          });
        }

        // Mark as hatched
        await writeHatchedMarker(agentDir);
        callbacks.onComplete(args.agentName);

        return {
          content: [
            {
              type: "text" as const,
              text: `Setup complete! ${args.agentName} is ready.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error during setup: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // Create MCP server
  const mcpServer = createSdkMcpServer({
    name: "hatching-tools",
    version: "1.0.0",
    tools: [
      presentChoicesTool,
      requestComposeInputTool,
      getPersonalitiesTool,
      saveSetupTool,
    ],
  });

  const startGenerator = async function* () {
    console.log("[Hatching] startGenerator called");
    const systemPrompt = buildHatchingPrompt();

    const queryOptions: Options = {
      model: "claude-sonnet-4-5-20250929",
      systemPrompt,
      includePartialMessages: true,
      mcpServers: { "hatching-tools": mcpServer },
      // Explicitly allow our MCP tools (required for MCP tools to be visible to LLM)
      allowedTools: [
        "mcp__hatching-tools__present_choices",
        "mcp__hatching-tools__request_compose_input",
        "mcp__hatching-tools__get_personalities",
        "mcp__hatching-tools__save_setup",
      ],
    };

    console.log("[Hatching] Creating query...");
    const q: Query = query({
      prompt: `Hi! I just got authenticated. Let's set things up.`,
      options: queryOptions,
    });
    activeQuery = q;
    console.log("[Hatching] Query created, starting iteration...");

    let lastSentText = "";
    let sentStart = false;

    for await (const msg of q) {
      console.log("[Hatching] Got message type:", msg.type);
      yield msg;

      // Reset for new turn when user message (tool result) comes through
      if (msg.type === "user") {
        lastSentText = "";
        sentStart = false;
      }

      // Handle assistant messages (contains content blocks)
      if (msg.type === "assistant") {
        const assistantMsg = msg as {
          type: "assistant";
          message: {
            content: Array<{
              type: string;
              text?: string;
              thinking?: string;
            }>;
          };
        };

        // Send start on first assistant message
        if (!sentStart) {
          callbacks.send({ type: "start" });
          sentStart = true;
        }

        // Extract text content and send deltas
        let currentText = "";
        for (const block of assistantMsg.message.content) {
          if (block.type === "text" && block.text) {
            currentText += block.text;
          }
        }

        // Send only the new text as delta
        if (currentText.length > lastSentText.length) {
          const delta = currentText.slice(lastSentText.length);
          callbacks.send({ type: "text_delta", content: delta });
          lastSentText = currentText;
        }
      }

      // Handle result (end of query)
      if (msg.type === "result") {
        const result = msg as {
          type: "result";
          is_error?: boolean;
          result?: string;
        };

        if (result.is_error) {
          console.log("[Hatching] Query failed:", result.result);
          callbacks.send({
            type: "error",
            message: result.result || "Hatching failed",
          });
        } else if (sentStart) {
          callbacks.send({ type: "done" });
        }
        break;
      }
    }
  };

  // Handle free text by resolving any pending control
  function handleFreeText(text: string): boolean {
    // If there's any pending response, resolve it with the free text
    const firstPending = pendingResponses.keys().next().value;
    if (firstPending) {
      return resolveResponse(firstPending, text);
    }
    return false;
  }

  return {
    start: startGenerator,
    handleControlResponse: resolveResponse,
    handleFreeText,
    cleanup,
    get query() {
      return activeQuery;
    },
  };
}
