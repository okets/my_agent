/**
 * S14 universal-coverage gate (§0.1) for resilience-messages.ts.
 *
 * Two layers:
 *
 * Layer 1 — static: every well-known type in FRIENDLY_NAMES has a non-empty
 * entry. Runs in CI.
 *
 * Layer 2 — dynamic: scans the real .my_agent/capabilities/ directory and
 * verifies that every installed `provides` type has at least an entry in
 * FRIENDLY_NAMES or a custom fallback in getFallbackAction. Skipped in CI
 * (SKIP_DYNAMIC_COVERAGE env var or when .my_agent/ is absent).
 *
 * If a type uses the default fallback ("try again in a moment") rather than
 * a real value, the test still passes — but s14-FOLLOW-UPS.md FU-2 names
 * these types for backfill in a future sprint.
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createResilienceCopy, FRIENDLY_NAMES } from "../../src/capabilities/resilience-messages.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

// ── Layer 1 static fixture ────────────────────────────────────────────────────

const REGISTERED_TYPES = [
  "audio-to-text",
  "image-to-text",
  "text-to-audio",
  "text-to-image",
  "browser-control",
  "desktop-control",
] as const;

describe("FRIENDLY_NAMES — static coverage (Layer 1)", () => {
  for (const type of REGISTERED_TYPES) {
    it(`${type} has a non-empty FRIENDLY_NAMES entry`, () => {
      expect(FRIENDLY_NAMES[type]).toBeDefined();
      expect(FRIENDLY_NAMES[type].length).toBeGreaterThan(0);
    });
  }
});

// ── Layer 2 dynamic scan ──────────────────────────────────────────────────────

const myAgentCapabilitiesDir = join(
  process.cwd(),
  "..",
  "..",
  ".my_agent",
  "capabilities",
);

const skipDynamic =
  process.env.SKIP_DYNAMIC_COVERAGE === "1" ||
  !existsSync(myAgentCapabilitiesDir);

describe.skipIf(skipDynamic)(
  "installed capabilities — dynamic scan coverage (Layer 2)",
  () => {
    it("every installed provides type has copy and fallback", async () => {
      // Import lazily so the scan is only attempted in the dynamic layer.
      const { scanCapabilities } = await import("../../src/capabilities/scanner.js");
      const { CapabilityRegistry: Reg } = await import("../../src/capabilities/registry.js");

      const envPath = join(myAgentCapabilitiesDir, "..", ".env");
      const caps = await scanCapabilities(myAgentCapabilitiesDir, envPath);

      const registry = new Reg();
      registry.load(caps);

      // Stub for copy creation — we just need isMultiInstance + getFallbackAction.
      const copy = createResilienceCopy(registry as unknown as CapabilityRegistry);

      const installedTypes = [...new Set(caps.map(c => c.provides).filter(Boolean))] as string[];
      expect(installedTypes.length).toBeGreaterThan(0);

      for (const type of installedTypes) {
        // FRIENDLY_NAMES must have an entry (or the raw type is used — acceptable).
        // getFallbackAction must return a non-empty string.
        const fallback = registry.getFallbackAction(type);
        expect(fallback.length, `getFallbackAction("${type}") must be non-empty`).toBeGreaterThan(0);

        // terminalAck and ack must be non-empty for every installed type.
        const f = {
          id: "cov-1",
          capabilityType: type,
          symptom: "execution-error" as const,
          triggeringInput: { origin: { kind: "system" as const } },
          attemptNumber: 1,
          previousAttempts: [],
          detectedAt: new Date().toISOString(),
        };
        expect(copy.ack(f).length, `ack("${type}") must be non-empty`).toBeGreaterThan(0);
        // Only enforce friendly-name substitution for types registered in FRIENDLY_NAMES.
        // Unknown/custom types intentionally fall back to the raw type string.
        if (type in FRIENDLY_NAMES) {
          expect(copy.ack(f), `${type}: ack must not use the raw type string`).not.toMatch(
            new RegExp(`hold on — ${type} isn't working right`),
          );
        }
        expect(copy.terminalAck(f).length, `terminalAck("${type}") must be non-empty`).toBeGreaterThan(0);
      }
    });
  },
);
