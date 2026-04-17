/**
 * CapabilityInvoker — single gate for script-plug invocation.
 *
 * Every sanctioned path from user turn → script plug execution routes through
 * this class. Wraps registry lookup + execFile + error classification +
 * cfr.emitFailure() in one call. No per-call-site detection code needed.
 *
 * Created in M9.6-S10.
 *
 * Constructor deps:
 *   - cfr: emitter wired to the recovery orchestrator
 *   - registry: capability registry for status/path lookups
 *   - originFactory: returns TriggeringOrigin for this execution context.
 *     S10 callers provide a complete TriggeringInput (origin included), so
 *     the factory is not called at invocation time. S12 automation workers
 *     will use the factory to auto-populate origin without caller-side wiring.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CapabilityFailureSymptom, TriggeringInput, TriggeringOrigin } from "./cfr-types.js";
import type { CfrEmitter } from "./cfr-emitter.js";
import type { CapabilityRegistry } from "./registry.js";

const execFileAsync = promisify(execFile);

export interface InvokeOptions {
  capabilityType: string;    // e.g. "audio-to-text"
  scriptName: string;        // e.g. "transcribe.sh"
  args: string[];
  triggeringInput: TriggeringInput;
  timeoutMs?: number;        // default 30 000 ms
  expectJson?: boolean;      // parse stdout as JSON; emit validation-failed if invalid
}

export type InvokeResult =
  | { kind: "success"; stdout: string; stderr: string; parsed?: unknown }
  | { kind: "failure"; symptom: CapabilityFailureSymptom; detail: string };

export interface InvokerDeps {
  cfr: CfrEmitter;
  registry: CapabilityRegistry;
  originFactory: () => TriggeringOrigin;
}

export class CapabilityInvoker {
  constructor(private readonly deps: InvokerDeps) {}

  async run(opts: InvokeOptions): Promise<InvokeResult> {
    const { cfr, registry } = this.deps;
    const {
      capabilityType,
      scriptName,
      args,
      timeoutMs = 30_000,
      expectJson = false,
      triggeringInput,
    } = opts;

    const emit = (symptom: CapabilityFailureSymptom, detail: string, capName?: string): InvokeResult => {
      cfr.emitFailure({
        capabilityType,
        capabilityName: capName,
        symptom,
        detail,
        triggeringInput,
      });
      return { kind: "failure", symptom, detail };
    };

    // Granular registry checks: not-installed → not-enabled → execution-error
    const allCaps = registry.listByProvides(capabilityType);
    if (allCaps.length === 0) {
      return emit("not-installed", `No ${capabilityType} capability installed`);
    }
    const cap = allCaps[0];
    if (!cap.enabled) {
      return emit("not-enabled", `${cap.name} is disabled`, cap.name);
    }
    if (cap.status !== "available") {
      const reason = cap.unavailableReason ? `: ${cap.unavailableReason}` : "";
      return emit("execution-error", `${cap.name} is not available (${cap.status}${reason})`, cap.name);
    }

    const scriptPath = join(cap.path, "scripts", scriptName);

    try {
      const { stdout, stderr } = await execFileAsync(scriptPath, args, {
        timeout: timeoutMs,
        env: { ...process.env },
      });

      if (expectJson) {
        try {
          const parsed = JSON.parse(stdout.trim()) as unknown;
          return { kind: "success", stdout, stderr, parsed };
        } catch {
          return emit(
            "validation-failed",
            `Script output is not valid JSON: ${stdout.trim().slice(0, 200)}`,
            cap.name,
          );
        }
      }

      return { kind: "success", stdout, stderr };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      // Node.js execFile sets killed=true and code='ETIMEDOUT' on timeout.
      // The message may not contain "timeout", so check the code field too.
      const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
      const killed = err instanceof Error ? (err as { killed?: boolean }).killed : false;
      if (killed || code === "ETIMEDOUT" || lower.includes("etimedout") || lower.includes("timeout")) {
        return emit("timeout", msg, cap.name);
      }
      return emit("execution-error", msg, cap.name);
    }
  }
}
