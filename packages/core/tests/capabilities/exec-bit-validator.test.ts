/**
 * S10 acceptance test — exec-bit validation in test-harness.ts + scanner integration.
 *
 * Verifies:
 *   1. validateScriptExecBits() returns valid for executable scripts and no-scripts.
 *   2. validateScriptExecBits() returns invalid (with reason) when any .sh lacks exec bit.
 *   3. A mix (some executable, some not) returns invalid.
 *   4. scanCapabilities() marks script-interface caps invalid when scripts lack exec bit.
 */

import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { validateScriptExecBits } from "../../src/capabilities/test-harness.js";
import { scanCapabilities } from "../../src/capabilities/scanner.js";

function makeTempCapDir(scripts: Array<{ name: string; executable: boolean }>): string {
  const capDir = join(tmpdir(), `exec-bit-test-${randomUUID()}`);
  mkdirSync(join(capDir, "scripts"), { recursive: true });
  for (const { name, executable } of scripts) {
    const path = join(capDir, "scripts", name);
    writeFileSync(path, "#!/bin/bash\necho hello");
    if (executable) chmodSync(path, 0o755);
    else chmodSync(path, 0o644);
  }
  return capDir;
}

describe("validateScriptExecBits", () => {
  it("returns valid when no scripts/ directory exists", () => {
    const capDir = join(tmpdir(), `no-scripts-${randomUUID()}`);
    mkdirSync(capDir, { recursive: true });
    expect(validateScriptExecBits(capDir)).toEqual({ valid: true });
  });

  it("returns valid when scripts/ is empty", () => {
    const capDir = makeTempCapDir([]);
    expect(validateScriptExecBits(capDir)).toEqual({ valid: true });
  });

  it("returns valid when all .sh scripts are executable", () => {
    const capDir = makeTempCapDir([
      { name: "transcribe.sh", executable: true },
      { name: "detect.sh", executable: true },
    ]);
    expect(validateScriptExecBits(capDir)).toEqual({ valid: true });
  });

  it("returns invalid when a .sh script lacks exec bit", () => {
    const capDir = makeTempCapDir([
      { name: "transcribe.sh", executable: false },
    ]);
    const result = validateScriptExecBits(capDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("transcribe.sh");
    expect(result.reason).toContain("executable bit");
  });

  it("returns invalid and names all non-executable scripts in a mixed set", () => {
    const capDir = makeTempCapDir([
      { name: "transcribe.sh", executable: true },
      { name: "detect.sh", executable: false },
      { name: "helper.sh", executable: false },
    ]);
    const result = validateScriptExecBits(capDir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("detect.sh");
    expect(result.reason).toContain("helper.sh");
    expect(result.reason).not.toContain("transcribe.sh");
  });

  it("ignores non-.sh files", () => {
    const capDir = join(tmpdir(), `non-sh-${randomUUID()}`);
    mkdirSync(join(capDir, "scripts"), { recursive: true });
    // Non-.sh files without exec bit should not matter
    writeFileSync(join(capDir, "scripts", "config.json"), "{}");
    chmodSync(join(capDir, "scripts", "config.json"), 0o644);
    expect(validateScriptExecBits(capDir)).toEqual({ valid: true });
  });
});

describe("scanCapabilities — exec-bit integration", () => {
  it("marks a script-interface cap invalid when scripts/ .sh lacks exec bit", async () => {
    const capsDir = join(tmpdir(), `caps-exec-test-${randomUUID()}`);
    const capDir = join(capsDir, "my-stt");
    mkdirSync(join(capDir, "scripts"), { recursive: true });

    // Write CAPABILITY.md with required frontmatter
    const capabilityMd = `---
name: my-stt
provides: audio-to-text
interface: script
---
Test STT capability.
`;
    writeFileSync(join(capDir, "CAPABILITY.md"), capabilityMd);
    // Write a non-executable transcribe.sh
    writeFileSync(join(capDir, "scripts", "transcribe.sh"), "#!/bin/bash\necho hello");
    chmodSync(join(capDir, "scripts", "transcribe.sh"), 0o644);
    // Write .enabled file so the cap is "enabled"
    writeFileSync(join(capDir, ".enabled"), new Date().toISOString());

    const caps = await scanCapabilities(capsDir, "/nonexistent/.env");
    const cap = caps.find((c) => c.name === "my-stt");

    expect(cap).toBeDefined();
    expect(cap!.status).toBe("invalid");
    expect(cap!.error).toContain("transcribe.sh");
  });

  it("does not mark an invalid cap when scripts are executable", async () => {
    const capsDir = join(tmpdir(), `caps-exec-ok-${randomUUID()}`);
    const capDir = join(capsDir, "my-tts");
    mkdirSync(join(capDir, "scripts"), { recursive: true });

    const capabilityMd = `---
name: my-tts
provides: text-to-audio
interface: script
---
Test TTS capability.
`;
    writeFileSync(join(capDir, "CAPABILITY.md"), capabilityMd);
    writeFileSync(join(capDir, "scripts", "synthesize.sh"), "#!/bin/bash\necho hello");
    chmodSync(join(capDir, "scripts", "synthesize.sh"), 0o755);
    writeFileSync(join(capDir, ".enabled"), new Date().toISOString());

    const caps = await scanCapabilities(capsDir, "/nonexistent/.env");
    const cap = caps.find((c) => c.name === "my-tts");

    expect(cap).toBeDefined();
    expect(cap!.status).toBe("available");
  });
});
