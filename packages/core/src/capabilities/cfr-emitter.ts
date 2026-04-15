/**
 * CfrEmitter — sink for Capability Failure Recovery events.
 * Wired to App in S4; for S1 emits to a no-op listener.
 * Created in M9.6-S1. Immutable after S1.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { CapabilityFailure } from "./cfr-types.js";

export class CfrEmitter extends EventEmitter {
  /**
   * Emit a capability failure event. Fills in `id`, `detectedAt`,
   * `attemptNumber`, and `previousAttempts` automatically.
   * Returns the completed CapabilityFailure for callers that need to log it.
   */
  emitFailure(
    f: Omit<
      CapabilityFailure,
      "id" | "detectedAt" | "attemptNumber" | "previousAttempts"
    >,
  ): CapabilityFailure {
    const failure: CapabilityFailure = {
      ...f,
      id: randomUUID(),
      detectedAt: new Date().toISOString(),
      attemptNumber: 1,
      previousAttempts: [],
    };
    this.emit("failure", failure);
    return failure;
  }

  on(event: "failure", listener: (f: CapabilityFailure) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }
}
