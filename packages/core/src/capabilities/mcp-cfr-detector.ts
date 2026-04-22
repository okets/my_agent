/**
 * McpCapabilityCfrDetector — single gate for MCP plug failure detection.
 *
 * Two detection paths:
 *   - `hooks`  → SDK hook block covering `PostToolUseFailure` (Modes 1 & 2:
 *                tool-level exception and child-crash mid-session) and a
 *                conservative `PostToolUse` empty-result check.
 *   - `processSystemInit(msg)` → called from the message loop for Mode 3
 *                (server-never-started); the SDK does not route that case
 *                through any hook — the signature lives in the first
 *                `system/init` frame's `mcp_servers[]`.
 *
 * Per §0.2 detection-at-the-gates, every `cfr.emitFailure(...)` call for MCP
 * plugs in this sprint is inside this class.
 *
 * Created in M9.6-S12.
 */

import type {
  HookCallbackMatcher,
  HookEvent,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { CfrEmitter } from "./cfr-emitter.js";
import type { CapabilityRegistry } from "./registry.js";
import type {
  CapabilityFailureSymptom,
  TriggeringInput,
  TriggeringOrigin,
} from "./cfr-types.js";
import { classifyMcpToolError } from "./failure-symptoms.js";
import { parseMcpToolName } from "./mcp-middleware.js";

export interface McpCapabilityCfrDetectorDeps {
  cfr: CfrEmitter;
  registry: CapabilityRegistry;
  originFactory: () => TriggeringOrigin;
}

// Positive allow-list of MCP server status values that indicate a failure.
// Add new entries here when a live diagnostic reveals additional SDK strings.
// Prefer explicit allow-list over negative-match so future SDK additions of
// new "connected-equivalent" states don't silently trigger false CFRs.
const FAILED_STATUSES = new Set(["failed", "needs-auth", "disabled"]);

export class McpCapabilityCfrDetector {
  readonly hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;

  private readonly initEmitted = new Set<string>();

  constructor(private readonly deps: McpCapabilityCfrDetectorDeps) {
    this.hooks = {
      PostToolUseFailure: [
        {
          hooks: [
            async (input) => {
              this.onPostToolUseFailure(input as PostToolUseFailureHookInput);
              return {};
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            async (input) => {
              this.onPostToolUse(input as PostToolUseHookInput);
              return {};
            },
          ],
        },
      ],
    };
  }

  private onPostToolUseFailure(input: PostToolUseFailureHookInput): void {
    const parsed = parseMcpToolName(input.tool_name);
    if (!parsed) return;

    const cap = this.deps.registry.findByName(parsed.server);
    if (!cap) return;

    const symptom = classifyMcpToolError(input.error);
    const triggeringInput = this.buildTriggeringInput(
      serializeToolInput(input.tool_input),
    );

    this.deps.cfr.emitFailure({
      capabilityType: cap.provides ?? "custom",
      capabilityName: cap.name,
      symptom,
      detail: input.error,
      triggeringInput,
    });
  }

  private onPostToolUse(input: PostToolUseHookInput): void {
    const parsed = parseMcpToolName(input.tool_name);
    if (!parsed) return;

    const cap = this.deps.registry.findByName(parsed.server);
    if (!cap) return;

    // Conservative empty-result check: only emit when the response is a
    // content-block array with zero blocks. Any other shape (wrapped object,
    // non-array, null/undefined) is left alone — we cannot reliably tell
    // "empty" apart from "unknown shape" without false positives.
    if (!isStructurallyEmptyMcpResult(input.tool_response)) return;

    const triggeringInput = this.buildTriggeringInput(
      serializeToolInput(input.tool_input),
    );

    this.deps.cfr.emitFailure({
      capabilityType: cap.provides ?? "custom",
      capabilityName: cap.name,
      symptom: "empty-result" as CapabilityFailureSymptom,
      detail: "MCP tool returned zero content blocks",
      triggeringInput,
    });
  }

  /**
   * Mode 3 detection — called from the `for await (const msg of q)` message
   * loop in session-manager / automation-executor. Only acts on the
   * `system/init` frame; every other system subtype is a no-op.
   *
   * Idempotent per capability name on this detector instance (one instance
   * per session, so re-init flows in the same session don't double-emit).
   */
  processSystemInit(systemMessage: unknown): void {
    if (!isInitSystemMessage(systemMessage)) return;

    // S23 diagnostic: capture the actual mcp_servers[] shape from the SDK.
    // Kept at debug level permanently — surfaced in live tests to diagnose
    // Mode 3 detection gaps (e.g. unexpected status strings or absent entries).
    console.debug(
      "[CfrDetector] processSystemInit:",
      JSON.stringify(systemMessage.mcp_servers),
    );

    for (const entry of systemMessage.mcp_servers) {
      if (entry.status === "connected" || entry.status === "pending") continue;
      if (!FAILED_STATUSES.has(entry.status)) continue;

      const cap = this.deps.registry.findByName(entry.name);
      if (!cap) continue;

      if (this.initEmitted.has(cap.name)) continue;
      this.initEmitted.add(cap.name);

      const symptom: CapabilityFailureSymptom =
        entry.status === "failed" ? "execution-error" : "not-enabled";

      const detail =
        entry.error ??
        (entry.status === "failed"
          ? "MCP server failed to start"
          : entry.status === "needs-auth"
            ? "MCP server needs authentication"
            : "MCP server is disabled");

      try {
        this.deps.cfr.emitFailure({
          capabilityType: cap.provides ?? "custom",
          capabilityName: cap.name,
          symptom,
          detail,
          triggeringInput: this.buildTriggeringInput("[mcp init]"),
        });
      } catch (err) {
        // originFactory can throw if session context isn't ready yet (e.g. no
        // active session when processSystemInit fires). Log and continue so
        // one failed entry doesn't abort detection for remaining entries.
        console.error(
          `[CfrDetector] processSystemInit: failed to emit CFR for "${cap.name}":`,
          err,
        );
      }
    }
  }

  private buildTriggeringInput(userUtterance: string | undefined): TriggeringInput {
    return {
      origin: this.deps.originFactory(),
      userUtterance,
      artifact: undefined,
    };
  }
}

// Cap at 1000 chars — tool_input may include large payloads (screenshots,
// image bytes) and we want CFR events to stay small.
function serializeToolInput(toolInput: unknown): string {
  try {
    return JSON.stringify(toolInput).slice(0, 1000);
  } catch {
    return "";
  }
}

type InitSystemLike = Pick<SDKSystemMessage, "type" | "subtype" | "mcp_servers">;

function isInitSystemMessage(
  msg: unknown,
): msg is InitSystemLike & {
  mcp_servers: { name: string; status: string; error?: string }[];
} {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (m.type !== "system") return false;
  if (m.subtype !== "init") return false;
  if (!Array.isArray(m.mcp_servers)) return false;
  return true;
}

function isStructurallyEmptyMcpResult(result: unknown): boolean {
  if (Array.isArray(result)) return result.length === 0;
  if (result && typeof result === "object") {
    const r = result as { content?: unknown };
    if (Array.isArray(r.content)) return r.content.length === 0;
  }
  return false;
}
