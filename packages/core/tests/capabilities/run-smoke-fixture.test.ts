/**
 * S11 unit tests — runSmokeFixture in reverify.ts.
 *
 * Four cases:
 *   1. smoke.sh present, exits 0  → pass: true
 *   2. smoke.sh present, exits 1  → pass: false
 *   3. smoke.sh absent, cap available → pass: true + warning logged
 *   4. smoke.sh absent, cap unavailable → pass: false
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { runSmokeFixture } from "../../src/capabilities/reverify.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";

/** Build a minimal CapabilityRegistry stub with one entry */
function makeRegistry(status: "available" | "unavailable" | "invalid"): CapabilityRegistry {
  return {
    get: (type: string) =>
      type === "test-type"
        ? { status, name: "test-cap", provides: type, path: "/fake", interface: "script" }
        : undefined,
  } as unknown as CapabilityRegistry;
}

/** Create a temp capability dir with scripts/smoke.sh set to given exit code */
function makeCapDir(exitCode: number): string {
  const capDir = join(tmpdir(), `smoke-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  const script = join(capDir, "scripts", "smoke.sh");
  writeFileSync(script, `#!/usr/bin/env bash\nexit ${exitCode}\n`);
  chmodSync(script, 0o755);
  return capDir;
}

/** Create a temp capability dir with NO smoke.sh */
function makeCapDirNoSmoke(): string {
  const capDir = join(tmpdir(), `smoke-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  return capDir;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSmokeFixture", () => {
  it("returns pass:true when smoke.sh exits 0", async () => {
    const capDir = makeCapDir(0);
    const registry = makeRegistry("available");
    const result = await runSmokeFixture(capDir, registry, "test-type");
    expect(result.pass).toBe(true);
  });

  it("returns pass:false when smoke.sh exits 1", async () => {
    const capDir = makeCapDir(1);
    const registry = makeRegistry("available");
    const result = await runSmokeFixture(capDir, registry, "test-type");
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/smoke\.sh failed/);
  });

  it("falls back to availability check when smoke.sh is absent and cap is available", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const capDir = makeCapDirNoSmoke();
    const registry = makeRegistry("available");
    const result = await runSmokeFixture(capDir, registry, "test-type");
    expect(result.pass).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("template gap"));
  });

  it("returns pass:false when smoke.sh is absent and cap is not available", async () => {
    const capDir = makeCapDirNoSmoke();
    const registry = makeRegistry("unavailable");
    const result = await runSmokeFixture(capDir, registry, "test-type");
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/not available/);
  });
});
