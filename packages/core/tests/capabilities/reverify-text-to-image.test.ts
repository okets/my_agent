/**
 * Tests for reverifyTextToImage (M9.6-S13).
 */

import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { reverifyTextToImage } from "../../src/capabilities/reverify.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";

function makeCapDir(exitCode: number, outputBytes: Buffer | null = null): string {
  const capDir = join(tmpdir(), `t2i-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  const script = join(capDir, "scripts", "generate.sh");
  if (outputBytes !== null) {
    // Script writes bytes to $1 output path
    const hexStr = outputBytes.toString("hex");
    writeFileSync(script, `#!/usr/bin/env bash\nOUTPUT="$1"\npython3 -c "import sys; sys.stdout.buffer.write(bytes.fromhex('${hexStr}'))" > "$OUTPUT"\nexit ${exitCode}\n`);
  } else {
    writeFileSync(script, `#!/usr/bin/env bash\nexit ${exitCode}\n`);
  }
  chmodSync(script, 0o755);
  return capDir;
}

function makeRegistry(capDir: string): CapabilityRegistry {
  return {
    get: (t: string) =>
      t === "text-to-image"
        ? { status: "available", name: "t2i-test", provides: "text-to-image", path: capDir, interface: "script" }
        : undefined,
  } as unknown as CapabilityRegistry;
}

function makeFailure(): CapabilityFailure {
  return {
    id: "f-t2i",
    capabilityType: "text-to-image",
    symptom: "execution-error",
    triggeringInput: { origin: { kind: "system", component: "test" } },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

describe("reverifyTextToImage", () => {
  it("returns pass:true with recoveredContent:undefined when generate.sh produces valid PNG output", async () => {
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const capDir = makeCapDir(0, pngHeader);
    const result = await reverifyTextToImage(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(true);
    expect(result.recoveredContent).toBeUndefined();
    expect(result.verificationInputPath).toBeDefined();
  });

  it("returns pass:false when generate.sh exits non-zero", async () => {
    const capDir = makeCapDir(1, null);
    const result = await reverifyTextToImage(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(false);
  });

  it("returns pass:false when output has invalid image header", async () => {
    const badHeader = Buffer.from("BADHEADER");
    const capDir = makeCapDir(0, badHeader);
    const result = await reverifyTextToImage(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/header/i);
  });

  it("returns pass:false when capability not in registry", async () => {
    const registry = { get: () => undefined } as unknown as CapabilityRegistry;
    const result = await reverifyTextToImage(makeFailure(), registry);
    expect(result.pass).toBe(false);
  });
});
