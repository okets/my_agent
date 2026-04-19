/**
 * Tests for reverifyTextToAudio (M9.6-S13).
 */

import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { reverifyTextToAudio } from "../../src/capabilities/reverify.js";
import type { CapabilityRegistry } from "../../src/capabilities/registry.js";
import type { CapabilityFailure } from "../../src/capabilities/cfr-types.js";

function makeCapDir(scriptContent: string): string {
  const capDir = join(tmpdir(), `tts-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  const script = join(capDir, "scripts", "synthesize.sh");
  writeFileSync(script, scriptContent);
  chmodSync(script, 0o755);
  return capDir;
}

function makeRegistry(capDir: string): CapabilityRegistry {
  return {
    get: (t: string) =>
      t === "text-to-audio"
        ? { status: "available", name: "tts-test", provides: "text-to-audio", path: capDir, interface: "script" }
        : undefined,
  } as unknown as CapabilityRegistry;
}

function makeFailure(): CapabilityFailure {
  return {
    id: "f-tts",
    capabilityType: "text-to-audio",
    symptom: "execution-error",
    triggeringInput: { origin: { kind: "system", component: "test" } },
    attemptNumber: 1,
    previousAttempts: [],
    detectedAt: new Date().toISOString(),
  };
}

describe("reverifyTextToAudio", () => {
  it("returns pass:true when synthesize.sh produces valid Ogg output", async () => {
    const capDir = makeCapDir(`#!/usr/bin/env bash
OUTPUT="$2"
printf 'OggS\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00' > "$OUTPUT"
exit 0
`);
    const result = await reverifyTextToAudio(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(true);
    expect(result.recoveredContent).toBeUndefined();
    expect(result.verificationInputPath).toBeDefined();
  });

  it("returns pass:false when synthesize.sh exits non-zero", async () => {
    const capDir = makeCapDir("#!/usr/bin/env bash\nexit 1\n");
    const result = await reverifyTextToAudio(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(false);
  });

  it("returns pass:false when output file has invalid headers", async () => {
    const capDir = makeCapDir(`#!/usr/bin/env bash
OUTPUT="$2"
printf 'BADHEADER' > "$OUTPUT"
exit 0
`);
    const result = await reverifyTextToAudio(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/not Ogg/i);
  });

  it("returns pass:false when capability not in registry", async () => {
    const registry = { get: () => undefined } as unknown as CapabilityRegistry;
    const result = await reverifyTextToAudio(makeFailure(), registry);
    expect(result.pass).toBe(false);
  });

  it("returns pass:false when synthesize.sh produces MP3 output (option a — strict Ogg)", async () => {
    // MP3 MPEG sync word: ff fb
    const capDir = makeCapDir(`#!/usr/bin/env bash
OUTPUT="$2"
printf '\\xff\\xfb\\x90\\x00' > "$OUTPUT"
exit 0
`);
    const result = await reverifyTextToAudio(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/not Ogg/i);
  });

  it("returns pass:false when synthesize.sh produces WAV output (option a — strict Ogg)", async () => {
    const capDir = makeCapDir(`#!/usr/bin/env bash
OUTPUT="$2"
printf 'RIFF\\x00\\x00\\x00\\x00' > "$OUTPUT"
exit 0
`);
    const result = await reverifyTextToAudio(makeFailure(), makeRegistry(capDir));
    expect(result.pass).toBe(false);
    expect(result.failureMode).toMatch(/not Ogg/i);
  });
});
