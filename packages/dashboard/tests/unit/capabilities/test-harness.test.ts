import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { testCapability } from "@my-agent/core";
import type { Capability } from "@my-agent/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;

function makeTmp(): string {
  const id = `harness-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join("/tmp", id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create a capability folder with a script that outputs the given string to stdout */
function makeCapability(opts: {
  name: string;
  provides: string;
  scriptName: string;
  scriptBody: string;
}): Capability {
  const capDir = join(tmpRoot, opts.name);
  const scriptsDir = join(capDir, "scripts");
  mkdirSync(scriptsDir, { recursive: true });

  const scriptPath = join(scriptsDir, opts.scriptName);
  writeFileSync(scriptPath, `#!/bin/bash\n${opts.scriptBody}`);
  chmodSync(scriptPath, 0o755);

  return {
    name: opts.name,
    provides: opts.provides,
    interface: "script",
    path: capDir,
    status: "available",
    health: "untested",
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

/** Ensure the test WAV fixture exists (tiny valid-ish WAV — no ffmpeg needed) */
function ensureAudioFixture(): void {
  const fixturePath = "/tmp/capability-test-audio.wav";
  if (existsSync(fixturePath)) return;
  // Minimal WAV header (44 bytes) + 100 bytes of silence
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(136, 4); // file size - 8
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24); // sample rate
  header.writeUInt32LE(32000, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(100, 40); // data size
  const data = Buffer.alloc(100);
  writeFileSync(fixturePath, Buffer.concat([header, data]));
}

beforeEach(() => {
  tmpRoot = makeTmp();
  ensureAudioFixture();
});

afterEach(() => {
  if (existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ===========================================================================
// 1. Audio-to-text tests
// ===========================================================================

describe("testCapability — audio-to-text", () => {
  it("passes with valid JSON output containing text field", async () => {
    const cap = makeCapability({
      name: "stt-good",
      provides: "audio-to-text",
      scriptName: "transcribe.sh",
      scriptBody: 'echo \'{"text": "hello world"}\'',
    });

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails when script outputs invalid JSON", async () => {
    const cap = makeCapability({
      name: "stt-bad-json",
      provides: "audio-to-text",
      scriptName: "transcribe.sh",
      scriptBody: "echo 'not json'",
    });

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("Invalid JSON");
  });

  it("fails when JSON is missing text field", async () => {
    const cap = makeCapability({
      name: "stt-missing-field",
      provides: "audio-to-text",
      scriptName: "transcribe.sh",
      scriptBody: 'echo \'{"result": "hello"}\'',
    });

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain('Missing "text" field');
  });

  it("fails when script exits non-zero", async () => {
    const cap = makeCapability({
      name: "stt-exit1",
      provides: "audio-to-text",
      scriptName: "transcribe.sh",
      scriptBody: "echo 'API key invalid' >&2\nexit 1",
    });

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("API key invalid");
  });

  it("fails when script produces no output", async () => {
    const cap = makeCapability({
      name: "stt-empty",
      provides: "audio-to-text",
      scriptName: "transcribe.sh",
      scriptBody: "# silent",
    });

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("No output");
  });

  it("fails when transcribe.sh does not exist", async () => {
    const capDir = join(tmpRoot, "stt-no-script");
    mkdirSync(capDir, { recursive: true });

    const cap: Capability = {
      name: "stt-no-script",
      provides: "audio-to-text",
      interface: "script",
      path: capDir,
      status: "available",
      health: "untested",
    };

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("transcribe.sh not found");
  });
});

// ===========================================================================
// 2. Text-to-audio tests
// ===========================================================================

describe("testCapability — text-to-audio", () => {
  it("passes with valid JSON and output file", async () => {
    const outputPath = "/tmp/capability-test-output.ogg";
    const cap = makeCapability({
      name: "tts-good",
      provides: "text-to-audio",
      scriptName: "synthesize.sh",
      // Write 200 bytes of data to simulate an audio file
      scriptBody: `dd if=/dev/urandom of="$2" bs=200 count=1 2>/dev/null\necho '{"path": "'"$2"'"}'`,
    });

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    // Clean up
    if (existsSync(outputPath)) rmSync(outputPath);
  });

  it("fails when output file is too small", async () => {
    const cap = makeCapability({
      name: "tts-tiny",
      provides: "text-to-audio",
      scriptName: "synthesize.sh",
      // Write only 10 bytes — below the 100-byte minimum
      scriptBody: `echo -n "tiny" > "$2"\necho '{"path": "'"$2"'"}'`,
    });

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("too small");
  });

  it("fails when output file does not exist", async () => {
    const cap = makeCapability({
      name: "tts-no-file",
      provides: "text-to-audio",
      scriptName: "synthesize.sh",
      // Outputs JSON referencing $2 but doesn't create the file
      scriptBody: `echo '{"path": "'"$2"'"}'\n# deliberately not writing the file`,
    });

    // Remove the output path if it exists from a prior test
    const outputPath = "/tmp/capability-test-output.ogg";
    if (existsSync(outputPath)) rmSync(outputPath);

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("not found");
  });

  it("fails when synthesize.sh does not exist", async () => {
    const capDir = join(tmpRoot, "tts-no-script");
    mkdirSync(capDir, { recursive: true });

    const cap: Capability = {
      name: "tts-no-script",
      provides: "text-to-audio",
      interface: "script",
      path: capDir,
      status: "available",
      health: "untested",
    };

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("synthesize.sh not found");
  });
});

// ===========================================================================
// 3. Text-to-image tests
// ===========================================================================

describe("testCapability — text-to-image", () => {
  it("passes with valid JSON and output file", async () => {
    const outputPath = "/tmp/capability-test-output.png";
    const cap = makeCapability({
      name: "img-good",
      provides: "text-to-image",
      scriptName: "generate.sh",
      // Write 2000 bytes to simulate an image file
      scriptBody: `dd if=/dev/urandom of="$2" bs=2000 count=1 2>/dev/null\necho '{"path": "'"$2"'"}'`,
    });

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    // Clean up
    if (existsSync(outputPath)) rmSync(outputPath);
  });

  it("fails when output file is too small", async () => {
    const cap = makeCapability({
      name: "img-tiny",
      provides: "text-to-image",
      scriptName: "generate.sh",
      // Write only 100 bytes — below the 1000-byte minimum for images
      scriptBody: `dd if=/dev/urandom of="$2" bs=100 count=1 2>/dev/null\necho '{"path": "'"$2"'"}'`,
    });

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("too small");
  });

  it("fails when generate.sh does not exist", async () => {
    const capDir = join(tmpRoot, "img-no-script");
    mkdirSync(capDir, { recursive: true });

    const cap: Capability = {
      name: "img-no-script",
      provides: "text-to-image",
      interface: "script",
      path: capDir,
      status: "available",
      health: "untested",
    };

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("generate.sh not found");
  });
});

// ===========================================================================
// 4. Edge cases
// ===========================================================================

describe("testCapability — edge cases", () => {
  it("returns error for unavailable capability", async () => {
    const cap: Capability = {
      name: "unavailable",
      provides: "audio-to-text",
      interface: "script",
      path: tmpRoot,
      status: "unavailable",
      health: "untested",
    };

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("unavailable");
  });

  it("returns error for capability with no provides type", async () => {
    const cap: Capability = {
      name: "custom",
      interface: "script",
      path: tmpRoot,
      status: "available",
      health: "untested",
    };

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("No well-known type");
  });

  it("returns error for unknown capability type", async () => {
    const cap: Capability = {
      name: "exotic",
      provides: "video-to-text",
      interface: "script",
      path: tmpRoot,
      status: "available",
      health: "untested",
    };

    const result = await testCapability(cap, tmpRoot);
    expect(result.status).toBe("error");
    expect(result.message).toContain("No test contract");
  });
});
