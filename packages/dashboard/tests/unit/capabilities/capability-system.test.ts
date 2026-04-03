import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  scanCapabilities,
  CapabilityRegistry,
  loadCapabilityHints,
  resolveEnvPath,
} from "@my-agent/core";
import type { Capability } from "@my-agent/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;
let capDir: string;
let envPath: string;

function makeTmp(): string {
  const id = `cap-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join("/tmp", id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a CAPABILITY.md file with raw YAML frontmatter.
 * Accepts a pre-formatted YAML string to avoid serialization issues.
 */
function writeCapabilityRaw(name: string, yaml: string, body = ""): void {
  const dir = join(capDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "CAPABILITY.md"), `---\n${yaml}\n---\n${body}`);
}

function writeEnvFile(entries: Record<string, string>): void {
  const content = Object.entries(entries)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  writeFileSync(envPath, content + "\n");
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpRoot = makeTmp();
  capDir = join(tmpRoot, "capabilities");
  envPath = join(tmpRoot, ".env");
  mkdirSync(capDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
  // Clean up any env vars we set during tests
  delete process.env.TEST_CAP_KEY;
  delete process.env.DEEPGRAM_API_KEY;
  delete process.env.SOME_KEY;
});

// ===========================================================================
// 1. Scanner tests
// ===========================================================================

describe("scanCapabilities", () => {
  it("discovers capabilities from CAPABILITY.md files", async () => {
    writeCapabilityRaw(
      "audio-stt",
      "name: deepgram-stt\nprovides: audio-to-text\ninterface: script",
    );

    const caps = await scanCapabilities(capDir, envPath);
    expect(caps).toHaveLength(1);
    expect(caps[0].name).toBe("deepgram-stt");
  });

  it("parses frontmatter correctly (name, provides, interface)", async () => {
    writeCapabilityRaw(
      "tts",
      "name: elevenlabs-tts\nprovides: text-to-audio\ninterface: mcp",
    );

    const caps = await scanCapabilities(capDir, envPath);
    expect(caps[0]).toMatchObject({
      name: "elevenlabs-tts",
      provides: "text-to-audio",
      interface: "mcp",
    });
  });

  it("marks capabilities as available when no env requirements", async () => {
    writeCapabilityRaw(
      "simple",
      "name: simple-cap\nprovides: test\ninterface: script",
    );

    const caps = await scanCapabilities(capDir, envPath);
    expect(caps[0].status).toBe("available");
    expect(caps[0].unavailableReason).toBeUndefined();
  });

  it("marks capabilities as unavailable when env vars are missing", async () => {
    writeCapabilityRaw(
      "needs-key",
      "name: needs-key-cap\nprovides: test\ninterface: script\nrequires:\n  env:\n    - DEEPGRAM_API_KEY",
    );

    const caps = await scanCapabilities(capDir, envPath);
    expect(caps[0].status).toBe("unavailable");
    expect(caps[0].unavailableReason).toBe("missing DEEPGRAM_API_KEY");
  });

  it("marks as available when env vars exist in process.env", async () => {
    writeCapabilityRaw(
      "has-key",
      "name: has-key-cap\nprovides: test\ninterface: script\nrequires:\n  env:\n    - TEST_CAP_KEY",
    );

    process.env.TEST_CAP_KEY = "secret123";
    const caps = await scanCapabilities(capDir, envPath);
    expect(caps[0].status).toBe("available");
  });

  it("marks as available when env vars exist in .env file (not in process.env)", async () => {
    writeCapabilityRaw(
      "env-file",
      "name: env-file-cap\nprovides: test\ninterface: script\nrequires:\n  env:\n    - SOME_KEY",
    );

    // NOT in process.env, but in .env file
    delete process.env.SOME_KEY;
    writeEnvFile({ SOME_KEY: "from-file" });

    const caps = await scanCapabilities(capDir, envPath);
    expect(caps[0].status).toBe("available");
  });

  it("handles interface: mcp with .mcp.json — expands ${CAPABILITY_ROOT}", async () => {
    writeCapabilityRaw(
      "mcp-cap",
      "name: mcp-test\nprovides: test-mcp\ninterface: mcp",
    );

    const mcpDir = join(capDir, "mcp-cap");
    const mcpConfig = {
      mcpServers: {
        test: {
          command: "${CAPABILITY_ROOT}/run.sh",
          args: ["--config", "${CAPABILITY_ROOT}/config.json"],
        },
      },
    };
    writeFileSync(join(mcpDir, ".mcp.json"), JSON.stringify(mcpConfig));

    const caps = await scanCapabilities(capDir, envPath);
    expect(caps[0].mcpConfig).toBeDefined();
    const config = caps[0].mcpConfig as Record<string, unknown>;
    const servers = config.mcpServers as Record<
      string,
      { command: string; args: string[] }
    >;
    expect(servers.test.command).toBe(`${mcpDir}/run.sh`);
    expect(servers.test.args).toContain(`${mcpDir}/config.json`);
  });

  it("skips malformed CAPABILITY.md files gracefully", async () => {
    // Create a directory with a malformed CAPABILITY.md (no name field)
    const malDir = join(capDir, "malformed");
    mkdirSync(malDir, { recursive: true });
    writeFileSync(join(malDir, "CAPABILITY.md"), "---\nprovides: test\n---\n");

    // Also create a valid one
    writeCapabilityRaw(
      "valid",
      "name: valid-cap\nprovides: test\ninterface: script",
    );

    const caps = await scanCapabilities(capDir, envPath);
    expect(caps).toHaveLength(1);
    expect(caps[0].name).toBe("valid-cap");
  });

  it("returns empty array for empty directory", async () => {
    const caps = await scanCapabilities(capDir, envPath);
    expect(caps).toEqual([]);
  });
});

// ===========================================================================
// 2. Registry tests
// ===========================================================================

describe("CapabilityRegistry", () => {
  let registry: CapabilityRegistry;

  const availableCap: Capability = {
    name: "deepgram-stt",
    provides: "audio-to-text",
    interface: "script",
    path: "/tmp/fake/deepgram-stt",
    status: "available",
    health: "untested",
  };

  const unavailableCap: Capability = {
    name: "whisper-stt",
    provides: "audio-to-text",
    interface: "script",
    path: "/tmp/fake/whisper-stt",
    status: "unavailable",
    unavailableReason: "missing OPENAI_API_KEY",
    health: "untested",
  };

  const otherCap: Capability = {
    name: "elevenlabs-tts",
    provides: "text-to-audio",
    interface: "mcp",
    path: "/tmp/fake/elevenlabs-tts",
    status: "available",
    health: "untested",
  };

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it("load() populates registry", () => {
    registry.load([availableCap, otherCap]);
    expect(registry.list()).toHaveLength(2);
  });

  it("has(type) returns true for existing provides type", () => {
    registry.load([availableCap]);
    expect(registry.has("audio-to-text")).toBe(true);
  });

  it("has(type) returns false for non-existent type", () => {
    registry.load([availableCap]);
    expect(registry.has("video-processing")).toBe(false);
  });

  it("get(type) returns available capability preferentially", () => {
    // Load unavailable first, then available — should still return available
    registry.load([unavailableCap, availableCap]);
    const result = registry.get("audio-to-text");
    expect(result).toBeDefined();
    expect(result!.name).toBe("deepgram-stt");
    expect(result!.status).toBe("available");
  });

  it("get(type) falls back to unavailable if no available match", () => {
    registry.load([unavailableCap]);
    const result = registry.get("audio-to-text");
    expect(result).toBeDefined();
    expect(result!.name).toBe("whisper-stt");
    expect(result!.status).toBe("unavailable");
  });

  it("list() returns all capabilities", () => {
    registry.load([availableCap, unavailableCap, otherCap]);
    const all = registry.list();
    expect(all).toHaveLength(3);
    const names = all.map((c) => c.name);
    expect(names).toContain("deepgram-stt");
    expect(names).toContain("whisper-stt");
    expect(names).toContain("elevenlabs-tts");
  });

  it("rescan() replaces capabilities with new scan results", async () => {
    registry.load([availableCap]);
    expect(registry.list()).toHaveLength(1);

    const newCaps = [otherCap];
    await registry.rescan(async () => newCaps);

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].name).toBe("elevenlabs-tts");
  });

  it("getContent(type) reads CAPABILITY.md body (needs real file on disk)", () => {
    // Create a real capability directory with a CAPABILITY.md
    const realDir = join(tmpRoot, "real-cap");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(
      join(realDir, "CAPABILITY.md"),
      "---\nname: real-cap\nprovides: test\ninterface: script\n---\n# Usage\n\nThis is the body content.",
    );

    const realCap: Capability = {
      name: "real-cap",
      provides: "test",
      interface: "script",
      path: realDir,
      status: "available",
      health: "untested",
    };
    registry.load([realCap]);

    const content = registry.getContent("test");
    expect(content).not.toBeNull();
    expect(content).toContain("# Usage");
    expect(content).toContain("This is the body content.");
  });

  it("getContent(type) returns null for unknown type", () => {
    registry.load([availableCap]);
    const content = registry.getContent("nonexistent-type");
    expect(content).toBeNull();
  });

  it("getReference(type, filename) reads from references/ subdir", () => {
    const realDir = join(tmpRoot, "ref-cap");
    const refsDir = join(realDir, "references");
    mkdirSync(refsDir, { recursive: true });
    writeFileSync(
      join(realDir, "CAPABILITY.md"),
      "---\nname: ref-cap\nprovides: ref-test\ninterface: script\n---\n",
    );
    writeFileSync(
      join(refsDir, "api-docs.md"),
      "# API Reference\n\nSome docs.",
    );

    const refCap: Capability = {
      name: "ref-cap",
      provides: "ref-test",
      interface: "script",
      path: realDir,
      status: "available",
      health: "untested",
    };
    registry.load([refCap]);

    const ref = registry.getReference("ref-test", "api-docs.md");
    expect(ref).not.toBeNull();
    expect(ref).toContain("# API Reference");
    expect(ref).toContain("Some docs.");
  });

  it("getReference(type, filename) returns null for missing file", () => {
    const realDir = join(tmpRoot, "ref-cap2");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(
      join(realDir, "CAPABILITY.md"),
      "---\nname: ref-cap2\nprovides: ref-test2\ninterface: script\n---\n",
    );

    const refCap: Capability = {
      name: "ref-cap2",
      provides: "ref-test2",
      interface: "script",
      path: realDir,
      status: "available",
      health: "untested",
    };
    registry.load([refCap]);

    const ref = registry.getReference("ref-test2", "nonexistent.md");
    expect(ref).toBeNull();
  });
});

// ===========================================================================
// 3. Prompt hints tests — loadCapabilityHints()
// ===========================================================================

describe("loadCapabilityHints", () => {
  it("returns empty-registry message for empty array", () => {
    const result = loadCapabilityHints([]);
    expect(result).not.toBeNull();
    expect(result).toContain("No capabilities installed");
    expect(result).toContain("capability-brainstorming");
  });

  it("formats available capabilities with health status", () => {
    const caps: Capability[] = [
      {
        name: "deepgram-stt",
        provides: "audio-to-text",
        interface: "script",
        path: "/tmp/test",
        status: "available",
        health: "healthy",
        lastTestLatencyMs: 1200,
      },
    ];

    const result = loadCapabilityHints(caps);
    expect(result).not.toBeNull();
    expect(result).toContain("[healthy, 1.2s]");
    expect(result).toContain("audio-to-text (deepgram-stt)");
  });

  it("formats degraded capabilities with reason", () => {
    const caps: Capability[] = [
      {
        name: "deepgram-stt",
        provides: "audio-to-text",
        interface: "script",
        path: "/tmp/test",
        status: "available",
        health: "degraded",
        degradedReason: "401 Unauthorized",
      },
    ];

    const result = loadCapabilityHints(caps);
    expect(result).not.toBeNull();
    expect(result).toContain("[degraded: 401 Unauthorized]");
  });

  it("formats untested capabilities", () => {
    const caps: Capability[] = [
      {
        name: "deepgram-stt",
        provides: "audio-to-text",
        interface: "script",
        path: "/tmp/test",
        status: "available",
        health: "untested",
      },
    ];

    const result = loadCapabilityHints(caps);
    expect(result).not.toBeNull();
    expect(result).toContain("[untested]");
  });

  it("formats unavailable capabilities with reason", () => {
    const caps: Capability[] = [
      {
        name: "whisper-stt",
        provides: "audio-to-text",
        interface: "script",
        path: "/tmp/test",
        status: "unavailable",
        unavailableReason: "missing OPENAI_API_KEY",
        health: "untested",
      },
    ];

    const result = loadCapabilityHints(caps);
    expect(result).not.toBeNull();
    expect(result).toContain("[unavailable: missing OPENAI_API_KEY]");
  });

  it("includes both available and unavailable in output", () => {
    const caps: Capability[] = [
      {
        name: "cap-a",
        provides: "type-a",
        interface: "script",
        path: "/tmp/a",
        status: "available",
        health: "healthy",
        lastTestLatencyMs: 500,
      },
      {
        name: "cap-b",
        provides: "type-b",
        interface: "script",
        path: "/tmp/b",
        status: "unavailable",
        unavailableReason: "missing KEY",
        health: "untested",
      },
    ];

    const result = loadCapabilityHints(caps)!;
    expect(result).toContain("type-a (cap-a) [healthy, 0.5s]");
    expect(result).toContain("type-b (cap-b) [unavailable: missing KEY]");
  });

  it("shows provides type and name when provides is set", () => {
    const caps: Capability[] = [
      {
        name: "my-tool",
        provides: "special-type",
        interface: "script",
        path: "/tmp/test",
        status: "available",
        health: "untested",
      },
    ];

    const result = loadCapabilityHints(caps)!;
    expect(result).toContain("special-type (my-tool)");
  });

  it("shows only name when provides is not set", () => {
    const caps: Capability[] = [
      {
        name: "custom-tool",
        interface: "script",
        path: "/tmp/test",
        status: "available",
        health: "untested",
      },
    ];

    const result = loadCapabilityHints(caps)!;
    expect(result).toContain("- custom-tool [untested]");
    // Should NOT contain parentheses pattern when no provides
    expect(result).not.toMatch(/\(custom-tool\)/);
  });
});

// ===========================================================================
// 4. resolveEnvPath tests
// ===========================================================================

describe("resolveEnvPath", () => {
  it("resolves to .env in the current working directory", () => {
    const result = resolveEnvPath("/home/user/.my_agent");
    const { resolve } = require("node:path");
    // resolveEnvPath always resolves to CWD/.env (where the process runs from)
    expect(result).toBe(resolve(".env"));
  });
});
