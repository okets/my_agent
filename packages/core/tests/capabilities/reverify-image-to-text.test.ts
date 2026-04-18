/**
 * Tests for reverifyImageToText (M9.6-S13).
 */

import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { reverifyImageToText } from "../../src/capabilities/reverify.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";

function makeCapDir(exitCode: number, stdout = ""): string {
  const capDir = join(tmpdir(), `ocr-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  const script = join(capDir, "scripts", "ocr.sh");
  writeFileSync(script, `#!/usr/bin/env bash\necho "${stdout}"\nexit ${exitCode}\n`);
  chmodSync(script, 0o755);
  return capDir;
}

function makeRegistry(capDir: string): CapabilityRegistry {
  return {
    get: (t: string) =>
      t === "image-to-text"
        ? { status: "available", name: "ocr-test", provides: "image-to-text", path: capDir, interface: "script" }
        : undefined,
  } as unknown as CapabilityRegistry;
}

function makeFailure(): CapabilityFailure {
  return {
    id: "f-ocr",
    capabilityType: "image-to-text",
    symptom: "execution-error",
    triggeringInput: { origin: { kind: "system", component: "test" } },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

describe("reverifyImageToText", () => {
  it("returns pass:true with recoveredContent:undefined when ocr.sh produces non-empty output", async () => {
    const capDir = makeCapDir(0, "Sample text from test image");
    const result = await reverifyImageToText(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(true);
    expect(result.recoveredContent).toBeUndefined();
    expect(result.verificationInputPath).toBeDefined();
  });

  it("returns pass:false when ocr.sh exits non-zero", async () => {
    const capDir = makeCapDir(1);
    const result = await reverifyImageToText(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(false);
  });

  it("returns pass:false when ocr.sh outputs empty text", async () => {
    const capDir = makeCapDir(0, "");
    const result = await reverifyImageToText(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/empty/i);
  });

  it("returns pass:false when capability not in registry", async () => {
    const registry = { get: () => undefined } as unknown as CapabilityRegistry;
    const result = await reverifyImageToText(makeFailure(), registry);
    expect(result.pass).toBe(false);
  });
});
